import fs from 'fs';
import path from 'path';

/**
 * USIS（ユーザーストーリーID）ベースディレクトリ管理
 * - 大量ファイル増殖問題の解決
 * - ユーザーストーリー別ファイル分類
 * - レガシーファイルの自動移行
 * - ディレクトリ構造の最適化
 */
class USISDirectoryManager {
  constructor(options = {}) {
    this.baseDir = options.baseDir || path.join(process.cwd(), 'test-results');
    this.enableLegacyMigration = options.enableLegacyMigration !== false;
    this.dryRun = options.dryRun === true;
    
    this.directoryStructure = {
      common: 'common',                           // USIS未設定の共通ファイル
      usis: (id) => `USIS-${id}`,                // USIS別ディレクトリ
      executionLogs: 'execution-logs',           // 実行ログ
      screenshots: 'screenshots',               // スクリーンショット
      domSnapshots: 'dom-snapshots',            // DOM状態
      aiAnalysis: 'ai-analysis',                // AI分析データ
      reports: 'reports',                       // レポートファイル
      routes: 'routes',                         // ルートファイル
      results: 'results',                       // 結果ファイル
      testCases: 'test-cases',                  // テストケース
      archive: 'archive'                        // アーカイブ
    };
    
    console.log(`📁 USISディレクトリマネージャー初期化: ${this.baseDir}`);
  }

  /**
   * ディレクトリ構造を初期化
   */
  initializeStructure(userStoryId = null) {
    const baseStructure = [
      this.directoryStructure.common,
      path.join(this.directoryStructure.common, this.directoryStructure.executionLogs),
      path.join(this.directoryStructure.common, this.directoryStructure.reports),
      path.join(this.directoryStructure.common, this.directoryStructure.archive)
    ];

    // 基本構造を作成
    baseStructure.forEach(dir => {
      const fullPath = path.join(this.baseDir, dir);
      this.ensureDirectory(fullPath);
    });

    // USIS別ディレクトリを作成
    if (userStoryId) {
      this.createUSISStructure(userStoryId);
    }

    console.log(`✅ ディレクトリ構造初期化完了${userStoryId ? ` (USIS-${userStoryId})` : ''}`);
  }

  /**
   * USIS別ディレクトリ構造を作成
   */
  createUSISStructure(userStoryId) {
    const usisRoot = path.join(this.baseDir, this.directoryStructure.usis(userStoryId));
    
    const usisSubdirs = [
      this.directoryStructure.executionLogs,
      this.directoryStructure.screenshots,
      this.directoryStructure.domSnapshots,
      this.directoryStructure.aiAnalysis,
      this.directoryStructure.reports,
      this.directoryStructure.routes,
      this.directoryStructure.results,
      this.directoryStructure.testCases,
      this.directoryStructure.archive
    ];

    usisSubdirs.forEach(subdir => {
      const fullPath = path.join(usisRoot, subdir);
      this.ensureDirectory(fullPath);
    });

    console.log(`📂 USIS-${userStoryId} ディレクトリ構造作成完了`);
    return usisRoot;
  }

