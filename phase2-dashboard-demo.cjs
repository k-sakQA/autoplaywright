#!/usr/bin/env node

/**
 * Phase 2: 統合ダッシュボード機能デモ
 * 現在のAutoPlaywrightのテスト結果から統合ダッシュボードを生成
 */

const fs = require('fs').promises;
const path = require('path');
const OutputManager = require('./src/output-manager/index.cjs');

async function demonstratePhase2Dashboard() {
  console.log('🚀 Phase 2 統合ダッシュボードデモ開始');
  console.log('='.repeat(60));

  try {
    // 1. OutputManagerを初期化（Phase 2対応）
    const outputManager = new OutputManager({
      baseDir: 'test-results',
      compressionEnabled: true
    });

    console.log('✅ OutputManager (Phase 2) 初期化完了');

    // 2. 現在の既存セッションを確認
    console.log('\n📋 既存セッション確認中...');
    const availableSessions = await outputManager.getAvailableSessions();
    
    console.log(`🔍 発見されたセッション数: ${availableSessions.length}`);
    if (availableSessions.length > 0) {
      console.log('📊 最新のセッション:');
      availableSessions.slice(0, 3).forEach((session, index) => {
        console.log(`   ${index + 1}. ${session.sessionId} - ${session.status || 'unknown'}`);
      });
    }

    // 3. デモセッションを作成（既存セッションが少ない場合）
    if (availableSessions.length < 3) {
      console.log('\n🧪 デモ用のセッションデータを作成中...');
      await createDemoSessions(outputManager);
    }

    // 4. 統合ダッシュボードを生成
    console.log('\n📊 統合ダッシュボード生成中...');
    const dashboardPath = await outputManager.generateDashboard({
      includeSessions: 10,
      includeArchived: false,
      theme: 'modern'
    });

    console.log(`✅ 統合ダッシュボード生成完了!`);
    console.log(`📂 ファイルパス: ${dashboardPath}`);

    // 5. トレンドレポートを生成
    console.log('\n📈 トレンドレポート生成中...');
    const trendPath = await outputManager.generateTrendReport({
      period: 30,
      metric: 'success_rate'
    });

    console.log(`✅ トレンドレポート生成完了!`);
    console.log(`📂 ファイルパス: ${trendPath}`);

    // 6. 利用可能なセッションで比較レポート生成
    if (availableSessions.length >= 2) {
      console.log('\n🔄 セッション比較レポート生成中...');
      const sessionIds = availableSessions.slice(0, 2).map(s => s.sessionId);
      const comparisonPath = await outputManager.generateComparisonReport(sessionIds);
      
      console.log(`✅ セッション比較レポート生成完了!`);
      console.log(`📂 ファイルパス: ${comparisonPath}`);
    }

    // 7. 結果ディレクトリの構造を表示
    console.log('\n📁 生成されたレポート構造:');
    await displayReportsStructure();

    console.log('\n🎉 Phase 2 統合ダッシュボードデモ完了!');
    console.log('🌐 ブラウザでHTMLファイルを開いて結果を確認してください。');

  } catch (error) {
    console.error(`❌ デモ実行エラー: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

/**
 * デモ用のセッションデータを作成
 */
async function createDemoSessions(outputManager) {
  const demoData = [
    {
      testResults: [
        { name: 'ログインテスト', status: 'success', duration: 1500 },
        { name: '予約フォーム入力', status: 'success', duration: 2300 },
        { name: '確認画面チェック', status: 'failed', duration: 1800 }
      ],
      targetUrl: 'https://hotel-example-site.takeyaqa.dev/ja/reserve.html',
      userStory: '宿泊予約機能テスト'
    },
    {
      testResults: [
        { name: 'ページ読み込み', status: 'success', duration: 1200 },
        { name: 'ナビゲーション', status: 'success', duration: 900 },
        { name: 'フォーム操作', status: 'success', duration: 2100 }
      ],
      targetUrl: 'https://example.com/checkout',
      userStory: 'チェックアウト機能テスト'
    },
    {
      testResults: [
        { name: 'ユーザー登録', status: 'success', duration: 1800 },
        { name: 'メール認証', status: 'failed', duration: 3000 },
        { name: 'プロフィール設定', status: 'success', duration: 1600 }
      ],
      targetUrl: 'https://example.com/signup',
      userStory: 'ユーザー登録機能テスト'
    }
  ];

  for (let i = 0; i < demoData.length; i++) {
    // 少し時間をずらしてセッションを作成
    await new Promise(resolve => setTimeout(resolve, 1100));
    
    const session = await outputManager.startSession();
    const data = demoData[i];
    
    // テストデータを書き込み
    await outputManager.writeTestCase(session.sessionId, `demo-test-case-${i + 1}`, {
      name: data.userStory,
      targetUrl: data.targetUrl,
      steps: data.testResults.map(test => ({
        action: 'test',
        target: test.name,
        expected: test.status === 'success' ? 'テスト成功' : 'テスト失敗'
      }))
    });

    // セッションメタデータに結果を追加
    const metadataPath = outputManager.directoryManager.resolveMetadataPath(session.sessionId, 'summary.json');
    const metadata = JSON.parse(await outputManager.fileWriter.readFile(metadataPath));
    metadata.testResults = data.testResults;
    metadata.targetUrl = data.targetUrl;
    metadata.userStory = data.userStory;
    
    await outputManager.fileWriter.writeJSON(metadataPath, metadata);
    
    // セッション終了
    await outputManager.endSession(session.sessionId);
    
    console.log(`   ✅ デモセッション ${i + 1} 作成完了: ${session.sessionId}`);
  }
}

/**
 * レポート構造を表示
 */
async function displayReportsStructure() {
  try {
    const reportsDir = path.join('test-results', 'reports');
    const files = await fs.readdir(reportsDir);
    
    const reports = files.filter(file => file.endsWith('.html'));
    reports.forEach(report => {
      console.log(`   📄 ${report}`);
    });
    
    if (reports.length === 0) {
      console.log('   📄 レポートファイルが見つかりませんでした');
    }
    
  } catch (error) {
    console.log('   ⚠️ レポートディレクトリが見つかりません');
  }
}

// デモ実行
if (require.main === module) {
  demonstratePhase2Dashboard();
} 