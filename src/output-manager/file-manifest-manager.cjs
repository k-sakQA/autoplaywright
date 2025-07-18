const fs = require('fs').promises;
const path = require('path');

/**
 * Phase 2: ファイルマニフェスト・検索機能
 * セッションファイルの管理、検索、インデックス化
 */
class FileManifestManager {
  constructor(outputManager) {
    this.outputManager = outputManager;
    this.directoryManager = outputManager.directoryManager;
    this.fileWriter = outputManager.fileWriter;
    this.searchIndex = new Map(); // メモリ内検索インデックス
  }

  /**
   * 全セッションのファイルマニフェストを統合
   * @returns {Promise<Object>} 統合マニフェスト
   */
  async generateGlobalManifest() {
    try {
      console.log('📋 全セッションのファイルマニフェスト統合開始...');

      const sessions = await this.outputManager.getAvailableSessions();
      const globalManifest = {
        generatedAt: new Date().toISOString(),
        sessionCount: sessions.length,
        totalFiles: 0,
        totalSize: 0,
        sessions: [],
        fileIndex: new Map(),
        typeDistribution: {},
        extensionDistribution: {},
        recentActivity: []
      };

      for (const session of sessions) {
        try {
          const sessionManifest = await this._loadSessionManifest(session.sessionId);
          if (sessionManifest) {
            globalManifest.sessions.push({
              sessionId: session.sessionId,
              fileCount: sessionManifest.summary.totalFiles,
              size: sessionManifest.summary.totalSize,
              timestamp: session.startTime
            });

            // ファイル情報を統合
            this._integrateSessionFiles(sessionManifest, globalManifest);
          }
        } catch (error) {
          console.warn(`⚠️ セッション ${session.sessionId} のマニフェスト読み込みに失敗: ${error.message}`);
        }
      }

      // 統計情報を計算
      this._calculateStatistics(globalManifest);

      // グローバルマニフェストを保存
      const manifestPath = path.join(this.directoryManager.baseDir, 'global-manifest.json');
      await this.fileWriter.writeJSON(manifestPath, {
        ...globalManifest,
        fileIndex: Array.from(globalManifest.fileIndex.entries())
      });

      // 検索インデックスを更新
      this.searchIndex = globalManifest.fileIndex;

      console.log(`✅ グローバルマニフェスト生成完了: ${globalManifest.totalFiles}ファイル`);
      console.log(`📊 セッション数: ${globalManifest.sessionCount}, 総サイズ: ${this._formatSize(globalManifest.totalSize)}`);

      return globalManifest;

    } catch (error) {
      throw new Error(`Global manifest generation failed: ${error.message}`);
    }
  }

  /**
   * ファイル検索機能
   * @param {Object} criteria 検索条件
   * @returns {Promise<Array>} 検索結果
   */
  async searchFiles(criteria = {}) {
    try {
      const {
        fileName = '',
        sessionId = '',
        fileType = '',
        extension = '',
        minSize = 0,
        maxSize = Infinity,
        dateFrom = null,
        dateTo = null,
        contentPattern = '',
        limit = 100
      } = criteria;

      console.log(`🔍 ファイル検索開始: ${JSON.stringify(criteria)}`);

      // 検索インデックスが空の場合は生成
      if (this.searchIndex.size === 0) {
        console.log('📋 検索インデックスを生成中...');
        await this.generateGlobalManifest();
      }

      const results = [];
      let processedCount = 0;

      for (const [filePath, fileInfo] of this.searchIndex) {
        if (results.length >= limit) break;

        // 検索条件でフィルタリング
        if (fileName && !fileInfo.name.toLowerCase().includes(fileName.toLowerCase())) {
          continue;
        }

        if (sessionId && !fileInfo.sessionId.includes(sessionId)) {
          continue;
        }

        if (fileType && fileInfo.type !== fileType) {
          continue;
        }

        if (extension && !fileInfo.name.toLowerCase().endsWith(extension.toLowerCase())) {
          continue;
        }

        if (fileInfo.size < minSize || fileInfo.size > maxSize) {
          continue;
        }

        if (dateFrom && new Date(fileInfo.created) < new Date(dateFrom)) {
          continue;
        }

        if (dateTo && new Date(fileInfo.created) > new Date(dateTo)) {
          continue;
        }

        // 内容検索（簡易版）
        if (contentPattern) {
          const matched = await this._searchFileContent(fileInfo, contentPattern);
          if (!matched) continue;
        }

        results.push({
          ...fileInfo,
          relativePath: filePath,
          formattedSize: this._formatSize(fileInfo.size),
          formattedDate: new Date(fileInfo.created).toLocaleString('ja-JP')
        });

        processedCount++;
      }

      console.log(`✅ ファイル検索完了: ${results.length}件見つかりました (${processedCount}件処理)`);

      return results.sort((a, b) => new Date(b.created) - new Date(a.created));

    } catch (error) {
      throw new Error(`File search failed: ${error.message}`);
    }
  }

