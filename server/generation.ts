import {
  QuestionDraftSchema,
  ExplanationSchema,
  applyEvidenceStatus,
  validateReferences,
  type ExplanationRevision,
  type ExplanationDocument,
} from '../shared/schema.ts';
import { AppError } from './errors.ts';
import { CodexAdapter } from './codex.ts';
import { verifySources } from './sources.ts';
import { Storage, makeId } from './storage.ts';
import type { Executor } from './jobs.ts';

export function createExecutor(storage: Storage, cli: CodexAdapter): Executor {
  return async (payload, signal, progress) => {
    if (payload.kind === 'extract') {
      progress('extracting', '問題文と画像を読み取っています。');
      const images = await Promise.all(payload.imageIds.map((id) => storage.image(id)));
      const result = await cli.extract(
        { ...payload, images: images.map((i) => i.path) },
        signal,
        progress,
      );
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
    try {
      validateReferences(question, result.value);
    } catch (error) {
      throw new AppError(
        'INVALID_REFERENCES',
        `生成された解説の関連付けを検証できませんでした：${(error as Error).message}。再試行してください。`,
      );
    }
    progress('verifying', '公式資料の本文と引用を照合しています。');
    const sources = await verifySources(result.value.sources, result.searched, signal);
    if (signal.aborted) throw new AppError('CANCELLED', '生成を中断しました。');
    const explanation = applyEvidenceStatus(ExplanationSchema.parse({ ...result.value, sources }));
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
    await storage.saveDocument(document);
    return { documentId: document.id, revisionId: revision.id };
  };
}
