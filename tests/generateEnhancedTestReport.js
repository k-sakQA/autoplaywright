#!/usr/bin/env node

/**
 * AutoPlaywright 拡張テストレポート生成スクリプト
 * 
 * 機能:
 * - テスト観点と機能の自動マッピング
 * - 成功/失敗ステップの詳細分析
 * - AI駆動の不具合リスク分析
 * - インタラクティブHTMLレポート生成
 * 
 * 使用例:
 * node tests/generateEnhancedTestReport.js
 * node tests/generateEnhancedTestReport.js --route route_xxx.json --result result_xxx.json
 * node tests/generateEnhancedTestReport.js --enable-ai --enable-mapping
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TestReportIntegrator } from './utils/testReportIntegrator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// コマンドライン引数解析
function parseArguments() {
  const args = process.argv.slice(2);
  const options = {
    routeFile: null,
    resultFile: null,
    enableAI: true,
    enableMapping: true,
    enableEnhancedReporting: true,
    outputDir: path.join(process.cwd(), 'test-results'),
    help: false
  };
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--route':
        options.routeFile = args[++i];
        break;
      case '--result':
        options.resultFile = args[++i];
        break;
      case '--output-dir':
        options.outputDir = args[++i];
        break;
      case '--enable-ai':
        options.enableAI = true;
        break;
      case '--disable-ai':
        options.enableAI = false;
        break;
      case '--enable-mapping':
        options.enableMapping = true;
        break;
      case '--disable-mapping':
        options.enableMapping = false;
        break;
      case '--enable-enhanced':
        options.enableEnhancedReporting = true;
        break;
      case '--disable-enhanced':
        options.enableEnhancedReporting = false;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
    }
  }
  
  return options;
}

// ヘルプ表示
function showHelp() {
  console.log(`
🤖 AutoPlaywright 拡張テストレポート生成

使用方法:
  node tests/generateEnhancedTestReport.js [オプション]

オプション:
  --route <file>           特定のルートファイルを指定
  --result <file>          特定の結果ファイルを指定
  --output-dir <dir>       出力ディレクトリを指定 (デフォルト: test-results)
  --enable-ai              AI分析を有効化 (デフォルト)
  --disable-ai             AI分析を無効化
  --enable-mapping         テスト観点マッピングを有効化 (デフォルト)
  --disable-mapping        テスト観点マッピングを無効化
  --enable-enhanced        拡張HTMLレポートを有効化 (デフォルト)
  --disable-enhanced       拡張HTMLレポートを無効化
  --help, -h               このヘルプを表示

例:
  # 最新のテスト結果で拡張レポートを生成
  node tests/generateEnhancedTestReport.js

  # AI分析を無効化して高速生成
  node tests/generateEnhancedTestReport.js --disable-ai

  # 特定のファイルを指定
  node tests/generateEnhancedTestReport.js --route route_xxx.json --result result_xxx.json

機能:
  📊 テスト観点-機能マッピング: テスト観点と実行機能の自動関連付け
  🤖 AI不具合分析: 潜在的不具合の予測と対策提案
  📈 詳細ステップ分析: 成功/失敗ステップの明確化
  🎨 インタラクティブレポート: 美しいHTMLレポート生成
  `);
}

// ファイル読み込み
async function readJsonFile(filePath) {
  try {
    const content = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`❌ ファイル読み込みエラー ${filePath}:`, error.message);
    return null;
  }
}

// 最新ファイル検索
function findLatestFile(directory, prefix) {
  try {
    const files = fs.readdirSync(directory);
    const targetFiles = files
      .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
      .sort()
      .reverse();
    
    return targetFiles.length > 0 ? targetFiles[0] : null;
  } catch (error) {
    console.error(`❌ ディレクトリ読み込みエラー ${directory}:`, error.message);
    return null;
  }
}

// config.jsonからユーザーストーリー情報取得
async function getUserStoryInfo() {
  try {
    const configPath = path.join(process.cwd(), 'config.json');
    if (!fs.existsSync(configPath)) {
      return null;
    }
    
    const config = JSON.parse(await fs.promises.readFile(configPath, 'utf8'));
    return config.userStory || null;
  } catch (error) {
    console.warn('⚠️ ユーザーストーリー情報取得失敗:', error.message);
    return null;
  }
}

// メイン処理
async function main() {
  console.log('🚀 AutoPlaywright 拡張テストレポート生成開始');
  console.log('=' .repeat(60));
  
  const options = parseArguments();
  
  if (options.help) {
    showHelp();
    return;
  }
  
  const testResultsDir = options.outputDir;
  
  // 出力ディレクトリの確認
  if (!fs.existsSync(testResultsDir)) {
    console.error(`❌ 出力ディレクトリが見つかりません: ${testResultsDir}`);
    process.exit(1);
  }
  
  // ファイル特定
  let routeFile = options.routeFile;
  let resultFile = options.resultFile;
  
  if (!routeFile) {
    routeFile = findLatestFile(testResultsDir, 'route_');
    if (!routeFile) {
      console.error('❌ ルートファイルが見つかりません');
      process.exit(1);
    }
    console.log(`📁 最新ルートファイル: ${routeFile}`);
  }
  
  if (!resultFile) {
    resultFile = findLatestFile(testResultsDir, 'result_');
    if (!resultFile) {
      console.error('❌ 結果ファイルが見つかりません');
      process.exit(1);
    }
    console.log(`📁 最新結果ファイル: ${resultFile}`);
  }
  
  // ファイル読み込み
  const route = await readJsonFile(path.join(testResultsDir, routeFile));
  const result = await readJsonFile(path.join(testResultsDir, resultFile));
  
  if (!route || !result) {
    console.error('❌ 必要なファイルの読み込みに失敗しました');
    process.exit(1);
  }
  
  // テスト観点ファイル検索
  let testPoints = [];
  const testPointFiles = [
    'naturalLanguageTestCases_',
    'testPoints_'
  ];
  
  for (const prefix of testPointFiles) {
    const testPointFile = findLatestFile(testResultsDir, prefix);
    if (testPointFile) {
      const points = await readJsonFile(path.join(testResultsDir, testPointFile));
      if (points && Array.isArray(points)) {
        testPoints = points;
        console.log(`📋 テスト観点読み込み: ${testPointFile} (${points.length}件)`);
        break;
      }
    }
  }
  
  if (testPoints.length === 0) {
    console.log('⚠️ テスト観点ファイルが見つかりません。基本分析モードで実行します。');
  }
  
  // ユーザーストーリー情報取得
  const userStoryInfo = await getUserStoryInfo();
  if (userStoryInfo) {
    console.log(`📖 ユーザーストーリー: ID ${userStoryInfo.currentId}`);
  }
  
  // 拡張レポート生成
  console.log('\n🔧 拡張レポート統合システム初期化中...');
  
  const integrator = new TestReportIntegrator({
    enableMapping: options.enableMapping,
    enableAIAnalysis: options.enableAI,
    enableEnhancedReporting: options.enableEnhancedReporting,
    outputDir: testResultsDir
  });
  
  // コンポーネント初期化待機
  await integrator.initializeComponents();
  
  // ステータス確認
  const status = integrator.getStatus();
  console.log('\n📊 システムステータス:');
  console.log(`  テスト観点マッピング: ${status.components.testPointMapper ? '✅ 有効' : '❌ 無効'}`);
  console.log(`  AI分析: ${status.components.aiAnalyzer ? '✅ 有効' : '❌ 無効'}`);
  console.log(`  拡張レポート: ${status.components.reportGenerator ? '✅ 有効' : '❌ 無効'}`);
  
  console.log('\n🚀 拡張テストレポート生成中...');
  
  try {
    const reportResult = await integrator.createEnhancedTestReport(
      testPoints,
      route,
      result,
      userStoryInfo
    );
    
    if (reportResult.success) {
      console.log('\n🎉 拡張テストレポート生成完了！');
      console.log('=' .repeat(60));
      
      // 生成されたファイル一覧
      if (reportResult.files.csv) {
        console.log(`📊 CSVレポート: ${reportResult.files.csv.filename}`);
      }
      
      if (reportResult.files.html) {
        console.log(`🎨 HTMLレポート: ${reportResult.files.html.filename}`);
      }
      
      // 統計情報表示
      if (reportResult.metadata) {
        const meta = reportResult.metadata;
        console.log('\n📈 実行統計:');
        console.log(`  総ステップ数: ${meta.testSummary.totalSteps}`);
        console.log(`  成功率: ${meta.testSummary.successRate}%`);
        console.log(`  成功ステップ: ${meta.testSummary.successfulSteps}`);
        console.log(`  失敗ステップ: ${meta.testSummary.failedSteps}`);
      }
      
      if (reportResult.mappingStats) {
        console.log('\n🎯 マッピング統計:');
        console.log(`  総マッピング数: ${reportResult.mappingStats.totalMappings || 0}`);
        console.log(`  平均信頼度: ${((reportResult.mappingStats.averageConfidence || 0) * 100).toFixed(1)}%`);
      }
      
      console.log('\n📁 ファイル保存場所:', testResultsDir);
      
      if (reportResult.files.html) {
        console.log(`\n🌐 HTMLレポートを確認するには:`);
        console.log(`   ブラウザで ${reportResult.files.html.path} を開いてください`);
      }
      
    } else {
      console.error('\n❌ 拡張レポート生成失敗');
      console.error('エラー:', reportResult.error);
      console.log(reportResult.fallbackMessage);
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n❌ 予期しないエラーが発生しました:', error);
    console.error('スタックトレース:', error.stack);
    process.exit(1);
  }
}

// エラーハンドリング
process.on('uncaughtException', (error) => {
  console.error('❌ 未捕捉例外:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ 未処理Promise拒否:', reason);
  process.exit(1);
});

// メイン実行
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
} 