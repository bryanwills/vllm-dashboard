"""One-time import of legacy Full CI and Fast CI alert state."""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol, Sequence
from urllib.parse import unquote, urlsplit

from alerting.analyzer import (
    CheckpointRef,
    FailureCache,
    FullCIBuildPort,
)
from alerting.full_ci import FullCIJobOutcome, FullCIRun
from alerting.ports import Clock

_FULL_CI_MESSAGE = re.compile(r"full ci run - (nightly|daily)", re.IGNORECASE)


@dataclass(frozen=True)
class ImportedFastCIJob:
    """One legacy Fast CI job used only for cutover deduplication."""

    job_id: str
    finished_at: datetime


@dataclass(frozen=True)
class LegacyState:
    failure_cache: FailureCache
    reported_build_numbers: tuple[int, ...]
    memory_files: Mapping[str, bytes]
    fast_ci_jobs: tuple[ImportedFastCIJob, ...]


@dataclass(frozen=True)
class ImportResult:
    baseline_run: FullCIRun
    checkpoint: CheckpointRef
    fast_ci_job_count: int


class LegacyImportStore(Protocol):
    def import_legacy_state(
        self,
        *,
        baseline_run: FullCIRun,
        failure_cache: FailureCache,
        reported_build_numbers: tuple[int, ...],
        checkpoint: CheckpointRef,
        fast_ci_jobs: tuple[ImportedFastCIJob, ...],
        now: datetime,
    ) -> None: ...


class CheckpointUploadPort(Protocol):
    def upload(self, files: Mapping[str, bytes]) -> CheckpointRef: ...


def _aware_datetime(value: Any, description: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"{description} is not an ISO-8601 timestamp") from exc
    if parsed.tzinfo is None:
        raise ValueError(f"{description} must be timezone-aware")
    return parsed


def _load_failure_cache(path: Path) -> FailureCache:
    try:
        raw = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot read failure cache {path}: {exc}") from exc
    if not isinstance(raw, dict):
        raise ValueError("failure cache must be a JSON object")
    build_number = raw.get("build_number")
    commit = raw.get("commit")
    failed_tests = raw.get("failed_tests")
    if not isinstance(build_number, int) or isinstance(build_number, bool):
        raise ValueError("failure cache build_number must be an integer")
    if not isinstance(commit, str) or not commit:
        raise ValueError("failure cache commit must be a non-empty string")
    if not isinstance(failed_tests, list) or not all(
        isinstance(name, str) and name for name in failed_tests
    ):
        raise ValueError("failure cache failed_tests must be a list of names")
    return FailureCache(
        build_number=build_number,
        commit=commit,
        failed_tests=tuple(sorted(set(failed_tests))),
    )


def _load_reported_builds(path: Path) -> tuple[int, ...]:
    try:
        lines = [line.strip() for line in path.read_text().splitlines()]
        builds = tuple(int(line) for line in lines if line)
    except (OSError, ValueError) as exc:
        raise ValueError(f"cannot read reported builds {path}: {exc}") from exc
    if not builds:
        raise ValueError("reported builds file is empty")
    if any(number <= 0 for number in builds):
        raise ValueError("reported build numbers must be positive")
    return tuple(dict.fromkeys(builds))


def _load_memory(path: Path) -> dict[str, bytes]:
    if not path.is_dir():
        raise ValueError(f"analyzer memory directory does not exist: {path}")
    files: dict[str, bytes] = {}
    for candidate in sorted(path.rglob("*")):
        if candidate.is_symlink():
            raise ValueError(f"analyzer memory contains a symbolic link: {candidate}")
        if candidate.is_file():
            files[str(candidate.relative_to(path))] = candidate.read_bytes()
    if not files:
        raise ValueError("analyzer memory directory contains no files")
    return files


