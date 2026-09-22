import { z } from 'zod';

export const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const VerdictSchema = z.enum(['meets', 'violates', 'inferior', 'unknown']);
export type Verdict = z.infer<typeof VerdictSchema>;
export const verdictLabels: Record<Verdict, string> = {
  meets: '満たす', violates: '要件違反', inferior: '比較上不利', unknown: '情報不足',
};

export const QuestionDraftSchema = z.object({
  title: z.string().max(200),
  text: z.string().min(1).max(30000),
  options: z.array(z.object({ id: Id, label: z.string().max(20), text: z.string().min(1).max(5000) })).max(12),
  selectionMode: z.enum(['single', 'multiple', 'none']),
  selectionCount: z.number().int().min(1).max(12).nullable(),
  knownAnswerIds: z.array(Id),
  originalExplanation: z.string().max(20000),
  uncertainties: z.array(z.string()),
  imageIds: z.array(Id).max(5),
});
export const ExtractedQuestionSchema = QuestionDraftSchema.omit({ imageIds: true });
export type QuestionDraft = z.infer<typeof QuestionDraftSchema>;

export const SourceInputSchema = z.object({
  id: Id,
  title: z.string().min(1),
  url: z.string().min(1),
  excerpt: z.string().min(1).max(2000),
});
export const SourceSchema = SourceInputSchema.extend({
  status: z.enum(['verified', 'unverified']),
  checkedAt: z.string().nullable(),
  verificationNote: z.string(),
});
export type Source = z.infer<typeof SourceSchema>;

export const RequirementSchema = z.object({
  id: Id,
  label: z.string().min(1),
  quote: z.string().min(1),
  quoteOccurrence: z.number().int().min(0),
  kind: z.enum(['hard', 'preference', 'context']),
  explanation: z.string(),
});
export type Requirement = z.infer<typeof RequirementSchema>;

export const ArchitectureSchema = z.object({
  id: Id,
  title: z.string(),
  optionIds: z.array(Id),
  description: z.string(),
  nodes: z.array(z.object({
    id: Id, service: z.string().nullable(), label: z.string(), description: z.string(),
    requirementIds: z.array(Id),
  })).min(1).max(30),
  edges: z.array(z.object({
    id: Id, from: Id, to: Id, label: z.string(), kind: z.enum(['data', 'metadata', 'control']),
    requirementIds: z.array(Id),
  })).max(60),
  steps: z.array(z.object({
    title: z.string(), description: z.string(), nodeIds: z.array(Id), edgeIds: z.array(Id),
  })).min(1).max(20),
});
export type Architecture = z.infer<typeof ArchitectureSchema>;

export const EvaluationSchema = z.object({
  optionId: Id,
  overall: VerdictSchema,
  summary: z.string(),
  conditionsToBeCorrect: z.string(),
  architectureId: Id.nullable(),
  checks: z.array(z.object({
    requirementId: Id,
    verdict: VerdictSchema,
    reason: z.string(),
    sourceIds: z.array(Id),
    nodeIds: z.array(Id),
    edgeIds: z.array(Id),
  })),
});
export type Evaluation = z.infer<typeof EvaluationSchema>;

export const ExplanationInputSchema = z.object({
  title: z.string().min(1),
  shortAnswer: z.string(),
  answerOptionIds: z.array(Id),
  answerRationale: z.string(),
  assumptions: z.array(z.string()),
  requirements: z.array(RequirementSchema).min(1).max(15),
  evaluations: z.array(EvaluationSchema),
  architectures: z.array(ArchitectureSchema).min(1).max(13),
  recommendedArchitectureId: Id,
  learningPoints: z.array(z.string()),
  glossary: z.array(z.object({ term: z.string(), description: z.string() })),
  sources: z.array(SourceInputSchema).max(20),
  caveats: z.array(z.string()),
});
export const ExplanationSchema = ExplanationInputSchema.extend({ sources: z.array(SourceSchema) });
export type ExplanationInput = z.infer<typeof ExplanationInputSchema>;
export type Explanation = z.infer<typeof ExplanationSchema>;
export const ExplanationRevisionSchema = z.object({
  id: Id,
  createdAt: z.string(),
  parentRevisionId: Id.nullable(),
  prompt: z.string(),
  question: QuestionDraftSchema,
  explanation: ExplanationSchema,
});
export type ExplanationRevision = z.infer<typeof ExplanationRevisionSchema>;
export const ExplanationDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  id: Id,
  createdAt: z.string(),
  updatedAt: z.string(),
  question: QuestionDraftSchema,
  revisions: z.array(ExplanationRevisionSchema).min(1),
});
export type ExplanationDocument = z.infer<typeof ExplanationDocumentSchema>;
export type DocumentSummary = { id: string; title: string; updatedAt: string; revisionCount: number };
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type GenerationJob = {
  id: string; kind: 'extract' | 'generate' | 'followup'; status: JobStatus;
  stage: string; message: string; createdAt: string; updatedAt: string;
  error?: { code: string; message: string };
  result?: { draft?: QuestionDraft; documentId?: string; revisionId?: string };
};
export type Health = { ok: boolean; codexAvailable: boolean; authenticated: boolean; model: string; activeJobId: string | null; message: string };