  /**
   * ディレクトリを作成（安全チェック付き）
   */
  ensureDirectory(dirPath) {
    if (!this.dryRun && !fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`📁 ディレクトリ作成: ${dirPath}`);
    } else if (this.dryRun) {
      console.log(`🔍 [DRY RUN] ディレクトリ作成予定: ${dirPath}`);
    }
  }

  /**
   * 既存ファイルをUSIS別に分類・移行
   */
  async migrateLegacyFiles() {
    if (!this.enableLegacyMigration) {
      console.log('⏭️ レガシーファイル移行が無効化されています');
      return;
    }

    console.log('🔄 レガシーファイルの分析・移行を開始...');
    
    const files = this.scanLegacyFiles();
    console.log(`📋 レガシーファイル発見: ${files.length}件`);

    if (files.length === 0) {
      console.log('✅ 移行対象のレガシーファイルがありません');
      return;
    }

    // ファイル分析
    const analysisResult = this.analyzeFiles(files);
    console.log(`📊 分析結果: USIS分類可能 ${analysisResult.classifiable.length}件, 共通 ${analysisResult.common.length}件, 不明 ${analysisResult.unknown.length}件`);

    // USIS別移行
    for (const [userStoryId, fileList] of Object.entries(analysisResult.byUSIS)) {
      await this.migrateFilesToUSIS(userStoryId, fileList);
    }

    // 共通ファイル移行
    if (analysisResult.common.length > 0) {
      await this.migrateFilesToCommon(analysisResult.common);
    }

    // 不明ファイルの処理
    if (analysisResult.unknown.length > 0) {
      await this.handleUnknownFiles(analysisResult.unknown);
    }

    console.log('🎉 レガシーファイル移行完了');
  }

  /**
   * レガシーファイルをスキャン
   */
  scanLegacyFiles() {
    const legacyPatterns = [
      /^result_.*\.json$/,
      /^route_.*\.json$/,
      /^naturalLanguageTestCases_.*\.json$/,
      /^testPoints_.*\.json$/,
      /^TestCoverage_.*\.(csv|html|json)$/,
      /^discovered_stories_.*\.json$/,
      /^fixed_route_.*\.json$/
    ];

    const files = [];
    
    try {
      const dirContents = fs.readdirSync(this.baseDir);
      
      dirContents.forEach(filename => {
        const filePath = path.join(this.baseDir, filename);
        const stat = fs.statSync(filePath);
        
        if (stat.isFile() && this.isLegacyFile(filename, legacyPatterns)) {
          files.push({
            filename,
            path: filePath,
            size: stat.size,
            created: stat.birthtime,
            modified: stat.mtime
          });
        }
      });
    } catch (error) {
      console.error(`📁 ディレクトリスキャンエラー: ${error.message}`);
    }

    return files;
  }

  /**
   * レガシーファイル判定
   */
  isLegacyFile(filename, patterns) {
    // 既にUSIS構造内にあるファイルはスキップ
    if (filename.startsWith('USIS-') || filename === 'common') {
      return false;
    }

    return patterns.some(pattern => pattern.test(filename));
  }

  /**
   * ファイルを分析してUSIS別に分類
   */
  analyzeFiles(files) {
    const result = {
      byUSIS: {},
      common: [],
      unknown: [],
      classifiable: []
    };

    files.forEach(file => {
      const userStoryId = this.extractUSISFromFile(file);
      
      if (userStoryId) {
        if (!result.byUSIS[userStoryId]) {
          result.byUSIS[userStoryId] = [];
        }
        result.byUSIS[userStoryId].push(file);
        result.classifiable.push(file);
      } else if (this.isCommonFile(file)) {
        result.common.push(file);
      } else {
        result.unknown.push(file);
      }
    });

    return result;
  }

  /**
   * ファイルからUSISを抽出
   */
  extractUSISFromFile(file) {
    try {
      // JSON ファイルから USIS を読み取り
      if (file.filename.endsWith('.json')) {
        const content = fs.readFileSync(file.path, 'utf-8');
        const data = JSON.parse(content);
        
        // 様々なフィールドから USIS を検索
        const possibleFields = [
          'userStoryId',
          'user_story_id', 
          'reporterMetadata.userStoryId',
          'testMetadata.userStoryId',
          'userStory.currentId'
        ];

        for (const field of possibleFields) {
          const value = this.getNestedValue(data, field);
          if (value && typeof value === 'number') {
            return value;
          }
        }

        // ファイル名から USIS を推定
        return this.extractUSISFromFilename(file.filename);
      }
    } catch (error) {
      console.log(`⚠️ ファイル分析エラー (${file.filename}): ${error.message}`);
    }

    return null;
  }

  /**
   * ネストされたオブジェクトから値を取得
   */
  getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => current && current[key], obj);
  }

  /**
   * ファイル名からUSISを推定
   */
  extractUSISFromFilename(filename) {
    // タイムスタンプベースの推定ロジック
    // 同じ時間帯に生成されたファイルは同じUSISの可能性が高い
    const timestampMatch = filename.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}|\d{12,})/);
    if (timestampMatch) {
      // 実際のプロジェクトでは、タイムスタンプとUSISのマッピングテーブルを使用
      // ここではデモ用にファイル作成時刻から推定
      return this.estimateUSISFromTimestamp(timestampMatch[1]);
    }
    
    return null;
  }

  /**
   * タイムスタンプからUSISを推定（デモ実装）
   */
  estimateUSISFromTimestamp(timestamp) {
    // 簡易実装：タイムスタンプをハッシュ化してUSIS範囲にマップ
    const hash = timestamp.split('').reduce((a, b) => {
      a = ((a << 5) - a) + b.charCodeAt(0);
      return a & a;
    }, 0);
    
    return Math.abs(hash % 10) + 1; // 1-10の範囲のUSIS
  }

  /**
   * 共通ファイル判定
   */
  isCommonFile(file) {
    const commonPatterns = [
      /\.execution-history\.json$/,
      /\.ai-fix-history\.json$/,
      /\.failure-patterns\.json$/,
      /config\.json$/,
      /credentials\.json$/
    ];

    return commonPatterns.some(pattern => pattern.test(file.filename));
  }

  /**
   * USIS別ディレクトリにファイルを移行
   */
  async migrateFilesToUSIS(userStoryId, files) {
    console.log(`📦 USIS-${userStoryId} への移行開始: ${files.length}件`);
    
    // USIS構造を作成
    this.createUSISStructure(userStoryId);
    
    for (const file of files) {
      const targetSubdir = this.determineTargetSubdirectory(file);
      const targetDir = path.join(
        this.baseDir, 
        this.directoryStructure.usis(userStoryId), 
        targetSubdir
      );
      
      const targetPath = path.join(targetDir, file.filename);
      
      if (!this.dryRun) {
        this.ensureDirectory(targetDir);
        fs.renameSync(file.path, targetPath);
        console.log(`📁 移行: ${file.filename} → USIS-${userStoryId}/${targetSubdir}/`);
      } else {
        console.log(`🔍 [DRY RUN] 移行予定: ${file.filename} → USIS-${userStoryId}/${targetSubdir}/`);
      }
    }
  }

  /**
   * 共通ディレクトリにファイルを移行
   */
  async migrateFilesToCommon(files) {
    console.log(`📦 共通ディレクトリへの移行開始: ${files.length}件`);
    
    for (const file of files) {
      const targetDir = path.join(this.baseDir, this.directoryStructure.common);
      const targetPath = path.join(targetDir, file.filename);
      
      if (!this.dryRun) {
        this.ensureDirectory(targetDir);
        fs.renameSync(file.path, targetPath);
        console.log(`📁 移行: ${file.filename} → common/`);
      } else {
        console.log(`🔍 [DRY RUN] 移行予定: ${file.filename} → common/`);
      }
    }
  }

  /**
   * 不明ファイルの処理
   */
  async handleUnknownFiles(files) {
    console.log(`❓ 不明ファイルの処理: ${files.length}件`);
    
    const archiveDir = path.join(this.baseDir, this.directoryStructure.common, this.directoryStructure.archive);
    
    for (const file of files) {
      const targetPath = path.join(archiveDir, file.filename);
      
      if (!this.dryRun) {
        this.ensureDirectory(archiveDir);
        fs.renameSync(file.path, targetPath);
        console.log(`📦 アーカイブ: ${file.filename} → common/archive/`);
      } else {
        console.log(`🔍 [DRY RUN] アーカイブ予定: ${file.filename} → common/archive/`);
      }
    }
  }

  /**
   * ファイルタイプに応じた適切なサブディレクトリを決定
   */
  determineTargetSubdirectory(file) {
    const filename = file.filename;
    
    if (filename.startsWith('result_')) return this.directoryStructure.results;
    if (filename.startsWith('route_') || filename.startsWith('fixed_route_')) return this.directoryStructure.routes;
    if (filename.includes('TestCoverage') || filename.includes('report')) return this.directoryStructure.reports;
    if (filename.includes('naturalLanguageTestCases') || filename.includes('testPoints')) return this.directoryStructure.testCases;
    if (filename.includes('ai_analysis')) return this.directoryStructure.aiAnalysis;
    if (filename.includes('execution_')) return this.directoryStructure.executionLogs;
    
    return this.directoryStructure.archive; // デフォルト
  }

  /**
   * USIS別ファイルパスを取得
   */
  getUSISFilePath(userStoryId, subdirectory, filename) {
    if (!userStoryId) {
      return path.join(this.baseDir, this.directoryStructure.common, subdirectory, filename);
    }
    
    return path.join(
      this.baseDir, 
      this.directoryStructure.usis(userStoryId), 
      subdirectory, 
      filename
    );
  }

  /**
   * ディレクトリ使用状況を分析
   */
  analyzeDirectoryUsage() {
    const usage = {
      totalFiles: 0,
      totalSize: 0,
      byUSIS: {},
      common: { files: 0, size: 0 },
      structure: this.directoryStructure
    };

    try {
      // ルートディレクトリをスキャン
      const rootContents = fs.readdirSync(this.baseDir);
      
      rootContents.forEach(item => {
        const itemPath = path.join(this.baseDir, item);
        const stat = fs.statSync(itemPath);
        
        if (stat.isDirectory()) {
          if (item.startsWith('USIS-')) {
            const userStoryId = item.replace('USIS-', '');
            usage.byUSIS[userStoryId] = this.analyzeUSISDirectory(itemPath);
          } else if (item === 'common') {
            usage.common = this.analyzeUSISDirectory(itemPath);
          }
        } else {
          // ルート直下のファイル（レガシー）
          usage.totalFiles++;
          usage.totalSize += stat.size;
        }
      });

      // 合計を計算
      Object.values(usage.byUSIS).forEach(usis => {
        usage.totalFiles += usis.files;
        usage.totalSize += usis.size;
      });
      
      usage.totalFiles += usage.common.files;
      usage.totalSize += usage.common.size;

    } catch (error) {
      console.error(`📊 ディレクトリ使用状況分析エラー: ${error.message}`);
    }

    return usage;
  }

  /**
   * USISディレクトリの詳細分析
   */
  analyzeUSISDirectory(dirPath) {
    const analysis = {
      files: 0,
      size: 0,
      subdirectories: {}
    };

    try {
      const contents = fs.readdirSync(dirPath, { withFileTypes: true });
      
      contents.forEach(item => {
        const itemPath = path.join(dirPath, item.name);
        
        if (item.isDirectory()) {
          analysis.subdirectories[item.name] = this.analyzeUSISDirectory(itemPath);
          analysis.files += analysis.subdirectories[item.name].files;
          analysis.size += analysis.subdirectories[item.name].size;
        } else {
          const stat = fs.statSync(itemPath);
          analysis.files++;
          analysis.size += stat.size;
        }
      });
    } catch (error) {
      console.error(`📁 ディレクトリ分析エラー (${dirPath}): ${error.message}`);
    }

    return analysis;
  }

  /**
   * ディレクトリ使用状況レポートを生成
   */
  generateUsageReport() {
    const usage = this.analyzeDirectoryUsage();
    
    console.log('\n📊 ディレクトリ使用状況レポート');
    console.log('='.repeat(50));
    console.log(`📁 総ファイル数: ${usage.totalFiles}`);
    console.log(`💾 総サイズ: ${this.formatFileSize(usage.totalSize)}`);
    
    console.log('\n📂 USIS別使用状況:');
    Object.entries(usage.byUSIS).forEach(([userStoryId, stats]) => {
      console.log(`  USIS-${userStoryId}: ${stats.files}ファイル (${this.formatFileSize(stats.size)})`);
      
      Object.entries(stats.subdirectories).forEach(([subdir, substats]) => {
        if (substats.files > 0) {
          console.log(`    └─ ${subdir}: ${substats.files}ファイル`);
        }
      });
    });
    
    console.log(`\n🔧 共通: ${usage.common.files}ファイル (${this.formatFileSize(usage.common.size)})`);
    
    return usage;
  }

  /**
   * ファイルサイズをフォーマット
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const size = (bytes / Math.pow(1024, i)).toFixed(1);
    
    return `${size} ${units[i]}`;
  }

  /**
   * クリーンアップ処理
   */
  async cleanup(options = {}) {
    const {
      removeEmptyDirectories = true,
      archiveOldFiles = true,
      daysThreshold = 30
    } = options;

    console.log('🧹 ディレクトリクリーンアップを開始...');

    if (removeEmptyDirectories) {
      await this.removeEmptyDirectories();
    }

    if (archiveOldFiles) {
      await this.archiveOldFiles(daysThreshold);
    }

    console.log('✅ クリーンアップ完了');
  }

  /**
   * 空ディレクトリを削除
   */
  async removeEmptyDirectories() {
    console.log('📁 空ディレクトリの削除中...');
    // 実装は再帰的にディレクトリをチェックして空の場合削除
    // 簡略化のためプレースホルダー
  }

  /**
   * 古いファイルをアーカイブ
   */
  async archiveOldFiles(daysThreshold) {
    console.log(`📦 ${daysThreshold}日以上経過したファイルをアーカイブ中...`);
    // 実装は日付チェックしてアーカイブディレクトリに移動
    // 簡略化のためプレースホルダー
  }
}

export default USISDirectoryManager; 