def _load_fast_ci_jobs(path: Path) -> tuple[ImportedFastCIJob, ...]:
    if not path.is_file():
        raise ValueError(f"Fast CI SQLite state does not exist: {path}")
    uri = f"{path.resolve().as_uri()}?mode=ro"
    try:
        with sqlite3.connect(uri, uri=True) as connection:
            rows = connection.execute(
                """
                SELECT job_id, finished_at
                FROM alerted_jobs
                WHERE alerted_at IS NOT NULL
                  AND slack_message_ts IS NOT NULL
                ORDER BY job_id
                """
            ).fetchall()
    except sqlite3.Error as exc:
        raise ValueError(f"cannot read Fast CI SQLite state {path}: {exc}") from exc
    return tuple(
        ImportedFastCIJob(
            job_id=str(job_id),
            finished_at=_aware_datetime(finished_at, f"finished_at for job {job_id}"),
        )
        for job_id, finished_at in rows
    )


def load_legacy_state(
    *,
    failure_cache_path: Path,
    reported_builds_path: Path,
    analyzer_memory_path: Path,
    fast_ci_state_path: Path,
) -> LegacyState:
    """Read and validate all legacy state without changing external systems."""
    failure_cache = _load_failure_cache(failure_cache_path)
    reported_build_numbers = _load_reported_builds(reported_builds_path)
    cache_build_number = failure_cache.build_number
    if cache_build_number is None:
        raise ValueError("failure cache has no baseline build number")
    if cache_build_number != reported_build_numbers[0]:
        raise ValueError(
            f"cache build {cache_build_number} was not delivered as latest "
            f"reported build {reported_build_numbers[0]}; finish or restore "
            "the legacy delivery before importing"
        )
    return LegacyState(
        failure_cache=failure_cache,
        reported_build_numbers=reported_build_numbers,
        memory_files=_load_memory(analyzer_memory_path),
        fast_ci_jobs=_load_fast_ci_jobs(fast_ci_state_path),
    )


def _baseline_run(build: Mapping[str, Any], expected_number: int) -> FullCIRun:
    try:
        build_number = int(build["number"])
        build_id = str(build["id"])
        scheduled_at = _aware_datetime(build["scheduled_at"], "Buildkite scheduled_at")
        message = str(build["message"]).strip()
        jobs = build["jobs"]
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError(f"Buildkite baseline build is incomplete: {exc}") from exc
    if build_number != expected_number:
        raise ValueError(
            f"Buildkite returned build {build_number}; expected {expected_number}"
        )
    if not build_id:
        raise ValueError("Buildkite baseline build has no id")
    if _FULL_CI_MESSAGE.fullmatch(message) is None:
        raise ValueError(f"Buildkite build {build_number} is not a Full CI run")
    if not isinstance(jobs, list):
        raise ValueError("Buildkite baseline build has no jobs list")
    return FullCIRun(
        build_id=build_id,
        build_number=build_number,
        scheduled_at=scheduled_at,
        commit_sha=str(build.get("commit") or ""),
        message=message,
        state=str(build.get("state") or ""),
        jobs=tuple(
            FullCIJobOutcome(
                name=str(job["name"]),
                state=str(job.get("state") or ""),
                soft_failed=bool(job.get("soft_failed")),
            )
            for job in jobs
            if isinstance(job, dict) and job.get("name") is not None
        ),
    )


class LegacyStateImporter:
    """Hydrate legacy state, uploading memory before its Postgres reference."""

    def __init__(
        self,
        *,
        builds: FullCIBuildPort,
        checkpoints: CheckpointUploadPort,
        store: LegacyImportStore,
        clock: Clock,
    ) -> None:
        self._builds = builds
        self._checkpoints = checkpoints
        self._store = store
        self._clock = clock

    def import_state(self, state: LegacyState) -> ImportResult:
        if state.failure_cache.build_number is None:
            raise ValueError("failure cache has no baseline build number")
        build_number = state.failure_cache.build_number
        run = _baseline_run(self._builds.get_build(build_number), build_number)
        if run.commit_sha != state.failure_cache.commit:
            raise ValueError(
                f"cache commit {state.failure_cache.commit} does not match "
                f"Buildkite commit {run.commit_sha}"
            )
        checkpoint = self._checkpoints.upload(state.memory_files)
        self._store.import_legacy_state(
            baseline_run=run,
            failure_cache=state.failure_cache,
            reported_build_numbers=state.reported_build_numbers,
            checkpoint=checkpoint,
            fast_ci_jobs=state.fast_ci_jobs,
            now=self._clock.now(),
        )
        return ImportResult(
            baseline_run=run,
            checkpoint=checkpoint,
            fast_ci_job_count=len(state.fast_ci_jobs),
        )


