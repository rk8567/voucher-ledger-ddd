# Legacy Voucher Ledger Functionality And Next.js Notes

This document summarizes the FileMaker DDR XML files under `filemaker/`, the legacy behavior visible from those reports, and the Next.js application boundary that should be implemented around the current TypeScript application layer.

## Source Files Reviewed

| File | Role | Relevant objects |
| --- | --- | --- |
| `filemaker/DB金券管理台帳_fmp12.xml` | Legacy ledger data file | `T切手出納台帳` with 9045 records, old `M入出区分`, globals/login tables |
| `filemaker/金券管理台帳_fmp12.xml` | Main UI/workflow file | `M入出区分`, `M出納区分`, `M赤伝票`, `M拠点L`, ledger workflow scripts |
| `filemaker/各種マスター_fmp12.xml` | Organization master file | `M社員`, `M会社`, `M部門`, `M拠点`, employee/search/export scripts |
| `filemaker/金券管理台帳.xml` | Summary DDR | Counts of base tables, layouts, relationships |

The DDR XML files are UTF-16LE. The exported `.htm` files are Shift-JIS (`x-sjis`).

## Legacy Core Concepts

### Ledger

The central aggregate-like record is `T切手出納台帳` / `T金券管理台帳`.

Important source fields:

| Legacy field | Current target |
| --- | --- |
| `出納No` | `voucher_ledger_entries.ledger_no` |
| `拠点CD` | `branch_code` |
| `部門CD` | `department_code` |
| `年`, `月` | `period_year`, `period_month` |
| `申請処理日`, `処理日` | `application_date`, `processing_date` |
| `連番` | `daily_sequence` |
| `入出区分CD` | `entry_type_code` |
| `出納区分CD` | `transaction_category_code` |
| `入出拠点CD` | `counterparty_branch_code` |
| `摘要`, `備考` | `description`, `remarks` |
| `枚数N[1..16]` | `voucher_ledger_entry_denominations` |
| `その他金額`, `その他金額備考` | `other_amount`, `other_amount_note` |
| `赤伝票CD`, `元伝票No`, `赤伝票No`, `訂正伝票No` | correction/reversal links |
| `Is削除` | `is_deleted` |
| `登録日時/担当`, `更新日時/担当` | audit fields |

### Denominations

`枚数N` is a 16-repetition field. The DDR calculations map repetitions to yen values in this order:

```text
1, 2, 10, 50, 84, 94, 120, 140, 210, 5, 20, 52, 110, 270, 430, 600
```

### Entry Types

DDR calculations define balance behavior:

| Code | Legacy meaning | Effect |
| --- | --- | --- |
| `1` | 前葉より繰越 | non-posting carry row |
| `2` | 入金/購入 | incoming |
| `3` | 出金/使用 | outgoing |
| `4` | 過不足入金 | incoming adjustment |
| `5` | 過不足出金 | outgoing adjustment |
| `6` | 現在高チェック | inventory check, does not change expected balance |
| `9` | 次葉へ繰越 | non-posting carry row |
| `99` | 開始時残高 | opening balance |

`Is入金 = 1` when `入出区分CD` is `2` or `4`.
`Is出金 = 1` when `入出区分CD` is `3` or `5`.
`Is入出 = 1` when code is `2`, `3`, `4`, or `5`.

### Derived Legacy Calculations

The schema replaces FileMaker calculations and summaries with SQL views.

| Legacy calculation | Behavior |
| --- | --- |
| `枚数合計` | Sum of all 16 `枚数N` repetitions |
| `切手金額合計` | Sum of `枚数N[i] * denomination[i]` |
| `金額合計` | `切手金額合計 + その他金額` |
| `補充枚数N`, `補充その他金額` | Amounts only for incoming codes |
| `使用枚数N`, `使用その他金額` | Amounts only for outgoing codes |
| `本日残N` | Opening code `99` uses entered counts; otherwise incoming minus outgoing |
| `推定残*` | FileMaker summary fields over the found/sorted set |
| `残高合計` | Running stamp amount plus running other amount |
| `実残高` | For code `6`, entered actual balance |
| `差異` | Actual inventory check total minus expected running balance |

The PostgreSQL views make running balances deterministic by ordering by `ledger_no`, not FileMaker found-set state.

