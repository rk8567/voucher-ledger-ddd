'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';

import type { LedgerEntryListRecord, LedgerEntryRecord } from '@/application/repositories/VoucherLedgerRepository';
import { openEntryWorkflowEvent } from './LedgerToolbar';

type LedgerTableProps = Readonly<{
  entries: LedgerEntryListRecord['items'];
  selectedLedgerNo: number | null;
  params: Record<string, string>;
  currentSortKey: string;
  currentSortDirection: 'asc' | 'desc';
  exportHref: string;
  showAllHref: string;
  includeDeleted: boolean;
  deletedToggleHref: string;
  unsortHref: string;
}>;

type ColumnDefinition = Readonly<{
  key: keyof LedgerEntryRecord | 'otherAmountYen';
  label: string;
  kind: 'text' | 'integer' | 'money' | 'date' | 'year' | 'month' | 'datetime';
  defaultVisible?: boolean;
  sortable?: boolean;
}>;

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

const columnStorageKey = 'voucher-ledger:visible-columns';
const filterPrefix = 'filter_';
const minYear = 1990;
const maxYear = 2035;
const columns: readonly ColumnDefinition[] = [
  { key: 'ledgerNo', label: '出納No', kind: 'integer', defaultVisible: true, sortable: true },
  { key: 'processingDate', label: '処理日', kind: 'date', defaultVisible: true, sortable: true },
  { key: 'branchName', label: '拠点', kind: 'text', defaultVisible: true, sortable: true },
  { key: 'entryTypeName', label: '区分', kind: 'text', defaultVisible: true, sortable: true },
  { key: 'responsibleEmployeeName', label: '担当', kind: 'text', defaultVisible: true, sortable: true },
  { key: 'description', label: '摘要', kind: 'text', defaultVisible: true, sortable: true },
  { key: 'otherAmountYen', label: 'その他', kind: 'money', defaultVisible: true, sortable: true },
  { key: 'applicationDate', label: '申請処理日', kind: 'date' },
  { key: 'branchCode', label: '拠点CD', kind: 'integer' },
  { key: 'departmentCode', label: '部門CD', kind: 'integer' },
  { key: 'departmentName', label: '部門', kind: 'text' },
  { key: 'periodYear', label: '年', kind: 'year' },
  { key: 'periodMonth', label: '月', kind: 'month' },
  { key: 'entryTypeCode', label: '入出区分CD', kind: 'integer' },
  { key: 'transactionCategoryCode', label: '出納区分CD', kind: 'integer' },
  { key: 'transactionCategoryName', label: '出納区分', kind: 'text' },
  { key: 'counterpartyBranchCode', label: '入出拠点CD', kind: 'integer' },
  { key: 'counterpartyBranchName', label: '入出拠点', kind: 'text' },
  { key: 'companyCode', label: '会社CD', kind: 'integer' },
  { key: 'companyName', label: '会社', kind: 'text' },
  { key: 'responsibleEmployeeNo', label: '担当者CD', kind: 'integer' },
  { key: 'remarks', label: '備考', kind: 'text' },
  { key: 'otherAmountNote', label: 'その他金額備考', kind: 'text' },
  { key: 'redVoucherStatusCode', label: '赤伝票CD', kind: 'integer' },
  { key: 'redVoucherStatusName', label: '赤伝票状態', kind: 'text' },
  { key: 'isDeleted', label: '削除', kind: 'text' },
  { key: 'originalLedgerNo', label: '元伝票No', kind: 'integer' },
  { key: 'reversalLedgerNo', label: '赤伝票No', kind: 'integer' },
  { key: 'correctionLedgerNo', label: '訂正伝票No', kind: 'integer' },
  { key: 'registeredAt', label: '登録日時', kind: 'datetime' },
  { key: 'registeredByEmployeeNo', label: '登録者CD', kind: 'integer' },
  { key: 'registeredByEmployeeName', label: '登録者', kind: 'text' },
  { key: 'updatedAt', label: '更新日時', kind: 'datetime' },
  { key: 'updatedByEmployeeNo', label: '更新者CD', kind: 'integer' },
  { key: 'updatedByEmployeeName', label: '更新者', kind: 'text' },
  { key: 'postedAt', label: '登録済', kind: 'datetime' },
  { key: 'filemakerCreatedAt', label: 'FM作成日時', kind: 'datetime' },
  { key: 'filemakerCreatedBy', label: 'FM作成者', kind: 'text' },
  { key: 'filemakerModifiedAt', label: 'FM修正日時', kind: 'datetime' },
  { key: 'filemakerModifiedBy', label: 'FM修正者', kind: 'text' },
  { key: 'filemakerLoginEmployeeNo', label: 'ログイン社員番号', kind: 'integer' },
  { key: 'filemakerLoginEmployeeName', label: 'ログイン社員名', kind: 'text' },
  { key: 'createdAt', label: '作成日時', kind: 'datetime' },
];

const defaultColumnKeys = columns.filter((column) => column.defaultVisible).map((column) => column.key);

