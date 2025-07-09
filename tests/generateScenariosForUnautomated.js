// tests/generateScenariosForUnautomated.js
// 未自動化テストケース専用のPlaywrightルート生成

import 'dotenv/config';
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { exec } from 'child_process';
import util from 'util';
const execAsync = util.promisify(exec);

/**
 * 最新のテストカバレッジデータを取得
 */
function getLatestCoverageData() {
  const resultsDir = path.resolve(__dirname, '../test-results');
  
  // TestCoverage_*.jsonファイルを探す
  const coverageFiles = fs.readdirSync(resultsDir)
    .filter(f => f.startsWith('TestCoverage_') && f.endsWith('.json'))
    .sort();
  
  if (coverageFiles.length === 0) {
    throw new Error('テストカバレッジデータが見つかりません');
  }
  
  const latestFile = coverageFiles[coverageFiles.length - 1];
  const coveragePath = path.join(resultsDir, latestFile);
  
  console.log(`📊 最新カバレッジデータ使用: ${latestFile}`);
  return JSON.parse(fs.readFileSync(coveragePath, 'utf-8'));
}

/**
 * 最新の自然言語テストケースファイルを取得
 */
function getLatestNaturalLanguageTestCases() {
  const resultsDir = path.resolve(__dirname, '../test-results');
  
  // naturalLanguageTestCases_*.jsonファイルを探す
  const naturalFiles = fs.readdirSync(resultsDir)
    .filter(f => f.startsWith('naturalLanguageTestCases_') && f.endsWith('.json'))
    .sort();
  
  if (naturalFiles.length === 0) {
    throw new Error('自然言語テストケースファイルが見つかりません');
  }
  
  const latestFile = naturalFiles[naturalFiles.length - 1];
  const naturalPath = path.join(resultsDir, latestFile);
  
  console.log(`📝 最新自然言語テストケース使用: ${latestFile}`);
  return naturalPath;
}

/**
 * テストURLを取得
 */
function getTestUrl(coverageData) {
  // カバレッジデータからURLを取得を試みる
  if (coverageData.detailed_test_cases && coverageData.detailed_test_cases.length > 0) {
    const testCase = coverageData.detailed_test_cases[0];
    if (testCase.url) {
      console.log(`🔗 テストURL取得: ${testCase.url}`);
      return testCase.url;
    }
  }
  
  // config.jsonからの取得を試みる
  try {
    const configPath = path.resolve(__dirname, "../config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (config.targetUrl) {
      console.log(`🔗 config.jsonからURL取得: ${config.targetUrl}`);
      return config.targetUrl;
    }
  } catch (error) {
    console.log('⚠️ config.jsonからURLを取得できませんでした');
  }
  
  throw new Error('テスト対象URLが見つかりません');
}

/**
 * 未自動化ケースの統計情報
 */
function getUnautomatedCasesInfo(coverageData) {
  const unautomatedCases = coverageData.detailed_test_cases?.filter(tc => tc.status === 'not_automated') || [];
  const totalCases = coverageData.detailed_test_cases?.length || 0;
  
  console.log(`📊 未自動化ケース分析:`);
  console.log(`   - 未自動化: ${unautomatedCases.length}件`);
  console.log(`   - 全体: ${totalCases}件`);
  console.log(`   - 未自動化率: ${totalCases > 0 ? (unautomatedCases.length / totalCases * 100).toFixed(1) : 0}%`);
  
  return {
    unautomatedCases,
    totalCases,
    unautomatedCount: unautomatedCases.length
  };
}

/**
 * generateSmartScenarios.jsを実行
 */
async function runGenerateSmartScenarios(testCasesFile) {
    const generateSmartScenariosPath = path.join(__dirname, 'generateSmartScenarios.js');
    
  // コマンドを構築
  const command = `node "${generateSmartScenariosPath}" --test-cases "${testCasesFile}" --goal "未自動化テストケースのPlaywright自動化"`;
  
  console.log(`🚀 Playwrightルート生成実行中...`);
  console.log(`   コマンド: ${command}`);
  
  try {
    const { stdout, stderr } = await execAsync(command);
    
    if (stderr) {
      console.error('⚠️ 警告出力:', stderr);
    }
    
    console.log('✅ generateSmartScenarios.js実行完了');
    console.log(stdout);
    
    return { success: true, output: stdout };
  } catch (error) {
    console.error('❌ generateSmartScenarios.js実行エラー:', error.message);
    if (error.stdout) console.log('標準出力:', error.stdout);
    if (error.stderr) console.error('エラー出力:', error.stderr);
    
    return { success: false, error: error.message };
  }
}

// メイン処理
(async () => {
  try {
    console.log('🔧 未自動化ケース用Playwrightルート生成開始');
    console.log('');
    
    // 1. 最新のカバレッジデータを取得
    const coverageData = getLatestCoverageData();
    
    // 2. 未自動化ケースの分析
    const unautomatedInfo = getUnautomatedCasesInfo(coverageData);
    
    if (unautomatedInfo.unautomatedCount === 0) {
      console.log('✅ 未自動化ケースがありません。すべてのテストケースが自動化済みです！');
      process.exit(0);
    }
    
    // 3. 必要なファイルとURLを取得
    const testUrl = getTestUrl(coverageData);
    const naturalTestCasesPath = getLatestNaturalLanguageTestCases();
    
    console.log('');
    console.log('📋 実行情報:');
    console.log(`   - 対象URL: ${testUrl}`);
    console.log(`   - 自然言語ケース: ${path.basename(naturalTestCasesPath)}`);
    console.log(`   - 未自動化ケース数: ${unautomatedInfo.unautomatedCount}件`);
    console.log('');
    
    // 4. generateSmartScenarios.jsを実行
    const result = await runGenerateSmartScenarios(naturalTestCasesPath);
    
    if (result.success) {
      console.log('');
      console.log('🎉 未自動化ケース用Playwrightルート生成完了！');
      console.log('');
      console.log('💡 次のステップ:');
      console.log('   1. 生成されたroute_*.jsonファイルを確認');
      console.log('   2. runScenarios.jsで新しいシナリオを実行');
      console.log('   3. テストレポートを更新してカバレッジを確認');
      console.log('');
      console.log('🔄 レポート更新コマンド:');
      console.log('   node tests/generateTestReport.js');
    } else {
      console.error('');
      console.error('❌ Playwrightルート生成に失敗しました');
      console.error('');
      console.error('🔧 トラブルシューティング:');
      console.error('   1. config.jsonでOpenAI APIキーが設定されているか確認');
      console.error('   2. ネットワーク接続を確認');
      console.error('   3. 上記のエラーメッセージを確認');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('');
    console.error('❌ 未自動化ケース用ルート生成でエラーが発生しました:', error.message);
    console.error('');
    process.exit(1);
  }
})(); 