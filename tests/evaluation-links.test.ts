import test from 'node:test';
import assert from 'node:assert/strict';
import { demoDocument } from '../shared/demo.ts';
import {
  ExplanationInputSchema,
  validateReferences,
  type ExplanationInput,
} from '../shared/schema.ts';
import {
  linkEvaluationChecks,
  type ExplanationWithoutEvaluationLinks,
} from '../server/evaluation-links.ts';

function withoutLinks(explanation: ExplanationInput): ExplanationWithoutEvaluationLinks {
  return {
    ...structuredClone(explanation),
    evaluations: explanation.evaluations.map((evaluation) => ({
      ...structuredClone(evaluation),
      checks: evaluation.checks.map(({ nodeIds: _nodes, edgeIds: _edges, ...check }) =>
        structuredClone(check),
      ),
    })),
  };
}
const fixture = () => withoutLinks(demoDocument.revisions[0].explanation);

test('compact output expands to all explicitly associated elements in its own graph', () => {
  const input = fixture();
  const before = structuredClone(input);
  const output = linkEvaluationChecks(input);
  assert.deepEqual(input, before, 'input remains unchanged');
  assert.deepEqual(withoutLinks(output), before, 'only presentation links are added');
  ExplanationInputSchema.parse(output);
  validateReferences(demoDocument.question, output);

  const sqlCheck = output.evaluations[0].checks[0];
  assert.deepEqual(sqlCheck.nodeIds, ['a-analyst', 'a-athena']);
  assert.deepEqual(sqlCheck.edgeIds, ['a-query']);
  assert.notDeepEqual(
    sqlCheck.nodeIds,
    demoDocument.revisions[0].explanation.evaluations[0].checks[0].nodeIds,
    'every explicit association is included, not only the previous fixture subset',
  );
  for (const evaluation of output.evaluations) {
    const graph = output.architectures.find((item) => item.id === evaluation.architectureId)!;
    for (const check of evaluation.checks) {
      assert.deepEqual(
        check.nodeIds,
        graph.nodes
          .filter((node) => node.requirementIds.includes(check.requirementId))
          .map((node) => node.id),
      );
      assert.deepEqual(
        check.edgeIds,
        graph.edges
          .filter((edge) => edge.requirementIds.includes(check.requirementId))
          .map((edge) => edge.id),
      );
    }
  }
  output.architectures[0].nodes[0].label = 'changed after expansion';
  output.evaluations[0].checks[0].sourceIds.push('changed-source');
  assert.deepEqual(input, before, 'nested data is not shared with the returned explanation');
});

test('missing architecture and missing associations never borrow from other graphs', () => {
  const noGraph = fixture();
  noGraph.evaluations[0].architectureId = null;
  const noGraphOutput = linkEvaluationChecks(noGraph);
  for (const check of noGraphOutput.evaluations[0].checks) {
    assert.deepEqual(check.nodeIds, []);
    assert.deepEqual(check.edgeIds, []);
  }
  assert.equal(noGraphOutput.evaluations[0].architectureId, null);
  validateReferences(demoDocument.question, noGraphOutput);

  const noAssociations = fixture();
  noAssociations.architectures[0].nodes.forEach((node) => {
    node.requirementIds = [];
  });
  noAssociations.architectures[0].edges.forEach((edge) => {
    edge.requirementIds = [];
  });
  const output = linkEvaluationChecks(noAssociations);
  assert.ok(
    output.evaluations[0].checks.every((check) => !check.nodeIds.length && !check.edgeIds.length),
  );
  assert.ok(output.evaluations[1].checks.some((check) => check.nodeIds.length));
  validateReferences(demoDocument.question, output);

  const noEvaluations = fixture();
  noEvaluations.evaluations = [];
  assert.deepEqual(linkEvaluationChecks(noEvaluations).evaluations, []);
});

test('ambiguous or invalid scopes remain unchanged and fail strict validation', () => {
  const cases: Array<(input: ExplanationWithoutEvaluationLinks) => void> = [
    (input) => {
      input.evaluations[0].architectureId = 'missing-graph';
    },
    (input) => {
      input.evaluations[0].architectureId = 'graph-b';
    },
    (input) => {
      input.architectures.push(structuredClone(input.architectures[0]));
    },
    (input) => {
      input.evaluations[0].checks[0].requirementId = 'missing-requirement';
    },
    (input) => {
      input.requirements.push(structuredClone(input.requirements[0]));
    },
  ];
  for (const mutate of cases) {
    const input = fixture();
    mutate(input);
    const before = structuredClone(input);
    const output = linkEvaluationChecks(input);
    assert.deepEqual(output.evaluations[0].checks[0].nodeIds, []);
    assert.deepEqual(output.evaluations[0].checks[0].edgeIds, []);
    assert.deepEqual(withoutLinks(output), before);
    assert.deepEqual(input, before);
    assert.throws(() => validateReferences(demoDocument.question, output));
  }
});

test('deriving links does not repair semantic references, quotes, or graph topology', () => {
  const cases: Array<(input: ExplanationWithoutEvaluationLinks) => void> = [
    (input) => {
      input.requirements[0].quote = 'not present in the question';
    },
    (input) => {
      input.evaluations[0].checks[0].sourceIds = ['missing-source'];
    },
    (input) => {
      input.architectures[0].edges[0].to = 'missing-node';
    },
    (input) => {
      input.answerOptionIds = ['missing-option'];
    },
    (input) => {
      input.recommendedArchitectureId = 'missing-graph';
    },
  ];
  for (const mutate of cases) {
    const input = fixture();
    mutate(input);
    const output = linkEvaluationChecks(input);
    assert.deepEqual(withoutLinks(output), input);
    assert.throws(() => validateReferences(demoDocument.question, output));
  }
});
