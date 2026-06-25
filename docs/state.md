# 金券管理台帳 Migration And DDD Assessment

## Issue Summary

The project replaces the FileMaker `金券管理台帳.fmp12` application with a Next.js + PostgreSQL application.

The migration goal is not only to move data. FileMaker calculations, scripts, layouts, repeating fields, and found-set summaries contain implicit business rules for voucher balances, inventory checks, and correction handling. The new implementation uses a DDD-oriented structure so those rules become explicit and testable in code and database constraints.

## Current State Assessment

The repository is aligned with the issue direction, with several parts already implemented:

- **Previous system analysis**: FileMaker DDR XML files are kept under `filemaker/` and documented as the source for tables, fields, scripts, layouts, calculations, and relationships.
- **Migration path**: FileMaker HTML table exports under `filemaker/exports/` are the supported import format. CSV import support has been removed.
- **Core schema**: PostgreSQL migrations define master tables, ledger entries, normalized denomination rows, staging tables, deterministic balance views, and import transform logic.
- **Domain model**: `src/domain` contains explicit balance/value rules, denomination rules, entry type semantics, domain errors, and posting policy.
- **Application layer**: `src/application/usecases` contains posting use cases for opening balance, normal voucher movement, inventory check, and red-voucher correction.
- **Infrastructure boundary**: repository ports live under `src/application/repositories`; PostgreSQL implementations live under `src/infrastructure/postgres`.
- **Next.js boundary**: `src/server/ledger.ts`, server actions, and app routes call the application/database layer without a separate REST API.
- **Current UI**: ledger list/detail, sortable/filterable columns, pagination, selectable CSV/TSV/HTML export, new record, inventory-check, and red-voucher correction popups are implemented.
- **Deployment**: Docker app/db/migration services are under `deploy/`, using env placeholders and Docker secrets for credentials.
- **Remediation status**: initial P0 hardening has been committed: non-negative normal-write database rules, fail-fast ledger import validation, FileMaker total reconciliation during import, domain/SQL balance tests, PostgreSQL trigger/read-model tests, and separate FileMaker-compatible reconciliation.

The main remaining gaps are:

- No active P0/P1 remediation item is open in this document.

## Previous FileMaker System

### Source Files

| File | Role |
| --- | --- |
| `filemaker/DB金券管理台帳_fmp12.xml` | Ledger data file DDR; includes `T切手出納台帳` / production ledger table metadata. |
| `filemaker/金券管理台帳_fmp12.xml` | Main UI/workflow DDR; includes layouts, scripts, and local masters such as entry/category/red-voucher codes. |
| `filemaker/各種マスター_fmp12.xml` | Organization master DDR; includes employees, companies, departments, and branches. |
| `filemaker/金券管理台帳.xml` | Summary DDR with object counts/layout information. |

DDR XML files document structure and behavior but do not contain row data. Row data comes from FileMaker HTML table exports.

### Legacy Core Concepts

The FileMaker application revolves around a ledger table:

- `T切手出納台帳` / `T金券管理台帳`: voucher ledger record.
- `出納No`: ledger identity and current deterministic ordering key.
- `拠点CD`, `部門CD`, `会社CD`, `担当`: ownership/classification.
- `処理日`, `申請処理日`, `年`, `月`, `連番`: period and date structure.
- `入出区分CD`: movement kind and posting direction.
- `出納区分CD`, `入出拠点CD`: transaction classification and counterparty branch.
- `枚数N[1..16]`: repeating field containing denomination quantities.
- `その他金額`: non-stamp amount included in total balance.
- `赤伝票CD`, `元伝票No`, `赤伝票No`, `訂正伝票No`: correction linkage.
- `推定残*`, `残高合計`, `差異`: FileMaker calculations/summaries that are now explicit SQL read models.

### Denomination Repetition Mapping

FileMaker stores voucher quantities in a 16-repetition field. The current migration maps repetitions to denominations in this order:

```text
1, 2, 10, 50, 84, 94, 120, 140, 210, 5, 20, 52, 110, 270, 430, 600
```

PostgreSQL normalizes this into `voucher_ledger_entry_denominations`.

## Migration

### Supported Input

The current migration supports FileMaker HTML table exports. HTML is preferred because exported tables carry headers and repeating fields more reliably than the historical CSV export.

Expected files:

```text
filemaker/exports/M拠点L.htm
filemaker/exports/M入出区分.htm
filemaker/exports/M出納区分.htm
filemaker/exports/M_赤伝票.htm
filemaker/exports/L_M社員.htm
filemaker/exports/L_T金券管理台帳.htm
```

