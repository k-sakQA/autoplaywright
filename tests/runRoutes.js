import playwright from 'playwright';
import fs from 'fs';
import path from 'path';
import { HtmlReporter } from './htmlReporter.js';

// 🔧 セッション維持のための静的ブラウザ管理
class BrowserSessionManager {
  static instance = null;
  static browser = null;
  static page = null;
  static sessionCount = 0;
  static isAndroidDevice = false;
  static sessionStateFile = path.join(process.cwd(), 'test-results', '.browser_session_state.json');
  static browserPid = null; // ブラウザプロセスIDを追跡
  static terminationTimeout = 10000; // 終了タイムアウト（10秒）

  static async getBrowserInstance(keepSession = false) {
    // セッション状態をファイルから読み込み
    this.loadSessionState();
    
    // セッション維持フラグがOFFの場合は、既存ブラウザを強制終了
    if (!keepSession && this.browser && this.browser.isConnected()) {
      console.log('🔄 セッション維持OFF：既存ブラウザを強制終了して新規起動...');
      await this.forceTerminateBrowser();
    }
    
    // ブラウザがない、または接続が切れている場合のみ新規作成
    if (!this.browser || this.browser.isConnected() === false) {
      console.log('🚀 新しいブラウザインスタンスを作成...');
      this.sessionCount++;
      
      if (this.isAndroidDevice) {
        this.browser = await this.initializeAndroidBrowser();
      } else {
        this.browser = await playwright.chromium.launch({
          headless: false,
          args: [
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--window-size=1366,768'
          ]
        });
        
        // ブラウザプロセスIDを取得
        const browserProcess = this.browser._browser?.process();
        if (browserProcess) {
          this.browserPid = browserProcess.pid;
          console.log(`🔍 ブラウザプロセスID: ${this.browserPid}`);
        }
      }
      
      // 新しいページを作成
      this.page = await this.browser.newPage();
      await this.page.setViewportSize({ width: 1366, height: 768 });
      
      // セッション状態を保存
      this.saveSessionState();
      
      console.log(`📊 セッション管理: ${this.sessionCount}回目のブラウザ起動`);
    }
    
    return { browser: this.browser, page: this.page };
  }

  static async forceTerminateBrowser() {
    try {
      // まず通常の終了を試行
      if (this.browser && this.browser.isConnected()) {
        console.log('🔄 通常のブラウザ終了を試行中...');
        try {
          // すべてのコンテキストとページを閉じる
          const contexts = this.browser.contexts();
          for (const context of contexts) {
            await context.close();
          }
          
          // ブラウザプロセスを終了
          await this.browser.close();
          console.log('✅ 通常のブラウザ終了が成功しました');
        } catch (error) {
          console.warn('⚠️ 通常のブラウザ終了に失敗:', error.message);
        }
      }
      
      // プロセスIDが利用可能な場合は強制終了
      if (this.browserPid) {
        console.log(`🔄 ブラウザプロセスを強制終了: PID=${this.browserPid}`);
        try {
          process.kill(this.browserPid, 'SIGTERM');
          await this.waitForProcessExit(this.browserPid, 5000);
          console.log('✅ SIGTERM による終了が成功しました');
        } catch (error) {
          console.warn('⚠️ SIGTERM終了に失敗、SIGKILLを実行:', error.message);
          try {
            process.kill(this.browserPid, 'SIGKILL');
            await this.waitForProcessExit(this.browserPid, 3000);
            console.log('✅ SIGKILL による強制終了が成功しました');
          } catch (killError) {
            console.error('❌ SIGKILL終了に失敗:', killError.message);
            // 最後の手段としてkillallを試行
            try {
              const { execSync } = await import('child_process');
              execSync('killall -9 Chromium', { stdio: 'ignore' });
              console.log('✅ killallによる強制終了が成功しました');
            } catch (killallError) {
              console.error('❌ killall終了も失敗:', killallError.message);
            }
          }
        }
      }
      
      // システム全体のChromiumプロセスクリーンアップ
      await this.killAllChromiumProcesses();
      
    } catch (error) {
      console.error('❌ forceTerminateBrowser エラー:', error.message);
    } finally {
      // インスタンス変数をリセット
      this.browser = null;
      this.page = null;
      this.browserPid = null;
      this.clearSessionState();
    }
  }

