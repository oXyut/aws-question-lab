import {
  QuestionDraftSchema,
  ExplanationSchema,
  applyEvidenceStatus,
  validateReferences,
  type ExplanationRevision,
  type ExplanationDocument,
  type QuestionDraft,
  type Source,
} from '../shared/schema.ts';
import { AppError } from './errors.ts';
import { CodexAdapter } from './codex.ts';
import { verifySources } from './sources.ts';
import { Storage, makeId } from './storage.ts';
import type { Executor } from './jobs.ts';
import { repairDisplayReferences, type DisplayReferenceRepair } from './reference-repair.ts';

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
      progress('research', 'AWS公式資料を検索して、要件と選択肢を照合しています。');
      const result = await cli.explain(
        question,
        signal,
        progress,
        payload.kind === 'followup'
          ? { prompt: payload.prompt, previousAnswer: parent!.explanation.answerRationale }
          : undefined,
      );
      beginDiagnostic(result.value, result.searched, question);
      await saveDiagnostic();
      progress('validating', '生成された解説の要件・出典・図の関連付けを確認しています。');
      const repaired = repairDisplayReferences(result.value);
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
        validateReferences(question, repaired.explanation);
      } catch (error) {
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
