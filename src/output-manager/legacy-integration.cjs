const fs = require('fs').promises;
const path = require('path');
const OutputManager = require('./index.cjs');

/**
 * 既存AutoPlaywrightシステムとOutputManagerの統合クラス
 * USISDirectoryManagerとAutoPlaywrightReporterの機能を新システムに移行
 */
class LegacyIntegrationManager {
  /**
   * @param {Object} options 統合オプション
   */
  constructor(options = {}) {
    this.options = {
      enableUSISCompatibility: true,
      enableReporterCompatibility: true,
      migrationMode: 'hybrid', // 'hybrid', 'new-only', 'legacy-only'
      baseDir: 'test-results',
      ...options
    };
    
    this.outputManager = null;
    this.currentSessionId = null;
    this.userStoryId = null;
    this.legacyReporter = null;
  }

  /**
   * 統合システムを初期化
   * @param {Object} config 設定オブジェクト
   * @returns {Promise<void>}
   */
  async initialize(config = {}) {
    try {
      // OutputManagerを初期化
      this.outputManager = new OutputManager(config);
      
      // 既存のconfig.jsonからユーザーストーリー情報を読み取り
      await this._loadUserStoryInfo();
      
      console.log(`🔗 統合システム初期化完了 (モード: ${this.options.migrationMode})`);
      if (this.userStoryId) {
        console.log(`📋 ユーザーストーリーID: USIS-${this.userStoryId}`);
      }
      
    } catch (error) {
      throw new Error(`Integration initialization failed: ${error.message}`);
    }
  }

  /**
   * テストセッションを開始（既存システムとの互換性維持）
   * @param {Object} testMetadata テストメタデータ
   * @returns {Promise<Object>} セッション情報
   */
  async startTestSession(testMetadata = {}) {
    try {
      // 新しいOutputManagerでセッション開始
      const session = await this.outputManager.startSession();
      this.currentSessionId = session.sessionId;
      
      // 既存のUSIS構造も並行して作成（ハイブリッドモード）
      if (this.options.migrationMode === 'hybrid' && this.userStoryId) {
        await this._createLegacyUSISStructure();
      }
      
      // セッションメタデータを拡張
      const enhancedSession = {
        ...session,
        userStoryId: this.userStoryId,
        usisDirectory: this.userStoryId ? `USIS-${this.userStoryId}` : 'common',
        legacyCompatible: true,
        testMetadata
      };
      
      console.log(`🚀 統合テストセッション開始: ${session.sessionId}`);
      if (this.userStoryId) {
        console.log(`📂 USIS対応ディレクトリ: USIS-${this.userStoryId}`);
      }
      
      return enhancedSession;
      
    } catch (error) {
      throw new Error(`Failed to start integrated test session: ${error.message}`);
    }
  }

  /**
   * ステップ実行時の結果保存（既存互換インターフェース）
   * @param {Object} step ステップ情報
   * @param {number} stepIndex ステップインデックス
   * @param {Object} result 実行結果
   * @returns {Promise<void>}
   */
  async onStepComplete(step, stepIndex, result) {
    if (!this.currentSessionId) {
      throw new Error('No active session. Call startTestSession first.');
    }

    try {
      // 新しいシステムでログ保存
      await this.outputManager.saveLog(this.currentSessionId, {
        timestamp: new Date().toISOString(),
        level: result.success ? 'info' : 'error',
        message: `Step ${stepIndex + 1}: ${step.label || step.action} - ${result.success ? 'SUCCESS' : 'FAILED'}`,
        step: {
          index: stepIndex,
          label: step.label,
          action: step.action,
          target: step.target,
          value: step.value,
          success: result.success,
          error: result.error
        }
      });

      // 既存のUSIS構造にも保存（ハイブリッドモード）
      if (this.options.migrationMode === 'hybrid') {
        await this._saveLegacyExecutionLog(step, stepIndex, result);
      }
      
    } catch (error) {
      console.warn(`⚠️ ステップ結果保存エラー: ${error.message}`);
    }
  }

