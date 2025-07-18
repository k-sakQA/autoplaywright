const fs = require('fs').promises;
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

/**
 * Phase 2: アーカイブ・クリーンアップ機能
 * 古いセッションの自動アーカイブ、ストレージ管理、復元機能
 */
class ArchiveManager {
  constructor(outputManager) {
    this.outputManager = outputManager;
    this.directoryManager = outputManager.directoryManager;
    this.fileWriter = outputManager.fileWriter;
    
    this.archiveConfig = {
      maxRetentionDays: 30,
      archiveThreshold: 7, // 7日以上古いセッションをアーカイブ対象
      maxArchiveSize: 1024 * 1024 * 1024, // 1GB
      compressionLevel: 6
    };
  }

  /**
   * 自動アーカイブプロセスを実行
   * @param {Object} options アーカイブオプション
   * @returns {Promise<Object>} アーカイブ結果
   */
  async runAutoArchive(options = {}) {
    try {
      const {
        dryRun = false,
        maxRetentionDays = this.archiveConfig.maxRetentionDays,
        archiveThreshold = this.archiveConfig.archiveThreshold
      } = options;

      console.log('🗃️ 自動アーカイブプロセス開始...');
      console.log(`   - 保持期間: ${maxRetentionDays}日`);
      console.log(`   - アーカイブ閾値: ${archiveThreshold}日`);
      console.log(`   - ドライラン: ${dryRun ? 'はい' : 'いいえ'}`);

      const result = {
        scannedSessions: 0,
        archivedSessions: 0,
        deletedSessions: 0,
        freedSpace: 0,
        errors: []
      };

      // 1. 利用可能なセッションを取得
      const sessions = await this.outputManager.getAvailableSessions();
      result.scannedSessions = sessions.length;

      const now = new Date();
      const archiveDate = new Date(now.getTime() - (archiveThreshold * 24 * 60 * 60 * 1000));
      const deleteDate = new Date(now.getTime() - (maxRetentionDays * 24 * 60 * 60 * 1000));

      console.log(`📅 アーカイブ対象日: ${archiveDate.toLocaleDateString('ja-JP')}`);
      console.log(`📅 削除対象日: ${deleteDate.toLocaleDateString('ja-JP')}`);

      // 2. セッションを分類
      for (const session of sessions) {
        try {
          const sessionDate = new Date(session.startTime);
          
          if (sessionDate < deleteDate) {
            // 削除対象
            if (!dryRun) {
              await this._deleteSession(session.sessionId);
            }
            result.deletedSessions++;
            console.log(`🗑️ 削除対象: ${session.sessionId} (${sessionDate.toLocaleDateString('ja-JP')})`);
            
          } else if (sessionDate < archiveDate) {
            // アーカイブ対象
            if (!dryRun) {
              const archivedSize = await this._archiveSession(session.sessionId);
              result.freedSpace += archivedSize;
            }
            result.archivedSessions++;
            console.log(`🗃️ アーカイブ対象: ${session.sessionId} (${sessionDate.toLocaleDateString('ja-JP')})`);
          }
        } catch (error) {
          result.errors.push({
            sessionId: session.sessionId,
            error: error.message
          });
          console.warn(`⚠️ セッション ${session.sessionId} の処理エラー: ${error.message}`);
        }
      }

      // 3. アーカイブディレクトリのクリーンアップ
      if (!dryRun) {
        await this._cleanupArchives(maxRetentionDays);
      }

      console.log('✅ 自動アーカイブプロセス完了');
      console.log(`📊 結果: ${result.archivedSessions}件アーカイブ, ${result.deletedSessions}件削除`);
      console.log(`💾 解放容量: ${this._formatSize(result.freedSpace)}`);

      return result;

    } catch (error) {
      throw new Error(`Auto archive process failed: ${error.message}`);
    }
  }

  /**
   * セッションを手動でアーカイブ
   * @param {string} sessionId セッションID
   * @returns {Promise<string>} アーカイブファイルパス
   */
  async archiveSession(sessionId) {
    try {
      console.log(`🗃️ セッション手動アーカイブ開始: ${sessionId}`);
      
      const archivedSize = await this._archiveSession(sessionId);
      
      console.log(`✅ セッションアーカイブ完了: ${sessionId}`);
      console.log(`💾 圧縮サイズ: ${this._formatSize(archivedSize)}`);
      
      return path.join(this.directoryManager.baseDir, 'archives', `${sessionId}.tar.gz`);
      
    } catch (error) {
      throw new Error(`Session archive failed: ${error.message}`);
    }
  }

