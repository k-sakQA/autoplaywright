// tests/runRoutes.js

import 'dotenv/config';
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { chromium } from 'playwright';
import { z } from "zod";
import playwrightConfig from '../playwright.config.js';
import GoogleSheetsUploader from './utils/googleSheetsUploader.js';

// configのスキーマ定義
const ConfigSchema = z.object({
  openai: z.object({
    apiKeyEnv: z.string(),
    model: z.string(),
    temperature: z.number().min(0).max(2),
    max_tokens: z.number().optional(),
    top_p: z.number().min(0).max(1).optional(),
    timeout: z.number().optional(),
    maxRetries: z.number().optional(),
  }),
  targetUrl: z.string().url(),
});

// config.json をロード
const loadConfig = () => {
  try {
    const configPath = path.resolve(__dirname, "../config.json");
    const rawConfig = fs.readFileSync(configPath, "utf-8");
    const parsedConfig = JSON.parse(rawConfig);
    return ConfigSchema.parse(parsedConfig);
  } catch (error) {
    if (error instanceof Error) {
      console.error("Failed to load config:", error.message);
    }
    process.exit(1);
  }
};

// OpenAI クライアントの設定
const getOpenAIConfig = (config) => {
  const apiKey = process.env[config.openai.apiKeyEnv];
  if (!apiKey) {
    console.error("ERROR: OpenAI API key not set in", config.openai.apiKeyEnv);
    process.exit(1);
  }

  const openAIConfig = {
    apiKey,
    model: config.openai.model,
    temperature: config.openai.temperature,
  };

  // オプション設定を追加
  if (config.openai.max_tokens) openAIConfig.max_tokens = config.openai.max_tokens;
  if (config.openai.top_p) openAIConfig.top_p = config.openai.top_p;
  if (config.openai.timeout) openAIConfig.timeout = config.openai.timeout;
  if (config.openai.maxRetries) openAIConfig.maxRetries = config.openai.maxRetries;

  return openAIConfig;
};

export const config = loadConfig();
export const openAIConfig = getOpenAIConfig(config);

// 型定義をJSDocで記述
/**
 * @typedef {Object} TestStep
 * @property {string} target
 * @property {string} action
 * @property {string} [value]
 */

export class PlaywrightRunner {
  constructor() {
    this.browser = null;
    this.page = null;
  }

  async initialize() {
    try {
      this.browser = await chromium.launch({
        headless: process.env.NODE_ENV === 'production'
      });
      this.page = await this.browser.newPage({
        baseURL: process.env.PLAYWRIGHT_BASE_URL || 'https://hotel-example-site.takeyaqa.dev'
      });
    } catch (error) {
      console.error('ブラウザの初期化に失敗しました:', error);
      throw error;
    }
  }

  async navigateToTarget() {
    if (!this.page) throw new Error('ページが初期化されていません');
    try {
      await this.page.goto(config.targetUrl);
    } catch (error) {
      console.error(`${config.targetUrl} への移動に失敗しました:`, error);
      throw error;
    }
  }

  getFullUrl(relativePath) {
    return new URL(relativePath, config.targetUrl).toString();
  }

