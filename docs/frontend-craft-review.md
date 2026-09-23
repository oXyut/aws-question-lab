# frontend-craft 導入内容の確認

確認日: 2026-09-23。対象は `@bovinphang/frontend-craft@2.8.0`。結論は、**全面インストールを保留し、UI設計・トークン整理・視覚QAの判断基準を、このアプリ向けに限定して採用する**。

## 確認方法と版

- [npm配布情報](https://registry.npmjs.org/@bovinphang%2Ffrontend-craft/2.8.0)と[2.8.0 tarball](https://registry.npmjs.org/@bovinphang/frontend-craft/-/frontend-craft-2.8.0.tgz)を取得し、配布情報のSHA-512 integrityと一致することを確認した。
- 展開先はGit対象外の `.local/frontend-craft-review-2.8.0/package/`。CLI、インストール処理、同梱スクリプトは実行していない。インストーラーの静的読解による書き込み先一覧は同ディレクトリ直下の `planned-files.json` に保存した。
- 上流commitは `1cc82c36f050208f4dbd88e99aec5be68deb6334`。Node.js要件は22以上。ライセンスは[MIT、Copyright 2025 Bovin Phang](https://github.com/bovinphang/frontend-craft/blob/1cc82c36f050208f4dbd88e99aec5be68deb6334/LICENSE)。原文やコードをまとまった量で再配布するときは、著作権表示と許諾文を保持する。
- 配布物の調査では既存の `AGENTS.md`、Codex設定、ソース、依存関係を変更していない。UI改善に伴うプロジェクト側の差分はGitで記録する。この文書は配布物のレビューであり、スキルのインストール完了を意味しない。

## Codex向けローカル導入で書き込まれるもの

[Codex converter](https://github.com/bovinphang/frontend-craft/blob/1cc82c36f050208f4dbd88e99aec5be68deb6334/src/install/converters/codex.ts)と配布ファイルを照合した。`install --local codex` の範囲は3候補だけに限定されない。

| 出力先 | 2.8.0の処理 | このプロジェクトでの判断 |
| --- | --- | --- |
| `.agents/skills/` | 45スキルと補助資料・スクリプトをまとめてコピー | 全コピーは保留。必要な判断基準だけ取り込む |
| `.codex/agents/*.toml` | 13エージェントを変換して作成 | 全登録は保留。既存の委譲・モデル選択を維持 |
| `.codex/rules/` | 20個の共有ルールをコピー | npm scriptsや既存QAとの差を確認せず有効化しない |
| `AGENTS.md` | ファイルが存在しない場合だけテンプレートを作成 | 現在のファイルは保持される |
| `.codex/config.toml` | テンプレートをコピー。初回installでは既存ファイルの保護・マージを行わない | 設定の上書きを避けるためinstallは実行しない |
| `.codex/frontend-craft.manifest.json` | コピーしたファイルのハッシュ等を記録 | 限定的な文書採用には不要 |

既存AGENTSを保持する現在の条件では、静的列挙上の書き込み先は185ファイル。CLIのオプションにスキル・エージェント単位の選択はない。Codexのdry-runはベースディレクトリとagents/skillsの行き先を表示して終了するため、表示だけではconfig上書きまで分からない。

**Codex converterはhooks・slash commands・MCPサーバーを登録しない。** パッケージ全体のREADMEにある「終了時テスト」等を、Codexローカル導入の動作と混同しない。Codexのconfigテンプレートには6種のデザイン用MCP設定例があるが、すべてコメント状態。[設定テンプレート](https://github.com/bovinphang/frontend-craft/blob/1cc82c36f050208f4dbd88e99aec5be68deb6334/templates/codex/config.toml)

[エージェント変換](https://github.com/bovinphang/frontend-craft/blob/1cc82c36f050208f4dbd88e99aec5be68deb6334/src/install/codex-agents.ts)は、名前・説明・本文を取り込み、全件に `model = "gpt-5.4"` と `model_reasoning_effort = "high"` を固定する。元のtools、permissionMode、maxTurns、skills、mcpServers指定は同等のCodex設定として移植しない。生成ファイルが元エージェントと同じ制約で実行されるとはみなせない。

## 3候補の採用範囲

進言書の3候補は、実際には「1スキル＋2エージェント」。そのまま3個のスキルとしてコピーする方法にはならない。

| 候補・上流の種別 | 採用する判断基準 | このアプリでは採用しない／調整する部分 |
| --- | --- | --- |
| [`fec-ui-design`：skill](https://github.com/bovinphang/frontend-craft/blob/1cc82c36f050208f4dbd88e99aec5be68deb6334/skills/fec-ui-design/SKILL.md) | 主タスクを先に定める、最初の画面に入力操作を置く、実際のAWS図を中心にする、既存トークンを優先、状態・375/768/1440px・キーボード・reduced-motionを確認 | デザインシステム生成スクリプトは任意であり実行不要。操作説明を一律にアイコン・tooltipへ置き換える指示は、読みやすい日本語ラベルやタッチ操作に合わせて調整する |
| [`fec-design-token-mapper`：agent](https://github.com/bovinphang/frontend-craft/blob/1cc82c36f050208f4dbd88e99aec5be68deb6334/agents/fec-design-token-mapper.md) | 色・余白・角丸・文字サイズを既存CSSへ対応付け、新トークンが必要な理由を記録、同義の値を統合 | 本来はデザインツールの値をプロジェクトへ対応付ける役割。今回はCSSと既存画面を根拠とし、Figma等のMCP接続は追加しない |
| [`fec-ui-checker`：agent](https://github.com/bovinphang/frontend-craft/blob/1cc82c36f050208f4dbd88e99aec5be68deb6334/agents/fec-ui-checker.md) | 最小の再現手順、構造・CSS・状態の原因切り分け、局所修正、オーバーフロー・フォーカス・無効状態・小画面の再確認 | Tailwind前提を追加しない。機械的な100点採点より、影響と再現手順を優先。日付付きreportsの量産ではなく既存QAへ結果を統合する |

上記はこのアプリへの採用判断であり、上流のスキル一式を有効化したという意味ではない。

## 既存ルールとの調整

1. [Codex用AGENTSテンプレート](https://github.com/bovinphang/frontend-craft/blob/1cc82c36f050208f4dbd88e99aec5be68deb6334/templates/codex/AGENTS.md)はpnpm、Vitest、`lint`、`type-check`を例示する。このプロジェクトはnpm、Node test runner、`typecheck`で、lintスクリプトはない。テンプレートのコマンドや「commit前に毎回確認を求める」規則を現在の作業ルールへ混ぜない。
2. [既存のdesign-qa.md](../design-qa.md)で検証した構成図・原文・選択肢の連動を保つ。図解画面の骨格を再設計せず、まず入力画面と共通トークンを改善する。色だけで評価を区別せず、「要件違反」「比較上不利」「満たす」「情報不足」の文字も維持する。
3. スクリーンショットと実入力・生成履歴は `.local/` に置き、共有するQAには架空のサンプルを使う。上流エージェントの `reports/` への保存指示を、そのまま個人データの公開許可にしない。
4. ブラウザ確認は現在利用するツール・スキルの制約に従う。上流の一般的な検証手順を理由に、新しいブラウザ自動操作環境・hooks・MCPを導入しない。既存のtypecheck、テスト、ビルドとオフラインHTML出力の検証を維持する。
5. OpenAI公式資料では共有スキルの配置先を `.agents/skills` としているが、登録したスキルの実際の検出確認は別作業。デスクトップアプリはprimary folderを自動検出の基準とするため、将来登録するときは対象プロジェクトと新しいセッションでの検出を確認する。[Skillsの運用](https://learn.chatgpt.com/guides/best-practices#turn-repeatable-work-into-skills)、[ローカルプロジェクト](https://learn.chatgpt.com/docs/projects#use-local-projects-for-folders-and-codebases)

次の段階では、上記の限定した基準を入力画面のトークン統合・視覚階層・状態表示へ適用し、既存機能とHTML出力を含めて確認する。全面install、グローバル設定、エージェントのモデル固定は今回の改善に必要ない。
