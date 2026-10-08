import { isTauri } from '@tauri-apps/api/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Cpu,
  FilePlus2,
  FolderOpen,
  Gauge,
  LoaderCircle,
  RefreshCw,
  Send,
  ShieldCheck,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import {
  cancelLocalAi,
  getLocalAiStatus,
  runLocalAiChat,
  type AiProvider,
  type AiProviderStatus,
} from './api';
import {
  RAG_LIMITS,
  buildGroundedPrompt,
  buildRagIndex,
  retrieveCitations,
  type Citation,
  type SourceDocument,
} from './rag';
import { extractSourceDocument } from './sources';
import {
  DEFAULT_AI_MODEL_PROFILE,
  aiModelProfileByTag,
  formatModelDownloadSize,
  preferredInstalledModel,
} from './modelProfiles';

interface Props {
  onBackToFiles(): void;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  latencyMs?: number;
}

function id(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function formatBytes(value: number | null): string {
  if (!value) return 'size not reported';
  if (value < 1024 ** 3) return `${Math.round(value / 1024 ** 2)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

export default function AiWorkspace({ onBackToFiles }: Props) {
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const activeJobRef = useRef<string | null>(null);
  const [sources, setSources] = useState<SourceDocument[]>([]);
  const [liteMode, setLiteMode] = useState(true);
  const [provider, setProvider] = useState<AiProvider>('ollama');
  const [statuses, setStatuses] = useState<Partial<Record<AiProvider, AiProviderStatus>>>({});
  const [model, setModel] = useState('');
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [activeJob, setActiveJob] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const index = useMemo(() => buildRagIndex(sources, liteMode), [sources, liteMode]);
  const preview = useMemo(
    () => question.trim() ? retrieveCitations(index, question) : [],
    [index, question],
  );
  const currentStatus = statuses[provider];
  const limits = liteMode ? RAG_LIMITS.lite : RAG_LIMITS.normal;
  const desktopRuntime = isTauri();
  const setupCommand = desktopRuntime
    ? (provider === 'ollama' ? 'ollama pull <reviewed-model>' : 'llama-server -m model.gguf --port 8080')
    : !currentStatus?.available
      ? 'npm run ai:codespace:setup'
      : !currentStatus.models.length
        ? 'npm run ai:codespace:setup:model'
        : 'npm run ai:codespace:check';

  async function refreshProviders() {
    setNotice('Checking local model runtimes…');
    const [ollama, llama] = await Promise.all([
      getLocalAiStatus('ollama').catch((reason) => ({
        provider: 'ollama' as const,
        available: false,
        baseUrl: 'http://127.0.0.1:11434',
        models: [],
        message: String(reason),
      })),
      getLocalAiStatus('llama-cpp').catch((reason) => ({
        provider: 'llama-cpp' as const,
        available: false,
        baseUrl: 'http://127.0.0.1:8080',
        models: [],
        message: String(reason),
      })),
    ]);
    setStatuses({ ollama, 'llama-cpp': llama });
    setNotice('');

    const preferred = provider === 'ollama' ? ollama : llama;
    if (!model && preferred.models[0]) setModel(preferredInstalledModel(preferred.models,provider));
  }

  useEffect(() => {
    void refreshProviders();
    return () => {
      if (activeJobRef.current) void cancelLocalAi(activeJobRef.current);
    };
  // Runtime probing occurs only when this workspace mounts, never at app startup.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const status = statuses[provider];
    if (!status) return;
    if (!status.models.some((item) => item.name === model)) {
      setModel(preferredInstalledModel(status.models,provider));
    }
  }, [model, provider, statuses]);

  async function addSources(files: FileList | null) {
    if (!files?.length) return;
    setError('');
    setNotice('Extracting local document text…');

    const additions: SourceDocument[] = [];
    for (const file of Array.from(files)) {
      try {
        additions.push(await extractSourceDocument(file));
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    }
    if (additions.length) setSources((current) => [...current, ...additions]);
    setNotice(additions.length ? `Indexed ${additions.length} local source file(s).` : '');
  }

  function removeSource(sourceId: string) {
    setSources((current) => current.filter((source) => source.id !== sourceId));
  }

  async function ask() {
    const value = question.trim();
    if (!value || busy) return;

    setError('');
    setNotice('');
    const citations = retrieveCitations(index, value);
    const userMessage: ChatMessage = { id: id('msg'), role: 'user', content: value };
    const conversation = messages.map((message) => ({ role: message.role, content: message.content }));
    setMessages((current) => [...current, userMessage]);
    setQuestion('');

    if (!currentStatus?.available || !model) {
      setMessages((current) => [...current, {
        id: id('msg'),
        role: 'assistant',
        content: citations.length
          ? 'Local retrieval is working and matching source passages are shown below, but no local model runtime/model is connected. Start Ollama or llama.cpp separately, then refresh runtime status.'
          : 'No local model runtime/model is connected, and no matching local source passage was retrieved.',
        citations,
      }]);
      return;
    }

    const job = id('ai');
    setActiveJob(job);
    activeJobRef.current = job;
    setBusy(true);
    try {
      const prompt = buildGroundedPrompt(value, citations, conversation);
      const result = await runLocalAiChat(job, provider, model, prompt, liteMode);
      setMessages((current) => [...current, {
        id: id('msg'),
        role: 'assistant',
        content: result.content,
        citations,
        latencyMs: result.latencyMs,
      }]);
    } catch (reason) {
      const text = reason instanceof Error ? reason.message : String(reason);
      if (!/cancelled/i.test(text)) setError(text);
    } finally {
      setBusy(false);
      setActiveJob(null);
      activeJobRef.current = null;
    }
  }

  async function cancel() {
    if (!activeJob) return;
    await cancelLocalAi(activeJob);
    setBusy(false);
    setActiveJob(null);
    activeJobRef.current = null;
    setNotice('Local AI request cancelled.');
  }

  return <div className="ai-workspace">
    <input
      ref={sourceInputRef}
      className="visually-hidden"
      type="file"
      multiple
      accept=".txt,.md,.csv,.json,.log,.xml,.html,.pdf,.docx,.xlsx,.pptx"
      onChange={(event) => {
        void addSources(event.target.files);
        event.target.value = '';
      }}
    />

    <div className="ai-toolbar">
      <div>
        <button onClick={onBackToFiles}><FolderOpen size={16}/> Files</button>
        <button onClick={() => sourceInputRef.current?.click()}><FilePlus2 size={16}/> Add local sources</button>
        <button onClick={() => void refreshProviders()}><RefreshCw size={16}/> Runtime status</button>
      </div>
      <div className="ai-lite-toggle">
        <Gauge size={15}/>
        <span>Lite Mode</span>
        <input type="checkbox" checked={liteMode} onChange={(event) => setLiteMode(event.target.checked)}/>
      </div>
    </div>

    {(notice || error) && <div className={error ? 'ai-message error' : 'ai-message'}>{error || notice}</div>}

    <div className="ai-layout">
      <aside className="ai-sources">
        <div className="ai-pane-title">Local knowledge</div>
        <div className="rag-stats">
          <span><b>{sources.length}</b> files</span>
          <span><b>{index.chunks.length}</b> chunks</span>
          <span><b>{index.indexedChars.toLocaleString()}</b> chars indexed</span>
          {index.truncated && <strong>Index truncated by {liteMode ? 'Lite' : 'memory'} limits</strong>}
        </div>

        <div className="source-list">
          {sources.map((source) => <div key={source.id}>
            <span><b>{source.name}</b><small>{source.text.length.toLocaleString()} chars</small></span>
            <button title="Remove source" onClick={() => removeSource(source.id)}><X size={14}/></button>
          </div>)}
          {!sources.length && <p>Add PDF, Office, text, Markdown, CSV or JSON files. Source content remains in this browser/desktop session.</p>}
        </div>

        <div className="ai-security-card">
          <ShieldCheck size={16}/>
          <div><b>Untrusted-document boundary</b><span>Retrieved source text is quoted as data. Embedded prompts and role-change instructions are not trusted.</span></div>
        </div>
      </aside>

      <main className="ai-chat">
        <div className="ai-chat-header">
          <div><Bot size={18}/><span><b>Malenjo AI</b><small>Private local RAG</small></span></div>
          <button onClick={() => setMessages([])}><Trash2 size={14}/> Clear chat</button>
        </div>

        <div className="ai-messages">
          {!messages.length && <div className="ai-welcome">
            <div className="hero-mark">M</div>
            <h2>Ask your local documents.</h2>
            <p>MALENJO retrieves relevant passages locally, sends only the bounded grounded prompt to your selected loopback model server, and attaches source citations to the answer.</p>
          </div>}
          {messages.map((message) => <article key={message.id} className={`ai-bubble ${message.role}`}>
            <div className="ai-role">{message.role === 'user' ? 'You' : 'Malenjo AI'}</div>
            <div className="ai-content">{message.content}</div>
            {message.citations?.length ? <div className="ai-citations">
              {message.citations.map((citation) => <details key={citation.id}>
                <summary>[{citation.id}] {citation.sourceName}</summary>
                <p>{citation.excerpt}</p>
              </details>)}
            </div> : null}
            {message.latencyMs !== undefined && <small className="ai-latency">{message.latencyMs} ms local inference</small>}
          </article>)}
          {busy && <div className="ai-thinking"><LoaderCircle className="spin" size={17}/> Running local model…</div>}
        </div>

        <div className="retrieval-preview">
          {preview.length
            ? preview.map((citation) => <span key={citation.id}>[{citation.id}] {citation.sourceName}</span>)
            : question.trim() && <span>No matching local passage yet.</span>}
        </div>

        <div className="ai-composer">
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={sources.length ? 'Ask a question about your local sources…' : 'Add local sources, or ask the connected local model…'}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void ask();
              }
            }}
          />
          {busy
            ? <button className="danger" onClick={() => void cancel()}><Square size={16}/> Cancel</button>
            : <button disabled={!question.trim()} onClick={() => void ask()}><Send size={16}/> Send</button>}
        </div>
      </main>

      <aside className="ai-runtime">
        <div className="ai-pane-title">Local runtime</div>
        <label>Provider
          <select value={provider} onChange={(event) => setProvider(event.target.value as AiProvider)}>
            <option value="ollama">Ollama</option>
            <option value="llama-cpp">llama.cpp server</option>
          </select>
        </label>

        <div className={currentStatus?.available ? 'runtime-card online' : 'runtime-card'}>
          <Cpu size={18}/>
          <div><b>{provider === 'ollama' ? 'Ollama' : 'llama.cpp'}</b><span>{currentStatus?.message ?? 'Status not checked.'}</span><code>{currentStatus?.baseUrl ?? 'loopback only'}</code></div>
        </div>

        <label>Model
          <select value={model} disabled={!currentStatus?.models.length} onChange={(event) => setModel(event.target.value)}>
            {!currentStatus?.models.length && <option value="">No local model reported</option>}
            {currentStatus?.models.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
          </select>
        </label>

        {currentStatus?.models.find((item) => item.name === model) && <div className="model-meta">
          {(() => {
            const item = currentStatus.models.find((entry) => entry.name === model)!;
            const profile=aiModelProfileByTag(item.name);
            return <>
              <span>Size <b>{formatBytes(item.sizeBytes)}</b></span>
              <span>Parameters <b>{item.parameterSize ?? 'not reported'}</b></span>
              <span>Quantization <b>{item.quantization ?? 'not reported'}</b></span>
              <span>Profile <b>{profile?.resourceClass ?? 'custom local'}</b></span>
              <span>License <b>{profile?.license ?? 'not registry-reviewed'}</b></span>
            </>;
          })()}
        </div>}

        <section className="ai-resource-card">
          <h3>{liteMode ? 'Lite Mode active' : 'Standard local mode'}</h3>
          <span>Corpus cap <b>{(limits.maxChars / 1000).toFixed(0)}k chars</b></span>
          <span>Chunk cap <b>{limits.maxChunks}</b></span>
          <span>Retrieved passages <b>{limits.topK}</b></span>
          <span>Model context <b>{liteMode ? '2,048' : '4,096'} tokens</b></span>
          <p>{liteMode ? 'The model is requested with keep_alive=0 on Ollama to release memory after each answer.' : 'Ollama may keep the selected model warm for up to five minutes.'}</p>
        </section>

        <section className="model-install-note">
          <h3>{desktopRuntime ? 'Models are separate' : 'Codespaces AI setup'}</h3>
          <p>{desktopRuntime
            ? 'MALENJO never downloads model weights from this chat screen. Install/load a reviewed local model separately, then refresh status.'
            : currentStatus?.available && currentStatus.models.length
              ? 'A local Codespaces runtime and model are available. Use the diagnostic command if the chat still cannot answer.'
              : currentStatus?.available
                ? 'The runtime is reachable, but it reports no installed model. Use the reviewed development-model bootstrap, then refresh status.'
                : 'No local model runtime is reachable inside this Codespace. Start the explicit loopback runtime bootstrap first.'}</p>
          <code>{setupCommand}</code>
          {!desktopRuntime&&<p>
            Reviewed default: <b>{DEFAULT_AI_MODEL_PROFILE.displayName}</b> · {DEFAULT_AI_MODEL_PROFILE.license} · {formatModelDownloadSize(DEFAULT_AI_MODEL_PROFILE.approximateDownloadBytes)}.
            The runtime adapter is model-agnostic, so future reviewed profiles can replace it without changing chat/RAG code.
          </p>}
        </section>
      </aside>
    </div>
  </div>;
}
