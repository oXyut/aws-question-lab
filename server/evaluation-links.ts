import type { Evaluation, ExplanationInput } from '../shared/schema.ts';

export type EvaluationWithoutLinks = Omit<Evaluation, 'checks'> & {
  checks: Array<Omit<Evaluation['checks'][number], 'nodeIds' | 'edgeIds'>>;
};

export type ExplanationWithoutEvaluationLinks = Omit<ExplanationInput, 'evaluations'> & {
  evaluations: EvaluationWithoutLinks[];
};

/**
 * Expand compact model output using only explicit associations in its graph.
 * This supplies presentation links, not semantic repairs. The caller must still
 * validate the complete explanation; invalid graph/option/requirement IDs remain.
 */
export function linkEvaluationChecks(input: ExplanationWithoutEvaluationLinks): ExplanationInput {
  const explanation = structuredClone(input);
  return {
    ...explanation,
    evaluations: explanation.evaluations.map((evaluation) => {
      const matches = explanation.architectures.filter(
        (graph) => graph.id === evaluation.architectureId,
      );
      const graph =
        matches.length === 1 && matches[0].optionIds.includes(evaluation.optionId)
          ? matches[0]
          : undefined;
      return {
        ...evaluation,
        checks: evaluation.checks.map((check) => {
          const unambiguousRequirement =
            explanation.requirements.filter((requirement) => requirement.id === check.requirementId)
              .length === 1;
          return {
            ...check,
            nodeIds:
              graph && unambiguousRequirement
                ? graph.nodes
                    .filter((node) => node.requirementIds.includes(check.requirementId))
                    .map((node) => node.id)
                : [],
            edgeIds:
              graph && unambiguousRequirement
                ? graph.edges
                    .filter((edge) => edge.requirementIds.includes(check.requirementId))
                    .map((edge) => edge.id)
                : [],
          };
        }),
      };
    }),
  };
}
