import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ExplanationDocumentSchema,
  validateReferences,
  type ExplanationDocument,
} from '../shared/schema.js';
import { iconFileFor, serviceIcons } from '../shared/icons.js';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
type Bundle = { javascript: string; css: string };
let bundlePromise: Promise<Bundle> | undefined;

async function readBundle(): Promise<Bundle> {
  const [javascript, css] = await Promise.all([
    readFile(path.join(appRoot, 'dist/export/viewer.js'), 'utf8'),
    readFile(path.join(appRoot, 'dist/export/viewer.css'), 'utf8'),
  ]);
  return { javascript, css };
}

function getBundle(): Promise<Bundle> {
  if (!bundlePromise) {
    bundlePromise = readBundle()
      .catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        // Import only trusted application code. User data cannot choose a path or command.
        const { buildExport } = await import('../scripts/build-export.js');
        await buildExport();
        return readBundle();
      })
      .catch((error) => {
        bundlePromise = undefined;
        throw error;
      });
  }
  return bundlePromise;
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
}

/** JSON in a script element must never contain an HTML parser closing tag. */
export function serializeForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export async function renderExport(
  document: ExplanationDocument,
  revisionId?: string,
): Promise<string> {
  const parsed = ExplanationDocumentSchema.parse(document);
  const revision = revisionId
    ? parsed.revisions.find((item) => item.id === revisionId)
    : parsed.revisions.at(-1);
  if (!revision) throw new Error('指定された解説の版が見つかりません。');
  validateReferences(revision.question, revision.explanation);

  const services = [
    ...new Set(
      revision.explanation.architectures.flatMap((graph) =>
        graph.nodes.flatMap((node) => (node.service ? [node.service] : [])),
      ),
    ),
  ];
  const icons: Record<string, string> = Object.create(null) as Record<string, string>;
  await Promise.all(
    services.map(async (service) => {
      const filename = iconFileFor(service);
      if (!filename) return;
      try {
        const svg = await readFile(path.join(appRoot, 'public/aws-icons', filename));
        const data = `data:image/svg+xml;base64,${svg.toString('base64')}`;
        icons[service] = data;
        icons[filename] = data;
        for (const [key, file] of Object.entries(serviceIcons))
          if (file === filename) icons[key] = data;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        // The viewer renders a labeled generic node when a service icon is unavailable.
      }
    }),
  );
  const { javascript, css } = await getBundle();
  const payload = serializeForScript({ revision, icons });
  const title = escapeHtml(revision.question.title || revision.explanation.title);
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<title>${title} — AWS Question Lab</title>
<style>${css.replace(/<\/style/gi, '<\\/style')}
html,body{margin:0;min-height:100%;} .export-main{padding:24px;max-width:1800px;margin:0 auto;} .export-header{margin:0 0 24px;} .export-header>div{display:flex;align-items:center;gap:16px;flex-wrap:wrap;} .export-header strong{font-size:22px;} .export-header span{font-size:12px;border:1px solid currentColor;border-radius:999px;padding:4px 10px;} .export-header p{font-size:13px;line-height:1.7;opacity:.8;max-width:90ch;} @media(max-width:600px){.export-main{padding:12px;}}
</style>
</head>
<body>
<div id="root"></div>
<noscript>この解説を操作するにはブラウザーの JavaScript を有効にしてください。</noscript>
<script>window.__QUESTION_LAB_EXPORT__=${payload};</script>
<script>${javascript.replace(/<\/script/gi, '<\\/script')}</script>
</body>
</html>`;
}