## Legacy Workflows From Scripts

### Search And Navigation

`検索01T金券` and date/month scripts use global fields (`G小口::年`, `G小口::月`, `G小口::拠点CD`) to filter the ledger by target period and branch. Month navigation delegates date math to `Get1月前後年月`.

Application implication: list/query functions should accept explicit filters instead of relying on global state.

### Daily Sequence

`連番付番` sets `連番` to `最大連番 + 1` when `処理日` is present.

Current replacement: `VoucherLedgerRepository.nextDailySequence(branchCode, processingDate)`.

### Normal Movement Registration

`新規レコード追加01T金券` and `単票01T切手01登録` create and commit ledger rows. New normal rows default toward outgoing usage (`入出区分CD=3`, `出納区分CD=9`) in the UI scripts.

Current replacement: `RegisterVoucherMovementUseCase`.

### Opening Balance

`新規レコード追加01T切手管理台帳03開始時残高` creates `入出区分CD=99` rows. Exported data shows multiple opening-balance rows can exist for a branch/period, so neither the database nor the application use case enforces uniqueness. A future product rule may choose to enforce one opening balance per branch/period, but that must be introduced explicitly because it would reject legacy-compatible data.

Current replacement: `RegisterOpeningBalanceUseCase`.

### Monthly Carry

`月初処理`:

1. Checks whether carry rows already exist.
2. Uses previous month’s last `推定残*`.
3. Creates code `1` “前葉より繰越” on the first day with carried quantities.
4. Creates code `9` “次葉へ繰越” on the last day.

Current schema treats codes `1` and `9` as non-posting legacy carry rows. A future application workflow can expose this as a generated period-close/open operation if the business still needs explicit carry rows.

### Inventory Check

`新規レコード追加01T切手管理台帳02現在有り高チェック` creates `入出区分CD=6` rows. FileMaker computes actual balance and discrepancy from entered quantities/other amount versus expected running balance.

Current replacement: `RegisterInventoryCheckUseCase` and `voucher_inventory_check_results`.

### Red Voucher / Correction

`赤伝票発行` and `赤伝票発行後処理` implement correction with linked rows:

| Status | Meaning |
| --- | --- |
| `0` | normal |
| `1` | original row after red-voucher issuance |
| `2` | red-voucher reversal row |
| `3` | corrected replacement row |

The raw HTML import infers status from `元伝票No`, `赤伝票No`, and `訂正伝票No` when explicit `赤伝票CD` is absent.

Current replacement: `IssueRedVoucherCorrectionUseCase`.

### Master Imports/Exports

FileMaker scripts export/import:

- `M拠点L`
- `M入出区分`
- `M出納区分`
- `M赤伝票`
- `T金券管理台帳`
- employee and organization masters from `各種マスター`

Current replacement: `npm run migrate -- import-masters`, `import-ledger`, and `transform`. FileMaker HTML table exports are the supported import format.

## Current PostgreSQL Model

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

### Import/Staging Tables

- `legacy_filemaker_voucher_ledger_staging`

The transform script stubs missing FK targets only when no named master data exists. Named data from real exports should be active; generated `Legacy ...` placeholders remain inactive.

### Read Models

- `voucher_ledger_entry_totals`
- `voucher_ledger_entry_denomination_deltas`
- `voucher_ledger_entry_other_amount_deltas`
- `voucher_ledger_running_denominations`
- `voucher_ledger_running_other_amounts`
- `voucher_ledger_running_amounts`
- `voucher_inventory_check_results`
- `voucher_inventory_check_denomination_results`

## Current Application Use Cases

The current code is application-service oriented. Keep it framework-neutral and call it from Next.js server-side code.

| Use case | Purpose |
| --- | --- |
| `RegisterOpeningBalanceUseCase` | Post an opening-balance entry |
| `RegisterVoucherMovementUseCase` | Post incoming/outgoing movement |
| `RegisterInventoryCheckUseCase` | Post inventory check and return discrepancy |
| `IssueRedVoucherCorrectionUseCase` | Issue reversal and optional corrected row |
| `GetBranchCurrentBalanceQuery` | Read current branch balance |
| `ListLedgerEntriesQuery` | List ledger entries with branch/date/period/type filters and cursor pagination |
| `GetLedgerEntryQuery` | Read one posted ledger entry with quantities and amounts |

