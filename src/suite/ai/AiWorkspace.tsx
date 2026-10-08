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
import { extractOpenDocumentSource, extractSourceDocument, isOpenDocumentAiSource } from './sources';
import type { LibraryDocument } from '../files/types';
import {
  DEFAULT_AI_MODEL_PROFILE,
  aiModelProfileByTag,
  approvedInstalledModels,
  formatModelDownloadSize,
  preferredInstalledModel,
} from './modelProfiles';

interface Props {
  onBackToFiles(): void;
  openDocuments: LibraryDocument[];
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

export default function AiWorkspace({ onBackToFiles, openDocuments }: Props) {
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const activeJobRef = useRef<string | null>(null);
  const [manualSources, setManualSources] = useState<SourceDocument[]>([]);
  const [openSources, setOpenSources] = useState<SourceDocument[]>([]);
  const [openSourceError, setOpenSourceError] = useState('');
  const [openSourceLoading, setOpenSourceLoading] = useState(false);
  const openSourceCacheRef = useRef(new Map<string,SourceDocument>());
  const sources = useMemo(()=>[...openSources,...manualSources],[openSources,manualSources]);
  const openSourceIds = useMemo(()=>new Set(openSources.map((source)=>source.id)),[openSources]);
  const [liteMode, setLiteMode] = useState(true);
  const provider: AiProvider = 'ollama';
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
    ? `ollama pull ${DEFAULT_AI_MODEL_PROFILE.tag}`
    : !currentStatus?.available
      ? 'npm run ai:codespace:setup'
      : !currentStatus.models.length
        ? 'npm run ai:codespace:setup:model'
        : 'npm run ai:codespace:check';

  async function refreshProviders() {
    setNotice('Checking local model runtime…');
    const ollama = await getLocalAiStatus('ollama').catch((reason) => ({
      provider: 'ollama' as const,
      available: false,
      baseUrl: 'http://127.0.0.1:11434',
      models: [],
      message: String(reason),
    }));
    const reviewedModels=approvedInstalledModels(ollama.models);
    const reviewedStatus:AiProviderStatus={
      ...ollama,
      models:reviewedModels,
      message:ollama.available
        ? reviewedModels.length
          ? 'Codespaces bridge reached the reviewed MALENJO Phi-4 model.'
          : 'Ollama is reachable, but the reviewed MALENJO Phi-4 model is not installed.'
        : ollama.message,
    };
    setStatuses({ ollama:reviewedStatus });
    setNotice('');

    if (!model && reviewedModels[0]) setModel(preferredInstalledModel(reviewedModels,'ollama'));
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

  useEffect(()=>{
    let cancelled=false;
    const indexable=openDocuments.filter(isOpenDocumentAiSource);
    const liveKeys=new Set(indexable.map((document)=>`${document.id}:${document.modifiedMs}:${document.sizeBytes}`));

    for(const key of Array.from(openSourceCacheRef.current.keys())){
      if(!liveKeys.has(key))openSourceCacheRef.current.delete(key);
    }

    async function syncOpenSources(){
      if(!cancelled)setOpenSourceLoading(indexable.length>0);
      const next:SourceDocument[]=[];
      const failures:string[]=[];
      for(const document of indexable){
        const key=`${document.id}:${document.modifiedMs}:${document.sizeBytes}`;
        try{
          let source=openSourceCacheRef.current.get(key);
          if(!source){
            source=await extractOpenDocumentSource(document);
            openSourceCacheRef.current.set(key,source);
          }
          next.push(source);
        }catch(reason){
          failures.push(`${document.name}: ${reason instanceof Error?reason.message:String(reason)}`);
        }
      }
      if(cancelled)return;
      setOpenSources(next);
      setOpenSourceError(failures.length
        ? `${failures.length} open document(s) could not be linked to AI knowledge. ${failures[0]}`
        : '');
      setOpenSourceLoading(false);
    }

    void syncOpenSources();
    return ()=>{cancelled=true;};
  },[openDocuments]);

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
    if (additions.length) setManualSources((current) => [...current, ...additions]);
    setNotice(additions.length ? `Indexed ${additions.length} local source file(s).` : '');
  }

  function removeSource(sourceId: string) {
    setManualSources((current) => current.filter((source) => source.id !== sourceId));
  }

  async function ask() {
    const value = question.trim();
    if (!value || busy) return;
    if(openSourceLoading){
      setError('Open documents are still being indexed. Ask again when the linked-source count finishes updating.');
      return;
    }

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
    const assistantMessageId = id('msg');
    setActiveJob(job);
    activeJobRef.current = job;
    setBusy(true);
    setMessages((current) => [...current, {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      citations,
    }]);
    try {
      const prompt = buildGroundedPrompt(value, citations, conversation, {liteMode});
      const result = await runLocalAiChat(job, provider, model, prompt, liteMode, (content) => {
        setMessages((current) => current.map((message) =>
          message.id === assistantMessageId ? { ...message, content } : message,
        ));
      });
      setMessages((current) => current.map((message) =>
        message.id === assistantMessageId
          ? { ...message, content: result.content, latencyMs: result.latencyMs }
          : message,
      ));
    } catch (reason) {
      const text = reason instanceof Error ? reason.message : String(reason);
      if (/cancelled/i.test(text)) {
        setMessages((current)=>current.filter((message)=>message.id!==assistantMessageId));
      } else {
        setError(text);
        setMessages((current)=>current.map((message)=>
          message.id===assistantMessageId
            ? { ...message, content:`Generation stopped: ${text}` }
            : message,
        ));
      }
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

    {(notice || error || openSourceError || openSourceLoading) && <div className={(error || openSourceError) ? 'ai-message error' : 'ai-message'}>{error || openSourceError || (openSourceLoading ? `Indexing ${openDocuments.filter(isOpenDocumentAiSource).length} open document(s) for AI…` : notice)}</div>}

    <div className="ai-layout">
      <aside className="ai-sources">
        <div className="ai-pane-title">Local knowledge</div>
        <div className="rag-stats">
          <span><b>{sources.length}</b> files</span>
          <span><b>{index.chunks.length}</b> chunks</span>
          <span><b>{index.indexedChars.toLocaleString()}</b> chars indexed</span>
          {openSourceLoading && <strong>Indexing open tabs…</strong>}
          {index.truncated && <strong>Index truncated by {liteMode ? 'Lite' : 'memory'} limits</strong>}
        </div>

        <div className="source-list">
          {sources.map((source) => {
            const linked=openSourceIds.has(source.id);
            return <div key={source.id}>
              <span><b>{source.name}</b><small>{linked?'Open tab · ':''}{source.text.length.toLocaleString()} chars</small></span>
              {linked
                ? <small title="This source follows an open MALENJO document tab.">Linked</small>
                : <button title="Remove source" onClick={() => removeSource(source.id)}><X size={14}/></button>}
            </div>;
          })}
          {!sources.length && <p>Open PDF/Office documents in MALENJO or add local sources here. Open supported tabs are linked automatically.</p>}
        </div>

        <div className="ai-security-card">
          <ShieldCheck size={16}/>
          <div><b>Untrusted-document boundary</b><span>Open tabs are indexed automatically from their opened/saved bytes. Unsaved editor changes are not yet included. Retrieved source text is quoted as data; embedded prompts are not trusted.</span></div>
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
          {busy && <div className="ai-thinking"><LoaderCircle className="spin" size={17}/> {messages.some((message)=>message.role==='assistant'&&message.content) ? 'Generating locally…' : 'Loading local model…'}</div>}
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
            : <button disabled={!question.trim()||openSourceLoading} onClick={() => void ask()}><Send size={16}/> Send</button>}
        </div>
      </main>

      <aside className="ai-runtime">
        <div className="ai-pane-title">Local runtime</div>
        <div className={currentStatus?.available ? 'runtime-card online' : 'runtime-card'}>
          <Cpu size={18}/>
          <div><b>Ollama · MALENJO Phi-4</b><span>{currentStatus?.message ?? 'Status not checked.'}</span><code>{currentStatus?.baseUrl ?? 'loopback only'}</code></div>
        </div>

        <label>Model
          <select value={model} disabled>
            {!currentStatus?.models.length && <option value="">Reviewed Phi-4 not installed</option>}
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
          <span>Model context <b>{liteMode ? '4,096' : '8,192'} tokens</b></span>
          <span>Answer cap <b>{liteMode ? '128' : '768'} tokens</b></span>
          <p>{liteMode ? 'Codespaces streams tokens as they arrive and keeps Ollama warm for two minutes to avoid a full model reload on every question.' : 'Ollama may keep the selected model warm for up to five minutes.'}</p>
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
            MALENJO exposes this single reviewed model at runtime. Future model upgrades replace this profile after review rather than adding parallel model choices.
          </p>}
        </section>
      </aside>
    </div>
  </div>;
}
