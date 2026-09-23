# Diagram Studio — design QA

final result: passed

## Visual truth and evidence

- Selected visual: second **displayed** Product Design result, `exec-1ec570fc-9373-45eb-8b66-5080c7cbfb2c.png`.
- Source visual truth path: `/Users/suzukiyuto/.codex/generated_images/01a0c9f5-cdd1-7f33-b39c-a1ac0038a121/exec-1ec570fc-9373-45eb-8b66-5080c7cbfb2c.png`.
- Implementation: `http://127.0.0.1:4317/`, built-in fictional sample, recommended Athena architecture, operations requirement selected, panels at their initial scroll positions.
- Implementation screenshot path: `.local/design-qa/desktop-final.png`.
- Desktop CSS viewport: 1487 × 1058. Source: 1487 × 1058 pixels. Browser capture: 1472 × 1047 pixels (browser capture scaling/scrollbar crop). For comparison the implementation was normalized to 1487 × 1058; no app content was removed.
- Full-view **combined** comparison: `.local/design-qa/comparison-final.jpg` (reference left, implementation right).
- Focused combined comparisons: `.local/design-qa/diagram-final.jpg` and `.local/design-qa/inspector-final.jpg`. They were used to inspect icons, connector labels, typography, judgement cards and disclosure controls.
- Mobile evidence: `.local/design-qa/mobile.png`, CSS viewport 390 × 844. The implementation has responsive tabs and a vertical graph; the selected desktop reference does not specify mobile UI.
- Screenshots are local QA artifacts and deliberately excluded from Git. No user question or generation log is included in committed evidence.

## Comparison history

1. Initial browser inspection found P1 overlapping graph controls and supplementary content: grid children retained their intrinsic minimum height. Explicit minimum-height/track rules now keep the graph and inspector within their desktop row. Finished job details formerly displaced the entire explanation; they are now collapsed and remain accessible outside the fictional sample.
2. First combined comparison (`comparison-initial.jpg`) found P2 undersized icons and excessive comparison-panel height. Icons increased to 82 px; selected judgement reasons show a readable excerpt with complete reasons inside a disclosure. Correct-answer conditions moved into the same detail surface. Header, rail, white canvas, orange requirement states, ink text and fixed step controls follow the selected design.
3. Refined comparison (`comparison-refined.jpg`, `inspector-comparison.jpg`) found P2 connector captions touching another node's description. The library's BaseEdge renderer now places angled horizontal captions near the source segment. `diagram-final.jpg` verifies the caption is clear of the preceding node.
4. Mobile inspection found P2 clipped requirement buttons under the navigation rail and a tiny horizontal diagram. Footer offset now follows the rail, and canvas widths below 520 px use a vertical ELK layout with appropriate top/bottom handles. The final mobile capture shows all requirement buttons and readable service icons.
5. At the normal 1280 × 720 laptop viewport, P2 requirement chips and diagram controls could fall behind other content. The question prose now scrolls independently and reveals the selected quotation. Low horizontal canvases use shorter nodes, retaining full descriptions on selection. `.local/design-qa/laptop-final.png` verifies readable icons and visible controls above the step bar.
6. Final full-view and focused combined comparisons found no remaining actionable P0/P1/P2 issues in the app workspace.

## Required fidelity surfaces

- **Typography:** system Japanese sans-serif with Hiragino Sans / Noto Sans JP fallbacks, distinct bold question and panel headings, 14–15 px reasoning, readable contrast. The real sample is substantially longer than the mock's abbreviated question; its text is preserved and uses a smaller question size. Full node descriptions remain available on selection and to keyboard users.
- **Spacing/layout:** 72 px navy header, 94 px navigation rail, approximately two-thirds diagram workspace and one-third judgement inspector. Long reasoning scrolls within the inspector. Supplementary learning points and source quotations remain below the workspace. The extra architecture selector and disclosure controls are necessary working-product controls.
- **Colors/tokens:** navy `#192f49`/`#1b2e49`, orange `#df680d`, white canvas, warm requirement highlights, green meets, neutral comparison disadvantage, red hard violations, amber unknown. The state text remains present alongside color.
- **Assets:** existing official AWS SVGs retained and bundled into exports. Lucide icons match the reference's outlined UI icons. No generated mock icons or decorative substitutes were used. ELK derives positions from actual graph topology; the mock's fixed coordinates and extra illustrative arrows are intentionally not hardcoded.
- **Copy/content:** original question, reference-linked judgements, sample disclosure, evidence status, known vs estimated answers, source excerpts and dates remain available. No invented metrics, accounts, dashboards or settings were added. The connection drawer exposes existing local CLI information.

## Interaction validation

Verified in the in-app browser:

- Requirement step → manual requirement selection resets cumulative evaluation and correctly shows “比較上不利”.
- Option B opens its Redshift architecture; architecture selection restores A.
- Diagram steps, play and stop work; stepping clears an old selected service description.
- Keyboard Enter selects requirements. Mobile question / diagram / evaluation tabs work.
- History drawer opens; Escape closes it and restores usable navigation.
- No horizontal page overflow at 390 px. Browser console error log empty in the final inspected app state.
- Unit suite: 67 tests passed. TypeScript and production/export bundle build passed.

