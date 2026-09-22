import { mkdir, readFile, writeFile, rename, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  ExplanationDocumentSchema,
  Id,
  type ExplanationDocument,
  type DocumentSummary,
} from '../shared/schema.ts';
import { AppError } from './errors.ts';

export const makeId = () => randomUUID();
export function validId(id: string): string {
  if (!Id.safeParse(id).success) throw new AppError('INVALID_ID', 'IDが不正です。');
  return id;
}

export class Storage {
  constructor(readonly root: string) {}
  async init() {
    await Promise.all(
      ['documents', 'jobs', 'images', 'runtime', 'diagnostics'].map((d) =>
        mkdir(join(this.root, d), { recursive: true, mode: 0o700 }),
      ),
    );
  }
  async writeJson(area: 'documents' | 'jobs' | 'diagnostics', id: string, value: unknown) {
    const target = join(this.root, area, `${validId(id)}.json`);
    const temp = `${target}.${makeId()}.tmp`;
    await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
    await rename(temp, target);
  }
  async readJson<T>(area: 'documents' | 'jobs' | 'diagnostics', id: string): Promise<T> {
    try {
      return JSON.parse(await readFile(join(this.root, area, `${validId(id)}.json`), 'utf8')) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new AppError('NOT_FOUND', '保存データが見つかりません。', 404);
      throw error;
    }
  }
  async listIds(area: 'documents' | 'jobs' | 'diagnostics'): Promise<string[]> {
    return (await readdir(join(this.root, area)))
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5))
      .filter((id) => Id.safeParse(id).success);
  }
  async document(id: string): Promise<ExplanationDocument> {
    return ExplanationDocumentSchema.parse(await this.readJson('documents', id));
  }
  async saveDocument(doc: ExplanationDocument) {
    await this.writeJson('documents', doc.id, ExplanationDocumentSchema.parse(doc));
  }
  async documents(): Promise<DocumentSummary[]> {
    const docs = await Promise.all(
      (await this.listIds('documents')).map(async (id) => {
        try {
          const d = await this.document(id);
          return {
            id,
            title: d.revisions.at(-1)!.explanation.title,
            updatedAt: d.updatedAt,
            revisionCount: d.revisions.length,
          };
        } catch {
          return null;
        }
      }),
    );
    return docs
      .filter((d): d is DocumentSummary => d !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async deleteDocument(id: string) {
    await this.deleteJson('documents', id);
  }
  async deleteJson(area: 'documents' | 'jobs' | 'diagnostics', id: string) {
    try {
      await unlink(join(this.root, area, `${validId(id)}.json`));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  async deleteImage(id: string) {
    validId(id);
    await Promise.all(
      ['png', 'jpg', 'webp'].map(async (ext) => {
        try {
          await unlink(join(this.root, 'images', `${id}.${ext}`));
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        }
      }),
    );
  }
  async saveImage(bytes: Uint8Array, claimedType: string): Promise<string> {
    const type = sniffImage(bytes);
    if (bytes.length > 10 * 1024 * 1024)
      throw new AppError('IMAGE_TOO_LARGE', '画像は1枚10 MiBまでです。');
    if (!type || type !== claimedType)
      throw new AppError('INVALID_IMAGE', 'PNG・JPEG・WebPの画像を選択してください。');
    const id = makeId();
    await writeFile(join(this.root, 'images', `${id}.${imageExtension(type)}`), bytes, {
      mode: 0o600,
    });
    return id;
  }
  async image(id: string): Promise<{ path: string; bytes: Buffer; type: string }> {
    validId(id);
    for (const [ext, type] of [
      ['png', 'image/png'],
      ['jpg', 'image/jpeg'],
      ['webp', 'image/webp'],
    ]) {
      const path = join(this.root, 'images', `${id}.${ext}`);
      try {
        return { path, bytes: await readFile(path), type };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
    throw new AppError('NOT_FOUND', '画像が見つかりません。', 404);
  }
}

function imageExtension(type: string) {
  return (
    { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as Record<string, string>
  )[type];
}
export function sniffImage(b: Uint8Array): string | null {
  if (
    b.length >= 8 &&
    Buffer.from(b.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'image/png';
  if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
  if (
    b.length >= 12 &&
    Buffer.from(b.subarray(0, 4)).toString() === 'RIFF' &&
    Buffer.from(b.subarray(8, 12)).toString() === 'WEBP'
  )
    return 'image/webp';
  return null;
}
