import { verdictSchemaForRequirement, type ExplanationInput } from '../shared/schema.ts';

export function findVerdictConflicts(explanation: ExplanationInput) {
  return explanation.evaluations.flatMap((evaluation) =>
    evaluation.checks.flatMap((check) => {
      const requirements = explanation.requirements.filter((r) => r.id === check.requirementId);
      if (
        requirements.length !== 1 ||
        verdictSchemaForRequirement(requirements[0].kind).safeParse(check.verdict).success
      ) return [];
      return [{
        optionId: evaluation.optionId,
        requirementId: check.requirementId,
        kind: requirements[0].kind,
        verdict: check.verdict,
      }];
    }),
  );
}

/**
 * Isolate known verdict conflicts while checking for OTHER, unrepairable errors.
 * This copy must never be saved, published, or sent to the model. The original
 * reasons and verdicts go to a constrained model call for actual reassessment.
 */
export function verdictValidationCopy(explanation: ExplanationInput): ExplanationInput {
  const copy = structuredClone(explanation);
  for (const conflict of findVerdictConflicts(copy)) {
    for (const evaluation of copy.evaluations.filter((e) => e.optionId === conflict.optionId)) {
      for (const check of evaluation.checks.filter((c) => c.requirementId === conflict.requirementId)) {
        check.verdict = 'unknown';
      }
    }
  }
  return copy;
}
