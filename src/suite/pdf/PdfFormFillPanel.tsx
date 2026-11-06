import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { exportPdfFormData } from './api';
import { exportFormData, FORM_DATA_FORMATS, importFormData, type FormDataFormat } from './forms/formData';
import { evaluateFill, fillFormWithLogic, flattenFormFields, readFillForm, type FillField } from './forms/formFill';
import { displayValue } from './forms/formLogic';
import { describePdfError } from './pdfUserErrors';

type Operation = (latest: Uint8Array) => Promise<{ bytes: Uint8Array; summary: string }>;
interface Props {
  domIdPrefix: string; bytes: Uint8Array; sourceName: string; busy: boolean;
  onApply(label: string, operation: Operation): Promise<boolean>; onNotice(message: string): void; onClose(): void;
}

/** MAL-050 / 052 / 053: fill with live calculations, visibility and validation; save, flatten, import and export data. */
export default function PdfFormFillPanel({ domIdPrefix, bytes, sourceName, busy, onApply, onNotice, onClose }: Props) {
  const [fields, setFields] = useState<FillField[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [flatten, setFlatten] = useState<Set<string>>(new Set());
  const [format, setFormat] = useState<FormDataFormat>('json');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const panelRef = useRef<HTMLElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    readFillForm(bytes).then((list) => {
      if (!live) return;
      setFields(list); setValues(Object.fromEntries(list.map((f) => [f.name, f.value])));
      setFlatten((current) => new Set([...current].filter((n) => list.some((f) => f.name === n)))); setError('');
    }).catch((reason) => { if (live) setError(describePdfError(reason)); });
    return () => { live = false; };
  }, [bytes]);
  useEffect(() => { panelRef.current?.querySelector<HTMLElement>('input,select,button[data-autofocus]')?.focus(); }, [fields.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const evaluation = useMemo(() => evaluateFill(fields, values), [fields, values]);
  const editable = fields.filter((f) => f.kind !== 'button' && f.kind !== 'signature');
  const changed = editable.some((f) => (evaluation.values[f.name] ?? '') !== f.value);
  const errorCount = Object.keys(evaluation.errors).length;
  const id = (name: string) => `${domIdPrefix}-fill-${name.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  const setValue = (name: string, value: string) => { setValues({ ...values, [name]: value }); setNote(''); };

  const run = async (label: string, operation: Operation) => {
    setError('');
    try { await onApply(label, operation); } catch (reason) { setError(describePdfError(reason)); }
  };
  async function exportData() {
    setError('');
    try {
      const [, , mime] = FORM_DATA_FORMATS.find(([f]) => f === format)!;
      const name = `${(sourceName || 'form.pdf').replace(/\.pdf$/i, '')}-data.${format}`;
      // Export what is shown, including unsaved entries and calculated values.
      const shown = fields.map((f) => ({ ...f, value: evaluation.values[f.name] ?? f.value }));
      if (await exportPdfFormData(name, exportFormData(shown, format, sourceName || 'form.pdf'), format, mime)) onNotice(`Exported the form data as ${name}.`);
    } catch (reason) { setError(describePdfError(reason)); }
  }
  async function importData(file: File) {
    setError(''); setNote('');
    try {
      const raw = new Uint8Array(await file.arrayBuffer());
      const kind = (file.name.split('.').pop()?.toLowerCase() ?? format) as FormDataFormat;
      const use = FORM_DATA_FORMATS.some(([f]) => f === kind) ? kind : format;
      const text = use === 'fdf' ? Array.from(raw, (b) => String.fromCharCode(b)).join('') : new TextDecoder().decode(raw);
      const imported = importFormData(fields, text, use);
      setValues({ ...values, ...imported.values });
      setNote(`Imported ${Object.keys(imported.values).length} value(s) from ${file.name}.`
        + (imported.unknown.length ? ` Not in this form: ${imported.unknown.join(', ')}.` : '')
        + (imported.skipped.length ? ` Skipped read-only or calculated: ${imported.skipped.join(', ')}.` : '') + ' Choose Save values to keep them.');
    } catch (reason) { setError(describePdfError(reason)); }
  }

  const input = (f: FillField) => {
    const value = values[f.name] ?? '';
    const err = evaluation.errors[f.name];
    const common = { id: id(f.name), 'aria-invalid': err ? true : undefined, 'aria-describedby': err ? `${id(f.name)}-error` : undefined, disabled: busy || f.readOnly || f.calculated };
    if (f.kind === 'checkbox') return <input type="checkbox" {...common} checked={value !== 'Off' && value !== ''} onChange={(e) => setValue(f.name, e.target.checked ? f.onValue ?? 'Yes' : 'Off')}/>;
    if (f.kind === 'radio' || (f.kind === 'dropdown' && !f.multiselect)) return <select {...common} value={value} onChange={(e) => setValue(f.name, e.target.value)}>
      <option value="">—</option>{f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
    if (f.kind === 'list' || f.kind === 'dropdown') return <select {...common} multiple={f.multiselect} size={Math.min(4, f.options.length)} value={f.multiselect ? value.split('\n').filter(Boolean) : value}
      onChange={(e) => setValue(f.name, Array.from(e.target.selectedOptions, (o) => o.value).join('\n'))}>{f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
    return <input {...common} {...(f.password ? { type: 'password', autoComplete: 'new-password' } : {})} value={f.calculated ? displayValue(evaluation.values[f.name] ?? '', f.logic) : value} maxLength={f.maxLength ?? undefined}
      placeholder={f.logic.format?.kind === 'date' ? f.logic.format.pattern : undefined} onChange={(e) => setValue(f.name, e.target.value)}/>;
  };

  return <section ref={panelRef} className="pdf-markup-panel pdf-form-panel" role="dialog" aria-modal="false" aria-labelledby={`${domIdPrefix}-form-fill-title`}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <header>
      <h2 id={`${domIdPrefix}-form-fill-title`}>Fill form</h2>
      <button type="button" aria-label="Close fill form" title="Close" onClick={onClose}><X size={16} aria-hidden="true"/></button>
    </header>
    {!editable.length && !error && <p>This PDF has no form fields to fill.</p>}
    {editable.length > 0 && <fieldset>
      <legend>Fields</legend>
      {editable.map((f) => {
        const hidden = evaluation.hidden.includes(f.name);
        const err = evaluation.errors[f.name];
        return <div key={f.name} className="pdf-form-fill-row" data-hidden={hidden || undefined}>
          <label htmlFor={id(f.name)}>{f.name}{f.required ? ' (required)' : ''}{f.calculated ? ' (calculated)' : ''}{hidden ? ' (hidden by a rule)' : ''}</label>
          {input(f)}
          {f.kind === 'text' && f.logic.format && !f.calculated && values[f.name] && !err && <span className="pdf-form-fill-hint">Shown as {displayValue(values[f.name], f.logic)}</span>}
          {err && <span id={`${id(f.name)}-error`} className="pdf-tool-dialog-error">{err}</span>}
        </div>;
      })}
      <button type="button" className="primary-action" disabled={busy || !changed || errorCount > 0} data-autofocus
        onClick={() => void run('Filled the form.', async (latest) => {
          const result = await fillFormWithLogic(latest, values);
          return { bytes: result.bytes, summary: `Saved the form values.${result.evaluation.hidden.length ? ` Hidden by rules: ${result.evaluation.hidden.join(', ')}.` : ''}` };
        })}>Save values</button>
      {errorCount > 0 && <p role="status">Fix {errorCount} field{errorCount > 1 ? 's' : ''} before saving.</p>}
    </fieldset>}
    {editable.length > 0 && <fieldset>
      <legend>Flatten into the page</legend>
      <div role="group" aria-label="Fields to flatten">{fields.map((f) => <label key={f.name} className="pdf-tool-dialog-choice">
        <input type="checkbox" checked={flatten.has(f.name)} onChange={(e) => { const next = new Set(flatten); if (e.target.checked) next.add(f.name); else next.delete(f.name); setFlatten(next); }}/>{f.name}</label>)}</div>
      <div className="pdf-tool-dialog-actions">
        <button type="button" disabled={busy || changed || !flatten.size} title={changed ? 'Save the values first.' : undefined} onClick={() => void run('Flattened form fields.', async (latest) => {
          const result = await flattenFormFields(latest, [...flatten]);
          return { bytes: result.bytes, summary: `Flattened ${result.flattened.join(', ')} into the page.` };
        })}>Flatten selected</button>
        <button type="button" disabled={busy || changed} title={changed ? 'Save the values first.' : undefined} onClick={() => void run('Flattened the form.', async (latest) => {
          const result = await flattenFormFields(latest, null);
          return { bytes: result.bytes, summary: `Flattened all ${result.flattened.length} field(s) into the page.` };
        })}>Flatten all fields</button>
      </div>
    </fieldset>}
    {editable.length > 0 && <fieldset>
      <legend>Form data</legend>
      <label><span>Format</span><select aria-label="Form data format" value={format} onChange={(e) => setFormat(e.target.value as FormDataFormat)}>
        {FORM_DATA_FORMATS.map(([f, l]) => <option key={f} value={f}>{l}</option>)}</select></label>
      <div className="pdf-tool-dialog-actions">
        <button type="button" disabled={busy} onClick={() => void exportData()}>Export data</button>
        <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}>Import data…</button>
        <input ref={fileRef} type="file" hidden aria-label="Form data file" accept=".csv,.json,.fdf,.xfdf"
          onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void importData(file); }}/>
      </div>
    </fieldset>}
    {note && <p role="status">{note}</p>}
    {error && <p role="alert" className="pdf-tool-dialog-error">{error}</p>}
    <small>Number and date formats, calculations, visibility rules and validations are checked here without running any script from the document.</small>
  </section>;
}
