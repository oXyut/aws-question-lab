import { useMemo, useState } from 'react';
import {
  BookOpen,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ExternalLink,
  GitBranch,
  Info,
  ListFilter,
  RotateCcw,
  ShieldCheck,
  X,
  Zap,
} from 'lucide-react';
import {
  applyEvidenceStatus,
  quoteSpan,
  verdictLabels,
  type ExplanationRevision,
  type Requirement,
  type Verdict,
} from '../../shared/schema';
import { ArchitectureDiagram } from './ArchitectureDiagram';

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return (
    <span className={`verdict verdict-${verdict}`}>
      {verdict === 'meets' ? (
        <Check size={13} />
      ) : verdict === 'violates' ? (
        <X size={13} />
      ) : verdict === 'inferior' ? (
        <ChevronRight size={13} />
      ) : (
        <CircleHelp size={13} />
      )}
      {verdictLabels[verdict]}
    </span>
  );
}
function RequirementText({
  text,
  requirements,
  selected,
  onSelect,
}: {
  text: string;
  requirements: Requirement[];
  selected: string[];
  onSelect: (ids: string[]) => void;
}) {
  const spans = requirements
    .map((r) => ({ requirement: r, span: quoteSpan(text, r) }))
    .filter((item) => item.span !== null);
  const points = [
    ...new Set([0, text.length, ...spans.flatMap((item) => [item.span!.start, item.span!.end])]),
  ].sort((a, b) => a - b);
  return (
    <div className="question-text">
      {points.slice(0, -1).map((start, i) => {
        const end = points[i + 1];
        const matching = spans
          .filter((item) => item.span!.start <= start && item.span!.end >= end)
          .map((item) => item.requirement);
        if (!matching.length) return <span key={start}>{text.slice(start, end)}</span>;
        return (
          <button
            key={start}
            className={`quote-highlight ${matching.some((r) => selected.includes(r.id)) ? 'selected' : ''}`}
            title={matching.map((r) => r.label).join('・')}
            aria-pressed={matching.some((r) => selected.includes(r.id))}
            onClick={() => onSelect(matching.map((r) => r.id))}
          >
            {text.slice(start, end)}
          </button>
        );
      })}
    </div>
  );
}
function officialSourceUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      ['aws.amazon.com', 'docs.aws.amazon.com'].includes(url.hostname) &&
      !url.username &&
      !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