  async executeStep(step) {
    if (!this.page) throw new Error('ページが初期化されていません');
    const targetUrl = step.target.startsWith('http') 
      ? step.target 
      : this.getFullUrl(step.target);

    try {
      switch (step.action) {
        case 'goto':
        case 'load':
          await this.page.goto(step.target, { waitUntil: 'load' });
          console.log(`✅ ページ遷移成功: ${step.target}`);
          break;
        case 'waitForSelector':
          await this.page.waitForSelector(step.target, { timeout: step.timeout || 5000 });
          console.log(`✅ 要素待機完了: ${step.target}`);
          break;
        case 'assertVisible':
          // 複数セレクタの場合は最初に見つかったものを使用
          const visibleSelectors = step.target.split(',').map(s => s.trim());
          let visibleFound = false;
          for (const selector of visibleSelectors) {
            try {
              await this.page.waitForSelector(selector, { 
                state: 'visible', 
                timeout: step.timeout || 5000 
              });
              console.log(`✅ 要素表示確認: ${selector}`);
              visibleFound = true;
              break;
            } catch (e) {
              // このセレクタでは見つからなかった、次を試す
              continue;
            }
          }
          if (!visibleFound) {
            throw new Error(`いずれの要素も見つかりませんでした: ${step.target}`);
          }
          break;
        case 'click':
          // 複数セレクタの場合は最初にクリックできたものを使用
          const clickSelectors = step.target.split(',').map(s => s.trim());
          let clickSuccess = false;
          for (const selector of clickSelectors) {
            try {
              await this.page.click(selector, { timeout: step.timeout || 5000 });
              console.log(`✅ クリック成功: ${selector}`);
              clickSuccess = true;
              break;
            } catch (e) {
              // このセレクタではクリックできなかった、次を試す
              continue;
            }
          }
          if (!clickSuccess) {
            throw new Error(`いずれの要素もクリックできませんでした: ${step.target}`);
          }
          break;
        case 'scroll_and_click':
          // スクロールしてからクリック
          const locator = this.page.locator(step.target);
          await locator.scrollIntoViewIfNeeded();
          await locator.click({ timeout: step.timeout || 5000 });
          console.log(`✅ スクロール後クリック成功: ${step.target}`);
          break;
        case 'force_click':
          // 強制クリック
          await this.page.locator(step.target).click({ force: true, timeout: step.timeout || 5000 });
          console.log(`✅ 強制クリック成功: ${step.target}`);
          break;
        case 'fill':
          // select要素の場合はselectOptionを使用
          const element = await this.page.locator(step.target).first();
          const tagName = await element.evaluate(el => el.tagName.toLowerCase());
          
          if (tagName === 'select') {
            await this.page.selectOption(step.target, step.value || '', { timeout: step.timeout || 5000 });
            console.log(`✅ 選択完了: ${step.target} = "${step.value}"`);
          } else {
            await this.page.fill(step.target, step.value || '', { timeout: step.timeout || 5000 });
            console.log(`✅ 入力完了: ${step.target} = "${step.value}"`);
          }
          break;
        case 'scroll_and_fill':
          // スクロールしてから入力
          const fillLocator = this.page.locator(step.target);
          await fillLocator.scrollIntoViewIfNeeded();
          await fillLocator.fill(step.value || '', { timeout: step.timeout || 5000 });
          console.log(`✅ スクロール後入力完了: ${step.target} = "${step.value}"`);
          break;
        case 'waitForURL':
          await this.page.waitForURL(step.target, { timeout: step.timeout || 10000 });
          console.log(`✅ URL遷移確認: ${step.target}`);
          break;
        case 'skip':
          console.log(`⏭️ ステップをスキップ: ${step.label || step.target}`);
          break;
        default:
          console.log(`⚠️ 未知のアクション: "${step.action}"`);
      }
      return true;
    } catch (error) {
      console.error(`ステップの実行に失敗しました:`, error);
      throw error;
    }
  }