The direct `file://` HTML browser check was blocked by the browser URL policy and was not bypassed. Export structure, embedded assets and network-denying CSP are covered by unit tests; this local visual QA does not claim to have performed a disconnected file-browser run. The first revision’s existing CI completed successfully, including its synthetic disconnected HTML browser test (15 browser tests total). The local blocked file navigation was not retried.

## Follow-up polish

- P3: exceptionally long architecture titles/reasons can require opening details or scrolling. This is an intentional readable-density tradeoff; further compression should preserve the original wording.
- The current change addresses design and presentation. AI generation latency and any separate model-output reference failures require their own backend work; no improvement to those is claimed here.

## Implementation checklist

- [x] Selected option resolved and inspected before implementation.
- [x] Shell, diagram and inspector integrated with existing data and actions.
- [x] Required fidelity surfaces compared using combined images.
- [x] All identified P0/P1/P2 visual findings fixed and recaptured.
- [x] Desktop/mobile, keyboard and core graph controls checked.
- [x] Export uses the same viewer styles without stale inline layout overrides.

## 2026-09-23 — 入力画面と共通トークンの改善

- 根拠: `frontend-craft-adoption-proposal.md`、既存画面の実表示、`docs/frontend-craft-review.md` の配布物調査。設計の継続ルールは `docs/frontend-design.md` に集約し、AGENTS.mdから参照する。
- 入力前後: 1440 × 900で、従来は読み取りボタンが画面下に隠れていた。ヒーローと3個の機能紹介を整理し、入力欄・画像・任意項目・主操作を1つの作業面に配置した。変更後は1440 × 900に加え、通常のノートPCサイズ1280 × 720でも最初の画面に読み取りボタンが収まる。既存のサンプルと保存・送信の説明は維持。
- 状態: 過去の失敗通知は、理由・再試行・入力保持の案内を表示し、処理段階とログは開閉式にした。処理中は詳細を初期展開し、実際のイベントと経過時間を引き続き表示する。通知の折りたたみにより、復旧操作と入力の両方を見渡せる。
- トークン: `tokens.css` の同じ定義をアプリとHTML出力に使用する。補助文・状態文・フォーカスを強め、主ボタンの白文字は明るい装飾用オレンジから読みやすい濃いオレンジへ変更。
- 図解: 1440 × 900で要件列が半分隠れる状態を確認し、デスクトップの原文を縮めて独立スクロールさせた。要件ボタン・構成図・評価の3者連動、構成切替、処理ステップを実ブラウザで再確認。
- レスポンシブ: 入力画面を375 / 768 / 1440pxで確認。横方向のページはみ出しなし。375pxの手順ラベルが不自然に折り返す点を修正。モバイルの図解・評価タブ、長い日本語、任意項目のEnterでの開閉、入力フォーカスを確認。画面が短い場合は縦スクロールで主操作へ移動する。
- ブラウザ確認にはアプリ内ブラウザと架空の入力・固定サンプルを使用。既存の失敗状態は表示のみ確認し、再生成は実行していない。実入力やログをGitに追加していない。
- ローカルの69 unit testsとtypecheckは成功。production / offline viewer buildも成功。既存CIでは履歴・画像入力・追加質問・オフラインHTMLを含むE2Eに加え、375/768/1440pxの入力操作と失敗ログのキーボード開閉を検証する（対象コミットのChecksを参照）。
- 今回は画面と開発基準の改善。モデル・生成速度・AI出力や出典照合の精度は変更していない。


## 2026-09-23 — ナビゲーションと解説の読み順、処理パネルの再設計

今回の明示的な改善依頼を優先し、過去のサイドレール・固定ステップバー・原文の内部スクロール・モバイルタブの方針を置き換えた。

- ヘッダーを72pxから56pxへ縮小し、94pxのサイドレールを撤去。履歴・接続をヘッダーに集約し、ローカルワークスペースの重複入口を削除した。ドロワーは右端から開く。
- 原文→解答と重要な要点→要件と選択肢の比較→全幅の構成図の順に並べた。原文・比較理由の高さ制限を廃止。本文中の長い要件マーカーは行をまたいで表示でき、キーボードのEnter/Spaceでも操作できる。
- 正解との不一致、未照合、判断の前提と注意を解答の近くに表示。用語と出典の全文は開閉式にまとめ、重複していた公式リンク一覧を削除した。
- 処理状況は右下に固定。展開時430px（低い画面ではビューポートに合わせて縮小）、最小化時82px。処理段階は矢印と実行中の回転・脈動・接続線の動きで示す。reduced-motionでは停止。経過時間とステージは受信データのみを使う。
- アプリ内ブラウザで固定サンプル、合成ジョブを確認。2件→40件で外枠は高さ430px・同じ位置を維持し、記録領域のみスクロールした。失敗・再試行・最小化・再展開・完了時の自動最小化を操作した。
- 375pxでページの横はみ出しなし、問題文の内容高と表示高が一致することを確認。選択肢B→Redshift構成、次の処理→クラスター準備の表示を確認した。
- 過去の配置に依存するE2Eを更新し、全文表示・読む順序・記録増加時の固定寸法・完了時の最小化・reduced-motionの回帰項目を追加した。ブラウザーの自動回帰テストは既存CIで実行する。
- 実行時データやスクリーンショットはGitに追加しない。画面確認用の合成ハーネスは `.local/design-qa/` と一時ディレクトリにのみ置く。