  /**
   * ファイル統計レポートを生成
   * @returns {Promise<Object>} 統計レポート
   */
  async generateFileStatistics() {
    try {
      console.log('📊 ファイル統計レポート生成開始...');

      const globalManifest = await this.generateGlobalManifest();
      const statistics = {
        generatedAt: new Date().toISOString(),
        overview: {
          totalSessions: globalManifest.sessionCount,
          totalFiles: globalManifest.totalFiles,
          totalSize: globalManifest.totalSize,
          formattedSize: this._formatSize(globalManifest.totalSize)
        },
        typeDistribution: globalManifest.typeDistribution,
        extensionDistribution: globalManifest.extensionDistribution,
        sizeDistribution: this._calculateSizeDistribution(globalManifest),
        sessionBreakdown: globalManifest.sessions.map(session => ({
          ...session,
          formattedSize: this._formatSize(session.size),
          formattedDate: new Date(session.timestamp).toLocaleString('ja-JP')
        }))
      };

      // 統計レポートをHTMLで生成
      const htmlReport = this._generateStatisticsHTML(statistics);
      const reportPath = path.join(this.directoryManager.baseDir, 'reports', 
        `file-statistics_${new Date().toISOString().substring(0, 16).replace(/[:.]/g, '-')}.html`);
      
      await this.fileWriter.writeText(reportPath, htmlReport, { skipCompression: true });

      console.log(`✅ ファイル統計レポート生成完了: ${reportPath}`);

      return statistics;

    } catch (error) {
      throw new Error(`File statistics generation failed: ${error.message}`);
    }
  }

  /**
   * 重複ファイルを検出
   * @returns {Promise<Array>} 重複ファイル一覧
   */
  async findDuplicateFiles() {
    try {
      console.log('🔍 重複ファイル検出開始...');

      if (this.searchIndex.size === 0) {
        await this.generateGlobalManifest();
      }

      const fileGroups = new Map(); // ファイル名 -> ファイル情報の配列
      const duplicates = [];

      // ファイル名でグループ化
      for (const [filePath, fileInfo] of this.searchIndex) {
        const fileName = fileInfo.name;
        if (!fileGroups.has(fileName)) {
          fileGroups.set(fileName, []);
        }
        fileGroups.get(fileName).push({ ...fileInfo, path: filePath });
      }

      // 重複をチェック
      for (const [fileName, files] of fileGroups) {
        if (files.length > 1) {
          duplicates.push({
            fileName,
            count: files.length,
            files: files.map(file => ({
              sessionId: file.sessionId,
              path: file.path,
              size: file.size,
              formattedSize: this._formatSize(file.size),
              created: new Date(file.created).toLocaleString('ja-JP')
            })),
            totalSize: files.reduce((sum, file) => sum + file.size, 0)
          });
        }
      }

      duplicates.sort((a, b) => b.totalSize - a.totalSize);

      console.log(`✅ 重複ファイル検出完了: ${duplicates.length}グループ見つかりました`);

      return duplicates;

    } catch (error) {
      throw new Error(`Duplicate file detection failed: ${error.message}`);
    }
  }

  // プライベートメソッド

  /**
   * セッションマニフェストを読み込み
   * @private
   */
  async _loadSessionManifest(sessionId) {
    try {
      const manifestPath = path.join(
        this.directoryManager.baseDir, 
        'runs', 
        sessionId, 
        'metadata', 
        'file-manifest.json'
      );
      
      const content = await fs.readFile(manifestPath, 'utf8');
      const manifest = JSON.parse(content);
      
      // セッション情報を各ファイルに追加
      manifest.files.forEach(file => {
        file.sessionId = sessionId;
      });
      
      return manifest;
    } catch (error) {
      return null; // マニフェストが存在しない場合
    }
  }

  /**
   * セッションファイルを統合マニフェストに追加
   * @private
   */
  _integrateSessionFiles(sessionManifest, globalManifest) {
    globalManifest.totalFiles += sessionManifest.summary.totalFiles;
    globalManifest.totalSize += sessionManifest.summary.totalSize;

    sessionManifest.files.forEach(file => {
      const fileKey = `${file.sessionId}/${file.path}`;
      globalManifest.fileIndex.set(fileKey, file);

      // タイプ別分布
      if (!globalManifest.typeDistribution[file.type]) {
        globalManifest.typeDistribution[file.type] = 0;
      }
      globalManifest.typeDistribution[file.type]++;

      // 拡張子別分布
      const extension = path.extname(file.name).toLowerCase();
      if (!globalManifest.extensionDistribution[extension]) {
        globalManifest.extensionDistribution[extension] = 0;
      }
      globalManifest.extensionDistribution[extension]++;
    });
  }

