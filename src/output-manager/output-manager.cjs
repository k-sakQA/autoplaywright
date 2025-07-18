/**
 * AutoPlaywright OutputManager
 * テスト結果ディレクトリ管理のメインクラス
 */

import { DirectoryManager } from './directory-manager.js';
import { FileWriter } from './file-writer.js';
import { ReportGenerator } from './report-generator.js';
import { ConfigLoader } from './config-loader.js';
import fs from 'fs';
import path from 'path';

export class OutputManager {
  /**
   * @param {import('./types/output-config.js').OutputConfig} config 
   */
  constructor(config) {
    this.config = {
      baseDir: config.baseDir || 'test-results',
      enableArchiving: config.enableArchiving !== false,
      maxRetentionDays: config.maxRetentionDays || 30,
      compressionEnabled: config.compressionEnabled !== false,
      formats: {
        reports: config.formats?.reports || 'html',
        screenshots: config.formats?.screenshots || 'png',
        traces: config.formats?.traces !== false
      },
      ...config
    };

    this.directoryManager = new DirectoryManager(this.config.baseDir);
    this.fileWriter = new FileWriter(this.config);
    this.reportGenerator = new ReportGenerator(this.config);
    this.configLoader = new ConfigLoader();

    // アクティブセッションの管理
    this.activeSessions = new Map();
    
    console.log(`📊 OutputManager初期化: baseDir=${this.config.baseDir}`);
  }

  /**
   * テストセッションを開始
   * @param {string} [sessionId] - 指定されない場合は自動生成
   * @returns {Promise<import('./types/output-config.js').TestSession>}
   */
  async startSession(sessionId = null) {
    try {
      sessionId = sessionId || this.generateSessionId();
      
      const session = {
        sessionId,
        startTime: new Date(),
        config: await this.generateSessionConfig(sessionId),
        basePath: await this.directoryManager.createSessionDirectory(sessionId),
        status: 'running'
      };

      // セッションディレクトリ構造を作成
      await this.directoryManager.createArtifactDirectories(session.basePath);
      await this.directoryManager.createResultDirectories(session.basePath);

      // セッション設定ファイルを保存
      await this.saveSessionConfig(session);

      // アクティブセッションに登録
      this.activeSessions.set(sessionId, session);

      console.log(`🚀 セッション開始: ${sessionId}`);
      return session;
    } catch (error) {
      console.error(`❌ セッション開始エラー: ${error.message}`);
      throw error;
    }
  }

  /**
   * テスト観点を保存
   * @param {string} sessionId 
   * @param {import('./types/output-config.js').TestPoint[]} points 
   * @returns {Promise<string>} 保存されたファイルパス
   */
  async writeTestPoints(sessionId, points) {
    const session = this.getActiveSession(sessionId);
    const filename = `test-points_${this.generateTimestamp()}.json`;
    const filePath = this.directoryManager.resolveArtifactPath(sessionId, 'test-points', filename);
    
    const data = {
      sessionId,
      timestamp: new Date().toISOString(),
      points,
      metadata: {
        count: points.length,
        categories: [...new Set(points.map(p => p.category))],
        generatedBy: 'AutoPlaywright OutputManager'
      }
    };

    await this.fileWriter.writeJSON(filePath, data);
    console.log(`📝 テスト観点保存: ${filePath} (${points.length}件)`);
    return filePath;
  }

  /**
   * テストケースを保存
   * @param {string} sessionId 
   * @param {import('./types/output-config.js').TestCase} testCase 
   * @returns {Promise<string>}
   */
  async writeTestCase(sessionId, testCase) {
    const session = this.getActiveSession(sessionId);
    const filename = `test-case_${testCase.id}.md`;
    const filePath = this.directoryManager.resolveArtifactPath(sessionId, 'test-cases', filename);
    
    const markdownContent = this.generateTestCaseMarkdown(testCase);
    await this.fileWriter.writeText(filePath, markdownContent);
    
    console.log(`📋 テストケース保存: ${filePath}`);
    return filePath;
  }

  /**
   * Playwrightスクリプトを保存
   * @param {string} sessionId 
   * @param {import('./types/output-config.js').PlaywrightScript} script 
   * @returns {Promise<string>}
   */
  async writeScript(sessionId, script) {
    const session = this.getActiveSession(sessionId);
    const filename = script.filename || `${script.id}.spec.${script.language === 'typescript' ? 'ts' : 'js'}`;
    const filePath = this.directoryManager.resolveArtifactPath(sessionId, 'scripts', filename);
    
    await this.fileWriter.writeText(filePath, script.content);
    console.log(`💻 スクリプト保存: ${filePath}`);
    return filePath;
  }

