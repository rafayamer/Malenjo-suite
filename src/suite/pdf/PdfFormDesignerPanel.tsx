import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  deleteFormField, listFormDesign, renameFormField, updateFormField,
  type DesignField, type DesignFieldSpec, type DesignKind, type SignatureLock,
} from './forms/formDesign';
import { CALC_OPS, DATE_PATTERNS, type CalcOp, type FieldLogic, type NumberSeparator } from './forms/formLogic';
import { describePdfError } from './pdfUserErrors';

type Operation = (latest: Uint8Array) => Promise<{ bytes: Uint8Array; summary: string }>;
export interface DesignDraft {
  kind: DesignKind; name: string; tooltip: string; required: boolean; readOnly: boolean;
  maxLength: string; comb: boolean; multiline: boolean; defaultValue: string;
  decimals: string; separator: NumberSeparator; currency: string; datePattern: string;
  optionsText: string; selectedText: string; multiselect: boolean; lockAction: SignatureLock['action']; lockFields: string[];
}
export interface FormDesignState { fields: DesignField[]; selected: string | null; /** The widget picked on the page, for fields with several (radio buttons). */ selectedWidget?: string | null; mode: 'place' | 'move' | null; draft: DesignDraft }
export const NEW_DESIGN_DRAFT: DesignDraft = {
  kind: 'text', name: '', tooltip: '', required: false, readOnly: false, maxLength: '', comb: false, multiline: false, defaultValue: '',
  decimals: '2', separator: 0, currency: '', datePattern: 'yyyy-mm-dd', optionsText: '', selectedText: '', multiselect: false, lockAction: 'none', lockFields: [],
};
export const DESIGN_KINDS: [DesignKind, string][] = [['text', 'Text'], ['number', 'Number'], ['date', 'Date'], ['checkbox', 'Check box'], ['radio', 'Radio group'],
  ['dropdown', 'Dropdown'], ['list', 'List box'], ['signature', 'Signature']];
const SEPARATORS: [NumberSeparator, string][] = [[0, '1,234.56'], [1, '1234.56'], [2, '1.234,56'], [3, '1234,56']];

/** Options are typed one per line as “export value | label” (or just one text used for both). */
function parseOptions(text: string) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [value, label] = line.split('|').map((part) => part.trim());
    return { value, label: label || value };
  });
}
/** The new-field settings as a spec (without page, rotation and rectangle, which come from the drag). */
export function designSpec(draft: DesignDraft, fields: DesignField[]): Omit<DesignFieldSpec, 'pageNumber' | 'viewRotation' | 'rect'> {
  const label = DESIGN_KINDS.find(([kind]) => kind === draft.kind)![1];
  let n = 1; while (fields.some((f) => f.name === `${label} ${n}`)) n++;
  const options = parseOptions(draft.optionsText);
  const selected = draft.selectedText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    .map((s) => options.find((o) => o.value === s || o.label === s)?.value ?? s);
  return {
    kind: draft.kind, name: draft.name.trim() || `${label} ${n}`, tooltip: draft.tooltip, required: draft.required, readOnly: draft.readOnly,
    ...(draft.maxLength ? { maxLength: Number(draft.maxLength) } : {}), comb: draft.comb, multiline: draft.multiline, defaultValue: draft.defaultValue || undefined,
    ...(draft.kind === 'number' ? { format: { kind: 'number' as const, decimals: Number(draft.decimals), separator: draft.separator, currency: draft.currency } } : {}),
    ...(draft.kind === 'date' ? { format: { kind: 'date' as const, pattern: draft.datePattern } } : {}),
    options, selected, multiselect: draft.multiselect, lock: { action: draft.lockAction, fields: draft.lockFields },
  };
}

