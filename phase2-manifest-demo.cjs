#!/usr/bin/env node

/**
 * Phase 2: ファイルマニフェスト機能デモ
 */

const OutputManager = require('./src/output-manager/index.cjs');

async function demonstratePhase2Manifest() {
  console.log('🚀 Phase 2 ファイルマニフェスト機能デモ開始');
  console.log('='.repeat(60));

  try {
    // 1. OutputManagerを初期化
    const outputManager = new OutputManager({
      baseDir: 'test-results',
      compressionEnabled: false
    });

    console.log('✅ OutputManager (Phase 2) 初期化完了');

    // 2. グローバルマニフェスト生成
    console.log('\n📋 グローバルファイルマニフェスト生成中...');
    const globalManifest = await outputManager.generateGlobalManifest();
    
    console.log(`📊 マニフェスト統計:`);
    console.log(`   - セッション数: ${globalManifest.sessionCount}`);
    console.log(`   - 総ファイル数: ${globalManifest.totalFiles}`);
    console.log(`   - 総サイズ: ${(globalManifest.totalSize / 1024).toFixed(2)} KB`);

    // 3. ファイル検索テスト
    console.log('\n🔍 ファイル検索テスト...');
    
    // HTMLファイルを検索
    const htmlFiles = await outputManager.searchFiles({
      extension: '.html',
      limit: 5
    });
    console.log(`📄 HTMLファイル検索結果: ${htmlFiles.length}件`);
    htmlFiles.forEach((file, index) => {
      console.log(`   ${index + 1}. ${file.name} (${file.formattedSize}) - ${file.sessionId}`);
    });

    // JSONファイルを検索
    const jsonFiles = await outputManager.searchFiles({
      extension: '.json',
      limit: 3
    });
    console.log(`📄 JSONファイル検索結果: ${jsonFiles.length}件`);
    jsonFiles.forEach((file, index) => {
      console.log(`   ${index + 1}. ${file.name} (${file.formattedSize}) - ${file.sessionId}`);
    });

    // 4. ファイル統計レポート生成
    console.log('\n📊 ファイル統計レポート生成中...');
    const statistics = await outputManager.generateFileStatistics();
    
    console.log(`📈 統計サマリー:`);
    console.log(`   - 総セッション数: ${statistics.overview.totalSessions}`);
    console.log(`   - 総ファイル数: ${statistics.overview.totalFiles}`);
    console.log(`   - 総サイズ: ${statistics.overview.formattedSize}`);

    // 5. 重複ファイル検出
    console.log('\n🔍 重複ファイル検出中...');
    const duplicates = await outputManager.findDuplicateFiles();
    
    console.log(`🔄 重複ファイル: ${duplicates.length}グループ`);
    duplicates.slice(0, 3).forEach((duplicate, index) => {
      console.log(`   ${index + 1}. ${duplicate.fileName} - ${duplicate.count}件のコピー`);
    });

    console.log('\n🎉 Phase 2 ファイルマニフェスト機能デモ完了!');
    console.log('📁 詳細なレポートは test-results/reports/ で確認できます。');

  } catch (error) {
    console.error(`❌ デモ実行エラー: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

// デモ実行
if (require.main === module) {
  demonstratePhase2Manifest();
} 