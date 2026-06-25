'use client';

import { createContext, useActionState, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { DENOMINATIONS } from '@/domain/denominations';
import { EntryTypeCode } from '@/domain/entryTypes';
import { RedVoucherStatus, type RedVoucherStatusCode } from '@/domain/redVoucherStatuses';
import type { LedgerFormOptions, LedgerSelectOption } from '@/server/ledger';
import {
  issueRedVoucherCorrectionAction,
  registerInventoryCheckAction,
  registerVoucherMovementAction,
} from './actions';
import { initialEntryActionState, type EntryActionState } from './entryActionState';
import { openEntryWorkflowEvent } from './LedgerToolbar';

type EntryActionModalsProps = Readonly<{
  defaultBranchCode: number | null;
  defaultProcessingDate: string;
  defaultPeriodYear: number | null;
  defaultPeriodMonth: number | null;
  defaultResponsibleEmployeeNo: number | null;
  defaultActorEmployeeNo: number | null;
  clearDraft: Workflow | null;
  options: LedgerFormOptions;
  selectedEntry: CorrectionSelectedEntry | null;
}>;

type DraftValues = Record<string, string>;
type Workflow = 'movement' | 'inventory' | 'correction';

type CorrectionSelectedEntry = Readonly<{
  ledgerNo: number;
  branchCode: number;
  branchName: string | null;
  departmentCode: number | null;
  periodYear: number | null;
  periodMonth: number | null;
  applicationDate: string | null;
  processingDate: string;
  entryTypeCode: EntryTypeCode;
  transactionCategoryCode: number | null;
  counterpartyBranchCode: number | null;
  statusCode: number | null;
  companyCode: number | null;
  responsibleEmployeeNo: number | null;
  description: string;
  remarks: string | null;
  otherAmountYen: number;
  otherAmountNote: string | null;
  redVoucherStatusCode: RedVoucherStatusCode;
  reversalLedgerNo: number | null;
  isDeleted: boolean;
  quantities: Readonly<Record<number, number>>;
}>;

const movementDraftKey = 'voucher-ledger:new-record-draft';
const inventoryDraftKey = 'voucher-ledger:inventory-check-draft';
const correctionDraftKey = 'voucher-ledger:red-voucher-correction-draft';

export function EntryActionModals(props: EntryActionModalsProps) {
  const [openWorkflow, setOpenWorkflow] = useState<Workflow | null>(null);
  const movementDefaults = useMemo(() => movementInitialValues(props), [props]);
  const inventoryDefaults = useMemo(() => inventoryInitialValues(props), [props]);
  const correctionDefaults = useMemo(() => correctionInitialValues(props), [props]);
  const correctionAvailable = props.selectedEntry ? canCorrect(props.selectedEntry) : false;

  useEffect(() => {
    if (props.clearDraft === 'movement') window.localStorage.removeItem(movementDraftKey);
    if (props.clearDraft === 'inventory') window.localStorage.removeItem(inventoryDraftKey);
    if (props.clearDraft === 'correction') window.localStorage.removeItem(correctionDraftKey);
  }, [props.clearDraft]);

  useEffect(() => {
    function onOpenWorkflow(event: Event) {
      const workflow = (event as CustomEvent<Workflow>).detail;
      if (workflow === 'movement' || workflow === 'inventory') setOpenWorkflow(workflow);
    }

    window.addEventListener(openEntryWorkflowEvent, onOpenWorkflow);
    return () => window.removeEventListener(openEntryWorkflowEvent, onOpenWorkflow);
  }, []);

  return (
    <>
      {props.selectedEntry ? (
        <div className="detailActions">
          <button
            type="button"
            className="secondaryButton"
            disabled={!correctionAvailable}
            onClick={() => setOpenWorkflow('correction')}
          >
            赤伝票で訂正
          </button>
        </div>
      ) : null}

      {openWorkflow === 'movement' ? (
        <EntryModal title="新規レコード" onClose={() => setOpenWorkflow(null)}>
          <PersistedEntryForm
            action={registerVoucherMovementAction}
            storageKey={movementDraftKey}
            defaults={movementDefaults}
            submitLabel="登録"
            options={props.options}
          >
            <BaseEntryFields includeDescription />
            <MovementFields />
            <AmountAndNotes />
            <QuantityFields />
          </PersistedEntryForm>
        </EntryModal>
      ) : null}

      {openWorkflow === 'inventory' ? (
        <EntryModal title="現在高チェック" onClose={() => setOpenWorkflow(null)}>
          <PersistedEntryForm
            action={registerInventoryCheckAction}
            storageKey={inventoryDraftKey}
            defaults={inventoryDefaults}
            submitLabel="チェック登録"
            options={props.options}
          >
            <BaseEntryFields includeDescription={false} />
            <InventoryDescriptionField />
            <AmountAndNotes />
            <QuantityFields />
          </PersistedEntryForm>
        </EntryModal>
      ) : null}

      {openWorkflow === 'correction' && props.selectedEntry ? (
        <EntryModal title={`赤伝票/訂正 出納No ${props.selectedEntry.ledgerNo}`} onClose={() => setOpenWorkflow(null)}>
          <PersistedEntryForm
            action={issueRedVoucherCorrectionAction}
            storageKey={correctionDraftKey}
            defaults={correctionDefaults}
            submitLabel="赤伝票/訂正を登録"
            options={props.options}
          >
            <input type="hidden" name="originalLedgerNo" value={props.selectedEntry.ledgerNo} />
            <CorrectionContext original={props.selectedEntry} />
            <CorrectionReversalFields />
            <BaseEntryFields includeDescription />
            <MovementFields />
            <AmountAndNotes />
            <QuantityFields />
          </PersistedEntryForm>
        </EntryModal>
      ) : null}
    </>
  );
}

function EntryModal({
  title,
  onClose,
  children,
}: Readonly<{
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}>) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    document.body.classList.add('modalOpen');
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.classList.remove('modalOpen');
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="entryModal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`modal-${title}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modalHeader">
          <h2 id={`modal-${title}`}>{title}</h2>
          <button type="button" className="secondaryButton" onClick={onClose}>閉じる</button>
        </div>
        {children}
      </section>
    </div>
  );
}