  /**
   * スクリーンショット保存（既存互換）
   * @param {Buffer} screenshot スクリーンショットデータ
   * @param {Object} metadata メタデータ
   * @returns {Promise<string>} 保存パス
   */
  async saveScreenshot(screenshot, metadata) {
    if (!this.currentSessionId) {
      throw new Error('No active session. Call startTestSession first.');
    }

    try {
      // 新しいシステムで保存
      const newPath = await this.outputManager.saveScreenshot(
        this.currentSessionId, 
        screenshot, 
        metadata
      );
      
      // 既存のUSIS構造にも保存（ハイブリッドモード）
      if (this.options.migrationMode === 'hybrid') {
        const legacyPath = await this._saveLegacyScreenshot(screenshot, metadata);
        console.log(`📸 スクリーンショット保存: 新形式(${path.basename(newPath)}) + USIS(${path.basename(legacyPath)})`);
        return { newPath, legacyPath };
      }
      
      console.log(`📸 スクリーンショット保存: ${path.basename(newPath)}`);
      return newPath;
      
    } catch (error) {
      throw new Error(`Failed to save screenshot: ${error.message}`);
    }
  }

  /**
   * DOMスナップショット保存（既存互換）
   * @param {Object} snapshot スナップショット情報
   * @returns {Promise<string>} 保存パス
   */
  async saveDOMSnapshot(snapshot) {
    if (!this.currentSessionId) {
      throw new Error('No active session. Call startTestSession first.');
    }

    try {
      // 新しいシステムで保存
      const newPath = await this.outputManager.writeDOMSnapshot(this.currentSessionId, snapshot);
      
      // 既存のUSIS構造にも保存（ハイブリッドモード）
      if (this.options.migrationMode === 'hybrid') {
        const legacyPath = await this._saveLegacyDOMSnapshot(snapshot);
        console.log(`🏗️ DOM状態保存: 新形式(${path.basename(newPath)}) + USIS(${path.basename(legacyPath)})`);
        return { newPath, legacyPath };
      }
      
      console.log(`🏗️ DOM状態保存: ${path.basename(newPath)}`);
      return newPath;
      
    } catch (error) {
      throw new Error(`Failed to save DOM snapshot: ${error.message}`);
    }
  }

  /**
   * AI分析データ保存（既存互換）
   * @param {Object} analysisData AI分析データ
   * @returns {Promise<string>} 保存パス
   */
  async saveAIAnalysis(analysisData) {
    if (!this.currentSessionId) {
      throw new Error('No active session. Call startTestSession first.');
    }

    try {
      // 新しいシステムで保存（results/reports配下）
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `ai_analysis_${this.currentSessionId}_${timestamp}.json`;
      
      const filePath = this.outputManager.directoryManager.resolveResultPath(
        this.currentSessionId, 
        'reports', 
        filename
      );
      
      await this.outputManager.fileWriter.writeJSON(filePath, analysisData);
      
      // 既存のUSIS構造にも保存（ハイブリッドモード）
      if (this.options.migrationMode === 'hybrid') {
        const legacyPath = await this._saveLegacyAIAnalysis(analysisData);
        console.log(`🤖 AI分析データ保存: 新形式(${filename}) + USIS(${path.basename(legacyPath)})`);
        return { newPath: filePath, legacyPath };
      }
      
      console.log(`🤖 AI分析データ保存: ${filename}`);
      return filePath;
      
    } catch (error) {
      throw new Error(`Failed to save AI analysis: ${error.message}`);
    }
  }

  /**
   * テスト完了処理（既存互換）
   * @param {Object} testResult テスト結果サマリ
   * @returns {Promise<Object>} 完了レポート
   */
  async completeTest(testResult) {
    if (!this.currentSessionId) {
      throw new Error('No active session. Call startTestSession first.');
    }

    try {
      // 新しいシステムでテスト結果保存
      await this.outputManager.saveTestResult(this.currentSessionId, testResult);
      
      // セッション終了
      const sessionSummary = await this.outputManager.endSession(this.currentSessionId);
      
      // 統合レポート生成
      const integrationReport = {
        sessionSummary,
        testResult,
        userStoryId: this.userStoryId,
        paths: {
          newFormat: sessionSummary.basePath,
          usisFormat: this.userStoryId ? path.join(this.options.baseDir, `USIS-${this.userStoryId}`) : null
        },
        compatibility: {
          migrationMode: this.options.migrationMode,
          legacySupported: this.options.migrationMode === 'hybrid'
        }
      };
      
      console.log(`🏁 統合テスト完了: ${this.currentSessionId}`);
      if (this.userStoryId) {
        console.log(`📂 USIS結果: USIS-${this.userStoryId}`);
      }
      console.log(`📂 新形式結果: ${sessionSummary.basePath}`);
      
      return integrationReport;
      
    } catch (error) {
      throw new Error(`Failed to complete integrated test: ${error.message}`);
    }
  }

