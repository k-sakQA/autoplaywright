const fs = require('fs').promises;
const path = require('path');
const DirectoryManager = require('./directory-manager.cjs');
const FileWriter = require('./file-writer.cjs');
const ConfigLoader = require('./utils/config-loader.cjs');

// 🆕 Phase 2: レポート生成機能を追加
const ReportGenerator = require('./report-generator.cjs');
const FileManifestManager = require('./file-manifest-manager.cjs');

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
 * OutputManager - AutoPlaywrightテスト出力管理のメインクラス
 * Phase 1: 基本的なファイル出力・セッション管理
 * Phase 2: 統合レポート・アーカイブ・エラーハンドリング強化
 */
class OutputManager {
  /**
   * @param {Object} config 設定オブジェクト
   */
  constructor(config = {}) {
    this.config = {
      baseDir: 'test-results',
      ...config
    };
    this.directoryManager = new DirectoryManager(this.config.baseDir);
    this.fileWriter = new FileWriter(this.config);
    
    // 🆕 Phase 2: レポート生成機能を初期化
    this.reportGenerator = new ReportGenerator(this);
    this.fileManifestManager = new FileManifestManager(this);
    
    // セッション管理
    this.sessionPaths = new Map();
    this.activeSessionIds = new Set();
    
    console.log('🔧 OutputManager初期化完了 (Phase 2対応)');
  }

  /**
   * セッションを開始
   * @returns {Promise<Object>} セッション情報
   */
  async startSession() {
    try {
      const sessionId = this._generateSessionId();
      const sessionPath = await this.directoryManager.createSessionStructure(sessionId);
      
      this.sessionPaths.set(sessionId, sessionPath);
      this.activeSessionIds.add(sessionId);
      
      // セッション開始メタデータを作成
      const sessionMetadata = {
        sessionId,
        startTime: new Date().toISOString(),
        basePath: sessionPath,
        status: 'active',
        testResults: [],
        artifacts: [],
        phase: 2 // 🆕 Phase 2対応を示すフラグ
      };
      
      // メタデータを保存
      const metadataPath = this.directoryManager.resolveMetadataPath(sessionId, 'summary.json');
      await this.fileWriter.writeJSON(metadataPath, sessionMetadata);
      
      console.log(`🚀 セッション開始: ${sessionId}`);
      return sessionMetadata;
      
    } catch (error) {
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
      if (!this.activeSessionIds.has(sessionId)) {
        throw new Error(`Session ${sessionId} is not active`);
      }
      
      // セッションメタデータを更新
      const metadataPath = this.directoryManager.resolveMetadataPath(sessionId, 'summary.json');
      
      let sessionMetadata;
      try {
        const content = await this.fileWriter.readFile(metadataPath);
        sessionMetadata = JSON.parse(content);
      } catch (error) {
        throw new Error(`Failed to read session metadata: ${error.message}`);
      }
      
      sessionMetadata.endTime = new Date().toISOString();
      sessionMetadata.status = 'completed';
      sessionMetadata.duration = new Date(sessionMetadata.endTime) - new Date(sessionMetadata.startTime);
      
      // 🆕 Phase 2: ファイルマニフェストを生成
      await this._generateFileManifest(sessionId, sessionMetadata);
      
      // メタデータを保存
      await this.fileWriter.writeJSON(metadataPath, sessionMetadata);
      
      // latest リンクを更新
      await this.directoryManager.updateLatestLink(sessionId);
      
      // アクティブセッションから削除
      this.activeSessionIds.delete(sessionId);
      
      console.log(`🏁 セッション終了: ${sessionId} (${Math.round(sessionMetadata.duration / 1000)}秒)`);
      
      return sessionMetadata;
      
    } catch (error) {
      throw new Error(`Failed to end session: ${error.message}`);
    }
  }

  /**
   * 統合ダッシュボードを生成
   * @param {Object} options 生成オプション
   * @returns {Promise<string>} 生成されたダッシュボードのパス
   */
  async generateDashboard(options = {}) {
    try {
      console.log('📊 統合ダッシュボード生成を開始...');
      return await this.reportGenerator.generateDashboard(options);
    } catch (error) {
      throw new Error(`Dashboard generation failed: ${error.message}`);
    }
  }

  /**
   * セッション比較レポートを生成
   * @param {string[]} sessionIds 比較対象のセッションIDリスト
   * @returns {Promise<string>} 生成されたレポートのパス
   */
  async generateComparisonReport(sessionIds) {
    try {
      console.log(`📈 セッション比較レポート生成を開始: ${sessionIds.length}件`);
      return await this.reportGenerator.generateComparisonReport(sessionIds);
    } catch (error) {
      throw new Error(`Comparison report generation failed: ${error.message}`);
    }
  }

  /**
   * トレンドレポートを生成
   * @param {Object} options 生成オプション
   * @returns {Promise<string>} 生成されたレポートのパス
   */
  async generateTrendReport(options = {}) {
    try {
      console.log('📊 トレンドレポート生成を開始...');
      return await this.reportGenerator.generateTrendReport(options);
    } catch (error) {
      throw new Error(`Trend report generation failed: ${error.message}`);
    }
  }

  /**
   * 🆕 グローバルファイルマニフェストを生成
   * @returns {Promise<Object>} グローバルマニフェスト
   */
  async generateGlobalManifest() {
    try {
      console.log('📋 グローバルファイルマニフェスト生成を開始...');
      return await this.fileManifestManager.generateGlobalManifest();
    } catch (error) {
      throw new Error(`Global manifest generation failed: ${error.message}`);
    }
  }

