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

// configのスキーマ定義
const ConfigSchema = z.object({
  openai: z.object({
    apiKeyEnv: z.string(),
    model: z.string(),
    temperature: z.number().min(0).max(2),
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

  return {
    apiKey,
    model: config.openai.model,
    temperature: config.openai.temperature,
  };
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
          await this.page.waitForSelector(step.target, { state: 'visible', timeout: step.timeout || 5000 });
          console.log(`✅ 要素表示確認: ${step.target}`);
          break;
        case 'assertNotVisible':
          await this.page.waitForSelector(step.target, { state: 'hidden', timeout: step.timeout || 5000 });
          console.log(`✅ 要素非表示確認: ${step.target}`);
          break;
        case 'click':
          if (step.expectsNavigation) {
            await Promise.all([
              this.page.waitForNavigation({
                timeout: step.timeout || 30000,
                waitUntil: 'networkidle'
              }),
              this.page.click(step.target, { timeout: step.timeout || 5000 })
            ]);
            console.log(`✅ クリック後の画面遷移成功: ${step.target}`);
          } else {
            await this.page.click(step.target, { timeout: step.timeout || 5000 });
            console.log(`✅ クリック成功: ${step.target}`);
          }
          break;
        case 'fill':
          await this.page.fill(step.target, step.value || '', { timeout: step.timeout || 5000 });
          console.log(`✅ 入力完了: ${step.target} = "${step.value}"`);
          break;
        case 'waitForURL':
          await this.page.waitForURL(step.target, { timeout: step.timeout || 5000 });
          console.log(`✅ URL遷移確認: ${step.target}`);
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
    const runner = new PlaywrightRunner();
    await runner.initialize();

    console.log(`🛠️ [Debug] Running route_id: ${route.route_id || 'undefined'}`);

    // 4. 各ステップを実行
    for (const step of route.steps) {
      const stepLabel = step.label || `${step.action} ${step.target}`;
      console.log(`\n📝 テストステップ: ${stepLabel}`);

      try {
        await runner.executeStep(step);
        console.log(`✅ ステップ成功: ${stepLabel}`);
        successTests.push({
          label: stepLabel,
          action: step.action,
          target: step.target,
          timestamp: new Date().toISOString()
        });
      } catch (err) {
        const errorMessage = err.message.split('\n')[0]; // エラーメッセージの最初の行のみを使用
        console.log(`❌ テスト失敗: ${stepLabel}\n   理由: ${errorMessage}`);
        failedTests.push({
          label: stepLabel,
          action: step.action,
          target: step.target,
          error: errorMessage,
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
      steps: route.steps.map((step, index) => {
        const test = successTests.find(t => t.label === step.label) || 
                    failedTests.find(t => t.label === step.label);
        return {
          label: step.label,
          action: step.action,
          target: step.target,
          status: test ? (test.error ? 'failed' : 'success') : 'unknown',
          error: test?.error || null
        };
      })
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
    const timestamp = latestFile.replace('route_', '').replace('.json', '');
    const resultPath = path.join(testResultsDir, `result_${timestamp}.json`);
    fs.writeFileSync(resultPath, JSON.stringify(testResults, null, 2));
    console.log(`\n📝 テスト結果を保存しました: ${resultPath}`);

    // 失敗したテストがある場合でも、プロセスは正常終了
    process.exit(testResults.success ? 0 : 1);
  } catch (err) {
    console.error('🚨 予期せぬエラーが発生:', err);
    process.exit(1);
  } finally {
    await runner?.cleanup();
  }
})();
