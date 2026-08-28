---
status: accepted
---

# Centralize database migrations in Python

All Postgres table definitions and data migrations live in one repository-level Python migration module. Alert Production and CI Dashboard retain ownership of their domain records, while the shared module supplies one ordered deployment interface; Next.js request handlers no longer create or alter schema, and the previous one-off JavaScript migration scripts are retired.