  static async waitForProcessExit(pid, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const checkInterval = setInterval(() => {
        try {
          // プロセスが存在するかチェック
          process.kill(pid, 0);
          
          // タイムアウトチェック
          if (Date.now() - startTime > timeout) {
            clearInterval(checkInterval);
            reject(new Error(`プロセス ${pid} の終了待機がタイムアウトしました`));
          }
        } catch (error) {
          // プロセスが存在しない（終了した）
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    });
  }

  static async killAllChromiumProcesses() {
    try {
      const { execSync } = await import('child_process');
      
      // macOS/Linuxでのプロセス終了
      console.log('🔄 残存Chromiumプロセスを検索中...');
      
      try {
        // まず通常のkillで穏やかに終了
        execSync('pkill -f chromium', { stdio: 'ignore' });
        console.log('✅ 通常終了送信完了、3秒待機...');
        
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // 残存プロセスがあれば強制終了
        try {
          execSync('pkill -9 -f chromium', { stdio: 'ignore' });
          console.log('✅ 残存プロセスの強制終了完了');
        } catch (killError) {
          // pkillで失敗した場合はkillallを試行
          execSync('killall -9 Chromium', { stdio: 'ignore' });
          console.log('✅ killallによる強制終了完了');
        }
        
      } catch (error) {
        // プロセスが見つからない場合は正常
        console.log('✅ Chromiumプロセスは既に終了済みです');
      }
    } catch (error) {
      console.warn('⚠️ システムプロセス終了処理でエラー:', error.message);
    }
  }

  static async checkBrowserHealth() {
    try {
      const health = {
        browser_connected: this.browser ? this.browser.isConnected() : false,
        page_available: this.page ? !this.page.isClosed() : false,
        session_count: this.sessionCount,
        browser_pid: this.browserPid,
        is_android: this.isAndroidDevice
      };
      
      // システムのChromiumプロセス数もチェック
      try {
        const { execSync } = await import('child_process');
        const result = execSync('pgrep -f chromium', { encoding: 'utf8' });
        health.system_chromium_processes = result.trim().split('\n').filter(pid => pid).length;
      } catch (error) {
        health.system_chromium_processes = 0;
      }
      
      return health;
    } catch (error) {
      console.error('❌ ブラウザヘルスチェックエラー:', error.message);
      return { error: error.message };
    }
  }

  static saveSessionState() {
    try {
      const state = {
        sessionCount: this.sessionCount,
        isAndroidDevice: this.isAndroidDevice,
        browserPid: this.browserPid,
        timestamp: new Date().toISOString()
      };
      
      const dir = path.dirname(this.sessionStateFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(this.sessionStateFile, JSON.stringify(state, null, 2));
    } catch (error) {
      console.warn('⚠️ セッション状態保存エラー:', error.message);
    }
  }

  static loadSessionState() {
    try {
      if (fs.existsSync(this.sessionStateFile)) {
        const state = JSON.parse(fs.readFileSync(this.sessionStateFile, 'utf-8'));
        this.sessionCount = state.sessionCount || 0;
        this.isAndroidDevice = state.isAndroidDevice || false;
        this.browserPid = state.browserPid || null;
      }
    } catch (error) {
      console.warn('⚠️ セッション状態読み込みエラー:', error.message);
    }
  }

  static clearSessionState() {
    try {
      if (fs.existsSync(this.sessionStateFile)) {
        fs.unlinkSync(this.sessionStateFile);
      }
    } catch (error) {
      console.warn('⚠️ セッション状態クリアエラー:', error.message);
    }
  }

  static async initializeAndroidBrowser() {
    try {
      console.log('📱 Androidブラウザを初期化中...');
      this.isAndroidDevice = true;
      
      const browser = await playwright.chromium.connectOverCDP({
        endpointURL: 'http://localhost:9222'
      });
      
      console.log('✅ Androidブラウザに接続しました');
      return browser;
    } catch (error) {
      console.error('❌ Androidブラウザ初期化エラー:', error.message);
      throw error;
    }
  }

  static async closeBrowser(force = false) {
    if (this.browser && (force || process.env.PLAYWRIGHT_FORCE_CLOSE === 'true')) {
      console.log('🧹 ブラウザセッションを終了...');
      await this.forceTerminateBrowser();
    } else if (this.browser) {
      console.log('💾 ブラウザセッションを維持中... (PLAYWRIGHT_FORCE_CLOSE=true で強制終了)');
    }
  }
}

// 設定読み込み関数
const loadConfig = () => {
  try {
    const configPath = path.join(process.cwd(), 'config.json');
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (error) {
    console.log('⚠️ config.jsonが見つかりません。デフォルト設定を使用します。');
    return {
      openai: {
        apiKey: process.env.OPENAI_API_KEY,
        model: 'gpt-4o-mini'
      }
    };
  }
};

// OpenAI設定を取得
const getOpenAIConfig = (config) => {
  return {
    apiKey: config.openai?.apiKey || process.env.OPENAI_API_KEY,
    model: config.openai?.model || 'gpt-4o-mini'
  };
};

// 🎯 Playwrightテスト実行エンジン
export class PlaywrightRunner {
  constructor(options = {}) {
    this.browser = null;
    this.page = null;
    this.keepSession = options.keepSession || 
                       process.argv.includes('--keep-session') || 
                       process.env.PLAYWRIGHT_KEEP_SESSION === 'true';
    this.autoClose = options.autoClose || 
                     process.argv.includes('--auto-close');
    
    // タイムアウト設定を追加
    this.testTimeout = options.testTimeout || 
                       parseInt(process.env.PLAYWRIGHT_TEST_TIMEOUT) || 
                       300000; // デフォルト5分
    this.testStartTime = null;
    this.timeoutTimer = null;
    
    // デバッグ情報を出力
    console.log(`🔧 セッション維持設定: ${this.keepSession ? 'ON' : 'OFF'}`);
    console.log(`⏰ テストタイムアウト: ${this.testTimeout}ms (${this.testTimeout/1000}秒)`);
    if (this.autoClose) {
      console.log('🔄 自動終了モードが有効です');
    }
    
    this.config = loadConfig();
    this.openaiConfig = getOpenAIConfig(this.config);
    this.reporter = new HtmlReporter(this.openaiConfig.apiKey);
    this.userStoryInfo = null;
    
    this.setupGracefulShutdown();
    this.setupUserStoryInfo();
  }

  setupGracefulShutdown() {
    const gracefulShutdown = async (signal) => {
      console.log(`\n🔄 グレースフルシャットダウン開始 (${signal})`);
      try {
        if (this.timeoutTimer) {
          clearTimeout(this.timeoutTimer);
        }
        
        await this.cleanup(true);
        console.log('✅ グレースフルシャットダウン完了');
        process.exit(0);
      } catch (error) {
        console.error('❌ グレースフルシャットダウンエラー:', error.message);
        await BrowserSessionManager.killAllChromiumProcesses();
        process.exit(1);
      }
    };

    process.on('SIGINT', gracefulShutdown);
    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGQUIT', gracefulShutdown);
  }

  startTimeoutTimer() {
    this.testStartTime = Date.now();
    
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
    }
    
    this.timeoutTimer = setTimeout(async () => {
      console.error(`\n⏰ テストタイムアウト: ${this.testTimeout/1000}秒経過`);
      console.error('🔄 強制終了処理を開始...');
      
      try {
        await this.cleanup(true);
      } catch (error) {
        console.error('❌ タイムアウト時のクリーンアップエラー:', error.message);
      }
      
      process.exit(1);
    }, this.testTimeout);
  }

  stopTimeoutTimer() {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
      
      if (this.testStartTime) {
        const elapsed = Date.now() - this.testStartTime;
        console.log(`⏱️ テスト実行時間: ${Math.round(elapsed/1000)}秒`);
        this.testStartTime = null;
      }
    }
  }

  setupUserStoryInfo() {
    const args = process.argv;
    const userStoryIndex = args.indexOf('--user-story');
    if (userStoryIndex !== -1 && args[userStoryIndex + 1]) {
      const userStoryParam = args[userStoryIndex + 1];
      const parts = userStoryParam.split(':');
      
      this.userStoryInfo = {
        id: parts[0] || 'default',
        name: parts[1] || 'Unknown User Story'
      };
      
      console.log(`👤 ユーザーストーリー: ${this.userStoryInfo.id} - ${this.userStoryInfo.name}`);
    }
  }

  async initialize() {
    try {
      console.log('🔧 PlaywrightRunnerを初期化中...');
      
      // Androidデバイス検出
      const args = process.argv;
      const androidIndex = args.indexOf('--android');
      if (androidIndex !== -1) {
        const serialNumber = args[androidIndex + 1];
        if (serialNumber && !serialNumber.startsWith('--')) {
          await this.initializeAndroidDevice(serialNumber);
          return;
        } else {
          await this.initializeAndroidDevice();
          return;
        }
      }
      
      // 通常のブラウザ初期化
      const { browser, page } = await BrowserSessionManager.getBrowserInstance(this.keepSession);
      this.browser = browser;
      this.page = page;
      
      console.log('✅ PlaywrightRunner初期化完了');
      
    } catch (error) {
      console.error('❌ PlaywrightRunner初期化エラー:', error.message);
      throw error;
    }
  }

  async executeRoute(routeData) {
    try {
      // タイムアウトタイマーを開始
      this.startTimeoutTimer();
      
      // レポーターにテスト開始を通知
      this.reporter.startTest(routeData.testName || 'Unknown Test');
      
      console.log(`\n🚀 ルート実行開始: ${routeData.testName || 'Unknown'}`);
      console.log(`📊 ステップ数: ${routeData.steps ? routeData.steps.length : 0}`);

      // レポーターにルート情報を設定
      this.reporter.setRouteId(routeData.route_id);
      this.reporter.setTestName(routeData.testName || routeData.route_id);
      
      // ユーザーストーリー情報があれば設定
      if (this.userStoryInfo) {
        this.reporter.setUserStoryInfo(this.userStoryInfo.id, this.userStoryInfo.name);
      }
      
      const results = {
        route_id: routeData.route_id,
        testName: routeData.testName || routeData.route_id,
        steps: [],
        startTime: new Date().toISOString(),
        userStoryId: this.userStoryInfo?.id
      };
      
      try {
        console.log(`📝 ${routeData.steps.length}個のステップを実行します`);
        
        for (let i = 0; i < routeData.steps.length; i++) {
          const step = routeData.steps[i];
          console.log(`\n🔄 [${i + 1}/${routeData.steps.length}] ${step.label || step.action}`);
          
          try {
            const stepResult = await this.executeStep(step, i);
            
            results.steps.push({
              stepIndex: i,
              action: step.action,
              target: step.target,
              value: step.value,
              label: step.label,
              success: true,
              result: stepResult,
              timestamp: new Date().toISOString()
            });
            
            // レポーターにステップ成功を通知
            this.reporter.addStep({
              index: i,
              action: step.action,
              target: step.target,
              value: step.value,
              label: step.label,
              success: true,
              timestamp: new Date().toISOString()
            });
            
            console.log(`✅ ステップ ${i + 1} 完了`);
            
          } catch (stepError) {
            console.error(`❌ ステップ ${i + 1} 失敗:`, stepError.message);
            
            results.steps.push({
              stepIndex: i,
              action: step.action,
              target: step.target,
              value: step.value,
              label: step.label,
              success: false,
              error: stepError.message,
              timestamp: new Date().toISOString()
            });
            
            // レポーターにステップ失敗を通知
            this.reporter.addStep({
              index: i,
              action: step.action,
              target: step.target,
              value: step.value,
              label: step.label,
              success: false,
              error: stepError.message,
              timestamp: new Date().toISOString()
            });
            
            // ステップ失敗時の詳細レポート
            await this.reportStepFailure(i, stepError, step);
            
            // 次のステップに進む（継続実行）
          }
        }
        
        results.endTime = new Date().toISOString();
        console.log(`🎉 ルート実行完了: ${routeData.route_id}`);
        
        return results;
        
      } catch (error) {
        results.endTime = new Date().toISOString();
        console.error(`❌ ルート実行エラー: ${routeData.route_id} - ${error.message}`);
        throw error;
      }
    } catch (error) {
      console.error('❌ ルート実行エラー:', error);
      throw error;
    } finally {
      // タイムアウトタイマーを停止
      this.stopTimeoutTimer();
    }
  }

  async executeStep(step, stepIndex = 0) {
    if (!this.page) {
      throw new Error('ページが初期化されていません');
    }
    
    try {
      console.log(`🔄 ステップ実行: ${step.action} - ${step.target}`);
      
      switch (step.action) {
        case 'load':
          await this.page.goto(step.target, { 
            waitUntil: 'domcontentloaded',
            timeout: 30000 
          });
          await this.waitForFrameworkReady();
          return { url: this.page.url() };
          
        case 'click':
          const clickElement = await this.page.locator(step.target).first();
          await clickElement.waitFor({ timeout: 10000 });
          await clickElement.click();
          await this.page.waitForTimeout(1000);
          return { clicked: true };
          
        case 'fill':
          const fillElement = await this.page.locator(step.target).first();
          await fillElement.waitFor({ timeout: 10000 });
          await fillElement.fill(step.value || '');
          return { filled: step.value };
          
        case 'select':
          const selectElement = await this.page.locator(step.target).first();
          await selectElement.waitFor({ timeout: 10000 });
          await selectElement.selectOption(step.value || '');
          return { selected: step.value };
          
        case 'assertVisible':
          const visibleElement = await this.page.locator(step.target).first();
          await visibleElement.waitFor({ 
            state: 'visible', 
            timeout: 10000 
          });
          return { visible: true };
          
        case 'waitForURL':
          await this.page.waitForURL(step.target, { timeout: 10000 });
          return { url: this.page.url() };
          
        default:
          console.warn(`⚠️ 未対応のアクション: ${step.action}`);
          return { skipped: true };
      }
    } catch (error) {
      console.error(`❌ ステップ実行エラー: ${error.message}`);
      throw error;
    }
  }

  async reportStepFailure(stepIndex, error, step) {
    try {
      console.log(`📋 ステップ${stepIndex + 1}失敗の詳細情報を収集中...`);
      
      const failureInfo = {
        step: step,
        error: error.message,
        currentUrl: this.page ? await this.page.url() : 'unknown',
        timestamp: new Date().toISOString()
      };
      
      // 利用可能な要素を収集
      if (step.target) {
        failureInfo.availableElements = await this.collectAvailableElements(step.target);
      }
      
      console.log(`📋 失敗情報:`, failureInfo);
      
    } catch (reportError) {
      console.error('❌ 失敗レポート生成エラー:', reportError.message);
    }
  }

  async collectAvailableElements(targetSelector) {
    try {
      // より詳細な要素情報を収集
      const findSimilarElements = async (sel) => {
        try {
          const elements = await this.page.$$eval('*', (allElements, selector) => {
            return allElements.slice(0, 20).map(el => ({
              tagName: el.tagName,
              id: el.id,
              className: el.className,
              textContent: el.textContent?.slice(0, 50),
              outerHTML: el.outerHTML?.slice(0, 200)
            }));
          }, sel);
          
          return elements;
        } catch (error) {
          return [];
        }
      };
      
      return await findSimilarElements(targetSelector);
    } catch (error) {
      console.error('❌ 要素収集エラー:', error.message);
      return [];
    }
  }

  finishTest() {
    try {
      this.reporter.finishTest();
    } catch (error) {
      console.error('❌ テスト終了処理エラー:', error.message);
    }
  }

  async cleanup(force = false) {
    console.log('🧹 クリーンアップを開始...');
    
    // タイムアウトタイマーを停止
    this.stopTimeoutTimer();
    
    // レポーターのテスト完了処理
    this.finishTest();
    
    // autoCloseフラグが有効な場合は強制終了
    const shouldForceClose = force || this.autoClose;
    
    if (this.keepSession && !shouldForceClose) {
      console.log('💾 セッション維持モード: ブラウザを保持します');
      // ページのみクリアしてブラウザは維持
      this.page = null;
      this.browser = null;
    } else {
      console.log('🔄 ブラウザ終了処理を開始...');
      
      // ページを閉じる
      if (this.page && !this.page.isClosed()) {
        try {
          await this.page.close();
          console.log('✅ ページを閉じました');
        } catch (error) {
          console.warn('⚠️ ページ終了エラー:', error.message);
        }
        this.page = null;
      }
      
      // ブラウザセッションを強制終了
      if (this.browser) {
        try {
          await BrowserSessionManager.forceTerminateBrowser();
          console.log('✅ ブラウザセッションを終了しました');
        } catch (error) {
          console.error('❌ ブラウザ終了エラー:', error.message);
        }
        this.browser = null;
      }
      
      if (shouldForceClose) {
        console.log('🔄 強制終了モード: すべてのリソースを解放しました');
      }
    }
    
    console.log('✅ クリーンアップ完了');
  }

  async waitForFrameworkReady() {
    try {
      // 一般的なJavaScriptフレームワークの準備完了を待機
      await this.page.waitForFunction(() => {
        return document.readyState === 'complete' && 
               (typeof window.jQuery === 'undefined' || window.jQuery.active === 0);
      }, { timeout: 5000 });
      
      await this.page.waitForTimeout(500); // 追加の安定待機
    } catch (error) {
      console.warn('⚠️ フレームワーク準備完了の待機でタイムアウト');
    }
  }
}

// メイン実行部分
(async () => {
  const args = process.argv.slice(2);
  
  let routeFile = null;
  let routeFiles = [];
  let isBatchMode = false;
  let keepSession = false;
  let autoClose = false;
  
  // コマンドライン引数解析
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--route-file' && args[i + 1]) {
      if (isBatchMode) {
        routeFiles.push(args[i + 1]);
      } else {
        routeFile = args[i + 1];
      }
      i++; // 次の引数をスキップ
    } else if (args[i] === '--batch') {
      isBatchMode = true;
      console.log('🔄 バッチ実行モードを有効化');
    } else if (args[i] === '--keep-session') {
      keepSession = true;
      console.log('💾 セッション維持モードを有効化');
    } else if (args[i] === '--auto-close') {
      autoClose = true;
      console.log('🔄 自動終了モードを有効化');
    }
  }
  
