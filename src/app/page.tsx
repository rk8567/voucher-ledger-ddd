import { DENOMINATIONS, quantityOf, stampQuantityCount } from '@/domain/denominations';
import { EntryTypeCode } from '@/domain/entryTypes';
import { getLedgerDashboardData, type LedgerSearchInput } from '@/server/ledger';
import { EntryActionModals } from './EntryActionModals';

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

function dateParam(value: string | string[] | undefined): string | null {
  const raw = firstParam(value);
  if (!raw) return null;
  const normalized = raw.replaceAll('/', '-');
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
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
    ledgerNo: positiveNumberParam(params.ledgerNo),
    limit: pageSizeParam(params.limit),
    page: positiveNumberParam(params.page),
  };
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
    const totalPages = Math.max(Math.ceil(data.entries.totalCount / pageSize), 1);
    const previousHref = currentPage > 1 ? pageHref(params, currentPage - 1) : null;
    const nextHref = currentPage < totalPages ? pageHref(params, currentPage + 1) : null;
    const pageNumbers = paginationItems(currentPage, totalPages);

    return (
      <main className="shell">
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

        <section className="toolbar" aria-label="Ledger filters">
          <form className="filterGrid">
            <label>
              <span>拠点CD</span>
              <input name="branchCode" inputMode="numeric" defaultValue={firstParam(params.branchCode) ?? ''} />
            </label>
            <label>
              <span>年</span>
              <input name="periodYear" inputMode="numeric" defaultValue={firstParam(params.periodYear) ?? ''} />
            </label>
            <label>
              <span>月</span>
              <input name="periodMonth" inputMode="numeric" defaultValue={firstParam(params.periodMonth) ?? ''} />
            </label>
            <label>
              <span>入出区分</span>
              <select name="entryTypeCode" defaultValue={firstParam(params.entryTypeCode) ?? ''}>
                <option value="">すべて</option>
                {Object.entries(ENTRY_TYPE_LABELS).map(([code, label]) => (
                  <option key={code} value={code}>
                    {code} {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>処理日 From</span>
              <input
                name="processingDateFrom"
                pattern="\d{4}/\d{2}/\d{2}"
                placeholder="yyyy/mm/dd"
                defaultValue={dateInputText(firstParam(params.processingDateFrom))}
              />
            </label>
            <label>
              <span>処理日 To</span>
              <input
                name="processingDateTo"
                pattern="\d{4}/\d{2}/\d{2}"
                placeholder="yyyy/mm/dd"
                defaultValue={dateInputText(firstParam(params.processingDateTo))}
              />
            </label>
            <label>
              <span>表示件数</span>
              <select name="limit" defaultValue={String(pageSize)}>
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="200">200</option>
              </select>
            </label>
            <button type="submit">検索</button>
          </form>
        </section>

        <section className="summaryBand" aria-label="Current balance">
          <Metric label="残高合計" value={data.currentBalance ? yen(data.currentBalance.runningTotalAmountYen) : '-'} />
          <Metric label="切手金額" value={data.currentBalance ? yen(data.currentBalance.runningStampAmountYen) : '-'} />
          <Metric label="その他金額" value={data.currentBalance ? yen(data.currentBalance.runningOtherAmountYen) : '-'} />
          <Metric label="基準出納No" value={data.currentBalance?.asOfLedgerNo?.toString() ?? '-'} />
        </section>

        {actionMessage ? <p className="notice successNotice">{actionMessage}</p> : null}

        <div className="contentGrid">
          <section className="panel ledgerPanel" aria-label="Ledger entries">
            <div className="panelHeader">
              <h2>出納一覧</h2>
              <span>{pageRangeText(currentPage, pageSize, data.entries.items.length, data.entries.totalCount)}</span>
            </div>
            <EntryActionModals
              defaultBranchCode={defaultBranchCode}
              defaultProcessingDate={defaultProcessingDate}
              defaultPeriodYear={defaultPeriodYear}
              defaultPeriodMonth={defaultPeriodMonth}
              defaultResponsibleEmployeeNo={defaultResponsibleEmployeeNo}
              defaultActorEmployeeNo={defaultActorEmployeeNo}
              clearDraft={clearDraft === 'movement' || clearDraft === 'inventory' ? clearDraft : null}
              options={data.formOptions}
            />
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>出納No</th>
                    <th>処理日</th>
                    <th>拠点</th>
                    <th>区分</th>
                    <th>担当</th>
                    <th>摘要</th>
                    <th className="number">その他</th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.items.map((entry) => {
                    const href = queryHref(params, entry.ledgerNo);
                    const isSelected = selected?.ledgerNo === entry.ledgerNo;
                    return (
                      <tr key={entry.id} className={isSelected ? 'selectedRow' : undefined}>
                        <td>
                          <a href={href}>#{entry.ledgerNo}</a>
                        </td>
                        <td>{dateOnly(entry.processingDate)}</td>
                        <td>{nameOnly(entry.branchName)}</td>
                        <td>{entry.entryTypeName ?? entryTypeName(entry.entryTypeCode)}</td>
                        <td>{nameOnly(entry.responsibleEmployeeName)}</td>
                        <td className="description">{entry.description}</td>
                        <td className="number">{yen(entry.otherAmountYen)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <PaginationControls
              previousHref={previousHref}
              nextHref={nextHref}
              currentPage={currentPage}
              totalPages={totalPages}
              pageNumbers={pageNumbers}
              pageSize={pageSize}
              totalCount={data.entries.totalCount}
              params={params}
            />
          </section>

          <aside className="panel detailPanel" aria-label="Selected entry detail">
            <div className="panelHeader">
              <h2>明細</h2>
              <span>{selected ? `出納No ${selected.ledgerNo}` : '未選択'}</span>
            </div>
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
  pageSize,
  totalCount,
  params,
}: Readonly<{
  previousHref: string | null;
  nextHref: string | null;
  currentPage: number;
  totalPages: number;
  pageNumbers: readonly (number | 'ellipsis')[];
  pageSize: number;
  totalCount: number;
  params: Record<string, string | string[] | undefined>;
}>) {
  return (
    <nav className="paginationBar" aria-label="Ledger pagination">
      <span>
        {totalCount}件 / {totalPages}ページ / {pageSize}件
      </span>
      <div className="paginationActions">
        {previousHref ? (
          <a className="pagerButton" href={previousHref}>前へ</a>
        ) : (
          <span className="pagerButton pagerButtonDisabled" aria-disabled="true">前へ</span>
        )}
        <div className="pageNumberList">
          {pageNumbers.map((pageNumber, index) => pageNumber === 'ellipsis' ? (
            <span key={`ellipsis-${index}`} className="pagerEllipsis">...</span>
          ) : pageNumber === currentPage ? (
            <span key={pageNumber} className="pagerButton pagerButtonActive" aria-current="page">{pageNumber}</span>
          ) : (
            <a key={pageNumber} className="pagerButton" href={pageHref(params, pageNumber)}>{pageNumber}</a>
          ))}
        </div>
        {nextHref ? (
          <a className="pagerButton" href={nextHref}>次へ</a>
        ) : (
          <span className="pagerButton pagerButtonDisabled" aria-disabled="true">次へ</span>
        )}
      </div>
    </nav>
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

function dateInputText(value: string | null | undefined): string {
  return dateOnly(value) ?? '';
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

function queryHref(params: Record<string, string | string[] | undefined>, ledgerNo: number): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (
      key === 'ledgerNo'
      || key === 'cursorLedgerNo'
      || key === 'cursorStack'
      || key === 'actionMessage'
      || key === 'clearDraft'
    ) {
      continue;
    }
    const first = firstParam(value);
    if (first) next.set(key, first);
  }
  next.set('ledgerNo', String(ledgerNo));
  return `/?${next.toString()}`;
}

function pageHref(params: Record<string, string | string[] | undefined>, page: number): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (
      key === 'ledgerNo'
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