def _database_target(database_url: str) -> str:
    parsed = urlsplit(database_url)
    if parsed.scheme in {"postgres", "postgresql"}:
        host = parsed.hostname or "localhost"
        port = str(parsed.port or 5432)
        database = unquote(parsed.path.lstrip("/")) or unquote(
            parsed.username or "postgres"
        )
    else:
        from psycopg.conninfo import conninfo_to_dict

        parameters = conninfo_to_dict(database_url)
        host = str(parameters.get("host") or "localhost")
        port = str(parameters.get("port") or "5432")
        database = str(parameters.get("dbname") or parameters.get("user") or "postgres")
    return f"{host}:{port}/{database}"


class _UTCClock:
    def now(self) -> datetime:
        return datetime.now(timezone.utc)


def _apply_import(
    state: LegacyState,
    *,
    database_url: str,
    buildkite_token: str,
    checkpoint_bucket: str,
) -> ImportResult:
    from alerting.analyzer import S3CheckpointStore
    from alerting.full_ci import BuildkiteRestClient
    from alerting.postgres import PostgresAlertStore

    return LegacyStateImporter(
        builds=BuildkiteRestClient(token=buildkite_token),
        checkpoints=S3CheckpointStore(bucket=checkpoint_bucket),
        store=PostgresAlertStore.from_database_url(database_url),
        clock=_UTCClock(),
    ).import_state(state)


def main(arguments: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--failure-cache", type=Path, required=True)
    parser.add_argument("--reported-builds", type=Path, required=True)
    parser.add_argument("--analyzer-memory", type=Path, required=True)
    parser.add_argument("--fast-ci-state", type=Path, required=True)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="upload and commit the import; default is a read-only local plan",
    )
    parser.add_argument(
        "--confirm-target",
        metavar="HOST:PORT/DATABASE",
        help="exact database target; required with --apply",
    )
    args = parser.parse_args(arguments)
    try:
        state = load_legacy_state(
            failure_cache_path=args.failure_cache,
            reported_builds_path=args.reported_builds,
            analyzer_memory_path=args.analyzer_memory,
            fast_ci_state_path=args.fast_ci_state,
        )
    except ValueError as error:
        print(f"invalid legacy state: {error}", file=sys.stderr)
        return 2
    print(f"Full CI baseline build {state.failure_cache.build_number}")
    print(
        "last reported Full CI builds "
        + ", ".join(str(number) for number in state.reported_build_numbers)
    )
    print(f"analyzer memory files {len(state.memory_files)}")
    print(f"Fast CI job IDs {len(state.fast_ci_jobs)}")
    if not args.apply:
        print("plan only; pass --apply with the exact --confirm-target to import")
        return 0

    database_url = os.environ.get("DATABASE_URL", "")
    buildkite_token = os.environ.get("BUILDKITE_TOKEN", "")
    checkpoint_bucket = os.environ.get("ANALYZER_CHECKPOINT_BUCKET", "")
    missing = [
        name
        for name, value in (
            ("DATABASE_URL", database_url),
            ("BUILDKITE_TOKEN", buildkite_token),
            ("ANALYZER_CHECKPOINT_BUCKET", checkpoint_bucket),
        )
        if not value
    ]
    if missing:
        print(f"missing environment variables: {', '.join(missing)}", file=sys.stderr)
        return 2
    try:
        target = _database_target(database_url)
    except (TypeError, ValueError) as error:
        print(f"invalid DATABASE_URL: {error}", file=sys.stderr)
        return 2
    print(f"target {target}")
    if args.confirm_target != target:
        print(
            f"--confirm-target {args.confirm_target!r} does not match {target!r}",
            file=sys.stderr,
        )
        return 2
    try:
        result = _apply_import(
            state,
            database_url=database_url,
            buildkite_token=buildkite_token,
            checkpoint_bucket=checkpoint_bucket,
        )
    except (RuntimeError, ValueError) as error:
        print(f"import failed: {error}", file=sys.stderr)
        return 1
    print(
        f"imported Full CI build {result.baseline_run.build_number}, "
        f"checkpoint {result.checkpoint.s3_uri}, and "
        f"{result.fast_ci_job_count} Fast CI job IDs"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
