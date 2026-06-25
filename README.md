# Voucher Ledger DDD

Next.js + PostgreSQL replacement for the FileMaker `金券管理台帳.fmp12` voucher ledger.

The project migrates FileMaker ledger data and makes the implicit FileMaker business rules explicit in a DDD-oriented TypeScript application layer and PostgreSQL read model.

The web UI supports ledger search/detail, selectable table export, new movement registration, inventory checks, and selected-row red-voucher correction.

## Current Scope

- Next.js owns both frontend and backend execution.
- PostgreSQL stores source-of-truth ledger data, imported master snapshots, and deterministic balance views.
- FileMaker DDR XML files document legacy schema/scripts.
- FileMaker HTML exports under `filemaker/exports/` are the supported migration input.
- CSV import support has been removed; CSV/TSV/HTML are application export formats only.
- A separate REST API is intentionally not part of the current architecture.
- Legacy carry rows (`前葉より繰越`, `次葉へ繰越`) are preserved as history/display rows only; the new app does not actively generate period-close/open carry records.
- Master data is imported from upstream/FileMaker exports for ledger selection and validation; the app does not maintain branches, employees, companies, departments, or code tables directly.

## Structure

```text
src/domain/                         Domain value objects, policies, errors
src/application/usecases/            Posting and correction use cases
src/application/queries/             Ledger/balance query use cases
src/application/repositories/        Repository ports
src/infrastructure/postgres/         PostgreSQL repository/unit-of-work adapter
src/server/ledger.ts                 Thin Next.js server boundary and caching
src/app/                             Next.js UI, server actions, table export route
db/migrations/                       PostgreSQL schema, views, staging, transforms
scripts/migrate/                     HTML import and migration CLI
filemaker/                           FileMaker DDR XML and HTML exports
deploy/                              Dockerfile, compose file, env placeholders
docs/legacy-api.md                   Legacy/DDD/migration assessment
```

## Local Startup

Install dependencies:

```bash
npm install
```

Set database environment variables. PowerShell example:

```powershell
$env:DATABASE_URL='postgresql://localhost:5432/postgres'
$env:DATABASE_USER='user'
```

Run migrations:

```bash
npm run migrate -- schema
```

Import FileMaker HTML exports and transform staging data:

```powershell
npm run migrate -- all `
  --branches filemaker/exports/M拠点L.htm `
  --entry-types filemaker/exports/M入出区分.htm `
  --transaction-categories filemaker/exports/M出納区分.htm `
  --red-voucher-statuses filemaker/exports/M_赤伝票.htm `
  --employees filemaker/exports/L_M社員.htm `
  --ledger filemaker/exports/L_T金券管理台帳.htm
```

Start development server:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Checks

```bash
npm test
npm run typecheck
npm run build
npm run migrate -- status
```

`npm run migrate -- status` reports imported row counts, FileMaker running-balance reconciliation counts, and the latest legacy-import audit events. After importing an export that includes `残高合計`, `legacy_running_balance_reconciliation.mismatches` should be `0` before cutover.
The reconciliation view intentionally mirrors FileMaker's historical running-total order (`連番`, `出納No`) and includes deleted legacy rows; application running-balance views keep the business-date order used by the new ledger.
`legacy_import_audit_log` should only grow when migration SQL uses the legacy-import bypass; the latest events should be expected transform operations before cutover.

`npm test` runs the fast TypeScript test gate for denomination mapping, balance arithmetic, and red-voucher correction use-case invariants.

PostgreSQL-backed read-model, trigger, and SQL/domain drift checks require an explicit test database URL:

```powershell
$env:VOUCHER_LEDGER_TEST_DATABASE_URL='postgresql://voucher:pass@localhost:5432/test'
npm run test:postgres
```

The Postgres test command creates and drops an isolated schema inside the configured database. It refuses to run unless the database name contains `test`, unless `ALLOW_NON_TEST_DATABASE=1` is set.

PostgreSQL connections are bound to one database for their lifetime. To test against a different database, set `VOUCHER_LEDGER_TEST_DATABASE_URL` to that database before running `npm run test:postgres`; the test can switch schemas inside the selected database, but it cannot switch databases on an already-open connection.

## Docker Deployment

Create a Docker env file and password secret:

```bash
cp deploy/.env.docker.example deploy/.env.docker
mkdir -p deploy/.secrets
printf '%s' 'replace-with-a-strong-password' > deploy/.secrets/postgres_password
```

Start PostgreSQL and the app:

```bash
npm run docker:up
```

Apply schema:

```bash
npm run docker:schema
```

