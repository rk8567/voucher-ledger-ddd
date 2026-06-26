'use client';

import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';

import type { LedgerEntryListRecord, LedgerEntryRecord } from '@/application/repositories/VoucherLedgerRepository';
import type { LedgerFormOptions } from '@/server/ledger';
import { openEntryWorkflowEvent } from './entryWorkflowEvents';
import { defaultLedgerColumnKeys, ledgerColumns, type LedgerColumnDefinition } from './ledgerColumns';
import { dateOnly, limitText, yen } from './ledgerDisplayFormat';
import { delimitedText, htmlTable, tokyoTimestampForFileName } from './ledgerExportFormat';
import { booleanParam, firstParam, paramsWithout, sortDirectionParam, sortKeyParam } from './ledgerSearchParams';

type LedgerTableProps = Readonly<{
  entries: LedgerEntryListRecord['items'];
  selectedLedgerNo: number | null;
  params: Record<string, string | string[] | undefined>;
  filterOptions: LedgerFormOptions;
}>;

type ColumnDefinition = LedgerColumnDefinition;

type DateParts = Readonly<{
  year: number;
  month: number;
  day: number;
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

type SaveFormat = 'csv-comma' | 'csv-tab' | 'html';
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
const exportColumnStorageKey = 'voucher-ledger:export-columns';
const filterPrefix = 'filter_';
const minYear = 1990;
const maxYear = 2035;
const columns = ledgerColumns;
const defaultColumnKeys = defaultLedgerColumnKeys;

export function LedgerTable({
  entries,
  selectedLedgerNo,
  params,
  filterOptions,
}: LedgerTableProps) {
  const [openColumnKey, setOpenColumnKey] = useState<string | null>(null);
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const [exportWindowOpen, setExportWindowOpen] = useState(false);
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<readonly string[]>(defaultColumnKeys);
  const [exportColumnKeys, setExportColumnKeys] = useState<readonly string[]>(defaultColumnKeys);
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const columnChooserDrag = useDraggablePopup();
  const [scrollLeft, setScrollLeft] = useState(0);
  const [maxScrollLeft, setMaxScrollLeft] = useState(0);
  const [fadeFrame, setFadeFrame] = useState<FadeFrame | null>(null);

  useEffect(() => {
    const raw = window.localStorage.getItem(columnStorageKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const validKeys = parsed.filter((key) => columns.some((column) => column.key === key));
      if (validKeys.length > 0) setVisibleColumnKeys(validKeys);
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    const raw = window.localStorage.getItem(exportColumnStorageKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const validKeys = parsed.filter((key) => columns.some((column) => column.key === key));
      if (validKeys.length > 0) setExportColumnKeys(validKeys);
    } catch {
      return;
    }
  }, []);

  const visibleColumns = useMemo(
    () => columns.filter((column) => visibleColumnKeys.includes(column.key)),
    [visibleColumnKeys],
  );
  const columnWidths = useMemo(() => {
    const widths = new Map<string, number>();
    for (const column of visibleColumns) widths.set(String(column.key), columnWidth(column, entries));
    return widths;
  }, [entries, visibleColumns]);
  const tableMinWidth = useMemo(
    () => visibleColumns.reduce((total, column) => total + (columnWidths.get(String(column.key)) ?? 150), 0),
    [columnWidths, visibleColumns],
  );

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
  }, [entries, visibleColumns]);

  function setVisible(key: string, visible: boolean) {
    const next = visible
      ? [...visibleColumnKeys, key]
      : visibleColumnKeys.filter((columnKey) => columnKey !== key);
    const normalized = next.length > 0 ? columns.map((column) => column.key).filter((columnKey) => next.includes(columnKey)) : [key];
    setVisibleColumnKeys(normalized);
    window.localStorage.setItem(columnStorageKey, JSON.stringify(normalized));
  }

  function resetColumns() {
    setVisibleColumnKeys(defaultColumnKeys);
    window.localStorage.removeItem(columnStorageKey);
  }

  function setExportColumn(key: string, visible: boolean) {
    const next = visible
      ? [...exportColumnKeys, key]
      : exportColumnKeys.filter((columnKey) => columnKey !== key);
    const normalized = next.length > 0 ? columns.map((column) => column.key).filter((columnKey) => next.includes(columnKey)) : [key];
    setExportColumnKeys(normalized);
    window.localStorage.setItem(exportColumnStorageKey, JSON.stringify(normalized));
  }

  function setExportColumns(next: readonly string[]) {
    const normalized = next.length > 0 ? columns.map((column) => column.key).filter((columnKey) => next.includes(columnKey)) : defaultColumnKeys;
    setExportColumnKeys(normalized);
    window.localStorage.setItem(exportColumnStorageKey, JSON.stringify(normalized));
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
  const includeDeleted = booleanParam(params.includeDeleted);
  const exportHref = ledgerExportHref(params);

  function openWorkflow(workflow: 'movement' | 'inventory') {
    setOpenColumnKey(null);
    setColumnMenuOpen(false);
    setExportWindowOpen(false);
    window.dispatchEvent(new CustomEvent(openEntryWorkflowEvent, { detail: workflow }));
  }

  function openExportWindow() {
    setOpenColumnKey(null);
    setColumnMenuOpen(false);
    setExportWindowOpen(true);
  }

  return (
    <>
      <div className="tableTools">
        <div className="tableCommandTools" aria-label="FileMaker commands">
          <button type="button" className="toolbarButton" onClick={openExportWindow}>出力</button>
          <a className="toolbarButton" href="/">全件表示</a>
          <a className={includeDeleted ? 'toolbarButton activeToggle' : 'toolbarButton'} href={deletedToggleHref(params, includeDeleted)}>
            {includeDeleted ? '削除も表示' : '削除を表示'}
          </a>
          <button type="button" className="toolbarButton" onClick={() => openWorkflow('movement')}>新規レコード</button>
          <button type="button" className="toolbarButton" onClick={() => openWorkflow('inventory')}>現在高チェック</button>
          <a className="toolbarButton" href={unsortHref(params)}>標準ソート</a>
        </div>
        <button type="button" className="toolbarButton" onClick={() => setColumnMenuOpen((open) => !open)}>表示列</button>
      </div>
      <div className="tableViewport">
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
            <div className="columnChooserList">
              {columns.map((column) => (
                <label key={column.key} className="columnChoice">
                  <input
                    type="checkbox"
                    checked={visibleColumnKeys.includes(column.key)}
                    onChange={(event) => setVisible(column.key, event.target.checked)}
                  />
                  <span>{column.label}</span>
                </label>
              ))}
            </div>
            <button type="button" className="filterButton secondaryButton" onClick={resetColumns}>標準に戻す</button>
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
                      <button
                        type="button"
                        className={firstParam(params[filterName(column.key)]) ? 'columnTitleButton filteredColumn' : 'columnTitleButton'}
                        onClick={() => setOpenColumnKey(openColumnKey === column.key ? null : String(column.key))}
                      >
                        <span>{column.label}</span>
                      </button>
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
                    {openColumnKey === column.key ? (
                      <ColumnFilterPopover
                        column={column}
                        params={params}
                        align={index >= visibleColumns.length - 2 ? 'right' : 'left'}
                        currentFilter={firstParam(params[filterName(column.key)]) ?? ''}
                        onClose={() => setOpenColumnKey(null)}
                        tableWrapRef={tableWrapRef}
                        options={columnFilterOptions(column, filterOptions)}
                      />
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const href = queryHref(params, entry.ledgerNo);
                const isSelected = selectedLedgerNo === entry.ledgerNo;
                const rowClassName = [isSelected ? 'selectedRow' : '', entry.isDeleted ? 'deletedRow' : '']
                  .filter(Boolean)
                  .join(' ') || undefined;
                return (
                  <tr key={entry.id} className={rowClassName}>
                    {visibleColumns.map((column) => (
                      <td key={`${entry.id}-${column.key}`} className={cellClassName(column)}>
                        {column.key === 'ledgerNo' ? <Link href={href}>#{entry.ledgerNo}</Link> : displayCell(entry, column)}
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
          entries={entries}
          selectedColumnKeys={exportColumnKeys}
          visibleColumnKeys={visibleColumnKeys}
          onColumnChange={setExportColumn}
          onSetColumns={setExportColumns}
          onClose={() => setExportWindowOpen(false)}
        />
      ) : null}
    </>
  );
}

function ExportWindow({
  exportHref,
  entries,
  selectedColumnKeys,
  visibleColumnKeys,
  onColumnChange,
  onSetColumns,
  onClose,
}: Readonly<{
  exportHref: string;
  entries: LedgerEntryListRecord['items'];
  selectedColumnKeys: readonly string[];
  visibleColumnKeys: readonly string[];
  onColumnChange: (key: string, visible: boolean) => void;
  onSetColumns: (keys: readonly string[]) => void;
  onClose: () => void;
}>) {
  const [saveFormat, setSaveFormat] = useState<SaveFormat>('csv-comma');

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
              <select value={saveFormat} onChange={(event) => setSaveFormat(event.target.value as SaveFormat)}>
                <option value="csv-comma">.csv カンマ区切り</option>
                <option value="csv-tab">.tsv タブ区切り</option>
                <option value="html">.html</option>
              </select>
            </label>
            <div className="exportSaveActions">
              <button type="button" className="secondaryButton" onClick={() => saveCurrentTable(entries, visibleColumnKeys, saveFormat)}>現在の表を保存</button>
              <button type="button" className="secondaryButton" onClick={() => saveSearchResults(exportHref, selectedColumnKeys, saveFormat)}>検索結果を保存</button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function exportFormatHref(exportHref: string, format: 'csv-comma' | 'csv-tab' | 'html', selectedColumnKeys: readonly string[]): string {
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

function deletedToggleHref(params: Record<string, string | string[] | undefined>, includeDeleted: boolean): string {
  const next = paramsWithout(params, { keys: ['ledgerNo', 'page', 'includeDeleted', 'actionMessage', 'clearDraft'] });
  if (!includeDeleted) next.set('includeDeleted', '1');
  const query = next.toString();
  return query ? `/?${query}` : '/';
}

function unsortHref(params: Record<string, string | string[] | undefined>): string {
  const next = paramsWithout(params, { keys: ['ledgerNo', 'page', 'sort', 'dir', 'actionMessage', 'clearDraft'] });
  const query = next.toString();
  return query ? `/?${query}` : '/';
}

function saveCurrentTable(entries: LedgerEntryListRecord['items'], visibleColumnKeys: readonly string[], format: SaveFormat) {
  const visibleColumns = columns.filter((column) => visibleColumnKeys.includes(column.key));
  const header = visibleColumns.map((column) => column.label);
  const rows = entries.map((entry) => visibleColumns.map((column) => displayCell(entry, column)));
  const content = format === 'html'
    ? htmlTable(header, rows)
    : `\uFEFF${delimitedText(header, rows, format === 'csv-tab' ? '\t' : ',')}\r\n`;
  const blob = new Blob([content], { type: mimeTypeForFormat(format) });
  void saveBlob(blob, `voucher-ledger-table-${tokyoTimestampForFileName()}.${extensionForFormat(format)}`, format);
}

async function saveSearchResults(exportHref: string, selectedColumnKeys: readonly string[], format: SaveFormat) {
  const response = await fetch(exportFormatHref(exportHref, format, selectedColumnKeys), { cache: 'no-store' });
  if (!response.ok) throw new Error('Export failed');
  const blob = await response.blob();
  await saveBlob(blob, `voucher-ledger-${tokyoTimestampForFileName()}.${extensionForFormat(format)}`, format);
}

async function saveBlob(blob: Blob, suggestedName: string, format: SaveFormat) {
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

function extensionForFormat(format: SaveFormat): 'csv' | 'tsv' | 'html' {
  if (format === 'html') return 'html';
  return format === 'csv-tab' ? 'tsv' : 'csv';
}

function mimeTypeForFormat(format: SaveFormat): string {
  if (format === 'html') return 'text/html;charset=utf-8';
  return `${format === 'csv-tab' ? 'text/tab-separated-values' : 'text/csv'};charset=utf-8`;
}

function filePickerTypeForFormat(format: SaveFormat): FilePickerAcceptType {
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
}: Readonly<{
  column: ColumnDefinition;
  params: Record<string, string | string[] | undefined>;
  align: 'left' | 'right';
  currentFilter: string;
  onClose: () => void;
  tableWrapRef: RefObject<HTMLDivElement | null>;
  options: readonly FilterOption[];
}>) {
  const [value, setValue] = useState(currentFilter);
  const [dateParts, setDateParts] = useState(() => datePartsFromFilter(currentFilter));
  const popupBounds = useCallback(() => visibleTableBounds(tableWrapRef.current), [tableWrapRef]);
  const drag = useDraggablePopup(popupBounds);
  const effectiveValue = filterValue(column, value, dateParts);

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
        dateParts={dateParts}
        options={options}
        onValueChange={setValue}
        onDatePartsChange={setDateParts}
      />
      <div className="columnFilterActions">
        <a className="filterButton" href={applyFilterHref(params, column.key, effectiveValue)}>絞込</a>
        {currentFilter ? <a className="filterButton secondaryButton" href={clearFilterHref(params, column.key)}>解除</a> : null}
      </div>
    </div>
  );
}

function FilterControl({
  column,
  value,
  dateParts,
  options,
  onValueChange,
  onDatePartsChange,
}: Readonly<{
  column: ColumnDefinition;
  value: string;
  dateParts: DateParts;
  options: readonly FilterOption[];
  onValueChange: (value: string) => void;
  onDatePartsChange: (parts: DateParts) => void;
}>) {
  if (options.length > 0) {
    return (
      <select value={value} onChange={(event) => onValueChange(event.target.value)} aria-label={column.label}>
        <option value="">すべて</option>
        {options.map((option) => (
          <option key={`${column.key}-${option.value}`} value={String(option.value)}>{option.label}</option>
        ))}
      </select>
    );
  }

  if (column.kind === 'date' || column.kind === 'datetime') {
    return (
      <div className="dateFilterFields">
        <NumberField label="年" min={minYear} max={maxYear} value={dateParts.year} onChange={(year) => onDatePartsChange({ ...dateParts, year })} />
        <NumberField label="月" min={1} max={12} value={dateParts.month} onChange={(month) => onDatePartsChange({ ...dateParts, month })} />
        <NumberField label="日" min={1} max={31} value={dateParts.day} onChange={(day) => onDatePartsChange({ ...dateParts, day })} />
      </div>
    );
  }

  if (column.kind === 'year') {
    return (
      <NumberField label="年" min={minYear} max={maxYear} value={numericValue(value, new Date().getFullYear())} onChange={(next) => onValueChange(String(next))} showLabel={false} />
    );
  }

  if (column.kind === 'month') {
    return (
      <NumberField label="月" min={1} max={12} value={numericValue(value, 1)} onChange={(next) => onValueChange(String(next))} showLabel={false} />
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
  if (column.optionsKey === 'deleted') {
    return [
      { value: 'false', label: '未削除' },
      { value: 'true', label: '削除済' },
    ];
  }
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

function datePartsFromFilter(value: string): DateParts {
  const normalized = value.replaceAll('/', '-');
  const match = /^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/.exec(normalized);
  const now = new Date();
  return {
    year: clampNumber(match?.[1] ? Number(match[1]) : now.getFullYear(), minYear, maxYear),
    month: clampNumber(match?.[2] ? Number(match[2]) : now.getMonth() + 1, 1, 12),
    day: clampNumber(match?.[3] ? Number(match[3]) : now.getDate(), 1, 31),
  };
}

function filterValue(column: ColumnDefinition, value: string, dateParts: DateParts): string {
  if (column.kind === 'date' || column.kind === 'datetime') {
    return `${dateParts.year}-${pad2(dateParts.month)}-${pad2(dateParts.day)}`;
  }
  return value.trim();
}

function numericValue(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
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

function queryHref(params: Record<string, string | string[] | undefined>, ledgerNo: number): string {
  const next = paramsWithout(params, { keys: ['ledgerNo', 'actionMessage', 'clearDraft'] });
  next.set('ledgerNo', String(ledgerNo));
  return `/?${next.toString()}`;
}

function clearFilterHref(params: Record<string, string | string[] | undefined>, columnKey: string): string {
  const next = paramsWithout(params, { keys: [filterName(columnKey), 'ledgerNo', 'page', 'actionMessage', 'clearDraft'] });
  const query = next.toString();
  return query ? `/?${query}` : '/';
}

function applyFilterHref(params: Record<string, string | string[] | undefined>, columnKey: string, value: string): string {
  const next = paramsWithout(params, { keys: [filterName(columnKey), 'ledgerNo', 'page', 'actionMessage', 'clearDraft'] });
  if (value.trim()) next.set(filterName(columnKey), value.trim());
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