export function LedgerTable({
  entries,
  selectedLedgerNo,
  params,
  currentSortKey,
  currentSortDirection,
  exportHref,
  showAllHref,
  includeDeleted,
  deletedToggleHref,
  unsortHref,
}: LedgerTableProps) {
  const [openColumnKey, setOpenColumnKey] = useState<string | null>(null);
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<readonly string[]>(defaultColumnKeys);
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

  function openWorkflow(workflow: 'movement' | 'inventory') {
    window.dispatchEvent(new CustomEvent(openEntryWorkflowEvent, { detail: workflow }));
  }

  return (
    <>
      <div className="tableTools">
        <div className="tableCommandTools" aria-label="FileMaker commands">
          <a className="toolbarButton" href={exportHref}>CSV出力</a>
          <a className="toolbarButton" href={showAllHref}>全件表示</a>
          <a className={includeDeleted ? 'toolbarButton activeToggle' : 'toolbarButton'} href={deletedToggleHref}>
            {includeDeleted ? '削除も表示' : '削除を表示'}
          </a>
          <button type="button" className="toolbarButton" onClick={() => openWorkflow('movement')}>新規レコード</button>
          <button type="button" className="toolbarButton" onClick={() => openWorkflow('inventory')}>現在高チェック</button>
          <a className="toolbarButton" href={unsortHref}>標準ソート</a>
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
                        className={params[filterName(column.key)] ? 'columnTitleButton filteredColumn' : 'columnTitleButton'}
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
                        currentFilter={params[filterName(column.key)] ?? ''}
                        onClose={() => setOpenColumnKey(null)}
                        tableWrapRef={tableWrapRef}
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
    </>
  );
}

function ColumnFilterPopover({
  column,
  params,
  align,
  currentFilter,
  onClose,
  tableWrapRef,
}: Readonly<{
  column: ColumnDefinition;
  params: Record<string, string>;
  align: 'left' | 'right';
  currentFilter: string;
  onClose: () => void;
  tableWrapRef: RefObject<HTMLDivElement | null>;
}>) {
  const [value, setValue] = useState(currentFilter);
  const [dateParts, setDateParts] = useState(() => datePartsFromFilter(currentFilter));
  const popupBounds = useCallback(() => visibleTableBodyBounds(tableWrapRef.current), [tableWrapRef]);
  const drag = useDraggablePopup(popupBounds);
  const effectiveValue = filterValue(column, value, dateParts);

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
  onValueChange,
  onDatePartsChange,
}: Readonly<{
  column: ColumnDefinition;
  value: string;
  dateParts: DateParts;
  onValueChange: (value: string) => void;
  onDatePartsChange: (parts: DateParts) => void;
}>) {
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
      <NumberField label="年" min={minYear} max={maxYear} value={numericValue(value, new Date().getFullYear())} onChange={(next) => onValueChange(String(next))} />
    );
  }

  if (column.kind === 'month') {
    return (
      <NumberField label="月" min={1} max={12} value={numericValue(value, 1)} onChange={(next) => onValueChange(String(next))} />
    );
  }

  return (
    <label>
      <span>{column.label}</span>
      <input
        type={column.kind === 'integer' || column.kind === 'money' ? 'number' : 'search'}
        inputMode={column.kind === 'integer' || column.kind === 'money' ? 'numeric' : undefined}
        step="1"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder="条件"
      />
    </label>
  );
}

function NumberField({
  label,
  min,
  max,
  value,
  onChange,
}: Readonly<{
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
}>) {
  return (
    <label className="numberFilterField">
      <span>{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step="1"
        value={value}
        onChange={(event) => onChange(clampNumber(Number(event.target.value), min, max))}
      />
    </label>
  );
}

function filterName(columnKey: string): string {
  return `${filterPrefix}${columnKey}`;
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
  const match = /^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/.exec(value);
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
    return dateText(value);
  }
  if (column.key === 'otherAmountYen') return yen(Number(value ?? 0));
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value == null || value === '') return '-';
  const text = String(value);
  return column.kind === 'text' ? limitText(text, 10) : text;
}

function limitText(value: string, maxLength: number): string {
  return Array.from(value).slice(0, maxLength).join('');
}

function dateText(value: unknown): string {
  if (typeof value !== 'string' || !value) return '-';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) return `${match[1]}/${match[2]}/${match[3]}`;
  return value.replaceAll('-', '/');
}

function yen(value: number): string {
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    maximumFractionDigits: 0,
  }).format(value);
}

function queryHref(params: Record<string, string>, ledgerNo: number): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (['ledgerNo', 'cursorLedgerNo', 'cursorStack', 'actionMessage', 'clearDraft'].includes(key)) continue;
    if (value) next.set(key, value);
  }
  next.set('ledgerNo', String(ledgerNo));
  return `/?${next.toString()}`;
}

function clearFilterHref(params: Record<string, string>, columnKey: string): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if ([filterName(columnKey), 'ledgerNo', 'cursorLedgerNo', 'cursorStack', 'page', 'actionMessage', 'clearDraft'].includes(key)) continue;
    if (value) next.set(key, value);
  }
  const query = next.toString();
  return query ? `/?${query}` : '/';
}

function applyFilterHref(params: Record<string, string>, columnKey: string, value: string): string {
  const next = new URLSearchParams();
  for (const [key, paramValue] of Object.entries(params)) {
    if ([filterName(columnKey), 'ledgerNo', 'cursorLedgerNo', 'cursorStack', 'page', 'actionMessage', 'clearDraft'].includes(key)) continue;
    if (paramValue) next.set(key, paramValue);
  }
  if (value.trim()) next.set(filterName(columnKey), value.trim());
  const query = next.toString();
  return query ? `/?${query}` : '/';
}

function nextSortHref(
  params: Record<string, string>,
  sortKey: string,
  currentSortKey: string,
  currentSortDirection: 'asc' | 'desc',
): string {
  const nextDirection = sortKey !== currentSortKey
    ? 'asc'
    : currentSortDirection === 'asc'
      ? 'desc'
      : null;
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (['ledgerNo', 'cursorLedgerNo', 'cursorStack', 'page', 'sort', 'dir', 'actionMessage', 'clearDraft'].includes(key)) continue;
    if (value) next.set(key, value);
  }
  if (nextDirection) {
    next.set('sort', sortKey);
    next.set('dir', nextDirection);
  }
  const query = next.toString();
  return query ? `/?${query}` : '/';
}