function PersistedEntryForm({
  action,
  storageKey,
  defaults,
  submitLabel,
  options,
  children,
}: Readonly<{
  action: (previousState: EntryActionState, formData: FormData) => Promise<EntryActionState>;
  storageKey: string;
  defaults: DraftValues;
  submitLabel: string;
  options: LedgerFormOptions;
  children: React.ReactNode;
}>) {
  const formRef = useRef<HTMLFormElement>(null);
  const [actionState, formAction, isPending] = useActionState(action, initialEntryActionState);
  const [values, setValues] = useState<DraftValues>(defaults);

  useEffect(() => {
    setValues({ ...defaults, ...loadDraft(storageKey) });
  }, [defaults, storageKey]);

  useEffect(() => {
    if (!actionState.values) return;
    setValues({ ...defaults, ...actionState.values });
    window.localStorage.setItem(storageKey, JSON.stringify(actionState.values));
  }, [actionState.values, defaults, storageKey]);

  function persist() {
    const form = formRef.current;
    if (!form) return;
    window.localStorage.setItem(storageKey, JSON.stringify(formValues(form)));
  }

  function clearDraft() {
    window.localStorage.removeItem(storageKey);
    setValues(defaults);
  }

  return (
    <form
      key={JSON.stringify(values)}
      ref={formRef}
      action={formAction}
      className="entryForm modalEntryForm"
      noValidate
      onInput={persist}
      onChange={persist}
      onSubmitCapture={persist}
    >
      {actionState.error ? <p className="modalError" role="alert">{actionState.error}</p> : null}
      <DraftValueContext.Provider value={values}>
        <FormOptionsContext.Provider value={options}>
          <FieldErrorsContext.Provider value={actionState.fieldErrors ?? {}}>
            {children}
          </FieldErrorsContext.Provider>
        </FormOptionsContext.Provider>
      </DraftValueContext.Provider>
      <div className="formActions">
        <button type="button" className="secondaryButton" onClick={clearDraft}>クリア</button>
        <button type="submit" disabled={isPending}>{isPending ? '登録中' : submitLabel}</button>
      </div>
    </form>
  );
}

