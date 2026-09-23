import { expect, test, type Page } from '@playwright/test';
import type { GenerationJob } from '../shared/schema';

type ProgressJob = GenerationJob;
const baseTime = new Date('2026-09-23T12:00:00.000Z').getTime();
const at = (offsetSeconds: number) => new Date(baseTime + offsetSeconds * 1000).toISOString();
const inputText = '生成を待っている間も保持したいAWSの問題文です。';

async function openProgress(page: Page, initialJob: ProgressJob) {
  const state = { current: initialJob };
  // Let the page initialize naturally, then freeze at the fixture's exact reference time.
  // CI latency must not advance the clock between an action and its elapsed-time assertion.
  await page.clock.install({ time: new Date(baseTime - 60_000) });
  await page.addInitScript((text) => {
    localStorage.setItem(
      'aws-question-lab-input-v1',
      JSON.stringify({ text, knownAnswer: '', originalExplanation: '', draft: null }),
    );
    localStorage.setItem('aws-question-lab-job-v1', 'progress-job');
  }, inputText);
  await page.route('**/api/health', (route) =>
    route.fulfill({
      json: {
        ok: true,
        codexAvailable: true,
        authenticated: true,
        model: 'progress-fixture',
        activeJobId: null,
        message: 'テスト用',
      },
    }),
  );
  await page.route('**/api/documents', (route) => route.fulfill({ json: { documents: [] } }));
  await page.route('**/api/jobs/*', (route) => route.fulfill({ json: { job: state.current } }));
  await page.route('**/api/jobs/*/events', (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: `event: job\ndata: ${JSON.stringify(state.current)}\n\n`,
    }),
  );
  await page.goto('/');
  await expect(page.getByRole('region', { name: '生成の進行状況' })).toBeVisible();
  await page.clock.pauseAt(new Date(baseTime));
  return state;
}

function runningJob(patch: Partial<ProgressJob> = {}): ProgressJob {
  return {
    id: 'progress-job',
    kind: 'generate',
    status: 'running',
    stage: 'composing',
    message: '調査したAWS公式資料を使って解説を作成しています。',
    createdAt: at(-90),
    updatedAt: at(-5),
    activity: [
      { at: at(-85), stage: 'research', message: 'AWS公式資料の検索を開始しました。' },
      {
        at: at(-45),
        stage: 'research',
        message: 'https://docs.aws.amazon.com/athena/latest/ug/what-is.html を確認しています。',
      },
      {
        at: at(-5),
        stage: 'composing',
        message: '調査したAWS公式資料を使って解説を作成しています。',
      },
    ],
    ...patch,
  };
}

test('progress shows received stages and actual elapsed time without simulated progress', async ({
  page,
}, testInfo) => {
  await openProgress(page, runningJob());
  const progress = page.getByRole('region', { name: '生成の進行状況' });
  await expect(progress.locator('.progress-step.current')).toContainText('解説の作成');
  await expect(progress.locator('.progress-step.recorded')).toHaveCount(1);
  await expect(progress.locator('.progress-step.unrecorded')).toHaveCount(3);
  await expect(progress.locator('.progress-history-list li')).toHaveCount(3);
  await expect(page.getByRole('timer', { name: '経過時間' })).toContainText('1分30秒');
  await expect(progress.locator('.progress-wait-note')).toContainText(
    '完了までの時間はまだ分かりません',
  );
  await expect(progress).not.toContainText('%');
  await expect(page.getByLabel('問題文と選択肢', { exact: true })).toHaveValue(inputText);
  await page.clock.fastForward(5000);
  await expect(page.getByRole('timer', { name: '経過時間' })).toContainText('1分35秒');
  await expect(progress.locator('.progress-history-list li')).toHaveCount(3);
  expect(
    await page
      .getByRole('timer', { name: '経過時間' })
      .evaluate((timer) => timer.closest('[aria-live="polite"]') === null),
  ).toBe(true);
  await expect(progress.locator('.progress-title')).toHaveAttribute('aria-live', 'polite');
  await page.screenshot({ path: testInfo.outputPath('progress-desktop.png') });
});

