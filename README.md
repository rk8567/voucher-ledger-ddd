# Voucher Ledger DDD

Next.js + PostgreSQL replacement for the FileMaker `金券管理台帳.fmp12` voucher ledger.

The project migrates FileMaker ledger data and makes the implicit FileMaker business rules explicit in a DDD-oriented TypeScript application layer and PostgreSQL read model.

## Current Scope

- Next.js owns both frontend and backend execution.
- PostgreSQL stores source-of-truth ledger/master data and deterministic balance views.
- FileMaker DDR XML files document legacy schema/scripts.
- FileMaker HTML exports under `filemaker/exports/` are the supported migration input.
- CSV import support has been removed; CSV is only an application export format.
- A separate REST API is intentionally not part of the current architecture.

## Structure

```text
src/domain/                         Domain value objects, policies, errors
src/application/usecases/            Posting and correction use cases
src/application/queries/             Ledger/balance query use cases
src/application/repositories/        Repository ports
src/infrastructure/postgres/         PostgreSQL repository/unit-of-work adapter
src/server/ledger.ts                 Thin Next.js server boundary and caching
src/app/                             Next.js UI, server actions, CSV export route
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

`npm test` runs the fast domain test gate for denomination mapping and balance arithmetic.

PostgreSQL-backed read-model and trigger checks require an explicit test database URL:

```powershell
$env:VOUCHER_LEDGER_TEST_DATABASE_URL='postgresql://localhost:5432/voucher_ledger_test'
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
docker compose --env-file deploy/.env.docker -f deploy/docker-compose.yml up -d --build db app
```

Apply schema:

```bash
docker compose --env-file deploy/.env.docker -f deploy/docker-compose.yml --profile tools run --rm migrate schema
```

Import and transform FileMaker HTML exports from `filemaker/exports/`:

```bash
docker compose --env-file deploy/.env.docker -f deploy/docker-compose.yml --profile tools run --rm migrate all \
  --branches filemaker/exports/M拠点L.htm \
  --entry-types filemaker/exports/M入出区分.htm \
  --transaction-categories filemaker/exports/M出納区分.htm \
  --red-voucher-statuses filemaker/exports/M_赤伝票.htm \
  --employees filemaker/exports/L_M社員.htm \
  --ledger filemaker/exports/L_T金券管理台帳.htm
```

The app is exposed at `http://localhost:${APP_PORT:-3000}`.

The Dockerfile contains no credentials. Database credentials are supplied through `deploy/.env.docker` and a Docker secret file referenced by `POSTGRES_PASSWORD_FILE`.

## Design Notes

The main documentation is [docs/state.md](docs/state.md). It covers:

- Current project assessment against the FileMaker replacement issue.
- FileMaker source system and migration inputs.
- DDD abstractions and bounded-context decisions.
- Business rules found in FileMaker calculations/scripts.
- Current DB, application, and Next.js structure.
- Known gaps and follow-up decisions.
