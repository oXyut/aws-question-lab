import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  Lightbulb,
  FlaskConical,
  ArrowRight,
  Link2,
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
  const textContainer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = textContainer.current;
    if (!element) return;
    const revealQuote = () => {
      const active = element.querySelector<HTMLElement>('.quote-highlight.selected');
      if (!active || element.scrollHeight <= element.clientHeight) return;
      const quote = active.getBoundingClientRect();
      const viewport = element.getBoundingClientRect();
      if (quote.top < viewport.top || quote.bottom > viewport.bottom)
        element.scrollTop += quote.top - viewport.top - 8;
    };
    revealQuote();
    const observer = new ResizeObserver(revealQuote);
    observer.observe(element);
    return () => observer.disconnect();
  }, [selected]);
  const spans = requirements
    .map((r) => ({ requirement: r, span: quoteSpan(text, r) }))
    .filter((item) => item.span !== null);
  const points = [
    ...new Set([0, text.length, ...spans.flatMap((item) => [item.span!.start, item.span!.end])]),
  ].sort((a, b) => a - b);
  return (
    <div
      ref={textContainer}
      className="question-text"
      tabIndex={0}
      aria-label="問題文（長い場合はスクロールで全文を表示）"
    >
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
  followup,
  sample = false,
}: {
  revision: ExplanationRevision;
  iconBase?: string;
  iconMap?: Record<string, string>;
  followup?: ReactNode;
  sample?: boolean;
}) {
  const explanation = useMemo(
    () => applyEvidenceStatus(revision.explanation),
    [revision.explanation],
  );
  const question = revision.question;
  const [requirements, setRequirements] = useState<string[]>(() => {
    const focus =
      explanation.requirements.find((r) => r.kind === 'preference') ?? explanation.requirements[0];
    return focus ? [focus.id] : [];
  });
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
    setRequirementStep(-1);
  };
  const selectOption = (id: string) => {
    const evaluation = explanation.evaluations.find((e) => e.optionId === id);
    setSelectedOption(id);
    setRequirementStep(-1);
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
  const focused = explanation.requirements.filter((r) => requirements.includes(r.id));
  const focusReason = explanation.evaluations
    .filter((e) => explanation.answerOptionIds.includes(e.optionId))
    .flatMap((e) => e.checks)
    .filter((c) => requirements.includes(c.requirementId))
    .map((c) => c.reason)
    .join(' ');
  const currentIndex =
    requirementStep >= 0
      ? requirementStep
      : explanation.requirements.findIndex((r) => requirements.includes(r.id));
  const nextStep = currentIndex >= explanation.requirements.length - 1 ? 0 : currentIndex + 1;
  const hasUnverified =
    !explanation.sources.length || explanation.sources.some((s) => s.status !== 'verified');
  return (
    <div className="explanation-viewer studio-viewer">
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
      <div className="studio-workspace">
        <div className="studio-main">
          <section
            className={`studio-question ${tab === 'question' ? 'mobile-active' : ''}`}
            aria-label="問題と要件"
          >
            <div className="studio-question-label">
              {sample ? <FlaskConical size={19} /> : <BookOpen size={19} />}
              <strong>{sample ? 'サンプル問題' : '問題と要件'}</strong>
              <span>
                {sample
                  ? '操作体験用の固定教材です。出典の確認結果もデモ表示です。'
                  : 'マーカーを選ぶと、図と判断が連動します。'}
              </span>
            </div>
            <RequirementText
              text={question.text}
              requirements={explanation.requirements}
              selected={requirements}
              onSelect={selectRequirements}
            />
            <div className="studio-requirements" aria-label="注目する要件">
              {explanation.requirements.map((r, i) => (
                <button
                  key={r.id}
                  aria-pressed={requirements.includes(r.id)}
                  className={`studio-requirement ${requirements.includes(r.id) ? 'selected' : ''} ${!revealIds.includes(r.id) ? 'not-revealed' : ''}`}
                  onClick={() => selectRequirements(requirements.includes(r.id) ? [] : [r.id])}
                >
                  <span className="requirement-index">{i + 1}</span>
                  <span>{r.label}</span>
                </button>
              ))}
            </div>
            {!!question.options.length && (
              <details className="studio-original-options">
                <summary>選択肢の原文を確認</summary>
                <div className="original-options">
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
              </details>
            )}
          </section>
          <section
            className={`studio-diagram ${tab === 'diagram' ? 'mobile-active' : ''}`}
            aria-label="構成図"
          >
            <div className="studio-diagram-heading">
              <h3>
                <GitBranch size={19} />
                構成図
              </h3>
              <select
                aria-label="表示する構成"
                id={`graph-${revision.id}`}
                value={graph.id}
                onChange={(event) => {
                  const next = explanation.architectures.find((g) => g.id === event.target.value)!;
                  setGraphId(next.id);
                  setSelectedOption(next.optionIds.length === 1 ? next.optionIds[0] : null);
                }}
              >
                {explanation.architectures.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.id === explanation.recommendedArchitectureId ? '推奨構成 · ' : ''}
                    {g.title}
                  </option>
                ))}
              </select>
            </div>
            <p className="studio-diagram-description">{graph.description}</p>
            <ArchitectureDiagram
              graph={graph}
              requirementIds={requirements}
              highlightedNodeIds={highlightedNodeIds}
              highlightedEdgeIds={highlightedEdgeIds}
              onRequirements={selectRequirements}
              iconBase={iconBase}
              iconMap={iconMap}
            />
          </section>
        </div>
        <aside
          className={`studio-inspector ${tab === 'choices' ? 'mobile-active' : ''}`}
          aria-label="要件の判断と選択肢"
        >
          <h2 className="inspector-heading">
            <Lightbulb size={24} />
            {focused.length ? 'この要件の判断' : '解答のポイント'}
          </h2>
          <div className="studio-insight">
            <strong>
              {focused.length
                ? `着目する要件：「${focused.map((r) => r.label).join('・')}」`
                : explanation.shortAnswer}
            </strong>
            <p>
              {focused.length
                ? focusReason || focused.map((r) => r.explanation).join(' ')
                : explanation.answerRationale}
            </p>
            <details className="answer-details">
              <summary>
                {question.knownAnswerIds.length ? '解答の検討' : '推定解答'}
                {answerLabels ? ` · ${answerLabels}` : ''}
              </summary>
              <h3>{explanation.shortAnswer}</h3>
              <p>{explanation.answerRationale}</p>
              {focused.map((r) => (
                <p key={r.id}>{r.explanation}</p>
              ))}
            </details>
          </div>
          {hasUnverified && (
            <div className="notice warning studio-warning">
              <Info size={16} />
              <p>
                <strong>根拠に要確認の項目があります</strong>
                公式本文と未照合の判断は「情報不足」として扱い、その判断だけでは除外しません。
              </p>
            </div>
          )}
          {disagrees && (
            <div className="notice warning studio-warning">
              <Info size={16} />
              <p>
                <strong>入力された正解と推定解答が異なります</strong>入力：
                {knownLabels} ／ 推定：{answerLabels || '未確定'}
              </p>
            </div>
          )}
          {!disagrees && knownLabels && (
            <p className="studio-answer-match">
              <CheckCircle2 size={14} />
              入力された正解（{knownLabels}）と一致
            </p>
          )}
          <div className="inspector-section-heading">
            <ListFilter size={19} />
            <h3>選択肢の評価</h3>
          </div>
          {question.selectionMode === 'multiple' && (
            <div className="multi-answer">
              <GitBranch size={16} />
              <div>
                <strong>組み合わせとして評価：{answerLabels || '検討中'}</strong>
                <p>単体の不足だけで除外せず、構成全体の役割分担を確認してください。</p>
              </div>
            </div>
          )}
          {!explanation.evaluations.length && (
            <div className="empty-evaluations">
              <CircleHelp size={24} />
              <p>選択肢のない質問です。問題の要件と推奨構成を確認してください。</p>
            </div>
          )}
          <div className="studio-evaluations">
            {explanation.evaluations.map((evaluation) => {
              const option = question.options.find((o) => o.id === evaluation.optionId)!;
              const checks = evaluation.checks.filter((c) => revealIds.includes(c.requirementId));
              const focusChecks = checks.filter((c) => requirements.includes(c.requirementId));
              const verdict =
                requirementStep >= 0
                  ? progressiveVerdict(
                      checks.filter(
                        (c) =>
                          explanation.requirements.find((r) => r.id === c.requirementId)?.kind !==
                          'context',
                      ),
                    )
                  : focusChecks.length
                    ? progressiveVerdict(focusChecks)
                    : evaluation.overall;
              const architecture = explanation.architectures.find(
                (a) => a.id === evaluation.architectureId,
              );
              const title =
                architecture?.title.replace(/^[A-ZＡ-Ｚa-z0-9]+\s*[·.：:、-]\s*/, '') ??
                option.text;
              const isSelected =
                selectedOption === option.id ||
                (!selectedOption && explanation.answerOptionIds.includes(option.id));
              return (
                <article
                  key={option.id}
                  className={`evaluation-card studio-evaluation ${isSelected ? 'selected' : ''} ${verdict === 'violates' ? 'eliminated' : ''}`}
                >
                  <button
                    className="evaluation-heading"
                    aria-pressed={isSelected}
                    onClick={() => selectOption(option.id)}
                  >
                    <span className="option-letter">{option.label}</span>
                    <strong className="evaluation-title">{title}</strong>
                    <VerdictBadge verdict={verdict} />
                  </button>
                  <p className="studio-evaluation-reason">
                    {focusChecks.length
                      ? focusChecks.map((c) => c.reason).join(' ')
                      : evaluation.summary}
                  </p>
                  <details className="evaluation-details">
                    <summary>要件ごとの根拠</summary>
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
                              setSelectedOption(option.id);
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
                    </div>
                    {evaluation.conditionsToBeCorrect && (
                      <div className="alternative-condition">
                        <strong>この選択肢が正解になる条件</strong>
                        <p>{evaluation.conditionsToBeCorrect}</p>
                      </div>
                    )}
                  </details>
                </article>
              );
            })}
          </div>
          <div className="studio-source-links">
            <div className="inspector-section-heading">
              <Link2 size={19} />
              <h3>関連資料（AWS公式）</h3>
            </div>
            {explanation.sources.map((source, i) => (
              <a
                key={source.id}
                href={officialSourceUrl(source.url)}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={14} />
                <span>{source.title}</span>
                <span className="sr-only">出典 {i + 1}</span>
              </a>
            ))}
            <a className="source-details-link" href="#evidence-details">
              引用箇所・確認日を見る
              <ChevronRight size={13} />
            </a>
          </div>
          {followup}
        </aside>
      </div>
      <nav className="studio-stepbar" aria-label="要件を順に確認">
        <span className="stepbar-title">
          <ListFilter size={18} />
          要件を順に見る
        </span>
        <div className="stepbar-requirements">
          {explanation.requirements.map((r, i) => (
            <button
              key={r.id}
              className={requirements.includes(r.id) ? 'selected' : ''}
              aria-label={`要件 ${i + 1}: ${r.label}`}
              aria-pressed={requirements.includes(r.id)}
              onClick={() => moveStep(i)}
            >
              <span>{i + 1}</span>
              {r.label}
            </button>
          ))}
        </div>
        <button
          className="icon-button"
          aria-label="全要件を表示して強調を解除"
          onClick={() => {
            moveStep(-1);
            setSelectedOption(null);
          }}
        >
          <RotateCcw size={16} />
        </button>
        <button
          className="icon-button stepbar-previous"
          aria-label="前の要件"
          disabled={requirementStep <= 0}
          onClick={() => moveStep(Math.max(0, requirementStep - 1))}
        >
          <ChevronLeft size={18} />
        </button>
        <button
          className="primary-button stepbar-next"
          disabled={!explanation.requirements.length}
          onClick={() => moveStep(nextStep)}
        >
          {currentIndex === explanation.requirements.length - 1 ? '最初の要件へ' : '次の要件へ'}
          <ArrowRight size={18} />
        </button>
      </nav>
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
      <section className="sources-section" id="evidence-details">
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
