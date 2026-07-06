'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react';

import type { LedgerEntryListRecord, LedgerEntryRecord } from '@/application/repositories/VoucherLedgerRepository';
import type { LedgerFormOptions } from '@/server/ledger';
import {
  columnOrderLedgerColumnCookieName,
  defaultLedgerColumnKeys,
  exportLedgerColumnCookieName,
  ledgerColumns,
  ledgerColumnKeys,
  ledgerFilterableKeys,
  normalizeLedgerColumnOrder,
  normalizeLedgerColumnKeys,
  orderedLedgerColumns,
  serializeLedgerColumnCookie,
  visibleLedgerColumnCookieName,
  type LedgerColumnDefinition,
} from './ledgerColumns';
import { dateOnly, limitText, yen } from './ledgerDisplayFormat';
import { tokyoTimestampForFileName, type LedgerExportFormat } from './ledgerExportFormat';
import { firstParam, paramsWithout, sortDirectionParam, sortKeyParam } from './ledgerSearchParams';

type LedgerTableProps = Readonly<{
  entries: LedgerEntryListRecord['items'];
  deletedEntries: LedgerEntryListRecord;
  selectedLedgerNo: number | null;
  selectedEntry: LedgerEntryRecord | null;
  params: Record<string, string | string[] | undefined>;
  filterOptions: LedgerFormOptions;
  effectiveBranchCode: number | null;
  displayDateRange: DisplayDateRange;
  initialVisibleColumnKeys: readonly string[];
  initialColumnOrderKeys: readonly string[];
  initialExportColumnKeys: readonly string[];
}>;

type ColumnDefinition = LedgerColumnDefinition;

type DisplayDateRange = Readonly<{
  from: string;
  to: string;
}>;

type TablePreset = Readonly<{
  id: string;
  name: string;
  visibleColumnKeys: readonly string[];
  columnOrderKeys: readonly string[];
  params: Record<string, string>;
  updatedAt: string;
}>;

type FadeFrame = Readonly<{
  top: number;
  bottom: number;
  left: number;
  right: number;
}>;

type FilterOption = Readonly<{
  value: string | number;
  label: string;
}>;

type FilePickerAcceptType = Readonly<{
  description: string;
  accept: Record<string, readonly string[]>;
}>;
type SaveFilePickerOptions = Readonly<{
  suggestedName?: string;
  types?: readonly FilePickerAcceptType[];
}>;
type FileSystemWritableFileStream = WritableStream & Readonly<{
  write: (data: Blob) => Promise<void>;
  close: () => Promise<void>;
}>;
type FileSystemFileHandle = Readonly<{
  createWritable: () => Promise<FileSystemWritableFileStream>;
}>;
type NativeSaveWindow = Window & Readonly<{
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
}>;

const columnStorageKey = 'voucher-ledger:visible-columns';
const columnOrderStorageKey = 'voucher-ledger:column-order';
const exportColumnStorageKey = 'voucher-ledger:export-columns';
const tablePresetStorageKey = 'voucher-ledger:table-presets';
const columnCookieMaxAgeSeconds = 60 * 60 * 24 * 365;
const filterPrefix = 'filter_';
const minYear = 1990;
const maxYear = 2035;
const columns = ledgerColumns;
const defaultColumnKeys = defaultLedgerColumnKeys;
const tablePresetParamKeys = [
  'branchCode',
  'periodYear',
  'periodMonth',
  'entryTypeCode',
  'processingDateFrom',
  'processingDateTo',
  'displayDateFrom',
  'displayDateTo',
  'sort',
  'dir',
  'limit',
] as const;

