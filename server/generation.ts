import { isDeepStrictEqual } from 'node:util';
import {
  QuestionDraftSchema,
  ExplanationSchema,
  ExplanationInputSchema,
  EvaluationSchema,
  applyEvidenceStatus,
  validateReferences,
  type ExplanationRevision,
  type ExplanationDocument,
  type QuestionDraft,
  type Source,
  type ExplanationInput,
} from '../shared/schema.ts';
import { AppError } from './errors.ts';
import { CodexAdapter, type CliResult } from './codex.ts';
import { verifySources } from './sources.ts';
import { Storage, makeId } from './storage.ts';
import type { Executor } from './jobs.ts';
import { repairDisplayReferences, type DisplayReferenceRepair } from './reference-repair.ts';
import { findVerdictConflicts, verdictValidationCopy } from './evaluation-repair.ts';

type GenerationDiagnostic = {
  schemaVersion: 1;
  id: string;
  jobId: string | null;
  kind: 'extract' | 'generate' | 'followup';
  createdAt: string;
  updatedAt: string;
  status: 'received' | 'repaired' | 'validated' | 'completed' | 'failed';
  rawOutput: unknown;
  repairedOutput?: unknown;
  repairs: DisplayReferenceRepair[];
  question?: QuestionDraft;
  searched: boolean;
  cliMetrics?: CliResult<ExplanationInput>['metrics'];
  rawCreatedAt: string;
  resumedFrom?: { diagnosticId: string; createdAt: string; rawCreatedAt: string };
  completion?: {
    requestedOptionIds: string[];
    status: 'requested' | 'completed' | 'failed';
    rawOutput?: unknown;
    error?: { code: string; message: string };
  };
  completedOutput?: ExplanationInput;
  evaluationRepair?: {
    conflicts: ReturnType<typeof findVerdictConflicts>;
    requestedOptionIds: string[];
    status: 'requested' | 'completed' | 'failed';
    rawOutput?: unknown;
    error?: { code: string; message: string };
  };
  sourceVerification?: Source[];
  error?: { code: string; message: string };
  result?: { documentId: string; revisionId: string };
};

