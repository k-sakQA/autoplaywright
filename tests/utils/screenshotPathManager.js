import fs from 'fs';
import path from 'path';

/**
 * スクリーンショットパス管理クラス
 */
export class ScreenshotPathManager {
  constructor(options = {}) {
    this.baseDir = options.baseDir || 'test-results';
    this.pathCache = new Map();
  }
  
  /**
   * スクリーンショットパス情報を生成
   */
  generatePathInfo(userStoryId, sessionId, stepId) {
    const usisDir = userStoryId ? `USIS-${userStoryId}` : 'common';
    const filename = `${stepId}_failure.png`;
    const relativePath = path.join(this.baseDir, usisDir, 'screenshots', sessionId, filename);
    const absolutePath = path.resolve(relativePath);
    
    const pathInfo = {
      absolutePath,
      relativePath,
      filename,
      sessionId,
      userStoryId,
      stepId,
      webPath: relativePath.replace(/\\/g, '/'), // Web用のパス
      timestamp: new Date().toISOString()
    };
    
    // キャッシュに保存
    this.pathCache.set(`${sessionId}_${stepId}`, pathInfo);
    
    return pathInfo;
  }
  
  /**
   * 保存されたパス情報を取得
   */
  getPathInfo(sessionId, stepId) {
    return this.pathCache.get(`${sessionId}_${stepId}`);
  }
  
  /**
   * 動的パス探索
   */
  async findScreenshotPaths(routeId, stepIndex, userStoryId = null) {
    const searchPaths = this.generateSearchPaths(routeId, stepIndex, userStoryId);
    const existingPaths = [];
    
    for (const searchPath of searchPaths) {
      try {
        await fs.promises.access(searchPath);
        existingPaths.push(searchPath);
      } catch (error) {
        // ファイルが存在しない場合は無視
      }
    }
    
    return existingPaths;
  }
  
  /**
   * 検索パス一覧を生成
   */
  generateSearchPaths(routeId, stepIndex, userStoryId) {
    const patterns = [];
    
    // 現在の構造 - globパターンではなく具体的なパスを生成
    if (userStoryId) {
      // sessionIdが不明な場合は、よく使われるパターンを試行
      const commonSessionPatterns = [
        routeId, // routeIdをsessionIdとして試行
        `2025-*`, // 年別パターン
        `*` // 全探索（最後の手段）
      ];
      
      for (const sessionPattern of commonSessionPatterns) {
        patterns.push(`${this.baseDir}/USIS-${userStoryId}/screenshots/${sessionPattern}/step_${stepIndex}_failure.png`);
        patterns.push(`${this.baseDir}/USIS-${userStoryId}/screenshots/${sessionPattern}/step_${stepIndex}.png`);
      }
    }
    
    // 従来構造
    patterns.push(`${this.baseDir}/USIS-1/screenshots/${routeId}/step_${stepIndex}_failure.png`);
    patterns.push(`${this.baseDir}/screenshot_${routeId}_step_${stepIndex}.png`);
    patterns.push(`${this.baseDir}/screenshots/step_${stepIndex}.png`);
    patterns.push(`${this.baseDir}/${routeId}/screenshot.png`);
    
    return patterns;
  }
  
  /**
   * ディレクトリ内のファイルを実際に探索する（glob代替）
   */
  async findFilesInDirectory(dirPath, filePattern) {
    const files = [];
    
    try {
      const items = await fs.promises.readdir(dirPath, { withFileTypes: true });
      
      for (const item of items) {
        if (item.isDirectory()) {
          // サブディレクトリも再帰的に探索
          const subFiles = await this.findFilesInDirectory(
            path.join(dirPath, item.name), 
            filePattern
          );
          files.push(...subFiles);
        } else if (item.isFile() && item.name.match(filePattern)) {
          files.push(path.join(dirPath, item.name));
        }
      }
    } catch (error) {
      // ディレクトリが存在しない場合は空配列を返す
    }
    
    return files;
  }
  
  /**
   * 改良された動的パス探索（glob機能の代替）
   */
  async findScreenshotPathsImproved(routeId, stepIndex, userStoryId = null) {
    const foundPaths = [];
    
    // パターン1: USIS構造での探索
    if (userStoryId) {
      const usisDir = path.join(this.baseDir, `USIS-${userStoryId}`, 'screenshots');
      const filePattern = new RegExp(`step_${stepIndex}(_failure)?\\.png$`);
      const usisFiles = await this.findFilesInDirectory(usisDir, filePattern);
      foundPaths.push(...usisFiles);
    }
    
    // パターン2: ルートベースでの探索
    const routeDir = path.join(this.baseDir, routeId);
    if (await this.directoryExists(routeDir)) {
      const routeFilePattern = new RegExp(`(screenshot|step_${stepIndex}).*\\.png$`);
      const routeFiles = await this.findFilesInDirectory(routeDir, routeFilePattern);
      foundPaths.push(...routeFiles);
    }
    
    // パターン3: ベースディレクトリでの直接探索
    const baseFilePattern = new RegExp(`(screenshot_${routeId}_step_${stepIndex}|step_${stepIndex}).*\\.png$`);
    const baseFiles = await this.findFilesInDirectory(this.baseDir, baseFilePattern);
    foundPaths.push(...baseFiles);
    
    // 重複を除去して相対パスに変換
    const uniquePaths = [...new Set(foundPaths)];
    return uniquePaths.map(fullPath => path.relative(process.cwd(), fullPath));
  }
  
  /**
   * ディレクトリが存在するかチェック
   */
  async directoryExists(dirPath) {
    try {
      const stat = await fs.promises.stat(dirPath);
      return stat.isDirectory();
    } catch (error) {
      return false;
    }
  }
} 