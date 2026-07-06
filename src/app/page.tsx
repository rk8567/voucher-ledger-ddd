import Link from 'next/link';
import { cookies } from 'next/headers';
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
import { DEFAULT_LEDGER_PAGE_SIZE, getLedgerDashboardData, type LedgerDashboardData } from '@/server/ledger';
import { EntryActionModals } from './EntryActionModals';
import { EntryWorkflowButtons } from './EntryWorkflowButtons';
import { LedgerTable } from './LedgerTable';
import {
  columnOrderLedgerColumnCookieName,
  defaultLedgerExportColumnKeys,
  defaultLedgerColumnKeys,
  exportLedgerColumnCookieName,
  ledgerColumns,
  parseLedgerColumnCookie,
  parseLedgerExportColumnCookie,
  parseLedgerColumnOrderCookie,
  visibleLedgerColumnCookieName,
} from './ledgerColumns';
import { dateOnly, dateTime, legacyRegistrationFlagText, yen } from './ledgerDisplayFormat';
import { firstParam, paramsWithout, parseLedgerSearchParams } from './ledgerSearchParams';
import { ReturnTopButton } from './ReturnTopButton';
import { DetailWindowBackdrop } from './DetailWindowBackdrop';
import { DetailWindowCorrectionButton } from './DetailWindowCorrectionButton';
import { ThemeToggle } from './ThemeToggle';
import { BranchSelector, type BranchSelectorOption } from './BranchSelector';

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

function selectedEntryCanCorrect(entry: NonNullable<LedgerDashboardData['selectedEntry']>): boolean {
  return !entry.isDeleted
    && entry.redVoucherStatusCode === RedVoucherStatus.Normal
    && entry.reversalLedgerNo === null
    && entry.totalAmountYen > 0
    && [
      EntryTypeCode.Incoming,
      EntryTypeCode.Outgoing,
      EntryTypeCode.IncomingAlt,
      EntryTypeCode.OutgoingAlt,
    ].includes(entry.entryTypeCode);
}