  async cleanup() {
    if (this.page) {
      await this.page.close();
      this.page = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

// メイン処理
(async () => {
  const startTime = Date.now();
  let failedTests = [];
  let successTests = [];

  try {
    // コマンドライン引数の解析
    const args = process.argv.slice(2);
    let specificRouteFile = null;
    let skipDuplicateCheck = false;

    // --route-file 引数の処理
    const routeFileIndex = args.indexOf('--route-file');
    if (routeFileIndex !== -1 && args[routeFileIndex + 1]) {
      specificRouteFile = args[routeFileIndex + 1];
      console.log(`🎯 指定されたルートファイルを使用: ${specificRouteFile}`);
    }

    // --skip-duplicate-check 引数の処理
    if (args.includes('--skip-duplicate-check')) {
      skipDuplicateCheck = true;
      console.log('⚠️ 重複実行チェックをスキップします');
    }

    // 1. ルートファイルの取得
    const testResultsDir = path.resolve(__dirname, '../test-results');
    let routePath;
    let latestFile;

    if (specificRouteFile) {
      // 特定のファイルが指定された場合
      if (specificRouteFile.endsWith('.json')) {
        latestFile = specificRouteFile;
      } else {
        latestFile = `${specificRouteFile}.json`;
      }
      routePath = path.join(testResultsDir, latestFile);
      
      if (!fs.existsSync(routePath)) {
        throw new Error(`指定されたルートファイルが見つかりません: ${routePath}`);
      }
    } else {
      // 最新のrouteファイルを取得
      const files = fs.readdirSync(testResultsDir)
        .filter(f => f.startsWith('route_') && f.endsWith('.json'));
      if (files.length === 0) {
        throw new Error('route JSONファイルが見つかりません');
      }
      // yymmddhhmmssでソートして最新を選択
      files.sort();
      latestFile = files[files.length - 1];
      routePath = path.join(testResultsDir, latestFile);
    }

    console.log(`🛠️ [Debug] Using route file: ${routePath}`);

    // 2. 重複実行チェック
    if (!skipDuplicateCheck) {
      const duplicateResult = checkForDuplicateExecution(testResultsDir, latestFile);
      if (duplicateResult.isDuplicate) {
        console.log(`⚠️ 重複実行を検出しました:`);
        console.log(`  - 同じルートファイル: ${duplicateResult.routeFile}`);
        console.log(`  - 前回実行時刻: ${duplicateResult.lastExecution}`);
        console.log(`  - 前回結果: ${duplicateResult.lastResult.success_count}成功/${duplicateResult.lastResult.failed_count}失敗`);
        console.log(`  - 提案: ${duplicateResult.suggestion}`);
        
        if (duplicateResult.skipType === 'complete') {
          console.log('\n🤔 完全スキップしますか？');
          console.log('⚠️  注意: 後続テストに必要な前提条件（ログイン、データ入力等）がある場合は、');
          console.log('   スキップすると依存関係が壊れる可能性があります。');
          console.log('🔧 強制実行する場合は --skip-duplicate-check オプションを使用してください');
          console.log('🔧 失敗ステップのみ分析する場合は analyzeFailures コマンドを使用してください');
          process.exit(0);
        } else if (duplicateResult.skipType === 'partial') {
          console.log('\n💡 部分再実行モードを推奨します:');
          console.log('  1. 🔧 失敗テスト分析・修正 (analyzeFailures) を実行');
          console.log('  2. 📝 修正されたルートファイルで再テスト');
          console.log('  3. ✅ 成功ステップは前回結果を活用');
          console.log('\n🚀 継続する場合は、失敗の可能性があることを承知で実行します...');
        }
      }
    }

    // 3. ルートを読み込む
    const route = JSON.parse(fs.readFileSync(routePath, 'utf-8'));
    if (!route.steps || !Array.isArray(route.steps)) {
      throw new Error('ルートJSONにstepsが含まれていません。正しい形式のJSONを作成してください。');
    }
    console.log('🛠️ [Debug] Parsed route:', route);

    // 4. 修正されたルートかどうかを判定
    const isFixedRoute = route.original_route_id || route.fix_timestamp;
    if (isFixedRoute) {
      console.log('🔧 修正されたルートを実行します');
      console.log(`  - 元のルート: ${route.original_route_id || 'Unknown'}`);
      console.log(`  - 修正日時: ${route.fix_timestamp || 'Unknown'}`);
      if (route.fix_summary) {
        console.log(`  - 修正ステップ数: ${route.fix_summary.fixed_steps}`);
        console.log(`  - スキップステップ数: ${route.fix_summary.skipped_steps}`);
      }
    }

    // 5. Playwright 起動
    const runner = new PlaywrightRunner();
    await runner.initialize();

    console.log(`🛠️ [Debug] Running route_id: ${route.route_id || 'undefined'}`);

    // 6. 各ステップを実行
    for (const step of route.steps) {
      // スキップされたステップの処理
      if (step.action === 'skip') {
        console.log(`\n⏭️ ステップをスキップ: ${step.label}`);
        console.log(`   理由: ${step.fix_reason || 'Unknown'}`);
        continue;
      }

      const stepLabel = step.label || `${step.action} ${step.target}`;
      console.log(`\n📝 テストステップ: ${stepLabel}`);

      // 修正されたステップの場合は追加情報を表示
      if (step.fix_reason) {
        console.log(`🔧 修正済みステップ: ${step.fix_reason}`);
        if (step.original_target) {
          console.log(`   元のターゲット: ${step.original_target}`);
          console.log(`   新しいターゲット: ${step.target}`);
        }
      }

      try {
        await runner.executeStep(step);
        console.log(`✅ ステップ成功: ${stepLabel}`);
        successTests.push({
          label: stepLabel,
          action: step.action,
          target: step.target,
          timestamp: new Date().toISOString(),
          isFixed: !!step.fix_reason
        });
      } catch (err) {
        const errorMessage = err.message.split('\n')[0]; // エラーメッセージの最初の行のみを使用
        console.log(`❌ テスト失敗: ${stepLabel}\n   理由: ${errorMessage}`);
        
        // 修正されたステップが再び失敗した場合の特別処理
        if (step.fix_reason) {
          console.log(`🚨 修正されたステップが再び失敗しました！`);
          console.log(`   修正理由: ${step.fix_reason}`);
          console.log(`   → さらなる分析が必要です`);
        }
        
        failedTests.push({
          label: stepLabel,
          action: step.action,
          target: step.target,
          error: errorMessage,
          timestamp: new Date().toISOString(),
          isFixed: !!step.fix_reason,
          fixReason: step.fix_reason || null
        });
        
        // 画面遷移系のアクションが失敗した場合、後続のassertは信頼性が低いため警告
        if (step.action === 'waitForURL' || step.action === 'click' && step.expectsNavigation) {
          console.log(`⚠️  注意: 画面遷移が失敗しているため、後続のassertの結果は信頼性が低い可能性があります`);
        }
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
      is_fixed_route: isFixedRoute,
      original_route_id: route.original_route_id || null,
      fix_summary: route.fix_summary || null,
      steps: route.steps.map((step, index) => {
        const test = successTests.find(t => t.label === step.label) || 
                    failedTests.find(t => t.label === step.label);
        return {
          label: step.label,
          action: step.action,
          target: step.target,
          status: step.action === 'skip' ? 'skipped' : (test ? (test.error ? 'failed' : 'success') : 'unknown'),
          error: test?.error || null,
          isFixed: !!step.fix_reason,
          fixReason: step.fix_reason || null
        };
      })
    };

    // コンソール出力
    console.log('\n=== テスト実行結果 ===');
    console.log(`🔷 テストID: ${testResults.route_id}`);
    console.log(`🔷 総ステップ数: ${testResults.total_steps}`);
    console.log(`🔷 成功数: ${testResults.success_count}`);
    console.log(`🔷 失敗数: ${testResults.failed_count}`);

    if (isFixedRoute) {
      const fixedStepResults = testResults.steps.filter(s => s.isFixed);
      const fixedSuccessCount = fixedStepResults.filter(s => s.status === 'success').length;
      const fixedFailedCount = fixedStepResults.filter(s => s.status === 'failed').length;
      
      console.log(`\n🔧 修正ステップの結果:`);
      console.log(`  - 修正ステップ数: ${fixedStepResults.length}`);
      console.log(`  - 修正成功数: ${fixedSuccessCount}`);
      console.log(`  - 修正失敗数: ${fixedFailedCount}`);
      
      if (fixedFailedCount > 0) {
        console.log(`\n🚨 修正されたステップで再び失敗が発生しました:`);
        fixedStepResults.filter(s => s.status === 'failed').forEach(step => {
          console.log(`  - ${step.label}: ${step.error}`);
          console.log(`    修正理由: ${step.fixReason}`);
        });
        console.log(`\n💡 これらのステップには更なる分析が必要です`);
      }
    }

    if (failedTests.length > 0) {
      console.log('\n❌ 失敗したテストケース:');
      failedTests.forEach(test => {
        console.log(`  - ${test.label}: ${test.error}`);
        if (test.isFixed) {
          console.log(`    ⚠️ 修正済みステップが再失敗`);
        }
      });
    } else {
      console.log('🎉 すべてのテストが正常に完了しました');
    }

    // 結果をJSONファイルとして保存
    const timestamp = latestFile.replace('route_', '').replace('.json', '');
    const resultPath = path.join(testResultsDir, `result_${timestamp}.json`);
    fs.writeFileSync(resultPath, JSON.stringify(testResults, null, 2));
    console.log(`\n📝 テスト結果を保存しました: ${resultPath}`);

    // 実行履歴を更新
    updateExecutionHistory(testResultsDir, latestFile, testResults);

    // 修正ルートの場合、Google Sheetsに結果を追加
    if (isFixedRoute) {
      await uploadFixedRouteResultsToSheets(testResults, route);
    }

    // 失敗したテストがある場合でも、プロセスは正常終了
    process.exit(testResults.success ? 0 : 1);
  } catch (err) {
    console.error('🚨 予期せぬエラーが発生:', err);
    process.exit(1);
  } finally {
    await runner?.cleanup();
  }
})();

/**
 * 重複実行をチェック（改良版：依存関係を考慮）
 */
function checkForDuplicateExecution(testResultsDir, routeFile) {
  try {
    const historyPath = path.join(testResultsDir, '.execution-history.json');
    if (!fs.existsSync(historyPath)) {
      return { isDuplicate: false };
    }

    const history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
    const routeHistory = history[routeFile];

    if (!routeHistory || routeHistory.length === 0) {
      return { isDuplicate: false };
    }

    const lastExecution = routeHistory[routeHistory.length - 1];
    const timeDiff = Date.now() - new Date(lastExecution.timestamp).getTime();
    const hoursDiff = timeDiff / (1000 * 60 * 60);

    // 30分以内の同じルートファイルの実行は重複とみなす（1時間から短縮）
    if (hoursDiff < 0.5) {
      // 🔧 改良: 部分的スキップの提案
      const lastResult = lastExecution.result;
      
      // 全て成功している場合のみ完全スキップを提案
      if (lastResult.failed_count === 0) {
        return {
          isDuplicate: true,
          skipType: 'complete',
          routeFile,
          lastExecution: lastExecution.timestamp,
          lastResult: lastResult,
          suggestion: '前回のテストは全て成功しているため、完全スキップを提案します'
        };
      } 
      // 部分的に失敗している場合は、失敗ステップのみ再実行を提案
      else {
        return {
          isDuplicate: true,
          skipType: 'partial',
          routeFile,
          lastExecution: lastExecution.timestamp,
          lastResult: lastResult,
          suggestion: `前回のテストで${lastResult.failed_count}件の失敗があったため、失敗ステップのみ再実行を提案します`
        };
      }
    }

    return { isDuplicate: false };
  } catch (error) {
    console.error('実行履歴チェックエラー:', error.message);
    return { isDuplicate: false };
  }
}

/**
 * 前回の実行結果から失敗ステップを特定
 */
function getFailedStepsFromHistory(testResultsDir, routeFile) {
  try {
    const historyPath = path.join(testResultsDir, '.execution-history.json');
    if (!fs.existsSync(historyPath)) {
      return [];
    }

    const history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
    const routeHistory = history[routeFile];
    
    if (!routeHistory || routeHistory.length === 0) {
      return [];
    }

    const lastExecution = routeHistory[routeHistory.length - 1];
    return lastExecution.failedSteps || [];
  } catch (error) {
    console.error('失敗ステップ履歴取得エラー:', error.message);
    return [];
  }
}

/**
 * 修正ルート実行結果をGoogle Sheetsに追加
 */
async function uploadFixedRouteResultsToSheets(testResults, route) {
  try {
    // config.jsonからGoogle Sheets設定を読み込み
    const configPath = path.resolve(__dirname, "../config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    
    if (!config.googleSheets || !config.googleSheets.autoUpload) {
      console.log('📊 Google Sheets自動アップロードが無効です');
      return;
    }

    console.log('📊 修正ルート結果をGoogle Sheetsに追加中...');
    
    const uploader = new GoogleSheetsUploader();
    await uploader.initialize(path.resolve(__dirname, '../credentials.json'));
    
    // 既存のスプレッドシートを検索
    const spreadsheetId = await uploader.findExistingSpreadsheet(
      config.googleSheets.spreadsheetTitle || 'AutoPlaywright テスト結果',
      config.googleSheets.driveFolder
    );
    
    if (!spreadsheetId) {
      console.log('❌ 対象のスプレッドシートが見つかりません');
      return;
    }

    // 最新のシート名を取得（TestResults_で始まる最新のもの）
    const existingData = await uploader.getSheetData(spreadsheetId, 'Sheet1');
    
    // シート一覧を取得してTestResults_で始まる最新のシートを見つける
    const response = await uploader.sheets.spreadsheets.get({
      spreadsheetId: spreadsheetId,
      fields: 'sheets.properties.title'
    });
    
    const testResultSheets = response.data.sheets
      .map(sheet => sheet.properties.title)
      .filter(title => title.startsWith('TestResults_'))
      .sort()
      .reverse(); // 降順ソート（最新が先頭）
    
    if (testResultSheets.length === 0) {
      console.log('❌ TestResultsシートが見つかりません');
      return;
    }
    
    const latestSheet = testResultSheets[0];
    console.log(`📋 対象シート: ${latestSheet}`);
    
    // テスト結果を適切な形式に変換
    const fixedResults = testResults.steps.map(step => ({
      label: step.label,
      status: step.status,
      result: step.status,
      isFixed: step.isFixed,
      fixReason: step.fixReason
    }));
    
    // Google Sheetsに修正結果を追加
    await uploader.addFixedRouteResults(
      spreadsheetId,
      latestSheet,
      fixedResults,
      '再）実行結果'
    );
    
    const spreadsheetUrl = uploader.getSpreadsheetUrl(spreadsheetId);
    console.log(`✅ 修正ルート結果をGoogle Sheetsに追加完了`);
    console.log(`🔗 スプレッドシート: ${spreadsheetUrl}`);
    
  } catch (error) {
    console.error('❌ Google Sheets追加エラー:', error.message);
    // エラーでもテスト実行は続行
  }
}

/**
 * 実行履歴を更新
 */
function updateExecutionHistory(testResultsDir, routeFile, testResult) {
  try {
    const historyPath = path.join(testResultsDir, '.execution-history.json');
    let history = {};

    if (fs.existsSync(historyPath)) {
      history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
    }

    if (!history[routeFile]) {
      history[routeFile] = [];
    }

    // 最新10件まで保持
    if (history[routeFile].length >= 10) {
      history[routeFile].shift();
    }

    // 失敗ステップの詳細を抽出
    const failedSteps = testResult.steps
      .filter(step => step.status === 'failed')
      .map(step => ({
        label: step.label,
        action: step.action,
        target: step.target,
        error: step.error
      }));

    history[routeFile].push({
      timestamp: testResult.timestamp,
      result: {
        success_count: testResult.success_count,
        failed_count: testResult.failed_count,
        success: testResult.success,
        execution_time: testResult.execution_time
      },
      failedSteps: failedSteps, // 🔧 失敗ステップの詳細を追加
      isFixedRoute: testResult.is_fixed_route || false,
      originalRouteId: testResult.original_route_id || null
    });

    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
  } catch (error) {
    console.error('実行履歴更新エラー:', error.message);
  }
}
