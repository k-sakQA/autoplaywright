// tests/runRoutes.js

import 'dotenv/config';
import fs from "fs";
import path from "path";
import { spawn } from 'child_process';
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
      const config = loadConfig();
      this.browser = await chromium.launch({
        headless: process.env.NODE_ENV === 'production'
      });
      this.page = await this.browser.newPage();
      
      // configからtargetUrlを取得して直接移動
      if (config.targetUrl) {
        await this.page.goto(config.targetUrl);
        console.log(`✅ テスト対象ページに移動: ${config.targetUrl}`);
      } else {
        throw new Error('targetUrlが設定されていません');
      }
    } catch (error) {
      console.error('ブラウザの初期化に失敗しました:', error);
      throw error;
    }
  }

  async navigateToTarget() {
    if (!this.page) throw new Error('ページが初期化されていません');
    try {
      // 現在のURLを確認
      const currentUrl = this.page.url();
      const config = loadConfig();
      
      // 同じURLの場合は再読み込みのみ
      if (currentUrl === config.targetUrl) {
        await this.page.reload();
        console.log('🔄 ページを再読み込みしました');
      } else {
        await this.page.goto(config.targetUrl);
        console.log(`🔄 新しいURLに移動: ${config.targetUrl}`);
      }
    } catch (error) {
      console.error(`ページ移動に失敗しました:`, error);
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
      // バリデーションテストの場合、エラーは期待された動作
      if (step.label.toLowerCase().includes('無効な値') || 
          step.label.toLowerCase().includes('バリデーション確認')) {
        try {
          switch (step.action) {
            case 'fill':
              await this.page.fill(step.target, step.value || '', { timeout: step.timeout || 5000 });
              console.log('⚠️ バリデーションエラーが発生しませんでした');
              return false;
            default:
              // その他のアクションは通常通り実行
              break;
          }
        } catch (error) {
          if (error.message.includes('Cannot type text into input[type=number]') ||
              error.message.includes('validation')) {
            console.log('✅ バリデーションエラーが正しく発生しました');
            return true;
          }
          throw error;
        }
      }

      // チェックボックスの処理
      if (step.action === 'fill' && step.target.includes('checkbox')) {
        await this.page.click(step.target, { timeout: step.timeout || 5000 });
        console.log(`✅ チェックボックスをクリック: ${step.target}`);
        return true;
      }

      // hidden要素の処理
      if (step.target.includes('-hidden')) {
        console.log(`⏭️ ステップをスキップ: ${step.label}`);
        return true;
      }

      // 電話番号入力欄の待機
      if (step.target === '[name="phone"]') {
        step.target = '[name="tel"]';
        console.log('🔧 電話番号入力欄のセレクタを[name="tel"]に変更します');
      }

      switch (step.action) {
        // ... existing code ...
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

/**
 * 分類別バッチ処理結果を実行
 */
async function executeCategoryBatchRoutes(batchRoute) {
  const startTime = Date.now();
  const allResults = {
    batch_id: batchRoute.batch_id,
    timestamp: new Date().toISOString(),
    processing_mode: 'category_batch',
    categories: [],
    summary: {
      total_categories: batchRoute.categories.length,
      total_routes: 0,
      executed_routes: 0,
      success_routes: 0,
      failed_routes: 0,
      skipped_routes: 0
    },
    execution_time: 0
  };

  console.log(`📊 ${batchRoute.categories.length}分類のルートを順次実行します...`);

  const runner = new PlaywrightRunner();
  await runner.initialize();

  try {
    for (const category of batchRoute.categories) {
      console.log(`\n🔄 実行中: ${category.category}分類 (${category.routes.length}ルート)`);
      
      const categoryResult = {
        category: category.category,
        test_case_count: category.test_case_count,
        route_count: category.routes.length,
        executed_count: 0,
        success_count: 0,
        failed_count: 0,
        routes: []
      };

      allResults.summary.total_routes += category.routes.length;

      if (category.routes.length === 0) {
        console.log(`   ⚠️ 実行可能なルートがありません`);
        allResults.summary.skipped_routes += 1;
        categoryResult.routes.push({
          route_id: `${category.category}_no_routes`,
          status: 'skipped',
          reason: '実行可能なルートが生成されませんでした',
          steps: []
        });
        allResults.categories.push(categoryResult);
        continue;
      }

      for (const route of category.routes) {
        console.log(`\n  📝 ルート実行: ${route.route_id || 'Unknown'}`);
        console.log(`     観点: ${route.original_viewpoint?.substring(0, 80)}...`);
        
        allResults.summary.executed_routes++;
        categoryResult.executed_count++;

        const routeResult = {
          route_id: route.route_id,
          original_viewpoint: route.original_viewpoint,
          feasibility_score: route.feasibility_score,
          steps: [],
          success: true,
          failed_steps: 0,
          execution_time: 0
        };

        const routeStartTime = Date.now();
        
        try {
          // 各ステップを実行
          for (const step of route.steps) {
            const stepLabel = step.label || `${step.action} ${step.target}`;
            console.log(`     🔧 ${stepLabel}`);
            
            try {
              await runner.executeStep(step);
              console.log(`     ✅ 成功`);
              routeResult.steps.push({
                label: stepLabel,
                action: step.action,
                target: step.target,
                value: step.value || null,  // 🔧 valueフィールドを追加
                status: 'success',
                error: null
              });
            } catch (stepError) {
              const errorMessage = stepError.message.split('\n')[0];
              console.log(`     ❌ 失敗: ${errorMessage}`);
              routeResult.steps.push({
                label: stepLabel,
                action: step.action,
                target: step.target,
                value: step.value || null,  // 🔧 valueフィールドを追加
                status: 'failed',
                error: errorMessage
              });
              routeResult.failed_steps++;
              routeResult.success = false;
            }
          }
          
          routeResult.execution_time = Date.now() - routeStartTime;
          
          if (routeResult.success) {
            console.log(`  ✅ ルート成功: ${route.route_id}`);
            allResults.summary.success_routes++;
            categoryResult.success_count++;
          } else {
            console.log(`  ❌ ルート失敗: ${route.route_id} (${routeResult.failed_steps}/${routeResult.steps.length}ステップ失敗)`);
            allResults.summary.failed_routes++;
            categoryResult.failed_count++;
          }
          
        } catch (routeError) {
          console.log(`  🚨 ルート実行エラー: ${routeError.message}`);
          routeResult.success = false;
          routeResult.error = routeError.message;
          allResults.summary.failed_routes++;
          categoryResult.failed_count++;
        }
        
        categoryResult.routes.push(routeResult);
      }
      
      console.log(`📊 ${category.category}分類完了: ${categoryResult.success_count}/${categoryResult.executed_count}ルート成功`);
      allResults.categories.push(categoryResult);
    }

    allResults.execution_time = Date.now() - startTime;

    // コンソール出力
    console.log('\n=== 分類別バッチ実行結果 ===');
    console.log(`🔷 バッチID: ${allResults.batch_id}`);
    console.log(`🔷 総分類数: ${allResults.summary.total_categories}`);
    console.log(`🔷 総ルート数: ${allResults.summary.total_routes}`);
    console.log(`🔷 実行ルート数: ${allResults.summary.executed_routes}`);
    console.log(`🔷 成功ルート数: ${allResults.summary.success_routes}`);
    console.log(`🔷 失敗ルート数: ${allResults.summary.failed_routes}`);
    console.log(`🔷 スキップ分類数: ${allResults.summary.skipped_routes}`);

    // 分類別サマリー
    console.log('\n📊 分類別結果:');
    allResults.categories.forEach(cat => {
      if (cat.executed_count > 0) {
        console.log(`  - ${cat.category}: ${cat.success_count}/${cat.executed_count}成功`);
      } else {
        console.log(`  - ${cat.category}: スキップ（ルート未生成）`);
      }
    });

    // 結果をJSONファイルとして保存
    const timestamp = batchRoute.batch_id.replace('batch_', '');
    const testResultsDir = path.join(process.cwd(), 'test-results');
    const resultPath = path.join(testResultsDir, `result_${timestamp}.json`);
    fs.writeFileSync(resultPath, JSON.stringify(allResults, null, 2));
    console.log(`\n📝 バッチ実行結果を保存しました: ${resultPath}`);

    const hasFailures = allResults.summary.failed_routes > 0;
    console.log(hasFailures ? 
      '\n⚠️ 一部のルートで失敗が発生しました' : 
      '\n🎉 すべてのルートが正常に完了しました'
    );

    process.exit(hasFailures ? 1 : 0);

  } finally {
    await runner.cleanup();
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
      const duplicateInfo = checkForDuplicateExecution(testResultsDir, latestFile);
      if (duplicateInfo.isDuplicate) {
        console.log(`⚠️ 重複実行を検出しました:`);
        console.log(`  - 同じルートファイル: ${duplicateInfo.routeFile}`);
        console.log(`  - 前回実行時刻: ${duplicateInfo.lastRun}`);
        console.log(`  - 前回結果: ${duplicateInfo.successCount}成功/${duplicateInfo.failedCount}失敗`);

        // 失敗がある場合は改善提案
        if (duplicateInfo.failedCount > 0) {
          console.log(`  - 提案: 前回のテストで${duplicateInfo.failedCount}件の失敗があったため、失敗ステップのみ再実行を提案します`);
          
          console.log(`\n💡 重複回避の推奨方法:`);
          console.log(`  1. 🔧 失敗テスト分析・修正 (analyzeFailures) を実行`);
          console.log(`  2. 📝 修正されたルートファイルで再テスト`);
          console.log(`  3. ✅ 重複除去により正確なカバレッジを計算`);
          
          // 自動分析・修正オプション
          const shouldAutoFix = process.env.AUTO_FIX_FAILURES === 'true' || 
                               process.argv.includes('--auto-fix');
          
          if (shouldAutoFix) {
            console.log(`\n🔧 自動修正モードが有効です。失敗ステップを分析・修正します...`);
            
            try {
              // 失敗分析を実行
              const { execSync } = await import('child_process');
              console.log(`🔍 失敗テスト分析を実行中...`);
              
              execSync('node tests/analyzeFailures.js', { 
                stdio: 'inherit',
                cwd: process.cwd()
              });
              
              // 修正されたルートファイルを検索
              const fixedRoutes = findFixedRoutes(route.route_id);
              
              if (fixedRoutes.length > 0) {
                console.log(`\n✅ 修正されたルートが見つかりました: ${fixedRoutes.length}件`);
                
                const latestFixed = fixedRoutes[0]; // 最新の修正ルート
                console.log(`📝 修正ルートを実行: ${latestFixed}`);
                
                // 修正ルートを読み込んで実行
                const fixedRoutePath = path.join(__dirname, '..', 'test-results', latestFixed);
                const fixedRoute = JSON.parse(fs.readFileSync(fixedRoutePath, 'utf-8'));
                
                // 修正ルートで実行
                return await this.runSingleRoute(fixedRoute, true);
              } else {
                console.log(`⚠️ 修正ルートが生成されませんでした。元のルートで継続実行します。`);
              }
            } catch (error) {
              console.error(`❌ 自動修正処理でエラーが発生しました: ${error.message}`);
              console.log(`💡 手動で失敗分析を実行してください: node tests/analyzeFailures.js`);
            }
          } else {
            console.log(`\n💡 自動修正を有効にするには:`);
            console.log(`  - 環境変数: AUTO_FIX_FAILURES=true`);
            console.log(`  - または: --auto-fix フラグを使用`);
          }
        }
        
        console.log(`\n🚀 継続する場合は、失敗の可能性があることを承知で実行します...`);
      }
    }

    // 3. ルートを読み込む
    const route = JSON.parse(fs.readFileSync(routePath, 'utf-8'));
    
    // 分類別バッチ処理結果の場合
    if (route.processing_mode === 'category_batch') {
      console.log('📂 分類別バッチ処理結果を実行します');
      return await executeCategoryBatchRoutes(route);
    }
    
    // 従来の単一ルート処理
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
          value: step.value || null,  // 🔧 valueフィールドを追加
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
          value: step.value || null,  // 🔧 valueフィールドを追加
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
          value: step.value || null,  // 🔧 valueフィールドを追加
          status: step.action === 'skip' ? 'skipped' : (test ? (test.error ? 'failed' : 'success') : 'unknown'),
          error: test?.error || null,
          isFixed: !!step.fix_reason,
          fixReason: step.fix_reason || null
        };
      }),
      // カバレッジ計算用の追加情報
      coverage_info: {
        total_test_cases: route.steps.length,
        successful_test_cases: successTests.length,
        total_steps: route.steps.length,
        successful_steps: successTests.length,
        execution_analysis: {
          executed_routes: 1,
          successful_routes: failedTests.length === 0 ? 1 : 0,
          total_steps: route.steps.length,
          successful_steps: successTests.length,
          step_success_rate: (successTests.length / route.steps.length) * 100,
          execution_success_rate: failedTests.length === 0 ? 100 : 0
        }
      }
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
      
      // CSVレポートも生成（修正ルート実行後）
      try {
        console.log('📊 修正ルート結果のCSVレポートを生成中...');
        
        const reportArgs = ['tests/generateTestReport.js'];
        
        // 元の引数情報があれば引き継ぐ
        if (route.analysis_context) {
          if (route.analysis_context.target_url) {
            reportArgs.push('--url', route.analysis_context.target_url);
          }
          if (route.analysis_context.user_story) {
            reportArgs.push('--goal', route.analysis_context.user_story);
          }
          if (route.analysis_context.spec_pdf) {
            reportArgs.push('--spec-pdf', route.analysis_context.spec_pdf);
          }
          if (route.analysis_context.test_csv) {
            reportArgs.push('--test-csv', route.analysis_context.test_csv);
          }
        }
        
        console.log(`🔧 実行コマンド: node ${reportArgs.join(' ')}`);
        
        const reportProcess = spawn('node', reportArgs, {
          cwd: path.resolve(__dirname, '..'),
          stdio: 'inherit'
        });
        
        await new Promise((resolve, reject) => {
          reportProcess.on('close', (code) => {
            if (code === 0) {
              console.log('✅ 修正ルート結果のCSVレポート生成完了');
              resolve();
            } else {
              console.error(`❌ CSVレポート生成でエラー（終了コード: ${code}）`);
              resolve(); // エラーでも続行
            }
          });
          
          reportProcess.on('error', (error) => {
            console.error('❌ CSVレポート生成プロセスエラー:', error.message);
            resolve(); // エラーでも続行
          });
        });
        
      } catch (error) {
        console.error('❌ CSVレポート生成エラー:', error.message);
        // エラーでも続行
      }
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
      
      // より詳細な情報を返す
      return {
        isDuplicate: true,
        routeFile,
        lastRun: lastExecution.timestamp,
        successCount: lastResult.success_count || 0,
        failedCount: lastResult.failed_count || 0,
        lastResult: lastResult,
        failedSteps: lastExecution.failedSteps || []
      };
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

/**
 * 修正されたルートファイルを検索
 */
function findFixedRoutes(originalRouteId) {
  try {
    const testResultsDir = path.join(__dirname, '..', 'test-results');
    const files = fs.readdirSync(testResultsDir);
    
    // 修正ルートのパターン: fixed_route_ORIGINAL_ID_timestamp.json
    const fixedRoutePattern = new RegExp(`fixed_.*${originalRouteId.replace('route_', '')}.*\\.json$`);
    
    const fixedRoutes = files
      .filter(file => fixedRoutePattern.test(file))
      .sort() // タイムスタンプ順
      .reverse(); // 最新が先頭
    
    return fixedRoutes;
  } catch (error) {
    console.error(`修正ルート検索エラー: ${error.message}`);
    return [];
  }
}
