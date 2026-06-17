# 金券管理台帳 DDD application layer + PostgreSQL scripts

This bundle turns the FileMaker 金券管理台帳 rules into explicit PostgreSQL tables, views, triggers, and TypeScript application-layer use cases.

## Files

```text
db/migrations/001_schema.sql                -- core master/ledger tables, constraints, triggers
db/migrations/002_seed_legacy_codes.sql     -- inferred legacy code seeds and denominations
db/migrations/003_views.sql                 -- FileMaker calculation/summary replacements
db/migrations/004_legacy_import_staging.sql -- optional raw import staging table
db/migrations/005_transform_staging_to_ledger.sql -- staging → voucher_ledger_entries
sql/001_voucher_ledger_schema.sql           -- single-file concatenation of 001–004
scripts/migrate/                            -- CSV import + migration CLI
filemaker/                                  -- FileMaker DDR XML (schema only, no row data)
filemaker/exports/                          -- place CSV exports here before import
src/domain/*                                -- value objects and domain policies
src/application/dto.ts                      -- command/result DTOs
src/application/usecases/*                  -- opening balance, movement, inventory check, 赤伝票 correction
src/application/queries/*                   -- balance query use case
src/application/repositories/*              -- repository port
src/infrastructure/postgres/*               -- pg implementation and UnitOfWork
```

## FileMaker source files

The XML files under `filemaker/` are **Database Design Reports (DDR)** exported from FileMaker Pro. They document tables, fields, scripts, and layouts but **do not contain row data**.

| File | Contents |
|------|----------|
| `DB金券管理台帳_fmp12.xml` | `T切手出納台帳` ledger (9045 records in production) |
| `金券管理台帳_fmp12.xml` | UI file: `M入出区分`, `M出納区分`, `M赤伝票`, `M拠点L` |
| `各種マスター_fmp12.xml` | `M会社`, `M部門`, `M拠点`, `M社員` (+ `pg_migration` Data API account) |

Field mappings for CSV import are defined in `scripts/migrate/field-mapping.ts` from these DDR files.

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

### 2. Export CSV from FileMaker

Export tables with **Japanese field names** (matching DDR) to `filemaker/exports/`:

- `M拠点L.csv` from `金券管理台帳.fmp12` (branches used by the ledger)
- `M会社.csv`, `M部門.csv`, `M社員.csv` from `各種マスター.fmp12`
- `T切手出納台帳.csv` from `DB金券管理台帳.fmp12` (include repeating field `枚数N[1]`…`枚数N[16]`)

Alternatively use the FileMaker Data API with the `pg_migration` account in `各種マスター.fmp12`.

### 3. Import masters and ledger

```bash
export DATABASE_URL='postgres://...'

npm run migrate -- import-masters \
  --branches filemaker/exports/M拠点L.csv \
  --companies filemaker/exports/M会社.csv \
  --departments filemaker/exports/M部門.csv \
  --employees filemaker/exports/M社員.csv

npm run migrate -- import-ledger --file filemaker/exports/T切手出納台帳.csv
```

Or one shot (after CSVs are in place):

```bash
npm run migrate -- all \
  --branches filemaker/exports/M拠点L.csv \
  --companies filemaker/exports/M会社.csv \
  --departments filemaker/exports/M部門.csv \
  --employees filemaker/exports/M社員.csv \
  --ledger filemaker/exports/T切手出納台帳.csv
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

The schema keeps one posted `入出区分CD=99` opening balance per branch because FileMaker `Get繰越データ件数` checks only `拠点CD + 入出区分CD=99`. If the new business wants monthly opening balances, replace index `uq_voucher_opening_balance_per_branch` with a partial unique index on `(branch_code, period_year, period_month)`.

`posted_at` is the immutability boundary. The repository inserts an entry draft, inserts denomination quantities, then posts it. After posting, triggers block financial mutation; correction must be represented by 赤伝票 and optional 訂正伝票.

Running balances are calculated by views, ordered by `ledger_no`, so balance no longer depends on FileMaker found-set or sort state.

Legacy import maps FileMaker fields as follows:

- `元伝票No` → `original_ledger_no`
- `赤伝票No` → `reversal_ledger_no`
- `訂正伝票No` → `correction_ledger_no`
- blank `赤伝票CD` → `red_voucher_status_code = 0`
- `枚数N[1..16]` → `voucher_ledger_entry_denominations` via `denominations.legacy_repetition_no`

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

## Development

```bash
npm install
npm run typecheck
```

The included TypeScript was type-checked after installing the declared dependencies.

## Master data

The seed migration includes inferred names for `M入出区分`, `M出納区分`, and `M赤伝票`. Replace those names with exact FileMaker master data exports when available. Load `branches`, `companies`, `departments`, and `employees` from `各種マスター.fmp12` / `M拠点L` exports before application use.