  /**
   * DOMスナップショットを保存
   * @param {string} sessionId 
   * @param {import('./types/output-config.js').DOMSnapshot} snapshot 
   * @returns {Promise<string>}
   */
  async writeDOMSnapshot(sessionId, snapshot) {
    const session = this.getActiveSession(sessionId);
    const htmlFilename = `snapshot_${snapshot.testId}_step${snapshot.stepNumber}.html`;
    const htmlPath = this.directoryManager.resolveArtifactPath(sessionId, 'dom-snapshots', htmlFilename);
    
    const snapshotData = {
      testId: snapshot.testId,
      stepNumber: snapshot.stepNumber,
      url: snapshot.url,
      timestamp: snapshot.timestamp.toISOString(),
      html: snapshot.html
    };

    await this.fileWriter.writeText(htmlPath, snapshot.html);
    
    // スクリーンショットがある場合は保存
    if (snapshot.screenshot) {
      const screenshotFilename = `snapshot_${snapshot.testId}_step${snapshot.stepNumber}.png`;
      const screenshotPath = this.directoryManager.resolveArtifactPath(sessionId, 'dom-snapshots', screenshotFilename);
      await this.fileWriter.writeBinary(screenshotPath, snapshot.screenshot);
    }

    console.log(`🌐 DOMスナップショット保存: ${htmlPath}`);
    return htmlPath;
  }

  /**
   * テスト結果を保存
   * @param {string} sessionId 
   * @param {import('./types/output-config.js').TestResult} result 
   */
  async saveTestResult(sessionId, result) {
    const session = this.getActiveSession(sessionId);
    
    // セッションに結果を追加
    if (!session.results) session.results = [];
    session.results.push(result);

    // 結果ファイルを保存
    const filename = `test-result_${result.testId}.json`;
    const filePath = this.directoryManager.resolveResultPath(sessionId, 'results', filename);
    
    await this.fileWriter.writeJSON(filePath, result);
    console.log(`📊 テスト結果保存: ${filePath}`);
  }

  /**
   * スクリーンショットを保存
   * @param {string} sessionId 
   * @param {Buffer} screenshot 
   * @param {import('./types/output-config.js').ScreenshotMetadata} metadata 
   * @returns {Promise<string>}
   */
  async saveScreenshot(sessionId, screenshot, metadata) {
    const session = this.getActiveSession(sessionId);
    const filename = `screenshot_${metadata.testId}_${metadata.type}_${this.generateTimestamp()}.${this.config.formats.screenshots}`;
    const filePath = this.directoryManager.resolveResultPath(sessionId, 'screenshots', filename);
    
    await this.fileWriter.writeBinary(filePath, screenshot);
    
    // メタデータファイルも保存
    const metadataPath = filePath.replace(/\.(png|jpg)$/, '.json');
    await this.fileWriter.writeJSON(metadataPath, metadata);
    
    console.log(`📸 スクリーンショット保存: ${filePath}`);
    return filePath;
  }

  /**
   * トレースファイルを保存
   * @param {string} sessionId 
   * @param {Buffer} trace 
   * @param {string} testId 
   * @returns {Promise<string>}
   */
  async saveTrace(sessionId, trace, testId) {
    const session = this.getActiveSession(sessionId);
    const filename = `trace_${testId}.zip`;
    const filePath = this.directoryManager.resolveResultPath(sessionId, 'traces', filename);
    
    await this.fileWriter.writeBinary(filePath, trace);
    console.log(`🎥 トレースファイル保存: ${filePath}`);
    return filePath;
  }

  /**
   * ログエントリを保存
   * @param {string} sessionId 
   * @param {import('./types/output-config.js').LogEntry} log 
   */
  async saveLog(sessionId, log) {
    const session = this.getActiveSession(sessionId);
    const filename = `execution_${this.generateDateString()}.log`;
    const filePath = this.directoryManager.resolveResultPath(sessionId, 'logs', filename);
    
    const logLine = `[${log.timestamp.toISOString()}] ${log.level.toUpperCase()}: ${log.message}\n`;
    await this.fileWriter.appendText(filePath, logLine);
  }

  /**
   * レポートを生成
   * @param {string} sessionId 
   * @returns {Promise<import('./types/output-config.js').TestReport>}
   */
  async generateReport(sessionId) {
    const session = this.getActiveSession(sessionId);
    return await this.reportGenerator.generateReport(session);
  }