  /**
   * 既存USISDirectoryManagerとの互換インターフェース
   * @returns {Object} USIS互換オブジェクト
   */
  getUSISCompatibleManager() {
    return {
      getUSISDirectory: () => {
        if (this.userStoryId) {
          return path.join(this.options.baseDir, `USIS-${this.userStoryId}`);
        }
        return path.join(this.options.baseDir, 'common');
      },
      
      getCurrentSessionPath: () => {
        if (this.currentSessionId) {
          return this.outputManager.directoryManager.sessionPaths.get(this.currentSessionId);
        }
        return null;
      },
      
      saveExecutionLog: async (logData) => {
        if (this.currentSessionId) {
          await this.outputManager.saveLog(this.currentSessionId, logData);
        }
      }
    };
  }

  // プライベートメソッド

  /**
   * config.jsonからユーザーストーリー情報を読み込み
   * @private
   */
  async _loadUserStoryInfo() {
    try {
      const configPath = path.join(process.cwd(), 'config.json');
      const configContent = await fs.readFile(configPath, 'utf8');
      const config = JSON.parse(configContent);
      
      if (config.userStory && config.userStory.currentId) {
        this.userStoryId = config.userStory.currentId;
        console.log(`📋 ユーザーストーリー設定読み込み: USIS-${this.userStoryId}`);
      }
    } catch (error) {
      console.log('⚠️ ユーザーストーリー情報なし、共通ディレクトリを使用');
    }
  }

  /**
   * 既存USIS構造を作成
   * @private
   */
  async _createLegacyUSISStructure() {
    const usisDir = path.join(this.options.baseDir, `USIS-${this.userStoryId}`);
    const subdirs = [
      'execution-logs',
      'screenshots', 
      'dom-snapshots',
      'ai-analysis',
      'reports'
    ];

    await this.outputManager.directoryManager.ensureDirectoryExists(usisDir);
    
    for (const subdir of subdirs) {
      await this.outputManager.directoryManager.ensureDirectoryExists(
        path.join(usisDir, subdir)
      );
    }
  }

  /**
   * 既存形式で実行ログ保存
   * @private
   */
  async _saveLegacyExecutionLog(step, stepIndex, result) {
    if (!this.userStoryId) return;
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `execution_${timestamp}.json`;
    const legacyPath = path.join(
      this.options.baseDir,
      `USIS-${this.userStoryId}`,
      'execution-logs',
      filename
    );

    const logData = {
      timestamp: new Date().toISOString(),
      sessionId: this.currentSessionId,
      step: {
        index: stepIndex,
        label: step.label,
        action: step.action,
        target: step.target,
        value: step.value
      },
      result
    };

    await this.outputManager.fileWriter.writeJSON(legacyPath, logData);
    return legacyPath;
  }

  /**
   * 既存形式でスクリーンショット保存
   * @private
   */
  async _saveLegacyScreenshot(screenshot, metadata) {
    if (!this.userStoryId) return null;
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `step_${metadata.stepName || 'unknown'}_${timestamp}.png`;
    const legacyPath = path.join(
      this.options.baseDir,
      `USIS-${this.userStoryId}`,
      'screenshots',
      this.currentSessionId,
      filename
    );

    await this.outputManager.directoryManager.ensureDirectoryExists(path.dirname(legacyPath));
    await this.outputManager.fileWriter.writeBinary(legacyPath, screenshot);
    return legacyPath;
  }

  /**
   * 既存形式でDOMスナップショット保存
   * @private
   */
  async _saveLegacyDOMSnapshot(snapshot) {
    if (!this.userStoryId) return null;
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${snapshot.testId}_step${snapshot.stepNumber}_dom.html`;
    const legacyPath = path.join(
      this.options.baseDir,
      `USIS-${this.userStoryId}`,
      'dom-snapshots',
      this.currentSessionId,
      filename
    );

    await this.outputManager.directoryManager.ensureDirectoryExists(path.dirname(legacyPath));
    await this.outputManager.fileWriter.writeText(legacyPath, snapshot.html);
    return legacyPath;
  }

  /**
   * 既存形式でAI分析保存
   * @private
   */
  async _saveLegacyAIAnalysis(analysisData) {
    if (!this.userStoryId) return null;
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `ai_analysis_${this.currentSessionId}_${timestamp}.json`;
    const legacyPath = path.join(
      this.options.baseDir,
      `USIS-${this.userStoryId}`,
      'ai-analysis',
      filename
    );

    await this.outputManager.fileWriter.writeJSON(legacyPath, analysisData);
    return legacyPath;
  }
}

module.exports = LegacyIntegrationManager; 