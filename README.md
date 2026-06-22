# 金券管理台帳 DDD application layer + PostgreSQL scripts

This project turns the FileMaker 金券管理台帳 rules into explicit PostgreSQL tables, views, triggers, and TypeScript application-layer use cases. Next.js is expected to own both frontend and backend execution; the domain/application code should stay framework-neutral and be called from Next.js server-side code.

## Files

```text
db/migrations/001_schema.sql                -- core master/ledger tables, constraints, triggers
db/migrations/002_seed_legacy_codes.sql     -- inferred legacy code seeds and denominations
db/migrations/003_views.sql                 -- FileMaker calculation/summary replacements
db/migrations/004_legacy_import_staging.sql -- raw legacy import staging table
db/migrations/005_transform_staging_to_ledger.sql -- staging → voucher_ledger_entries
sql/001_voucher_ledger_schema.sql           -- single-file concatenation of 001–004
scripts/migrate/                            -- FileMaker HTML import + migration CLI
filemaker/                                  -- FileMaker DDR XML (schema only, no row data)
filemaker/exports/                          -- place FileMaker HTML exports here before import
src/domain/*                                -- value objects and domain policies
src/application/dto.ts                      -- command/result DTOs
src/application/usecases/*                  -- opening balance, movement, inventory check, 赤伝票 correction
src/application/queries/*                   -- balance/list/detail query use cases
src/application/repositories/*              -- repository port
src/infrastructure/postgres/*               -- pg implementation and UnitOfWork
docs/legacy-api.md                          -- legacy functionality and Next.js boundary notes
```

## FileMaker source files

The XML files under `filemaker/` are **Database Design Reports (DDR)** exported from FileMaker Pro. They document tables, fields, scripts, and layouts but **do not contain row data**.

| File | Contents |
|------|----------|
| `DB金券管理台帳_fmp12.xml` | `T切手出納台帳` ledger (9045 records in production) |
| `金券管理台帳_fmp12.xml` | UI file: `M入出区分`, `M出納区分`, `M赤伝票`, `M拠点L` |
| `各種マスター_fmp12.xml` | `M会社`, `M部門`, `M拠点`, `M社員` (+ `pg_migration` Data API account) |

Field mappings for legacy imports are defined in `scripts/migrate/field-mapping.ts` from these DDR files. FileMaker HTML table exports are required because they carry headers and repeating fields reliably.

## Migration order

### 1. Schema (001–004)

```bash
psql "$DATABASE_URL" -f db/migrations/001_schema.sql
psql "$DATABASE_URL" -f db/migrations/002_seed_legacy_codes.sql
psql "$DATABASE_URL" -f db/migrations/003_views.sql
psql "$DATABASE_URL" -f db/migrations/004_legacy_import_staging.sql
```

Or run the combined script (001–004 only):

```bash
psql "$DATABASE_URL" -f sql/001_voucher_ledger_schema.sql
```

Or via npm (requires `DATABASE_URL`):

```bash
npm install
npm run migrate -- schema
```

### 2. Export from FileMaker

Export tables with **Japanese field names** (matching DDR) to `filemaker/exports/`. FileMaker HTML table exports (`.htm`) are required.

- `M拠点L.htm` from `金券管理台帳.fmp12` (branches used by the ledger)
- `M入出区分.htm`, `M出納区分.htm`, `M_赤伝票.htm` from `金券管理台帳.fmp12`
- `L_M社員.htm` from `各種マスター.fmp12`
- `L_T金券管理台帳.htm` from the ledger export

Known current exports in this repo are:

```text
filemaker/exports/M拠点L.htm
filemaker/exports/M入出区分.htm
filemaker/exports/M出納区分.htm
filemaker/exports/M_赤伝票.htm
filemaker/exports/L_M社員.htm
filemaker/exports/L_T金券管理台帳.htm
```

Alternatively use the FileMaker Data API with the `pg_migration` account in `各種マスター.fmp12`.

### 3. Import masters and ledger

```bash
export DATABASE_URL='postgres://...'

npm run migrate -- import-masters \
  --branches filemaker/exports/M拠点L.htm \
  --entry-types filemaker/exports/M入出区分.htm \
  --transaction-categories filemaker/exports/M出納区分.htm \
  --red-voucher-statuses filemaker/exports/M_赤伝票.htm \
  --employees filemaker/exports/L_M社員.htm

npm run migrate -- import-ledger --file filemaker/exports/L_T金券管理台帳.htm
```

PowerShell example:

```powershell
$env:DATABASE_URL='postgresql://localhost:5432/postgres'
$env:DATABASE_USER='user'
```

Or one shot (after exports are in place):

```bash
npm run migrate -- all \
  --branches filemaker/exports/M拠点L.htm \
  --entry-types filemaker/exports/M入出区分.htm \
  --transaction-categories filemaker/exports/M出納区分.htm \
  --red-voucher-statuses filemaker/exports/M_赤伝票.htm \
  --employees filemaker/exports/L_M社員.htm \
  --ledger filemaker/exports/L_T金券管理台帳.htm
```

### 4. Transform staging → ledger

```bash
npm run migrate -- transform
# or: psql "$DATABASE_URL" -f db/migrations/005_transform_staging_to_ledger.sql
```

Check counts:

```bash
npm run migrate -- status
```

After importing legacy `出納No` values, the transform resets the sequence automatically. To reset manually:

```sql
SELECT setval(
  'voucher_ledger_no_seq',
  COALESCE((SELECT max(ledger_no) FROM voucher_ledger_entries), 0) + 1,
  false
);
```

## Encoded business decisions

Legacy data contains multiple `入出区分CD=99` opening-balance rows for some branch/period combinations. To avoid data loss, the database and application use case do not enforce uniqueness for opening balances. Keep this caveat visible for future product decisions: reintroducing uniqueness would require explicit data cleanup and a business rule that rejects some legacy-compatible rows.

`posted_at` is the immutability boundary. The repository inserts an entry draft, inserts denomination quantities, then posts it. After posting, triggers block financial mutation; correction must be represented by 赤伝票 and optional 訂正伝票.

Running balances are calculated by views, ordered by `ledger_no`, so balance no longer depends on FileMaker found-set or sort state.

Legacy HTML import maps FileMaker fields as follows:

- `元伝票No` → `original_ledger_no`
- `赤伝票No` → `reversal_ledger_no`
- `訂正伝票No` → `correction_ledger_no`
- blank `赤伝票CD` → `red_voucher_status_code = 0`
- `枚数N[1..16]` → `voucher_ledger_entry_denominations` via `denominations.legacy_repetition_no`

Named master data from real exports is imported as active. Generated `Legacy ...` placeholders are inactive and exist only to preserve foreign-key compatibility for legacy rows whose master data was not available.

## Application-layer example

```ts
import { RegisterVoucherMovementUseCase } from './src/application/usecases/RegisterVoucherMovement';
import { unitOfWork } from './src/infrastructure/postgres/singletons';
import { EntryTypeCode } from './src/domain/entryTypes';

const useCase = new RegisterVoucherMovementUseCase(unitOfWork);

await useCase.execute({
  branchCode: 10,
  periodYear: 2026,
  periodMonth: 6,
  processingDate: '2026-06-17',
  entryTypeCode: EntryTypeCode.Outgoing,
  transactionCategoryCode: 9,
  companyCode: 1,
  responsibleEmployeeNo: 1234,
  description: '郵送使用',
  quantities: { 84: 10, 110: 5 },
  otherAmountYen: 0,
  actor: { employeeNo: 1234 },
});
```

## Next.js boundary

Do not build a separate REST API for this project by default. Next.js can call the application layer from server components, server actions, or thin server-only modules.

Recommended server functions:

- `listLedgerEntries(input)` → `ListLedgerEntriesQuery`
- `getLedgerEntry(ledgerNo)` → `GetLedgerEntryQuery`
- `getBranchCurrentBalance(branchCode)` → `GetBranchCurrentBalanceQuery`
- `registerOpeningBalance(input)` → `RegisterOpeningBalanceUseCase`
- `registerVoucherMovement(input)` → `RegisterVoucherMovementUseCase`
- `registerInventoryCheck(input)` → `RegisterInventoryCheckUseCase`
- `issueRedVoucherCorrection(input)` → `IssueRedVoucherCorrectionUseCase`

The ledger table supports sortable columns, per-column filters, numbered pagination, direct page jumping, and CSV export. CSV export is served from `/export/ledger` and uses the current table filters and sort order, exporting all matching rows rather than only the visible page.

tRPC is a reasonable later adapter for interactive client-heavy screens, but routers should remain thin: validate input, call these server/application functions, and map domain errors for UI display. Keep ledger rules in `src/domain` and `src/application`.

## Development

```bash
npm install
npm run typecheck
```

The included TypeScript was type-checked after installing the declared dependencies.

## Docker Deployment

The repository includes a production Next.js container, a PostgreSQL container, and a one-shot migration/import container.

Create a local Docker env file if you want to override defaults:

```bash
cp deploy/.env.docker.example deploy/.env.docker
mkdir -p deploy/.secrets
printf '%s' 'replace-with-a-strong-password' > deploy/.secrets/postgres_password
```

Start PostgreSQL and the application:

```bash
docker compose --env-file deploy/.env.docker -f deploy/docker-compose.yml up -d --build db app
```

Apply schema migrations:

```bash
docker compose --env-file deploy/.env.docker -f deploy/docker-compose.yml --profile tools run --rm migrate schema
```

If FileMaker HTML exports are available under `filemaker/exports`, import and transform them:

```bash
docker compose --env-file deploy/.env.docker -f deploy/docker-compose.yml --profile tools run --rm migrate all \
  --branches filemaker/exports/M拠点L.htm \
  --entry-types filemaker/exports/M入出区分.htm \
  --transaction-categories filemaker/exports/M出納区分.htm \
  --red-voucher-statuses filemaker/exports/M_赤伝票.htm \
  --employees filemaker/exports/L_M社員.htm \
  --ledger filemaker/exports/L_T金券管理台帳.htm
```

Check database counts:

```bash
docker compose --env-file deploy/.env.docker -f deploy/docker-compose.yml --profile tools run --rm migrate status
```

The app is exposed on `http://localhost:${APP_PORT:-3000}`. The Dockerfile intentionally contains no database credentials. PostgreSQL, the app, and the migration container receive the database password through a Docker secret file mounted at runtime.

## Master data

The seed migration includes fallback names for `M入出区分`, `M出納区分`, and `M赤伝票`. Replace those names with exact FileMaker master data exports when available. Load branch, employee, entry-type, transaction-category, and red-voucher master data from the FileMaker exports before application use. Company and department data can be imported when source exports are available; otherwise the transform creates compatibility placeholders only where required.
