/**
 * DirectoryManager
 * テスト結果ディレクトリ構造の管理
 * 既存のUSISDirectoryManagerの機能を統合・拡張
 */

const fs = require('fs').promises;
const path = require('path');

/**
 * @typedef {Object} DirectoryStructure
 * @property {string} config
 * @property {string} artifacts
 * @property {string} results
 * @property {string} metadata
 */

/**
 * AutoPlaywrightのディレクトリ構造管理クラス
 * テスト実行時に必要なディレクトリの作成・管理を行う
 */
class DirectoryManager {
  /**
   * @param {string} baseDir ベースディレクトリパス
   */
  constructor(baseDir = 'test-results') {
    this.baseDir = baseDir;
    this.sessionPaths = new Map();
  }

  /**
   * セッション用ディレクトリを作成
   * @param {string} sessionId セッションID
   * @returns {Promise<string>} 作成されたセッションパス
   */
  async createSessionDirectory(sessionId) {
    try {
      const sessionPath = path.join(this.baseDir, 'runs', sessionId);
      await this.ensureDirectoryExists(sessionPath);
      
      this.sessionPaths.set(sessionId, sessionPath);
      return sessionPath;
    } catch (error) {
      throw new Error(`Failed to create session directory: ${error.message}`);
    }
  }

  /**
   * 完全なセッション構造を作成（アーティファクト、結果、設定ディレクトリを含む）
   * @param {string} sessionId セッションID
   * @returns {Promise<string>} 作成されたセッションパス
   */
  async createSessionStructure(sessionId) {
    try {
      // メインセッションディレクトリを作成
      const sessionPath = await this.createSessionDirectory(sessionId);
      
      // サブディレクトリ群を作成
      await Promise.all([
        this.createArtifactDirectories(sessionPath),
        this.createResultDirectories(sessionPath),
        this.createConfigDirectories(sessionPath)
      ]);
      
      console.log(`📁 セッション構造作成完了: ${sessionPath}`);
      return sessionPath;
    } catch (error) {
      throw new Error(`Failed to create session structure: ${error.message}`);
    }
  }

  /**
   * アーティファクト用ディレクトリ群を作成
   * @param {string} sessionPath セッションパス
   * @returns {Promise<DirectoryStructure>} 作成されたディレクトリ構造
   */
  async createArtifactDirectories(sessionPath) {
    const artifactDirs = {
      'test-points': path.join(sessionPath, 'artifacts', 'test-points'),
      'test-cases': path.join(sessionPath, 'artifacts', 'test-cases'),
      'scripts': path.join(sessionPath, 'artifacts', 'scripts'),
      'dom-snapshots': path.join(sessionPath, 'artifacts', 'dom-snapshots')
    };

    await Promise.all(
      Object.values(artifactDirs).map(dir => this.ensureDirectoryExists(dir))
    );

    return artifactDirs;
  }

  /**
   * 実行結果用ディレクトリ群を作成
   * @param {string} sessionPath セッションパス
   * @returns {Promise<DirectoryStructure>} 作成されたディレクトリ構造
   */
  async createResultDirectories(sessionPath) {
    const resultDirs = {
      'reports': path.join(sessionPath, 'results', 'reports'),
      'screenshots': path.join(sessionPath, 'results', 'screenshots'),
      'traces': path.join(sessionPath, 'results', 'traces'),
      'logs': path.join(sessionPath, 'results', 'logs')
    };

    await Promise.all(
      Object.values(resultDirs).map(dir => this.ensureDirectoryExists(dir))
    );

    return resultDirs;
  }

  /**
   * 設定・メタデータ用ディレクトリ群を作成
   * @param {string} sessionPath セッションパス
   * @returns {Promise<DirectoryStructure>} 作成されたディレクトリ構造
   */
  async createConfigDirectories(sessionPath) {
    const configDirs = {
      'config': path.join(sessionPath, 'config'),
      'metadata': path.join(sessionPath, 'metadata')
    };

    await Promise.all(
      Object.values(configDirs).map(dir => this.ensureDirectoryExists(dir))
    );

    return configDirs;
  }