export function LedgerTable({
  entries,
  deletedEntries,
  selectedLedgerNo,
  selectedEntry,
  params,
  filterOptions,
  effectiveBranchCode,
  displayDateRange,
  initialVisibleColumnKeys,
  initialColumnOrderKeys,
  initialExportColumnKeys,
}: LedgerTableProps) {
  const router = useRouter();
  const [openColumnKey, setOpenColumnKey] = useState<string | null>(null);
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  const [exportWindowOpen, setExportWindowOpen] = useState(false);
  const [deletedView, setDeletedView] = useState(false);
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<readonly string[]>(() => normalizeLedgerColumnKeys(initialVisibleColumnKeys, defaultColumnKeys));
  const [columnOrderKeys, setColumnOrderKeys] = useState<readonly string[]>(() => normalizeLedgerColumnOrder(initialColumnOrderKeys));
  const [exportColumnKeys, setExportColumnKeys] = useState<readonly string[]>(() => normalizeLedgerColumnKeys(initialExportColumnKeys, defaultColumnKeys));
  const [draggedColumnKey, setDraggedColumnKey] = useState<string | null>(null);
  const [tablePresets, setTablePresets] = useState<readonly TablePreset[]>([]);
  const [presetName, setPresetName] = useState('');
  const [presetError, setPresetError] = useState<string | null>(null);
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const columnChooserDrag = useDraggablePopup();
  const [scrollLeft, setScrollLeft] = useState(0);
  const [maxScrollLeft, setMaxScrollLeft] = useState(0);
  const [fadeFrame, setFadeFrame] = useState<FadeFrame | null>(null);
  const tableEntries = deletedView ? deletedEntries.items : entries;

  const visibleKeySet = useMemo(() => new Set(visibleColumnKeys), [visibleColumnKeys]);
  const orderedVisibleColumnKeys = useMemo(
    () => columnOrderKeys.filter((key) => visibleKeySet.has(key)),
    [columnOrderKeys, visibleKeySet],
  );
  const visibleColumns = useMemo(
    () => orderedLedgerColumns(orderedVisibleColumnKeys),
    [orderedVisibleColumnKeys],
  );
  const columnChooserColumns = useMemo(
    () => orderedLedgerColumns(columnOrderKeys, ledgerColumnKeys),
    [columnOrderKeys],
  );
  const columnWidths = useMemo(() => {
    const widths = new Map<string, number>();
    for (const column of visibleColumns) widths.set(String(column.key), columnWidth(column, tableEntries));
    return widths;
  }, [tableEntries, visibleColumns]);
  const tableMinWidth = useMemo(
    () => visibleColumns.reduce((total, column) => total + (columnWidths.get(String(column.key)) ?? 150), 0),
    [columnWidths, visibleColumns],
  );

  useEffect(() => {
    setTablePresets(readTablePresets());
  }, []);

  useEffect(() => {
    updateTableUiState(tableWrapRef.current, setScrollLeft, setMaxScrollLeft, setFadeFrame);
    const tableWrap = tableWrapRef.current;
    if (!tableWrap) return;

    function handleLayoutChange() {
      updateTableUiState(tableWrap, setScrollLeft, setMaxScrollLeft, setFadeFrame);
    }

    tableWrap.addEventListener('scroll', handleLayoutChange);
    window.addEventListener('scroll', handleLayoutChange, { passive: true });
    window.addEventListener('resize', handleLayoutChange);
    return () => {
      tableWrap.removeEventListener('scroll', handleLayoutChange);
      window.removeEventListener('scroll', handleLayoutChange);
      window.removeEventListener('resize', handleLayoutChange);
    };
  }, [tableEntries, visibleColumns]);

  function setVisible(key: string, visible: boolean) {
    const current = new Set(visibleColumnKeys);
    if (visible) current.add(key);
    else current.delete(key);
    setVisibleColumnSelection(columnOrderKeys.filter((columnKey) => current.has(columnKey)), [key]);
  }

  function startColumnDrag(event: ReactDragEvent<HTMLElement>, key: string) {
    setDraggedColumnKey(key);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', key);
  }

  function previewColumnDrop(event: ReactDragEvent<HTMLDivElement>, targetKey: string) {
    if (!draggedColumnKey || draggedColumnKey === targetKey) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    moveColumnInOrder(draggedColumnKey, targetKey, event.currentTarget, event.clientY);
  }

  function allowColumnListDrag(event: ReactDragEvent<HTMLDivElement>) {
    if (!draggedColumnKey) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }

  function dropColumn(event: ReactDragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDraggedColumnKey(null);
  }

  function moveColumnInOrder(sourceKey: string, targetKey: string, targetElement: HTMLElement, clientY: number) {
    if (!sourceKey || sourceKey === targetKey) return;

    const current = [...columnOrderKeys];
    const sourceIndex = current.indexOf(sourceKey);
    const targetIndex = current.indexOf(targetKey);
    if (sourceIndex < 0 || targetIndex < 0) return;

    const [source] = current.splice(sourceIndex, 1);
    if (source == null) return;

    const targetIndexAfterRemoval = current.indexOf(targetKey);
    const targetBounds = targetElement.getBoundingClientRect();
    const shouldInsertAfter = clientY > targetBounds.top + targetBounds.height / 2;
    current.splice(targetIndexAfterRemoval + (shouldInsertAfter ? 1 : 0), 0, source);
    if (current.every((key, index) => key === columnOrderKeys[index])) return;
    setColumnOrder(current);
  }

  function setVisibleColumnSelection(next: readonly string[], fallback: readonly string[]) {
    const normalized = normalizeLedgerColumnKeys(next, fallback);
    setVisibleColumnKeys(normalized);
    persistColumnKeys(columnStorageKey, visibleLedgerColumnCookieName, normalized);
  }

  function setColumnOrder(next: readonly string[]) {
    const normalized = normalizeLedgerColumnOrder(next);
    setColumnOrderKeys(normalized);
    persistColumnKeys(columnOrderStorageKey, columnOrderLedgerColumnCookieName, normalized);
  }

  function resetColumns() {
    setVisibleColumnKeys(defaultColumnKeys);
    setColumnOrderKeys(normalizeLedgerColumnOrder(ledgerColumnKeys));
    clearColumnKeys(columnStorageKey, visibleLedgerColumnCookieName);
    clearColumnKeys(columnOrderStorageKey, columnOrderLedgerColumnCookieName);
  }

  function enableAllColumns() {
    setVisibleColumnSelection(columnOrderKeys, ledgerColumnKeys);
  }

  function setExportColumn(key: string, visible: boolean) {
    const next = visible
      ? [...exportColumnKeys, key]
      : exportColumnKeys.filter((columnKey) => columnKey !== key);
    const normalized = normalizeLedgerColumnKeys(next, [key]);
    setExportColumnKeys(normalized);
    persistColumnKeys(exportColumnStorageKey, exportLedgerColumnCookieName, normalized);
  }

  function saveTablePreset() {
    const name = presetName.trim();
    if (!name) {
      setPresetError('プリセット名を入力してください。');
      return;
    }

    const existing = tablePresets.find((preset) => preset.name === name);
    const preset: TablePreset = {
      id: existing?.id ?? createPresetId(),
      name,
      visibleColumnKeys: [...visibleColumnKeys],
      columnOrderKeys: [...columnOrderKeys],
      params: currentTablePresetParams(params, effectiveBranchCode, displayDateRange),
      updatedAt: new Date().toISOString(),
    };
    const next = [
      preset,
      ...tablePresets.filter((candidate) => candidate.id !== preset.id),
    ];
    setTablePresets(next);
    persistTablePresets(next);
    setPresetName('');
    setPresetError(null);
  }

  function applyTablePreset(preset: TablePreset) {
    setOpenColumnKey(null);
    setColumnMenuOpen(false);
    setPresetMenuOpen(false);
    setExportWindowOpen(false);
    setVisibleColumnSelection(preset.visibleColumnKeys, defaultColumnKeys);
    setColumnOrder(preset.columnOrderKeys);
    router.push(tablePresetHref(preset, params), { scroll: false });
  }

  function deleteTablePreset(presetId: string) {
    const next = tablePresets.filter((preset) => preset.id !== presetId);
    setTablePresets(next);
    persistTablePresets(next);
  }

  function setExportColumns(next: readonly string[]) {
    const normalized = normalizeLedgerColumnKeys(next, defaultColumnKeys);
    setExportColumnKeys(normalized);
    persistColumnKeys(exportColumnStorageKey, exportLedgerColumnCookieName, normalized);
  }

  function setTableScroll(value: number) {
    const tableWrap = tableWrapRef.current;
    if (!tableWrap) return;
    tableWrap.scrollLeft = clampNumber(value, 0, maxScrollLeft);
    updateTableUiState(tableWrap, setScrollLeft, setMaxScrollLeft, setFadeFrame);
  }

  function scrollByVisiblePage(direction: -1 | 1) {
    const tableWrap = tableWrapRef.current;
    if (!tableWrap) return;
    const amount = Math.max(tableWrap.clientWidth * 0.75, 240);
    setTableScroll(tableWrap.scrollLeft + direction * amount);
  }

  const canScrollLeft = scrollLeft > 2;
  const canScrollRight = maxScrollLeft - scrollLeft > 2;
  const currentSortKey = sortKeyParam(params.sort) ?? '';
  const currentSortDirection = sortDirectionParam(params.dir) ?? 'asc';
  const exportHref = ledgerExportHref(params);

  function openExportWindow() {
    setOpenColumnKey(null);
    setColumnMenuOpen(false);
    setPresetMenuOpen(false);
    setExportWindowOpen(true);
  }

  return (
    <>
      <div className="tableTools">
        <div className="tableCommandTools" aria-label="FileMaker commands">
          <button type="button" className="toolbarButton" onClick={openExportWindow}>出力</button>
          <a className="toolbarButton" href={showAllHref(params)}>全件表示</a>
          <button
            type="button"
            className={deletedView ? 'toolbarButton activeToggle' : 'toolbarButton'}
            onClick={() => {
              setOpenColumnKey(null);
              setColumnMenuOpen(false);
              setPresetMenuOpen(false);
              setExportWindowOpen(false);
              setDeletedView((current) => !current);
            }}
          >
            {deletedView ? '通常表示' : '削除済'}
          </button>
          <a className="toolbarButton" href={unsortHref(params)}>標準ソート</a>
        </div>
        <div className="tableViewTools">
          <button
            type="button"
            className={presetMenuOpen ? 'toolbarButton activeToggle' : 'toolbarButton'}
            onClick={() => {
              setOpenColumnKey(null);
              setColumnMenuOpen(false);
              setExportWindowOpen(false);
              setPresetMenuOpen((open) => !open);
            }}
          >
            プリセット
          </button>
          <button
            type="button"
            className="toolbarButton"
            onClick={() => {
              setOpenColumnKey(null);
              setPresetMenuOpen(false);
              setColumnMenuOpen((open) => !open);
            }}
          >
            表示列
          </button>
        </div>
      </div>
      <div className="tableViewport">
        {presetMenuOpen ? (
          <TablePresetPopover
            presets={tablePresets}
            presetName={presetName}
            presetError={presetError}
            onPresetNameChange={setPresetName}
            onSave={saveTablePreset}
            onApply={applyTablePreset}
            onDelete={deleteTablePreset}
            onClose={() => setPresetMenuOpen(false)}
          />
        ) : null}
        {columnMenuOpen ? (
          <div
            className="columnChooser"
            role="menu"
            aria-label="表示列"
            style={{ transform: dragTransform(columnChooserDrag.position) }}
          >
            <div className="columnChooserHeader popupDragHandle" {...columnChooserDrag.dragHandlers}>
              <strong>表示列</strong>
              <button type="button" className="toolbarIconButton" aria-label="閉じる" onClick={() => setColumnMenuOpen(false)}>×</button>
            </div>
            <div className="columnChooserList" onDragOver={allowColumnListDrag}>
              {columnChooserColumns.map((column) => {
                const columnKey = String(column.key);
                const visible = visibleKeySet.has(columnKey);
                return (
                  <div
                    key={column.key}
                    className={[
                      visible ? 'columnChoiceRow' : 'columnChoiceRow columnChoiceRowHidden',
                      draggedColumnKey === columnKey ? 'columnChoiceRowDragging' : '',
                    ].filter(Boolean).join(' ')}
                    draggable
                    onDragStart={(event) => startColumnDrag(event, columnKey)}
                    onDragOver={(event) => previewColumnDrop(event, columnKey)}
                    onDrop={dropColumn}
                    onDragEnd={() => setDraggedColumnKey(null)}
                  >
                    <span className="columnDragHandle" aria-hidden="true">
                      ☰
                    </span>
                    <label className="columnChoice">
                      <input
                        type="checkbox"
                        checked={visible}
                        draggable={false}
                        onChange={(event) => setVisible(columnKey, event.target.checked)}
                      />
                      <span>{column.label}</span>
                    </label>
                  </div>
                );
              })}
            </div>
            <div className="columnChooserActions">
              <button type="button" className="filterButton secondaryButton" onClick={resetColumns}>標準に戻す</button>
              <button type="button" className="filterButton secondaryButton" onClick={enableAllColumns}>全列表示</button>
            </div>
          </div>
        ) : null}
        <div className="tableWrap" ref={tableWrapRef}>
          <table style={{ minWidth: `${Math.max(tableMinWidth, 680)}px` }}>
            <colgroup>
              {visibleColumns.map((column) => (
                <col key={column.key} style={{ width: `${columnWidths.get(String(column.key)) ?? 150}px` }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {visibleColumns.map((column, index) => (
                  <th key={column.key} className={isNumeric(column) ? 'number' : undefined}>
                    <div className="columnHeaderControls">
                      {column.filterable === false ? (
                        <span className="columnTitleButton columnTitleStatic">
                          <span>{column.label}</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className={firstParam(params[filterName(column.key)]) ? 'columnTitleButton filteredColumn' : 'columnTitleButton'}
                          onClick={() => setOpenColumnKey(openColumnKey === column.key ? null : String(column.key))}
                        >
                          <span>{column.label}</span>
                        </button>
                      )}
                      {column.sortable ? (
                        <Link
                          className={currentSortKey === column.key ? 'columnSortButton activeSort' : 'columnSortButton'}
                          href={nextSortHref(params, String(column.key), currentSortKey, currentSortDirection)}
                          aria-label={`${column.label}の並び順を変更`}
                        >
                          {sortIcon(String(column.key), currentSortKey, currentSortDirection)}
                        </Link>
                      ) : null}
                    </div>
                    {column.filterable !== false && openColumnKey === column.key ? (
                      <ColumnFilterPopover
                        column={column}
                        params={params}
                        align={index >= visibleColumns.length - 2 ? 'right' : 'left'}
                        currentFilter={firstParam(params[filterName(column.key)]) ?? ''}
                        onClose={() => setOpenColumnKey(null)}
                        tableWrapRef={tableWrapRef}
                        options={columnFilterOptions(column, filterOptions)}
                        selectedValue={selectedEntry == null ? null : filterValueFromEntry(selectedEntry, column)}
                      />
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableEntries.map((entry) => {
                const href = queryHref(params, entry.ledgerNo);
                const isSelected = selectedLedgerNo === entry.ledgerNo;
                return (
                  <tr
                    key={entry.id}
                    className={isSelected ? 'clickableRow selectedRow' : 'clickableRow'}
                    role="link"
                    tabIndex={0}
                    aria-label={`出納No ${entry.ledgerNo} の明細を表示`}
                    onMouseDown={(event) => {
                      if (event.detail > 1) event.preventDefault();
                    }}
                    onClick={() => router.push(href, { scroll: false })}
                    onDoubleClick={(event) => {
                      event.preventDefault();
                      router.push(detailWindowHref(params, entry.ledgerNo), { scroll: false });
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      router.push(href, { scroll: false });
                    }}
                  >
                    {visibleColumns.map((column) => (
                      <td key={`${entry.id}-${column.key}`} className={cellClassName(column)}>
                        {renderTableCell(entry, column, params)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {canScrollLeft && fadeFrame ? (
          <button
            type="button"
            className="tableScrollFade tableScrollFadeLeft"
            style={{ top: fadeFrame.top, bottom: fadeFrame.bottom, left: fadeFrame.left }}
            aria-label="左へスクロール"
            onClick={() => scrollByVisiblePage(-1)}
          />
        ) : null}
        {canScrollRight && fadeFrame ? (
          <button
            type="button"
            className="tableScrollFade tableScrollFadeRight"
            style={{ top: fadeFrame.top, bottom: fadeFrame.bottom, right: fadeFrame.right }}
            aria-label="右へスクロール"
            onClick={() => scrollByVisiblePage(1)}
          />
        ) : null}
      </div>
      {exportWindowOpen ? (
        <ExportWindow
          exportHref={exportHref}
          selectedColumnKeys={exportColumnKeys}
          visibleColumnKeys={orderedVisibleColumnKeys}
          onColumnChange={setExportColumn}
          onSetColumns={setExportColumns}
          onClose={() => setExportWindowOpen(false)}
        />
      ) : null}
    </>
  );
}

function renderTableCell(
  entry: LedgerEntryRecord,
  column: ColumnDefinition,
  params: Record<string, string | string[] | undefined>,
): ReactNode {
  if (column.key === 'ledgerNo') {
    return (
      <LedgerEntryLink ledgerNo={entry.ledgerNo} params={params} title="明細ウィンドウを開く">
        #{entry.ledgerNo}
      </LedgerEntryLink>
    );
  }

  const referenceLedgerNo = linkedLedgerNo(entry, column);
  if (referenceLedgerNo == null) return displayCell(entry, column);

  return (
    <LedgerEntryLink ledgerNo={referenceLedgerNo} params={params} title="対応する伝票を開く">
      {referenceLedgerNo}
    </LedgerEntryLink>
  );
}

function LedgerEntryLink({
  ledgerNo,
  params,
  title,
  children,
}: Readonly<{
  ledgerNo: number;
  params: Record<string, string | string[] | undefined>;
  title: string;
  children: ReactNode;
}>) {
  return (
    <Link
      href={detailWindowHref(params, ledgerNo)}
      scroll={false}
      title={title}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {children}
    </Link>
  );
}

function linkedLedgerNo(entry: LedgerEntryRecord, column: ColumnDefinition): number | null {
  if (
    column.key !== 'originalLedgerNo'
    && column.key !== 'reversalLedgerNo'
    && column.key !== 'correctionLedgerNo'
  ) {
    return null;
  }

  const value = entry[column.key];
  return typeof value === 'number' ? value : null;
}

function persistColumnKeys(storageKey: string, cookieName: string, keys: readonly string[]) {
  window.localStorage.setItem(storageKey, JSON.stringify(keys));
  document.cookie = `${cookieName}=${serializeLedgerColumnCookie(keys)}; Path=/; Max-Age=${columnCookieMaxAgeSeconds}; SameSite=Lax`;
}

function clearColumnKeys(storageKey: string, cookieName: string) {
  window.localStorage.removeItem(storageKey);
  document.cookie = `${cookieName}=; Path=/; Max-Age=0; SameSite=Lax`;
}

function TablePresetPopover({
  presets,
  presetName,
  presetError,
  onPresetNameChange,
  onSave,
  onApply,
  onDelete,
  onClose,
}: Readonly<{
  presets: readonly TablePreset[];
  presetName: string;
  presetError: string | null;
  onPresetNameChange: (value: string) => void;
  onSave: () => void;
  onApply: (preset: TablePreset) => void;
  onDelete: (presetId: string) => void;
  onClose: () => void;
}>) {
  return (
    <div className="tablePresetPopover" role="menu" aria-label="表プリセット">
      <div className="columnChooserHeader">
        <strong>プリセット</strong>
        <button type="button" className="toolbarIconButton" aria-label="閉じる" onClick={onClose}>×</button>
      </div>
      <form
        className="tablePresetForm"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <label>
          <span>名前</span>
          <input
            value={presetName}
            onChange={(event) => onPresetNameChange(event.target.value)}
            maxLength={40}
            placeholder="例: 月次確認"
          />
        </label>
        <button type="submit" className="filterButton">保存</button>
      </form>
      {presetError ? <p className="tablePresetError" role="alert">{presetError}</p> : null}
      <div className="tablePresetList">
        {presets.length === 0 ? (
          <p className="emptyState compactEmptyState">保存済みプリセットはありません。</p>
        ) : (
          presets.map((preset) => (
            <div key={preset.id} className="tablePresetRow">
              <div className="tablePresetSummary">
                <strong>{preset.name}</strong>
                <span>{formatPresetUpdatedAt(preset.updatedAt)}</span>
              </div>
              <div className="tablePresetActions">
                <button type="button" className="secondaryButton" onClick={() => onApply(preset)}>適用</button>
                <button type="button" className="secondaryButton dangerButton" onClick={() => onDelete(preset.id)}>削除</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function currentTablePresetParams(
  params: Record<string, string | string[] | undefined>,
  effectiveBranchCode: number | null,
  displayDateRange: DisplayDateRange,
): Record<string, string> {
  const next = new URLSearchParams();
  for (const key of tablePresetParamKeys) {
    appendPresetParam(next, key, firstParam(params[key]));
  }
  for (const [key, value] of Object.entries(params)) {
    if (!key.startsWith(filterPrefix)) continue;
    appendPresetParam(next, key, firstParam(value));
  }
  if (!next.has('branchCode') && effectiveBranchCode != null) {
    next.set('branchCode', String(effectiveBranchCode));
  }
  if (!next.has('processingDateFrom') && !next.has('displayDateFrom')) {
    next.set('displayDateFrom', displayDateRange.from);
  }
  if (!next.has('processingDateTo') && !next.has('displayDateTo')) {
    next.set('displayDateTo', displayDateRange.to);
  }
  return Object.fromEntries(next.entries());
}

function appendPresetParam(params: URLSearchParams, key: string, value: string | undefined) {
  const trimmed = value?.trim();
  if (trimmed) params.set(key, trimmed);
}

function tablePresetHref(preset: TablePreset, params: Record<string, string | string[] | undefined>): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(preset.params)) {
    appendPresetParam(next, key, value);
  }
  appendPresetParam(next, 'detailPanel', firstParam(params.detailPanel));
  const query = next.toString();
  return query ? `/?${query}` : '/';
}

function readTablePresets(): readonly TablePreset[] {
  try {
    const raw = window.localStorage.getItem(tablePresetStorageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(tablePresetFromUnknown)
      .filter((preset): preset is TablePreset => preset != null);
  } catch {
    return [];
  }
}

function persistTablePresets(presets: readonly TablePreset[]) {
  try {
    window.localStorage.setItem(tablePresetStorageKey, JSON.stringify(presets));
  } catch {
    // Browser storage may be disabled; the active UI state still remains usable.
  }
}

function tablePresetFromUnknown(value: unknown): TablePreset | null {
  if (!isRecord(value)) return null;
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (!name) return null;
  return {
    id: typeof value.id === 'string' && value.id ? value.id : createPresetId(),
    name,
    visibleColumnKeys: normalizeLedgerColumnKeys(stringArray(value.visibleColumnKeys), defaultColumnKeys),
    columnOrderKeys: normalizeLedgerColumnOrder(stringArray(value.columnOrderKeys)),
    params: sanitizePresetParams(value.params),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date(0).toISOString(),
  };
}

function sanitizePresetParams(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const allowedKeys = new Set<string>(tablePresetParamKeys);
  const allowedFilterKeys = new Set(ledgerFilterableKeys.map((key) => filterName(key)));
  const params: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (!allowedKeys.has(key) && !allowedFilterKeys.has(key)) continue;
    if (typeof rawValue !== 'string') continue;
    const trimmed = rawValue.trim();
    if (trimmed) params[key] = trimmed;
  }
  return params;
}

function createPresetId(): string {
  return window.crypto.randomUUID();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function formatPresetUpdatedAt(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

function ExportWindow({
  exportHref,
  selectedColumnKeys,
  visibleColumnKeys,
  onColumnChange,
  onSetColumns,
  onClose,
}: Readonly<{
  exportHref: string;
  selectedColumnKeys: readonly string[];
  visibleColumnKeys: readonly string[];
  onColumnChange: (key: string, visible: boolean) => void;
  onSetColumns: (keys: readonly string[]) => void;
  onClose: () => void;
}>) {
  const [saveFormat, setSaveFormat] = useState<LedgerExportFormat>('csv-comma');

  return (
    <div className="modalBackdrop exportBackdrop" role="presentation">
      <section className="entryModal exportWindow" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <div className="modalHeader">
          <h2 id="export-title">出力</h2>
          <button type="button" className="secondaryButton" onClick={onClose}>閉じる</button>
        </div>
        <div className="exportBody">
          <div className="exportColumnActions">
            <button type="button" className="secondaryButton" onClick={() => onSetColumns(visibleColumnKeys)}>表示列</button>
            <button type="button" className="secondaryButton" onClick={() => onSetColumns(columns.map((column) => column.key))}>全選択</button>
            <button type="button" className="secondaryButton" onClick={() => onSetColumns(defaultColumnKeys)}>標準</button>
          </div>
          <div className="exportColumnList" aria-label="出力列">
            {columns.map((column) => (
              <label key={column.key} className="columnChoice">
                <input
                  type="checkbox"
                  checked={selectedColumnKeys.includes(column.key)}
                  onChange={(event) => onColumnChange(String(column.key), event.target.checked)}
                />
                <span>{column.label}</span>
              </label>
            ))}
          </div>
          <div className="exportSaveMenu">
            <label>
              <span>保存形式</span>
              <select value={saveFormat} onChange={(event) => setSaveFormat(event.target.value as LedgerExportFormat)}>
                <option value="csv-comma">.csv カンマ区切り</option>
                <option value="csv-tab">.tsv タブ区切り</option>
                <option value="html">.html</option>
              </select>
            </label>
            <div className="exportSaveActions">
              <button type="button" className="secondaryButton" onClick={() => saveCurrentTable(exportHref, visibleColumnKeys, saveFormat)}>現在の表を保存</button>
              <button type="button" className="secondaryButton" onClick={() => saveSearchResults(exportHref, selectedColumnKeys, saveFormat)}>検索結果を保存</button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function exportFormatHref(exportHref: string, format: LedgerExportFormat, selectedColumnKeys: readonly string[]): string {
  const url = new URL(exportHref, 'http://local');
  url.searchParams.set('format', format);
  url.searchParams.set('columns', selectedColumnKeys.join(','));
  const query = url.searchParams.toString();
  return `${url.pathname}${query ? `?${query}` : ''}`;
}

function ledgerExportHref(params: Record<string, string | string[] | undefined>): string {
  const next = paramsWithout(params, { keys: ['ledgerNo', 'page', 'actionMessage', 'clearDraft'] });
  const query = next.toString();
  return query ? `/export/ledger?${query}` : '/export/ledger';
}

function unsortHref(params: Record<string, string | string[] | undefined>): string {
  const next = paramsWithout(params, { keys: ['ledgerNo', 'page', 'sort', 'dir', 'actionMessage', 'clearDraft'] });
  const query = next.toString();
  return query ? `/?${query}` : '/';
}

async function saveCurrentTable(exportHref: string, visibleColumnKeys: readonly string[], format: LedgerExportFormat) {
  await saveExportedLedger(exportHref, visibleColumnKeys, format, `voucher-ledger-table-${tokyoTimestampForFileName()}.${extensionForFormat(format)}`);
}

async function saveSearchResults(exportHref: string, selectedColumnKeys: readonly string[], format: LedgerExportFormat) {
  await saveExportedLedger(exportHref, selectedColumnKeys, format, `voucher-ledger-${tokyoTimestampForFileName()}.${extensionForFormat(format)}`);
}

async function saveExportedLedger(exportHref: string, selectedColumnKeys: readonly string[], format: LedgerExportFormat, suggestedName: string) {
  const response = await fetch(exportFormatHref(exportHref, format, selectedColumnKeys), { cache: 'no-store' });
  if (!response.ok) throw new Error('Export failed');
  const blob = await response.blob();
  await saveBlob(blob, suggestedName, format);
}

async function saveBlob(blob: Blob, suggestedName: string, format: LedgerExportFormat) {
  const nativeWindow = window as NativeSaveWindow;
  if (nativeWindow.showSaveFilePicker) {
    try {
      const handle = await nativeWindow.showSaveFilePicker({
        suggestedName,
        types: [filePickerTypeForFormat(format)],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      throw error;
    }
  }
  downloadBlob(blob, suggestedName);
}

function downloadBlob(blob: Blob, suggestedName: string) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = suggestedName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

function extensionForFormat(format: LedgerExportFormat): 'csv' | 'tsv' | 'html' {
  if (format === 'html') return 'html';
  return format === 'csv-tab' ? 'tsv' : 'csv';
}

function mimeTypeForFormat(format: LedgerExportFormat): string {
  if (format === 'html') return 'text/html;charset=utf-8';
  return `${format === 'csv-tab' ? 'text/tab-separated-values' : 'text/csv'};charset=utf-8`;
}

function filePickerTypeForFormat(format: LedgerExportFormat): FilePickerAcceptType {
  if (format === 'html') {
    return { description: 'HTML', accept: { 'text/html': ['.html'] } };
  }
  if (format === 'csv-tab') {
    return { description: 'Tab-separated values', accept: { 'text/tab-separated-values': ['.tsv'] } };
  }
  return { description: 'CSV', accept: { 'text/csv': ['.csv'] } };
}

function ColumnFilterPopover({
  column,
  params,
  align,
  currentFilter,
  onClose,
  tableWrapRef,
  options,
  selectedValue,
}: Readonly<{
  column: ColumnDefinition;
  params: Record<string, string | string[] | undefined>;
  align: 'left' | 'right';
  currentFilter: string;
  onClose: () => void;
  tableWrapRef: RefObject<HTMLDivElement | null>;
  options: readonly FilterOption[];
  selectedValue: string | null;
}>) {
  const [value, setValue] = useState(() => initialFilterValue(column, currentFilter));
  const popupBounds = useCallback(() => visibleTableBounds(tableWrapRef.current), [tableWrapRef]);
  const drag = useDraggablePopup(popupBounds);
  const effectiveValue = filterValue(value);

  useLayoutEffect(() => {
    drag.clampPosition();
  }, [drag.clampPosition]);

  useEffect(() => {
    const tableWrap = tableWrapRef.current;
    function handleScopeChange() {
      drag.clampPosition();
    }

    tableWrap?.addEventListener('scroll', handleScopeChange);
    window.addEventListener('scroll', handleScopeChange, { passive: true });
    window.addEventListener('resize', handleScopeChange);
    return () => {
      tableWrap?.removeEventListener('scroll', handleScopeChange);
      window.removeEventListener('scroll', handleScopeChange);
      window.removeEventListener('resize', handleScopeChange);
    };
  }, [drag.clampPosition, tableWrapRef]);

  return (
    <div
      ref={drag.popupRef}
      className={align === 'right' ? 'columnFilterPopover alignRight' : 'columnFilterPopover'}
      style={{ transform: dragTransform(drag.position) }}
    >
      <div className="popupDragHandle" {...drag.dragHandlers}>
        <strong>{column.label}</strong>
        <button type="button" className="toolbarIconButton" aria-label="閉じる" onClick={onClose}>×</button>
      </div>
      <FilterControl
        column={column}
        value={value}
        options={options}
        onValueChange={setValue}
      />
      <div className="columnFilterActions">
        <a className="filterButton" href={applyFilterHref(params, column, effectiveValue)}>絞込</a>
        {selectedValue ? <a className="filterButton secondaryButton" href={applyFilterHref(params, column, selectedValue)}>選択値</a> : null}
        {currentFilter ? <a className="filterButton secondaryButton" href={clearFilterHref(params, column.key)}>解除</a> : null}
      </div>
    </div>
  );
}

function FilterControl({
  column,
  value,
  options,
  onValueChange,
}: Readonly<{
  column: ColumnDefinition;
  value: string;
  options: readonly FilterOption[];
  onValueChange: (value: string) => void;
}>) {
  if (options.length > 0) {
    const optionListId = `filter-options-${column.key}`;
    return (
      <label>
        <input
          type="search"
          list={optionListId}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          aria-label={column.label}
          placeholder="入力または選択"
        />
        <datalist id={optionListId}>
          {options.map((option) => (
            <option key={`${column.key}-${option.value}`} value={String(option.value)} label={option.label} />
          ))}
        </datalist>
      </label>
    );
  }

  if (column.kind === 'date' || column.kind === 'datetime') {
    return (
      <label>
        <input
          type="date"
          value={dateFilterValue(value)}
          lang="ja-JP"
          onChange={(event) => onValueChange(slashDate(event.target.value))}
          aria-label={column.label}
        />
      </label>
    );
  }

  if (column.kind === 'year') {
    return (
      <NumberField label="年" min={minYear} max={maxYear} value={clampNumber(numericValue(value, new Date().getFullYear()), minYear, maxYear)} onChange={(next) => onValueChange(String(next))} showLabel={false} />
    );
  }

  if (column.kind === 'month') {
    return (
      <NumberField label="月" min={1} max={12} value={clampNumber(numericValue(value, 1), 1, 12)} onChange={(next) => onValueChange(String(next))} showLabel={false} />
    );
  }

  const numericBounds = numericFilterBounds(column);
  return (
    <label>
      <input
        type={column.kind === 'integer' || column.kind === 'money' ? 'number' : 'search'}
        inputMode={column.kind === 'integer' || column.kind === 'money' ? 'numeric' : undefined}
        min={numericBounds.min}
        max={numericBounds.max}
        step="1"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        aria-label={column.label}
        placeholder="条件"
      />
    </label>
  );
}

function numericFilterBounds(column: ColumnDefinition): { min?: number; max?: number } {
  if (column.kind !== 'integer' && column.kind !== 'money') return {};
  return { min: 0 };
}

function NumberField({
  label,
  min,
  max,
  value,
  onChange,
  showLabel = true,
}: Readonly<{
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
  showLabel?: boolean;
}>) {
  return (
    <label className={showLabel ? 'numberFilterField' : 'numberFilterField numberFilterFieldCompact'}>
      {showLabel ? <span>{label}</span> : null}
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step="1"
        value={value}
        aria-label={label}
        title={label}
        placeholder={label}
        onChange={(event) => onChange(clampNumber(Number(event.target.value), min, max))}
      />
    </label>
  );
}

function filterName(columnKey: string): string {
  return `${filterPrefix}${columnKey}`;
}

function columnFilterOptions(column: ColumnDefinition, filterOptions: LedgerFormOptions): readonly FilterOption[] {
  if (!column.optionsKey) return [];
  return filterOptions[column.optionsKey].map((option) => ({
    value: option.label,
    label: option.label,
  }));
}

function useDraggablePopup(bounds: () => DOMRect | null = () => null) {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const positionRef = useRef(position);
  const popupRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  function handlePointerDown(event: ReactPointerEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest('button, a, input, select, textarea')) return;
    const current = positionRef.current;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: current.x,
      originY: current.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const proposed = {
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    };
    const next = clampPopupPosition(proposed, positionRef.current, popupRef.current, bounds());
    positionRef.current = next;
    setPosition(next);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (drag?.pointerId === event.pointerId) dragRef.current = null;
  }

  const clampPosition = useCallback(() => {
    if (dragRef.current) return;
    setPosition((current) => {
      const next = clampPopupPosition(current, current, popupRef.current, bounds());
      positionRef.current = next;
      return next;
    });
  }, [bounds]);

  return {
    position,
    popupRef,
    clampPosition,
    isDragging: () => dragRef.current !== null,
    dragHandlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerUp,
    },
  };
}

function clampPopupPosition(
  proposed: Readonly<{ x: number; y: number }>,
  current: Readonly<{ x: number; y: number }>,
  popup: HTMLElement | null,
  bounds: DOMRect | null,
): { x: number; y: number } {
  if (!popup || !bounds) return { x: proposed.x, y: proposed.y };

  const rect = popup.getBoundingClientRect();
  const dx = proposed.x - current.x;
  const dy = proposed.y - current.y;
  const next = {
    left: rect.left + dx,
    right: rect.right + dx,
    top: rect.top + dy,
    bottom: rect.bottom + dy,
  };
  let x = proposed.x;
  let y = proposed.y;
  const padding = 6;

  if (next.left < bounds.left + padding) x += bounds.left + padding - next.left;
  if (next.right > bounds.right - padding) x -= next.right - (bounds.right - padding);
  if (next.top < bounds.top + padding) y += bounds.top + padding - next.top;
  if (next.bottom > bounds.bottom - padding) y -= next.bottom - (bounds.bottom - padding);

  return { x, y };
}

function dragTransform(position: Readonly<{ x: number; y: number }>): string {
  return `translate(${position.x}px, ${position.y}px)`;
}

function updateTableUiState(
  tableWrap: HTMLDivElement | null,
  setScrollLeft: (value: number) => void,
  setMaxScrollLeft: (value: number) => void,
  setFadeFrame: (value: FadeFrame | null) => void,
) {
  if (!tableWrap) {
    setFadeFrame(null);
    return;
  }
  setScrollLeft(tableWrap.scrollLeft);
  setMaxScrollLeft(Math.max(0, tableWrap.scrollWidth - tableWrap.clientWidth));
  setFadeFrame(tableFadeFrame(tableWrap));
}

function tableFadeFrame(tableWrap: HTMLDivElement): FadeFrame | null {
  const bounds = visibleTableBodyBounds(tableWrap);
  if (!bounds || bounds.height < 80) return null;

  return {
    top: bounds.top,
    bottom: Math.max(window.innerHeight - bounds.bottom, 0),
    left: bounds.left,
    right: Math.max(window.innerWidth - bounds.right, 0),
  };
}

function visibleTableBodyBounds(tableWrap: HTMLDivElement | null): DOMRect | null {
  if (!tableWrap) return null;
  const rect = tableWrap.getBoundingClientRect();
  const headerHeight = tableWrap.querySelector('thead')?.getBoundingClientRect().height ?? 40;
  const left = Math.max(rect.left, 0);
  const right = Math.min(rect.right, window.innerWidth);
  const top = Math.max(rect.top + headerHeight, 0);
  const bottom = Math.min(rect.bottom, window.innerHeight);
  if (right - left <= 0 || bottom - top <= 0) return null;
  return new DOMRect(left, top, right - left, bottom - top);
}

function visibleTableBounds(tableWrap: HTMLDivElement | null): DOMRect | null {
  if (!tableWrap) return null;
  const rect = tableWrap.getBoundingClientRect();
  const left = Math.max(rect.left, 0);
  const right = Math.min(rect.right, window.innerWidth);
  const top = Math.max(rect.top, 0);
  const bottom = Math.min(rect.bottom, window.innerHeight);
  if (right - left <= 0 || bottom - top <= 0) return null;
  return new DOMRect(left, top, right - left, bottom - top);
}

function columnWidth(column: ColumnDefinition, entries: LedgerEntryListRecord['items']): number {
  const currentPageMax = entries.reduce((maxLength, entry) => {
    const cellLength = displayCell(entry, column).length;
    return Math.max(maxLength, cellLength);
  }, column.label.length);
  const contentCharWidth = isNumeric(column) ? 9 : 12;
  const headerWidth = column.label.length * 14 + (column.sortable ? 66 : 28);
  const contentWidth = currentPageMax * contentCharWidth + (column.sortable ? 52 : 24);
  return clampNumber(Math.max(headerWidth, contentWidth), 96, 260);
}

function isNumeric(column: ColumnDefinition): boolean {
  return column.kind === 'integer' || column.kind === 'money' || column.kind === 'year' || column.kind === 'month';
}

function cellClassName(column: ColumnDefinition): string | undefined {
  if (column.key === 'ledgerNo') return 'ledgerNoCell';
  if (isNumeric(column)) return 'number';
  if (column.key === 'description') return 'description';
  return undefined;
}

function dateFilterValue(value: string): string {
  const normalized = value.trim().replaceAll('/', '-');
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : todayInTokyo();
}

function initialFilterValue(column: ColumnDefinition, value: string): string {
  if (column.kind !== 'date' && column.kind !== 'datetime') return value;
  const normalized = dateFilterValue(value);
  return slashDate(normalized);
}

function filterValue(value: string): string {
  return value.trim();
}

function slashDate(value: string): string {
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

function numericValue(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function sortIcon(columnKey: string, currentSortKey: string, currentSortDirection: 'asc' | 'desc'): string {
  if (columnKey !== currentSortKey) return '↕';
  return currentSortDirection === 'asc' ? '▲' : '▼';
}

function displayCell(entry: LedgerEntryRecord, column: ColumnDefinition): string {
  const value = entry[column.key as keyof LedgerEntryRecord];
  if (column.key === 'processingDate' || column.key === 'applicationDate' || column.key.toLowerCase().endsWith('at')) {
    return typeof value === 'string' ? dateOnly(value) ?? '-' : '-';
  }
  if (column.key === 'otherAmountYen') return yen(Number(value ?? 0));
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value == null || value === '') return '-';
  const text = String(value);
  return column.kind === 'text' ? limitText(text, 10) : text;
}

function filterValueFromEntry(entry: LedgerEntryRecord, column: ColumnDefinition): string | null {
  const value = column.key === 'otherAmountYen'
    ? entry.otherAmountYen
    : entry[column.key as keyof LedgerEntryRecord];
  if (value == null || value === '') return null;
  if (column.kind === 'date' || column.kind === 'datetime') {
    return typeof value === 'string' ? dateOnly(value) : null;
  }
  return String(value);
}

function queryHref(params: Record<string, string | string[] | undefined>, ledgerNo: number): string {
  return entryHref(params, ledgerNo);
}

function detailWindowHref(params: Record<string, string | string[] | undefined>, ledgerNo: number): string {
  return entryHref(params, ledgerNo, { detailWindow: true });
}

function entryHref(
  params: Record<string, string | string[] | undefined>,
  ledgerNo: number,
  options: Readonly<{ detailWindow?: boolean }> = {},
): string {
  const next = paramsWithout(params, { keys: ['ledgerNo', 'detailWindow', 'actionMessage', 'clearDraft'] });
  next.set('ledgerNo', String(ledgerNo));
  if (options.detailWindow) next.set('detailWindow', '1');
  return `/?${next.toString()}`;
}

function clearFilterHref(params: Record<string, string | string[] | undefined>, columnKey: string): string {
  const next = paramsWithout(params, { keys: [filterName(columnKey), 'ledgerNo', 'page', 'actionMessage', 'clearDraft'] });
  const query = next.toString();
  return query ? `/?${query}` : '/';
}

function showAllHref(params: Record<string, string | string[] | undefined>): string {
  const preserved = new URLSearchParams();
  preserveDisplayDate(params, preserved, 'processingDateFrom', 'displayDateFrom');
  preserveDisplayDate(params, preserved, 'processingDateTo', 'displayDateTo');
  const query = preserved.toString();
  return query ? `/?${query}` : '/';
}

function preserveDisplayDate(
  params: Record<string, string | string[] | undefined>,
  preserved: URLSearchParams,
  filterKey: string,
  displayKey: string,
) {
  if (Object.prototype.hasOwnProperty.call(params, filterKey)) {
    preserved.set(displayKey, firstParam(params[filterKey]) ?? '');
    return;
  }
  if (Object.prototype.hasOwnProperty.call(params, displayKey)) {
    preserved.set(displayKey, firstParam(params[displayKey]) ?? '');
  }
}

function applyFilterHref(params: Record<string, string | string[] | undefined>, column: ColumnDefinition, value: string): string {
  const keys = [filterName(column.key), 'ledgerNo', 'page', 'actionMessage', 'clearDraft'];
  if (column.kind === 'date' || column.kind === 'datetime') {
    keys.push('dateRange', 'processingDateFrom', 'processingDateTo', 'displayDateFrom', 'displayDateTo');
  }
  const next = paramsWithout(params, { keys });
  if (value.trim()) next.set(filterName(column.key), value.trim());
  const query = next.toString();
  return query ? `/?${query}` : '/';
}

function nextSortHref(
  params: Record<string, string | string[] | undefined>,
  sortKey: string,
  currentSortKey: string,
  currentSortDirection: 'asc' | 'desc',
): string {
  const nextDirection = sortKey !== currentSortKey
    ? 'asc'
    : currentSortDirection === 'asc'
      ? 'desc'
      : null;
  const next = paramsWithout(params, { keys: ['ledgerNo', 'page', 'sort', 'dir', 'actionMessage', 'clearDraft'] });
  if (nextDirection) {
    next.set('sort', sortKey);
    next.set('dir', nextDirection);
  }
  const query = next.toString();
  return query ? `/?${query}` : '/';
}
