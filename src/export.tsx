import { createRoot } from 'react-dom/client';
import { ExplanationViewer } from './components/ExplanationViewer.js';
import type { ExplanationRevision } from '../shared/schema.js';
import './styles.css';
import './studio.css';
import './diagram.css';

declare global {
  interface Window {
    __QUESTION_LAB_EXPORT__?: { revision: ExplanationRevision; icons: Record<string, string> };
  }
}

const payload = window.__QUESTION_LAB_EXPORT__;
const root = document.getElementById('root');
if (!root || !payload)
  throw new Error('解説データが見つかりません。アプリから HTML を再出力してください。');

createRoot(root).render(
  <main className="export-main">
    <header className="export-header">
      <div>
        <strong>AWS Question Lab</strong>
        <span>オフライン解説</span>
      </div>
      <p>
        保存した版の解説です。要件・選択肢・構成図を操作できます。追加質問と資料の再確認はアプリで行ってください。
      </p>
      {payload.revision.prompt && <p>追加質問：{payload.revision.prompt}</p>}
    </header>
    <ExplanationViewer revision={payload.revision} iconMap={payload.icons} />
  </main>,
);
