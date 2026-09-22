import type { ExplanationInput } from '../shared/schema.ts';

export type DisplayReferenceRepair = {
  optionId: string;
  requirementId: string;
  architectureId: string | null;
  field: 'nodeIds' | 'edgeIds';
  before: string[];
  removedIds: string[];
  duplicateIds: string[];
  fallbackIds: string[];
  after: string[];
};

/**
 * Recover presentation-only references without inferring an intended graph or ID.
 * Semantic references (requirements, sources, answers, graph endpoints) are untouched;
 * callers must validate the complete result before publishing it.
 */
export function repairDisplayReferences<T extends ExplanationInput>(
  input: T,
): {
  explanation: T;
  repairs: DisplayReferenceRepair[];
} {
  const explanation = structuredClone(input);
  const repairs: DisplayReferenceRepair[] = [];
  for (const evaluation of explanation.evaluations) {
    const candidates = explanation.architectures.filter(
      (graph) => graph.id === evaluation.architectureId,
    );
    const graph = candidates.length === 1 ? candidates[0] : undefined;
    // A bad graph or graph/option association is a semantic error, not a display typo.
    if (
      evaluation.architectureId !== null &&
      (!graph || !graph.optionIds.includes(evaluation.optionId))
    )
      continue;

    for (const check of evaluation.checks) {
      if (
        explanation.requirements.filter((requirement) => requirement.id === check.requirementId)
          .length !== 1
      )
        continue;

      for (const field of ['nodeIds', 'edgeIds'] as const) {
        const elements = graph
          ? field === 'nodeIds'
            ? graph.nodes
            : graph.edges
          : explanation.architectures.flatMap((item) =>
              field === 'nodeIds' ? item.nodes.map(toReference) : item.edges.map(toReference),
            );
        const allowed = new Set(elements.map((element) => element.id));
        const before = [...check[field]];
        const removedIds = [...new Set(before.filter((id) => !allowed.has(id)))];
        const duplicateIds = [
          ...new Set(before.filter((id, index) => before.indexOf(id) !== index)),
        ];
        if (!removedIds.length && !duplicateIds.length) continue;

        const after = [...new Set(before.filter((id) => allowed.has(id)))];
        // Fill only a damaged, now-empty field. An intentionally empty field stays empty.
        // Multiple explicitly associated elements are all highlighted, never guessed by name.
        const fallbackIds =
          !after.length && removedIds.length && graph
            ? [
                ...new Set(
                  elements
                    .filter((element) => element.requirementIds.includes(check.requirementId))
                    .map((element) => element.id),
                ),
              ]
            : [];
        check[field] = [...after, ...fallbackIds];
        repairs.push({
          optionId: evaluation.optionId,
          requirementId: check.requirementId,
          architectureId: evaluation.architectureId,
          field,
          before,
          removedIds,
          duplicateIds,
          fallbackIds,
          after: [...check[field]],
        });
      }
    }
  }

  if (repairs.length) {
    const repairedChecks = new Set(
      repairs.map((repair) => JSON.stringify([repair.optionId, repair.requirementId])),
    ).size;
    const fallbackCount = repairs.filter((repair) => repair.fallbackIds.length).length;
    explanation.caveats.push(
      `図の表示リンクを修復しました（${repairedChecks}件の要件評価）。存在しない・別構成図のリンクや重複を除去し、${fallbackCount}項目は同じ構成図でその要件に明示的に関連付けられた要素へ置き換えました。関連が確認できない箇所は図の強調を省略しています。要件・出典・解答・判定理由は変更していません。`,
    );
  }
  return { explanation, repairs };
}

function toReference(element: { id: string; requirementIds: string[] }) {
  return { id: element.id, requirementIds: element.requirementIds };
}
