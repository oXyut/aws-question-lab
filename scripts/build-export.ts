import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';

export const appRoot = fileURLToPath(new URL('../', import.meta.url));

/** Build the same viewer as the app, without network imports or external chunks. */
export async function buildExport(): Promise<void> {
  await mkdir(path.join(appRoot, 'dist/export'), { recursive: true });
  await build({
    absWorkingDir: appRoot,
    entryPoints: ['src/export.tsx'],
    outfile: 'dist/export/viewer.js',
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2022'],
    minify: true,
    sourcemap: false,
    legalComments: 'inline',
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.svg': 'dataurl', '.png': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl' },
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildExport();
  console.log('Offline HTML viewer built: dist/export/viewer.js + viewer.css');
}