  /**
   * 統計情報を計算
   * @private
   */
  _calculateStatistics(globalManifest) {
    // 最近のアクティビティ（最新10ファイル）
    const recentFiles = Array.from(globalManifest.fileIndex.values())
      .sort((a, b) => new Date(b.created) - new Date(a.created))
      .slice(0, 10);

    globalManifest.recentActivity = recentFiles.map(file => ({
      name: file.name,
      sessionId: file.sessionId,
      type: file.type,
      size: this._formatSize(file.size),
      created: new Date(file.created).toLocaleString('ja-JP')
    }));
  }

  /**
   * ファイル内容検索（簡易版）
   * @private
   */
  async _searchFileContent(fileInfo, pattern) {
    try {
      // テキストファイルのみ検索対象
      const textExtensions = ['.json', '.csv', '.html', '.md', '.txt', '.js', '.log'];
      const extension = path.extname(fileInfo.name).toLowerCase();
      
      if (!textExtensions.includes(extension)) {
        return false;
      }

      const filePath = path.join(
        this.directoryManager.baseDir,
        'runs',
        fileInfo.sessionId,
        fileInfo.path
      );

      const content = await fs.readFile(filePath, 'utf8');
      return content.toLowerCase().includes(pattern.toLowerCase());
      
    } catch (error) {
      return false; // ファイル読み込みエラーの場合は一致しないとみなす
    }
  }

  /**
   * サイズ分布を計算
   * @private
   */
  _calculateSizeDistribution(globalManifest) {
    const ranges = {
      '< 1KB': 0,
      '1KB - 10KB': 0,
      '10KB - 100KB': 0,
      '100KB - 1MB': 0,
      '> 1MB': 0
    };

    for (const [_, fileInfo] of globalManifest.fileIndex) {
      const size = fileInfo.size;
      if (size < 1024) ranges['< 1KB']++;
      else if (size < 10240) ranges['1KB - 10KB']++;
      else if (size < 102400) ranges['10KB - 100KB']++;
      else if (size < 1048576) ranges['100KB - 1MB']++;
      else ranges['> 1MB']++;
    }

    return ranges;
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

  /**
   * 統計レポートのHTML生成
   * @private
   */
  _generateStatisticsHTML(statistics) {
    return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AutoPlaywright ファイル統計レポート</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
        h1 { color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 10px; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin: 20px 0; }
        .stat-card { background: #f8f9fa; padding: 20px; border-radius: 8px; text-align: center; }
        .stat-value { font-size: 2em; font-weight: bold; color: #2c3e50; }
        .stat-label { color: #7f8c8d; margin-top: 5px; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background: #34495e; color: white; }
        .footer { margin-top: 30px; text-align: center; color: #7f8c8d; }
    </style>
</head>
<body>
    <div class="container">
        <h1>📊 AutoPlaywright ファイル統計レポート</h1>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">${statistics.overview.totalSessions}</div>
                <div class="stat-label">総セッション数</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${statistics.overview.totalFiles}</div>
                <div class="stat-label">総ファイル数</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${statistics.overview.formattedSize}</div>
                <div class="stat-label">総ファイルサイズ</div>
            </div>
        </div>
        
        <h2>📈 ファイルタイプ別分布</h2>
        <table>
            <thead>
                <tr><th>ファイルタイプ</th><th>ファイル数</th></tr>
            </thead>
            <tbody>
                ${Object.entries(statistics.typeDistribution)
                  .sort(([,a], [,b]) => b - a)
                  .map(([type, count]) => `<tr><td>${type}</td><td>${count}</td></tr>`)
                  .join('')}
            </tbody>
        </table>
        
        <h2>📂 拡張子別分布</h2>
        <table>
            <thead>
                <tr><th>拡張子</th><th>ファイル数</th></tr>
            </thead>
            <tbody>
                ${Object.entries(statistics.extensionDistribution)
                  .sort(([,a], [,b]) => b - a)
                  .slice(0, 10)
                  .map(([ext, count]) => `<tr><td>${ext || '(なし)'}</td><td>${count}</td></tr>`)
                  .join('')}
            </tbody>
        </table>
        
        <div class="footer">
            <p>📊 生成日時: ${new Date(statistics.generatedAt).toLocaleString('ja-JP')}</p>
        </div>
    </div>
</body>
</html>`;
  }
}

module.exports = FileManifestManager; 