const DraftValueContext = createContext<DraftValues>({});
const FormOptionsContext = createContext<LedgerFormOptions>({
  branches: [],
  entryTypes: [],
  employees: [],
  transactionCategories: [],
  redVoucherStatuses: [],
  companies: [],
  departments: [],
});
const FieldErrorsContext = createContext<Record<string, string>>({});

function BaseEntryFields({ includeDescription }: Readonly<{ includeDescription: boolean }>) {
  const values = useContext(DraftValueContext);
  const options = useContext(FormOptionsContext);
  const errors = useContext(FieldErrorsContext);
  return (
    <>
      <label className={fieldClass(errors, 'branchCode')}>
        <span>拠点</span>
        <SelectField name="branchCode" value={fieldValue(values, 'branchCode')} options={options.branches} required />
      </label>
      <label className={fieldClass(errors, 'processingDate')}>
        <span>処理日</span>
        <input
          name="processingDate"
          pattern="\d{4}/\d{2}/\d{2}"
          placeholder="yyyy/mm/dd"
          defaultValue={fieldValue(values, 'processingDate')}
          required
        />
      </label>
      <label className={fieldClass(errors, 'periodYear')}>
        <span>年</span>
        <input name="periodYear" type="number" min="1900" max="2200" step="1" defaultValue={fieldValue(values, 'periodYear')} />
      </label>
      <label className={fieldClass(errors, 'periodMonth')}>
        <span>月</span>
        <input name="periodMonth" type="number" min="1" max="12" step="1" defaultValue={fieldValue(values, 'periodMonth')} />
      </label>
      <label className={fieldClass(errors, 'applicationDate')}>
        <span>申請処理日</span>
        <input
          name="applicationDate"
          pattern="\d{4}/\d{2}/\d{2}"
          placeholder="yyyy/mm/dd"
          defaultValue={fieldValue(values, 'applicationDate')}
        />
      </label>
      <label className={fieldClass(errors, 'responsibleEmployeeNo')}>
        <span>担当者</span>
        <SelectField name="responsibleEmployeeNo" value={fieldValue(values, 'responsibleEmployeeNo')} options={options.employees} />
      </label>
      <label className={fieldClass(errors, 'actorEmployeeNo')}>
        <span>登録者</span>
        <SelectField name="actorEmployeeNo" value={fieldValue(values, 'actorEmployeeNo')} options={options.employees} />
      </label>
      {includeDescription ? (
        <label className={`wideField ${fieldClass(errors, 'description')}`}>
          <span>摘要</span>
          <textarea name="description" defaultValue={fieldValue(values, 'description')} required rows={2} />
        </label>
      ) : null}
    </>
  );
}

function MovementFields() {
  const values = useContext(DraftValueContext);
  const options = useContext(FormOptionsContext);
  const errors = useContext(FieldErrorsContext);
  return (
    <>
      <label className={fieldClass(errors, 'entryTypeCode')}>
        <span>入出区分</span>
        <select name="entryTypeCode" defaultValue={fieldValue(values, 'entryTypeCode')}>
          <option value={EntryTypeCode.Incoming}>入金/購入</option>
          <option value={EntryTypeCode.Outgoing}>出金/使用</option>
          <option value={EntryTypeCode.IncomingAlt}>過不足入金</option>
          <option value={EntryTypeCode.OutgoingAlt}>過不足出金</option>
        </select>
      </label>
      <label className={fieldClass(errors, 'transactionCategoryCode')}>
        <span>出納区分</span>
        <SelectField
          name="transactionCategoryCode"
          value={fieldValue(values, 'transactionCategoryCode')}
          options={options.transactionCategories}
        />
      </label>
      <label className={fieldClass(errors, 'counterpartyBranchCode')}>
        <span>入出拠点</span>
        <SelectField name="counterpartyBranchCode" value={fieldValue(values, 'counterpartyBranchCode')} options={options.branches} />
      </label>
      <label className={fieldClass(errors, 'companyCode')}>
        <span>会社</span>
        <SelectField name="companyCode" value={fieldValue(values, 'companyCode')} options={options.companies} />
      </label>
      <label className={fieldClass(errors, 'departmentCode')}>
        <span>部門</span>
        <SelectField name="departmentCode" value={fieldValue(values, 'departmentCode')} options={options.departments} />
      </label>
    </>
  );
}