export function createExecutor(storage: Storage, cli: CodexAdapter): Executor {
  return async (payload, signal, progress, context) => {
    const diagnosticId = context?.jobId ?? makeId();
    let diagnostic: GenerationDiagnostic | undefined;
    const beginDiagnostic = (rawOutput: unknown, searched: boolean, question?: QuestionDraft) => {
      const now = new Date().toISOString();
      diagnostic = {
        schemaVersion: 1,
        id: diagnosticId,
        jobId: context?.jobId ?? null,
        kind: payload.kind,
        createdAt: now,
        updatedAt: now,
        status: 'received',
        rawOutput,
        repairs: [],
        searched,
        rawCreatedAt: now,
        question,
      };
    };
    const saveDiagnostic = async () => {
      if (!diagnostic) return;
      diagnostic.updatedAt = new Date().toISOString();
      await storage.writeJson('diagnostics', diagnosticId, diagnostic);
    };
    try {
      if (payload.kind === 'extract') {
        progress('extracting', '問題文と画像を読み取っています。');
        const images = await Promise.all(payload.imageIds.map((id) => storage.image(id)));
        const result = await cli.extract(
          { ...payload, images: images.map((i) => i.path) },
          signal,
          progress,
        );
        beginDiagnostic(result.value, result.searched);
        await saveDiagnostic();
        progress('validating', '読み取った問題文と選択肢の形式を確認しています。');
        const draft = QuestionDraftSchema.parse({
          ...result.value,
          imageIds: payload.imageIds,
          originalExplanation: payload.originalExplanation || result.value.originalExplanation,
        });
        const options = new Set(draft.options.map((o) => o.id));
        if (
          options.size !== draft.options.length ||
          draft.knownAnswerIds.some((id) => !options.has(id))
        )
          throw new AppError(
            'INVALID_OUTPUT',
            '読み取った選択肢のIDが整合していません。再試行してください。',
          );
        diagnostic!.repairedOutput = draft;
        diagnostic!.status = 'completed';
        progress('saving', '読み取った問題文をローカルに保存しています。');
        await saveDiagnostic();
        return { draft };
      }
      let document: ExplanationDocument | undefined;
      let parent: ExplanationRevision | undefined;
      let question;
      if (payload.kind === 'followup') {
        document = await storage.document(payload.documentId);
        parent = document.revisions.find((r) => r.id === payload.revisionId);
        if (!parent) throw new AppError('NOT_FOUND', '元の解説の版が見つかりません。', 404);
        const text = `${parent.question.text}\n\n【追加の質問・条件】\n${payload.prompt}`;
        const parsed = QuestionDraftSchema.safeParse({ ...parent.question, text });
        if (!parsed.success)
          throw new AppError(
            'INPUT_TOO_LONG',
            '追加質問を含む問題文が長すぎます。元の版に戻って短い質問を入力してください。',
          );
        question = parsed.data;
      } else question = payload.question;
      await Promise.all(question.imageIds.map((id) => storage.image(id)));
      const resumed = payload.resumeDiagnosticId
        ? await restoreRecentExplanation(storage, payload.resumeDiagnosticId, question)
        : null;
      let result: CliResult<ExplanationInput>;
      if (resumed) {
        progress('validating', '直近の生成結果から再開し、未完了の検証を続けています。');
        result = resumed;
      } else {
        progress('research', 'AWS公式資料を検索して、要件と選択肢を照合しています。');
        result = await cli.explain(
          question,
          signal,
          progress,
          payload.kind === 'followup'
            ? { prompt: payload.prompt, previousAnswer: parent!.explanation.answerRationale }
            : undefined,
        );
      }
      beginDiagnostic(resumed?.rawOutput ?? result.value, result.searched, question);
      if (result.metrics) diagnostic!.cliMetrics = structuredClone(result.metrics);
      if (resumed) {
        diagnostic!.rawCreatedAt = resumed.rawCreatedAt;
        diagnostic!.resumedFrom = {
          diagnosticId: payload.resumeDiagnosticId!,
          createdAt: resumed.createdAt,
          rawCreatedAt: resumed.rawCreatedAt,
        };
      }
      await saveDiagnostic();
      progress('validating', '生成された解説の要件・出典・図の関連付けを確認しています。');
      let completeExplanation = result.value;
      const optionIds = new Set(question.options.map((option) => option.id));
      const evaluatedIds = result.value.evaluations.map((evaluation) => evaluation.optionId);
      const missingOptionIds = question.options
        .filter((option) => !evaluatedIds.includes(option.id))
        .map((option) => option.id);
      if (
        missingOptionIds.length &&
        new Set(evaluatedIds).size === evaluatedIds.length &&
        evaluatedIds.every((id) => optionIds.has(id))
      ) {
        diagnostic!.completion = { requestedOptionIds: missingOptionIds, status: 'requested' };
        await saveDiagnostic();
        progress(
          'repairing',
          `不足している${missingOptionIds.length}件の選択肢評価を、取得済みの資料から補完しています。`,
        );
        try {
          const added = await cli.completeEvaluations(
            question,
            structuredClone(result.value),
            [...missingOptionIds],
            signal,
            (_stage, message) => progress('repairing', message),
          );
          diagnostic!.completion.rawOutput = added;
          await saveDiagnostic();
          const parsed = EvaluationSchema.array().safeParse(added);
          if (
            !parsed.success ||
            parsed.data.length !== missingOptionIds.length ||
            new Set(parsed.data.map((evaluation) => evaluation.optionId)).size !==
              missingOptionIds.length ||
            parsed.data.some((evaluation) => !missingOptionIds.includes(evaluation.optionId))
          )
            throw new AppError(
              'INVALID_REFERENCES',
              `不足分の選択肢評価を補完できませんでした。診断ID: ${diagnosticId}。`,
            );
          completeExplanation = {
            ...result.value,
            evaluations: [
              ...result.value.evaluations,
              ...missingOptionIds.map((id) =>
                parsed.data.find((evaluation) => evaluation.optionId === id)!,
              ),
            ],
            caveats: [
              ...result.value.caveats,
              `初回出力で不足していた${missingOptionIds.length}件の選択肢評価を、取得済みの公式資料と構成図を使って補完しました。`,
            ],
          };
          diagnostic!.completion.status = 'completed';
          diagnostic!.completedOutput = completeExplanation;
          await saveDiagnostic();
        } catch (error) {
          diagnostic!.completion.status = 'failed';
          diagnostic!.completion.error = {
            code: error instanceof AppError ? error.code : 'COMPLETION_FAILED',
            message: error instanceof Error ? error.message : 'Unknown completion failure',
          };
          throw error;
        }
      }
      const repaired = repairDisplayReferences(completeExplanation);
      diagnostic!.repairedOutput = repaired.explanation;
      diagnostic!.repairs = repaired.repairs;
      diagnostic!.status = 'repaired';
      if (repaired.repairs.length)
        progress(
          'repairing',
          '無効な図の表示リンクを整理し、明示された要件との関連付けを確認しています。',
        );
      await saveDiagnostic();
      try {
        const conflicts = findVerdictConflicts(repaired.explanation);
        if (conflicts.length) {
          // Validate everything else before paying for a bounded reassessment.
          validateReferences(question, verdictValidationCopy(repaired.explanation));
          const requestedOptionIds = [...new Set(conflicts.map((conflict) => conflict.optionId))];
          diagnostic!.evaluationRepair = { conflicts, requestedOptionIds, status: 'requested' };
          await saveDiagnostic();
          progress('repairing', '要件の分類と矛盾する判定を検出したため、該当する選択肢を再評価しています。');
          try {
            const output = await cli.repairEvaluations(
              question,
              structuredClone(repaired.explanation),
              requestedOptionIds,
              signal,
              (_stage, message) => progress('repairing', message),
            );
            diagnostic!.evaluationRepair.rawOutput = output;
            await saveDiagnostic();
            const parsed = EvaluationSchema.array().safeParse(output);
            if (
              !parsed.success ||
              parsed.data.length !== requestedOptionIds.length ||
              new Set(parsed.data.map((evaluation) => evaluation.optionId)).size !== requestedOptionIds.length ||
              parsed.data.some((evaluation) => !requestedOptionIds.includes(evaluation.optionId))
            ) throw new Error('再評価の選択肢が指定された対象と一致しません');
            const candidate = repairDisplayReferences({
              ...repaired.explanation,
              evaluations: repaired.explanation.evaluations.map((evaluation) =>
                parsed.data.find((updated) => updated.optionId === evaluation.optionId) ?? evaluation,
              ),
            });
            validateReferences(question, candidate.explanation);
            repaired.explanation = candidate.explanation;
            repaired.repairs.push(...candidate.repairs);
            repaired.explanation.caveats.push(
              `要件の分類と矛盾していた${requestedOptionIds.length}件の選択肢評価を、取得済みの資料から再評価しました。`,
            );
            diagnostic!.repairedOutput = repaired.explanation;
            diagnostic!.evaluationRepair.status = 'completed';
            await saveDiagnostic();
          } catch (error) {
            diagnostic!.evaluationRepair.status = 'failed';
            diagnostic!.evaluationRepair.error = {
              code: error instanceof AppError ? error.code : 'INVALID_REFERENCES',
              message: error instanceof Error ? error.message : 'Unknown reassessment failure',
            };
            throw error;
          }
        }
        validateReferences(question, repaired.explanation);
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(
          'INVALID_REFERENCES',
          `生成された解説の関連付けを検証できませんでした：${(error as Error).message}。診断ID: ${diagnosticId}。`,
        );
      }
      diagnostic!.status = 'validated';
      await saveDiagnostic();
      progress('verifying', '公式資料の本文と引用を照合しています。');
      const sources = await verifySources(
        repaired.explanation.sources,
        result.searched,
        signal,
        undefined,
        (source, completed, total) =>
          progress(
            'verifying',
            `${completed}/${total}件を照合：${source.title}（${source.status === 'verified' ? '一致' : '要確認'}）`,
          ),
      );
      diagnostic!.sourceVerification = sources;
      if (signal.aborted) throw new AppError('CANCELLED', '生成を中断しました。');
      const explanation = applyEvidenceStatus(
        ExplanationSchema.parse({ ...repaired.explanation, sources }),
      );
      if (!result.searched)
        explanation.caveats.push(
          '今回の実行で資料を検索した記録を確認できません。各判断は要確認です。',
        );
      if (sources.some((s) => s.status === 'unverified'))
        explanation.caveats.push(
          '本文照合を確認できない出典があります。該当する判断は「情報不足・要確認」として表示しています。',
        );
      const now = new Date().toISOString();
      const revision: ExplanationRevision = {
        id: makeId(),
        createdAt: now,
        parentRevisionId: parent?.id || null,
        prompt: payload.kind === 'followup' ? payload.prompt : '',
        question,
        explanation,
      };
      if (document) {
        // Re-read to avoid resurrecting a document deleted while research was running.
        document = await storage.document(document.id);
        document = { ...document, updatedAt: now, revisions: [...document.revisions, revision] };
      } else
        document = {
          schemaVersion: 1,
          id: makeId(),
          createdAt: now,
          updatedAt: now,
          question,
          revisions: [revision],
        };
      progress('saving', '解説と参照資料をローカルに保存しています。');
      if (signal.aborted) throw new AppError('CANCELLED', '生成を中断しました。');
      await storage.saveDocument(document);
      diagnostic!.status = 'completed';
      diagnostic!.result = { documentId: document.id, revisionId: revision.id };
      // The raw/repaired output is already durable. Diagnostic bookkeeping must not
      // turn a successfully saved document into a failed job and duplicate it on retry.
      await saveDiagnostic().catch(() => {});
      return { documentId: document.id, revisionId: revision.id };
    } catch (error) {
      if (diagnostic) {
        diagnostic.status = 'failed';
        diagnostic.error = {
          code: error instanceof AppError ? error.code : 'GENERATION_FAILED',
          message: error instanceof Error ? error.message : 'Unknown generation failure',
        };
        // Preserve the original failure if diagnostic storage is unavailable.
        await saveDiagnostic().catch(() => {});
      }
      throw error;
    }
  };
}

