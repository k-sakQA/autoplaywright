// tests/runRoutes.js

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const startTime = Date.now();
  let failedTests = [];
  let successTests = []; // 成功したテストを保存する配列を追加

  try {
    // 1. 最新の route ファイルを取得
    const testResultsDir = path.resolve(__dirname, '../test-results');
    const files = fs.readdirSync(testResultsDir)
      .filter(f => f.startsWith('route_') && f.endsWith('.json'));
    if (files.length === 0) {
      throw new Error('route JSONファイルが見つかりません');
    }
    // yymmddhhmmssでソートして最新を選択
    files.sort();
    const latestFile = files[files.length - 1];
    const routePath = path.join(testResultsDir, latestFile);
    console.log(`🛠️ [Debug] Using route file: ${routePath}`);

    // 2. ルートを読み込む
    const route = JSON.parse(fs.readFileSync(routePath, 'utf-8'));
    if (!route.steps || !Array.isArray(route.steps)) {
      throw new Error('ルートJSONにstepsが含まれていません。正しい形式のJSONを作成してください。');
    }
    console.log('🛠️ [Debug] Parsed route:', route);

    // 3. Playwright 起動
    const browser = await chromium.launch();
    const page = await browser.newPage({
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'https://hotel-example-site.takeyaqa.dev'
    });

    console.log(`🛠️ [Debug] Running route_id: ${route.route_id || 'undefined'}`);

    // 4. 各ステップを実行
    for (const step of route.steps) {
      const stepLabel = step.label || `${step.action} ${step.target}`;
      console.log(`\n📝 テストステップ: ${stepLabel}`);

      try {
        switch (step.action) {
          case 'goto':
          case 'load':
            await page.goto(step.target, { waitUntil: 'load' });
            console.log(`✅ ページ遷移成功: ${step.target}`);
            break;
          case 'waitForSelector':
            await page.waitForSelector(step.target, { timeout: step.timeout || 5000 });
            console.log(`✅ 要素待機完了: ${step.target}`);
            break;
          case 'assertVisible':
            await page.waitForSelector(step.target, { state: 'visible', timeout: step.timeout || 5000 });
            console.log(`✅ 要素表示確認: ${step.target}`);
            break;
          case 'assertNotVisible':
            await page.waitForSelector(step.target, { state: 'hidden', timeout: step.timeout || 5000 });
            console.log(`✅ 要素非表示確認: ${step.target}`);
            break;
          case 'click':
            if (step.expectsNavigation) {
              // クリックによるナビゲーションを待機
              await Promise.all([
                page.waitForNavigation({
                  timeout: step.timeout || 30000,
                  waitUntil: 'networkidle'
                }),
                page.click(step.target, { timeout: step.timeout || 5000 })
              ]);
              console.log(`✅ クリック後の画面遷移成功: ${step.target}`);
            } else {
              // 通常のクリック
              await page.click(step.target, { timeout: step.timeout || 5000 });
              console.log(`✅ クリック成功: ${step.target}`);
            }
            break;
          case 'fill':
            await page.fill(step.target, step.value || '', { timeout: step.timeout || 5000 });
            console.log(`✅ 入力完了: ${step.target} = "${step.value}"`);
            break;
          case 'waitForURL':
            await page.waitForURL(step.target, { timeout: step.timeout || 5000 });
            console.log(`✅ URL遷移確認: ${step.target}`);
            break;
          default:
            console.log(`⚠️ 未知のアクション: "${step.action}"`);
        }
        // テスト成功時の処理を追加
        successTests.push({
          label: stepLabel,
          action: step.action,
          target: step.target,
          timestamp: new Date().toISOString()
        });
      } catch (err) {
        // エラーをログに記録し、配列に保存
        console.log(`❌ テスト失敗 [${stepLabel}]: ${err.message}`);
        failedTests.push({
          label: stepLabel,
          action: step.action,
          target: step.target,
          error: err.message,
          timestamp: new Date().toISOString()
        });
        continue;
      }
    }

    // テスト結果のJSONオブジェクトを作成
    const testResults = {
      timestamp: new Date().toISOString(),
      route_id: route.route_id || '未設定',
      total_steps: route.steps.length,
      success_count: successTests.length,
      failed_count: failedTests.length,
      success: failedTests.length === 0,
      execution_time: Date.now() - startTime,
      successful_tests: successTests,  // 成功したテストの詳細
      failed_tests: failedTests       // 失敗したテストの詳細
    };

    // コンソール出力
    console.log('\n=== テスト実行結果 ===');
    console.log(`🔷 テストID: ${testResults.route_id}`);
    console.log(`🔷 総ステップ数: ${testResults.total_steps}`);
    console.log(`🔷 成功数: ${testResults.success_count}`);
    console.log(`🔷 失敗数: ${testResults.failed_count}`);

    if (failedTests.length > 0) {
      console.log('\n❌ 失敗したテストケース:');
      failedTests.forEach(test => {
        console.log(`  - ${test.label}: ${test.error}`);
      });
    } else {
      console.log('🎉 すべてのテストが正常に完了しました');
    }

    // 結果をJSONファイルとして保存
    const timestamp = latestFile.replace('route_', '').replace('.json', ''); // yymmddhhmmssを取得
    const resultPath = path.join(testResultsDir, `result_${timestamp}.json`); // .json拡張子を追加
    fs.writeFileSync(resultPath, JSON.stringify(testResults, null, 2));
    console.log(`\n📝 テスト結果を保存しました: ${resultPath}`);

    // 失敗したテストがある場合でも、プロセスは正常終了
    process.exit(testResults.success ? 0 : 1);
  } catch (err) {
    console.error('🚨 予期せぬエラーが発生:', err);
    process.exit(1);
  } finally {
    await browser?.close();
  }
})();