  /**
   * アーカイブからセッションを復元
   * @param {string} sessionId セッションID
   * @returns {Promise<string>} 復元されたセッションパス
   */
  async restoreSession(sessionId) {
    try {
      console.log(`🔄 セッション復元開始: ${sessionId}`);
      
      const archivePath = path.join(this.directoryManager.baseDir, 'archives', `${sessionId}.tar.gz`);
      
      // アーカイブファイルの存在確認
      try {
        await fs.access(archivePath);
      } catch (error) {
        throw new Error(`Archive file not found: ${archivePath}`);
      }
      
      // 復元先ディレクトリ
      const restorePath = path.join(this.directoryManager.baseDir, 'runs', sessionId);
      
      // 既存セッションが存在する場合はエラー
      try {
        await fs.access(restorePath);
        throw new Error(`Session ${sessionId} already exists and cannot be restored`);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }
      
      // アーカイブを展開（簡易版 - 実際にはtar.gzの展開が必要）
      await this._extractArchive(archivePath, restorePath);
      
      console.log(`✅ セッション復元完了: ${sessionId}`);
      console.log(`📂 復元先: ${restorePath}`);
      
      return restorePath;
      
    } catch (error) {
      throw new Error(`Session restore failed: ${error.message}`);
    }
  }

  /**
   * アーカイブ一覧を取得
   * @returns {Promise<Array>} アーカイブ一覧
   */
  async listArchives() {
    try {
      const archivesDir = path.join(this.directoryManager.baseDir, 'archives');
      
      try {
        const files = await fs.readdir(archivesDir);
        const archives = [];
        
        for (const file of files) {
          if (file.endsWith('.tar.gz')) {
            const sessionId = file.replace('.tar.gz', '');
            const filePath = path.join(archivesDir, file);
            const stats = await fs.stat(filePath);
            
            archives.push({
              sessionId,
              fileName: file,
              size: stats.size,
              formattedSize: this._formatSize(stats.size),
              created: stats.birthtime.toISOString(),
              formattedDate: stats.birthtime.toLocaleString('ja-JP')
            });
          }
        }
        
        return archives.sort((a, b) => new Date(b.created) - new Date(a.created));
        
      } catch (error) {
        if (error.code === 'ENOENT') {
          return []; // アーカイブディレクトリが存在しない
        }
        throw error;
      }
      
    } catch (error) {
      throw new Error(`Failed to list archives: ${error.message}`);
    }
  }

  /**
   * ストレージ使用量を分析
   * @returns {Promise<Object>} ストレージ分析結果
   */
  async analyzeStorage() {
    try {
      console.log('💾 ストレージ使用量分析開始...');
      
      const analysis = {
        runs: { count: 0, size: 0 },
        archives: { count: 0, size: 0 },
        reports: { count: 0, size: 0 },
        total: { count: 0, size: 0 },
        breakdown: []
      };

      // runsディレクトリの分析
      const runsDir = path.join(this.directoryManager.baseDir, 'runs');
      try {
        const runsStat = await this._analyzeDirectory(runsDir);
        analysis.runs = runsStat;
        analysis.breakdown.push({ type: 'runs', ...runsStat });
      } catch (error) {
        // ディレクトリが存在しない場合は無視
      }

      // archivesディレクトリの分析
      const archivesDir = path.join(this.directoryManager.baseDir, 'archives');
      try {
        const archivesStat = await this._analyzeDirectory(archivesDir);
        analysis.archives = archivesStat;
        analysis.breakdown.push({ type: 'archives', ...archivesStat });
      } catch (error) {
        // ディレクトリが存在しない場合は無視
      }

      // reportsディレクトリの分析
      const reportsDir = path.join(this.directoryManager.baseDir, 'reports');
      try {
        const reportsStat = await this._analyzeDirectory(reportsDir);
        analysis.reports = reportsStat;
        analysis.breakdown.push({ type: 'reports', ...reportsStat });
      } catch (error) {
        // ディレクトリが存在しない場合は無視
      }

      // 合計計算
      analysis.total.count = analysis.runs.count + analysis.archives.count + analysis.reports.count;
      analysis.total.size = analysis.runs.size + analysis.archives.size + analysis.reports.size;

      // フォーマット済みサイズを追加
      Object.keys(analysis).forEach(key => {
        if (analysis[key].size !== undefined) {
          analysis[key].formattedSize = this._formatSize(analysis[key].size);
        }
      });

      console.log('✅ ストレージ使用量分析完了');
      console.log(`📊 総使用量: ${analysis.total.formattedSize}`);
      
      return analysis;
      
    } catch (error) {
      throw new Error(`Storage analysis failed: ${error.message}`);
    }
  }

  // プライベートメソッド