/** Resume only fresh output whose remaining failures have a bounded recovery path. */
async function restoreRecentExplanation(storage: Storage, id: string, question: QuestionDraft) {
  try {
    const saved = await storage.readJson<Partial<GenerationDiagnostic>>('diagnostics', id);
    const savedQuestion = QuestionDraftSchema.safeParse(saved.question);
    const raw = ExplanationInputSchema.safeParse(saved.rawOutput);
    const createdAt = typeof saved.createdAt === 'string' ? saved.createdAt : '';
    const rawCreatedAt = typeof saved.rawCreatedAt === 'string' ? saved.rawCreatedAt : createdAt;
    const now = Date.now();
    const ages = [now - Date.parse(createdAt), now - Date.parse(rawCreatedAt)];
    if (
      !savedQuestion.success ||
      !isDeepStrictEqual(savedQuestion.data, question) ||
      !raw.success ||
      typeof saved.searched !== 'boolean' ||
      ages.some((age) => !Number.isFinite(age) || age < 0 || age > 15 * 60 * 1000)
    )
      return null;
    const validationCopy = verdictValidationCopy(repairDisplayReferences(raw.data).explanation);
    const evaluatedIds = new Set(
      validationCopy.evaluations.map((evaluation) => evaluation.optionId),
    );
    // These neutral entries exist only in this isolated validation copy. They let
    // validateReferences inspect existing evaluations and the whole graph even
    // when some evaluations are missing; they never reach the model or storage.
    for (const option of question.options) {
      if (evaluatedIds.has(option.id)) continue;
      validationCopy.evaluations.push({
        optionId: option.id,
        overall: 'unknown',
        summary: '',
        conditionsToBeCorrect: '',
        architectureId: null,
        checks: validationCopy.requirements
          .filter((requirement) => requirement.kind !== 'context')
          .map((requirement) => ({
            requirementId: requirement.id,
            verdict: 'unknown',
            reason: '',
            sourceIds: [],
            nodeIds: [],
            edgeIds: [],
          })),
      });
    }
    validateReferences(question, validationCopy);
    return {
      value: raw.data,
      searched: saved.searched,
      rawOutput: saved.rawOutput,
      createdAt,
      rawCreatedAt,
      metrics: saved.cliMetrics,
    };
  } catch {
    // Missing/corrupt/expired or otherwise invalid output needs fresh research.
    return null;
  }
}
