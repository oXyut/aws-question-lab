import { test, expect, type Page } from '@playwright/test';
import { demoDocument, demoQuestion } from '../shared/demo';
import { validateReferences, type ExplanationDocument, type GenerationJob } from '../shared/schema';

const health = {
  ok: true,
  codexAvailable: true,
  authenticated: true,
  model: 'edge-case-fixture',
  activeJobId: null,
  message: 'E2E用の架空データ',
};

async function showFixture(page: Page, document: ExplanationDocument) {
  validateReferences(document.revisions[0].question, document.revisions[0].explanation);
  await page.route('**/api/health', (route) => route.fulfill({ json: health }));
  await page.route('**/api/documents', (route) =>
    route.fulfill({
      json: {
        documents: [
          {
            id: document.id,
            title: document.revisions[0].explanation.title,
            updatedAt: document.updatedAt,
            revisionCount: 1,
          },
        ],
      },
    }),
  );
  await page.route(`**/api/documents/${document.id}`, (route) =>
    route.fulfill({ json: { document } }),
  );
  await page.goto('/');
  await page.locator('.history-open').click();
  await expect(page.locator('.react-flow__node')).toHaveCount(
    document.revisions[0].explanation.architectures[0].nodes.length,
  );
}

function multipleSelection(): ExplanationDocument {
  const document = structuredClone(demoDocument);
  document.id = 'fixture-multiple';
  const revision = document.revisions[0];
  revision.question.text = revision.question.text.replace(
    '最も適切な構成を 1 つ選んでください。',
    '最も適切な組み合わせを 2 つ選んでください。',
  );
  revision.question.selectionMode = 'multiple';
  revision.question.selectionCount = 2;
  revision.question.knownAnswerIds = ['a', 'b'];
  revision.question.options[0].text = 'AWS Glue Data Catalog に、S3の場所と列の型を登録する。';
  revision.question.options[1].text =
    'Amazon Athena で、Data Catalogを参照してS3のログをSQLで集計する。';
  revision.explanation.title = '架空の複数選択問題：メタデータとSQLの役割分担';
  revision.explanation.shortAnswer = 'A + B：Data Catalog と Athena を組み合わせる';
  revision.explanation.answerOptionIds = ['a', 'b'];
  revision.explanation.answerRationale =
    'Aはテーブル定義を、BはSQLの実行を担当します。両方を組み合わせることで、元データをS3に置いたままサーバーレスに分析できます。';
  revision.explanation.architectures = revision.explanation.architectures.filter(
    (graph) => graph.id !== 'graph-b',
  );
  revision.explanation.architectures[0].optionIds = ['a', 'b'];
  revision.explanation.architectures[0].title = 'A + B の構成';
  revision.explanation.evaluations[0].summary = 'AはBと組み合わせ、テーブル定義を担当します。';
  revision.explanation.evaluations[1] = {
    ...structuredClone(revision.explanation.evaluations[0]),
    optionId: 'b',
    summary: 'BはAと組み合わせ、SQLの実行を担当します。',
  };
  document.question = revision.question;
  return document;
}

test('multiple selections explain the combination without treating each service as an incomplete answer', async ({
  page,
}) => {
  await showFixture(page, multipleSelection());
  await expect(page.locator('.answer-banner')).toContainText('A + B');
  await expect(page.locator('.answer-banner')).toContainText(
    'Aはテーブル定義を、BはSQLの実行を担当',
  );
  await expect(page.locator('.multi-answer')).toContainText('組み合わせとして評価：A + B');
  await expect(page.locator('.multi-answer')).toContainText('単体の不足だけで除外せず');
  await expect(
    page.locator('.evaluation-card').nth(0).locator('.evaluation-heading .verdict'),
  ).toHaveText('満たす');
  await expect(
    page.locator('.evaluation-card').nth(1).locator('.evaluation-heading .verdict'),
  ).toHaveText('満たす');
  await expect(page.locator('.evaluation-card.eliminated')).toHaveCount(0);
  await page.locator('.original-options button').nth(1).click();
  await expect(page.getByLabel('表示する構成')).toHaveValue('graph-a');
  await expect(
    page.locator('.react-flow__node').filter({ hasText: 'Amazon Athena' }),
  ).toBeVisible();
  await expect(
    page.locator('.react-flow__node').filter({ hasText: 'Glue Data Catalog' }),
  ).toBeVisible();
  await expect(page.getByText('入力された正解と推定解答が異なります', { exact: true })).toHaveCount(
    0,
  );
});

