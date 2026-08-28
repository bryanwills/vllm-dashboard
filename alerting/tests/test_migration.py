"""One-time legacy-state import behavior through the migration seam."""

from __future__ import annotations

import json
import sqlite3
import copy
from datetime import datetime, timezone
from pathlib import Path
from types import TracebackType
from typing import Any, Literal, Mapping

import pytest

from alerting.analyzer import CheckpointRef, FailureCache
from alerting.memory import FixedClock
from alerting.migration import (
    ImportedFastCIJob,
    LegacyStateImporter,
    load_legacy_state,
    main,
)
from alerting.full_ci import FullCIJobOutcome, FullCIRun
from alerting.postgres import PostgresAlertStore

NOW = datetime(2026, 8, 27, 19, 0, tzinfo=timezone.utc)


def _write_sqlite(path: Path) -> None:
    connection = sqlite3.connect(path)
    connection.execute(
        """
        CREATE TABLE alerted_jobs (
          job_id TEXT PRIMARY KEY,
          finished_at TEXT NOT NULL,
          reserved_at TEXT NOT NULL,
          alerted_at TEXT,
          slack_message_ts TEXT
        )
        """
    )
    connection.executemany(
        "INSERT INTO alerted_jobs VALUES (?, ?, ?, ?, ?)",
        [
            (
                "sent-job",
                "2026-08-27T18:30:00+00:00",
                "2026-08-27T18:31:00+00:00",
                "2026-08-27T18:32:00+00:00",
                "123.456",
            ),
            (
                "reserved-only-job",
                "2026-08-27T18:40:00+00:00",
                "2026-08-27T18:41:00+00:00",
                None,
                None,
            ),
        ],
    )
    connection.commit()
    connection.close()


def test_load_legacy_state_reads_baseline_memory_and_delivered_fast_ci_jobs(
    tmp_path: Path,
) -> None:
    cache_path = tmp_path / "failed_tests_cache.json"
    cache_path.write_text(
        json.dumps(
            {
                "build_number": 123,
                "commit": "commit-123",
                "failed_tests": ["Job B", "Job A", "Job A"],
            }
        )
    )
    reported_path = tmp_path / "last_reported_builds.txt"
    reported_path.write_text("123\n122\n")
    memory_path = tmp_path / "vllm-ci-failure-analyzer"
    (memory_path / "notes").mkdir(parents=True)
    (memory_path / "MEMORY.md").write_text("# learned\n")
    (memory_path / "notes/classification.md").write_text("known flaky job\n")
    sqlite_path = tmp_path / "state.sqlite3"
    _write_sqlite(sqlite_path)

    state = load_legacy_state(
        failure_cache_path=cache_path,
        reported_builds_path=reported_path,
        analyzer_memory_path=memory_path,
        fast_ci_state_path=sqlite_path,
    )

    assert state.failure_cache == FailureCache(
        build_number=123,
        commit="commit-123",
        failed_tests=("Job A", "Job B"),
    )
    assert state.reported_build_numbers == (123, 122)
    assert state.memory_files == {
        "MEMORY.md": b"# learned\n",
        "notes/classification.md": b"known flaky job\n",
    }
    assert [(job.job_id, job.finished_at) for job in state.fast_ci_jobs] == [
        ("sent-job", datetime(2026, 8, 27, 18, 30, tzinfo=timezone.utc)),
    ]


class FakeBuilds:
    def get_build(self, build_number: int) -> dict[str, Any]:
        assert build_number == 123
        return {
            "id": "build-123",
            "number": 123,
            "scheduled_at": "2026-08-27T06:00:00Z",
            "commit": "commit-123",
            "message": "Full CI run - nightly",
            "state": "failed",
            "jobs": [
                {"name": "Job A", "state": "failed", "soft_failed": False},
                {"name": "Job B", "state": "passed", "soft_failed": False},
            ],
        }


class RecordingCheckpoints:
    def __init__(self, calls: list[str]) -> None:
        self.calls = calls
        self.files: Mapping[str, bytes] | None = None

    def upload(self, files: Mapping[str, bytes]) -> CheckpointRef:
        self.calls.append("upload")
        self.files = files
        return CheckpointRef(
            s3_uri="s3://checkpoints/imported.tar.gz",
            sha256="abc123",
            schema_version=1,
        )

    def download(self, s3_uri: str) -> bytes:
        raise RuntimeError("import tests never download checkpoints")


class RecordingStore:
    def __init__(self, calls: list[str]) -> None:
        self.calls = calls
        self.arguments: dict[str, Any] = {}

    def import_legacy_state(self, **arguments: Any) -> None:
        self.calls.append("commit")
        self.arguments = arguments


