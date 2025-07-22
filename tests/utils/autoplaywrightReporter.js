import fs from 'fs';
import path from 'path';

/**
 * AutoPlaywright用カスタムレポーター
 * - 詳細な失敗情報収集
 * - AI分析用データ構造化
 * - USISベースファイル管理
 * - 実行ログの構造化
 */
class AutoPlaywrightReporter {
  constructor(options = {}) {
    this.options = {
      outputDir: options.outputDir || path.join(process.cwd(), 'test-results'),
      enableScreenshots: options.enableScreenshots !== false,
      enableDomSnapshots: options.enableDomSnapshots !== false,
      enableNetworkLogs: options.enableNetworkLogs !== false,
      enableAIAnalysis: options.enableAIAnalysis !== false,
      ...options
    };
    
    this.sessionId = this.generateSessionId();
    this.currentUserStoryId = null;
    this.testMetadata = {};
    this.executionLog = {
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      userStoryId: null,
      steps: [],
      failureAnalysis: {
        patternMatching: [],
        aiSuggestions: [],
        autoFixApplied: false
      },
      performance: {
        startTime: Date.now(),
        endTime: null,
        totalDuration: null
      }
    };
    
    console.log(`📊 AutoPlaywrightReporter初期化: セッションID ${this.sessionId}`);
  }

