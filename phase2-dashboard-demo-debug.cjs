#!/usr/bin/env node

/**
 * Phase 2: 統合ダッシュボード機能デモ（デバッグ版）
 */

const fs = require('fs').promises;
const path = require('path');
const OutputManager = require('./src/output-manager/index.cjs');

async function demonstratePhase2Dashboard() {
  console.log('🚀 Phase 2 統合ダッシュボードデモ開始 (デバッグ版)');
  console.log('='.repeat(60));

  try {
    // 1. OutputManagerを初期化（Phase 2対応）
    console.log('🔧 OutputManager初期化中...');
    const outputManager = new OutputManager({
      baseDir: 'test-results',
      compressionEnabled: true
    });

    // デバッグ情報を出力
    console.log('🔍 デバッグ情報:');
    console.log(`   - config: ${JSON.stringify(outputManager.config, null, 2)}`);
    console.log(`   - directoryManager.baseDir: ${outputManager.directoryManager.baseDir}`);
    console.log(`   - directoryManager type: ${typeof outputManager.directoryManager.baseDir}`);

    console.log('✅ OutputManager (Phase 2) 初期化完了');

    // 2. 手動でrunsディレクトリの確認
    console.log('\n📋 手動でrunsディレクトリ確認...');
    const runsDir = path.join(outputManager.directoryManager.baseDir, 'runs');
    console.log(`   - runsDir path: ${runsDir}`);
    
    try {
      const exists = await fs.access(runsDir);
      console.log(`   - runsDir exists: true`);
      const files = await fs.readdir(runsDir);
      console.log(`   - runsDir contents: ${files.length} items`);
    } catch (error) {
      console.log(`   - runsDir exists: false (${error.message})`);
    }

    // 3. OutputManagerのメソッド実行
    console.log('\n📋 OutputManager.getAvailableSessions()実行...');
    const availableSessions = await outputManager.getAvailableSessions();
    
    console.log(`🔍 発見されたセッション数: ${availableSessions.length}`);

    console.log('\n✅ デバッグ完了!');

  } catch (error) {
    console.error(`❌ デモ実行エラー: ${error.message}`);
    console.error('スタックトレース:', error.stack);
    process.exit(1);
  }
}

// デモ実行
if (require.main === module) {
  demonstratePhase2Dashboard();
} 