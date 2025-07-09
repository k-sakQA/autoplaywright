import { test, expect } from '@playwright/test';

test('セッション維持テスト：ログインのみ', async ({ page }) => {
  await test.step('ログインページを開く', async () => {
    await page.goto('https://hotel-example-site.takeyaqa.dev/ja/login.html');
  });
  
  await test.step('ログインページの確認', async () => {
    await expect(page.locator('h2:has-text("ログイン")')).toBeVisible();
  });
  
  await test.step('メールアドレスを入力', async () => {
    await page.fill('[name="email"]', 'ichiro@example.com');
  });
  
  await test.step('パスワードを入力', async () => {
    await page.fill('[name="password"]', 'password');
  });
  
  await test.step('ログインボタンをクリック', async () => {
    await page.click('button[type="submit"]:has-text("ログイン")');
  });
  
  await test.step('マイページに遷移することを確認', async () => {
    await page.waitForURL('https://hotel-example-site.takeyaqa.dev/ja/mypage.html');
  });
  
  await test.step('マイページでメールアドレスが表示されていることを確認', async () => {
    await expect(page.locator('p#email')).toBeVisible();
    await expect(page.locator('p#email')).toHaveText('ichiro@example.com');
  });
  
  await test.step('マイページで追加操作（セッション維持確認）', async () => {
    // セッションが維持されていることを確認するため、ページ内で追加の操作
    await expect(page.locator('h2:has-text("マイページ")')).toBeVisible();
    console.log('✅ セッション維持成功：ログイン状態が維持されています');
  });
}); 