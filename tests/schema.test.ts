import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import {
  ExplanationInputSchema,
  QuestionDraftSchema,
  applyEvidenceStatus,
  quoteSpan,
  validateReferences,
  validateQuestion,
  type Explanation,
  type QuestionDraft,
} from '../shared/schema';

function fixture(): { question: QuestionDraft; explanation: Explanation } {
  return {
    question: {
      title: '選択の根拠',
      text: 'データを再処理できること。運用負荷を抑える。',
      options: [
        { id: 'A', label: 'A', text: '保持する' },
        { id: 'B', label: 'B', text: '捨てる' },
      ],
      selectionMode: 'single',
      selectionCount: 1,
      knownAnswerIds: [],
      originalExplanation: '',
      uncertainties: [],
      imageIds: [],
    },
    explanation: {
      title: '再処理と保持',
      shortAnswer: 'A',
      answerOptionIds: ['A'],
      answerRationale: '保持が必要',
      assumptions: [],
      requirements: [
        {
          id: 'r1',
          label: '再処理',
          quote: '再処理できる',
          quoteOccurrence: 0,
          kind: 'hard',
          explanation: '読み直せる必要があります',
        },
      ],
      evaluations: ['A', 'B'].map((id) => ({
        optionId: id,
        overall: id === 'A' ? 'meets' : 'violates',
        summary: '判断',
        conditionsToBeCorrect: '再処理の要件がない場合',
        architectureId: 'g1',
        checks: [
          {
            requirementId: 'r1',
            verdict: id === 'A' ? 'meets' : 'violates',
            reason: '保持の有無',
            sourceIds: ['s1'],
            nodeIds: ['n1'],
            edgeIds: [],
          },
        ],
      })),
      architectures: [
        {
          id: 'g1',
          title: '構成',
          optionIds: ['A', 'B'],
          description: '保持設定の違い',
          nodes: [
            { id: 'n1', service: 's3', label: 'S3', description: '保存', requirementIds: ['r1'] },
          ],
          edges: [],
          steps: [{ title: '保存', description: '保存する', nodeIds: ['n1'], edgeIds: [] }],
        },
      ],
      recommendedArchitectureId: 'g1',
      learningPoints: ['保持と配信を分ける'],
      glossary: [],
      sources: [
        {
          id: 's1',
          title: '仕様',
          url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html',
          excerpt: 'Amazon S3',
          status: 'verified',
          checkedAt: '2026-09-23T00:00:00.000Z',
          verificationNote: '引用本文を照合',
        },
      ],
      caveats: [],
    },
  };
}