  /**
   * セッションIDを生成
   */
  generateSessionId() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const random = Math.random().toString(36).substring(2, 8);
    return `${timestamp}_${random}`;
  }

  /**
   * ユーザーストーリー情報を設定
   */
  setUserStoryInfo(userStoryInfo) {
    if (userStoryInfo && userStoryInfo.currentId) {
      this.currentUserStoryId = userStoryInfo.currentId;
      this.executionLog.userStoryId = userStoryInfo.currentId;
      this.executionLog.userStoryContent = userStoryInfo.content;
      console.log(`🔗 レポーター: ユーザーストーリーID ${userStoryInfo.currentId} を設定`);
    }
  }

  /**
   * テストメタデータを設定
   */
  setTestMetadata(metadata) {
    this.testMetadata = {
      route: metadata.route || 'unknown',
      category: metadata.category || 'general',
      targetUrl: metadata.targetUrl || '',
      isFixedRoute: metadata.isFixedRoute || false,
      originalRouteId: metadata.originalRouteId || null,
      ...metadata
    };
    this.executionLog.testMetadata = this.testMetadata;
    console.log(`📋 レポーター: テストメタデータ設定 - ルート: ${this.testMetadata.route}`);
  }

  /**
   * USIS別ディレクトリパスを取得
   */
  getUSISDirectory() {
    const baseDir = this.options.outputDir;
    if (!this.currentUserStoryId) {
      // USISがない場合は共通ディレクトリ
      return path.join(baseDir, 'common');
    }
    return path.join(baseDir, `USIS-${this.currentUserStoryId}`);
  }

  /**
   * ディレクトリを作成
   */
  ensureDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`📁 ディレクトリ作成: ${dirPath}`);
    }
  }

  /**
   * テストステップ開始
   */
  onStepBegin(step, index) {
    const stepId = `step_${index + 1}`;
    const stepLog = {
      stepId,
      index: index + 1,
      label: step.label || `Step ${index + 1}`,
      action: step.action,
      target: step.target,
      value: step.value || null,
      timing: {
        start: new Date().toISOString(),
        startTimestamp: Date.now()
      },
      result: 'running',
      screenshots: [],
      domState: null,
      networkRequests: [],
      consoleErrors: [],
      expectedResult: step.expectedResult || null
    };

    this.executionLog.steps[index] = stepLog;
    console.log(`🔧 ステップ開始: ${stepLog.label} (${stepLog.action})`);
    return stepLog;
  }

  /**
   * テストステップ終了（成功）
   */
  onStepEnd(stepIndex, result = {}) {
    const stepLog = this.executionLog.steps[stepIndex];
    if (!stepLog) return;

    stepLog.timing.end = new Date().toISOString();
    stepLog.timing.endTimestamp = Date.now();
    stepLog.timing.duration = stepLog.timing.endTimestamp - stepLog.timing.startTimestamp;
    stepLog.result = 'success';
    stepLog.actualResult = result.actualResult || null;

    // 成功時も詳細情報を収集（AIの学習データとして価値）
    if (this.options.enableDomSnapshots) {
      stepLog.domState = this.captureDomState();
    }

    console.log(`✅ ステップ成功: ${stepLog.label} (${stepLog.timing.duration}ms)`);
  }

  /**
   * テストステップ失敗
   */
  onStepFailure(stepIndex, error, context = {}) {
    const stepLog = this.executionLog.steps[stepIndex];
    if (!stepLog) return;

    stepLog.timing.end = new Date().toISOString();
    stepLog.timing.endTimestamp = Date.now();
    stepLog.timing.duration = stepLog.timing.endTimestamp - stepLog.timing.startTimestamp;
    stepLog.result = 'failed';
    stepLog.error = {
      message: error.message || error.toString(),
      stack: error.stack || null,
      type: this.classifyErrorType(error),
      context: context
    };

    // 失敗時の詳細情報を収集
    stepLog.failureDetails = this.collectFailureDetails(stepLog, context);

    console.log(`❌ ステップ失敗: ${stepLog.label} - ${stepLog.error.message}`);
    
    // AI分析用データを即座に生成
    if (this.options.enableAIAnalysis) {
      stepLog.aiAnalysisInput = this.generateAIAnalysisInput(stepLog);
    }
  }

  /**
   * エラータイプを分類
   */
  classifyErrorType(error) {
    const message = error.message || error.toString();
    
    if (message.includes('Timeout') || message.includes('timeout')) {
      return 'TIMEOUT';
    } else if (message.includes('not visible') || message.includes('invisible')) {
      return 'ELEMENT_NOT_VISIBLE';
    } else if (message.includes('not found') || message.includes('not exist')) {
      return 'ELEMENT_NOT_FOUND';
    } else if (message.includes('not enabled') || message.includes('disabled')) {
      return 'ELEMENT_DISABLED';
    } else if (message.includes('not clickable')) {
      return 'ELEMENT_NOT_CLICKABLE';
    } else if (message.includes('navigation') || message.includes('page')) {
      return 'NAVIGATION_ERROR';
    } else if (message.includes('network') || message.includes('connection')) {
      return 'NETWORK_ERROR';
    } else {
      return 'UNKNOWN_ERROR';
    }
  }

  /**
   * 失敗詳細情報を収集
   */
  collectFailureDetails(stepLog, context) {
    const details = {
      timestamp: new Date().toISOString(),
      step: {
        action: stepLog.action,
        target: stepLog.target,
        value: stepLog.value,
        expected: stepLog.expectedResult
      },
      errorAnalysis: {
        type: stepLog.error.type,
        category: this.categorizeFailure(stepLog.error),
        severity: this.assessFailureSeverity(stepLog.error),
        suggestions: this.generateImmediateSuggestions(stepLog)
      },
      context: {
        pageUrl: context.pageUrl || null,
        pageTitle: context.pageTitle || null,
        availableElements: context.availableElements || [],
        networkStatus: context.networkStatus || null,
        consoleErrors: context.consoleErrors || []
      }
    };

    // スクリーンショットを保存
    if (this.options.enableScreenshots && context.screenshot) {
      const screenshotPath = this.saveScreenshot(context.screenshot, stepLog.stepId);
      details.screenshotPath = screenshotPath;
    }

    // DOM状態を保存
    if (this.options.enableDomSnapshots && context.domSnapshot) {
      const domPath = this.saveDomSnapshot(context.domSnapshot, stepLog.stepId);
      details.domSnapshotPath = domPath;
    }

    return details;
  }

  /**
   * 失敗カテゴリを分類
   */
  categorizeFailure(error) {
    switch (error.type) {
      case 'ELEMENT_NOT_FOUND':
        return 'SELECTOR_ISSUE';
      case 'ELEMENT_NOT_VISIBLE':
      case 'ELEMENT_DISABLED':
      case 'ELEMENT_NOT_CLICKABLE':
        return 'ELEMENT_STATE_ISSUE';
      case 'TIMEOUT':
        return 'TIMING_ISSUE';
      case 'NAVIGATION_ERROR':
        return 'FLOW_ISSUE';
      case 'NETWORK_ERROR':
        return 'INFRASTRUCTURE_ISSUE';
      default:
        return 'UNKNOWN_ISSUE';
    }
  }

  /**
   * 失敗の重要度を評価
   */
  assessFailureSeverity(error) {
    if (error.type === 'NETWORK_ERROR') return 'HIGH';
    if (error.type === 'NAVIGATION_ERROR') return 'HIGH';
    if (error.type === 'ELEMENT_NOT_FOUND') return 'MEDIUM';
    if (error.type === 'TIMEOUT') return 'MEDIUM';
    return 'LOW';
  }

  /**
   * 即座の修正提案を生成
   */
  generateImmediateSuggestions(stepLog) {
    const suggestions = [];
    const errorType = stepLog.error.type;
    
    switch (errorType) {
      case 'ELEMENT_NOT_FOUND':
        suggestions.push({
          type: 'ALTERNATIVE_SELECTOR',
          description: 'セレクタが変更されている可能性があります',
          action: 'alternative_selector_search'
        });
        break;
      case 'ELEMENT_NOT_VISIBLE':
        suggestions.push({
          type: 'SCROLL_TO_ELEMENT',
          description: '要素が画面外にある可能性があります',
          action: 'scroll_and_retry'
        });
        break;
      case 'TIMEOUT':
        suggestions.push({
          type: 'INCREASE_TIMEOUT',
          description: 'ページの読み込み時間が不足している可能性があります',
          action: 'increase_wait_time'
        });
        break;
    }
    
    return suggestions;
  }

  /**
   * AI分析用データを生成
   */
  generateAIAnalysisInput(stepLog) {
    return {
      step: {
        action: stepLog.action,
        target: stepLog.target,
        value: stepLog.value,
        expected: stepLog.expectedResult
      },
      error: {
        type: stepLog.error.type,
        message: stepLog.error.message,
        category: stepLog.failureDetails?.errorAnalysis?.category
      },
      context: {
        userStoryId: this.currentUserStoryId,
        testRoute: this.testMetadata.route,
        pageContext: stepLog.failureDetails?.context,
        previousSteps: this.executionLog.steps.slice(0, stepLog.index - 1).map(s => ({
          action: s.action,
          target: s.target,
          result: s.result
        }))
      },
      analysisRequest: {
        needsAlternativeSelector: stepLog.error.type === 'ELEMENT_NOT_FOUND',
        needsFlowAnalysis: stepLog.error.type === 'NAVIGATION_ERROR',
        needsTimingAdjustment: stepLog.error.type === 'TIMEOUT',
        confidenceLevel: this.calculateConfidenceLevel(stepLog)
      }
    };
  }

  /**
   * 修正提案の信頼度を計算
   */
  calculateConfidenceLevel(stepLog) {
    let confidence = 0.5; // ベース信頼度
    
    // エラータイプによる調整
    if (stepLog.error.type === 'ELEMENT_NOT_FOUND') confidence += 0.2;
    if (stepLog.error.type === 'ELEMENT_NOT_VISIBLE') confidence += 0.3;
    
    // コンテキスト情報の豊富さによる調整
    const context = stepLog.failureDetails?.context;
    if (context?.availableElements?.length > 0) confidence += 0.2;
    if (context?.pageTitle) confidence += 0.1;
    
    return Math.min(confidence, 1.0);
  }

  /**
   * スクリーンショットを保存
   */
  saveScreenshot(screenshot, stepId) {
    const usisDir = this.getUSISDirectory();
    const screenshotsDir = path.join(usisDir, 'screenshots', this.sessionId);
    this.ensureDirectory(screenshotsDir);
    
    const filename = `${stepId}_failure.png`;
    const filepath = path.join(screenshotsDir, filename);
    
    // 絶対パスと相対パスの両方を記録
    const absolutePath = path.resolve(filepath);
    const relativePath = path.relative(process.cwd(), filepath);
    
    fs.writeFileSync(filepath, screenshot);
    console.log(`📸 スクリーンショット保存: ${filepath}`);
    
    return {
      absolutePath,
      relativePath,
      filename,
      sessionId: this.sessionId,
      userStoryId: this.currentUserStoryId,
      stepId,
      webPath: relativePath.replace(/\\/g, '/'), // Web用のパス
      timestamp: new Date().toISOString()
    };
  }

  /**
   * DOM状態を保存
   */
  saveDomSnapshot(domSnapshot, stepId) {
    const usisDir = this.getUSISDirectory();
    const domDir = path.join(usisDir, 'dom-snapshots', this.sessionId);
    this.ensureDirectory(domDir);
    
    const filename = `${stepId}_dom.html`;
    const filepath = path.join(domDir, filename);
    
    fs.writeFileSync(filepath, domSnapshot, 'utf-8');
    console.log(`🏗️ DOM状態保存: ${filepath}`);
    return filepath;
  }

  /**
   * DOM状態をキャプチャ（プレースホルダー - 実際の実装では page.content() 等を使用）
   */
  captureDomState() {
    // この実装は runScenarios.js 等の実際のブラウザインスタンスから呼び出される
    return {
      timestamp: new Date().toISOString(),
      placeholder: 'DOM state will be captured by browser instance'
    };
  }

  /**
   * テスト完了
   */
  onTestComplete() {
    this.executionLog.performance.endTime = Date.now();
    this.executionLog.performance.totalDuration = 
      this.executionLog.performance.endTime - this.executionLog.performance.startTime;

    // 統計情報を生成
    this.executionLog.summary = this.generateSummary();
    
    // ログファイルを保存
    this.saveExecutionLog();
    
    // AI分析データがある場合は構造化データを保存
    if (this.options.enableAIAnalysis) {
      this.saveAIAnalysisData();
    }

    console.log(`🎯 テスト完了: ${this.executionLog.summary.totalSteps}ステップ, 成功率${this.executionLog.summary.successRate}%`);
  }

  /**
   * 実行サマリーを生成
   */
  generateSummary() {
    const steps = this.executionLog.steps;
    const totalSteps = steps.length;
    const successfulSteps = steps.filter(s => s.result === 'success').length;
    const failedSteps = steps.filter(s => s.result === 'failed').length;
    
    return {
      totalSteps,
      successfulSteps,
      failedSteps,
      successRate: totalSteps > 0 ? (successfulSteps / totalSteps * 100).toFixed(1) : 0,
      averageStepDuration: this.calculateAverageStepDuration(),
      failuresByType: this.categorizeFailures(),
      aiSuggestionsGenerated: steps.filter(s => s.aiAnalysisInput).length
    };
  }

  /**
   * 平均ステップ実行時間を計算
   */
  calculateAverageStepDuration() {
    const completedSteps = this.executionLog.steps.filter(s => s.timing.duration);
    if (completedSteps.length === 0) return 0;
    
    const totalDuration = completedSteps.reduce((sum, step) => sum + step.timing.duration, 0);
    return Math.round(totalDuration / completedSteps.length);
  }

  /**
   * 失敗を種類別に集計
   */
  categorizeFailures() {
    const failures = this.executionLog.steps.filter(s => s.result === 'failed');
    const categories = {};
    
    failures.forEach(step => {
      const type = step.error?.type || 'UNKNOWN';
      categories[type] = (categories[type] || 0) + 1;
    });
    
    return categories;
  }

  /**
   * 実行ログを保存
   */
  saveExecutionLog() {
    const usisDir = this.getUSISDirectory();
    const logsDir = path.join(usisDir, 'execution-logs');
    this.ensureDirectory(logsDir);
    
    const filename = `execution_${this.sessionId}.json`;
    const filepath = path.join(logsDir, filename);
    
    fs.writeFileSync(filepath, JSON.stringify(this.executionLog, null, 2), 'utf-8');
    console.log(`📋 実行ログ保存: ${filepath}`);
    
    return filepath;
  }

  /**
   * AI分析用データを保存
   */
  saveAIAnalysisData() {
    const failedSteps = this.executionLog.steps.filter(s => s.result === 'failed' && s.aiAnalysisInput);
    if (failedSteps.length === 0) return;

    const aiData = {
      sessionId: this.sessionId,
      userStoryId: this.currentUserStoryId,
      testMetadata: this.testMetadata,
      timestamp: new Date().toISOString(),
      failureAnalysis: failedSteps.map(step => ({
        stepId: step.stepId,
        analysisInput: step.aiAnalysisInput,
        failureDetails: step.failureDetails,
        immediateSuggestions: step.failureDetails?.errorAnalysis?.suggestions || []
      }))
    };

    const usisDir = this.getUSISDirectory();
    const aiDir = path.join(usisDir, 'ai-analysis');
    this.ensureDirectory(aiDir);
    
    const filename = `ai_analysis_${this.sessionId}.json`;
    const filepath = path.join(aiDir, filename);
    
    fs.writeFileSync(filepath, JSON.stringify(aiData, null, 2), 'utf-8');
    console.log(`🤖 AI分析データ保存: ${filepath}`);
    
    return filepath;
  }

  /**
   * レポートサマリーを生成（既存システムとの互換性）
   */
  generateCompatibilityReport() {
    const steps = this.executionLog.steps;
    
    return {
      route_id: this.testMetadata.route || this.sessionId,
      timestamp: this.executionLog.timestamp,
      total_steps: steps.length,
      success_count: steps.filter(s => s.result === 'success').length,
      failed_count: steps.filter(s => s.result === 'failed').length,
      success: steps.every(s => s.result === 'success'),
      execution_time: this.executionLog.performance.totalDuration,
      is_fixed_route: this.testMetadata.isFixedRoute,
      original_route_id: this.testMetadata.originalRouteId,
      steps: steps.map(step => ({
        label: step.label,
        action: step.action,
        target: step.target,
        value: step.value,
        status: step.result === 'success' ? 'success' : (step.result === 'failed' ? 'failed' : 'unknown'),
        error: step.error?.message || null,
        isFixed: step.isFixed || false,
        fixReason: step.fixReason || null
      })),
      // レポーター拡張情報
      reporterMetadata: {
        sessionId: this.sessionId,
        userStoryId: this.currentUserStoryId,
        hasDetailedLogs: true,
        hasAIAnalysis: this.options.enableAIAnalysis,
        usisDirectory: this.getUSISDirectory()
      }
    };
  }
}

export default AutoPlaywrightReporter; 