const fs = require('fs').promises;
const path = require('path');
const DirectoryManager = require('./directory-manager.cjs');
const FileWriter = require('./file-writer.cjs');

/**
 * @typedef {Object} OutputConfig
 * @property {string} baseDir
 * @property {boolean} enableArchiving
 * @property {number} maxRetentionDays
 * @property {boolean} compressionEnabled
 * @property {Object} formats
 * @property {'html'|'json'|'markdown'|'all'} formats.reports
 * @property {'png'|'jpg'} formats.screenshots
 * @property {boolean} formats.traces
 */

/**
 * @typedef {Object} TestSession
 * @property {string} sessionId
 * @property {Date} startTime
 * @property {Object} config
 * @property {string} basePath
 * @property {'running'|'completed'|'failed'|'archived'} status
 */

/**
 * AutoPlaywright テスト結果出力管理のメインクラス
 * テスト実行時に生成される各種ファイルを構造化されたディレクトリで管理する
 */
class OutputManager {
  /**
   * @param {OutputConfig} config 出力設定
   */
  constructor(config = {}) {
    this.config = {
      baseDir: 'test-results',
      enableArchiving: true,
      maxRetentionDays: 30,
      compressionEnabled: true,
      formats: {
        reports: 'html',
        screenshots: 'png',
        traces: true
      },
      ...config
    };
    
    this.directoryManager = new DirectoryManager(this.config.baseDir);
    this.fileWriter = new FileWriter(this.config);
    this.activeSessions = new Map();
  }

  /**
   * テスト実行セッションを開始
   * @param {string} [sessionId] セッションID（省略時は自動生成）
   * @returns {Promise<TestSession>} 作成されたセッション情報
   */
  async startSession(sessionId) {
    try {
      // セッションID生成
      if (!sessionId) {
        sessionId = this._generateSessionId();
      }

      // セッションディレクトリ作成
      const sessionPath = await this.directoryManager.createSessionDirectory(sessionId);
      
      // アーティファクト・結果ディレクトリ作成
      await Promise.all([
        this.directoryManager.createArtifactDirectories(sessionPath),
        this.directoryManager.createResultDirectories(sessionPath)
      ]);

      const session = {
        sessionId,
        startTime: new Date(),
        config: { ...this.config },
        basePath: sessionPath,
        status: 'running'
      };

      // セッション情報保存
      await this._saveSessionConfig(sessionId, session);
      this.activeSessions.set(sessionId, session);

      // 最新セッションへのシンボリックリンク更新
      await this.directoryManager.createSymbolicLink(sessionPath, path.join(this.config.baseDir, 'latest'));

      console.log(`🚀 テストセッション開始: ${sessionId}`);
      return session;
    } catch (error) {
      console.error(`❌ セッション開始失敗: ${error.message}`);
      throw new Error(`Failed to start session: ${error.message}`);
    }
  }

  /**
   * テスト観点データを保存
   * @param {string} sessionId セッションID
   * @param {Array} points テスト観点データ
   * @returns {Promise<string>} 保存されたファイルパス
   */
  async writeTestPoints(sessionId, points) {
    try {
      const filename = `test-points_${sessionId}.json`;
      const filePath = this.directoryManager.resolveArtifactPath(sessionId, 'test-points', filename);
      
      await this.fileWriter.writeJSON(filePath, points);
      console.log(`📝 テスト観点保存: ${filename}`);
      return filePath;
    } catch (error) {
      console.error(`❌ テスト観点保存失敗: ${error.message}`);
      throw error;
    }
  }

  /**
   * テストケースを保存
   * @param {string} sessionId セッションID
   * @param {Object} testCase テストケースデータ
   * @returns {Promise<string>} 保存されたファイルパス
   */
  async writeTestCase(sessionId, testCase) {
    try {
      const filename = `test-case_${testCase.id}.md`;
      const filePath = this.directoryManager.resolveArtifactPath(sessionId, 'test-cases', filename);
      
      const markdown = this._formatTestCaseAsMarkdown(testCase);
      await this.fileWriter.writeText(filePath, markdown);
      console.log(`📋 テストケース保存: ${filename}`);
      return filePath;
    } catch (error) {
      console.error(`❌ テストケース保存失敗: ${error.message}`);
      throw error;
    }
  }

  /**
   * Playwrightスクリプトを保存
   * @param {string} sessionId セッションID
   * @param {Object} script スクリプトデータ
   * @returns {Promise<string>} 保存されたファイルパス
   */
  async writeScript(sessionId, script) {
    try {
      const filename = `${script.filename || script.id}.spec.js`;
      const filePath = this.directoryManager.resolveArtifactPath(sessionId, 'scripts', filename);
      
      await this.fileWriter.writeText(filePath, script.content);
      console.log(`🎬 スクリプト保存: ${filename}`);
      return filePath;
    } catch (error) {
      console.error(`❌ スクリプト保存失敗: ${error.message}`);
      throw error;
    }
  }

  /**
   * DOMスナップショットを保存
   * @param {string} sessionId セッションID
   * @param {Object} snapshot スナップショットデータ
   * @returns {Promise<string>} 保存されたファイルパス
   */
  async writeDOMSnapshot(sessionId, snapshot) {
    try {
      const filename = `snapshot_${snapshot.testId}_step${snapshot.stepNumber}.html`;
      const filePath = this.directoryManager.resolveArtifactPath(sessionId, 'dom-snapshots', filename);
      
      await this.fileWriter.writeText(filePath, snapshot.html);
      
      // スクリーンショットがある場合は同時保存
      if (snapshot.screenshot) {
        const screenshotFilename = `snapshot_${snapshot.testId}_step${snapshot.stepNumber}.png`;
        const screenshotPath = this.directoryManager.resolveArtifactPath(sessionId, 'dom-snapshots', screenshotFilename);
        await this.fileWriter.writeBinary(screenshotPath, snapshot.screenshot);
      }
      
      console.log(`📸 DOMスナップショット保存: ${filename}`);
      return filePath;
    } catch (error) {
      console.error(`❌ DOMスナップショット保存失敗: ${error.message}`);
      throw error;
    }
  }