### Migration Flow

1. Apply schema and views: migrations `001` through `006`.
2. Import master HTML exports.
3. Import ledger HTML export into staging.
4. Transform staging rows into normalized ledger entries and denomination rows.
5. Reset the ledger sequence after legacy `出納No` import.
6. Verify with `npm run migrate -- status`.

The CLI lives under `scripts/migrate/` and is invoked through:

```bash
npm run migrate -- schema
npm run migrate -- all ...
npm run migrate -- status
```

Ledger import now fails instead of silently skipping rows when required source fields are missing (`出納No`, `拠点CD`, `処理日`, `入出区分CD`). When the export includes `切手金額合計` or `金額合計`, the importer recomputes totals from `枚数N[1..16]` and `その他金額` and aborts on mismatch. The importer also preserves FileMaker `残高合計` in staging for golden-master comparison against PostgreSQL running totals.

The 2026-06-24 local reconciliation run against `postgresql://voucher:pass@localhost:5432/test` completed import and transform for `filemaker/exports/L_T金券管理台帳.htm` after preserving legacy numeric quirks (`20.`, `￥25`, `1808;`) and skipping summary-only placeholder rows that have no posting fields. The first run exposed `9016` mismatches out of `9045` rows because the application running-balance view intentionally orders by business date and excludes deleted rows, while FileMaker `残高合計` uses legacy `連番, 出納No` order and includes deleted legacy rows in the historical total. The reconciliation view now uses the FileMaker-compatible order for golden-master comparison only. Result after reapplying schema on 2026-06-24: `9045` rows compared, `0` mismatches.

### Data Compatibility Decisions

- Opening balance uniqueness is **not enforced**. Legacy data contains multiple `入出区分CD=99` rows for some branch/period combinations. Enforcing uniqueness now would lose or reject legacy-compatible data.
- Multiple opening-balance rows are additive in the application running-balance view. No single row is selected as the seed.
- Carry rows (`前葉より繰越`, `次葉へ繰越`) are preserved legacy display/history rows with zero running-balance delta. They are not actively generated by the new application and do not seed or close the period while the application view computes continuously over posted history.
- Missing master rows may be created as inactive `Legacy ...` compatibility placeholders during transform. Named records imported from FileMaker are active.
- Master data ownership remains outside this bounded context. Branches, employees, companies, departments, and local code tables are imported/read for ledger workflows; this app does not provide master-maintenance screens.
- Blank or inferred red-voucher state is normalized to `red_voucher_status_code = 0` unless links imply correction state.
- The application running-balance view keeps deterministic business semantics (`処理日`, `連番`, `出納No`, excluding deleted rows). The FileMaker reconciliation view separately mirrors legacy `残高合計` semantics (`連番`, `出納No`, including deleted rows) so migration cutover checks can match the exported source without weakening application behavior.

## DDD Perspective

![layering.svg](layering.svg)

### Bounded Context

The current bounded context is **Voucher Ledger Management**.

It owns:

- ledger posting;
- denomination quantities;
- balance calculation semantics;
- inventory-check discrepancy calculation;
- red-voucher correction links;
- imported branch/employee/company/department references needed by ledger workflows.

It does not currently own full HR/organization master maintenance. Those records are treated as imported reference data unless a future admin requirement changes the boundary.

### Aggregate And Entity Model

The effective aggregate is a posted voucher ledger entry:

- Aggregate root: `voucher_ledger_entries`.
- Child rows: `voucher_ledger_entry_denominations`.
- Optional child rows: `voucher_ledger_entry_attachments`.
- Identity: `ledger_no` for business identity, `id` UUID for database identity.
- Invariant boundary: `posted_at`.

The database allows creating a draft row, replacing quantities, then posting it. After `posted_at` is set, financial mutation is blocked by triggers; correction must happen through red-voucher rows.

### Value Objects And Domain Concepts

| Concept | Current implementation |
| --- | --- |
| Balance | `src/domain/balance.ts`; quantities, other amount, stamp amount, total amount, difference calculation. |
| Denominations | `src/domain/denominations.ts`; valid denominations, normalization, quantity validation, amount calculation. |
| Entry type semantics | `src/domain/entryTypes.ts`; incoming/outgoing/check/opening/carry meanings and reverse movement mapping. |
| Posting policy | `src/domain/ledgerPolicies.ts`; description required, value required, counterparty branch rules. |
| Domain errors | `src/domain/errors.ts`; stable error codes for UI/server mapping. |

