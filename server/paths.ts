import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const appRoot = fileURLToPath(new URL('../', import.meta.url));
export const dataRoot = resolve(process.env.QUESTION_LAB_DATA_DIR || resolve(appRoot, '.local'));