test('schema accepts a complete explanation with semantic links', () => {
  const { question, explanation } = fixture();
  QuestionDraftSchema.parse(question);
  ExplanationInputSchema.parse(explanation);
  assert.doesNotThrow(() => validateReferences(question, explanation));
});
test('question selection mode and count are rejected before generation', () => {
  const { question } = fixture();
  assert.throws(() => validateQuestion({ ...question, selectionCount: 3 }), /選択数/);
  assert.throws(() => validateQuestion({ ...question, selectionCount: 2 }), /単一選択/);
  assert.throws(() => validateQuestion({ ...question, selectionMode: 'none' }), /自由記述/);
  assert.doesNotThrow(() =>
    validateQuestion({ ...question, selectionMode: 'multiple', selectionCount: 2 }),
  );
});
test('quote spans retain UTF-16 offsets and distinguish repeated phrases', () => {
  const requirement = fixture().explanation.requirements[0];
  const text = '😀再処理できる。もう一度再処理できる';
  const span = quoteSpan(text, { ...requirement, quoteOccurrence: 1 })!;
  assert.equal(text.slice(span.start, span.end), requirement.quote);
  assert.equal(span.start, text.lastIndexOf(requirement.quote));
  assert.equal(quoteSpan(text, { ...requirement, quoteOccurrence: 2 }), null);
});
test('hallucinated original quotation is rejected', () => {
  const { question, explanation } = fixture();
  explanation.requirements[0].quote = '書かれていない要件';
  assert.throws(() => validateReferences(question, explanation), /引用/);
});
test('broken edge endpoints and step links are rejected', () => {
  const { question, explanation } = fixture();
  explanation.architectures[0].edges.push({
    id: 'e1',
    from: 'n1',
    to: 'missing',
    label: '転送',
    kind: 'data',
    requirementIds: [],
  });
  assert.throws(() => validateReferences(question, explanation), /端点/);
  explanation.architectures[0].edges = [];
  explanation.architectures[0].steps[0].edgeIds = ['missing'];
  assert.throws(() => validateReferences(question, explanation), /接続線/);
});
test('an evaluation cannot display a graph for another option even without node references', () => {
  const { question, explanation } = fixture();
  explanation.architectures[0].optionIds = ['A'];
  explanation.evaluations[1].checks[0].nodeIds = [];
  assert.throws(() => validateReferences(question, explanation), /対応する選択肢/);
});
test('a preference cannot eliminate an option as a hard failure', () => {
  const { question, explanation } = fixture();
  explanation.requirements[0].kind = 'preference';
  assert.throws(() => validateReferences(question, explanation), /必須要件違反/);
  explanation.evaluations[1].checks[0].verdict = 'inferior';
  assert.doesNotThrow(() => validateReferences(question, explanation));
});
test('unverified sources downgrade definitive judgements without mutating original', () => {
  const { explanation } = fixture();
  explanation.sources[0].status = 'unverified';
  const result = applyEvidenceStatus(explanation);
  assert.equal(result.evaluations[1].overall, 'unknown');
  assert.equal(result.evaluations[1].checks[0].verdict, 'unknown');
  assert.match(result.evaluations[1].checks[0].reason, /^要確認/);
  assert.equal(explanation.evaluations[1].checks[0].verdict, 'violates');
});
test('uncited judgements stay unknown even when unrelated sources are verified', () => {
  const { explanation } = fixture();
  explanation.evaluations[1].checks[0].sourceIds = [];
  assert.equal(applyEvidenceStatus(explanation).evaluations[1].overall, 'unknown');
});
test('a comparison needing two sources is unknown if either source is unverified', () => {
  const { explanation } = fixture();
  explanation.sources.push({ ...explanation.sources[0], id: 's2', status: 'unverified' });
  explanation.evaluations[1].checks[0].sourceIds = ['s1', 's2'];
  assert.equal(applyEvidenceStatus(explanation).evaluations[1].overall, 'unknown');
});
test('a verified hard violation remains a violation even with other unknown checks', () => {
  const { explanation } = fixture();
  explanation.evaluations[1].checks.push({
    ...explanation.evaluations[1].checks[0],
    requirementId: 'other',
    sourceIds: [],
    verdict: 'unknown',
  });
  assert.equal(applyEvidenceStatus(explanation).evaluations[1].overall, 'violates');
});
test('context and answer instructions do not change a supported option verdict', () => {
  const { explanation } = fixture();
  explanation.requirements.push({
    id: 'context',
    label: '選択数',
    kind: 'context',
    quote: '1つ',
    quoteOccurrence: 0,
    explanation: '問題の背景',
  });
  explanation.evaluations[0].checks.push({
    requirementId: 'context',
    verdict: 'unknown',
    reason: '選択数の指示',
    sourceIds: [],
    nodeIds: [],
    edgeIds: [],
  });
  assert.equal(applyEvidenceStatus(explanation).evaluations[0].overall, 'meets');
});
test('all options and decision requirements must be evaluated', () => {
  const { question, explanation } = fixture();
  explanation.evaluations.pop();
  assert.throws(() => validateReferences(question, explanation), /全選択肢/);
  const next = fixture();
  next.explanation.evaluations[0].checks = [];
  assert.throws(() => validateReferences(next.question, next.explanation), /必須・比較要件/);
});
test('duplicate and nonexistent cross-document ids are rejected', () => {
  const { question, explanation } = fixture();
  explanation.evaluations[0].checks[0].sourceIds = ['missing'];
  assert.throws(() => validateReferences(question, explanation), /出典/);
  explanation.evaluations[0].checks[0].sourceIds = ['s1'];
  explanation.architectures.push({ ...explanation.architectures[0], id: 'g2' });
  assert.throws(() => validateReferences(question, explanation), /ノードのIDが重複/);
});
test('multiple selection count and known-answer references are checked', () => {
  const { question, explanation } = fixture();
  question.selectionMode = 'multiple';
  question.selectionCount = 2;
  assert.throws(() => validateReferences(question, explanation), /選択数/);
  explanation.answerOptionIds = ['A', 'B'];
  assert.doesNotThrow(() => validateReferences(question, explanation));
  question.knownAnswerIds = ['Z'];
  assert.throws(() => validateReferences(question, explanation), /入力された正解/);
});
test('open-ended questions have no fabricated options or answers', () => {
  const { question, explanation } = fixture();
  question.options = [];
  question.selectionMode = 'none';
  question.selectionCount = null;
  explanation.answerOptionIds = [];
  explanation.evaluations = [];
  explanation.architectures[0].optionIds = [];
  assert.doesNotThrow(() => validateReferences(question, explanation));
});
test('model JSON schema is closed and has required top-level fields', () => {
  const schema = z.toJSONSchema(ExplanationInputSchema);
  assert.equal(schema.additionalProperties, false);
  assert.ok(schema.required?.includes('requirements'));
  assert.ok(schema.required?.includes('sources'));
});