interface Props {
  domIdPrefix: string; bytes: Uint8Array; viewRotation: number; busy: boolean;
  state: FormDesignState | null; onState(next: FormDesignState): void;
  onApply(label: string, operation: Operation): Promise<boolean>; onClose(): void;
}
interface LogicDraft {
  format: 'none' | 'number' | 'date'; decimals: string; separator: NumberSeparator; currency: string; datePattern: string;
  calcOp: CalcOp | ''; calcFields: string[]; min: string; max: string; pattern: string; patternMessage: string; showField: string; showValue: string;
}
function logicDraft(field: DesignField): LogicDraft {
  const { logic } = field;
  return {
    format: logic.format?.kind ?? 'none', decimals: String(logic.format?.kind === 'number' ? logic.format.decimals : 2),
    separator: logic.format?.kind === 'number' ? logic.format.separator : 0, currency: logic.format?.kind === 'number' ? logic.format.currency : '',
    datePattern: logic.format?.kind === 'date' ? logic.format.pattern : 'yyyy-mm-dd',
    calcOp: logic.calculate?.op ?? '', calcFields: logic.calculate?.fields ?? [], min: logic.range?.min?.toString() ?? '', max: logic.range?.max?.toString() ?? '',
    pattern: logic.pattern?.regex ?? '', patternMessage: logic.pattern?.message ?? '', showField: logic.showWhen?.field ?? '', showValue: logic.showWhen?.value === '*' ? '' : logic.showWhen?.value ?? '',
  };
}
function logicOf(d: LogicDraft): Omit<FieldLogic, 'unsupported'> {
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v));
  return {
    ...(d.format === 'number' ? { format: { kind: 'number', decimals: Number(d.decimals), separator: d.separator, currency: d.currency } } : d.format === 'date' ? { format: { kind: 'date', pattern: d.datePattern } } : {}),
    ...(d.calcOp ? { calculate: { op: d.calcOp, fields: d.calcFields } } : {}),
    ...(d.min.trim() || d.max.trim() ? { range: { min: num(d.min), max: num(d.max) } } : {}),
    ...(d.pattern.trim() ? { pattern: { regex: d.pattern.trim(), message: d.patternMessage } } : {}),
    ...(d.showField ? { showWhen: { field: d.showField, value: d.showValue.trim() || '*' } } : {}),
  };
}

/** MAL-046 – MAL-050 form designer: place fields by dragging, select them on the page, edit, move, rename and delete. */
/** Everything the property and logic drafts are copied from: when any of it changes (an edit, undo or redo), the drafts are refreshed. */
export function designDraftSource(field: DesignField | null): string {
  return field ? JSON.stringify([field.name, field.tooltip, field.required, field.readOnly, field.maxLength, field.comb, field.multiline, field.lock, field.logic]) : '';
}