### Application Use Cases

| Use case | Role |
| --- | --- |
| `RegisterOpeningBalanceUseCase` | Posts opening-balance rows while preserving legacy duplicate compatibility. |
| `RegisterVoucherMovementUseCase` | Posts incoming/outgoing voucher movement. |
| `RegisterInventoryCheckUseCase` | Posts actual balance check rows and returns discrepancy results. |
| `IssueRedVoucherCorrectionUseCase` | Posts reversal row and optional corrected replacement row. |

These use cases coordinate repositories and transactions. They should remain framework-neutral.

### Repository And Unit Of Work

The application depends on ports:

- `src/application/repositories/VoucherLedgerRepository.ts`
- `src/application/db/UnitOfWork.ts`

PostgreSQL adapters implement those ports:

- `PgVoucherLedgerRepository`
- `PgUnitOfWork`
- `singletons.ts`

This keeps domain/application code independent from Next.js and `pg`.

## Business Rule Search And Current Implementation

The business rules were found mainly in FileMaker DDR calculations and scripts, then mapped into domain code, SQL views, triggers, and application use cases.

### Balance Rules

FileMaker calculations:

- `枚数合計`
- `切手金額合計`
- `金額合計`
- `補充枚数N`
- `使用枚数N`
- `推定残*`
- `残高合計`

Current implementation:

- `Balance` and denomination helpers compute entry-level amounts.
- SQL views in `003_views.sql` compute entry totals, deltas, running denomination balances, running other amount, and running total.
- Running balance order is deterministic by `processing_date`, `daily_sequence`, then `ledger_no`, not FileMaker found-set/sort state.
- `tests/domain.test.ts` locks the FileMaker denomination mapping and basic balance arithmetic.
- `tests/domain.test.ts` also locks legacy carry rows as zero-effect, non-postable history rows.
- `tests/postgres-read-model.test.mjs` includes SQL/domain drift guards for entry total arithmetic, representative running-balance totals, and red-voucher correction running-total cancellation/replacement.
- PostgreSQL tests also cover red-voucher status/link integrity and orphan-link rejection.

### Entry Type Rules

Current semantics:

| Code | Meaning | Current effect |
| --- | --- | --- |
| `1` | 前葉より繰越 | legacy carry row, non-posting/carry behavior. |
| `2` | 入金/購入 | incoming movement. |
| `3` | 出金/使用 | outgoing movement. |
| `4` | 過不足入金 | incoming adjustment. |
| `5` | 過不足出金 | outgoing adjustment. |
| `6` | 現在高チェック | actual balance check; discrepancy read model. |
| `9` | 次葉へ繰越 | legacy carry row, non-posting/carry behavior. |
| `99` | 開始時残高 | opening balance. |

Current implementation:

- `entryTypes.ts` defines code semantics.
- `ledgerPolicies.ts` validates postable types and required value/description.
- SQL views use entry type direction to derive running deltas.

### Inventory Check

Legacy behavior:

- `入出区分CD=6` stores actual counted quantities and amount.
- FileMaker compares actual values against expected running balance and shows `差異`.

Current implementation:

- `RegisterInventoryCheckUseCase` posts the check row.
- `voucher_inventory_check_results` and `voucher_inventory_check_denomination_results` compute discrepancies.

### Red Voucher Correction

Legacy behavior:

- Original row is marked.
- Red-voucher reversal row is created.
- Optional corrected row is linked.

Current implementation:

- `IssueRedVoucherCorrectionUseCase`.
- `original_ledger_no`, `reversal_ledger_no`, `correction_ledger_no`.
- `red_voucher_status_code`: normal/original/red/corrected.
- `posted_at` immutability forces correction instead of mutation.

### Posting And Audit Rules

Current implementation:

- `posted_at` is the financial immutability boundary.
- Triggers prevent posted financial/denomination mutation outside legacy import mode.
- `registered_*`, `updated_*`, and FileMaker login metadata are preserved/imported.
- Next.js server actions invalidate cached ledger data after writes.

## Database Structure

### Source-Of-Truth Tables

- `branches`
- `companies`
- `departments`
- `employees`
- `entry_types`
- `transaction_categories`
- `red_voucher_statuses`
- `denominations`
- `voucher_ledger_entries`
- `voucher_ledger_entry_denominations`
- `voucher_ledger_entry_attachments`

### Import/Staging

- `legacy_filemaker_voucher_ledger_staging`

