import type { ExplanationInput, Source } from '../shared/schema.ts';

export function isOfficialUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      u.protocol === 'https:' &&
      ['aws.amazon.com', 'docs.aws.amazon.com'].includes(u.hostname) &&
      !u.username &&
      !u.password &&
      (!u.port || u.port === '443')
    );
  } catch {
    return false;
  }
}

const decodeHtml = (text: string) =>
  text.replace(
    /&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp|ndash|mdash|rsquo|lsquo|rdquo|ldquo);/gi,
    (_, entity: string) => {
      if (entity.startsWith('#')) {
        const n =
          entity[1].toLowerCase() === 'x'
            ? parseInt(entity.slice(2), 16)
            : parseInt(entity.slice(1), 10);
        return n <= 0x10ffff ? String.fromCodePoint(n) : '';
      }
      return (
        (
          {
            amp: '&',
            quot: '"',
            apos: "'",
            lt: '<',
            gt: '>',
            nbsp: ' ',
            ndash: '–',
            mdash: '—',
            rsquo: '’',
            lsquo: '‘',
            rdquo: '”',
            ldquo: '“',
          } as Record<string, string>
        )[entity.toLowerCase()] || ''
      );
    },
  );
export const normalizeText = (text: string) =>
  decodeHtml(text).normalize('NFKC').replace(/\s+/g, ' ').trim();
export function visibleText(html: string) {
  return normalizeText(
    html
      .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  );
}

export async function verifySources(
  inputs: ExplanationInput['sources'],
  searched: boolean,
  parentSignal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<Source[]> {
  return Promise.all(
    inputs.map(async (source) => {
      const checkedAt = new Date().toISOString();
      const fail = (verificationNote: string): Source => ({
        ...source,
        status: 'unverified',
        checkedAt,
        verificationNote,
      });
      if (!isOfficialUrl(source.url))
        return fail('許可されたAWS公式ドメインのHTTPS URLではありません。');
      if (!searched) return fail('今回の生成で公式資料を検索した記録を確認できません。');
      if (normalizeText(source.excerpt).length < 20)
        return fail('引用が短すぎるため本文との照合を保留しました。');
      try {
        const signal = AbortSignal.any([
          AbortSignal.timeout(12000),
          ...(parentSignal ? [parentSignal] : []),
        ]);
        let url = source.url;
        for (let redirects = 0; redirects <= 4; redirects++) {
          if (!isOfficialUrl(url)) return fail('転送先がAWS公式ドメインではありません。');
          const response = await fetcher(url, {
            signal,
            redirect: 'manual',
            headers: {
              Accept: 'text/html,text/plain',
              'User-Agent': 'AWSQuestionLab/0.1 (local documentation verification)',
            },
          });
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location');
            await response.body?.cancel();
            if (!location) return fail('公式資料の転送先が不明です。');
            url = new URL(location, url).href;
            continue;
          }
          if (!response.ok) {
            await response.body?.cancel();
            return fail(`公式資料を取得できませんでした（HTTP ${response.status}）。`);
          }
          const contentType = response.headers.get('content-type') || '';
          if (!/text\/(html|plain)|application\/xhtml\+xml/i.test(contentType)) {
            await response.body?.cancel();
            return fail('本文を照合できない資料形式です。');
          }
          const reader = response.body?.getReader();
          if (!reader) return fail('公式資料の本文がありません。');
          const chunks: Uint8Array[] = [];
          let size = 0;
          try {
            for (;;) {
              const part = await reader.read();
              if (part.done) break;
              size += part.value.length;
              if (size > 3 * 1024 * 1024) {
                await reader.cancel();
                return fail('公式資料が大きすぎるため照合を保留しました。');
              }
              chunks.push(part.value);
            }
          } finally {
            reader.releaseLock();
          }
          const body = new TextDecoder().decode(Buffer.concat(chunks));
          const text = /html/i.test(contentType) ? visibleText(body) : normalizeText(body);
          if (!text.includes(normalizeText(source.excerpt)))
            return fail('生成された引用と公式資料本文の完全一致を確認できませんでした。');
          return {
            ...source,
            status: 'verified',
            checkedAt,
            verificationNote:
              '今回の検索記録・公式URL・取得本文との引用一致を確認済みです。解答や推論の正しさを保証するものではありません。',
          } satisfies Source;
        }
        return fail('公式資料の転送回数が上限を超えました。');
      } catch {
        return fail('公式資料の取得がタイムアウトしたか通信に失敗しました。');
      }
    }),
  );
}
