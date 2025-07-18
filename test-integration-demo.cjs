#!/usr/bin/env node

/**
 * 統合システムテストデモ
 * runScenarios.jsと新しいOutputManagerの統合動作を確認
 */

const fs = require('fs').promises;
const path = require('path');

// runScenarios.jsでテスト実行をシミュレート
async function testIntegration() {
  console.log('🧪 統合システムテストデモ開始');
  console.log('='.repeat(60));
  
  try {
    // 1. 簡単なテストルートを作成
    const testRoute = {
      "route_id": "integration_test_001",
      "timestamp": new Date().toISOString(),
      "target_url": "https://example.com",
      "steps": [
        {
          "label": "ページを読み込む",
          "action": "load",
          "target": "https://example.com"
        },
        {
          "label": "タイトルを確認",
          "action": "assertVisible",
          "target": "h1"
        },
        {
          "label": "スクリーンショットを撮る",
          "action": "screenshot",
          "target": "full-page"
        }
      ]
    };
    
    // テストルートファイルを作成
    const testResultsDir = path.join(process.cwd(), 'test-results');
    await fs.mkdir(testResultsDir, { recursive: true });
    
    const routeFilePath = path.join(testResultsDir, 'route_integration_test.json');
    await fs.writeFile(routeFilePath, JSON.stringify(testRoute, null, 2));
    
    console.log('✅ テストルートファイル作成完了');
    console.log(`📁 ルートファイル: ${routeFilePath}`);
    
    // 2. config.jsonにユーザーストーリー情報を設定
    const configPath = path.join(process.cwd(), 'config.json');
    
    let config = {};
    try {
      const configContent = await fs.readFile(configPath, 'utf8');
      config = JSON.parse(configContent);
    } catch (error) {
      console.log('⚠️ 既存のconfig.jsonが見つかりません。新規作成します。');
    }
    
    // 統合テスト用の設定を追加
    config.userStory = {
      currentId: 999,
      title: "統合システムテスト",
      description: "OutputManagerとrunScenarios.jsの統合テスト"
    };
    
    config.targetUrl = "https://example.com";
    
    // OpenAI設定がない場合はダミーを設定
    if (!config.openai) {
      config.openai = {
        apiKeyEnv: "OPENAI_API_KEY",
        model: "gpt-4",
        temperature: 0.3
      };
    }
    
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    console.log('✅ 統合テスト用config.json設定完了');
    console.log(`📋 ユーザーストーリーID: USIS-${config.userStory.currentId}`);
    
    console.log('\n🚀 統合テスト実行準備完了！');
    console.log('📝 次のコマンドで統合システムをテストできます:');
    console.log(`   node tests/runScenarios.js --route-file route_integration_test.json --headed`);
    
    console.log('\n🔍 期待される結果:');
    console.log('1. 🆕 新形式: test-results/runs/{timestamp}/ 配下にファイル生成');
    console.log('2. 🔄 USIS形式: test-results/USIS-999/ 配下にファイル生成');
    console.log('3. 📊 統合ログ: 両方の形式でテスト結果が保存される');
    
    // 3. テスト実行前の状態確認
    console.log('\n📂 テスト実行前のディレクトリ状況:');
    
    try {
      const testResultsContents = await fs.readdir(testResultsDir);
      console.log('📁 test-results/:');
      testResultsContents.forEach(item => {
        console.log(`   - ${item}`);
      });
    } catch (error) {
      console.log('📁 test-results/: (ディレクトリなし)');
    }
    
    // グローバル設定ディレクトリの確認
    const globalConfigDir = path.join(process.cwd(), '.autoplaywright');
    try {
      await fs.access(globalConfigDir);
      const globalContents = await fs.readdir(globalConfigDir);
      console.log('📁 .autoplaywright/:');
      globalContents.forEach(item => {
        console.log(`   - ${item}`);
      });
    } catch (error) {
      console.log('📁 .autoplaywright/: (ディレクトリなし)');
    }
    
    console.log('\n='.repeat(60));
    console.log('🎉 統合システムテストデモ準備完了！');
    
  } catch (error) {
    console.error('❌ 統合システムテストデモエラー:', error.message);
    process.exit(1);
  }
}

// デモ実行
if (require.main === module) {
  testIntegration().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { testIntegration }; 