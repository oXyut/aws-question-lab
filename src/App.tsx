import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  Clock3,
  Code2,
  Download,
  FileImage,
  FileText,
  FlaskConical,
  History,
  ImagePlus,
  Layers3,
  Loader2,
  Menu,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import { QuestionDraftSchema } from '../shared/schema';
import type {
  DocumentSummary,
  ExplanationDocument,
  GenerationJob,
  Health,
  QuestionDraft,
} from '../shared/schema';
import { demoDocument } from '../shared/demo';
import { ExplanationViewer } from './components/ExplanationViewer';
import { GenerationProgress } from './components/GenerationProgress';

type ApiError = Error & { code?: string };
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const error: ApiError = new Error(
      body?.error?.message ?? `通信に失敗しました (${response.status})`,
    );
    error.code = body?.error?.code;
    throw error;
  }
  return response.json() as Promise<T>;
}
const INPUT_KEY = 'aws-question-lab-input-v1';
const JOB_KEY = 'aws-question-lab-job-v1';
function savedInput(): {
  text: string;
  knownAnswer: string;
  originalExplanation: string;
  draft: QuestionDraft | null;
  jobId: string | null;
} {
  try {
    const value = JSON.parse(localStorage.getItem(INPUT_KEY) ?? '{}');
    const parsed = QuestionDraftSchema.safeParse(value.draft);
    return {
      text: typeof value.text === 'string' ? value.text : '',
      knownAnswer: typeof value.knownAnswer === 'string' ? value.knownAnswer : '',
      originalExplanation:
        typeof value.originalExplanation === 'string' ? value.originalExplanation : '',
      draft: parsed.success ? parsed.data : null,
      jobId: localStorage.getItem(JOB_KEY),
    };
  } catch {
    return { text: '', knownAnswer: '', originalExplanation: '', draft: null, jobId: null };
  }
}
const isActive = (job: GenerationJob | null) =>
  !!job && (job.status === 'running' || job.status === 'queued');
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : '処理を完了できませんでした。';
const dateLabel = (date: string) =>
  new Date(date).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });

function DraftEditor({
  draft,
  onChange,
  disabled,
}: {
  draft: QuestionDraft;
  onChange: (draft: QuestionDraft) => void;
  disabled: boolean;
}) {
  const invalidCount =
    draft.selectionMode !== 'none' &&
    draft.selectionCount !== null &&
    (!Number.isInteger(draft.selectionCount) ||
      draft.selectionCount < 1 ||
      draft.selectionCount > draft.options.length ||
      (draft.selectionMode === 'single' && draft.selectionCount !== 1));
  const updateOption = (id: string, key: 'label' | 'text', value: string) =>
    onChange({
      ...draft,
      options: draft.options.map((o) => (o.id === id ? { ...o, [key]: value } : o)),
    });
  return (
    <div className="draft-editor">
      {!!draft.uncertainties.length && (
        <div className="notice warning">
          <Search size={18} />
          <div>
            <strong>読み取り内容を確認してください</strong>
            <ul>
              {draft.uncertainties.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
            <button
              className="text-button"
              disabled={disabled}
              onClick={() => onChange({ ...draft, uncertainties: [] })}
            >
              <Check size={15} />
              確認・修正しました
            </button>
          </div>
        </div>
      )}
      <label className="field-label" htmlFor="draft-title">
        タイトル
      </label>
      <input
        id="draft-title"
        value={draft.title}
        maxLength={200}
        disabled={disabled}
        onChange={(event) => onChange({ ...draft, title: event.target.value })}
        placeholder="この問題のタイトル"
      />
      <label className="field-label" htmlFor="draft-text">
        問題文
      </label>
      <textarea
        id="draft-text"
        className="draft-question"
        value={draft.text}
        maxLength={30000}
        disabled={disabled}
        onChange={(event) => onChange({ ...draft, text: event.target.value })}
      />
      <div className="draft-mode">
        <div>
          <label className="field-label" htmlFor="selection-mode">
            解答形式
          </label>
          <select
            id="selection-mode"
            value={draft.selectionMode}
            disabled={disabled}
            onChange={(event) => {
              const selectionMode = event.target.value as QuestionDraft['selectionMode'];
              onChange({
                ...draft,
                selectionMode,
                selectionCount: selectionMode === 'multiple' ? 2 : null,
                knownAnswerIds:
                  selectionMode === 'none'
                    ? []
                    : draft.knownAnswerIds.slice(0, selectionMode === 'single' ? 1 : undefined),
              });
            }}
          >
            <option value="single">単一選択</option>
            <option value="multiple">複数選択</option>
            <option value="none">選択肢のない質問</option>
          </select>
        </div>
        {draft.selectionMode === 'multiple' && (
          <div>
            <label className="field-label" htmlFor="selection-count">
              選ぶ数（任意）
            </label>
            <input
              id="selection-count"
              type="number"
              min={1}
              max={Math.max(1, draft.options.length)}
              aria-invalid={invalidCount}
              aria-describedby={invalidCount ? 'selection-count-error' : undefined}
              disabled={disabled}
              value={draft.selectionCount ?? ''}
              onChange={(event) =>
                onChange({
                  ...draft,
                  selectionCount: event.target.value ? Number(event.target.value) : null,
                })
              }
            />
          </div>
        )}
      </div>
      {invalidCount && (
        <p id="selection-count-error" className="input-validation-error" role="status">
          {draft.selectionMode === 'single'
            ? '単一選択では選ぶ数を1にしてください。解答形式を切り替えると修正できます。'
            : `選ぶ数は1〜${draft.options.length}の整数にしてください。選択肢の数を超える指定はできません。`}
        </p>
      )}
      {draft.selectionMode !== 'none' && (
        <div className="draft-options">
          <div className="draft-options-heading">
            <h3>選択肢</h3>
            <span>正解がわかる場合はチェック</span>
          </div>
          {draft.options.map((option) => (
            <div className="draft-option" key={option.id}>
              <input
                aria-label={`選択肢 ${option.label} の記号`}
                value={option.label}
                maxLength={20}
                disabled={disabled}
                onChange={(event) => updateOption(option.id, 'label', event.target.value)}
              />
              <textarea
                aria-label={`選択肢 ${option.label} の内容`}
                value={option.text}
                maxLength={5000}
                disabled={disabled}
                onChange={(event) => updateOption(option.id, 'text', event.target.value)}
              />
              <label className="known-answer-check" title="入力された正解">
                <input
                  type="checkbox"
                  checked={draft.knownAnswerIds.includes(option.id)}
                  disabled={disabled}
                  aria-label={`選択肢 ${option.label} を入力された正解にする`}
                  onChange={(event) =>
                    onChange({
                      ...draft,
                      knownAnswerIds: event.target.checked
                        ? draft.selectionMode === 'single'
                          ? [option.id]
                          : [...draft.knownAnswerIds, option.id]
                        : draft.knownAnswerIds.filter((id) => id !== option.id),
                    })
                  }
                />
                <span>正解</span>
              </label>
              <button
                className="icon-button"
                aria-label={`選択肢 ${option.label} を削除`}
                disabled={disabled}
                onClick={() =>
                  onChange({
                    ...draft,
                    options: draft.options.filter((o) => o.id !== option.id),
                    knownAnswerIds: draft.knownAnswerIds.filter((id) => id !== option.id),
                  })
                }
              >
                <X size={16} />
              </button>
            </div>
          ))}
          <button
            className="text-button"
            disabled={disabled || draft.options.length >= 12}
            onClick={() =>
              onChange({
                ...draft,
                options: [
                  ...draft.options,
                  {
                    id: `option-${Date.now()}`,
                    label: String.fromCharCode(65 + draft.options.length),
                    text: '',
                  },
                ],
              })
            }
          >
            <Plus size={16} />
            選択肢を追加
          </button>
        </div>
      )}
      <details className="optional-fields">
        <summary>
          元の解説（任意）
          <ChevronDown size={15} />
        </summary>
        <label className="field-label" htmlFor="draft-explanation">
          教材などに記載された解説
        </label>
        <textarea
          id="draft-explanation"
          value={draft.originalExplanation}
          disabled={disabled}
          maxLength={20000}
          onChange={(event) => onChange({ ...draft, originalExplanation: event.target.value })}
          placeholder="元の解説を照合の参考として使います"
        />
      </details>
    </div>
  );
}

export default function App() {
  const [saved] = useState(savedInput);
  const [health, setHealth] = useState<Health | null>(null);
  const [history, setHistory] = useState<DocumentSummary[]>([]);
  const [document, setDocument] = useState<ExplanationDocument | null>(null);
  const [revisionId, setRevisionId] = useState('');
  const [demo, setDemo] = useState(false);
  const [text, setText] = useState(saved.text);
  const [files, setFiles] = useState<File[]>([]);
  const [knownAnswer, setKnownAnswer] = useState(saved.knownAnswer);
  const [originalExplanation, setOriginalExplanation] = useState(saved.originalExplanation);
  const [draft, setDraft] = useState<QuestionDraft | null>(saved.draft);
  const [job, setJob] = useState<GenerationJob | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loadingDocument, setLoadingDocument] = useState(false);
  const [followup, setFollowup] = useState('');
  const [exporting, setExporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const upload = useRef<HTMLInputElement>(null);
  const completed = useRef(new Set<string>());
  const busy = isActive(job) || submitting;
  const ready = !!health?.codexAvailable && !!health?.authenticated;
  const revision =
    document?.revisions.find((r) => r.id === revisionId) ?? document?.revisions.at(-1);
  const refreshHistory = useCallback(async () => {
    const result = await api<{ documents: DocumentSummary[] }>('/api/documents');
    setHistory(result.documents);
  }, []);
  const refreshHealth = useCallback(async () => {
    try {
      const result = await api<Health>('/api/health');
      setHealth(result);
      return result;
    } catch (err) {
      setError(errorMessage(err));
      return null;
    }
  }, []);
  useEffect(() => {
    void refreshHealth().then((result) => {
      const previousJob = result?.activeJobId ?? saved.jobId;
      if (previousJob)
        void api<{ job: GenerationJob }>(`/api/jobs/${encodeURIComponent(previousJob)}`)
          .then((data) => {
            if (data.job.status === 'completed' && data.job.kind === 'extract' && saved.draft)
              completed.current.add(data.job.id);
            setJob(data.job);
          })
          .catch(() => {
            try {
              localStorage.removeItem(JOB_KEY);
            } catch {
              /* Storage may be disabled. */
            }
          });
    });
    void refreshHistory().catch((err) => setError(errorMessage(err)));
  }, [refreshHealth, refreshHistory, saved.jobId]);
  useEffect(() => {
    try {
      localStorage.setItem(
        INPUT_KEY,
        JSON.stringify({ text, knownAnswer, originalExplanation, draft }),
      );
    } catch {
      /* Continue editing if storage is full or unavailable. */
    }
  }, [text, knownAnswer, originalExplanation, draft]);
  useEffect(() => {
    if (job) {
      try {
        localStorage.setItem(JOB_KEY, job.id);
      } catch {
        /* The server still keeps retry payloads. */
      }
    }
  }, [job?.id]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!job || !isActive(job)) return;
    const id = job.id;
    const source = new EventSource(`/api/jobs/${id}/events`);
    const onEvent = (event: MessageEvent) => {
      try {
        const incoming = JSON.parse(event.data) as GenerationJob;
        setJob(incoming);
        if (!isActive(incoming)) source.close();
      } catch {
        setError('進行状況を読み取れませんでした。再接続を待っています。');
      }
    };
    source.addEventListener('job', onEvent as EventListener);
    const fallback = setInterval(() => {
      void api<{ job: GenerationJob }>(`/api/jobs/${id}`)
        .then((result) => setJob(result.job))
        .catch(() => {
          /* EventSource reconnects; avoid replacing useful input with a transient error. */
        });
    }, 12000);
    return () => {
      source.close();
      clearInterval(fallback);
    };
  }, [job?.id, job?.status]);
  useEffect(() => {
    if (!job || isActive(job) || completed.current.has(job.id)) return;
    completed.current.add(job.id);
    if (job.status === 'completed') {
      if (job.result?.draft) {
        setDraft(job.result.draft);
        setDocument(null);
        setDemo(false);
        setToast('読み取りが完了しました。内容を確認して解説を生成してください。');
      }
      if (job.result?.documentId) {
        void api<{ document: ExplanationDocument }>(`/api/documents/${job.result.documentId}`)
          .then((result) => {
            setDocument(result.document);
            setRevisionId(job.result?.revisionId ?? result.document.revisions.at(-1)!.id);
            setDemo(false);
            setFollowup('');
            void refreshHistory();
          })
          .catch((err) => setError(errorMessage(err)));
      }
    }
    void refreshHealth();
  }, [job, refreshHealth, refreshHistory]);
  const loadDocument = async (id: string) => {
    setError('');
    setLoadingDocument(true);
    try {
      const result = await api<{ document: ExplanationDocument }>(`/api/documents/${id}`);
      setDocument(result.document);
      setRevisionId(result.document.revisions.at(-1)!.id);
      setDemo(false);
      setSidebarOpen(false);
      setFollowup('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingDocument(false);
    }
  };
  const addFiles = (incoming: File[]) => {
    const allowed = incoming.filter(
      (file) =>
        ['image/png', 'image/jpeg', 'image/webp'].includes(file.type) &&
        file.size <= 10 * 1024 * 1024,
    );
    if (allowed.length !== incoming.length)
      setError('画像はPNG・JPEG・WebP、1枚10 MB以下で指定してください。');
    setFiles((current) => {
      if (current.length + allowed.length > 5) setError('画像は1問につき5枚まで追加できます。');
      return [...current, ...allowed].slice(0, 5);
    });
  };
  const runJob = async (url: string, init?: RequestInit) => {
    setError('');
    setSubmitting(true);
    try {
      const result = await api<{ job: GenerationJob }>(url, { method: 'POST', ...init });
      completed.current.delete(result.job.id);
      setJob(result.job);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };
  const extract = () => {
    const data = new FormData();
    data.set('text', text);
    data.set('knownAnswer', knownAnswer);
    data.set('originalExplanation', originalExplanation);
    files.forEach((file) => data.append('images', file));
    void runJob('/api/extract', { body: data });
  };
  const generate = () => {
    if (!draft) return;
    const question =
      draft.selectionMode === 'none'
        ? { ...draft, options: [], knownAnswerIds: [], selectionCount: null }
        : draft;
    void runJob('/api/generate', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });
  };
  const cancel = async () => {
    if (!job) return;
    try {
      const result = await api<{ job: GenerationJob }>(`/api/jobs/${job.id}/cancel`, {
        method: 'POST',
      });
      setJob(result.job);
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const newQuestion = () => {
    setDocument(null);
    setDemo(false);
    setSidebarOpen(false);
    setError('');
    setText('');
    setFiles([]);
    setKnownAnswer('');
    setOriginalExplanation('');
    setDraft(null);
    setFollowup('');
    setJob(null);
    try {
      localStorage.removeItem(JOB_KEY);
    } catch {
      /* Storage is optional. */
    }
  };
  const sendFollowup = () => {
    if (!document || !revision || !followup.trim()) return;
    void runJob(`/api/documents/${document.id}/followups`, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revisionId: revision.id, prompt: followup }),
    });
  };
  const removeDocument = async (id: string) => {
    try {
      await api(`/api/documents/${id}`, { method: 'DELETE' });
      setHistory((current) => current.filter((d) => d.id !== id));
      if (document?.id === id) setDocument(null);
      setDeleteId(null);
      setToast('履歴を削除しました。');
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const download = async () => {
    if (!document || !revision || demo) return;
    setExporting(true);
    setError('');
    try {
      const response = await fetch(
        `/api/documents/${document.id}/export?revisionId=${encodeURIComponent(revision.id)}`,
      );
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error?.message ?? 'HTMLを書き出せませんでした。');
      }
      const url = URL.createObjectURL(await response.blob());
      const link = window.document.createElement('a');
      link.href = url;
      link.download = `${revision.explanation.title.replace(/[\\/:*?"<>|]/g, '_')}.html`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setToast('単体HTMLを書き出しました。ネット接続なしで開けます。');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };
  const validDraft =
    draft &&
    !draft.uncertainties.length &&
    draft.text.trim() &&
    (draft.selectionMode === 'none' ||
      (draft.options.length > 0 &&
        draft.options.every((o) => o.text.trim()) &&
        (draft.selectionCount === null ||
          (Number.isInteger(draft.selectionCount) &&
            draft.selectionCount >= 1 &&
            draft.selectionCount <= draft.options.length &&
            (draft.selectionMode !== 'single' || draft.selectionCount === 1)))));
  const filteredHistory = history.filter((item) =>
    item.title.toLowerCase().includes(historyQuery.toLowerCase()),
  );
  return (
    <div className="app-shell">
      <header className="app-header">
        <button
          className="icon-button mobile-menu"
          aria-label="履歴メニュー"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          <Menu size={20} />
        </button>
        <button className="brand" disabled={busy} onClick={newQuestion}>
          <span className="brand-mark">
            <Layers3 size={23} />
          </span>
          <span>
            AWS <strong>Question Lab</strong>
            <small>問題から、理解へ。</small>
          </span>
        </button>
        <div className="header-right">
          <span className="local-badge">
            <span />
            ローカルワークスペース
          </span>
          <span className="version-label">v0.1</span>
        </div>
      </header>
      {sidebarOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="メニューを閉じる"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <button className="new-question-button" disabled={busy} onClick={newQuestion}>
          <Plus size={17} />
          問題を追加
        </button>
        <div className="sidebar-section-title">
          <History size={15} />
          <span>学習履歴</span>
          <span className="history-count">{history.length}</span>
        </div>
        {history.length > 3 && (
          <div className="history-search">
            <Search size={14} />
            <input
              aria-label="履歴を検索"
              placeholder="タイトルで検索"
              value={historyQuery}
              onChange={(e) => setHistoryQuery(e.target.value)}
            />
          </div>
        )}
        <nav className="history-list" aria-label="学習履歴">
          {filteredHistory.map((item) => (
            <div
              className={`history-item ${document?.id === item.id && !demo ? 'active' : ''}`}
              key={item.id}
            >
              <button
                className="history-open"
                disabled={loadingDocument}
                onClick={() => void loadDocument(item.id)}
              >
                <FileText size={16} />
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    {dateLabel(item.updatedAt)}
                    <span>·</span>
                    {item.revisionCount}つの版
                  </small>
                </span>
              </button>
              <button
                className="history-delete icon-button"
                aria-label={`${item.title} の履歴を削除`}
                disabled={busy}
                onClick={() => setDeleteId(item.id)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {!filteredHistory.length && (
            <div className="history-empty">
              <BookOpen size={26} />
              <p>
                {historyQuery ? '一致する履歴がありません。' : '解説を作ると、ここに保存されます。'}
              </p>
            </div>
          )}
        </nav>
        <button
          className={`demo-button ${demo ? 'active' : ''}`}
          disabled={busy}
          onClick={() => {
            setDocument(demoDocument);
            setRevisionId(demoDocument.revisions[0].id);
            setDemo(true);
            setSidebarOpen(false);
            setError('');
          }}
        >
          <FlaskConical size={17} />
          <span>
            サンプルを見てみる<small>連動する図解を体験</small>
          </span>
          <ArrowRight size={15} />
        </button>
        <div className="sidebar-footer">
          <span className={`status-dot ${ready ? 'ready' : ''}`} />
          <div>
            <strong>
              {health ? (ready ? 'Codex CLI 接続済み' : 'Codex CLI の確認が必要') : '接続を確認中…'}
            </strong>
            <span>{health?.model || '設定済みのモデルを使用'}</span>
          </div>
          <button
            className="icon-button"
            aria-label="Codexの接続状態を再確認"
            onClick={() => void refreshHealth()}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </aside>
      <main className="main-content">
        {error && (
          <div className="notice error" role="alert">
            <CircleError />
            <div>{error}</div>
            <button
              className="icon-button"
              aria-label="エラー表示を閉じる"
              onClick={() => setError('')}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {health && !ready && (
          <div className="notice connection-notice">
            <Code2 size={19} />
            <div>
              <strong>Codex CLI を準備すると、解説を生成できます</strong>
              <p>{health.message}</p>
              <p>
                ターミナルで <code>codex login</code>{' '}
                を実行し、「接続を再確認」を押してください。CLIが未導入の場合はREADMEのセットアップ手順をご覧ください。
              </p>
              <button className="text-button" onClick={() => void refreshHealth()}>
                <RefreshCw size={14} />
                接続を再確認
              </button>
            </div>
          </div>
        )}
        {job && (
          <GenerationProgress
            job={job}
            retrying={submitting}
            onCancel={() => void cancel()}
            onRetry={() => void runJob(`/api/jobs/${job.id}/retry`)}
            onDismiss={() => {
              setJob(null);
              try {
                localStorage.removeItem(JOB_KEY);
              } catch {
                /* Storage is optional. */
              }
            }}
          />
        )}
        {document && revision ? (
          <>
            <div className="document-heading">
              <div>
                <div className="breadcrumb">
                  学習ワークスペース <span>/</span> {demo ? 'サンプル' : '解説'}
                </div>
                <h1>{revision.explanation.title}</h1>
                <p>
                  <Clock3 size={14} />
                  {new Date(revision.createdAt).toLocaleString('ja-JP')}
                  {demo && <span className="sample-tag">サンプル教材</span>}
                </p>
              </div>
              <div className="document-actions">
                <select
                  aria-label="解説の版"
                  value={revision.id}
                  onChange={(event) => setRevisionId(event.target.value)}
                >
                  {document.revisions.map((r, i) => (
                    <option key={r.id} value={r.id}>
                      第{i + 1}版{r.prompt ? ` · ${r.prompt.slice(0, 24)}` : ' · 最初の解説'}
                    </option>
                  ))}
                </select>
                <button
                  className="secondary-button"
                  onClick={() => void download()}
                  disabled={exporting || demo}
                  title={
                    demo
                      ? '生成・保存した解説から書き出せます'
                      : '現在の版をオフラインHTMLに書き出す'
                  }
                >
                  {exporting ? <Loader2 className="spin" size={16} /> : <Download size={16} />}
                  HTML出力
                </button>
              </div>
            </div>
            {demo && (
              <div className="sample-notice">
                <FlaskConical size={16} />
                <p>
                  これは操作を体験するためのサンプルです。新しく生成した解説ではなく、出典の確認結果もデモ表示です。
                </p>
                <button className="text-button" onClick={newQuestion}>
                  自分の問題を入力
                  <ArrowRight size={15} />
                </button>
              </div>
            )}
            {revision.prompt && (
              <div className="revision-prompt">
                <MessageSquare size={17} />
                <span>この版への追加質問：{revision.prompt}</span>
              </div>
            )}
            <ExplanationViewer key={revision.id} revision={revision} />
            <section className="followup-section">
              <div className="section-label">
                <MessageSquare size={18} />
                <h3>もう一歩、掘り下げる</h3>
                <span className="muted small">選択中の版をもとに新しい版を作成します</span>
              </div>
              <div className="followup-suggestions">
                {[
                  'なぜBの選択肢は不適切なの？',
                  '運用負荷よりコストを優先すると？',
                  '処理の流れをもっと詳しく教えて',
                ].map((item) => (
                  <button key={item} onClick={() => setFollowup(item)} disabled={demo || busy}>
                    {item}
                  </button>
                ))}
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  sendFollowup();
                }}
              >
                <textarea
                  aria-label="追加質問"
                  value={followup}
                  onChange={(event) => setFollowup(event.target.value)}
                  placeholder={
                    demo
                      ? '自分の問題を生成すると、追加質問できます。'
                      : '「即時性が不要なら？」など、条件を変えて聞いてみましょう'
                  }
                  disabled={demo || busy}
                  maxLength={10000}
                />
                <button
                  className="primary-button"
                  type="submit"
                  disabled={!followup.trim() || demo || busy || !ready}
                >
                  <Send size={16} />
                  追加質問する
                </button>
              </form>
              <p className="muted small">
                AWS公式資料を再確認して図解を更新します。元の解説はそのまま保存されます。
              </p>
            </section>
          </>
        ) : (
          <div className="input-workspace">
            <div className="input-heading">
              <div className="breadcrumb">
                学習ワークスペース <span>/</span> 新しい問題
              </div>
              <h1>問題を、構造から理解する。</h1>
              <p>要件を読み解き、選択肢を比較し、AWSの仕組みを図でつかむ。</p>
            </div>
            <div className="input-stepper">
              <span className={!draft ? 'active' : 'done'}>
                <i>{draft ? <Check size={13} /> : '1'}</i>問題を入力
              </span>
              <span className={draft ? 'active' : ''}>
                <i>2</i>内容を確認
              </span>
              <span>
                <i>3</i>図解で理解
              </span>
            </div>
            <section className="input-card">
              <div className="input-card-heading">
                <div>
                  <FileText size={19} />
                  <h2>{draft ? '読み取り内容を確認' : 'AWSの問題を入力'}</h2>
                </div>
                <span>
                  {draft ? '必要に応じて編集できます' : 'テキスト・スクリーンショットに対応'}
                </span>
              </div>
              {draft ? (
                <DraftEditor draft={draft} onChange={setDraft} disabled={busy} />
              ) : (
                <>
                  <div
                    className="question-input-area"
                    onPaste={(event) => {
                      const images = [...event.clipboardData.files].filter((file) =>
                        file.type.startsWith('image/'),
                      );
                      if (images.length && !busy) {
                        event.preventDefault();
                        addFiles(images);
                      }
                    }}
                  >
                    <label className="sr-only" htmlFor="question-input">
                      問題文と選択肢
                    </label>
                    <textarea
                      id="question-input"
                      value={text}
                      onChange={(event) => setText(event.target.value)}
                      placeholder={
                        '問題文と選択肢を、そのまま貼り付けてください。\n\n例：大量のイベントを取り込み、過去24時間のデータを再処理できる構成が必要です。運用負荷を最小限にするには、どのサービスを選ぶべきですか？\n\nA. …\nB. …'
                      }
                      maxLength={30000}
                      disabled={busy}
                    />
                    <div className="input-count">
                      <span>画像のペーストにも対応</span>
                      <span>{text.length.toLocaleString()} / 30,000</span>
                    </div>
                  </div>
                  <div
                    className={`image-dropzone ${dragging ? 'dragging' : ''}`}
                    onDragOver={(event: DragEvent) => {
                      event.preventDefault();
                      if (!busy) setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(event: DragEvent) => {
                      event.preventDefault();
                      setDragging(false);
                      if (!busy) addFiles([...event.dataTransfer.files]);
                    }}
                  >
                    <ImagePlus size={23} />
                    <div>
                      <strong>スクリーンショットをドラッグ＆ドロップ</strong>
                      <span>PNG・JPEG・WebP / 1枚10 MBまで / 最大5枚</span>
                    </div>
                    <button
                      className="secondary-button compact"
                      disabled={busy}
                      onClick={() => upload.current?.click()}
                    >
                      画像を選択
                    </button>
                    <input
                      className="sr-only"
                      ref={upload}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      multiple
                      onChange={(event: ChangeEvent<HTMLInputElement>) => {
                        addFiles([...(event.target.files ?? [])]);
                        event.target.value = '';
                      }}
                    />
                  </div>
                  {!!files.length && (
                    <div className="upload-list">
                      {files.map((file, i) => (
                        <div key={`${file.name}-${i}`}>
                          <FileImage size={17} />
                          <span>
                            {file.name}
                            <small>{(file.size / 1024).toFixed(0)} KB</small>
                          </span>
                          <button
                            className="icon-button"
                            disabled={busy}
                            aria-label={`${file.name} を取り除く`}
                            onClick={() =>
                              setFiles((current) => current.filter((_, index) => i !== index))
                            }
                          >
                            <X size={15} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <details className="optional-fields">
                    <summary>
                      <Settings2 size={16} />
                      正解・元の解説を追加する（任意）
                      <ChevronDown size={15} />
                    </summary>
                    <label className="field-label" htmlFor="known-answer">
                      入力された正解
                    </label>
                    <input
                      id="known-answer"
                      value={knownAnswer}
                      disabled={busy}
                      onChange={(event) => setKnownAnswer(event.target.value)}
                      placeholder="例：B、または A と C"
                    />
                    <label className="field-label" htmlFor="original-explanation">
                      元の解説
                    </label>
                    <textarea
                      id="original-explanation"
                      value={originalExplanation}
                      disabled={busy}
                      maxLength={20000}
                      onChange={(event) => setOriginalExplanation(event.target.value)}
                      placeholder="教材などに記載された解説を貼り付け"
                    />
                  </details>
                </>
              )}
              <div className="input-card-footer">
                <div>
                  <span className="privacy-dot" />
                  入力・履歴はこのPCに保存されます
                  <small>生成時は入力をCodexに送信し、解説ではAWS公式資料を確認します。</small>
                </div>
                {draft ? (
                  <div className="input-actions">
                    <button className="text-button" disabled={busy} onClick={() => setDraft(null)}>
                      入力に戻る
                    </button>
                    <button
                      className="primary-button"
                      disabled={busy || !ready || !validDraft}
                      onClick={generate}
                    >
                      {busy ? <Loader2 size={17} className="spin" /> : <Layers3 size={17} />}
                      図解を生成する
                      <ArrowRight size={16} />
                    </button>
                  </div>
                ) : (
                  <button
                    className="primary-button"
                    disabled={busy || !ready || (!text.trim() && !files.length)}
                    onClick={extract}
                  >
                    {busy ? <Loader2 size={17} className="spin" /> : <Search size={17} />}
                    問題を読み取る
                    <ArrowRight size={16} />
                  </button>
                )}
              </div>
            </section>
            <div className="feature-preview">
              <div>
                <span className="feature-icon">
                  <Layers3 size={20} />
                </span>
                <strong>公式アイコンの構成図</strong>
                <p>
                  サービスのつながりと
                  <br />
                  データの流れをたどる。
                </p>
              </div>
              <div>
                <span className="feature-icon">
                  <ListFilterIcon />
                </span>
                <strong>要件から選択肢を検討</strong>
                <p>
                  どの一文が判断を決めるのか。
                  <br />
                  原文・図・評価を一緒に確認。
                </p>
              </div>
              <div>
                <span className="feature-icon">
                  <BookOpen size={20} />
                </span>
                <strong>根拠まで、確認できる</strong>
                <p>
                  AWS公式資料を毎回調査。
                  <br />
                  出典と確認結果を解説に添付。
                </p>
              </div>
            </div>
          </div>
        )}
        <footer className="workspace-footer">
          <span>AWS Question Lab</span>
          <span>AWS Architecture Icons を使用 · 個人学習用ワークスペース</span>
        </footer>
      </main>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
      {deleteId && (
        <div className="modal-backdrop">
          <section
            className="confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-title"
          >
            <div className="modal-icon">
              <Trash2 size={24} />
            </div>
            <h2 id="delete-title">この学習履歴を削除しますか？</h2>
            <p>保存されたすべての版と添付画像が削除されます。この操作は取り消せません。</p>
            <div>
              <button className="secondary-button" onClick={() => setDeleteId(null)}>
                キャンセル
              </button>
              <button className="danger-button" onClick={() => void removeDocument(deleteId)}>
                履歴を削除
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
function CircleError() {
  return (
    <span className="circle-error" aria-hidden="true">
      !
    </span>
  );
}
function ListFilterIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M4 6h16M4 12h12M4 18h7" />
    </svg>
  );
}