## Next.js Application Boundary

The project should not define a separate REST contract. Next.js can own both the UI and server-side execution, while the domain and application layers stay independent of Next.js.

Recommended module shape:

| Server function | Backing application code |
| --- | --- |
| `listLedgerEntries(input)` | `ListLedgerEntriesQuery` |
| `getLedgerEntry(ledgerNo)` | `GetLedgerEntryQuery` |
| `getBranchCurrentBalance(branchCode)` | `GetBranchCurrentBalanceQuery` |
| `registerOpeningBalance(input)` | `RegisterOpeningBalanceUseCase` |
| `registerVoucherMovement(input)` | `RegisterVoucherMovementUseCase` |
| `registerInventoryCheck(input)` | `RegisterInventoryCheckUseCase` |
| `issueRedVoucherCorrection(input)` | `IssueRedVoucherCorrectionUseCase` |
| `listBranches(input)` | future master-data query port |
| `listEntryTypes()` | future master-data query port |
| `listTransactionCategories()` | future master-data query port |
| `listDenominations()` | future master-data query port |

These functions can be exposed as server actions for form submissions, called directly from server components for read-heavy pages, or wrapped by tRPC procedures when client components need richer interaction.

### Ledger Query Inputs

`listLedgerEntries(input)` should accept:

- `branchCode`
- `periodYear`
- `periodMonth`
- `processingDateFrom`
- `processingDateTo`
- `entryTypeCode`
- `includeDeleted`
- `limit`
- `cursor`

The return shape should include ledger row identity, classification, description, amounts, quantities, red-voucher links, and audit fields.

`getLedgerEntry(ledgerNo)` should return one posted ledger entry with quantities and correction links.

`getBranchCurrentBalance(branchCode)` should return `CurrentBalanceRecord`:

```json
{
  "branchCode": 1,
  "asOfLedgerNo": 10393,
  "runningStampAmountYen": 12345,
  "runningOtherAmountYen": 0,
  "runningTotalAmountYen": 12345,
  "denominations": [
    { "denominationYen": 84, "runningQuantity": 10, "runningAmountYen": 840 }
  ]
}
```

`getInventoryCheckResult(ledgerNo)` should be added when the UI needs actual, expected, and discrepancy amounts for inventory-check rows.

### Posting Commands

All posting commands should run transactionally and return the created `ledgerNo`.

`registerOpeningBalance(input)` maps to `RegisterOpeningBalanceUseCase`:

```json
{
  "branchCode": 1,
  "periodYear": 2026,
  "periodMonth": 6,
  "processingDate": "2026-06-01",
  "applicationDate": "2026-06-01",
  "description": "開始時残高",
  "quantities": { "84": 10, "110": 5 },
  "otherAmountYen": 0,
  "actor": { "employeeNo": 1234 }
}
```

`registerVoucherMovement(input)` maps to `RegisterVoucherMovementUseCase`.

Required:

- `branchCode`
- `processingDate`
- `entryTypeCode` (`2`, `3`, `4`, `5`)
- `description`
- `quantities` and/or `otherAmountYen`

Optional:

- `transactionCategoryCode`
- `counterpartyBranchCode`
- `companyCode`
- `departmentCode`
- `responsibleEmployeeNo`
- `remarks`
- `otherAmountNote`
- `actor`

`registerInventoryCheck(input)` maps to `RegisterInventoryCheckUseCase`. Its input shape is like a movement, but entry type is fixed to `6`. It should return:

```json
{
  "entryId": "uuid",
  "ledgerNo": 123,
  "actualTotalAmountYen": 1000,
  "expectedTotalAmountYen": 990,
  "discrepancyAmountYen": 10
}
```

`issueRedVoucherCorrection(input)` maps to `IssueRedVoucherCorrectionUseCase`:

```json
{
  "originalLedgerNo": 123,
  "reversalProcessingDate": "2026-06-18",
  "reversalDescription": "No.123 の赤伝票",
  "correctedEntry": {
    "processingDate": "2026-06-18",
    "entryTypeCode": 3,
    "description": "訂正後摘要",
    "quantities": { "84": 2 },
    "otherAmountYen": 0
  },
  "actor": { "employeeNo": 1234 }
}
```

