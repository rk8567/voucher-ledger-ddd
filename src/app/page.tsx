import Link from 'next/link';
import { DENOMINATIONS, quantityOf, stampQuantityCount } from '@/domain/denominations';
import { EntryTypeCode } from '@/domain/entryTypes';
import { getLedgerDashboardData, type LedgerSearchInput } from '@/server/ledger';
import { EntryActionModals } from './EntryActionModals';
import { LedgerTable } from './LedgerTable';
import { ReturnTopButton } from './ReturnTopButton';

export const dynamic = 'force-dynamic';

type PageProps = Readonly<{
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}>;

const ENTRY_TYPE_LABELS: Record<number, string> = {
  [EntryTypeCode.CarryIn]: '前葉より繰越',
  [EntryTypeCode.Incoming]: '入金/購入',
  [EntryTypeCode.Outgoing]: '出金/使用',
  [EntryTypeCode.IncomingAlt]: '過不足入金',
  [EntryTypeCode.OutgoingAlt]: '過不足出金',
  [EntryTypeCode.InventoryCheck]: '現在高チェック',
  [EntryTypeCode.CarryOut]: '次葉へ繰越',
  [EntryTypeCode.OpeningBalance]: '開始時残高',
};

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
const DEFAULT_PAGE_SIZE = 100;
const SORT_KEYS = [
  'ledgerNo',
  'processingDate',
  'branchName',
  'entryTypeName',
  'responsibleEmployeeName',
  'description',
  'otherAmountYen',
] as const;

type TableSortKey = NonNullable<LedgerSearchInput['sortKey']>;
type SortDirection = NonNullable<LedgerSearchInput['sortDirection']>;
function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function numberParam(value: string | string[] | undefined): number | null {
  const raw = firstParam(value);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
}

function positiveNumberParam(value: string | string[] | undefined): number | null {
  const parsed = numberParam(value);
  return parsed != null && parsed > 0 ? parsed : null;
}

function pageSizeParam(value: string | string[] | undefined): number | null {
  const parsed = numberParam(value);
  return PAGE_SIZE_OPTIONS.some((option) => option === parsed) ? parsed : null;
}

function sortKeyParam(value: string | string[] | undefined): TableSortKey | null {
  const raw = firstParam(value);
  return SORT_KEYS.some((sortKey) => sortKey === raw) ? raw as TableSortKey : null;
}

function sortDirectionParam(value: string | string[] | undefined): SortDirection | null {
  const raw = firstParam(value);
  return raw === 'asc' || raw === 'desc' ? raw : null;
}

function dateParam(value: string | string[] | undefined): string | null {
  const raw = firstParam(value);
  if (!raw) return null;
  const normalized = raw.replaceAll('/', '-');
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function textParam(value: string | string[] | undefined): string | null {
  const raw = firstParam(value)?.trim();
  return raw ? raw.slice(0, 100) : null;
}

function booleanParam(value: string | string[] | undefined): boolean {
  const raw = firstParam(value);
  return raw === '1' || raw === 'true';
}

function yen(value: number): string {
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    maximumFractionDigits: 0,
  }).format(value);
}

function entryTypeName(code: number): string {
  return ENTRY_TYPE_LABELS[code] ?? `入出区分 ${code}`;
}

function parseSearchParams(params: Record<string, string | string[] | undefined>): LedgerSearchInput {
  const entryType = numberParam(params.entryTypeCode);
  return {
    branchCode: numberParam(params.branchCode),
    periodYear: numberParam(params.periodYear),
    periodMonth: numberParam(params.periodMonth),
    processingDateFrom: dateParam(params.processingDateFrom),
    processingDateTo: dateParam(params.processingDateTo),
    entryTypeCode: entryType == null ? null : (entryType as EntryTypeCode),
    columnFilters: columnFiltersParam(params),
    ledgerNo: positiveNumberParam(params.ledgerNo),
    limit: pageSizeParam(params.limit),
    page: positiveNumberParam(params.page),
    sortKey: sortKeyParam(params.sort),
    sortDirection: sortDirectionParam(params.dir),
    includeDeleted: booleanParam(params.includeDeleted),
  };
}

function columnFiltersParam(params: Record<string, string | string[] | undefined>): Record<string, string> {
  const filters: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!key.startsWith('filter_')) continue;
    const filterValue = textParam(value);
    if (filterValue) filters[key.slice('filter_'.length)] = filterValue;
  }
  return filters;
}