  // バッチ実行
  if (isBatchMode && routeFiles.length > 0) {
    console.log(`📋 バッチ実行: ${routeFiles.length}個のルートファイルを連続実行`);
    
    const runner = new PlaywrightRunner({ keepSession, autoClose });
    
    try {
      await runner.initialize();
      
      for (let i = 0; i < routeFiles.length; i++) {
        const currentRouteFile = routeFiles[i];
        console.log(`\n📝 [${i + 1}/${routeFiles.length}] ルート実行: ${currentRouteFile}`);
        
        // ルートファイルを読み込み
        const routePath = path.resolve(process.cwd(), 'test-results', currentRouteFile);
        if (!fs.existsSync(routePath)) {
          console.log(`❌ ルートファイルが見つかりません: ${routePath}`);
          continue;
        }
        
        const routeData = JSON.parse(fs.readFileSync(routePath, 'utf-8'));
        console.log(`🛠️ [Debug] Loaded route from batch: ${routeData.route_id}`);
        
        // ルート実行
        const testResults = await runner.executeRoute(routeData);
        
        // 結果を保存
        const resultPath = path.join(process.cwd(), 'test-results', `result_${routeData.route_id}.json`);
        fs.writeFileSync(resultPath, JSON.stringify(testResults, null, 2));
        console.log(`📝 バッチ結果保存: ${resultPath}`);
      }
      
      console.log(`🎉 バッチ実行完了: ${routeFiles.length}個成功`);
      
    } catch (error) {
      console.error('❌ バッチ実行エラー:', error);
      throw error;
    } finally {
      await runner.cleanup(autoClose);
    }
  }
  
