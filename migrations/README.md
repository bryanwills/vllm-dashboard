# Database migrations

This module is the single interface for applying every Postgres schema and data
migration used by the vLLM CI dashboard repository. SQL files are immutable,
ordered, and applied once under a Postgres advisory lock. Migrations run in
their own transactions unless they begin with `-- migrate: no-transaction`;
that form is reserved for idempotent operations such as concurrent indexes.

The runner records applied files in `schema_migrations`. On its first run, it
adopts entries from the legacy `alerting_schema_migrations` table so the moved
Alert Production migrations are not replayed unnecessarily.

Run migrations against the direct Supabase connection before deploying code
that depends on them. Do not use the transaction-mode pooler for DDL. The
default command is read-only: it prints the credential-free database target and
pending files without creating the migration ledger or changing schema.

Copy either **Direct connection** or **Session pooler** from the Supabase
Dashboard's **Connect** dialog; both use port `5432`. Do not reuse an application
URL containing `supa=...` or `pgbouncer=...`, or transaction pooler port `6543`.

```bash
DATABASE_URL=postgres://... uv run vllm-dashboard-migrate
```

Review that plan, then copy its exact target into the explicit apply command:

```bash
DATABASE_URL=postgres://... uv run vllm-dashboard-migrate \
  --apply --confirm-target db.example.supabase.co:5432/postgres
```

For a production database that already contains the dashboard tables but has no
`schema_migrations` ledger, adopt migrations `0005` through `0008` first:

```bash
DATABASE_URL=postgres://... uv run vllm-dashboard-migrate \
  --adopt-existing-dashboard \
  --confirm-target aws-1-us-east-1.pooler.supabase.com:5432/postgres
```

Adoption verifies required columns, valid indexes, and GPU rollup time coverage.
It then writes only four ledger rows; it does not run those migration files or
change existing dashboard tables. Rerun the read-only plan afterward. It should
list only `0001` through `0004` and `0009` before the first alerting deployment.

The runner refuses a mismatched target, refuses concurrent migration runs, and
uses a five-second lock timeout plus a fifteen-minute statement timeout. A
timeout fails the current migration instead of waiting indefinitely; rerun the
plan before retrying.

Migration `0007_gpu_rollups.sql` briefly pauses GPU report writes when applied to
a new or incomplete database. Production databases with a verified existing
rollup should adopt it instead. Migration `0009_secure_supabase_api_access.sql`
enables RLS and removes `anon` and `authenticated` access only for the new
alerting tables and migration ledger. It leaves existing dashboard tables
unchanged.

From the repository root, the equivalent command is:

```bash
DATABASE_URL=postgres://... npm run migrate
DATABASE_URL=postgres://... npm run migrate -- \
  --adopt-existing-dashboard \
  --confirm-target aws-1-us-east-1.pooler.supabase.com:5432/postgres
DATABASE_URL=postgres://... npm run migrate -- \
  --apply --confirm-target db.example.supabase.co:5432/postgres
```

## Development

```bash
uv sync --extra dev
uv run pytest
uv run mypy __init__.py runner.py tests
uv run ruff check .
```