  /**
   * アーティファクトファイルのパスを解決
   * @param {string} sessionId セッションID
   * @param {string} artifactType アーティファクトタイプ
   * @param {string} filename ファイル名
   * @returns {string} 解決されたファイルパス
   */
  resolveArtifactPath(sessionId, artifactType, filename) {
    const sessionPath = this.sessionPaths.get(sessionId) || 
                       path.join(this.baseDir, 'runs', sessionId);
    return path.join(sessionPath, 'artifacts', artifactType, filename);
  }

  /**
   * 実行結果ファイルのパスを解決
   * @param {string} sessionId セッションID
   * @param {string} resultType 結果タイプ
   * @param {string} filename ファイル名
   * @returns {string} 解決されたファイルパス
   */
  resolveResultPath(sessionId, resultType, filename) {
    const sessionPath = this.sessionPaths.get(sessionId) || 
                       path.join(this.baseDir, 'runs', sessionId);
    return path.join(sessionPath, 'results', resultType, filename);
  }

  /**
   * セッション内の任意パスを解決
   * @param {string} sessionId セッションID
   * @param {string} subDir サブディレクトリ
   * @param {string} filename ファイル名
   * @returns {string} 解決されたファイルパス
   */
  resolveSessionPath(sessionId, subDir, filename) {
    const sessionPath = this.sessionPaths.get(sessionId) || 
                       path.join(this.baseDir, 'runs', sessionId);
    return path.join(sessionPath, subDir, filename);
  }

  /**
   * メタデータファイルのパスを解決
   * @param {string} sessionId セッションID
   * @param {string} filename ファイル名
   * @returns {string} 解決されたファイルパス
   */
  resolveMetadataPath(sessionId, filename) {
    const sessionPath = this.sessionPaths.get(sessionId) || 
                       path.join(this.baseDir, 'runs', sessionId);
    return path.join(sessionPath, 'metadata', filename);
  }

  /**
   * ディレクトリの存在を確認し、存在しない場合は作成
   * @param {string} dirPath ディレクトリパス
   * @returns {Promise<void>}
   */
  async ensureDirectoryExists(dirPath) {
    try {
      await fs.access(dirPath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        await fs.mkdir(dirPath, { recursive: true, mode: 0o750 });
      } else {
        throw error;
      }
    }
  }

  /**
   * シンボリックリンクを作成
   * @param {string} target リンク先パス
   * @param {string} linkPath リンクパス
   * @returns {Promise<void>}
   */
  async createSymbolicLink(target, linkPath) {
    try {
      // 既存のリンクを削除
      try {
        await fs.unlink(linkPath);
      } catch (error) {
        // リンクが存在しない場合は無視
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }
      
      // 新しいリンクを作成
      await fs.symlink(path.resolve(target), linkPath);
    } catch (error) {
      console.warn(`⚠️ シンボリックリンク作成失敗: ${error.message}`);
      // シンボリックリンクの作成に失敗しても処理は続行
    }
  }

  /**
   * 既存USISディレクトリ構造との統合
   * 既存のtest-results/{USIS-*}形式のディレクトリと新形式を共存させる
   * @param {string} usisDir USISディレクトリ名
   * @returns {Promise<string>} 統合されたディレクトリパス
   */
  async integrateWithUSISDirectory(usisDir) {
    try {
      const usisPath = path.join(this.baseDir, usisDir);
      
      // USISディレクトリが存在するかチェック
      try {
        await fs.access(usisPath);
      } catch (error) {
        if (error.code === 'ENOENT') {
          // USISディレクトリが存在しない場合は作成
          await this.ensureDirectoryExists(usisPath);
        }
      }

      // USIS内に新しい構造のサブディレクトリを作成
      const subDirs = [
        'screenshots',
        'dom-snapshots', 
        'execution-logs',
        'ai-analysis',
        'reports'
      ];

      await Promise.all(
        subDirs.map(subDir => 
          this.ensureDirectoryExists(path.join(usisPath, subDir))
        )
      );

      return usisPath;
    } catch (error) {
      throw new Error(`Failed to integrate with USIS directory: ${error.message}`);
    }
  }