`migrate schema` is safe to re-run against an existing migration database; it adds missing compatibility columns before recreating views and indexes.
If PostgreSQL logs `column "processing_date" does not exist` after updating the code, rerun `migrate schema` and rebuild/restart the app container so both the database views and application queries are current.

Import and transform FileMaker HTML exports from `filemaker/exports/`:

```bash
npm run docker:import
```

The app is exposed at `http://localhost:${APP_PORT:-3000}`.

The Dockerfile contains no credentials. Database credentials are supplied through `deploy/.env.docker` and a Docker secret file referenced by `POSTGRES_PASSWORD_FILE`.

## Production Backup, Restore, And Rollback

Treat database migrations and FileMaker import/transform runs as forward-only operations. Rollback is restore-from-backup, not a down migration.

Before any production deploy, schema migration, import, or cutover:

1. Confirm the current app is healthy.

```bash
npm run ops:status
```

2. Create a timestamped PostgreSQL custom-format backup outside the repository.

```bash
npm run ops:backup
```

3. Verify that the backup can be read before continuing.

```bash
npm run ops:verify-backup -- ../voucher-ledger-backups/voucher_ledger_YYYYMMDD_HHMMSS.dump
```

Keep backups outside the repo and outside the Docker named volume. Store a copy in the production backup location with restricted access; the dump contains ledger and employee reference data.

Restore procedure for a failed migration/import/deploy:

1. Stop the app so users cannot write while the database is being restored.

```bash
docker compose --env-file deploy/.env.docker -f deploy/docker-compose.yml stop app
```

2. Take a last-chance dump of the broken state for investigation.

```bash
npm run ops:failed-backup
```

3. Recreate the application database and restore the known-good dump.

```bash
CONFIRM_RESTORE=voucher-ledger npm run ops:restore -- ../voucher-ledger-backups/voucher_ledger_YYYYMMDD_HHMMSS.dump
```

PowerShell equivalent:

```powershell
$env:CONFIRM_RESTORE='voucher-ledger'
npm run ops:restore -- ../voucher-ledger-backups/voucher_ledger_YYYYMMDD_HHMMSS.dump
Remove-Item Env:\CONFIRM_RESTORE
```

4. Confirm the `ops:restore` status output before reopening user access.

App rollback procedure:

1. Stop the app container.
2. Check out or deploy the previously known-good Git commit/image.
3. Rebuild and start only the app service.
4. If the failed deploy already changed schema or data, restore the database backup from before that deploy before starting the old app.

```bash
docker compose --env-file deploy/.env.docker -f deploy/docker-compose.yml stop app
git checkout <known-good-commit>
docker compose --env-file deploy/.env.docker -f deploy/docker-compose.yml up -d --build app
```

Convenience scripts:

- `npm run docker:up`: build and start PostgreSQL plus the app.
- `npm run docker:down`: stop and remove the Docker Compose services.
- `npm run docker:schema`: run schema migrations through the tools profile.
- `npm run docker:import`: import the standard FileMaker HTML export set and transform it.
- `npm run ops:status`: show Compose status and migration status.
- `npm run ops:backup`: write and verify a timestamped backup under `../voucher-ledger-backups`.
- `npm run ops:failed-backup`: write and verify a failed-state investigation backup.
- `npm run ops:verify-backup -- <dump>`: verify an existing backup archive.
- `CONFIRM_RESTORE=voucher-ledger npm run ops:restore -- <dump>`: stop the app, recreate the database, restore the backup, start the app, and run status. In PowerShell, set `$env:CONFIRM_RESTORE='voucher-ledger'` before running the command.

Cutover checklist:

- backup created and `pg_restore --list` succeeds;
- `migrate status` reports expected row counts and `legacy_running_balance_reconciliation.mismatches: 0`;
- latest `legacy_import_audit_log` entries are expected migration operations only;
- the exact Git commit and backup filename are recorded in the release note;
- restore procedure has been tested at least once in a non-production environment.

## Design Notes

Normal application database connections force `voucher_ledger.legacy_import` off when connections are opened and again at transaction start. The legacy-import bypass is reserved for migration SQL that explicitly uses `SET LOCAL voucher_ledger.legacy_import = 'on'`.

The main documentation is [docs/state.md](docs/state.md). It covers:

- Current project assessment against the FileMaker replacement issue.
- FileMaker source system and migration inputs.
- DDD abstractions and bounded-context decisions.
- Business rules found in FileMaker calculations/scripts.
- Current DB, application, and Next.js structure.
- Known gaps and follow-up decisions.