### Import And Migration

Operational imports should remain CLI-only unless a real admin screen is required. Current commands should continue to handle:

- `M拠点L.htm`
- `M入出区分.htm`
- `M出納区分.htm`
- `M_赤伝票.htm`
- `L_M社員.htm`
- `L_T金券管理台帳.htm`

If an admin UI is introduced later, it should call server-side import functions that return row counts, skipped rows, and source filename. Import scripts should not be coupled to UI components.

## tRPC Fit

tRPC is a good fit if the Next.js UI will have interactive client components for ledger search, cursor pagination, detail drawers, inventory-check flows, and correction workflows. It would provide end-to-end TypeScript types over the existing application DTOs, input validation through schemas such as Zod, and useful client hooks for loading and mutation states.

The main caveat is complexity. If most screens are server components and command forms can use server actions, plain server functions are simpler and keep the dependency surface smaller. For this project, the pragmatic path is:

1. Keep domain logic in `src/domain` and use-case orchestration in `src/application`.
2. Add a thin Next.js server layer that composes repositories and calls use cases.
3. Introduce tRPC only where client-side interaction needs type-safe query/mutation hooks.

If tRPC is adopted, routers should be adapters only. They should validate input, call application services, and map errors for UI consumption; they should not contain ledger posting rules or FileMaker compatibility logic.

Suggested router shape:

| Router procedure | Backing server function |
| --- | --- |
| `ledger.list` | `listLedgerEntries` |
| `ledger.byNo` | `getLedgerEntry` |
| `ledger.currentBalance` | `getBranchCurrentBalance` |
| `ledger.registerOpeningBalance` | `registerOpeningBalance` |
| `ledger.registerMovement` | `registerVoucherMovement` |
| `ledger.registerInventoryCheck` | `registerInventoryCheck` |
| `ledger.issueRedVoucherCorrection` | `issueRedVoucherCorrection` |
| `masters.branches` | `listBranches` |
| `masters.entryTypes` | `listEntryTypes` |
| `masters.transactionCategories` | `listTransactionCategories` |
| `masters.denominations` | `listDenominations` |

## Validation And Error Mapping

Map `DomainError.code` to form/global UI errors:

| Domain error | UI handling |
| --- | --- |
| `BRANCH_NOT_FOUND` | Show a global error and refresh branch master data |
| `BRANCH_INACTIVE` | Show a field error on branch selection |
| `OPENING_BALANCE_REQUIRED` | Show a global period setup error |
| `OPENING_BALANCE_ALREADY_EXISTS` | Only relevant if a future product rule reintroduces uniqueness |
| `INVALID_ENTRY_TYPE` | Show a field error on entry type |
| `INVALID_DENOMINATION` | Show a field error on denomination quantities |
| `INVALID_QUANTITY` | Show a field error on denomination quantities |
| `INVALID_AMOUNT` | Show a field error on amount |
| `DESCRIPTION_REQUIRED` | Show a field error on description |
| `VALUE_REQUIRED` | Show a global value-required error, then highlight empty quantity/amount inputs |
| `COUNTERPARTY_BRANCH_REQUIRED` | Show a field error on counterparty branch |
| `COUNTERPARTY_BRANCH_MUST_DIFFER` | Show a field error on counterparty branch |
| `LEDGER_ENTRY_NOT_FOUND` | Show a global not-found error and return to list |
| `LEDGER_ENTRY_NOT_CORRECTABLE` | Show a global correction-blocked error |
| `LEDGER_ENTRY_ALREADY_CORRECTED` | Show a global correction-blocked error with the existing correction link |

## Implementation Gaps To Resolve

- Opening balances currently allow duplicates to preserve legacy-compatible data. Future business rules may reintroduce branch/period uniqueness only after a migration/data-cleanup decision.
- Add an explicit period-close/month-carry use case if the business still wants code `1` and code `9` rows generated.
- Add master-data query ports.
- Decide whether employee/company/department/branch master maintenance belongs in this bounded context or remains imported read-only data.
- Decide how to expose attachments/images; FileMaker has `画像`, but current imports do not load binary image data.
- Add application/server-boundary tests around red-voucher correction link invariants and inventory-check discrepancy calculations.