  /**
   * ファイル一覧を生成
   * @param {string} sessionId 
   * @returns {Promise<import('./types/output-config.js').FileManifest>}
   */
  async generateFileListing(sessionId) {
    const session = this.getActiveSession(sessionId);
    return await this.reportGenerator.generateFileManifest(session);
  }

  /**
   * セッションを終了
   * @param {string} sessionId 
   * @returns {Promise<import('./types/output-config.js').SessionSummary>}
   */
  async endSession(sessionId) {
    const session = this.getActiveSession(sessionId);
    
    session.status = 'completed';
    session.endTime = new Date();
    
    // 最終レポートを生成
    const report = await this.generateReport(sessionId);
    const fileManifest = await this.generateFileListing(sessionId);
    
    // セッションサマリを作成
    const summary = {
      sessionId: session.sessionId,
      startTime: session.startTime,
      endTime: session.endTime,
      duration: session.endTime - session.startTime,
      testSummary: report.summary,
      fileManifest
    };

    // サマリファイルを保存
    const summaryPath = path.join(session.basePath, 'metadata', 'summary.json');
    await this.fileWriter.writeJSON(summaryPath, summary);

    // latestリンクを更新
    await this.directoryManager.createSymbolicLink(session.basePath, path.join(this.config.baseDir, 'latest'));

    // アクティブセッションから削除
    this.activeSessions.delete(sessionId);

    console.log(`🏁 セッション終了: ${sessionId} (${summary.duration}ms)`);
    return summary;
  }

  /**
   * セッションをアーカイブ
   * @param {string} sessionId 
   */
  async archiveSession(sessionId) {
    if (this.config.enableArchiving) {
      await this.directoryManager.archiveSession(sessionId);
      console.log(`📦 セッションアーカイブ: ${sessionId}`);
    }
  }

  /**
   * 古いセッションをクリーンアップ
   */
  async cleanupOldSessions() {
    const deletedSessions = await this.directoryManager.deleteOldDirectories(this.config.maxRetentionDays);
    console.log(`🧹 古いセッションクリーンアップ: ${deletedSessions.length}件削除`);
    return deletedSessions;
  }

  // === ヘルパーメソッド ===

  /**
   * アクティブセッションを取得
   * @param {string} sessionId 
   * @returns {import('./types/output-config.js').TestSession}
   */
  getActiveSession(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`セッションが見つかりません: ${sessionId}`);
    }
    return session;
  }

  /**
   * セッションIDを生成
   * @returns {string}
   */
  generateSessionId() {
    const now = new Date();
    return now.toISOString()
      .slice(0, 19)
      .replace('T', '_')
      .replace(/:/g, '-');
  }

  /**
   * タイムスタンプを生成
   * @returns {string}
   */
  generateTimestamp() {
    return Date.now().toString();
  }

  /**
   * 日付文字列を生成
   * @returns {string}
   */
  generateDateString() {
    return new Date().toISOString().slice(0, 10);
  }

  /**
   * セッション設定を生成
   * @param {string} sessionId 
   * @returns {Promise<import('./types/output-config.js').SessionConfig>}
   */
  async generateSessionConfig(sessionId) {
    return {
      sessionId,
      startTime: new Date(),
      testTarget: {
        url: '',
        scenarios: [],
        browsers: ['chromium']
      },
      outputSettings: {
        enableArtifacts: true,
        enableResults: true,
        compressionEnabled: this.config.compressionEnabled
      },
      playwrightConfig: {
        headless: true,
        timeout: 30000,
        retries: 2
      }
    };
  }

  /**
   * セッション設定を保存
   * @param {import('./types/output-config.js').TestSession} session 
   */
  async saveSessionConfig(session) {
    const configPath = path.join(session.basePath, 'config', 'run-config.json');
    await this.fileWriter.writeJSON(configPath, session.config);
  }

  /**
   * テストケースMarkdownを生成
   * @param {import('./types/output-config.js').TestCase} testCase 
   * @returns {string}
   */
  generateTestCaseMarkdown(testCase) {
    let markdown = `# ${testCase.title}\n\n`;
    markdown += `**ID:** ${testCase.id}\n\n`;
    markdown += `**説明:** ${testCase.description}\n\n`;
    
    markdown += `## テストステップ\n\n`;
    testCase.steps.forEach((step, index) => {
      markdown += `${index + 1}. **${step.action}** - ${step.target}`;
      if (step.value) markdown += ` (値: ${step.value})`;
      markdown += `\n   - ${step.description}\n\n`;
    });

    markdown += `## 期待結果\n\n`;
    testCase.expectedResults.forEach((result, index) => {
      markdown += `${index + 1}. ${result}\n`;
    });

    return markdown;
  }
} 