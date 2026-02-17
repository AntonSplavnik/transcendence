# Migration Workflow

This folder contains Diesel migrations for the backend SQLite database.

## Rule for this project

When you change migrations (`up.sql` or `down.sql`), you must run:

```sh
backend/scripts/run_migrations_update_schema.sh
```

This is the project-standard command for:

1. applying migration changes to the local database,
2. regenerating `backend/src/schema.rs`,
3. regenerating `backend/src/schema.patch` (timestamp mapping patch).

Do not manually edit `backend/src/schema.rs` and expect it to persist. It is generated.

## Typical flow

1. Create or edit migration files in this directory.
2. Run `backend/scripts/run_migrations_update_schema.sh`.
3. Review changes in:
   - `backend/src/schema.rs`
   - `backend/src/schema.patch`
4. Commit migration files together with schema/patch updates.

## If migration commands fail

The script includes recovery logic (revert/run, reset, retry once). If it still
fails, fix the migration SQL first, then rerun the script.
