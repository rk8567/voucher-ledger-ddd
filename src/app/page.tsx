import { DENOMINATIONS, quantityOf, stampQuantityCount } from '@/domain/denominations';
import { EntryTypeCode } from '@/domain/entryTypes';
import { getLedgerDashboardData, type LedgerSearchInput } from '@/server/ledger';

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

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function numberParam(value: string | string[] | undefined): number | null {
  const raw = firstParam(value);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
}

function dateParam(value: string | string[] | undefined): string | null {
  const raw = firstParam(value);
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
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
    ledgerNo: numberParam(params.ledgerNo),
  };
}

export default async function Page({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const input = parseSearchParams(params);

  try {
    const data = await getLedgerDashboardData(input);
    const selected = data.selectedEntry;

    return (
      <main className="shell">
        <header className="pageHeader">
          <div>
            <p className="eyebrow">Voucher Ledger</p>
            <h1>金券管理台帳</h1>
          </div>
          <div className="headerStats">
            <span>{data.entries.items.length} entries</span>
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
              <input type="date" name="processingDateFrom" defaultValue={firstParam(params.processingDateFrom) ?? ''} />
            </label>
            <label>
              <span>処理日 To</span>
              <input type="date" name="processingDateTo" defaultValue={firstParam(params.processingDateTo) ?? ''} />
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

        <div className="contentGrid">
          <section className="panel ledgerPanel" aria-label="Ledger entries">
            <div className="panelHeader">
              <h2>出納一覧</h2>
              <span>latest query limit 50</span>
            </div>
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
                        <td>{entry.processingDate}</td>
                        <td>{codeName(entry.branchCode, entry.branchName)}</td>
                        <td>{codeName(entry.entryTypeCode, entry.entryTypeName ?? entryTypeName(entry.entryTypeCode))}</td>
                        <td>{codeName(entry.responsibleEmployeeNo, entry.responsibleEmployeeName)}</td>
                        <td className="description">{entry.description}</td>
                        <td className="number">{yen(entry.otherAmountYen)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
                    ['処理日', selected.processingDate],
                    ['申請処理日', selected.applicationDate],
                    ['年/月', periodText(selected.periodYear, selected.periodMonth)],
                    ['連番', selected.dailySequence],
                    ['登録済', selected.postedAt],
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
                    ['登録日時', selected.registeredAt],
                    ['登録担当', codeName(selected.registeredByEmployeeNo, selected.registeredByEmployeeName)],
                    ['更新日時', selected.updatedAt],
                    ['更新担当', codeName(selected.updatedByEmployeeNo, selected.updatedByEmployeeName)],
                    ['作成日時', selected.createdAt],
                  ]}
                />
                <DetailSection
                  title="FileMaker"
                  rows={[
                    ['作成情報タイムスタンプ', selected.filemakerCreatedAt],
                    ['作成者', selected.filemakerCreatedBy],
                    ['修正情報タイムスタンプ', selected.filemakerModifiedAt],
                    ['修正者', selected.filemakerModifiedBy],
                    ['ID', selected.id],
                  ]}
                />
                <RawRecordSection rawRecord={selected.legacyRawRecord} />
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

function RawRecordSection({ rawRecord }: Readonly<{ rawRecord: Record<string, unknown> | null }>) {
  const rows = rawRecordRows(rawRecord);
  if (rows.length === 0) return null;

  return (
    <section className="detailSection">
      <h3>Legacy raw_record</h3>
      <div className="rawRecordGrid">
        {rows.map(([key, value]) => (
          <div key={key} className="rawRecordField">
            <span>{key}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function rawRecordRows(rawRecord: Record<string, unknown> | null): [string, string][] {
  if (!rawRecord) return [];
  const row = rawRecord.row && typeof rawRecord.row === 'object' && !Array.isArray(rawRecord.row)
    ? rawRecord.row as Record<string, unknown>
    : rawRecord;

  return Object.entries(row).map(([key, value]) => [key, rawValueText(value)]);
}

function rawValueText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value).replace(/\x1d/g, ' / ');
}

function displayValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
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

function queryHref(params: Record<string, string | string[] | undefined>, ledgerNo: number): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === 'ledgerNo') continue;
    const first = firstParam(value);
    if (first) next.set(key, first);
  }
  next.set('ledgerNo', String(ledgerNo));
  return `/?${next.toString()}`;
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
