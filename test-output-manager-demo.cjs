const OutputManager = require('./src/output-manager/index.cjs');
const ConfigLoader = require('./src/output-manager/utils/config-loader.cjs');

/**
 * OutputManagerのデモンストレーション
 * Phase 1実装の動作確認を行う
 */
async function demoOutputManager() {
  console.log('🚀 AutoPlaywright OutputManager デモ開始\n');
  
  try {
    // 設定読み込み
    console.log('📋 設定読み込み中...');
    const configLoader = new ConfigLoader();
    const config = await configLoader.loadGlobalConfig();
    console.log('✅ 設定読み込み完了\n');
    
    // OutputManager初期化
    console.log('🔧 OutputManager初期化中...');
    const outputManager = new OutputManager(config);
    console.log('✅ OutputManager初期化完了\n');
    
    // セッション開始
    console.log('🎬 テストセッション開始...');
    const session = await outputManager.startSession();
    console.log(`✅ セッション作成完了: ${session.sessionId}\n`);
    
    // テスト観点データを保存
    console.log('📝 テスト観点データ保存中...');
    const testPoints = [
      {
        id: 'TP001',
        category: 'ログイン機能',
        description: '正常なログイン処理',
        priority: 'high',
        automatable: true
      },
      {
        id: 'TP002',
        category: 'ログイン機能', 
        description: '不正なパスワードでのログイン',
        priority: 'high',
        automatable: true
      }
    ];
    
    const testPointsPath = await outputManager.writeTestPoints(session.sessionId, testPoints);
    console.log(`✅ テスト観点保存完了: ${testPointsPath}\n`);
    
    // テストケースを保存
    console.log('📋 テストケース保存中...');
    const testCase = {
      id: 'TC001',
      title: 'ログイン機能のテスト',
      description: 'ユーザーが正しい認証情報でログインできることを確認',
      steps: [
        { description: 'ログインページにアクセス' },
        { description: 'ユーザー名を入力' },
        { description: 'パスワードを入力' },
        { description: 'ログインボタンをクリック' }
      ],
      expectedResults: [
        'ダッシュボードページに遷移する',
        'ユーザー名が表示される'
      ],
      testPointIds: ['TP001']
    };
    
    const testCasePath = await outputManager.writeTestCase(session.sessionId, testCase);
    console.log(`✅ テストケース保存完了: ${testCasePath}\n`);
    
    // Playwrightスクリプトを保存
    console.log('🎬 Playwrightスクリプト保存中...');
    const script = {
      id: 'script_001',
      testCaseId: 'TC001',
      filename: 'login_test',
      content: `const { test, expect } = require('@playwright/test');

test('ログイン機能テスト', async ({ page }) => {
  await page.goto('https://example.com/login');
  await page.fill('[name="username"]', 'testuser');
  await page.fill('[name="password"]', 'password123');
  await page.click('button[type="submit"]');
  
  await expect(page).toHaveURL(/dashboard/);
  await expect(page.locator('.username')).toBeVisible();
});`
    };
    
    const scriptPath = await outputManager.writeScript(session.sessionId, script);
    console.log(`✅ スクリプト保存完了: ${scriptPath}\n`);
    
    // DOMスナップショットを保存
    console.log('📸 DOMスナップショット保存中...');
    const snapshot = {
      testId: 'TC001',
      stepNumber: 1,
      url: 'https://example.com/login',
      html: `<!DOCTYPE html>
<html>
<head><title>ログインページ</title></head>
<body>
  <form>
    <input name="username" placeholder="ユーザー名">
    <input name="password" type="password" placeholder="パスワード">
    <button type="submit">ログイン</button>
  </form>
</body>
</html>`,
      timestamp: new Date()
    };
    
    const snapshotPath = await outputManager.writeDOMSnapshot(session.sessionId, snapshot);
    console.log(`✅ DOMスナップショット保存完了: ${snapshotPath}\n`);
    
    // テスト実行結果を保存
    console.log('📊 テスト実行結果保存中...');
    const testResult = {
      testId: 'TC001',
      status: 'passed',
      duration: 2543,
      startTime: new Date(Date.now() - 3000),
      endTime: new Date(),
      screenshots: [],
      logs: [
        {
          timestamp: new Date(),
          level: 'info',
          message: 'テスト実行開始'
        },
        {
          timestamp: new Date(),
          level: 'info',
          message: 'ログイン成功'
        }
      ]
    };
    
    await outputManager.saveTestResult(session.sessionId, testResult);
    console.log('✅ テスト実行結果保存完了\n');
    
    // ログエントリを保存
    console.log('📝 ログエントリ保存中...');
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: 'info',
      message: 'テストセッション正常完了'
    };
    
    await outputManager.saveLog(session.sessionId, logEntry);
    console.log('✅ ログエントリ保存完了\n');
    
    // セッション終了
    console.log('🏁 セッション終了中...');
    const summary = await outputManager.endSession(session.sessionId);
    console.log('✅ セッション終了完了\n');
    
    // 結果表示
    console.log('📋 セッションサマリ:');
    console.log(`  セッションID: ${summary.sessionId}`);
    console.log(`  開始時刻: ${summary.startTime}`);
    console.log(`  終了時刻: ${summary.endTime}`);
    console.log(`  実行時間: ${summary.duration}ms`);
    console.log(`  ステータス: ${summary.status}`);
    console.log(`  ベースパス: ${summary.basePath}\n`);
    
    console.log('🎉 OutputManagerデモ完了！');
    console.log(`📂 生成されたファイルは以下のディレクトリに保存されました:`);
    console.log(`   ${summary.basePath}`);
    
  } catch (error) {
    console.error('❌ デモ実行エラー:', error.message);
    console.error(error.stack);
  }
}

// メイン実行
if (require.main === module) {
  demoOutputManager().catch(console.error);
}

module.exports = { demoOutputManager }; 