import Link from 'next/link';
import {
  DENOMINATIONS,
  isLetterPackDenomination,
  LETTER_PACK_DENOMINATIONS,
  quantityOf,
  stampQuantityCount,
  STAMP_DENOMINATIONS,
} from '@/domain/denominations';
import { EntryTypeCode } from '@/domain/entryTypes';
import { RedVoucherStatus, type RedVoucherStatusCode } from '@/domain/redVoucherStatuses';
import { DEFAULT_LEDGER_PAGE_SIZE, getLedgerDashboardData } from '@/server/ledger';
import { EntryActionModals } from './EntryActionModals';
import { LedgerTable } from './LedgerTable';
import { dateOnly, dateTime, legacyRegistrationFlagText, yen } from './ledgerDisplayFormat';
import { firstParam, paramsWithout, parseLedgerSearchParams } from './ledgerSearchParams';
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

function entryTypeName(code: number): string {
  return ENTRY_TYPE_LABELS[code] ?? `入出区分 ${code}`;
}

export default async function Page({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const input = parseLedgerSearchParams(params);

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
    const pageSize = input.limit ?? DEFAULT_LEDGER_PAGE_SIZE;
    const currentPage = input.page ?? 1;
    const totalPages = Math.max(Math.ceil(data.entries.totalCount / pageSize), 1);
    const previousHref = currentPage > 1 ? pageHref(params, currentPage - 1) : null;
    const nextHref = currentPage < totalPages ? pageHref(params, currentPage + 1) : null;
    const pageNumbers = paginationItems(currentPage, totalPages);
    const loginGreeting = selected ? loginEmployeeGreeting(selected.filemakerLoginEmployeeNo, selected.filemakerLoginEmployeeName) : null;

    return (
      <main id="top" className="shell">
        <header className="pageHeader">
          <div>
            <p className="eyebrow">Voucher Ledger</p>
            <h1>金券管理台帳</h1>
          </div>
          <div className="headerStats">
            {loginGreeting ? <span>{loginGreeting}</span> : null}
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
              deletedEntries={data.deletedEntries}
              selectedLedgerNo={selected?.ledgerNo ?? null}
              params={params}
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
                    ['対象年月', periodText(selected.periodYear, selected.periodMonth)],
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
                    ['登録ボタン', legacyRegistrationFlagText(selected.legacyRegisteredButtonClicked)],
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
                <DenominationDetailGroup title="切手" denominations={displayStampDenominations(selected.quantities)} quantities={selected.quantities} />
                <DenominationDetailGroup title="レターパック" denominations={displayLetterPackDenominations(selected.quantities)} quantities={selected.quantities} />
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

function DenominationDetailGroup({
  title,
  denominations,
  quantities,
}: Readonly<{
  title: string;
  denominations: readonly number[];
  quantities: Record<number, number>;
}>) {
  return (
    <section className="denominationSection" aria-label={title}>
      <h3>{title}</h3>
      <div className="denominationGrid">
        {denominations.map((denomination) => (
          <div key={denomination} className="denomination">
            <span>{denomination}円</span>
            <strong>{quantityOf(quantities, denomination)}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function displayStampDenominations(quantities: Record<number, number>): number[] {
  const active = new Set<number>(DENOMINATIONS);
  const historical = Object.entries(quantities)
    .filter(([denomination, quantity]) => {
      const value = Number(denomination);
      return !active.has(value) && !isLetterPackDenomination(value) && quantity !== 0;
    })
    .map(([denomination]) => Number(denomination))
    .sort((a, b) => a - b);
  return [...STAMP_DENOMINATIONS, ...historical];
}

function displayLetterPackDenominations(quantities: Record<number, number>): number[] {
  const active = new Set<number>(DENOMINATIONS);
  const historical = Object.entries(quantities)
    .filter(([denomination, quantity]) => {
      const value = Number(denomination);
      return !active.has(value) && isLetterPackDenomination(value) && quantity !== 0;
    })
    .map(([denomination]) => Number(denomination))
    .sort((a, b) => a - b);
  return [...LETTER_PACK_DENOMINATIONS, ...historical];
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
        </div>
        <div className="pageNumberList">
          {pageNumbers.map((pageNumber, index) => pageNumber === 'ellipsis' ? (
            <span key={`ellipsis-${index}`} className="pagerEllipsis">...</span>
          ) : pageNumber === currentPage ? (
            <span key={pageNumber} className="pagerButton pagerButtonActive" aria-current="page">{pageNumber}</span>
          ) : (
            <Link key={pageNumber} className="pagerButton" href={pageHref(params, pageNumber)} scroll={false}>{pageNumber}</Link>
          ))}
          <form className="pageJumpForm" action="/#ledger-entries" method="get">
            <HiddenQueryFields params={params} omit={['page', 'ledgerNo', 'actionMessage', 'clearDraft']} />
            <label>
              <input type="number" name="page" min={1} max={totalPages} defaultValue={currentPage} aria-label="ページ番号" />
            </label>
            <button className="pagerButton" type="submit">移動</button>
          </form>
        </div>
        <div className="paginationSide paginationSideRight">
          {nextHref ? (
            <Link className="pagerButton" href={nextHref} scroll={false}>次へ</Link>
          ) : (
            <span className="pagerButton pagerButtonDisabled" aria-disabled="true">次へ</span>
          )}
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

function loginEmployeeGreeting(employeeNo: number | null | undefined, employeeName: string | null | undefined): string | null {
  if (employeeName) return `こんにちは、${employeeName}さん`;
  if (employeeNo != null) return `ログイン社員 ${employeeNo}`;
  return null;
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
  const next = paramsWithout(params, { keys: ['ledgerNo', 'page', 'actionMessage', 'clearDraft'] });
  if (page > 1) next.set('page', String(page));
  const query = next.toString();
  return query ? `/?${query}` : '/';
}

function redVoucherText(code: RedVoucherStatusCode): string {
  switch (code) {
    case RedVoucherStatus.Original:
      return '元伝票';
    case RedVoucherStatus.Reversal:
      return '赤伝票';
    case RedVoucherStatus.Correction:
      return '訂正伝票';
    default:
      return '通常';
  }
}
