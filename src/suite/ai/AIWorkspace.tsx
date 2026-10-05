import { useMemo, useRef, useState } from 'react';
import {
  Bot,
  CircleStop,
  FilePlus2,
  Gauge,
  HardDrive,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { extractAiSource } from './extract';
import { buildAiIndex, buildGroundedMessages, retrieveChunks } from './rag';
import { askRuntime, inspectRuntime } from './runtime';
import type {
  AiAnswer,
  AiMode,
  AiRuntimeKind,
  AiSourceSegment,
  RankedChunk,
  RuntimeStatus,
} from './types';

interface Props {
  onBackToFiles(): void;
}

interface ChatEntry {
  id: string;
  question: string;
  answer: AiAnswer;
  citations: RankedChunk[];
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}

export default function AIWorkspace({ onBackToFiles }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [mode, setMode] = useState<AiMode>('standard');
  const [segments, setSegments] = useState<AiSourceSegment[]>([]);
  const [runtimeKind, setRuntimeKind] = useState<AiRuntimeKind>('ollama');
  const [runtimeUrl, setRuntimeUrl] = useState('http://127.0.0.1:11434');
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [model, setModel] = useState('');
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [history, setHistory] = useState<ChatEntry[]>([]);
  const [lastRetrieved, setLastRetrieved] = useState<RankedChunk[]>([]);
  const [pasteName, setPasteName] = useState('Notes');
  const [pasteText, setPasteText] = useState('');

  const index = useMemo(() => buildAiIndex(segments, mode), [segments, mode]);
  const sourceNames = useMemo(() => [...new Set(segments.map((segment) => segment.sourceName))], [segments]);

  function changeRuntime(kind: AiRuntimeKind) {
    setRuntimeKind(kind);
    setRuntimeUrl(kind === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:8080');
    setRuntime(null);
    setModel('');
  }

  async function checkRuntime() {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const next = await inspectRuntime(runtimeKind, runtimeUrl);
      setRuntime(next);
      if (next.reachable && next.models.length && !next.models.some((item) => item.name === model)) {
        setModel(next.models[0].name);
      }
      setNotice(next.reachable
        ? `Local ${runtimeKind} runtime is reachable. ${next.models.length} installed model(s) discovered.`
        : `Local ${runtimeKind} runtime is not reachable. Indexing still works without a model.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function addFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;

    setSourceBusy(true);
    setError('');
    const accepted: AiSourceSegment[] = [];
    const failures: string[] = [];

    for (const file of files) {
      try {
        accepted.push(...await extractAiSource(file, mode));
      } catch (reason) {
        failures.push(`${file.name}: ${reason instanceof Error ? reason.message : String(reason)}`);
      }
    }

    setSegments((current) => [...current, ...accepted]);
    setNotice(`Added ${new Set(accepted.map((segment) => segment.sourceName)).size} source file(s).`);
    if (failures.length) setError(failures.join(' '));
    setSourceBusy(false);
  }

  function addPastedSource() {
    const text = pasteText.trim();
    if (!text) return;
    const id = `pasted:${Date.now()}`;
    setSegments((current) => [...current, {
      sourceId:id,
      sourceName:pasteName.trim() || 'Pasted notes',
      locator:'body',
      text,
    }]);
    setPasteText('');
    setNotice('Added pasted text to the local RAG index.');
  }

  function removeSource(name: string) {
    setSegments((current) => current.filter((segment) => segment.sourceName !== name));
    setLastRetrieved([]);
  }

  async function ask() {
    const prompt = question.trim();
    if (!prompt || busy) return;

    const retrieved = retrieveChunks(prompt, index, mode);
    setLastRetrieved(retrieved);
    if (!retrieved.length) {
      setError('No relevant local passage was retrieved. Add a source or ask a question supported by the indexed documents.');
      return;
    }
    if (!runtime?.reachable) {
      setError('Check a local Ollama or llama.cpp runtime before asking the model.');
      return;
    }
    if (!model) {
      setError('Select an installed local model.');
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError('');
    setNotice('');

    try {
      const answer = await askRuntime(
        runtime,
        model,
        buildGroundedMessages(prompt, retrieved),
        mode,
        controller.signal,
      );
      setHistory((current) => [...current, {
        id:`${Date.now()}:${current.length}`,
        question:prompt,
        answer,
        citations:retrieved,
      }]);
      setQuestion('');
    } catch (reason) {
      if ((reason as { name?: string }).name === 'AbortError') setNotice('Generation cancelled.');
      else setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  function cancel() {
    abortRef.current?.abort();
  }

  return <div className="ai-workspace">
    <input
      ref={fileInputRef}
      className="visually-hidden"
      type="file"
      multiple
      accept=".txt,.md,.csv,.json,.log,.pdf,.docx,.xlsx,.pptx"
      onChange={(event) => void addFiles(event)}
    />

    <header className="ai-toolbar">
      <div className="ai-toolbar-group">
        <button onClick={onBackToFiles}>Files</button>
        <button disabled={sourceBusy} onClick={() => fileInputRef.current?.click()}><FilePlus2 size={16}/> Add sources</button>
        <button onClick={() => setSegments([])} disabled={!segments.length}><Trash2 size={15}/> Clear index</button>
      </div>
      <label className="ai-lite-toggle">
        <input type="checkbox" checked={mode === 'lite'} onChange={(event) => setMode(event.target.checked ? 'lite' : 'standard')}/>
        <Gauge size={15}/> Lite Mode
      </label>
    </header>

    {(notice || error) && <div className={error ? 'ai-message error' : 'ai-message'}>{error || notice}</div>}

    <div className="ai-layout">
      <aside className="ai-sources">
        <div className="ai-pane-title">Local sources</div>
        <div className="ai-source-actions">
          <input value={pasteName} onChange={(event) => setPasteName(event.target.value)} placeholder="Source name"/>
          <textarea value={pasteText} onChange={(event) => setPasteText(event.target.value)} placeholder="Paste local notes or extracted text"/>
          <button disabled={!pasteText.trim()} onClick={addPastedSource}>Add pasted text</button>
        </div>

        <div className="ai-source-list">
          {sourceNames.map((name) => <div key={name} className="ai-source-item">
            <div><strong>{name}</strong><span>{segments.filter((segment) => segment.sourceName === name).length} segment(s)</span></div>
            <button onClick={() => removeSource(name)} aria-label={`Remove ${name}`}><Trash2 size={13}/></button>
          </div>)}
          {!sourceNames.length && <div className="ai-empty-small">Add PDF, Office, or text sources. Scanned PDFs should be OCRed first.</div>}
        </div>

        <div className="ai-index-stats">
          <div><span>Sources</span><b>{index.sourceCount}</b></div>
          <div><span>Chunks</span><b>{index.chunks.length}</b></div>
          <div><span>Text</span><b>{formatBytes(index.totalCharacters)}</b></div>
          <div><span>Mode</span><b>{mode}</b></div>
        </div>
        {index.truncated && <div className="ai-bound-warning">Index was truncated to the {mode} memory budget.</div>}
      </aside>

      <main className="ai-chat">
        <div className="ai-chat-head">
          <div><Sparkles size={18}/><span>Malenjo AI</span></div>
          <span>Private local RAG · sources are treated as untrusted data</span>
        </div>

        <div className="ai-thread">
          {!history.length && <div className="ai-welcome">
            <div className="ai-orb"><Bot size={32}/></div>
            <h1>Ask your local documents.</h1>
            <p>MALENJO retrieves passages locally, sends only the selected passages and your question to the configured loopback model, and shows the exact passages used as citations.</p>
          </div>}

          {history.map((entry) => <article className="ai-turn" key={entry.id}>
            <div className="ai-question"><strong>You</strong><p>{entry.question}</p></div>
            <div className="ai-answer"><strong>Malenjo AI</strong><p>{entry.answer.text}</p><footer>{entry.answer.model} · {entry.answer.latencyMs} ms</footer></div>
            <div className="ai-citations">
              {entry.citations.map((citation) => <details key={citation.id}>
                <summary>[{citation.citation}] {citation.sourceName} · {citation.locator}</summary>
                <p>{citation.text}</p>
              </details>)}
            </div>
          </article>)}
        </div>

        <div className="ai-composer">
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask a question supported by your indexed local sources…"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void ask();
            }}
          />
          {busy
            ? <button className="danger" onClick={cancel}><CircleStop size={17}/> Cancel</button>
            : <button disabled={!question.trim() || !index.chunks.length} onClick={() => void ask()}><Send size={17}/> Ask</button>}
        </div>
      </main>

      <aside className="ai-runtime">
        <div className="ai-pane-title">Local runtime</div>
        <div className="ai-runtime-form">
          <label>Provider<select value={runtimeKind} onChange={(event) => changeRuntime(event.target.value as AiRuntimeKind)}>
            <option value="ollama">Ollama</option>
            <option value="llama.cpp">llama.cpp server</option>
          </select></label>
          <label>Loopback URL<input value={runtimeUrl} onChange={(event) => { setRuntimeUrl(event.target.value); setRuntime(null); }}/></label>
          <button disabled={busy} onClick={() => void checkRuntime()}><RefreshCw size={15}/> Check runtime</button>
        </div>

        <div className={runtime?.reachable ? 'ai-runtime-status ready' : 'ai-runtime-status'}>
          <ShieldCheck size={16}/>
          <div><b>{runtime ? (runtime.reachable ? 'Runtime ready' : 'Runtime unavailable') : 'Not checked'}</b>
          <span>{runtime?.version ? `Ollama ${runtime.version}` : 'No runtime is contacted until you click Check runtime.'}</span></div>
        </div>

        <label className="ai-model-select">Installed model
          <select value={model} onChange={(event) => setModel(event.target.value)} disabled={!runtime?.models.length}>
            <option value="">Select model</option>
            {runtime?.models.map((item) => <option value={item.name} key={item.name}>{item.name}</option>)}
          </select>
        </label>

        <div className="ai-model-list">
          {runtime?.models.map((item) => <div key={item.name}>
            <HardDrive size={14}/><span><b>{item.name}</b><small>{item.parameterSize || 'local'} {item.quantization || ''}</small></span>
          </div>)}
        </div>

        <div className="ai-download-boundary">
          MALENJO does not download models automatically. Install/pull models separately, review each model's license, then use <b>Check runtime</b>.
        </div>

        {!!lastRetrieved.length && <>
          <div className="ai-pane-title">Last retrieval</div>
          <div className="ai-retrieval-list">{lastRetrieved.map((chunk) => <div key={chunk.id}>
            <b>[{chunk.citation}]</b><span>{chunk.sourceName}<small>{chunk.locator} · score {chunk.score.toFixed(2)}</small></span>
          </div>)}</div>
        </>}
      </aside>
    </div>
  </div>;
}