test('repair status remains visible and cancellation freezes elapsed time while retry keeps input', async ({
  page,
}) => {
  const current = runningJob({
    kind: 'extract',
    stage: 'repairing',
    message: '読み取り結果の参照を修復しています。',
    createdAt: at(-120),
    activity: [
      { at: at(-115), stage: 'extracting', message: '問題文を読み取っています。' },
      { at: at(-10), stage: 'validating', message: '読み取り内容を確認しています。' },
      { at: at(-5), stage: 'repairing', message: '読み取り結果の参照を修復しています。' },
    ],
  });
  const state = await openProgress(page, current);
  const progress = page.getByRole('region', { name: '生成の進行状況' });
  await expect(progress.locator('.progress-step')).toHaveCount(3);
  await expect(progress.locator('.progress-step.current')).toContainText('読み取り内容の確認');
  await expect(progress.locator('.progress-step.current')).toContainText('修復中');
  await expect(progress).not.toContainText('公式本文との照合');
  await page.route('**/api/jobs/progress-job/cancel', (route) => {
    state.current = {
      ...current,
      status: 'cancelled',
      stage: 'cancelled',
      message: '生成を中断しました。',
      updatedAt: at(0),
    };
    return route.fulfill({ json: { job: state.current } });
  });
  await page.getByRole('button', { name: '中断', exact: true }).click();
  await expect(progress.locator('.progress-title')).toHaveText('生成を中断しました');
  await expect(page.getByRole('timer', { name: '経過時間' })).toContainText('2分00秒');
  await page.clock.fastForward(10000);
  await expect(page.getByRole('timer', { name: '経過時間' })).toContainText('2分00秒');
  await page.route('**/api/jobs/progress-job/retry', (route) => {
    state.current = {
      ...current,
      id: 'progress-retry',
      stage: 'extracting',
      message: '同じ入力を読み取っています。',
      createdAt: at(10),
      updatedAt: at(10),
      activity: [{ at: at(10), stage: 'extracting', message: '同じ入力を読み取っています。' }],
    };
    return route.fulfill({ status: 202, json: { job: state.current } });
  });
  await page.getByRole('button', { name: '再試行', exact: true }).click();
  await expect(progress.locator('.progress-step.current')).toContainText('問題の読み取り');
  await expect(page.getByRole('timer', { name: '経過時間' })).toContainText('0分00秒');
  await expect(page.getByLabel('問題文と選択肢', { exact: true })).toHaveValue(inputText);
  await expect(progress.locator('.progress-history-list li')).toHaveCount(1);
  await page.clock.fastForward(1000);
  await expect(page.getByRole('timer', { name: '経過時間' })).toContainText('0分01秒');
});

test('legacy jobs without activity keep their terminal duration and remain usable on mobile', async ({
  page,
}, testInfo) => {
  const legacy = runningJob({
    status: 'failed',
    stage: 'failed',
    message: '解説の生成に失敗しました。',
    error: { code: 'INVALID_REFERENCES', message: '評価の接続線に存在しない参照があります。' },
    createdAt: at(-95),
    updatedAt: at(-30),
    activity: undefined,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await openProgress(page, legacy);
  const progress = page.getByRole('region', { name: '生成の進行状況' });
  await expect(progress.locator('.progress-records')).not.toHaveAttribute('open');
  await expect(progress.getByText('処理の詳細と記録', { exact: true })).toBeVisible();
  await expect(progress.locator('.progress-outcome-note')).toContainText(
    '入力内容は保持されています',
  );
  await progress.getByText('処理の詳細と記録', { exact: true }).press('Enter');
  await expect(progress.locator('.progress-history-empty')).toContainText(
    '過去の進捗記録がありません',
  );
  await expect(progress.locator('.progress-current-message')).toHaveText(
    '評価の接続線に存在しない参照があります。',
  );
  await expect(page.getByRole('timer', { name: '経過時間' })).toContainText('1分05秒');
  await expect(page.getByRole('button', { name: '再試行', exact: true })).toBeEnabled();
  await page.clock.fastForward(30000);
  await expect(page.getByRole('timer', { name: '経過時間' })).toContainText('1分05秒');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('progress-mobile.png') });
});

test('server updates move the active stage and expose older records in chronological order', async ({
  page,
}) => {
  const state = await openProgress(page, runningJob());
  state.current = runningJob({
    stage: 'verifying',
    updatedAt: at(0),
    message: 'AWS公式本文との照合が2 / 3件完了しました。',
    activity: [
      { at: at(-85), stage: 'research', message: '最初の公式資料を検索しました。' },
      { at: at(-65), stage: 'research', message: '2件目の公式資料を検索しました。' },
      { at: at(-45), stage: 'composing', message: '解説を作成しました。' },
      { at: at(-25), stage: 'validating', message: '図と評価のつながりを確認しました。' },
      { at: at(-20), stage: 'repairing', message: '図と評価のつながりを修復しました。' },
      { at: at(-10), stage: 'validating', message: '修復後の整合性を確認しました。' },
      { at: at(0), stage: 'verifying', message: 'AWS公式本文との照合が2 / 3件完了しました。' },
    ],
  });
  await page.clock.fastForward(12000);
  const progress = page.getByRole('region', { name: '生成の進行状況' });
  await expect(progress.locator('.progress-step.current')).toContainText('公式本文との照合');
  await expect(progress.locator('.progress-current-message')).toContainText('2 / 3件');
  await expect(progress.locator('.progress-step').last()).toContainText('待機');
  await expect(progress.locator('.progress-history-list li:visible')).toHaveCount(5);
  await progress.getByText('それ以前の記録を表示（2件）', { exact: true }).click();
  await expect(progress.locator('.progress-history-list li:visible')).toHaveCount(7);
  await expect(progress.locator('.progress-history-list li').first()).toContainText(
    '最初の公式資料',
  );
  await expect(progress.locator('.progress-history-list li').last()).toContainText('2 / 3件');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
});