  // 単一ルート実行
  else if (routeFile) {
    const runner = new PlaywrightRunner({ keepSession, autoClose });
    
    try {
      const routePath = path.resolve(process.cwd(), 'test-results', routeFile);
      if (!fs.existsSync(routePath)) {
        console.error(`❌ ルートファイルが見つかりません: ${routePath}`);
        process.exit(1);
      }
      
      const routeData = JSON.parse(fs.readFileSync(routePath, 'utf-8'));
      
      await runner.initialize();
      const testResults = await runner.executeRoute(routeData);
      
      // 結果を保存
      const resultPath = path.join(process.cwd(), 'test-results', `result_${routeData.route_id}.json`);
      fs.writeFileSync(resultPath, JSON.stringify(testResults, null, 2));
      console.log(`📝 結果保存: ${resultPath}`);
      
      console.log('🎉 テスト実行完了');
      
    } catch (error) {
      console.error('❌ テスト実行エラー:', error);
      throw error;
    } finally {
      await runner.cleanup(autoClose);
    }
  }
  
  // 使用方法表示
  else {
    console.log('📖 使用方法:');
    console.log('  単一実行: node tests/runRoutes.js --route-file [ファイル名]');
    console.log('  バッチ実行: node tests/runRoutes.js --batch --route-file [ファイル1] --route-file [ファイル2]');
    console.log('  セッション維持: --keep-session フラグを追加');
    console.log('  自動終了: --auto-close フラグを追加');
    process.exit(1);
  }

})().catch(async (error) => {
  console.error('❌ 致命的エラー:', error);
  
  // 緊急クリーンアップ
  try {
    await BrowserSessionManager.killAllChromiumProcesses();
    console.log('🔄 緊急クリーンアップ完了');
  } catch (emergencyError) {
    console.error('❌ 緊急クリーンアップエラー:', emergencyError.message);
  }
  
  process.exit(1);
});

// プロセス終了時の最終処理
process.on('exit', (code) => {
  console.log(`\n🏁 プロセス終了: コード ${code}`);
});

// グレースフルシャットダウンハンドラー
const handleGracefulShutdown = async (signal) => {
  console.error(`\n❌ シグナル受信: ${signal}`);
  try {
    await BrowserSessionManager.killAllChromiumProcesses();
    console.log('🔄 緊急クリーンアップ完了');
  } catch (e) {
    console.error('緊急終了処理エラー:', e.message);
  }
  process.exit(1);
};

// 未処理の例外とPromise拒否の最終ハンドリング
process.on('uncaughtException', handleGracefulShutdown);
process.on('unhandledRejection', handleGracefulShutdown);
process.on('SIGINT', handleGracefulShutdown);
process.on('SIGTERM', handleGracefulShutdown); 