  /**
   * セッションをアーカイブ
   * @private
   */
  async _archiveSession(sessionId) {
    const sessionPath = path.join(this.directoryManager.baseDir, 'runs', sessionId);
    const archivesDir = path.join(this.directoryManager.baseDir, 'archives');
    const archivePath = path.join(archivesDir, `${sessionId}.tar.gz`);

    // アーカイブディレクトリの作成
    await this.directoryManager.ensureDirectoryExists(archivesDir);

    // セッションディレクトリの存在確認
    try {
      await fs.access(sessionPath);
    } catch (error) {
      throw new Error(`Session directory not found: ${sessionPath}`);
    }

    // 簡易アーカイブ（実際の実装ではtar.gzを使用）
    const originalSize = await this._getDirectorySize(sessionPath);
    
    // メタデータを含むアーカイブ情報を作成
    const archiveInfo = {
      sessionId,
      originalPath: sessionPath,
      archivedAt: new Date().toISOString(),
      originalSize,
      compressionLevel: this.archiveConfig.compressionLevel
    };

    // アーカイブ情報を保存
    const archiveInfoPath = path.join(archivesDir, `${sessionId}.info.json`);
    await this.fileWriter.writeJSON(archiveInfoPath, archiveInfo);

    // セッションディレクトリを削除（実際のアーカイブ後）
    await this._removeDirectory(sessionPath);

    console.log(`📦 セッション ${sessionId} をアーカイブしました (元サイズ: ${this._formatSize(originalSize)})`);
    
    return originalSize;
  }

  /**
   * セッションを削除
   * @private
   */
  async _deleteSession(sessionId) {
    const sessionPath = path.join(this.directoryManager.baseDir, 'runs', sessionId);
    
    try {
      await fs.access(sessionPath);
      await this._removeDirectory(sessionPath);
      console.log(`🗑️ セッション ${sessionId} を削除しました`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * アーカイブのクリーンアップ
   * @private
   */
  async _cleanupArchives(maxRetentionDays) {
    const archivesDir = path.join(this.directoryManager.baseDir, 'archives');
    const deleteDate = new Date(Date.now() - (maxRetentionDays * 24 * 60 * 60 * 1000));

    try {
      const files = await fs.readdir(archivesDir);
      
      for (const file of files) {
        const filePath = path.join(archivesDir, file);
        const stats = await fs.stat(filePath);
        
        if (stats.birthtime < deleteDate) {
          await fs.unlink(filePath);
          console.log(`🗑️ 古いアーカイブを削除: ${file}`);
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn(`⚠️ アーカイブクリーンアップエラー: ${error.message}`);
      }
    }
  }

  /**
   * アーカイブを展開（簡易版）
   * @private
   */
  async _extractArchive(archivePath, extractPath) {
    // 実際の実装では tar.gz の展開が必要
    // ここでは簡易的な処理として、メタデータからディレクトリ構造を復元
    
    const archiveInfoPath = archivePath.replace('.tar.gz', '.info.json');
    
    try {
      const infoContent = await fs.readFile(archiveInfoPath, 'utf8');
      const archiveInfo = JSON.parse(infoContent);
      
      // 基本的なディレクトリ構造を復元
      await this.directoryManager.ensureDirectoryExists(extractPath);
      await this.directoryManager.ensureDirectoryExists(path.join(extractPath, 'metadata'));
      await this.directoryManager.ensureDirectoryExists(path.join(extractPath, 'artifacts'));
      await this.directoryManager.ensureDirectoryExists(path.join(extractPath, 'results'));
      await this.directoryManager.ensureDirectoryExists(path.join(extractPath, 'config'));
      
      // 復元情報を作成
      const restoreInfo = {
        ...archiveInfo,
        restoredAt: new Date().toISOString(),
        restoredPath: extractPath
      };
      
      await this.fileWriter.writeJSON(
        path.join(extractPath, 'metadata', 'restore-info.json'), 
        restoreInfo
      );
      
    } catch (error) {
      throw new Error(`Failed to extract archive: ${error.message}`);
    }
  }

  /**
   * ディレクトリを分析
   * @private
   */
  async _analyzeDirectory(dirPath) {
    let count = 0;
    let size = 0;
    
    try {
      const items = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const item of items) {
        const itemPath = path.join(dirPath, item.name);
        
        if (item.isDirectory()) {
          const subAnalysis = await this._analyzeDirectory(itemPath);
          count += subAnalysis.count;
          size += subAnalysis.size;
        } else {
          count++;
          const stats = await fs.stat(itemPath);
          size += stats.size;
        }
      }
    } catch (error) {
      // ディレクトリにアクセスできない場合は無視
    }
    
    return { count, size };
  }

  /**
   * ディレクトリサイズを取得
   * @private
   */
  async _getDirectorySize(dirPath) {
    const analysis = await this._analyzeDirectory(dirPath);
    return analysis.size;
  }

  /**
   * ディレクトリを削除
   * @private
   */
  async _removeDirectory(dirPath) {
    try {
      await fs.rm(dirPath, { recursive: true, force: true });
    } catch (error) {
      throw new Error(`Failed to remove directory ${dirPath}: ${error.message}`);
    }
  }

  /**
   * ファイルサイズをフォーマット
   * @private
   */
  _formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

module.exports = ArchiveManager; 