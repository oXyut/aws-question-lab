import { EventEmitter } from 'node:events';
import type { GenerationJob, QuestionDraft } from '../shared/schema.ts';
import { Storage, makeId } from './storage.ts';
import { AppError, publicError } from './errors.ts';

export type JobPayload =
  | {
      kind: 'extract';
      text: string;
      knownAnswer: string;
      originalExplanation: string;
      imageIds: string[];
    }
  | { kind: 'generate'; question: QuestionDraft }
  | { kind: 'followup'; documentId: string; revisionId: string; prompt: string };
export type JobRecord = { job: GenerationJob; payload: JobPayload };
export type Executor = (
  payload: JobPayload,
  signal: AbortSignal,
  progress: (stage: string, message: string) => void,
) => Promise<NonNullable<GenerationJob['result']>>;
export const isTerminal = (status: GenerationJob['status']) =>
  ['completed', 'failed', 'cancelled'].includes(status);

export class JobManager {
  private records = new Map<string, JobRecord>();
  private events = new EventEmitter();
  private controller: AbortController | null = null;
  private writes = new Map<string, Promise<void>>();
  activeJobId: string | null = null;
  constructor(
    private storage: Storage,
    private execute: Executor,
  ) {
    this.events.setMaxListeners(100);
  }
  async init() {
    for (const id of await this.storage.listIds('jobs')) {
      let record: JobRecord;
      try {
        record = await this.storage.readJson<JobRecord>('jobs', id);
        if (record.job?.id !== id || !record.payload?.kind) continue;
      } catch {
        continue;
      }
      if (!isTerminal(record.job.status)) {
        record.job = {
          ...record.job,
          status: 'failed',
          stage: 'interrupted',
          message: 'アプリの終了により生成が中断されました。再試行できます。',
          updatedAt: new Date().toISOString(),
          error: { code: 'INTERRUPTED', message: '前回の処理はアプリ終了により中断されました。' },
        };
        await this.storage.writeJson('jobs', id, record);
      }
      this.records.set(id, record);
    }
  }
  assertAvailable() {
    if (this.activeJobId)
      throw new AppError(
        'BUSY',
        '別の生成が進行中です。完了するか中断してから実行してください。',
        409,
      );
  }
  get(id: string): GenerationJob {
    const record = this.records.get(id);
    if (!record) throw new AppError('NOT_FOUND', '生成ジョブが見つかりません。', 404);
    return structuredClone(record.job);
  }
  private persist(record: JobRecord) {
    const snapshot = structuredClone(record);
    const previous = this.writes.get(record.job.id) || Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(() => this.storage.writeJson('jobs', record.job.id, snapshot));
    this.writes.set(record.job.id, next);
    return next;
  }
  async start(payload: JobPayload): Promise<GenerationJob> {
    this.assertAvailable();
    const id = makeId(),
      now = new Date().toISOString();
    const job: GenerationJob = {
      id,
      kind: payload.kind,
      status: 'queued',
      stage: 'queued',
      message: '生成を準備しています。',
      createdAt: now,
      updatedAt: now,
    };
    const record = { job, payload: structuredClone(payload) };
    this.activeJobId = id;
    this.controller = new AbortController();
    this.records.set(id, record);
    try {
      await this.persist(record);
    } catch (error) {
      this.activeJobId = null;
      this.controller = null;
      this.records.delete(id);
      throw error;
    }
    const snapshot = this.get(id);
    void this.run(record, this.controller);
    return snapshot;
  }
  private update(record: JobRecord, patch: Partial<GenerationJob>, emit = true) {
    record.job = { ...record.job, ...patch, updatedAt: new Date().toISOString() };
    if (emit) this.events.emit(record.job.id, this.get(record.job.id));
  }
  private async run(record: JobRecord, controller: AbortController) {
    this.update(record, {
      status: 'running',
      stage: 'starting',
      message: 'Codexを起動しています。',
    });
    try {
      await this.persist(record);
      const result = await this.execute(record.payload, controller.signal, (stage, message) => {
        if (controller.signal.aborted) return;
        this.update(record, { stage, message });
        // Progress persistence is best effort; final state is always awaited below.
        void this.persist(record).catch(() => {});
      });
      if (controller.signal.aborted) throw new AppError('CANCELLED', '生成を中断しました。');
      this.update(
        record,
        { status: 'completed', stage: 'completed', message: '完了しました。', result },
        false,
      );
    } catch (error) {
      const detail = publicError(error);
      const cancelled = controller.signal.aborted || detail.code === 'CANCELLED';
      this.update(
        record,
        {
          status: cancelled ? 'cancelled' : 'failed',
          stage: cancelled ? 'cancelled' : 'failed',
          message: cancelled ? '生成を中断しました。入力から再試行できます。' : detail.message,
          error: cancelled ? { code: 'CANCELLED', message: '生成を中断しました。' } : detail,
        },
        false,
      );
    } finally {
      try {
        await this.persist(record);
      } catch {
        this.update(
          record,
          {
            status: 'failed',
            stage: 'failed',
            error: {
              code: 'STORAGE_FAILED',
              message: '結果の保存に失敗しました。空き容量と保存先を確認してください。',
            },
            message: '結果の保存に失敗しました。',
          },
          false,
        );
      }
      if (this.activeJobId === record.job.id) {
        this.activeJobId = null;
        this.controller = null;
      }
      this.events.emit(record.job.id, this.get(record.job.id));
    }
  }
  cancel(id: string) {
    const job = this.get(id);
    if (this.activeJobId === id && !isTerminal(job.status)) {
      this.controller?.abort();
      const record = this.records.get(id)!;
      this.update(record, { stage: 'cancelling', message: '生成の中断を待っています。' });
    }
    return this.get(id);
  }
  retry(id: string) {
    const job = this.get(id);
    if (job.status !== 'failed' && job.status !== 'cancelled')
      throw new AppError('NOT_RETRYABLE', '失敗または中断したジョブだけ再試行できます。', 409);
    return this.start(this.records.get(id)!.payload);
  }
  subscribe(id: string, listener: (job: GenerationJob) => void): () => void {
    this.get(id);
    this.events.on(id, listener);
    return () => {
      this.events.off(id, listener);
    };
  }
  async deleteDocument(id: string) {
    const document = await this.storage.document(id);
    const imageIds = new Set(
      [document.question, ...document.revisions.map((r) => r.question)].flatMap((q) => q.imageIds),
    );
    const questionTexts = new Set(
      [document.question, ...document.revisions.map((r) => r.question)].map((q) => q.text),
    );
    const related = [...this.records.values()].filter(
      (record) =>
        record.job.result?.documentId === id ||
        (record.payload.kind === 'followup' && record.payload.documentId === id) ||
        (record.payload.kind === 'generate' &&
          !record.job.result?.documentId &&
          questionTexts.has(record.payload.question.text)) ||
        (record.payload.kind === 'extract' &&
          (record.payload.imageIds.some((image) => imageIds.has(image)) ||
            (record.job.result?.draft && questionTexts.has(record.job.result.draft.text)))),
    );
    if (related.some((record) => record.job.id === this.activeJobId))
      throw new AppError(
        'BUSY',
        'この履歴を使った処理が進行中です。完了するか中断してから削除してください。',
        409,
      );
    for (const record of related) {
      await this.writes.get(record.job.id)?.catch(() => {});
      await this.storage.deleteJson('jobs', record.job.id);
      this.records.delete(record.job.id);
      this.writes.delete(record.job.id);
      if (record.payload.kind === 'extract')
        record.payload.imageIds.forEach((image) => imageIds.add(image));
    }
    await this.storage.deleteDocument(id);
    const retainedImages = new Set<string>();
    for (const documentId of await this.storage.listIds('documents')) {
      const retained = await this.storage.document(documentId);
      [retained.question, ...retained.revisions.map((r) => r.question)]
        .flatMap((q) => q.imageIds)
        .forEach((image) => retainedImages.add(image));
    }
    for (const { payload, job } of this.records.values()) {
      const images =
        payload.kind === 'extract'
          ? payload.imageIds
          : payload.kind === 'generate'
            ? payload.question.imageIds
            : [];
      [...images, ...(job.result?.draft?.imageIds || [])].forEach((image) =>
        retainedImages.add(image),
      );
    }
    await Promise.all(
      [...imageIds]
        .filter((image) => !retainedImages.has(image))
        .map((image) => this.storage.deleteImage(image)),
    );
  }
  async shutdown() {
    this.controller?.abort();
    await Promise.allSettled(this.writes.values());
  }
}
