import { test, expect, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { demoDocument, demoQuestion } from '../shared/demo';
import type { ExplanationDocument, GenerationJob } from '../shared/schema';
import { renderExport } from '../server/export';

const health = {
  ok: true,
  codexAvailable: true,
  authenticated: true,
  model: 'test-fixture',
  activeJobId: null,
  message: 'テスト用',
};
const job = (
  id: string,
  kind: GenerationJob['kind'],
  result?: GenerationJob['result'],
): GenerationJob => ({
  id,
  kind,
  status: result ? 'completed' : 'running',
  stage: result ? 'completed' : 'research',
  message: 'テスト用の生成状況',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  result,
});

async function mockBase(page: Page) {
  await page.route('**/api/health', (route) => route.fulfill({ json: health }));
  await page.route('**/api/documents', (route) => route.fulfill({ json: { documents: [] } }));
}
async function openSample(page: Page) {
  await mockBase(page);
  await page.goto('/');
  await page.getByRole('button', { name: /サンプルを見てみる/ }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
}

test('requirements, option comparisons, architecture switching and flow steps stay linked', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openSample(page);
  await expect(
    page.getByText('操作体験用の固定教材です。出典の確認結果もデモ表示です。', { exact: true }),
  ).toBeVisible();
  await page.locator('.studio-requirement').first().click();
  await page.locator('.studio-requirement').filter({ hasText: '運用負荷を最小限に' }).click();
  await expect(page.locator('.quote-highlight.selected')).toContainText('運用負荷を最小限');
  await expect(
    page.locator('.service-node.is-active').filter({ hasText: 'Amazon Athena' }),
  ).toBeVisible();
  await expect(page.locator('.evaluation-card.eliminated')).toHaveCount(0);
  await expect(
    page.locator('.evaluation-card').nth(1).locator('.evaluation-heading .verdict'),
  ).toHaveText('比較上不利');
  await page.locator('.studio-original-options > summary').click();
  await page.locator('.original-options button').nth(1).click();
  await expect(page.getByLabel('表示する構成')).toHaveValue('graph-b');
  await expect(
    page.locator('.react-flow__node').filter({ hasText: 'Redshift RA3 + Spectrum' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '次の処理', exact: true }).click();
  await expect(page.locator('.flow-step')).toContainText('クラスターを用意する');
  const requirementSteps = page.getByRole('navigation', { name: '要件を順に確認' });
  await requirementSteps.getByRole('button', { name: /^要件 1:/ }).click();
  await expect(requirementSteps.getByRole('button', { name: /^要件 1:/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await requirementSteps.getByRole('button', { name: '次の要件へ', exact: true }).click();
  await expect(requirementSteps.getByRole('button', { name: /^要件 2:/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.quote-highlight.selected')).toContainText(
    '元データを別のデータストア',
  );
  await page.locator('.studio-requirement').filter({ hasText: '運用負荷を最小限に' }).click();
  await expect(page.locator('.studio-insight > strong')).toContainText('運用負荷を最小限に');
  await expect(
    page.locator('.evaluation-card').nth(1).locator('.evaluation-heading .verdict'),
  ).toHaveText('比較上不利');
  await expect(
    page.locator('.evaluation-card').nth(1).locator('.studio-evaluation-reason'),
  ).toHaveText(
    demoDocument.revisions[0].explanation.evaluations[1].checks.find(
      (check) => check.requirementId === 'operations',
    )!.reason,
  );
  await requirementSteps.getByRole('button', { name: /^要件 1:/ }).click();
  await page.locator('.original-options button').nth(1).click();
  await expect(page.locator('.quote-highlight.selected')).toContainText('運用負荷を最小限');
  await expect(
    page.locator('.evaluation-card').nth(1).locator('.evaluation-heading .verdict'),
  ).toHaveText('比較上不利');
  expect(errors).toEqual([]);
});

test('small screen tabs and keyboard controls work without page overflow', async ({ page }) => {
  await openSample(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect
    .poll(async () => {
      const toolbar = await page.locator('.diagram-toolbar').boundingBox();
      const stepbar = await page.locator('.studio-stepbar').boundingBox();
      return !!toolbar && !!stepbar && toolbar.y + toolbar.height <= stepbar.y;
    })
    .toBe(true);
  await page.getByRole('button', { name: '次の処理', exact: true }).click();
  await expect(page.locator('.flow-step')).toContainText('テーブルを定義する');
  await page.getByRole('button', { name: '処理の強調をリセット', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('tab', { name: '構成図', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('tab', { name: '問題と要件', exact: true }).click();
  await expect(page.locator('.studio-question')).toBeVisible();
  await page.locator('.studio-requirement').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.studio-requirement').first()).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('tab', { name: '選択肢の評価', exact: true }).click();
  await expect(page.locator('.studio-inspector')).toBeVisible();
  await page.getByRole('tab', { name: '構成図', exact: true }).click();
  await expect(page.locator('.studio-diagram')).toBeVisible();
  await expect(page.locator('.service-node').first()).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});

test('input survives a failed streamed job, retry restores editable draft, new question clears it', async ({
  page,
}) => {
  await mockBase(page);
  const running = job('failed-reading', 'extract');
  const failed: GenerationJob = {
    ...running,
    status: 'failed',
    stage: 'failed',
    error: { code: 'NETWORK', message: 'テスト用：通信に失敗しました' },
  };
  await page.route('**/api/extract', (route) =>
    route.fulfill({ status: 202, json: { job: running } }),
  );
  await page.route('**/api/jobs/failed-reading/events', (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: `event: job\ndata: ${JSON.stringify(failed)}\n\n`,
    }),
  );
  await page.route('**/api/jobs/failed-reading', (route) =>
    route.fulfill({ json: { job: failed } }),
  );
  await page.route('**/api/jobs/failed-reading/retry', (route) =>
    route.fulfill({
      status: 202,
      json: { job: job('retried-reading', 'extract', { draft: demoQuestion }) },
    }),
  );
  await page.goto('/');
  await page
    .getByLabel('問題文と選択肢', { exact: true })
    .fill('失敗しても保持するテスト用の問題文');
  await page.getByRole('button', { name: /問題を読み取る/ }).click();
  await expect(page.getByText('テスト用：通信に失敗しました')).toBeVisible();
  await expect(page.getByLabel('問題文と選択肢', { exact: true })).toHaveValue(
    '失敗しても保持するテスト用の問題文',
  );
  await page.getByRole('button', { name: '再試行', exact: true }).click();
  await expect(page.getByLabel('問題文', { exact: true })).toHaveValue(demoQuestion.text);
  await page.getByLabel('問題文', { exact: true }).fill(`${demoQuestion.text}\n編集した内容`);
  await expect(page.getByLabel('問題文', { exact: true })).toHaveValue(/編集した内容/);
  await page.getByRole('button', { name: '問題を追加', exact: true }).click();
  await expect(page.getByLabel('問題文と選択肢', { exact: true })).toHaveValue('');
});

test('generation, follow-up revisions, history and a genuinely offline HTML export', async ({
  page,
  context,
}, testInfo) => {
  await mockBase(page);
  let stored: ExplanationDocument = structuredClone(demoDocument);
  stored.id = 'saved-example';
  const original = stored.revisions[0];
  await page.route('**/api/extract', (route) =>
    route.fulfill({
      status: 202,
      json: { job: job('read-example', 'extract', { draft: demoQuestion }) },
    }),
  );
  await page.route('**/api/generate', (route) => {
    expect(route.request().postDataJSON().question.text).toBe(demoQuestion.text);
    return route.fulfill({
      status: 202,
      json: {
        job: job('generate-example', 'generate', {
          documentId: stored.id,
          revisionId: original.id,
        }),
      },
    });
  });
  await page.route('**/api/documents/saved-example', (route) =>
    route.request().method() === 'DELETE'
      ? route.fulfill({ json: { ok: true } })
      : route.fulfill({ json: { document: stored } }),
  );
  await page.route('**/api/documents', (route) =>
    route.fulfill({
      json: {
        documents: [
          {
            id: stored.id,
            title: stored.revisions.at(-1)!.explanation.title,
            updatedAt: stored.updatedAt,
            revisionCount: stored.revisions.length,
          },
        ],
      },
    }),
  );
  await page.route('**/api/documents/saved-example/followups', (route) => {
    const { prompt, revisionId } = route.request().postDataJSON();
    expect(revisionId).toBe(original.id);
    stored = {
      ...stored,
      revisions: [
        ...stored.revisions,
        {
          ...structuredClone(original),
          id: 'second-revision',
          parentRevisionId: original.id,
          prompt,
          explanation: {
            ...structuredClone(original.explanation),
            title: '追加質問後の解説',
            shortAnswer: '追加の条件も確認した推定解答',
          },
        },
      ],
    };
    return route.fulfill({
      status: 202,
      json: {
        job: job('followup-example', 'followup', {
          documentId: stored.id,
          revisionId: 'second-revision',
        }),
      },
    });
  });
  await page.route('**/api/documents/saved-example/export?*', async (route) => {
    const revisionId = new URL(route.request().url()).searchParams.get('revisionId')!;
    await route.fulfill({ contentType: 'text/html', body: await renderExport(stored, revisionId) });
  });
  await page.goto('/');
  await page.getByLabel('問題文と選択肢', { exact: true }).fill(demoQuestion.text);
  await page.getByRole('button', { name: /問題を読み取る/ }).click();
  await expect(page.getByLabel('問題文', { exact: true })).toHaveValue(demoQuestion.text);
  await page.getByRole('button', { name: /図解を生成する/ }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  await page.locator('.followup-examples > summary').click();
  await page.getByRole('button', { name: '処理の流れをもっと詳しく教えて', exact: true }).click();
  await expect(page.getByLabel('追加質問', { exact: true })).toHaveValue(
    '処理の流れをもっと詳しく教えて',
  );
  await page.getByLabel('追加質問', { exact: true }).fill('この比較の前提を詳しく説明してください');
  await page.getByRole('button', { name: '追加質問する', exact: true }).click();
  await expect(page.getByLabel('解説の版')).toHaveValue('second-revision');
  await expect(page.locator('.revision-prompt')).toContainText(
    'この比較の前提を詳しく説明してください',
  );
  await page.locator('.answer-details > summary').click();
  await expect(page.locator('.answer-details > h3')).toHaveText('追加の条件も確認した推定解答');
  await page.getByLabel('解説の版').selectOption(original.id);
  await page.locator('.answer-details > summary').click();
  await expect(page.locator('.answer-details > h3')).toHaveText(original.explanation.shortAnswer);
  const pendingDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'HTML出力', exact: true }).click();
  const download = await pendingDownload;
  const exportPath = testInfo.outputPath('offline-explanation.html');
  await download.saveAs(exportPath);
  const offline = await context.newPage();
  const remoteRequests: string[] = [],
    errors: string[] = [];
  offline.on('request', (request) => {
    if (/^https?:/.test(request.url())) remoteRequests.push(request.url());
  });
  offline.on('pageerror', (error) => errors.push(error.message));
  await context.setOffline(true);
  await offline.goto(pathToFileURL(exportPath).href);
  await expect(offline.locator('.react-flow__node')).toHaveCount(4);
  await offline.locator('.studio-requirement').first().click();
  await offline.locator('.studio-requirement').last().click();
  await expect(offline.locator('.quote-highlight.selected')).toContainText('運用負荷');
  await offline.getByLabel('表示する構成').selectOption('graph-c');
  await expect(
    offline.locator('.react-flow__node').filter({ hasText: 'EMR on EC2 / Spark SQL' }),
  ).toBeVisible();
  await offline.getByRole('button', { name: '次の処理', exact: true }).click();
  await expect(offline.locator('.flow-step')).toContainText('クラスターを用意する');
  expect(
    await offline
      .locator('.service-node-icon img')
      .evaluateAll((images) =>
        images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
      ),
  ).toBe(true);
  expect(remoteRequests).toEqual([]);
  expect(errors).toEqual([]);
  await offline.close();
  await context.setOffline(false);
  await page.getByRole('button', { name: '問題を追加', exact: true }).click();
  await page.getByRole('button', { name: '履歴', exact: true }).click();
  await page
    .getByRole('dialog', { name: /学習履歴/ })
    .locator('.history-open')
    .click();
  await expect(page.getByRole('dialog', { name: /学習履歴/ })).toHaveCount(0);
  await expect(page.getByLabel('解説の版')).toHaveValue('second-revision');
});

test('PNG upload reaches the extraction request and can be corrected before generation', async ({
  page,
}) => {
  await mockBase(page);
  await page.route('**/api/extract', (route) => {
    const body = route.request().postDataBuffer()!;
    expect(body.toString()).toContain('filename="question.png"');
    return route.fulfill({
      status: 202,
      json: {
        job: job('read-image', 'extract', {
          draft: { ...demoQuestion, uncertainties: ['画像の選択肢Bの文字を確認してください。'] },
        }),
      },
    });
  });
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({
    name: 'question.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aYs8AAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(page.getByText('question.png', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: /問題を読み取る/ }).click();
  await expect(page.getByText('画像の選択肢Bの文字を確認してください。')).toBeVisible();
  await page.getByLabel('選択肢 B の内容', { exact: true }).fill('修正した選択肢');
  await page.getByRole('button', { name: /確認・修正しました/ }).click();
  await expect(page.getByRole('button', { name: /図解を生成する/ })).toBeEnabled();
});
