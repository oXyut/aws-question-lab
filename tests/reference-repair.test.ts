import test from 'node:test';
import assert from 'node:assert/strict';
import { demoDocument } from '../shared/demo.ts';
import { validateReferences } from '../shared/schema.ts';
import { repairDisplayReferences } from '../server/reference-repair.ts';

const fixture = () => structuredClone(demoDocument.revisions[0].explanation);

test('missing display links fall back only to explicit requirement links in the same graph', () => {
  const input = fixture();
  const check = input.evaluations[0].checks[0];
  check.nodeIds = ['typo-a-athena'];
  check.edgeIds = ['missing-query-edge'];
  const before = structuredClone(input);
  const { explanation, repairs } = repairDisplayReferences(input);
  const fixed = explanation.evaluations[0].checks[0];
  assert.deepEqual(input, before, 'raw output must remain unchanged');
  assert.deepEqual(fixed.nodeIds, ['a-analyst', 'a-athena']);
  assert.deepEqual(fixed.edgeIds, ['a-query']);
  assert.equal(repairs.length, 2);
  assert.deepEqual(repairs[1].removedIds, ['missing-query-edge']);
  assert.deepEqual(repairs[1].fallbackIds, ['a-query']);
  assert.equal(explanation.caveats.length, input.caveats.length + 1);
  validateReferences(demoDocument.question, explanation);
});

test('valid links survive while cross-graph links and duplicate IDs are removed', () => {
  const input = fixture();
  input.evaluations[0].checks[0].nodeIds = ['a-athena', 'b-engine', 'a-athena'];
  input.evaluations[0].checks[0].edgeIds = ['a-query', 'b-query', 'missing'];
  const { explanation, repairs } = repairDisplayReferences(input);
  assert.deepEqual(explanation.evaluations[0].checks[0].nodeIds, ['a-athena']);
  assert.deepEqual(explanation.evaluations[0].checks[0].edgeIds, ['a-query']);
  assert.deepEqual(repairs[0].removedIds, ['b-engine']);
  assert.deepEqual(repairs[0].duplicateIds, ['a-athena']);
  assert.deepEqual(repairs[0].fallbackIds, []);
  validateReferences(demoDocument.question, explanation);
});

test('repair does not guess a similarly named element or invent an association', () => {
  const input = fixture();
  const graph = input.architectures[0];
  graph.edges.forEach((edge) => {
    edge.requirementIds = [];
  });
  input.evaluations[0].checks[0].edgeIds = ['a-qurey'];
  input.evaluations[0].checks[0].nodeIds = [];
  const { explanation, repairs } = repairDisplayReferences(input);
  assert.deepEqual(explanation.evaluations[0].checks[0].edgeIds, []);
  assert.deepEqual(explanation.evaluations[0].checks[0].nodeIds, []);
  assert.deepEqual(repairs[0].fallbackIds, []);
  validateReferences(demoDocument.question, explanation);
});

test('without an architecture scope, invalid references are removed without selecting a graph', () => {
  const input = fixture();
  input.evaluations[0].architectureId = null;
  input.evaluations[0].checks[0].edgeIds = ['unknown'];
  const { explanation, repairs } = repairDisplayReferences(input);
  assert.equal(explanation.evaluations[0].architectureId, null);
  assert.deepEqual(explanation.evaluations[0].checks[0].edgeIds, []);
  assert.deepEqual(repairs[0].fallbackIds, []);
  validateReferences(demoDocument.question, explanation);
});

test('sound output is preserved exactly and no missing associations are filled proactively', () => {
  const input = fixture();
  input.evaluations[0].checks[0].nodeIds = [];
  const { explanation, repairs } = repairDisplayReferences(input);
  assert.deepEqual(explanation, input);
  assert.deepEqual(repairs, []);
});

test('semantic inconsistencies still fail validation after display-link repair', () => {
  const cases = [
    (input: ReturnType<typeof fixture>) => {
      input.requirements[0].quote = 'A fabricated quote outside the question';
    },
    (input: ReturnType<typeof fixture>) => {
      input.architectures[0].edges[0].to = 'nonexistent-node';
    },
    (input: ReturnType<typeof fixture>) => {
      input.evaluations[0].checks[0].sourceIds = ['missing-source'];
    },
    (input: ReturnType<typeof fixture>) => {
      input.evaluations[0].checks[0].requirementId = 'missing-requirement';
    },
    (input: ReturnType<typeof fixture>) => {
      input.answerOptionIds = ['missing-answer'];
    },
    (input: ReturnType<typeof fixture>) => {
      input.evaluations[0].architectureId = 'graph-b';
    },
    (input: ReturnType<typeof fixture>) => {
      input.evaluations[0].architectureId = 'unknown-graph';
    },
  ];
  for (const mutate of cases) {
    const input = fixture();
    input.evaluations[0].checks[0].edgeIds.push('repairable-missing-edge');
    mutate(input);
    const { explanation } = repairDisplayReferences(input);
    assert.throws(() => validateReferences(demoDocument.question, explanation));
  }
});

test('repair leaves the meaning, graph topology, evidence, and answer unchanged', () => {
  const input = fixture();
  input.evaluations[1].checks[0].nodeIds.push('bad-node');
  const { explanation } = repairDisplayReferences(input);
  const withoutPresentation = (value: typeof input) => ({
    ...value,
    caveats: [],
    evaluations: value.evaluations.map((evaluation) => ({
      ...evaluation,
      checks: evaluation.checks.map((check) => ({ ...check, nodeIds: [], edgeIds: [] })),
    })),
  });
  assert.deepEqual(withoutPresentation(explanation), withoutPresentation(input));
});