export default async function Page({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const input = parseLedgerSearchParams(params);
  const cookieStore = await cookies();
  const visibleColumnCookie = cookieStore.get(visibleLedgerColumnCookieName)?.value;
  const columnOrderCookie = cookieStore.get(columnOrderLedgerColumnCookieName)?.value;
  const initialVisibleColumnKeys = parseLedgerColumnCookie(
    visibleColumnCookie,
    defaultLedgerColumnKeys,
  );
  const initialColumnOrderKeys = parseLedgerColumnOrderCookie(
    columnOrderCookie ?? visibleColumnCookie,
  );
  const initialExportColumnKeys = parseLedgerExportColumnCookie(
    cookieStore.get(exportLedgerColumnCookieName)?.value,
    defaultLedgerExportColumnKeys,
  );

  try {
    const data = await getLedgerDashboardData(input);
    const selected = data.selectedEntry;
    const defaultProcessingDate = selected?.processingDate ?? input.processingDateTo ?? todayInTokyo();
    const defaultPeriodYear = input.periodYear ?? selected?.periodYear ?? Number(defaultProcessingDate.slice(0, 4));
    const defaultPeriodMonth = input.periodMonth ?? selected?.periodMonth ?? Number(defaultProcessingDate.slice(5, 7));
    const firstBranchCode = data.formOptions.branches[0]?.value ?? null;
    const defaultBranchCode = input.branchCode ?? data.currentBalance?.branchCode ?? selected?.branchCode ?? firstBranchCode;
    const defaultResponsibleEmployeeNo = selected?.responsibleEmployeeNo ?? null;
    const defaultActorEmployeeNo = selected?.filemakerLoginEmployeeNo ?? selected?.updatedByEmployeeNo ?? null;
    const actionMessage = firstParam(params.actionMessage);
    const clearDraft = firstParam(params.clearDraft);
    const detailWindowOpen = firstParam(params.detailWindow) === '1';
    const detailWindowCloseHref = detailWindowCloseHrefFromParams(params);
    const detailPanelHidden = firstParam(params.detailPanel) !== 'visible';
    const pageSize = input.limit ?? DEFAULT_LEDGER_PAGE_SIZE;
    const currentPage = input.page ?? 1;
    const totalPages = Math.max(Math.ceil(data.entries.totalCount / pageSize), 1);
    const previousHref = currentPage > 1 ? pageHref(params, currentPage - 1) : null;
    const nextHref = currentPage < totalPages ? pageHref(params, currentPage + 1) : null;
    const pageNumbers = paginationItems(currentPage, totalPages);
    const displayDateRange = displayDateRangeValues(params, input.processingDateFrom, input.processingDateTo);

    return (
      <main id="top" className="shell">
        <header className="pageHeader">
          <div>
            <p className="eyebrow">Voucher Ledger</p>
            <h1>金券管理台帳</h1>
          </div>
          <div className="headerStats">
            <span>{data.entries.totalCount} entries</span>
            <BranchSelectionForm params={params} branchCode={defaultBranchCode} branches={data.formOptions.branches} />
            <ThemeToggle />
          </div>
        </header>

        <div className="dashboardGrid">
          <section className="summaryBand" aria-label="Current balance">
            <Metric label="残高合計" value={data.currentBalance ? yen(data.currentBalance.runningTotalAmountYen) : '-'} />
            <Metric label="切手金額" value={data.currentBalance ? yen(data.currentBalance.runningStampAmountYen) : '-'} />
            <Metric label="その他金額" value={data.currentBalance ? yen(data.currentBalance.runningOtherAmountYen) : '-'} />
            <Metric label="最終出納No" value={data.currentBalance?.asOfLedgerNo?.toString() ?? '-'} />
          </section>
          <div className="dashboardActions">
            <div className="displayDateRangePanel">
              <DisplayDateRangeForm
                params={params}
                processingDateFrom={displayDateRange.from}
                processingDateTo={displayDateRange.to}
              />
            </div>
            <div className="detailPrimaryActions" aria-label="Entry actions">
              <EntryWorkflowButtons correctionDisabled={!selected || !selectedEntryCanCorrect(selected)} />
            </div>
          </div>
        </div>

        {actionMessage ? <p className="notice successNotice">{actionMessage}</p> : null}
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

        <div className={detailPanelHidden ? 'contentGrid detailPanelHidden' : 'contentGrid'}>
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
              selectedEntry={selected}
              params={params}
              filterOptions={data.formOptions}
              effectiveBranchCode={defaultBranchCode}
              displayDateRange={displayDateRange}
              initialVisibleColumnKeys={initialVisibleColumnKeys}
              initialColumnOrderKeys={initialColumnOrderKeys}
              initialExportColumnKeys={initialExportColumnKeys}
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

          {detailPanelHidden ? null : (
          <aside className="panel detailPanel" aria-label="Selected entry detail">
            <div className="panelHeader">
              <h2>明細</h2>
            </div>
            {selected ? (
              <SelectedEntryDetails selected={selected} correctionTrail={data.correctionTrail} params={params} />
            ) : (
              <p className="emptyState">条件に一致する出納がありません。</p>
            )}
          </aside>
          )}
        </div>
        <Link
          className={detailPanelHidden ? 'detailPanelSlideToggle detailPanelSlideToggleHidden' : 'detailPanelSlideToggle'}
          href={detailPanelHidden ? showDetailPanelHref(params) : hideDetailPanelHref(params)}
          scroll={false}
          aria-label={detailPanelHidden ? '明細を表示' : '明細を隠す'}
        >
          <svg
            className="detailPanelSlideToggleArrow"
            viewBox="0 0 8 14"
            aria-hidden="true"
          >
            <path d={detailPanelHidden ? 'M6 1.5 2 7l4 5.5' : 'M2 1.5 6 7l-4 5.5'} />
          </svg>
          <span className="detailPanelSlideToggleLabel">明細</span>
        </Link>
        {detailWindowOpen && selected ? (
          <DetailWindowBackdrop closeHref={detailWindowCloseHref}>
            <section className="entryModal detailWindow" role="dialog" aria-modal="true" aria-labelledby="entry-detail-window-title">
              <div className="modalHeader">
                <h2 id="entry-detail-window-title">明細</h2>
                <Link className="toolbarButton secondaryButton" href={detailWindowCloseHref} scroll={false}>閉じる</Link>
              </div>
              <div className="detailWindowBody">
                <SelectedEntryDetails
                  selected={selected}
                  correctionTrail={data.correctionTrail}
                  params={params}
                  layout="grid"
                  detailWindow
                />
              </div>
              <div className="detailWindowFooter">
                <DetailWindowCorrectionButton disabled={!selectedEntryCanCorrect(selected)} />
              </div>
            </section>
          </DetailWindowBackdrop>
        ) : null}
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

function BranchSelectionForm({
  params,
  branchCode,
  branches,
}: Readonly<{
  params: Record<string, string | string[] | undefined>;
  branchCode: number | null;
  branches: LedgerDashboardData['formOptions']['branches'];
}>) {
  const options: BranchSelectorOption[] = branches.map((branch) => ({
    value: String(branch.value),
    label: branch.label,
    href: branchSelectionHref(params, branch.value),
  }));
  if (options.length === 0) {
    return <BranchSelector selectedValue="" options={[{ value: '', label: '-', href: '', disabled: true }]} />;
  }
  const selectedValue = branchCode == null ? options[0]?.value ?? '' : String(branchCode);

  return <BranchSelector selectedValue={selectedValue} options={options} />;
}

function SelectedEntryDetails({
  selected,
  correctionTrail,
  params,
  layout = 'stack',
  detailWindow = false,
}: Readonly<{
  selected: NonNullable<LedgerDashboardData['selectedEntry']>;
  correctionTrail: LedgerDashboardData['correctionTrail'];
  params: Record<string, string | string[] | undefined>;
  layout?: 'stack' | 'grid';
  detailWindow?: boolean;
}>) {
  return (
    <div className={layout === 'grid' ? 'selectedEntryDetails detailWindowGrid' : 'selectedEntryDetails'}>
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
      <CorrectionTrailSection
        trail={correctionTrail}
        currentLedgerNo={selected.ledgerNo}
        params={params}
        detailWindow={detailWindow}
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
    </div>
  );
}

function CorrectionTrailSection({
  trail,
  currentLedgerNo,
  params,
  detailWindow,
}: Readonly<{
  trail: LedgerDashboardData['correctionTrail'];
  currentLedgerNo: number;
  params: Record<string, string | string[] | undefined>;
  detailWindow: boolean;
}>) {
  if (!trail) return null;

  const items = [
    { label: '元伝票', ledgerNo: trail.originalLedgerNo },
    { label: '赤伝票', ledgerNo: trail.reversalLedgerNo },
    { label: '訂正伝票', ledgerNo: trail.correctionLedgerNo },
  ];

  return (
    <section className="detailSection correctionTrailSection">
      <h3>訂正履歴</h3>
      <div className="correctionTrail" aria-label="訂正履歴">
        {items.map((item, index) => (
          <div key={item.label} className="correctionTrailStep">
            {index > 0 ? <span className="correctionTrailSeparator" aria-hidden="true">→</span> : null}
            <span className="correctionTrailLabel">{item.label}</span>
            {correctionTrailNode(item.ledgerNo, currentLedgerNo, params, detailWindow)}
          </div>
        ))}
      </div>
    </section>
  );
}

function correctionTrailNode(
  ledgerNo: number | null,
  currentLedgerNo: number,
  params: Record<string, string | string[] | undefined>,
  detailWindow: boolean,
) {
  if (ledgerNo == null) return <span className="correctionTrailEmpty">-</span>;
  const text = `#${ledgerNo}`;
  if (ledgerNo === currentLedgerNo) return <span className="correctionTrailCurrent">{text}</span>;
  return (
    <Link className="correctionTrailLink" href={ledgerEntryHref(params, ledgerNo, detailWindow)} scroll={false}>
      {text}
    </Link>
  );
}

function DisplayDateRangeForm({
  params,
  processingDateFrom,
  processingDateTo,
}: Readonly<{
  params: Record<string, string | string[] | undefined>;
  processingDateFrom: string;
  processingDateTo: string;
}>) {
  const preserved = paramsWithout(params, {
    keys: [
      'dateRange',
      'processingDateFrom',
      'processingDateTo',
      'displayDateFrom',
      'displayDateTo',
      'page',
      'ledgerNo',
      'actionMessage',
      'clearDraft',
      ...dateColumnFilterKeys(),
    ],
  });
  const clearHref = displayDateRangeClearHref(params, processingDateFrom, processingDateTo);

  return (
    <form className="displayDateRangeForm" method="get">
      {Array.from(preserved.entries()).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <label>
        <span>表示開始日付</span>
        <input type="date" name="processingDateFrom" defaultValue={processingDateFrom} />
      </label>
      <label>
        <span>終了日付</span>
        <input type="date" name="processingDateTo" defaultValue={processingDateTo} />
      </label>
      <button type="submit" className="toolbarButton">表示</button>
      <a className="toolbarButton secondaryButton compactToolbarButton" href={clearHref}>解除</a>
    </form>
  );
}

function displayDateRangeClearHref(
  params: Record<string, string | string[] | undefined>,
  processingDateFrom: string,
  processingDateTo: string,
): string {
  const preserved = paramsWithout(params, {
    keys: [
      'dateRange',
      'processingDateFrom',
      'processingDateTo',
      'displayDateFrom',
      'displayDateTo',
      'page',
      'ledgerNo',
      'actionMessage',
      'clearDraft',
    ],
  });
  preserved.set('displayDateFrom', processingDateFrom);
  preserved.set('displayDateTo', processingDateTo);
  const query = preserved.toString();
  return query ? `/?${query}` : '/';
}

function branchSelectionHref(params: Record<string, string | string[] | undefined>, branchCode: number): string {
  const next = paramsWithout(params, {
    keys: ['branchCode', 'filter_branchName', 'ledgerNo', 'page', 'actionMessage', 'clearDraft'],
  });
  next.set('branchCode', String(branchCode));
  const query = next.toString();
  return query ? `/?${query}` : '/';
}

function detailWindowCloseHrefFromParams(params: Record<string, string | string[] | undefined>): string {
  const next = paramsWithout(params, { keys: ['detailWindow', 'actionMessage', 'clearDraft'] });
  const query = next.toString();
  return query ? `/?${query}` : '/';
}

function ledgerEntryHref(params: Record<string, string | string[] | undefined>, ledgerNo: number, detailWindow: boolean): string {
  const omittedKeys = ['ledgerNo', 'actionMessage', 'clearDraft'];
  const next = paramsWithout(params, { keys: detailWindow ? omittedKeys : [...omittedKeys, 'detailWindow'] });
  next.set('ledgerNo', String(ledgerNo));
  if (detailWindow) next.set('detailWindow', '1');
  return `/?${next.toString()}`;
}

function hideDetailPanelHref(params: Record<string, string | string[] | undefined>): string {
  const next = paramsWithout(params, { keys: ['detailPanel', 'detailWindow', 'actionMessage', 'clearDraft'] });
  const query = next.toString();
  return query ? `/?${query}` : '/';
}

function showDetailPanelHref(params: Record<string, string | string[] | undefined>): string {
  const next = paramsWithout(params, { keys: ['detailPanel', 'actionMessage', 'clearDraft'] });
  next.set('detailPanel', 'visible');
  return `/?${next.toString()}`;
}

function displayDateRangeValues(
  params: Record<string, string | string[] | undefined>,
  processingDateFrom: string | null | undefined,
  processingDateTo: string | null | undefined,
): { from: string; to: string } {
  const defaults = defaultDisplayDateRange();
  return {
    from: processingDateFrom ?? displayOnlyDate(params, 'displayDateFrom') ?? defaults.from,
    to: processingDateTo ?? displayOnlyDate(params, 'displayDateTo') ?? defaults.to,
  };
}

function displayOnlyDate(params: Record<string, string | string[] | undefined>, key: string): string | null {
  return Object.prototype.hasOwnProperty.call(params, key) ? firstParam(params[key]) ?? '' : null;
}

function defaultDisplayDateRange(): { from: string; to: string } {
  const today = todayInTokyo();
  return {
    from: subtractMonths(today, 1),
    to: today,
  };
}

function subtractMonths(dateText: string, months: number): string {
  const [year, month, day] = dateText.split('-').map(Number);
  const targetMonthIndex = (month ?? 1) - 1 - months;
  const targetYear = (year ?? 1970) + Math.floor(targetMonthIndex / 12);
  const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12;
  const targetDay = Math.min(day ?? 1, daysInMonth(targetYear, normalizedMonthIndex));
  return formatDate(targetYear, normalizedMonthIndex + 1, targetDay);
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function dateColumnFilterKeys(): string[] {
  return ledgerColumns
    .filter((column) => column.kind === 'date' || column.kind === 'datetime')
    .map((column) => `filter_${column.key}`);
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
  return displayDenominations(STAMP_DENOMINATIONS, quantities, (denomination) => !isLetterPackDenomination(denomination));
}

function displayLetterPackDenominations(quantities: Record<number, number>): number[] {
  return displayDenominations(LETTER_PACK_DENOMINATIONS, quantities, isLetterPackDenomination);
}

function displayDenominations(
  baseDenominations: readonly number[],
  quantities: Record<number, number>,
  includeHistorical: (denomination: number) => boolean,
): number[] {
  const active = new Set<number>(DENOMINATIONS);
  const historical = Object.entries(quantities)
    .filter(([denomination, quantity]) => {
      const value = Number(denomination);
      return !active.has(value) && includeHistorical(value) && quantity !== 0;
    })
    .map(([denomination]) => Number(denomination))
    .sort((a, b) => a - b);
  return [...baseDenominations, ...historical];
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