function plainParams(params: Record<string, string | string[] | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params)
      .map(([key, value]) => [key, firstParam(value) ?? ''] as const)
      .filter(([, value]) => value !== ''),
  );
}

export default async function Page({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const input = parseSearchParams(params);

  try {
    const data = await getLedgerDashboardData(input);
    const selected = data.selectedEntry;
    const defaultProcessingDate = input.processingDateFrom ?? selected?.processingDate ?? todayInTokyo();
    const defaultPeriodYear = input.periodYear ?? selected?.periodYear ?? Number(defaultProcessingDate.slice(0, 4));
    const defaultPeriodMonth = input.periodMonth ?? selected?.periodMonth ?? Number(defaultProcessingDate.slice(5, 7));
    const defaultBranchCode = input.branchCode ?? selected?.branchCode ?? data.currentBalance?.branchCode ?? null;
    const defaultResponsibleEmployeeNo = selected?.responsibleEmployeeNo ?? null;
    const defaultActorEmployeeNo = selected?.filemakerLoginEmployeeNo ?? selected?.updatedByEmployeeNo ?? null;
    const actionMessage = firstParam(params.actionMessage);
    const clearDraft = firstParam(params.clearDraft);
    const pageSize = input.limit ?? DEFAULT_PAGE_SIZE;
    const currentPage = input.page ?? 1;
    const currentSortKey = input.sortKey ?? '';
    const currentSortDirection = input.sortDirection ?? 'asc';
    const includeDeleted = input.includeDeleted === true;
    const totalPages = Math.max(Math.ceil(data.entries.totalCount / pageSize), 1);
    const previousHref = currentPage > 1 ? pageHref(params, currentPage - 1) : null;
    const nextHref = currentPage < totalPages ? pageHref(params, currentPage + 1) : null;
    const pageNumbers = paginationItems(currentPage, totalPages);

    return (
      <main id="top" className="shell">
        <header className="pageHeader">
          <div>
            <p className="eyebrow">Voucher Ledger</p>
            <h1>金券管理台帳</h1>
          </div>
          <div className="headerStats">
            <span>{data.entries.totalCount} entries</span>
            <span>{data.currentBalance ? `Branch ${data.currentBalance.branchCode}` : 'No balance'}</span>
          </div>
        </header>

        <section className="summaryBand" aria-label="Current balance">
          <Metric label="残高合計" value={data.currentBalance ? yen(data.currentBalance.runningTotalAmountYen) : '-'} />
          <Metric label="切手金額" value={data.currentBalance ? yen(data.currentBalance.runningStampAmountYen) : '-'} />
          <Metric label="その他金額" value={data.currentBalance ? yen(data.currentBalance.runningOtherAmountYen) : '-'} />
          <Metric label="基準出納No" value={data.currentBalance?.asOfLedgerNo?.toString() ?? '-'} />
        </section>

        {actionMessage ? <p className="notice successNotice">{actionMessage}</p> : null}

        <div className="contentGrid">
          <section id="ledger-entries" className="panel ledgerPanel" aria-label="Ledger entries">
            <div className="panelHeader">
              <h2>出納一覧</h2>
              <div className="panelHeaderActions">
                <span>{pageRangeText(currentPage, pageSize, data.entries.items.length, data.entries.totalCount)}</span>
              </div>
            </div>
            <PaginationControls
              previousHref={previousHref}
              nextHref={nextHref}
              currentPage={currentPage}
              totalPages={totalPages}
              pageNumbers={pageNumbers}
              params={params}
              position="top"
            />
            <LedgerTable
              entries={data.entries.items}
              selectedLedgerNo={selected?.ledgerNo ?? null}
              params={plainParams(params)}
              currentSortKey={currentSortKey}
              currentSortDirection={currentSortDirection}
              exportHref={exportCsvHref(params)}
              showAllHref="/"
              includeDeleted={includeDeleted}
              deletedToggleHref={deletedToggleHref(params, includeDeleted)}
              unsortHref={unsortHref(params)}
              filterOptions={data.formOptions}
            />
            <PaginationControls
              previousHref={previousHref}
              nextHref={nextHref}
              currentPage={currentPage}
              totalPages={totalPages}
              pageNumbers={pageNumbers}
              params={params}
              position="bottom"
            />
          </section>

          <aside className="panel detailPanel" aria-label="Selected entry detail">
            <div className="panelHeader">
              <h2>明細</h2>
              <span>{selected ? `出納No ${selected.ledgerNo}` : '未選択'}</span>
            </div>
            <EntryActionModals
              defaultBranchCode={defaultBranchCode}
              defaultProcessingDate={defaultProcessingDate}
              defaultPeriodYear={defaultPeriodYear}
              defaultPeriodMonth={defaultPeriodMonth}
              defaultResponsibleEmployeeNo={defaultResponsibleEmployeeNo}
              defaultActorEmployeeNo={defaultActorEmployeeNo}
              clearDraft={clearDraft === 'movement' || clearDraft === 'inventory' || clearDraft === 'correction' ? clearDraft : null}
              options={data.formOptions}
              selectedEntry={selected}
            />
            {selected ? (
              <>
                <DetailSection
                  title="基本"
                  rows={[
                    ['出納No', selected.ledgerNo],
                    ['摘要', selected.description],
                    ['備考', selected.remarks],
                    ['処理日', dateOnly(selected.processingDate)],
                    ['申請処理日', dateOnly(selected.applicationDate)],
                    ['年/月', periodText(selected.periodYear, selected.periodMonth)],
                    ['連番', selected.dailySequence],
                    ['登録済', dateTime(selected.postedAt)],
                  ]}
                />
                <DetailSection
                  title="分類"
                  rows={[
                    ['入出区分', codeName(selected.entryTypeCode, selected.entryTypeName ?? entryTypeName(selected.entryTypeCode))],
                    ['出納区分', codeName(selected.transactionCategoryCode, selected.transactionCategoryName)],
                    ['状態CD', selected.statusCode],
                    ['削除', selected.isDeleted ? 'true' : 'false'],
                    ['登録ボタン', selected.legacyRegisteredButtonClicked ? 'true' : 'false'],
                  ]}
                />
                <DetailSection
                  title="担当/帰属"
                  rows={[
                    ['拠点', codeName(selected.branchCode, selected.branchName)],
                    ['部門', codeName(selected.departmentCode, selected.departmentName)],
                    ['会社', codeName(selected.companyCode, selected.companyName)],
                    ['担当', codeName(selected.responsibleEmployeeNo, selected.responsibleEmployeeName)],
                    ['入出拠点', codeName(selected.counterpartyBranchCode, selected.counterpartyBranchName)],
                  ]}
                />
                <DetailSection
                  title="金額"
                  rows={[
                    ['切手金額合計', yen(selected.stampAmountYen)],
                    ['その他金額', yen(selected.otherAmountYen)],
                    ['その他金額備考', selected.otherAmountNote],
                    ['金額合計', yen(selected.totalAmountYen)],
                    ['枚数合計', stampQuantityCount(selected.quantities)],
                  ]}
                />
                <div className="denominationGrid">
                  {DENOMINATIONS.map((denomination) => (
                    <div key={denomination} className="denomination">
                      <span>{denomination}円</span>
                      <strong>{quantityOf(selected.quantities, denomination)}</strong>
                    </div>
                  ))}
                </div>
                <DetailSection
                  title="赤伝票/訂正"
                  rows={[
                    ['赤伝票状態', codeName(selected.redVoucherStatusCode, selected.redVoucherStatusName ?? redVoucherText(selected.redVoucherStatusCode))],
                    ['元伝票No', selected.originalLedgerNo],
                    ['赤伝票No', selected.reversalLedgerNo],
                    ['訂正伝票No', selected.correctionLedgerNo],
                  ]}
                />
                <DetailSection
                  title="監査"
                  rows={[
                    ['登録日時', dateTime(selected.registeredAt)],
                    ['登録担当', codeName(selected.registeredByEmployeeNo, selected.registeredByEmployeeName)],
                    ['更新日時', dateTime(selected.updatedAt)],
                    ['更新担当', codeName(selected.updatedByEmployeeNo, selected.updatedByEmployeeName)],
                    ['作成日時', dateTime(selected.createdAt)],
                  ]}
                />
                <DetailSection
                  title="FileMaker"
                  rows={[
                    ['ログイン社員', codeName(selected.filemakerLoginEmployeeNo, selected.filemakerLoginEmployeeName)],
                    ['作成情報タイムスタンプ', dateTime(selected.filemakerCreatedAt)],
                    ['作成者', selected.filemakerCreatedBy],
                    ['修正情報タイムスタンプ', dateTime(selected.filemakerModifiedAt)],
                    ['修正者', selected.filemakerModifiedBy],
                    ['ID', selected.id],
                  ]}
                />
              </>
            ) : (
              <p className="emptyState">条件に一致する出納がありません。</p>
            )}
          </aside>
        </div>
        <ReturnTopButton />
      </main>
    );
  } catch (error) {
    return (
      <main className="shell">
        <header className="pageHeader">
          <div>
            <p className="eyebrow">Voucher Ledger</p>
            <h1>金券管理台帳</h1>
          </div>
        </header>
        <section className="errorPanel">
          <h2>データベースに接続できません</h2>
          <p>{error instanceof Error ? error.message : 'Unknown error'}</p>
        </section>
      </main>
    );
  }
}

function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PaginationControls({
  previousHref,
  nextHref,
  currentPage,
  totalPages,
  pageNumbers,
  params,
  position,
}: Readonly<{
  previousHref: string | null;
  nextHref: string | null;
  currentPage: number;
  totalPages: number;
  pageNumbers: readonly (number | 'ellipsis')[];
  params: Record<string, string | string[] | undefined>;
  position: 'top' | 'bottom';
}>) {
  return (
    <nav className={`paginationBar paginationBar${position === 'top' ? 'Top' : 'Bottom'}`} aria-label={`Ledger pagination ${position}`}>
      <div className="paginationActions">
        <div className="paginationSide paginationSideLeft">
          {previousHref ? (
            <Link className="pagerButton" href={previousHref} scroll={false}>前へ</Link>
          ) : (
            <span className="pagerButton pagerButtonDisabled" aria-disabled="true">前へ</span>
          )}
          {nextHref ? (
            <Link className="pagerButton" href={nextHref} scroll={false}>次へ</Link>
          ) : (
            <span className="pagerButton pagerButtonDisabled" aria-disabled="true">次へ</span>
          )}
        </div>
        <div className="pageNumberList">
          {pageNumbers.map((pageNumber, index) => pageNumber === 'ellipsis' ? (
            <span key={`ellipsis-${index}`} className="pagerEllipsis">...</span>
          ) : pageNumber === currentPage ? (
            <span key={pageNumber} className="pagerButton pagerButtonActive" aria-current="page">{pageNumber}</span>
          ) : (
            <Link key={pageNumber} className="pagerButton" href={pageHref(params, pageNumber)} scroll={false}>{pageNumber}</Link>
          ))}
        </div>
        <div className="paginationSide paginationSideRight">
          <form className="pageJumpForm" action="/#ledger-entries" method="get">
            <HiddenQueryFields params={params} omit={['q', 'page', 'ledgerNo', 'cursorLedgerNo', 'cursorStack', 'actionMessage', 'clearDraft']} />
            <label>
              <span>ページ</span>
              <input type="number" name="page" min={1} max={totalPages} defaultValue={currentPage} />
            </label>
            <button className="pagerButton" type="submit">移動</button>
          </form>
        </div>
      </div>
    </nav>
  );
}

function HiddenQueryFields({
  params,
  omit,
}: Readonly<{
  params: Record<string, string | string[] | undefined>;
  omit: readonly string[];
}>) {
  const omitted = new Set(omit);
  return (
    <>
      {Object.entries(params).flatMap(([key, value]) => {
        if (omitted.has(key)) return [];
        const first = firstParam(value);
        return first ? [<input key={key} type="hidden" name={key} value={first} />] : [];
      })}
    </>
  );
}

function DetailSection({
  title,
  rows,
}: Readonly<{
  title: string;
  rows: readonly (readonly [string, string | number | boolean | null | undefined])[];
}>) {
  return (
    <section className="detailSection">
      <h3>{title}</h3>
      <dl className="detailList">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{displayValue(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function displayValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
}

function dateTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}/${byType.month}/${byType.day} ${byType.hour}:${byType.minute}:${byType.second}`;
}

function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) return `${match[1]}/${match[2]}/${match[3]}`;
  return value.replaceAll('-', '/');
}

function todayInTokyo(): string {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function codeName(code: number | null | undefined, name: string | null | undefined): string {
  if (code == null && !name) return '-';
  if (code == null) return name ?? '-';
  return name ? `${code} ${name}` : String(code);
}

function nameOnly(name: string | null | undefined): string {
  return name || '-';
}

function periodText(year: number | null, month: number | null): string {
  if (year == null && month == null) return '-';
  return `${year ?? '-'} / ${month ?? '-'}`;
}

function pageRangeText(currentPage: number, pageSize: number, itemCount: number, totalCount: number): string {
  if (totalCount === 0) return '0 entries';
  const first = (currentPage - 1) * pageSize + 1;
  const last = first + itemCount - 1;
  return `${first}-${last} / ${totalCount} entries`;
}

function paginationItems(currentPage: number, totalPages: number): (number | 'ellipsis')[] {
  if (totalPages <= 9) return Array.from({ length: totalPages }, (_, index) => index + 1);

  const pages = new Set([1, totalPages]);
  for (let page = currentPage - 2; page <= currentPage + 2; page += 1) {
    if (page > 1 && page < totalPages) pages.add(page);
  }

  const sortedPages = [...pages].sort((a, b) => a - b);
  const items: (number | 'ellipsis')[] = [];
  for (const page of sortedPages) {
    const previous = items.at(-1);
    if (typeof previous === 'number' && page - previous > 1) items.push('ellipsis');
    items.push(page);
  }
  return items;
}

function pageHref(params: Record<string, string | string[] | undefined>, page: number): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (
      key === 'ledgerNo'
      || key === 'q'
      || key === 'cursorLedgerNo'
      || key === 'cursorStack'
      || key === 'page'
      || key === 'actionMessage'
      || key === 'clearDraft'
    ) {
      continue;
    }
    const first = firstParam(value);
    if (first) next.set(key, first);
  }
  if (page > 1) next.set('page', String(page));
  const query = next.toString();
  return query ? `/?${query}` : '/';
}

function clearFiltersHref(params: Record<string, string | string[] | undefined>): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (
      key.startsWith('filter_')
      || key === 'q'
      || key === 'ledgerNo'
      || key === 'cursorLedgerNo'
      || key === 'cursorStack'
      || key === 'page'
      || key === 'actionMessage'
      || key === 'clearDraft'
    ) {
      continue;
    }
    const first = firstParam(value);
    if (first) next.set(key, first);
  }
  const query = next.toString();
  return query ? `/?${query}` : '/';
}

function exportCsvHref(params: Record<string, string | string[] | undefined>): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (
      key === 'ledgerNo'
      || key === 'q'
      || key === 'cursorLedgerNo'
      || key === 'cursorStack'
      || key === 'page'
      || key === 'actionMessage'
      || key === 'clearDraft'
    ) {
      continue;
    }
    const first = firstParam(value);
    if (first) next.set(key, first);
  }
  const query = next.toString();
  return query ? `/export/ledger?${query}` : '/export/ledger';
}

function deletedToggleHref(params: Record<string, string | string[] | undefined>, includeDeleted: boolean): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (
      key === 'ledgerNo'
      || key === 'q'
      || key === 'cursorLedgerNo'
      || key === 'cursorStack'
      || key === 'page'
      || key === 'includeDeleted'
      || key === 'actionMessage'
      || key === 'clearDraft'
    ) {
      continue;
    }
    const first = firstParam(value);
    if (first) next.set(key, first);
  }
  if (!includeDeleted) next.set('includeDeleted', '1');
  const query = next.toString();
  return query ? `/?${query}` : '/';
}

function unsortHref(params: Record<string, string | string[] | undefined>): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (
      key === 'ledgerNo'
      || key === 'q'
      || key === 'cursorLedgerNo'
      || key === 'cursorStack'
      || key === 'page'
      || key === 'sort'
      || key === 'dir'
      || key === 'actionMessage'
      || key === 'clearDraft'
    ) {
      continue;
    }
    const first = firstParam(value);
    if (first) next.set(key, first);
  }
  const query = next.toString();
  return query ? `/?${query}` : '/';
}

function redVoucherText(code: 0 | 1 | 2 | 3): string {
  switch (code) {
    case 1:
      return '元伝票';
    case 2:
      return '赤伝票';
    case 3:
      return '訂正伝票';
    default:
      return '通常';
  }
}