def test_import_uploads_memory_before_committing_migrated_baselines(
    tmp_path: Path,
) -> None:
    cache_path = tmp_path / "cache.json"
    cache_path.write_text(
        '{"build_number":123,"commit":"commit-123","failed_tests":["Job A"]}'
    )
    reported_path = tmp_path / "reported.txt"
    reported_path.write_text("123\n122\n")
    memory_path = tmp_path / "memory"
    memory_path.mkdir()
    (memory_path / "MEMORY.md").write_text("# learned\n")
    sqlite_path = tmp_path / "state.sqlite3"
    _write_sqlite(sqlite_path)
    state = load_legacy_state(
        failure_cache_path=cache_path,
        reported_builds_path=reported_path,
        analyzer_memory_path=memory_path,
        fast_ci_state_path=sqlite_path,
    )
    calls: list[str] = []
    checkpoints = RecordingCheckpoints(calls)
    store = RecordingStore(calls)

    result = LegacyStateImporter(
        builds=FakeBuilds(),
        checkpoints=checkpoints,
        store=store,
        clock=FixedClock(NOW),
    ).import_state(state)

    assert calls == ["upload", "commit"]
    assert checkpoints.files == {"MEMORY.md": b"# learned\n"}
    assert result.baseline_run.build_id == "build-123"
    assert result.checkpoint.s3_uri == "s3://checkpoints/imported.tar.gz"
    assert store.arguments["baseline_run"] == result.baseline_run
    assert store.arguments["failure_cache"] == state.failure_cache
    assert store.arguments["reported_build_numbers"] == (123, 122)
    assert store.arguments["fast_ci_jobs"] == state.fast_ci_jobs
    assert store.arguments["checkpoint"] == result.checkpoint
    assert store.arguments["now"] == NOW


def test_cache_newer_than_last_reported_build_blocks_unsafe_import(
    tmp_path: Path,
) -> None:
    cache_path = tmp_path / "cache.json"
    cache_path.write_text(
        '{"build_number":124,"commit":"commit-124","failed_tests":[]}'
    )
    reported_path = tmp_path / "reported.txt"
    reported_path.write_text("123\n122\n")
    memory_path = tmp_path / "memory"
    memory_path.mkdir()
    (memory_path / "MEMORY.md").write_text("# learned\n")
    sqlite_path = tmp_path / "state.sqlite3"
    _write_sqlite(sqlite_path)

    with pytest.raises(ValueError, match="was not delivered"):
        load_legacy_state(
            failure_cache_path=cache_path,
            reported_builds_path=reported_path,
            analyzer_memory_path=memory_path,
            fast_ci_state_path=sqlite_path,
        )


class Result:
    def __init__(
        self,
        row: tuple[Any, ...] | None = None,
        rows: list[tuple[Any, ...]] | None = None,
        rowcount: int = 0,
    ) -> None:
        self._row = row
        self._rows = rows or []
        self.rowcount = rowcount

    def fetchone(self) -> tuple[Any, ...] | None:
        return self._row

    def fetchall(self) -> list[tuple[Any, ...]]:
        return self._rows


class Transaction:
    def __init__(self, connection: ImportConnection) -> None:
        self.connection = connection
        self.snapshot: dict[str, Any] = {}

    def __enter__(self) -> None:
        self.snapshot = copy.deepcopy(self.connection.state)
        self.connection.transaction_depth += 1

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> Literal[False]:
        self.connection.transaction_depth -= 1
        if exc_type is not None:
            self.connection.state = self.snapshot
        return False


class _ConnectionCursor:
    """psycopg3-style cursor facade over the fake connection."""

    def __init__(self, connection: "ImportConnection") -> None:
        self._connection = connection

    def __enter__(self) -> "_ConnectionCursor":
        return self

    def __exit__(self, *exc_info: object) -> None:
        return None

    def executemany(self, sql: str, params: list[tuple[Any, ...]]) -> "Result":
        return self._connection.executemany(sql, params)


