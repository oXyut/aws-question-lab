import { useEffect, useMemo, useState } from 'react';
import { Check, CircleAlert, Clock3, History, Loader2, RefreshCw, Square, X } from 'lucide-react';
import type { GenerationJob } from '../../shared/schema';

type Activity = NonNullable<GenerationJob['activity']>[number];
type Step = { id: string; label: string };
type Props = {
  job: GenerationJob;
  retrying: boolean;
  onCancel: () => void;
  onRetry: () => void;
  onDismiss: () => void;
};

const generationSteps: Step[] = [
  { id: 'research', label: '公式資料の調査' },
  { id: 'composing', label: '解説の作成' },
  { id: 'validating', label: '整合性の確認' },
  { id: 'verifying', label: '公式本文との照合' },
  { id: 'saving', label: '保存' },
];
const extractionSteps: Step[] = [
  { id: 'extracting', label: '問題の読み取り' },
  { id: 'validating', label: '読み取り内容の確認' },
  { id: 'saving', label: '保存' },
];
const stageLabels: Record<string, string> = {
  queued: '開始を待っています',
  starting: 'Codex CLIを準備しています',
  extracting: '問題文と画像を読み取っています',
  reading: '問題文を読み取っています',
  research: 'AWS公式資料を調査しています',
  researching: 'AWS公式資料を調査しています',
  composing: '解説と構成図を作成しています',
  generating: '解説と構成図を作成しています',
  validating: '問題文・評価・図の整合性を確認しています',
  repairing: '図と評価のつながりを修復しています',
  verifying: '引用をAWS公式本文と照合しています',
  saving: '解説をこのPCに保存しています',
  cancelling: '中断の完了を待っています',
};

function stepFor(stage: string, extraction: boolean): string | null {
  if (stage === 'extracting' || stage === 'reading') return 'extracting';
  if (stage === 'research' || stage === 'researching')
    return extraction ? 'extracting' : 'research';
  if (['thinking', 'composing', 'generating'].includes(stage))
    return extraction ? 'extracting' : 'composing';
  if (stage === 'validating' || stage === 'repairing') return 'validating';
  if (stage === 'verifying') return 'verifying';
  if (stage === 'saving') return 'saving';
  return null;
}
function currentTitle(job: GenerationJob): string {
  if (job.status === 'completed')
    return job.kind === 'extract' ? '問題の読み取りが完了しました' : '解説を保存しました';
  if (job.status === 'failed') return '生成を完了できませんでした';
  if (job.status === 'cancelled') return '生成を中断しました';
  if (job.kind === 'extract' && job.stage === 'validating')
    return '読み取った問題文と選択肢を確認しています';
  if (job.kind === 'extract' && job.stage === 'repairing')
    return '読み取り内容の整合性を修復しています';
  if (job.kind === 'extract' && ['composing', 'generating'].includes(job.stage))
    return '読み取った問題の内容を整理しています';
  if (job.kind === 'extract' && job.stage === 'saving')
    return '読み取り結果をこのPCに保存しています';
  if (job.stage === 'thinking')
    return job.kind === 'extract' ? '問題の内容を確認しています' : '解説の内容を検討しています';
  return stageLabels[job.stage] ?? 'Codexからの処理結果を待っています';
}
function durationLabel(seconds: number | null): string {
  if (seconds === null) return '時刻を確認できません';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return hours
    ? `${hours}時間${String(minutes).padStart(2, '0')}分${rest}秒`
    : `${minutes}分${rest}秒`;
}
function activityTime(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime())
    ? '時刻不明'
    : date.toLocaleTimeString('ja-JP', { hour12: false });
}