### Views / Read Models

- `voucher_ledger_entry_totals`
- `voucher_ledger_entry_denomination_deltas`
- `voucher_ledger_entry_other_amount_deltas`
- `voucher_ledger_running_denominations`
- `voucher_ledger_running_other_amounts`
- `voucher_ledger_running_amounts`
- `voucher_inventory_check_results`
- `voucher_inventory_check_denomination_results`
- `legacy_filemaker_running_balance_reconciliation`
- `legacy_import_audit_log`

### Schema Rules

- Master FK validation is enforced at insert/update.
- `other_amount` and denomination `quantity` are constrained to non-negative values at the database layer.
- Posted ledger financial fields are immutable.
- Denomination rows of posted entries are immutable.
- Legacy import mode can bypass selected mutation/update rules to preserve source data in migration SQL. Transform runs write audit rows to `legacy_import_audit_log`; normal unit-of-work connections await `voucher_ledger.legacy_import = off` before use and transactions also set it locally.
- Ledger number sequence is reset automatically by the transform after importing legacy `出納No` values.
- `npm run migrate -- status` reports FileMaker `残高合計` reconciliation row counts, mismatch counts, and the latest `legacy_import_audit_log` events for migration bypass review.

## Application Structure

### Next.js Boundary

The project intentionally avoids a separate REST API. Next.js calls the application/database layer from:

- server components;
- server actions;
- server-only modules;
- app route for table export.

Important files:

- `src/server/ledger.ts`: dashboard queries, cached reads, form option reads, export query.
- `src/app/actions.ts`: form submissions for movement and inventory check.
- `src/app/export/ledger/route.ts`: CSV/TSV/HTML table export.
- `src/app/page.tsx`: main ledger page.
- `src/app/LedgerTable.tsx`: table UI, filters, sorting, command toolbar, and export window.
- `src/app/ledgerColumns.ts`: shared table/export column metadata.
- `src/app/ledgerSearchParams.ts`: shared ledger search/export query parsing.
- `src/app/ledgerExportFormat.ts`: shared CSV/HTML export formatting helpers.
- `src/app/EntryActionModals.tsx`: new record and inventory-check popups.

### Current UI Behavior

Implemented:

- ledger table with sortable columns;
- per-column filter popups;
- deleted legacy-row visibility switch;
- column selection;
- pagination and page jump;
- selectable CSV/TSV/HTML export using current filters/sort and chosen columns;
- new movement registration;
- inventory-check registration;
- selected-entry red-voucher correction registration;
- detail panel showing all selected ledger fields;
- Docker-ready app startup.

Not yet complete:

- no active P0/P1 remediation item is open in this document.

## Deployment And Startup

Local development:

```bash
npm install
$env:DATABASE_URL='postgresql://localhost:5432/postgres'
$env:DATABASE_USER='user'
npm run migrate -- schema
npm run migrate -- all ...
npm run dev
```

Docker:

```bash
cp deploy/.env.docker.example deploy/.env.docker
mkdir -p deploy/.secrets
printf '%s' 'replace-with-a-strong-password' > deploy/.secrets/postgres_password
docker compose --env-file deploy/.env.docker -f deploy/docker-compose.yml up -d --build db app
docker compose --env-file deploy/.env.docker -f deploy/docker-compose.yml --profile tools run --rm migrate schema
docker compose --env-file deploy/.env.docker -f deploy/docker-compose.yml --profile tools run --rm migrate all ...
```

The app listens on `APP_PORT` from `deploy/.env.docker` and uses Docker secrets for the database password.

Production backup, restore, and rollback operations are documented in `README.md`. Database migrations and imports are treated as forward-only; rollback is restore-from-backup plus app image/Git commit rollback when needed.

## Architecture Decisions

- Keep domain and application code independent from Next.js.
- Keep database import as CLI/admin operation, not user-facing workflow.
- Keep master data as imported/read-only workflow data owned by upstream systems.
- Keep CSV as export only.
- Keep REST API out of scope unless an external integration appears.
- Use tRPC only later if client-heavy interaction needs typed query/mutation hooks.
- Treat generated legacy placeholders as compatibility data, not active master truth.

## Follow-Up Work

- Add new domain/SQL drift guards only when a new money-path scenario is implemented.

Skipped for now:

- FileMaker `画像` attachment/container migration. The optional `voucher_ledger_entry_attachments` table remains in the schema, but import/display work is intentionally deferred unless image data becomes a cutover requirement.