test('questions without options retain requirements, diagrams and sources with a clear empty evaluation state', async ({
  page,
}) => {
  const document = structuredClone(demoDocument);
  document.id = 'fixture-free-question';
  const revision = document.revisions[0];
  revision.question.selectionMode = 'none';
  revision.question.selectionCount = null;
  revision.question.options = [];
  revision.question.knownAnswerIds = [];
  revision.question.text = revision.question.text.replace(
    '最も適切な構成を 1 つ選んでください。',
    'どのような構成にするとよいか、処理の流れを説明してください。',
  );
  revision.explanation.title = '選択肢のない質問：S3をSQLで分析するには';
  revision.explanation.answerOptionIds = [];
  revision.explanation.shortAnswer = 'AthenaとData CatalogでS3のデータを分析できます';
  revision.explanation.evaluations = [];
  revision.explanation.architectures = [revision.explanation.architectures[0]];
  revision.explanation.architectures[0].optionIds = [];
  document.question = revision.question;
  await showFixture(page, document);
  await expect(page.locator('.empty-evaluations')).toContainText('選択肢のない質問です');
  await expect(page.locator('.original-options')).toHaveCount(0);
  await expect(page.locator('.evaluation-card')).toHaveCount(0);
  await expect(page.locator('.requirement-card')).toHaveCount(3);
  await expect(page.locator('.source-card')).toHaveCount(3);
  await page.locator('.requirement-card').last().click();
  await expect(page.locator('.quote-highlight.selected')).toContainText('運用負荷を最小限');
  await expect(
    page.locator('.service-node.is-active').filter({ hasText: 'Amazon Athena' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '次の処理', exact: true }).click();
  await expect(page.locator('.flow-step')).toContainText('テーブルを定義する');
});

test('long Japanese content keeps node boxes apart and exposes complete descriptions to keyboard users', async ({
  page,
}) => {
  const document = structuredClone(demoDocument);
  document.id = 'fixture-long-japanese';
  const revision = document.revisions[0];
  revision.explanation.title = '長い日本語の構成図を確認する架空のテスト';
  const graph = revision.explanation.architectures[0];
  graph.nodes.forEach((node, index) => {
    node.label = `サービス${index + 1}：複数の業務システムから収集した非常に長い日本語の分析要件を持つログデータを処理するアーキテクチャ構成要素`;
    node.description = `説明${index + 1}：複数の業務システムから到着するログを保持し、最小限の運用負荷で繰り返し分析できるようにする役割です。長い名称が表示しきれない場合も、キーボードで選択するとこの説明と完全な名称を確認できます。`;
  });
  graph.edges.forEach((edge) => {
    edge.label = '分析用の処理';
  });
  await showFixture(page, document);
  await expect
    .poll(async () =>
      page
        .locator('.react-flow__node')
        .evaluateAll((nodes) => nodes.every((node) => node.getBoundingClientRect().width > 0)),
    )
    .toBe(true);
  const boxesDoNotOverlap = await page.locator('.react-flow__node').evaluateAll((nodes) => {
    const boxes = nodes.map((node) => node.getBoundingClientRect());
    return boxes.every((a, i) =>
      boxes
        .slice(i + 1)
        .every(
          (b) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top,
        ),
    );
  });
  expect(boxesDoNotOverlap).toBe(true);
  expect(
    await page.locator('.service-node-label').evaluateAll((labels) =>
      labels.every((label) => {
        const box = label.getBoundingClientRect(),
          parent = label.parentElement!.getBoundingClientRect();
        return (
          box.left >= parent.left - 1 &&
          box.right <= parent.right + 1 &&
          box.top >= parent.top - 1 &&
          box.bottom <= parent.bottom + 1
        );
      }),
    ),
  ).toBe(true);
  await page.locator('.service-node').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.diagram-detail')).toContainText(graph.nodes[0].label);
  await expect(page.locator('.diagram-detail')).toContainText(graph.nodes[0].description);
  expect(
    await page.evaluate(() => window.document.documentElement.scrollWidth <= innerWidth + 1),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.diagram-panel')).toBeVisible();
  expect(
    await page.evaluate(() => window.document.documentElement.scrollWidth <= innerWidth + 1),
  ).toBe(true);
});

test('reloading preserves the edited draft instead of reapplying the completed extraction result', async ({
  page,
}) => {
  const draft = structuredClone(demoQuestion);
  const job: GenerationJob = {
    id: 'persisted-extraction',
    kind: 'extract',
    status: 'completed',
    stage: 'completed',
    message: '架空の問題を読み取りました',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    result: { draft },
  };
  await page.route('**/api/health', (route) => route.fulfill({ json: health }));
  await page.route('**/api/documents', (route) => route.fulfill({ json: { documents: [] } }));
  await page.route('**/api/extract', (route) => route.fulfill({ status: 202, json: { job } }));
  await page.route('**/api/jobs/persisted-extraction', (route) => route.fulfill({ json: { job } }));
  await page.goto('/');
  await page
    .getByLabel('問題文と選択肢', { exact: true })
    .fill('最初に貼り付けた問題文も保持します。');
  await page.getByRole('button', { name: /問題を読み取る/ }).click();
  await page.getByLabel('タイトル', { exact: true }).fill('手で修正したタイトル');
  await page
    .getByLabel('問題文', { exact: true })
    .fill(`${draft.text}\nユーザーが追記した条件です。`);
  await page.getByLabel('選択肢 B の内容', { exact: true }).fill('ユーザーが修正した選択肢B');
  await page.getByLabel('選択肢 B を入力された正解にする', { exact: true }).check();
  await page.reload();
  await expect(page.getByText('問題の読み取りが完了しました', { exact: true })).toBeVisible();
  await expect(page.getByLabel('タイトル', { exact: true })).toHaveValue('手で修正したタイトル');
  await expect(page.getByLabel('問題文', { exact: true })).toHaveValue(
    `${draft.text}\nユーザーが追記した条件です。`,
  );
  await expect(page.getByLabel('選択肢 B の内容', { exact: true })).toHaveValue(
    'ユーザーが修正した選択肢B',
  );
  await expect(page.getByLabel('選択肢 B を入力された正解にする', { exact: true })).toBeChecked();
  await expect(
    page.getByLabel('選択肢 A を入力された正解にする', { exact: true }),
  ).not.toBeChecked();
  await page.getByRole('button', { name: '入力に戻る', exact: true }).click();
  await expect(page.getByLabel('問題文と選択肢', { exact: true })).toHaveValue(
    '最初に貼り付けた問題文も保持します。',
  );
});

test('an impossible selection count cannot trigger generation', async ({ page }) => {
  const job: GenerationJob = {
    id: 'count-validation',
    kind: 'extract',
    status: 'completed',
    stage: 'completed',
    message: '入力確認用の架空データ',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    result: { draft: structuredClone(demoQuestion) },
  };
  await page.route('**/api/health', (route) => route.fulfill({ json: health }));
  await page.route('**/api/documents', (route) => route.fulfill({ json: { documents: [] } }));
  await page.route('**/api/extract', (route) => route.fulfill({ status: 202, json: { job } }));
  await page.goto('/');
  await page
    .getByLabel('問題文と選択肢', { exact: true })
    .fill('複数選択の数を入力して確認する問題です。');
  await page.getByRole('button', { name: /問題を読み取る/ }).click();
  await page.getByLabel('解答形式', { exact: true }).selectOption('multiple');
  await page.getByLabel('選ぶ数（任意）', { exact: true }).fill('4');
  await expect(page.getByRole('button', { name: /図解を生成する/ })).toBeDisabled();
  await expect(
    page.getByText('選ぶ数は1〜3の整数にしてください。', { exact: false }),
  ).toBeVisible();
  await page.getByLabel('選ぶ数（任意）', { exact: true }).fill('0');
  await expect(page.getByRole('button', { name: /図解を生成する/ })).toBeDisabled();
  await page.getByLabel('選ぶ数（任意）', { exact: true }).fill('2');
  await expect(page.getByRole('button', { name: /図解を生成する/ })).toBeEnabled();
});