export function quoteSpan(text: string, requirement: Requirement): { start: number; end: number } | null {
  let start = -1;
  for (let n = 0; n <= requirement.quoteOccurrence; n++) {
    start = text.indexOf(requirement.quote, start + 1);
    if (start === -1) return null;
  }
  return { start, end: start + requirement.quote.length };
}

/** Semantic validation in addition to the model's JSON schema. Throws before data is published. */
export function validateReferences(question: QuestionDraft, explanation: ExplanationInput | Explanation): void {
  const unique = (values: string[], name: string) => {
    if (new Set(values).size !== values.length) throw new Error(`${name}のIDが重複しています`);
    return new Set(values);
  };
  const requireIds = (ids: string[], valid: Set<string>, name: string) => {
    if (ids.some(id => !valid.has(id))) throw new Error(`${name}に存在しない参照があります`);
    unique(ids, name);
  };
  const options = unique(question.options.map(o => o.id), '選択肢');
  requireIds(question.knownAnswerIds, options, '入力された正解');
  requireIds(explanation.answerOptionIds, options, '推定解答');
  if (question.selectionMode === 'single' && explanation.answerOptionIds.length > 1) throw new Error('単一選択の解答が複数あります');
  if (question.selectionCount && explanation.answerOptionIds.length && explanation.answerOptionIds.length !== question.selectionCount) throw new Error('指定された解答の選択数と一致しません');
  if (question.selectionMode === 'none' && question.options.length) throw new Error('自由記述の問題に選択肢があります');
  const reqs = unique(explanation.requirements.map(r => r.id), '要件');
  explanation.requirements.forEach(r => { if (!quoteSpan(question.text, r)) throw new Error(`要件「${r.label}」の引用が問題文にありません`); });
  const sources = unique(explanation.sources.map(s => s.id), '出典');
  const graphs = unique(explanation.architectures.map(g => g.id), '構成図');
  requireIds([explanation.recommendedArchitectureId], graphs, '推奨構成図');
  const nodeIds = unique(explanation.architectures.flatMap(g => g.nodes.map(n => n.id)), 'ノード');
  const edgeIds = unique(explanation.architectures.flatMap(g => g.edges.map(e => e.id)), '接続線');
  for (const graph of explanation.architectures) {
    requireIds(graph.optionIds, options, '構成図の選択肢');
    const graphNodes = new Set(graph.nodes.map(n => n.id));
    const graphEdges = new Set(graph.edges.map(e => e.id));
    graph.nodes.forEach(n => requireIds(n.requirementIds, reqs, 'ノードの要件'));
    graph.edges.forEach(e => {
      requireIds([e.from, e.to].filter((x,i,a) => a.indexOf(x) === i), graphNodes, '接続線の端点');
      requireIds(e.requirementIds, reqs, '接続線の要件');
    });
    graph.steps.forEach(s => { requireIds(s.nodeIds, graphNodes, 'ステップのノード'); requireIds(s.edgeIds, graphEdges, 'ステップの接続線'); });
  }
  const evaluated = unique(explanation.evaluations.map(e => e.optionId), '評価');
  if (evaluated.size !== options.size || [...evaluated].some(id => !options.has(id))) throw new Error('全選択肢の評価が必要です');
  for (const evaluation of explanation.evaluations) {
    if (evaluation.architectureId) requireIds([evaluation.architectureId], graphs, '評価の構成図');
    unique(evaluation.checks.map(c => c.requirementId), '要件の評価');
    const checkedRequirements = new Set(evaluation.checks.map(c => c.requirementId));
    if (explanation.requirements.some(r => r.kind !== 'context' && !checkedRequirements.has(r.id))) throw new Error('すべての必須・比較要件について選択肢を評価してください');
    for (const check of evaluation.checks) {
      requireIds([check.requirementId], reqs, '評価の要件');
      requireIds(check.sourceIds, sources, '評価の出典');
      requireIds(check.nodeIds, nodeIds, '評価のノード');
      requireIds(check.edgeIds, edgeIds, '評価の接続線');
      const requirement = explanation.requirements.find(r => r.id === check.requirementId)!;
      if (requirement.kind !== 'hard' && check.verdict === 'violates') throw new Error('比較条件・背景情報を必須要件違反にできません');
    }
  }
}

/** Unverified evidence must not appear as a definitive elimination. */
export function applyEvidenceStatus(explanation: Explanation): Explanation {
  const verified = new Set(explanation.sources.filter(s => s.status === 'verified').map(s => s.id));
  return {
    ...explanation,
    evaluations: explanation.evaluations.map(e => {
      const checks = e.checks.map(c => c.verdict !== 'unknown' && !c.sourceIds.some(id => verified.has(id))
        ? { ...c, verdict: 'unknown' as const, reason: `要確認：${c.reason}` } : c);
      const overall: Verdict = checks.some(c => c.verdict === 'violates') ? 'violates'
        : checks.some(c => c.verdict === 'unknown') || !checks.length ? 'unknown'
        : checks.some(c => c.verdict === 'inferior') ? 'inferior' : 'meets';
      return { ...e, checks, overall };
    }),
  };
}