function progressiveVerdict(checks: { verdict: Verdict }[]): Verdict {
  return checks.some((c) => c.verdict === 'violates')
    ? 'violates'
    : !checks.length || checks.some((c) => c.verdict === 'unknown')
      ? 'unknown'
      : checks.some((c) => c.verdict === 'inferior')
        ? 'inferior'
        : 'meets';
}
export function ExplanationViewer({
  revision,
  iconBase,
  iconMap,
}: {
  revision: ExplanationRevision;
  iconBase?: string;
  iconMap?: Record<string, string>;
}) {
  const explanation = useMemo(
    () => applyEvidenceStatus(revision.explanation),
    [revision.explanation],
  );
  const question = revision.question;
  const [requirements, setRequirements] = useState<string[]>([]);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [graphId, setGraphId] = useState(explanation.recommendedArchitectureId);
  const [requirementStep, setRequirementStep] = useState(-1);
  const [tab, setTab] = useState('diagram');
  const graph =
    explanation.architectures.find((g) => g.id === graphId) ?? explanation.architectures[0];
  const revealIds =
    requirementStep < 0
      ? explanation.requirements.map((r) => r.id)
      : explanation.requirements.slice(0, requirementStep + 1).map((r) => r.id);
  const relevantChecks = explanation.evaluations
    .filter((e) => !selectedOption || e.optionId === selectedOption)
    .flatMap((e) => e.checks)
    .filter((c) => requirements.includes(c.requirementId));
  const highlightedNodeIds = relevantChecks.flatMap((c) => c.nodeIds);
  const highlightedEdgeIds = relevantChecks.flatMap((c) => c.edgeIds);
  const selectRequirements = (ids: string[]) => {
    setRequirements(ids);
  };
  const selectOption = (id: string) => {
    const evaluation = explanation.evaluations.find((e) => e.optionId === id);
    setSelectedOption(id);
    if (evaluation?.architectureId) setGraphId(evaluation.architectureId);
    setRequirements(
      evaluation?.checks.filter((c) => c.verdict !== 'meets').map((c) => c.requirementId) ?? [],
    );
  };
  const moveStep = (next: number) => {
    setRequirementStep(next);
    setRequirements(next < 0 ? [] : [explanation.requirements[next].id]);
  };
  const answerLabels = explanation.answerOptionIds
    .map((id) => question.options.find((o) => o.id === id)?.label ?? id)
    .join(' + ');
  const knownLabels = question.knownAnswerIds
    .map((id) => question.options.find((o) => o.id === id)?.label ?? id)
    .join(' + ');
  const disagrees =
    question.knownAnswerIds.length > 0 &&
    [...question.knownAnswerIds].sort().join('|') !==
      [...explanation.answerOptionIds].sort().join('|');
  return (
    <div className="explanation-viewer">
      {(!explanation.sources.length ||
        explanation.sources.some((source) => source.status !== 'verified')) && (
        <div className="notice warning">
          <Info size={18} />
          <div>
            <strong>判断の根拠に要確認の項目があります</strong>
            <p>
              AWS公式本文と照合できていない根拠があります。該当する評価は「情報不足」として表示し、その判断だけでは選択肢を除外しません。
            </p>
          </div>
        </div>
      )}
      <div className="answer-banner">
        <div className="answer-symbol">
          <Zap size={23} />
        </div>
        <div>
          <span className="eyebrow">
            {question.knownAnswerIds.length ? '解答の検討' : '推定解答'}
            {answerLabels ? ` · ${answerLabels}` : ''}
          </span>
          <h2>{explanation.shortAnswer}</h2>
          <p>{explanation.answerRationale}</p>
        </div>
      </div>
      {disagrees && (
        <div className="notice warning">
          <Info size={18} />
          <div>
            <strong>入力された正解と推定解答が異なります</strong>
            <p>
              入力された正解：{knownLabels} ／ 推定解答：{answerLabels || '未確定'}
              。下の根拠と前提条件を確認してください。
            </p>
          </div>
        </div>
      )}
      {!disagrees && knownLabels && (
        <p className="answer-reference">
          <CheckCircle2 size={15} />
          入力された正解（{knownLabels}）と推定解答が一致しています。
        </p>
      )}
      <div className="requirement-toolbar">
        <div className="toolbar-label">
          <ListFilter size={17} />
          <strong>要件で絞り込む</strong>
          <span>
            {requirementStep < 0
              ? '全要件を表示'
              : `${requirementStep + 1} / ${explanation.requirements.length}`}
          </span>
        </div>
        <div className="step-buttons">
          <button
            className="text-button"
            onClick={() => moveStep(requirementStep < 0 ? 0 : Math.max(0, requirementStep - 1))}
            disabled={requirementStep === 0}
          >
            <ChevronLeft size={16} />
            前へ
          </button>
          <button
            className="text-button"
            onClick={() =>
              moveStep(
                requirementStep < 0
                  ? 0
                  : Math.min(explanation.requirements.length - 1, requirementStep + 1),
              )
            }
            disabled={requirementStep === explanation.requirements.length - 1}
          >
            {requirementStep < 0 ? '順に確認' : '次の要件'}
            <ChevronRight size={16} />
          </button>
          <button
            className="icon-button"
            aria-label="全要件を表示して強調を解除"
            onClick={() => {
              moveStep(-1);
              setSelectedOption(null);
            }}
          >
            <RotateCcw size={15} />
          </button>
        </div>
      </div>
      <div className="mobile-tabs" role="tablist" aria-label="解説パネル">
        {[
          ['question', '問題と要件'],
          ['diagram', '構成図'],
          ['choices', '選択肢の評価'],
        ].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="analysis-grid">
        <section
          className={`analysis-panel question-panel ${tab === 'question' ? 'mobile-active' : ''}`}
        >
          <div className="panel-heading">
            <BookOpen size={17} />
            <h3>問題と要件</h3>
            <span className="panel-number">01</span>
          </div>
          <div className="panel-body">
            <p className="panel-instruction">マーカー部分を選ぶと、図と評価が連動します。</p>
            <RequirementText
              text={question.text}
              requirements={explanation.requirements}
              selected={requirements}
              onSelect={selectRequirements}
            />
            <div className="requirement-list">
              {explanation.requirements.map((r, i) => (
                <button
                  key={r.id}
                  aria-pressed={requirements.includes(r.id)}
                  className={`requirement-card ${requirements.includes(r.id) ? 'selected' : ''} ${!revealIds.includes(r.id) ? 'not-revealed' : ''}`}
                  onClick={() => selectRequirements(requirements.includes(r.id) ? [] : [r.id])}
                >
                  <span className="requirement-index">{String(i + 1).padStart(2, '0')}</span>
                  <span>
                    <span className={`kind kind-${r.kind}`}>
                      {r.kind === 'hard'
                        ? '必須要件'
                        : r.kind === 'preference'
                          ? '比較条件'
                          : '背景情報'}
                    </span>
                    <strong>{r.label}</strong>
                    <span className="requirement-explanation">{r.explanation}</span>
                  </span>
                </button>
              ))}
            </div>
            {!!question.options.length && (
              <div className="original-options">
                <h4>選択肢の原文</h4>
                {question.options.map((option) => (
                  <button
                    className={selectedOption === option.id ? 'selected' : ''}
                    key={option.id}
                    onClick={() => selectOption(option.id)}
                  >
                    <span className="option-letter">{option.label}</span>
                    <span>{option.text}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
        <section
          className={`analysis-panel diagram-panel ${tab === 'diagram' ? 'mobile-active' : ''}`}
        >
          <div className="panel-heading">
            <GitBranch size={17} />
            <h3>アーキテクチャ</h3>
            <span className="panel-number">02</span>
          </div>
          <div className="graph-selector">
            <label htmlFor={`graph-${revision.id}`}>表示する構成</label>
            <select
              id={`graph-${revision.id}`}
              value={graph.id}
              onChange={(event) => {
                const next = explanation.architectures.find((g) => g.id === event.target.value)!;
                setGraphId(next.id);
                setSelectedOption(next.optionIds.length === 1 ? next.optionIds[0] : null);
              }}
            >
              <option value={explanation.recommendedArchitectureId}>
                推奨構成 ·{' '}
                {
                  explanation.architectures.find(
                    (g) => g.id === explanation.recommendedArchitectureId,
                  )?.title
                }
              </option>
              {explanation.architectures
                .filter((g) => g.id !== explanation.recommendedArchitectureId)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.optionIds
                      .map((id) => question.options.find((o) => o.id === id)?.label)
                      .join(' + ')}{' '}
                    · {g.title}
                  </option>
                ))}
            </select>
            <p>{graph.description}</p>
          </div>
          <ArchitectureDiagram
            graph={graph}
            requirementIds={requirements}
            highlightedNodeIds={highlightedNodeIds}
            highlightedEdgeIds={highlightedEdgeIds}
            onRequirements={selectRequirements}
            iconBase={iconBase}
            iconMap={iconMap}
          />
          <div className="diagram-legend">
            <span>
              <i className="legend-line" />
              データ
            </span>
            <span>
              <i className="legend-line dashed" />
              制御・メタデータ
            </span>
            <span>
              <i className="legend-dot" />
              選択中の要件に関連
            </span>
          </div>
        </section>
        <section
          className={`analysis-panel choices-panel ${tab === 'choices' ? 'mobile-active' : ''}`}
        >
          <div className="panel-heading">
            <ListFilter size={17} />
            <h3>選択肢の評価</h3>
            <span className="panel-number">03</span>
          </div>
          <div className="panel-body">
            <p className="panel-instruction">評価を選ぶと、根拠となる原文へ逆引きできます。</p>
            {question.selectionMode === 'multiple' && (
              <div className="multi-answer">
                <GitBranch size={16} />
                <div>
                  <strong>組み合わせとして評価：{answerLabels || '検討中'}</strong>
                  <p>
                    複数のサービスで役割を分担する場合もあります。単体の不足だけで除外せず、上の解答理由と構成全体を確認してください。
                  </p>
                </div>
              </div>
            )}
            {!explanation.evaluations.length && (
              <div className="empty-evaluations">
                <CircleHelp size={26} />
                <p>選択肢のない質問です。問題の要件と推奨構成を確認してください。</p>
              </div>
            )}
            <div className="evaluations">
              {explanation.evaluations.map((evaluation) => {
                const option = question.options.find((o) => o.id === evaluation.optionId)!;
                const checks = evaluation.checks.filter((c) => revealIds.includes(c.requirementId));
                const verdict =
                  requirementStep < 0
                    ? evaluation.overall
                    : progressiveVerdict(
                        checks.filter(
                          (check) =>
                            explanation.requirements.find(
                              (requirement) => requirement.id === check.requirementId,
                            )?.kind !== 'context',
                        ),
                      );
                return (
                  <article
                    key={evaluation.optionId}
                    className={`evaluation-card ${selectedOption === evaluation.optionId ? 'selected' : ''} ${verdict === 'violates' ? 'eliminated' : ''}`}
                  >
                    <button
                      className="evaluation-heading"
                      aria-pressed={selectedOption === evaluation.optionId}
                      onClick={() => selectOption(evaluation.optionId)}
                    >
                      <span className="option-letter">{option.label}</span>
                      <span className="evaluation-summary">{evaluation.summary}</span>
                      <VerdictBadge verdict={verdict} />
                    </button>
                    <div className="evaluation-checks">
                      {checks.map((check) => {
                        const requirement = explanation.requirements.find(
                          (r) => r.id === check.requirementId,
                        )!;
                        return (
                          <button
                            key={check.requirementId}
                            className={`check-row ${requirements.includes(check.requirementId) ? 'selected' : ''}`}
                            onClick={() => {
                              setSelectedOption(evaluation.optionId);
                              if (evaluation.architectureId) setGraphId(evaluation.architectureId);
                              selectRequirements([check.requirementId]);
                            }}
                          >
                            <span className="check-top">
                              <strong>{requirement.label}</strong>
                              <VerdictBadge verdict={check.verdict} />
                            </span>
                            <span>{check.reason}</span>
                            <span className="check-sources">
                              {requirement.kind === 'context'
                                ? '問題文の背景条件'
                                : check.sourceIds.length
                                  ? check.sourceIds
                                      .map((id) => {
                                        const source = explanation.sources.find((s) => s.id === id);
                                        return source
                                          ? `[${explanation.sources.indexOf(source) + 1}] ${source.status === 'verified' ? '公式本文と照合済み' : '要確認'}`
                                          : '';
                                      })
                                      .join(' · ')
                                  : '出典未確認'}
                            </span>
                          </button>
                        );
                      })}
                      {!checks.length && (
                        <p className="muted small">この要件に対する評価はまだありません。</p>
                      )}
                    </div>
                    {evaluation.conditionsToBeCorrect && (
                      <details className="alternative-condition">
                        <summary>この選択肢が正解になる条件</summary>
                        <p>{evaluation.conditionsToBeCorrect}</p>
                      </details>
                    )}
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      </div>
      <div className="learning-grid">
        <section className="learning-card">
          <div className="section-label">
            <Zap size={17} />
            <h3>正解を決める要点</h3>
          </div>
          <ol className="learning-points">
            {explanation.learningPoints.map((point, i) => (
              <li key={i}>
                <span>{String(i + 1).padStart(2, '0')}</span>
                <p>{point}</p>
              </li>
            ))}
          </ol>
          {!!explanation.assumptions.length && (
            <details>
              <summary>判断の前提条件</summary>
              <ul>
                {explanation.assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </details>
          )}
          {!!explanation.caveats.length && (
            <div className="caveats">
              {explanation.caveats.map((c, i) => (
                <p key={i}>
                  <Info size={15} />
                  {c}
                </p>
              ))}
            </div>
          )}
        </section>
        <section className="learning-card">
          <div className="section-label">
            <BookOpen size={17} />
            <h3>用語を押さえる</h3>
          </div>
          <dl className="glossary">
            {explanation.glossary.map((item) => (
              <div key={item.term}>
                <dt>{item.term}</dt>
                <dd>{item.description}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
      <section className="sources-section">
        <div className="section-label">
          <ShieldCheck size={18} />
          <h3>AWS公式資料</h3>
          <span className="muted small">
            引用本文の照合結果です。解答の正しさを保証するものではありません。
          </span>
        </div>
        <div className="sources-list">
          {explanation.sources.map((source, i) => (
            <article key={source.id} id={`source-${source.id}`} className="source-card">
              <span className="source-number">{String(i + 1).padStart(2, '0')}</span>
              <div>
                <a href={officialSourceUrl(source.url)} target="_blank" rel="noreferrer">
                  {source.title}
                  <ExternalLink size={13} />
                </a>
                <blockquote>{source.excerpt}</blockquote>
                <p className="source-verification">
                  <span className={source.status === 'verified' ? 'verified' : 'unverified'}>
                    {source.status === 'verified' ? '公式本文と照合済み' : '要確認'}
                  </span>
                  {source.checkedAt && (
                    <time dateTime={source.checkedAt}>
                      確認日 {new Date(source.checkedAt).toLocaleDateString('ja-JP')}
                    </time>
                  )}
                </p>
                {source.verificationNote && (
                  <p className="muted small">{source.verificationNote}</p>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
