"""Apply all vLLM dashboard SQL migrations to Postgres.

Usage:
    DATABASE_URL=postgres://... vllm-dashboard-migrate
    DATABASE_URL=postgres://... vllm-dashboard-migrate \
        --apply --confirm-target host:port/database
    DATABASE_URL=postgres://... vllm-dashboard-migrate \
        --adopt-existing-dashboard --confirm-target host:port/database

Run against a direct Supabase connection or session-mode pooler, never the
transaction-mode pooler: migrations take an advisory lock and run DDL.
Applied migrations are recorded in `schema_migrations`; the run adopts records
from the legacy `alerting_schema_migrations` table, then applies only pending
files. Without a write flag, the CLI only prints its target and pending files.
Files run in their own transactions unless explicitly marked otherwise.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import TYPE_CHECKING, Any, Sequence
from urllib.parse import parse_qsl, unquote, urlsplit

if TYPE_CHECKING:
    from psycopg import Connection

MIGRATIONS_DIR = Path(__file__).resolve().parent / "sql"

# Arbitrary constant identifying this migration runner's advisory lock.
_ADVISORY_LOCK_KEY = 0x_A1E7_0001
_NO_TRANSACTION_MARKER = "-- migrate: no-transaction"
_VALID_INDEX_MARKER = "-- migrate: valid-index "
_LOCK_TIMEOUT = "5s"
_STATEMENT_TIMEOUT = "15min"

_DASHBOARD_BASELINE_MIGRATIONS = (
    "0005_dashboard_operational.sql",
    "0006_queue_covering_index.sql",
    "0007_gpu_rollups.sql",
    "0008_otel_spans.sql",
)

_DASHBOARD_COLUMN_TYPES = {
    "queue_snapshots": {
        "id": "int4",
        "polled_at": "timestamptz",
        "queue": "text",
        "agents_idle": "int4",
        "agents_busy": "int4",
        "agents_total": "int4",
        "jobs_scheduled": "int4",
        "jobs_running": "int4",
        "jobs_waiting": "int4",
        "jobs_total": "int4",
        "p50_wait_secs": "float4",
        "p90_wait_secs": "float4",
        "p95_wait_secs": "float4",
        "p99_wait_secs": "float4",
    },
    "alert_threads": {
        "queue": "text",
        "thread_ts": "text",
        "status": "text",
        "history": "_text",
        "created_at": "timestamptz",
        "updated_at": "timestamptz",
    },
    "alert_summary": {
        "id": "text",
        "message_ts": "text",
        "queues": "jsonb",
        "created_at": "timestamptz",
        "updated_at": "timestamptz",
    },
    "gpu_snapshots": {
        "id": "int4",
        "reported_at": "timestamptz",
        "hostname": "text",
        "gpu_index": "int4",
        "gpu_name": "text",
        "gpu_util": "float4",
        "mem_used_mb": "float4",
        "mem_total_mb": "float4",
        "temperature_c": "float4",
        "power_draw_w": "float4",
        "power_limit_w": "float4",
    },
    "gpu_history_5m": {
        "time_bucket": "timestamptz",
        "hostname": "text",
        "gpu_name": "text",
        "mem_pct_sum": "float8",
        "gpu_util_sum": "float8",
        "sample_count": "int8",
    },
    "otel_spans": {
        "trace_id": "text",
        "span_id": "text",
        "parent_span_id": "text",
        "trace_state": "text",
        "trace_flags": "int4",
        "span_name": "text",
        "span_kind": "int2",
        "start_time": "timestamptz",
        "end_time": "timestamptz",
        "duration_ms": "float8",
        "status_code": "int2",
        "status_message": "text",
        "service_name": "text",
        "scope_name": "text",
        "scope_version": "text",
        "resource_schema_url": "text",
        "scope_schema_url": "text",
        "organization_slug": "text",
        "pipeline_slug": "text",
        "build_id": "text",
        "build_number": "int8",
        "build_state": "text",
        "step_id": "text",
        "step_key": "text",
        "job_id": "text",
        "job_label": "text",
        "job_state": "text",
        "agent_id": "text",
        "agent_name": "text",
        "agent_queue": "text",
        "resource_attributes": "jsonb",
        "span_attributes": "jsonb",
        "span_events": "jsonb",
        "span_links": "jsonb",
        "dropped_attributes_count": "int4",
        "dropped_events_count": "int4",
        "dropped_links_count": "int4",
        "received_at": "timestamptz",
    },
}

_DASHBOARD_NULLABLE_COLUMNS = {
    ("queue_snapshots", "p50_wait_secs"),
    ("queue_snapshots", "p90_wait_secs"),
    ("queue_snapshots", "p95_wait_secs"),
    ("queue_snapshots", "p99_wait_secs"),
    ("gpu_snapshots", "gpu_name"),
    ("gpu_snapshots", "temperature_c"),
    ("gpu_snapshots", "power_draw_w"),
    ("gpu_snapshots", "power_limit_w"),
    ("otel_spans", "parent_span_id"),
    ("otel_spans", "trace_state"),
    ("otel_spans", "status_message"),
    ("otel_spans", "service_name"),
    ("otel_spans", "scope_name"),
    ("otel_spans", "scope_version"),
    ("otel_spans", "resource_schema_url"),
    ("otel_spans", "scope_schema_url"),
    ("otel_spans", "organization_slug"),
    ("otel_spans", "pipeline_slug"),
    ("otel_spans", "build_id"),
    ("otel_spans", "build_number"),
    ("otel_spans", "build_state"),
    ("otel_spans", "step_id"),
    ("otel_spans", "step_key"),
    ("otel_spans", "job_id"),
    ("otel_spans", "job_label"),
    ("otel_spans", "job_state"),
    ("otel_spans", "agent_id"),
    ("otel_spans", "agent_name"),
    ("otel_spans", "agent_queue"),
}

_DASHBOARD_INDEX_TABLES = {
    "queue_snapshots_pkey": "queue_snapshots",
    "idx_snapshots_polled_queue": "queue_snapshots",
    "idx_snapshots_queue_polled": "queue_snapshots",
    "idx_snapshots_queue_polled_cover_v2": "queue_snapshots",
    "alert_threads_pkey": "alert_threads",
    "alert_summary_pkey": "alert_summary",
    "gpu_snapshots_pkey": "gpu_snapshots",
    "idx_gpu_snapshots_reported": "gpu_snapshots",
    "idx_gpu_snapshots_host": "gpu_snapshots",
    "idx_gpu_snapshots_host_gpu_reported": "gpu_snapshots",
    "gpu_history_5m_pkey": "gpu_history_5m",
    "idx_gpu_history_5m_time_host": "gpu_history_5m",
    "otel_spans_pkey": "otel_spans",
    "idx_otel_spans_received": "otel_spans",
    "idx_otel_spans_build": "otel_spans",
    "idx_otel_spans_build_id": "otel_spans",
    "idx_otel_spans_job": "otel_spans",
}


def migration_files(directory: Path) -> list[Path]:
    return sorted(directory.glob("*.sql"))


def migration_is_transactional(sql: str) -> bool:
    return not sql.lstrip().startswith(_NO_TRANSACTION_MARKER)


def migration_valid_indexes(sql: str) -> list[str]:
    return [
        line.removeprefix(_VALID_INDEX_MARKER).strip()
        for line in sql.splitlines()
        if line.startswith(_VALID_INDEX_MARKER)
    ]


def database_target(database_url: str) -> str:
    """Return a credential-free host/database label for operator confirmation."""
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


def validate_migration_database_url(database_url: str) -> str:
    """Reject application and transaction-pooler URLs before connecting."""
    from psycopg import ProgrammingError
    from psycopg.conninfo import conninfo_to_dict

    parsed = urlsplit(database_url)
    query_keys = (
        {key for key, _ in parse_qsl(parsed.query, keep_blank_values=True)}
        if parsed.scheme in {"postgres", "postgresql"}
        else set()
    )
    try:
        parameters = conninfo_to_dict(database_url)
    except ProgrammingError as error:
        if query_keys.intersection({"supa", "pgbouncer"}):
            raise ValueError(
                "migration DATABASE_URL must use Supabase Direct connection or "
                "Session pooler on port 5432; application and transaction-pooler "
                "URLs are not supported"
            ) from error
        raise ValueError(
            "DATABASE_URL contains unsupported PostgreSQL connection options"
        ) from error
    if parameters.get("port") == "6543":
        raise ValueError(
            "migration DATABASE_URL must use Supabase Direct connection or "
            "Session pooler on port 5432; transaction pooler port 6543 is not supported"
        )
    return database_url


def _configure_connection(conn: Connection[Any], *, applying: bool) -> None:
    conn.execute("SELECT set_config('search_path', 'public, pg_catalog', false)")
    conn.execute(
        "SELECT set_config('statement_timeout', %s, false)",
        (_STATEMENT_TIMEOUT if applying else "10s",),
    )
    if applying:
        conn.execute(
            "SELECT set_config('lock_timeout', %s, false)",
            (_LOCK_TIMEOUT,),
        )


def _recorded_migrations(conn: Connection[Any]) -> set[str]:
    recorded: set[str] = set()
    migration_table = conn.execute(
        "SELECT to_regclass('public.schema_migrations')"
    ).fetchone()
    if migration_table is not None and migration_table[0] is not None:
        recorded.update(
            name
            for (name,) in conn.execute(
                "SELECT name FROM public.schema_migrations"
            ).fetchall()
        )
    legacy_table = conn.execute(
        "SELECT to_regclass('public.alerting_schema_migrations')"
    ).fetchone()
    if legacy_table is not None and legacy_table[0] is not None:
        recorded.update(
            name
            for (name,) in conn.execute(
                "SELECT name FROM public.alerting_schema_migrations"
            ).fetchall()
        )
    return recorded


def _acquire_migration_lock(conn: Connection[Any]) -> None:
    acquired = conn.execute(
        "SELECT pg_try_advisory_lock(%s)", (_ADVISORY_LOCK_KEY,)
    ).fetchone()
    if acquired is None or not acquired[0]:
        raise RuntimeError("another migration process holds the advisory lock")


def _create_migration_table(conn: Connection[Any]) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS public.schema_migrations (
            name       text PRIMARY KEY,
            applied_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )


def _verify_existing_dashboard(conn: Connection[Any]) -> None:
    table_names = list(_DASHBOARD_COLUMN_TYPES)
    column_rows = conn.execute(
        """
        SELECT table_name, column_name, udt_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ANY(%s)
        """,
        (table_names,),
    ).fetchall()
    actual_columns = {
        (table_name, column_name): (udt_name, is_nullable)
        for table_name, column_name, udt_name, is_nullable in column_rows
    }
    column_errors = [
        f"{table_name}.{column_name} "
        f"({actual_columns.get((table_name, column_name), ('missing', 'missing'))[0]} "
        f"!= {expected_type})"
        for table_name, columns in _DASHBOARD_COLUMN_TYPES.items()
        for column_name, expected_type in columns.items()
        if actual_columns.get((table_name, column_name), (None, None))[0]
        != expected_type
    ]
    nullability_errors = [
        f"{table_name}.{column_name} ({actual_columns[(table_name, column_name)][1]})"
        for table_name, columns in _DASHBOARD_COLUMN_TYPES.items()
        for column_name in columns
        if (table_name, column_name) in actual_columns
        and (table_name, column_name) != ("alert_threads", "history")
        and (
            actual_columns[(table_name, column_name)][1]
            != (
                "YES"
                if (table_name, column_name) in _DASHBOARD_NULLABLE_COLUMNS
                else "NO"
            )
        )
    ]
    if column_errors:
        raise RuntimeError(
            "existing dashboard column verification failed: " + ", ".join(column_errors)
        )
    if nullability_errors:
        raise RuntimeError(
            "existing dashboard nullability verification failed: "
            + ", ".join(nullability_errors)
        )

    index_rows = conn.execute(
        """
        SELECT index_relation.relname, table_relation.relname, indexes.indisvalid
        FROM pg_index AS indexes
        JOIN pg_class AS index_relation ON index_relation.oid = indexes.indexrelid
        JOIN pg_class AS table_relation ON table_relation.oid = indexes.indrelid
        JOIN pg_namespace AS namespace ON namespace.oid = table_relation.relnamespace
        WHERE namespace.nspname = 'public' AND table_relation.relname = ANY(%s)
        """,
        (table_names,),
    ).fetchall()
    actual_indexes = {
        index_name: (table_name, is_valid)
        for index_name, table_name, is_valid in index_rows
    }
    index_errors = [
        index_name
        for index_name, expected_table in _DASHBOARD_INDEX_TABLES.items()
        if actual_indexes.get(index_name) != (expected_table, True)
    ]
    if index_errors:
        raise RuntimeError(
            "existing dashboard index verification failed: " + ", ".join(index_errors)
        )

    coverage = conn.execute(
        """
        SELECT
            date_bin(
                interval '5 minutes',
                (SELECT reported_at FROM public.gpu_snapshots
                 ORDER BY reported_at ASC LIMIT 1),
                timestamptz 'epoch'
            ),
            date_bin(
                interval '5 minutes',
                (SELECT reported_at FROM public.gpu_snapshots
                 ORDER BY reported_at DESC LIMIT 1),
                timestamptz 'epoch'
            ),
            (SELECT time_bucket FROM public.gpu_history_5m
             ORDER BY time_bucket ASC LIMIT 1),
            (SELECT time_bucket FROM public.gpu_history_5m
             ORDER BY time_bucket DESC LIMIT 1)
        """
    ).fetchone()
    if coverage is None:
        raise RuntimeError("could not verify GPU rollup coverage")
    raw_oldest, raw_newest, rollup_oldest, rollup_newest = coverage
    if raw_oldest is not None and (
        rollup_oldest is None
        or rollup_newest is None
        or rollup_oldest > raw_oldest
        or rollup_newest < raw_newest
    ):
        raise RuntimeError(
            "GPU rollup does not cover the raw snapshot time range; "
            "0007 cannot be adopted"
        )


def adopt_existing_dashboard(database_url: str) -> list[str]:
    """Verify and record pre-existing dashboard migrations without running DDL."""
    import psycopg

    database_url = validate_migration_database_url(database_url)
    adopted: list[str] = []
    with psycopg.connect(database_url, autocommit=True, prepare_threshold=None) as conn:
        _configure_connection(conn, applying=True)
        _acquire_migration_lock(conn)
        already_applied = _recorded_migrations(conn)
        missing = [
            name
            for name in _DASHBOARD_BASELINE_MIGRATIONS
            if name not in already_applied
        ]
        if not missing:
            return adopted
        _verify_existing_dashboard(conn)
        with conn.transaction():
            _create_migration_table(conn)
            for name in missing:
                conn.execute(
                    """
                    INSERT INTO public.schema_migrations (name) VALUES (%s)
                    ON CONFLICT (name) DO NOTHING
                    """,
                    (name,),
                )
                adopted.append(name)
    return adopted


def _validate_migration_indexes(
    conn: Connection[Any], migration_name: str, sql: str
) -> None:
    for index_name in migration_valid_indexes(sql):
        row = conn.execute(
            """
            SELECT index_metadata.indisvalid
            FROM pg_index AS index_metadata
            WHERE index_metadata.indexrelid = to_regclass(%s)
            """,
            (f"public.{index_name}",),
        ).fetchone()
        if row is None or not row[0]:
            raise RuntimeError(
                f"{migration_name} did not create a valid {index_name} index; "
                "drop the invalid index concurrently, then retry"
            )


def plan_migrations(database_url: str, directory: Path = MIGRATIONS_DIR) -> list[str]:
    """Return pending migration names without changing the database."""
    import psycopg

    database_url = validate_migration_database_url(database_url)
    with psycopg.connect(database_url, autocommit=True, prepare_threshold=None) as conn:
        _configure_connection(conn, applying=False)
        already_applied = _recorded_migrations(conn)
    return [
        path.name
        for path in migration_files(directory)
        if path.name not in already_applied
    ]


def apply_migrations(database_url: str, directory: Path = MIGRATIONS_DIR) -> list[str]:
    """Apply pending migrations; returns the names applied, in order."""
    import psycopg

    database_url = validate_migration_database_url(database_url)
    applied: list[str] = []
    # autocommit means each conn.transaction() below is a real transaction
    # (not a savepoint inside one implicit transaction), so migrations commit
    # file by file. The session-scoped advisory lock spans the applied-set
    # read and the whole apply loop; it is released when the connection closes.
    with psycopg.connect(database_url, autocommit=True, prepare_threshold=None) as conn:
        _configure_connection(conn, applying=True)
        _acquire_migration_lock(conn)
        _create_migration_table(conn)
        legacy_table = conn.execute(
            "SELECT to_regclass('public.alerting_schema_migrations')"
        ).fetchone()
        if legacy_table is not None and legacy_table[0] is not None:
            conn.execute(
                """
                INSERT INTO public.schema_migrations (name, applied_at)
                SELECT name, applied_at FROM public.alerting_schema_migrations
                ON CONFLICT (name) DO NOTHING
                """
            )
        rows = conn.execute("SELECT name FROM public.schema_migrations").fetchall()
        already_applied = {name for (name,) in rows}
        for path in migration_files(directory):
            if path.name in already_applied:
                continue
            sql = path.read_text()
            if migration_is_transactional(sql):
                with conn.transaction():
                    conn.execute(sql)
                    conn.execute(
                        "INSERT INTO public.schema_migrations (name) VALUES (%s)",
                        (path.name,),
                    )
            else:
                conn.execute(sql)
                _validate_migration_indexes(conn, path.name, sql)
                conn.execute(
                    "INSERT INTO public.schema_migrations (name) VALUES (%s)",
                    (path.name,),
                )
            applied.append(path.name)
    return applied


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument(
        "--apply",
        action="store_true",
        help="apply pending migrations; the default is a read-only plan",
    )
    actions.add_argument(
        "--adopt-existing-dashboard",
        action="store_true",
        help="verify and record existing dashboard migrations without running them",
    )
    parser.add_argument(
        "--confirm-target",
        metavar="HOST:PORT/DATABASE",
        help="exact target printed by the plan; required with a write operation",
    )
    args = parser.parse_args(argv)
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 1
    try:
        database_url = validate_migration_database_url(database_url)
        target = database_target(database_url)
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 2
    print(f"target {target}")
    if (args.apply or args.adopt_existing_dashboard) and args.confirm_target != target:
        print(
            f"--confirm-target {args.confirm_target!r} does not match {target!r}",
            file=sys.stderr,
        )
        return 2
    if args.adopt_existing_dashboard:
        try:
            adopted = adopt_existing_dashboard(database_url)
        except RuntimeError as error:
            print(f"adoption failed: {error}", file=sys.stderr)
            return 1
        if adopted:
            for name in adopted:
                print(f"adopted {name}")
        else:
            print("dashboard migrations already adopted")
        return 0
    pending = plan_migrations(database_url)
    if not args.apply:
        if pending:
            for name in pending:
                print(f"pending {name}")
        else:
            print("nothing to apply")
        print("plan only; pass --apply with the exact --confirm-target to execute")
        return 0
    if not pending:
        print("nothing to apply")
        return 0
    try:
        applied = apply_migrations(database_url)
    except RuntimeError as error:
        print(f"migration failed: {error}", file=sys.stderr)
        return 1
    if applied:
        for name in applied:
            print(f"applied {name}")
    else:
        print("nothing to apply")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