  /**
   * 🆕 ファイル検索機能
   * @param {Object} criteria 検索条件
   * @returns {Promise<Array>} 検索結果
   */
  async searchFiles(criteria = {}) {
    try {
      console.log('🔍 ファイル検索を開始...');
      return await this.fileManifestManager.searchFiles(criteria);
    } catch (error) {
      throw new Error(`File search failed: ${error.message}`);
    }
  }

  /**
   * 🆕 ファイル統計レポートを生成
   * @returns {Promise<Object>} 統計レポート
   */
  async generateFileStatistics() {
    try {
      console.log('📊 ファイル統計レポート生成を開始...');
      return await this.fileManifestManager.generateFileStatistics();
    } catch (error) {
      throw new Error(`File statistics generation failed: ${error.message}`);
    }
  }

  /**
   * 🆕 重複ファイルを検出
   * @returns {Promise<Array>} 重複ファイル一覧
   */
  async findDuplicateFiles() {
    try {
      console.log('🔍 重複ファイル検出を開始...');
      return await this.fileManifestManager.findDuplicateFiles();
    } catch (error) {
      throw new Error(`Duplicate file detection failed: ${error.message}`);
    }
  }

  /**
   * 利用可能なセッション一覧を取得
   * @returns {Promise<Array>} セッション一覧
   */
  async getAvailableSessions() {
    try {
      const runsDir = path.join(this.directoryManager.baseDir, 'runs');
      
      try {
        const sessionDirs = await fs.readdir(runsDir);
        const sessions = [];
        
        for (const sessionDir of sessionDirs) {
          if (/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(sessionDir)) {
            try {
              const summaryPath = path.join(runsDir, sessionDir, 'metadata', 'summary.json');
              const summaryContent = await fs.readFile(summaryPath, 'utf8');
              const summary = JSON.parse(summaryContent);
              
              sessions.push({
                sessionId: sessionDir,
                ...summary
              });
            } catch (error) {
              console.warn(`⚠️ セッション ${sessionDir} のメタデータ読み込みに失敗: ${error.message}`);
            }
          }
        }
        
        return sessions.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
        
      } catch (error) {
        console.warn('⚠️ runs ディレクトリが見つかりません');
        return [];
      }
      
    } catch (error) {
      throw new Error(`Failed to get available sessions: ${error.message}`);
    }
  }

  /**
   * ファイルマニフェストを生成
   * @private
   */
  async _generateFileManifest(sessionId, sessionMetadata) {
    try {
      const sessionPath = this.sessionPaths.get(sessionId);
      if (!sessionPath) {
        throw new Error(`Session path not found for ${sessionId}`);
      }
      
      const manifest = {
        sessionId,
        generatedAt: new Date().toISOString(),
        files: [],
        directories: [],
        summary: {
          totalFiles: 0,
          totalSize: 0,
          artifactCount: 0,
          resultCount: 0
        }
      };
      
      // ディレクトリ構造をスキャン
      await this._scanDirectory(sessionPath, manifest, sessionPath);
      
      // マニフェストを保存
      const manifestPath = this.directoryManager.resolveMetadataPath(sessionId, 'file-manifest.json');
      await this.fileWriter.writeJSON(manifestPath, manifest);
      
      console.log(`📋 ファイルマニフェスト生成完了: ${manifest.summary.totalFiles}ファイル`);
      
    } catch (error) {
      console.warn(`⚠️ ファイルマニフェスト生成エラー: ${error.message}`);
    }
  }

  /**
   * ディレクトリをスキャンしてマニフェストに追加
   * @private
   */
  async _scanDirectory(dirPath, manifest, basePath) {
    try {
      const items = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const item of items) {
        const itemPath = path.join(dirPath, item.name);
        const relativePath = path.relative(basePath, itemPath);
        
        if (item.isDirectory()) {
          manifest.directories.push({
            path: relativePath,
            name: item.name
          });
          
          // 再帰的にスキャン
          await this._scanDirectory(itemPath, manifest, basePath);
          
        } else if (item.isFile()) {
          try {
            const stats = await fs.stat(itemPath);
            const fileInfo = {
              path: relativePath,
              name: item.name,
              size: stats.size,
              created: stats.birthtime.toISOString(),
              modified: stats.mtime.toISOString(),
              type: this._determineFileType(item.name)
            };
            
            manifest.files.push(fileInfo);
            manifest.summary.totalFiles++;
            manifest.summary.totalSize += stats.size;
            
            // カテゴリ別カウント
            if (fileInfo.type === 'artifact') {
              manifest.summary.artifactCount++;
            } else if (fileInfo.type === 'result') {
              manifest.summary.resultCount++;
            }
            
          } catch (error) {
            console.warn(`⚠️ ファイル ${itemPath} の情報取得エラー: ${error.message}`);
          }
        }
      }
      
    } catch (error) {
      console.warn(`⚠️ ディレクトリ ${dirPath} のスキャンエラー: ${error.message}`);
    }
  }

  /**
   * ファイルタイプを判定
   * @private
   */
  _determineFileType(fileName) {
    const extension = path.extname(fileName).toLowerCase();
    const baseName = path.basename(fileName, extension);
    
    // アーティファクト系
    if (baseName.includes('test-points') || baseName.includes('test-case') || baseName.includes('script')) {
      return 'artifact';
    }
    
    // 結果系
    if (baseName.includes('screenshot') || baseName.includes('trace') || baseName.includes('log')) {
      return 'result';
    }
    
    // 設定系
    if (baseName.includes('config') || baseName.includes('metadata')) {
      return 'config';
    }
    
    // レポート系
    if (extension === '.html' || extension === '.csv' || baseName.includes('report')) {
      return 'report';
    }
    
    return 'other';
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

  /**
   * セッションIDを生成
   * @private
   */
  _generateSessionId() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
  }
}

module.exports = OutputManager;