class ImportConnection:
    def __init__(self) -> None:
        self.state: dict[str, Any] = {
            "runs": {},
            "jobs": {},
            "baseline": None,
            "checkpoints": [],
            "fast_ci_jobs": {},
        }
        self.transaction_depth = 0

    def __enter__(self) -> ImportConnection:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> Literal[False]:
        return False

    def transaction(self) -> Transaction:
        return Transaction(self)

    def execute(self, sql: str, params: tuple[Any, ...] = ()) -> Result:
        statement = " ".join(sql.split())
        assert self.transaction_depth == 1
        if statement.startswith("SELECT pg_advisory_xact_lock"):
            return Result((None,))
        if statement.startswith(
            "SELECT buildkite_build_id, failure_cache, reported_build_numbers"
        ):
            baseline = self.state["baseline"]
            return Result(tuple(baseline) if baseline is not None else None)
        if statement.startswith("SELECT EXISTS"):
            return Result((False,))
        if statement.startswith("SELECT s3_uri, sha256, schema_version"):
            checkpoints = self.state["checkpoints"]
            return Result(tuple(checkpoints[0][1:4]) if checkpoints else None)
        if statement.startswith("INSERT INTO alerting_full_ci_runs"):
            self.state["runs"].setdefault(params[0], params)
            return Result((params[0],))
        if statement.startswith(
            "SELECT build_number, scheduled_at, commit_sha, message, state"
        ):
            run = self.state["runs"].get(params[0])
            return Result(run[1:] if run is not None else None)
        if statement.startswith("INSERT INTO alerting_analyzer_checkpoints"):
            self.state["checkpoints"].append((None, *params))
            return Result(rowcount=1)
        if statement.startswith("INSERT INTO alerting_full_ci_import_baselines"):
            self.state["baseline"] = (
                params[0],
                json.loads(params[1]),
                params[2],
                params[3],
            )
            return Result(rowcount=1)
        raise AssertionError(f"unexpected SQL: {statement}")

    def cursor(self) -> _ConnectionCursor:
        return _ConnectionCursor(self)

    def executemany(self, sql: str, params: list[tuple[Any, ...]]) -> Result:
        statement = " ".join(sql.split())
        assert self.transaction_depth == 1
        if statement.startswith("INSERT INTO alerting_full_ci_job_outcomes"):
            for row in params:
                self.state["jobs"].setdefault((row[0], row[1]), row)
            return Result(rowcount=len(params))
        if statement.startswith(
            "INSERT INTO alerting_fast_ci_imported_deduplication_keys"
        ):
            for row in params:
                self.state["fast_ci_jobs"].setdefault(row[0], row)
            return Result(rowcount=len(params))
        raise AssertionError(f"unexpected SQL: {statement}")


def test_postgres_import_commits_baseline_checkpoint_and_deduplication_keys_once() -> (
    None
):
    connection = ImportConnection()
    store = PostgresAlertStore(lambda: connection)
    run = FullCIRun(
        build_id="build-123",
        build_number=123,
        scheduled_at=datetime(2026, 8, 27, 6, 0, tzinfo=timezone.utc),
        commit_sha="commit-123",
        message="Full CI run - nightly",
        state="failed",
        jobs=(FullCIJobOutcome("Job A", "failed", False),),
    )
    cache = FailureCache(123, "commit-123", ("Job A",))
    checkpoint = CheckpointRef("s3://checkpoints/seed.tar.gz", "abc123", 1)
    imported_job = ImportedFastCIJob(
        "sent-job", datetime(2026, 8, 27, 18, 30, tzinfo=timezone.utc)
    )

    store.import_legacy_state(
        baseline_run=run,
        failure_cache=cache,
        reported_build_numbers=(123, 122),
        checkpoint=checkpoint,
        fast_ci_jobs=(imported_job,),
        now=NOW,
    )
    store.import_legacy_state(
        baseline_run=run,
        failure_cache=cache,
        reported_build_numbers=(123, 122),
        checkpoint=checkpoint,
        fast_ci_jobs=(imported_job,),
        now=NOW,
    )

    with pytest.raises(RuntimeError, match="different baseline or checkpoint"):
        store.import_legacy_state(
            baseline_run=run,
            failure_cache=cache,
            reported_build_numbers=(123, 122),
            checkpoint=CheckpointRef("s3://checkpoints/orphan.tar.gz", "def456", 1),
            fast_ci_jobs=(imported_job,),
            now=NOW,
        )

    assert list(connection.state["runs"]) == ["build-123"]
    assert list(connection.state["jobs"]) == [("build-123", "Job A")]
    assert connection.state["baseline"][0] == "build-123"
    assert connection.state["baseline"][1] == {
        "build_number": 123,
        "commit": "commit-123",
        "failed_tests": ["Job A"],
    }
    assert len(connection.state["checkpoints"]) == 1
    assert connection.state["checkpoints"][0][1] == "s3://checkpoints/seed.tar.gz"
    assert list(connection.state["fast_ci_jobs"]) == ["sent-job"]


def test_cli_defaults_to_read_only_import_plan(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    cache_path = tmp_path / "cache.json"
    cache_path.write_text(
        '{"build_number":123,"commit":"commit-123","failed_tests":["Job A"]}'
    )
    reported_path = tmp_path / "reported.txt"
    reported_path.write_text("123\n122\n")
    memory_path = tmp_path / "memory"
    memory_path.mkdir()
    (memory_path / "MEMORY.md").write_text("# learned\n")
    sqlite_path = tmp_path / "state.sqlite3"
    _write_sqlite(sqlite_path)

    assert (
        main(
            [
                "--failure-cache",
                str(cache_path),
                "--reported-builds",
                str(reported_path),
                "--analyzer-memory",
                str(memory_path),
                "--fast-ci-state",
                str(sqlite_path),
            ]
        )
        == 0
    )

    output = capsys.readouterr().out
    assert "Full CI baseline build 123" in output
    assert "analyzer memory files 1" in output
    assert "Fast CI job IDs 1" in output
    assert "plan only" in output