export function GenerationProgress({ job, retrying, onCancel, onRetry, onDismiss }: Props) {
  const active = job.status === 'running' || job.status === 'queued';
  const extracting = job.kind === 'extract';
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [active, job.id]);
  const startedAt = Date.parse(job.createdAt);
  const endedAt = active ? now : Date.parse(job.updatedAt);
  const elapsed =
    Number.isFinite(startedAt) && Number.isFinite(endedAt)
      ? Math.max(0, Math.floor((endedAt - startedAt) / 1000))
      : null;
  const activity = useMemo(
    () =>
      Array.isArray(job.activity)
        ? job.activity
            .filter(
              (item) =>
                item &&
                typeof item.at === 'string' &&
                typeof item.stage === 'string' &&
                typeof item.message === 'string',
            )
            .slice(-40)
        : [],
    [job.activity],
  );
  const steps = extracting ? extractionSteps : generationSteps;
  const currentStep = stepFor(job.stage, extracting);
  const recorded = new Set(activity.map((item) => stepFor(item.stage, extracting)).filter(Boolean));
  const recent = activity.slice(-5);
  const previous = activity.slice(0, -5);
  const lastRecordedStep = [...activity]
    .reverse()
    .map((item) => stepFor(item.stage, extracting))
    .find(Boolean);
  const interruptedStep = !active && job.status !== 'completed' ? lastRecordedStep : null;
  const renderHistory = (items: Activity[], offset = 0) => (
    <ol className="progress-history-list">
      {items.map((item, index) => (
        <li key={`${item.at}-${offset + index}`}>
          <time dateTime={item.at}>{activityTime(item.at)}</time>
          <span>{item.message}</span>
        </li>
      ))}
    </ol>
  );

  return (
    <section className={`generation-progress job-${job.status}`} aria-label="生成の進行状況">
      <div className="progress-heading">
        <span className={`progress-status-icon ${active ? 'active' : ''}`} aria-hidden="true">
          {active ? (
            <Loader2 size={21} className="spin" />
          ) : job.status === 'completed' ? (
            <Check size={21} />
          ) : job.status === 'cancelled' ? (
            <Square size={18} />
          ) : (
            <CircleAlert size={21} />
          )}
        </span>
        <div className="progress-heading-copy">
          <span className="progress-kind">
            {extracting
              ? '問題の読み取り'
              : job.kind === 'followup'
                ? '追加質問の解説'
                : '解説の生成'}
          </span>
          <strong className="progress-title" role="status" aria-live="polite" aria-atomic="true">
            {currentTitle(job)}
          </strong>
        </div>
        <div className="progress-elapsed" role="timer" aria-live="off" aria-label="経過時間">
          <Clock3 size={15} aria-hidden="true" />
          <span>経過</span>
          <time dateTime={elapsed === null ? undefined : `PT${elapsed}S`}>
            {durationLabel(elapsed)}
          </time>
        </div>
        <div className="progress-actions">
          {active ? (
            <button
              className="secondary-button compact"
              disabled={job.stage === 'cancelling'}
              onClick={onCancel}
            >
              <Square size={13} />
              {job.stage === 'cancelling' ? '中断処理中' : '中断'}
            </button>
          ) : job.status === 'failed' || job.status === 'cancelled' ? (
            <button className="secondary-button compact" disabled={retrying} onClick={onRetry}>
              <RefreshCw size={14} />
              再試行
            </button>
          ) : (
            <button className="icon-button" aria-label="完了通知を閉じる" onClick={onDismiss}>
              <X size={16} />
            </button>
          )}
        </div>
      </div>
      <p className="progress-current-message">{job.error?.message ?? job.message}</p>
      <ol className="progress-steps" aria-label="処理の段階">
        {steps.map((step, index) => {
          const current = active && currentStep === step.id;
          const seen = recorded.has(step.id);
          const interrupted = interruptedStep === step.id;
          const state = current
            ? 'current'
            : interrupted
              ? 'interrupted'
              : seen
                ? 'recorded'
                : 'unrecorded';
          return (
            <li
              key={step.id}
              className={`progress-step ${state}`}
              aria-current={current ? 'step' : undefined}
            >
              <span className="progress-step-number" aria-hidden="true">
                {index + 1}
              </span>
              <span className="progress-step-copy">
                <strong>{step.label}</strong>
                <small>
                  {current
                    ? job.stage === 'repairing'
                      ? '修復中'
                      : '処理中'
                    : interrupted
                      ? '停止した段階'
                      : seen
                        ? '着手済み'
                        : active
                          ? '待機'
                          : '記録なし'}
                </small>
              </span>
            </li>
          );
        })}
      </ol>
      <div className="progress-detail-row">
        <div className="progress-history">
          <h3>
            <History size={15} aria-hidden="true" />
            直近の処理<span>実際の処理の記録</span>
          </h3>
          {activity.length ? (
            <div aria-live="off">
              {previous.length > 0 && (
                <details className="progress-older-history">
                  <summary>それ以前の記録を表示（{previous.length}件）</summary>
                  {renderHistory(previous)}
                </details>
              )}
              {renderHistory(recent, previous.length)}
            </div>
          ) : (
            <p className="progress-history-empty">
              この処理には過去の進捗記録がありません。上に最新の状態を表示しています。
            </p>
          )}
        </div>
        <aside
          className={`progress-wait-note ${active && elapsed !== null && elapsed >= 90 ? 'long-wait' : ''}`}
        >
          {active && elapsed !== null && elapsed >= 90 ? (
            <>
              <strong>完了通知を待っています</strong>
              <p>
                完了までの時間はまだ分かりません。入力は保持されています。このまま待つか、中断して再試行できます。
              </p>
            </>
          ) : active ? (
            <>
              <strong>入力内容は保持されています</strong>
              <p>
                {extracting
                  ? '読み取り後に、問題文と選択肢を確認・修正できます。'
                  : '調査・生成・検証の結果が届くと、この画面が更新されます。'}
              </p>
            </>
          ) : job.status === 'completed' ? (
            <>
              <strong>
                {extracting ? '読み取り結果を確認してください' : '解説を表示できます'}
              </strong>
              <p>
                {extracting
                  ? '読み取った内容は、解説を生成する前に編集できます。'
                  : '要件・選択肢・図を選んで、根拠のつながりを確認できます。'}
              </p>
            </>
          ) : (
            <>
              <strong>入力内容は保持されています</strong>
              <p>再試行すると同じ入力を使います。既存の解説や、これまでの版も残っています。</p>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