  /**
   * アーカイブディレクトリに移動
   * @param {string} sourcePath 移動元パス
   * @param {string} archivePath アーカイブ先パス
   * @returns {Promise<void>}
   */
  async archiveDirectory(sourcePath, archivePath) {
    try {
      await this.ensureDirectoryExists(path.dirname(archivePath));
      await fs.rename(sourcePath, archivePath);
      console.log(`📦 ディレクトリアーカイブ完了: ${path.basename(sourcePath)}`);
    } catch (error) {
      throw new Error(`Failed to archive directory: ${error.message}`);
    }
  }

  /**
   * 保持期間を過ぎた古いディレクトリを削除
   * @param {number} retentionDays 保持日数
   * @returns {Promise<string[]>} 削除されたディレクトリ一覧
   */
  async deleteOldDirectories(retentionDays) {
    try {
      const runsDir = path.join(this.baseDir, 'runs');
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      const entries = await fs.readdir(runsDir, { withFileTypes: true });
      const deletedDirs = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const dirPath = path.join(runsDir, entry.name);
          const stats = await fs.stat(dirPath);
          
          if (stats.mtime < cutoffDate) {
            await fs.rmdir(dirPath, { recursive: true });
            deletedDirs.push(entry.name);
          }
        }
      }

      if (deletedDirs.length > 0) {
        console.log(`🗑️ 古いディレクトリを削除: ${deletedDirs.length}個`);
      }

      return deletedDirs;
    } catch (error) {
      console.error(`❌ 古いディレクトリ削除失敗: ${error.message}`);
      return [];
    }
  }

  /**
   * グローバル設定ディレクトリを初期化
   * @returns {Promise<string>} 設定ディレクトリパス
   */
  async initializeGlobalConfigDirectory() {
    try {
      const configDir = path.join(this.baseDir, '.autoplaywright');
      await this.ensureDirectoryExists(configDir);
      await this.ensureDirectoryExists(path.join(configDir, 'templates'));
      
      return configDir;
    } catch (error) {
      throw new Error(`Failed to initialize global config directory: ${error.message}`);
    }
  }

  /**
   * ディレクトリサイズを計算
   * @param {string} dirPath ディレクトリパス
   * @returns {Promise<number>} サイズ（バイト）
   */
  async calculateDirectorySize(dirPath) {
    try {
      let totalSize = 0;
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          totalSize += await this.calculateDirectorySize(fullPath);
        } else {
          const stats = await fs.stat(fullPath);
          totalSize += stats.size;
        }
      }

      return totalSize;
    } catch (error) {
      console.warn(`⚠️ ディレクトリサイズ計算失敗: ${error.message}`);
      return 0;
    }
  }

  /**
   * セッションディレクトリ一覧を取得
   * @returns {Promise<Array>} セッション情報一覧
   */
  async listSessions() {
    try {
      const runsDir = path.join(this.baseDir, 'runs');
      
      try {
        await fs.access(runsDir);
      } catch (error) {
        if (error.code === 'ENOENT') {
          return [];
        }
        throw error;
      }

      const entries = await fs.readdir(runsDir, { withFileTypes: true });
      const sessions = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const sessionPath = path.join(runsDir, entry.name);
          const stats = await fs.stat(sessionPath);
          
          sessions.push({
            sessionId: entry.name,
            path: sessionPath,
            createdAt: stats.birthtime,
            modifiedAt: stats.mtime,
            size: await this.calculateDirectorySize(sessionPath)
          });
        }
      }

      // 作成日時でソート（新しい順）
      sessions.sort((a, b) => b.createdAt - a.createdAt);
      
      return sessions;
    } catch (error) {
      console.error(`❌ セッション一覧取得失敗: ${error.message}`);
      return [];
    }
  }
}

module.exports = DirectoryManager; 