function InventoryDescriptionField() {
  const values = useContext(DraftValueContext);
  const errors = useContext(FieldErrorsContext);
  return (
    <label className={`wideField ${fieldClass(errors, 'description')}`}>
      <span>摘要</span>
      <textarea name="description" defaultValue={fieldValue(values, 'description')} rows={2} />
    </label>
  );
}

function CorrectionContext({ original }: Readonly<{ original: CorrectionSelectedEntry }>) {
  return (
    <div className="formContext wideField">
      <span>元伝票</span>
      <strong>
        {original.ledgerNo} / {original.branchName ?? original.branchCode} / {dateInputText(original.processingDate)}
      </strong>
    </div>
  );
}

function CorrectionReversalFields() {
  const values = useContext(DraftValueContext);
  const errors = useContext(FieldErrorsContext);
  return (
    <>
      <label className={fieldClass(errors, 'reversalProcessingDate')}>
        <span>赤伝票処理日</span>
        <input
          name="reversalProcessingDate"
          pattern="\d{4}/\d{2}/\d{2}"
          placeholder="yyyy/mm/dd"
          defaultValue={fieldValue(values, 'reversalProcessingDate')}
          required
        />
      </label>
      <label className={fieldClass(errors, 'reversalApplicationDate')}>
        <span>赤伝票申請処理日</span>
        <input
          name="reversalApplicationDate"
          pattern="\d{4}/\d{2}/\d{2}"
          placeholder="yyyy/mm/dd"
          defaultValue={fieldValue(values, 'reversalApplicationDate')}
        />
      </label>
      <label className={`wideField ${fieldClass(errors, 'reversalDescription')}`}>
        <span>赤伝票摘要</span>
        <textarea name="reversalDescription" defaultValue={fieldValue(values, 'reversalDescription')} rows={2} />
      </label>
      <label className={`wideField ${fieldClass(errors, 'reversalRemarks')}`}>
        <span>赤伝票備考</span>
        <textarea name="reversalRemarks" defaultValue={fieldValue(values, 'reversalRemarks')} rows={2} />
      </label>
    </>
  );
}

function AmountAndNotes() {
  const values = useContext(DraftValueContext);
  const errors = useContext(FieldErrorsContext);
  return (
    <>
      <label className={fieldClass(errors, 'otherAmountYen')}>
        <span>その他金額</span>
        <input name="otherAmountYen" type="number" step="1" defaultValue={fieldValue(values, 'otherAmountYen')} />
      </label>
      <label className={fieldClass(errors, 'otherAmountNote')}>
        <span>その他金額備考</span>
        <input name="otherAmountNote" defaultValue={fieldValue(values, 'otherAmountNote')} />
      </label>
      <label className={`wideField ${fieldClass(errors, 'remarks')}`}>
        <span>備考</span>
        <textarea name="remarks" defaultValue={fieldValue(values, 'remarks')} rows={2} />
      </label>
    </>
  );
}