export default function PdfFormDesignerPanel({ domIdPrefix, bytes, viewRotation, busy, state, onState, onApply, onClose }: Props) {
  const [error, setError] = useState('');
  const [rename, setRename] = useState('');
  const [props, setProps] = useState({ tooltip: '', required: false, readOnly: false, maxLength: '', comb: false, multiline: false, lockAction: 'none' as SignatureLock['action'], lockFields: [] as string[] });
  const [logic, setLogic] = useState<LogicDraft | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const fields = state?.fields ?? [];
  const draft = state?.draft ?? NEW_DESIGN_DRAFT;
  const field = fields.find((f) => f.name === state?.selected) ?? null;
  const set = (patch: Partial<FormDesignState>) => onState({ fields, selected: state?.selected ?? null, mode: state?.mode ?? null, draft, ...patch });
  const setDraft = (patch: Partial<DesignDraft>) => set({ draft: { ...draft, ...patch } });

  useEffect(() => {
    let live = true;
    listFormDesign(bytes, viewRotation).then((list) => {
      if (!live) return;
      onState({ fields: list, selected: state?.selected && list.some((f) => f.name === state.selected) ? state.selected : null, mode: null, draft: state?.draft ?? NEW_DESIGN_DRAFT });
      setError('');
    }).catch((reason) => { if (live) setError(describePdfError(reason)); });
    return () => { live = false; };
  }, [bytes, viewRotation]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!field) { setLogic(null); return; }
    setRename(field.name);
    setProps({ tooltip: field.tooltip, required: field.required, readOnly: field.readOnly, maxLength: field.maxLength?.toString() ?? '', comb: field.comb, multiline: field.multiline,
      lockAction: field.lock?.action ?? 'none', lockFields: field.lock?.fields ?? [] });
    setLogic(logicDraft(field));
  }, [designDraftSource(field)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { panelRef.current?.querySelector<HTMLElement>('select')?.focus(); }, []);

  const run = async (label: string, operation: Operation): Promise<boolean> => {
    setError('');
    try { return await onApply(label, operation); } catch (reason) { setError(describePdfError(reason)); return false; }
  };
  const isText = field && ['text', 'number', 'date'].includes(field.kind);
  const others = fields.filter((f) => f.name !== field?.name && f.kind !== 'signature' && f.kind !== 'button');
  const toggle = (list: string[], name: string, on: boolean) => (on ? [...list, name] : list.filter((n) => n !== name));

  return <section ref={panelRef} className="pdf-markup-panel pdf-form-panel" role="dialog" aria-modal="false" aria-labelledby={`${domIdPrefix}-form-design-title`}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (state?.mode) set({ mode: null }); else onClose(); } }}>
    <header>
      <h2 id={`${domIdPrefix}-form-design-title`}>Form designer</h2>
      <button type="button" aria-label="Close form designer" title="Close" onClick={onClose}><X size={16} aria-hidden="true"/></button>
    </header>
    <fieldset>
      <legend>New field</legend>
      <label><span>Field type</span><select aria-label="New field type" value={draft.kind} onChange={(e) => setDraft({ kind: e.target.value as DesignKind })}>
        {DESIGN_KINDS.map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label>
      <label><span>Name</span><input aria-label="New field name" value={draft.name} placeholder="Generated if empty" onChange={(e) => setDraft({ name: e.target.value })}/></label>
      <label><span>Tooltip</span><input aria-label="New field tooltip" value={draft.tooltip} onChange={(e) => setDraft({ tooltip: e.target.value })}/></label>
      <label className="pdf-tool-dialog-choice"><input type="checkbox" checked={draft.required} onChange={(e) => setDraft({ required: e.target.checked })}/>Required</label>
      <label className="pdf-tool-dialog-choice"><input type="checkbox" checked={draft.readOnly} onChange={(e) => setDraft({ readOnly: e.target.checked })}/>Read-only</label>
      {(draft.kind === 'text' || draft.kind === 'number' || draft.kind === 'date') && <>
        <label><span>Maximum length</span><input aria-label="New field maximum length" type="number" min={1} max={2000} value={draft.maxLength} onChange={(e) => setDraft({ maxLength: e.target.value })}/></label>
        <label className="pdf-tool-dialog-choice"><input type="checkbox" checked={draft.comb} onChange={(e) => setDraft({ comb: e.target.checked })}/>Comb (one box per character)</label>
        {draft.kind === 'text' && <label className="pdf-tool-dialog-choice"><input type="checkbox" checked={draft.multiline} onChange={(e) => setDraft({ multiline: e.target.checked })}/>Several lines</label>}
        <label><span>Default value</span><input aria-label="New field default value" value={draft.defaultValue} onChange={(e) => setDraft({ defaultValue: e.target.value })}/></label>
      </>}
      {draft.kind === 'number' && <>
        <label><span>Decimals</span><input aria-label="New field decimals" type="number" min={0} max={6} value={draft.decimals} onChange={(e) => setDraft({ decimals: e.target.value })}/></label>
        <label><span>Separators</span><select aria-label="New field separators" value={draft.separator} onChange={(e) => setDraft({ separator: Number(e.target.value) as NumberSeparator })}>
          {SEPARATORS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label><span>Currency symbol</span><input aria-label="New field currency" value={draft.currency} maxLength={4} onChange={(e) => setDraft({ currency: e.target.value })}/></label>
      </>}
      {draft.kind === 'date' && <label><span>Date format</span><select aria-label="New field date format" value={draft.datePattern} onChange={(e) => setDraft({ datePattern: e.target.value })}>
        {DATE_PATTERNS.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>}
      {(draft.kind === 'radio' || draft.kind === 'dropdown' || draft.kind === 'list') && <>
        <label><span>Options (one per line: export value | label)</span><textarea aria-label="New field options" rows={3} value={draft.optionsText} placeholder={'std | Standard\nexp | Express'} onChange={(e) => setDraft({ optionsText: e.target.value })}/></label>
        <label><span>Selected by default (one per line)</span><textarea aria-label="New field default selection" rows={1} value={draft.selectedText} onChange={(e) => setDraft({ selectedText: e.target.value })}/></label>
        {draft.kind !== 'radio' && <label className="pdf-tool-dialog-choice"><input type="checkbox" checked={draft.multiselect} onChange={(e) => setDraft({ multiselect: e.target.checked })}/>Allow several selections</label>}
      </>}
      {draft.kind === 'signature' && <>
        <label><span>When signed, lock</span><select aria-label="New signature locks" value={draft.lockAction} onChange={(e) => setDraft({ lockAction: e.target.value as SignatureLock['action'] })}>
          <option value="none">Nothing</option><option value="all">All fields</option><option value="include">Only these fields</option><option value="exclude">All except these fields</option></select></label>
        {(draft.lockAction === 'include' || draft.lockAction === 'exclude') && <div role="group" aria-label="Fields the new signature locks">
          {fields.filter((f) => f.kind !== 'signature').map((f) => <label key={f.name} className="pdf-tool-dialog-choice"><input type="checkbox" checked={draft.lockFields.includes(f.name)}
            onChange={(e) => setDraft({ lockFields: toggle(draft.lockFields, f.name, e.target.checked) })}/>{f.name}</label>)}</div>}
      </>}
      <button type="button" aria-pressed={state?.mode === 'place'} disabled={busy} onClick={() => set({ mode: state?.mode === 'place' ? null : 'place' })}>Place on the page</button>
      {state?.mode === 'place' && <p role="status">Drag on a page to place the {DESIGN_KINDS.find(([k]) => k === draft.kind)![1].toLowerCase()} field; press Escape to stop.</p>}
    </fieldset>
    <fieldset>
      <legend>Fields in this PDF</legend>
      {fields.length ? <label><span>Selected field</span><select aria-label="Selected form field" value={field?.name ?? ''} onChange={(e) => set({ selected: e.target.value || null, mode: null })}>
        <option value="">Choose a field…</option>{fields.map((f) => <option key={f.name} value={f.name}>{f.name} ({f.kind})</option>)}</select></label>
        : <p>No fields yet.</p>}
      <p>Or select a field by clicking its outline on the page.</p>
    </fieldset>
    {field && logic && <fieldset>
      <legend>{field.name}</legend>
      {field.signed && <p role="alert">This field is signed and cannot be changed.</p>}
      <label><span>Name</span><input aria-label="Field name" value={rename} onChange={(e) => setRename(e.target.value)}/></label>
      <button type="button" disabled={busy || !rename.trim() || rename.trim() === field.name}
        onClick={() => {
          // Select the new name first, so the field stays selected when the list reloads.
          const [from, to] = [field.name, rename.trim()];
          set({ selected: to, mode: null });
          void run('Renamed a form field.', async (latest) => ({ bytes: await renameFormField(latest, from, to), summary: `Renamed ${from} to ${to}.` }))
            .then((ok) => { if (!ok) set({ selected: from }); });
        }}>Rename</button>
      <label><span>Tooltip</span><input aria-label="Field tooltip" value={props.tooltip} onChange={(e) => setProps({ ...props, tooltip: e.target.value })}/></label>
      <label className="pdf-tool-dialog-choice"><input type="checkbox" checked={props.required} onChange={(e) => setProps({ ...props, required: e.target.checked })}/>Required</label>
      <label className="pdf-tool-dialog-choice"><input type="checkbox" checked={props.readOnly} onChange={(e) => setProps({ ...props, readOnly: e.target.checked })}/>Read-only</label>
      {isText && <>
        <label><span>Maximum length</span><input aria-label="Field maximum length" type="number" min={1} max={2000} value={props.maxLength} onChange={(e) => setProps({ ...props, maxLength: e.target.value })}/></label>
        <label className="pdf-tool-dialog-choice"><input type="checkbox" checked={props.comb} onChange={(e) => setProps({ ...props, comb: e.target.checked })}/>Comb</label>
        <label><span>Format</span><select aria-label="Field format" value={logic.format} onChange={(e) => setLogic({ ...logic, format: e.target.value as LogicDraft['format'] })}>
          <option value="none">Plain text</option><option value="number">Number</option><option value="date">Date</option></select></label>
        {logic.format === 'number' && <>
          <label><span>Decimals</span><input aria-label="Field decimals" type="number" min={0} max={6} value={logic.decimals} onChange={(e) => setLogic({ ...logic, decimals: e.target.value })}/></label>
          <label><span>Separators</span><select aria-label="Field separators" value={logic.separator} onChange={(e) => setLogic({ ...logic, separator: Number(e.target.value) as NumberSeparator })}>
            {SEPARATORS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label><span>Currency symbol</span><input aria-label="Field currency" value={logic.currency} maxLength={4} onChange={(e) => setLogic({ ...logic, currency: e.target.value })}/></label>
        </>}
        {logic.format === 'date' && <label><span>Date format</span><select aria-label="Field date format" value={logic.datePattern} onChange={(e) => setLogic({ ...logic, datePattern: e.target.value })}>
          {DATE_PATTERNS.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>}
        <label><span>Calculated value</span><select aria-label="Field calculation" value={logic.calcOp} onChange={(e) => setLogic({ ...logic, calcOp: e.target.value as CalcOp | '' })}>
          <option value="">Not calculated</option>{CALC_OPS.map(([op, l]) => <option key={op} value={op}>{l} of fields</option>)}</select></label>
        {logic.calcOp && <div role="group" aria-label="Fields the calculation uses">{others.map((f) => <label key={f.name} className="pdf-tool-dialog-choice">
          <input type="checkbox" checked={logic.calcFields.includes(f.name)} onChange={(e) => setLogic({ ...logic, calcFields: toggle(logic.calcFields, f.name, e.target.checked) })}/>{f.name}</label>)}</div>}
        <label><span>Minimum</span><input aria-label="Field minimum" type="number" value={logic.min} onChange={(e) => setLogic({ ...logic, min: e.target.value })}/></label>
        <label><span>Maximum</span><input aria-label="Field maximum" type="number" value={logic.max} onChange={(e) => setLogic({ ...logic, max: e.target.value })}/></label>
        <label><span>Pattern (regular expression)</span><input aria-label="Field pattern" value={logic.pattern} onChange={(e) => setLogic({ ...logic, pattern: e.target.value })}/></label>
        <label><span>Message when the pattern fails</span><input aria-label="Field pattern message" value={logic.patternMessage} onChange={(e) => setLogic({ ...logic, patternMessage: e.target.value })}/></label>
      </>}
      {field.kind !== 'signature' && <>
        <label><span>Show only when</span><select aria-label="Field shown when" value={logic.showField} onChange={(e) => setLogic({ ...logic, showField: e.target.value })}>
          <option value="">Always shown</option>{others.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}</select></label>
        {logic.showField && <label><span>has the value (empty = any value)</span><input aria-label="Field shown when value" value={logic.showValue} onChange={(e) => setLogic({ ...logic, showValue: e.target.value })}/></label>}
      </>}
      {field.kind === 'signature' && <>
        <label><span>When signed, lock</span><select aria-label="Signature locks" value={props.lockAction} onChange={(e) => setProps({ ...props, lockAction: e.target.value as SignatureLock['action'] })}>
          <option value="none">Nothing</option><option value="all">All fields</option><option value="include">Only these fields</option><option value="exclude">All except these fields</option></select></label>
        {(props.lockAction === 'include' || props.lockAction === 'exclude') && <div role="group" aria-label="Fields the signature locks">
          {fields.filter((f) => f.kind !== 'signature').map((f) => <label key={f.name} className="pdf-tool-dialog-choice"><input type="checkbox" checked={props.lockFields.includes(f.name)}
            onChange={(e) => setProps({ ...props, lockFields: toggle(props.lockFields, f.name, e.target.checked) })}/>{f.name}</label>)}</div>}
      </>}
      {field.logic.unsupported.length > 0 && <p>Scripts MALENJO does not run (kept unchanged): {field.logic.unsupported.map((u) => (u.length > 200 ? `${u.slice(0, 200)}…` : u)).join(' · ')}</p>}
      <div className="pdf-tool-dialog-actions">
        <button type="button" disabled={busy || field.signed} onClick={() => void run('Changed a form field.', async (latest) => ({
          bytes: await updateFormField(latest, field.name, {
            tooltip: props.tooltip, required: props.required, readOnly: props.readOnly,
            ...(isText ? { maxLength: props.maxLength ? Number(props.maxLength) : null, comb: props.comb } : {}),
            ...(field.kind === 'signature' ? { lock: { action: props.lockAction, fields: props.lockFields } } : { logic: logicOf(isText ? logic : { ...logic, format: 'none', calcOp: '', min: '', max: '', pattern: '' }) }),
          }),
          summary: `Updated the field ${field.name}.`,
        }))}>Apply to field</button>
        <button type="button" aria-pressed={state?.mode === 'move'} disabled={busy || field.signed} onClick={() => set({ mode: state?.mode === 'move' ? null : 'move' })}>Move or resize by dragging</button>
        <button type="button" disabled={busy || field.signed} onClick={() => void run('Deleted a form field.', async (latest) => ({ bytes: await deleteFormField(latest, field.name), summary: `Deleted the field ${field.name}.` }))}>Delete field</button>
      </div>
      {state?.mode === 'move' && <p role="status">Drag on the page where {field.name} should go; press Escape to stop.</p>}
    </fieldset>}
    {error && <p role="alert" className="pdf-tool-dialog-error">{error}</p>}
    <small>Formatting, calculations, visibility and validation are saved as standard form scripts that other PDF readers apply. MALENJO evaluates them itself and never runs scripts from a document.</small>
  </section>;
}