  /**
   * テスト実行結果を保存
   * @param {string} sessionId セッションID
   * @param {Object} result テスト結果データ
   * @returns {Promise<void>}
   */
  async saveTestResult(sessionId, result) {
    try {
      const filename = `result_${result.testId}.json`;
      const filePath = this.directoryManager.resolveResultPath(sessionId, 'reports', filename);
      
      await this.fileWriter.writeJSON(filePath, result);
      console.log(`✅ テスト結果保存: ${filename}`);
    } catch (error) {
      console.error(`❌ テスト結果保存失敗: ${error.message}`);
      throw error;
    }
  }

  /**
   * スクリーンショットを保存
   * @param {string} sessionId セッションID
   * @param {Buffer} screenshot スクリーンショットデータ
   * @param {Object} metadata メタデータ
   * @returns {Promise<string>} 保存されたファイルパス
   */
  async saveScreenshot(sessionId, screenshot, metadata) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `screenshot_${metadata.testId}_${timestamp}.png`;
      const filePath = this.directoryManager.resolveResultPath(sessionId, 'screenshots', filename);
      
      await this.fileWriter.writeBinary(filePath, screenshot);
      console.log(`📷 スクリーンショット保存: ${filename}`);
      return filePath;
    } catch (error) {
      console.error(`❌ スクリーンショット保存失敗: ${error.message}`);
      throw error;
    }
  }

  /**
   * ログエントリを保存
   * @param {string} sessionId セッションID
   * @param {Object} logEntry ログエントリ
   * @returns {Promise<void>}
   */
  async saveLog(sessionId, logEntry) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `execution_${timestamp}.log`;
      const filePath = this.directoryManager.resolveResultPath(sessionId, 'logs', filename);
      
      const logLine = `[${logEntry.timestamp}] ${logEntry.level.toUpperCase()}: ${logEntry.message}\n`;
      await this.fileWriter.appendText(filePath, logLine);
    } catch (error) {
      console.error(`❌ ログ保存失敗: ${error.message}`);
      throw error;
    }
  }

  /**
   * セッションを終了
   * @param {string} sessionId セッションID
   * @returns {Promise<Object>} セッションサマリ
   */
  async endSession(sessionId) {
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }

      session.status = 'completed';
      session.endTime = new Date();

      // セッションサマリ生成
      const summary = await this._generateSessionSummary(sessionId, session);
      
      // メタデータ保存
      await this._saveSessionMetadata(sessionId, summary);
      
      this.activeSessions.delete(sessionId);
      console.log(`🏁 テストセッション終了: ${sessionId}`);
      
      return summary;
    } catch (error) {
      console.error(`❌ セッション終了失敗: ${error.message}`);
      throw error;
    }
  }

  /**
   * セッションIDを生成
   * @returns {string} 生成されたセッションID
   * @private
   */
  _generateSessionId() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    const second = String(now.getSeconds()).padStart(2, '0');
    
    return `${year}-${month}-${day}_${hour}-${minute}-${second}`;
  }

  /**
   * テストケースをMarkdown形式にフォーマット
   * @param {Object} testCase テストケース
   * @returns {string} Markdown形式の文字列
   * @private
   */
  _formatTestCaseAsMarkdown(testCase) {
    let markdown = `# ${testCase.title}\n\n`;
    markdown += `**ID:** ${testCase.id}\n\n`;
    markdown += `**説明:** ${testCase.description}\n\n`;
    
    if (testCase.steps && testCase.steps.length > 0) {
      markdown += `## テスト手順\n\n`;
      testCase.steps.forEach((step, index) => {
        markdown += `${index + 1}. ${step.description || step.action}\n`;
      });
      markdown += '\n';
    }
    
    if (testCase.expectedResults && testCase.expectedResults.length > 0) {
      markdown += `## 期待結果\n\n`;
      testCase.expectedResults.forEach((result, index) => {
        markdown += `${index + 1}. ${result}\n`;
      });
    }
    
    return markdown;
  }

  /**
   * セッション設定を保存
   * @param {string} sessionId セッションID
   * @param {Object} session セッション情報
   * @private
   */
  async _saveSessionConfig(sessionId, session) {
    const configPath = this.directoryManager.resolveSessionPath(sessionId, 'config', 'run-config.json');
    await this.fileWriter.writeJSON(configPath, session);
  }

  /**
   * セッションサマリを生成
   * @param {string} sessionId セッションID
   * @param {Object} session セッション情報
   * @returns {Promise<Object>} セッションサマリ
   * @private
   */
  async _generateSessionSummary(sessionId, session) {
    // 簡単なサマリ生成（後でレポート生成機能で拡張）
    return {
      sessionId,
      startTime: session.startTime,
      endTime: session.endTime,
      duration: session.endTime - session.startTime,
      status: session.status,
      basePath: session.basePath
    };
  }

  /**
   * セッションメタデータを保存
   * @param {string} sessionId セッションID
   * @param {Object} summary セッションサマリ
   * @private
   */
  async _saveSessionMetadata(sessionId, summary) {
    const metadataPath = this.directoryManager.resolveSessionPath(sessionId, 'metadata', 'summary.json');
    await this.fileWriter.writeJSON(metadataPath, summary);
  }
}

module.exports = OutputManager;