function QuantityFields() {
  const values = useContext(DraftValueContext);
  const errors = useContext(FieldErrorsContext);
  return (
    <fieldset className={`quantityFieldset ${fieldClass(errors, 'quantities')}`}>
      <legend>枚数</legend>
      <div className="quantityInputs">
        {DENOMINATIONS.map((denomination) => (
          <label key={denomination} className={fieldClass(errors, `quantity_${denomination}`)}>
            <span>{denomination}円</span>
            <input
              name={`quantity_${denomination}`}
              type="number"
              min="0"
              max="9999"
              step="1"
              defaultValue={fieldValue(values, `quantity_${denomination}`)}
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function fieldValue(values: DraftValues, name: string): string {
  return values[name] ?? '';
}

function fieldClass(errors: Record<string, string>, name: string): string {
  return errors[name] ? 'fieldError' : '';
}

function SelectField({
  name,
  value,
  options,
  required = false,
}: Readonly<{
  name: string;
  value: string;
  options: readonly LedgerSelectOption[];
  required?: boolean;
}>) {
  return (
    <select name={name} defaultValue={value} required={required}>
      <option value="">-</option>
      {options.map((option) => (
        <option key={`${name}-${option.value}`} value={option.value}>
          {option.label} ({option.value})
        </option>
      ))}
    </select>
  );
}

function movementInitialValues(props: EntryActionModalsProps): DraftValues {
  return {
    ...baseInitialValues(props),
    entryTypeCode: String(EntryTypeCode.Incoming),
    description: '',
    transactionCategoryCode: '',
    counterpartyBranchCode: '',
    companyCode: '',
    departmentCode: '',
    otherAmountYen: '0',
    otherAmountNote: '',
    remarks: '',
    ...zeroQuantityValues(),
  };
}

function inventoryInitialValues(props: EntryActionModalsProps): DraftValues {
  return {
    ...baseInitialValues(props),
    description: '現在有り高チェック',
    otherAmountYen: '0',
    otherAmountNote: '',
    remarks: '',
    ...zeroQuantityValues(),
  };
}

function correctionInitialValues(props: EntryActionModalsProps): DraftValues {
  const selected = props.selectedEntry;
  if (!selected) return {};
  return {
    ...baseInitialValues({
      ...props,
      defaultBranchCode: selected.branchCode,
      defaultProcessingDate: selected.processingDate,
      defaultPeriodYear: selected.periodYear,
      defaultPeriodMonth: selected.periodMonth,
      defaultResponsibleEmployeeNo: selected.responsibleEmployeeNo,
    }),
    reversalProcessingDate: dateInputText(selected.processingDate),
    reversalApplicationDate: dateInputText(selected.applicationDate ?? selected.processingDate),
    reversalDescription: `No.${selected.ledgerNo} の赤伝票`,
    reversalRemarks: selected.remarks ?? '',
    entryTypeCode: String(selected.entryTypeCode),
    description: selected.description,
    transactionCategoryCode: selected.transactionCategoryCode == null ? '' : String(selected.transactionCategoryCode),
    counterpartyBranchCode: selected.counterpartyBranchCode == null ? '' : String(selected.counterpartyBranchCode),
    companyCode: selected.companyCode == null ? '' : String(selected.companyCode),
    departmentCode: selected.departmentCode == null ? '' : String(selected.departmentCode),
    statusCode: selected.statusCode == null ? '' : String(selected.statusCode),
    otherAmountYen: String(selected.otherAmountYen),
    otherAmountNote: selected.otherAmountNote ?? '',
    remarks: selected.remarks ?? '',
    ...quantityValues(selected.quantities),
  };
}

function baseInitialValues(props: EntryActionModalsProps): DraftValues {
  return {
    branchCode: props.defaultBranchCode == null ? '' : String(props.defaultBranchCode),
    processingDate: dateInputText(props.defaultProcessingDate),
    periodYear: props.defaultPeriodYear == null ? '' : String(props.defaultPeriodYear),
    periodMonth: props.defaultPeriodMonth == null ? '' : String(props.defaultPeriodMonth),
    applicationDate: '',
    responsibleEmployeeNo: props.defaultResponsibleEmployeeNo == null ? '' : String(props.defaultResponsibleEmployeeNo),
    actorEmployeeNo: props.defaultActorEmployeeNo == null ? '' : String(props.defaultActorEmployeeNo),
  };
}

function canCorrect(entry: CorrectionSelectedEntry): boolean {
  return !entry.isDeleted
    && entry.redVoucherStatusCode === RedVoucherStatus.Normal
    && entry.reversalLedgerNo === null
    && [
      EntryTypeCode.Incoming,
      EntryTypeCode.Outgoing,
      EntryTypeCode.IncomingAlt,
      EntryTypeCode.OutgoingAlt,
    ].includes(entry.entryTypeCode);
}

function zeroQuantityValues(): DraftValues {
  return Object.fromEntries(DENOMINATIONS.map((denomination) => [`quantity_${denomination}`, '0']));
}

function quantityValues(quantities: Readonly<Record<number, number>>): DraftValues {
  return Object.fromEntries(
    DENOMINATIONS.map((denomination) => [`quantity_${denomination}`, String(quantities[denomination] ?? 0)]),
  );
}

function loadDraft(storageKey: string): DraftValues {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as DraftValues : {};
  } catch {
    return {};
  }
}

function formValues(form: HTMLFormElement): DraftValues {
  const values: DraftValues = {};
  new FormData(form).forEach((value, key) => {
    if (typeof value === 'string') values[key] = value;
  });
  return values;
}

function dateInputText(value: string): string {
  return value.replaceAll('-', '/');
}
