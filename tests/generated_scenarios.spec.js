import { test, expect } from '@playwright/test';

test('ユーザーストーリー：シナリオ連続実行', async ({ page }) => {
  await test.step('シナリオ 1: route_250709110327', async () => {
    await test.step('宿泊予約ページを開く', async () => {
      await page.goto('https://hotel-example-site.takeyaqa.dev/ja/reserve.html?plan-id=0');
    });
    await test.step('宿泊日を入力する', async () => {
      await page.fill('[name="date"]', '2025/07/17');
    });
    await test.step('宿泊数を入力する', async () => {
      await page.fill('[name="term"]', '1');
    });
    await test.step('人数を入力する', async () => {
      await page.fill('[name="head-count"]', '2');
    });
    await test.step('朝食バイキングを選択する', async () => {
      await page.click('[name="breakfast"]');
    });
    await test.step('氏名を入力する', async () => {
      await page.fill('[name="username"]', 'hoge fuga');
    });
    await test.step('確認のご連絡方法を選択する', async () => {
      await page.fill('[name="contact"]', 'メールでのご連絡');
    });
    await test.step('ご要望・ご連絡事項を入力する', async () => {
      await page.fill('[name="comment"]', '特になし');
    });
    await test.step('予約内容を確認するボタンを押下する', async () => {
      await page.click('#submit-button');
    });
    await test.step('宿泊予約確認画面に遷移することを確認する', async () => {
      await page.waitForURL('https://hotel-example-site.takeyaqa.dev/ja/confirm.html');
    });
    await test.step('宿泊日が正しく表示されていることを確認する', async () => {
      await expect(page.locator(':has-text("2025/07/17")')).toBeVisible();
    });
    await test.step('宿泊数が正しく表示されていることを確認する', async () => {
      await expect(page.locator(':has-text("1")')).toBeVisible();
    });
    await test.step('人数が正しく表示されていることを確認する', async () => {
      await expect(page.locator(':has-text("2")')).toBeVisible();
    });
    await test.step('追加プランが正しく表示されていることを確認する', async () => {
      await expect(page.locator(':has-text("朝食バイキング")')).toBeVisible();
    });
    await test.step('氏名が正しく表示されていることを確認する', async () => {
      await expect(page.locator(':has-text("hoge fuga")')).toBeVisible();
    });
    await test.step('確認のご連絡方法が正しく表示されていることを確認する', async () => {
      await expect(page.locator(':has-text("メールでのご連絡")')).toBeVisible();
    });
    await test.step('ご要望・ご連絡事項が正しく表示されていることを確認する', async () => {
      await expect(page.locator(':has-text("特になし")')).toBeVisible();
    });
  });
});
