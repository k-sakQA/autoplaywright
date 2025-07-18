/**
 * FileWriter
 * ファイル書き込み処理の管理
 * エラーハンドリング、リトライ、圧縮などの機能を提供
 */

const fs = require('fs').promises;
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

/**
 * AutoPlaywrightのファイル書き込み処理クラス
 * 圧縮、リトライ、複数フォーマット対応を提供
 */
class FileWriter {
  /**
   * @param {Object} config 設定オブジェクト
   */
  constructor(config = {}) {
    this.config = {
      compressionEnabled: true,
      compressionLevel: 6,
      maxRetries: 3,
      retryDelay: 1000,
      encoding: 'utf8',
      ...config
    };
  }

  /**
   * JSONファイルを書き込み
   * @param {string} filePath ファイルパス
   * @param {Object} data データオブジェクト
   * @param {Object} options オプション
   * @returns {Promise<string>} 書き込まれたファイルパス
   */
  async writeJSON(filePath, data, options = {}) {
    try {
      const jsonString = JSON.stringify(data, null, 2);
      const finalPath = await this._writeWithRetry(filePath, jsonString, {
        ...options,
        format: 'json'
      });
      
      return finalPath;
    } catch (error) {
      throw new Error(`Failed to write JSON file: ${error.message}`);
    }
  }

  /**
   * テキストファイルを書き込み
   * @param {string} filePath ファイルパス
   * @param {string} content テキスト内容
   * @param {Object} options オプション
   * @returns {Promise<string>} 書き込まれたファイルパス
   */
  async writeText(filePath, content, options = {}) {
    try {
      const finalPath = await this._writeWithRetry(filePath, content, {
        ...options,
        format: 'text'
      });
      
      return finalPath;
    } catch (error) {
      throw new Error(`Failed to write text file: ${error.message}`);
    }
  }

  /**
   * バイナリファイルを書き込み
   * @param {string} filePath ファイルパス
   * @param {Buffer} buffer バイナリデータ
   * @param {Object} options オプション
   * @returns {Promise<string>} 書き込まれたファイルパス
   */
  async writeBinary(filePath, buffer, options = {}) {
    try {
      const finalPath = await this._writeWithRetry(filePath, buffer, {
        ...options,
        format: 'binary'
      });
      
      return finalPath;
    } catch (error) {
      throw new Error(`Failed to write binary file: ${error.message}`);
    }
  }

  /**
   * ファイルにテキストを追記
   * @param {string} filePath ファイルパス
   * @param {string} content 追記内容
   * @param {Object} options オプション
   * @returns {Promise<void>}
   */
  async appendText(filePath, content, options = {}) {
    try {
      await this._ensureDirectoryExists(path.dirname(filePath));
      
      const encoding = options.encoding || this.config.encoding;
      await fs.appendFile(filePath, content, { encoding });
      
    } catch (error) {
      throw new Error(`Failed to append to file: ${error.message}`);
    }
  }

  /**
   * CSVファイルを書き込み
   * @param {string} filePath ファイルパス
   * @param {Array} data CSVデータ（配列の配列）
   * @param {Object} options オプション
   * @returns {Promise<string>} 書き込まれたファイルパス
   */
  async writeCSV(filePath, data, options = {}) {
    try {
      const separator = options.separator || ',';
      const lineEnding = options.lineEnding || '\n';
      
      const csvContent = data
        .map(row => 
          row.map(cell => this._escapeCsvCell(cell, separator)).join(separator)
        )
        .join(lineEnding);
      
      const finalPath = await this._writeWithRetry(filePath, csvContent, {
        ...options,
        format: 'csv'
      });
      
      return finalPath;
    } catch (error) {
      throw new Error(`Failed to write CSV file: ${error.message}`);
    }
  }

  /**
   * Markdownファイルを書き込み
   * @param {string} filePath ファイルパス
   * @param {string} content Markdown内容
   * @param {Object} options オプション
   * @returns {Promise<string>} 書き込まれたファイルパス
   */
  async writeMarkdown(filePath, content, options = {}) {
    try {
      // Markdownヘッダーの自動追加
      if (options.addFrontMatter) {
        const frontMatter = this._generateFrontMatter(options.frontMatter || {});
        content = frontMatter + content;
      }
      
      const finalPath = await this._writeWithRetry(filePath, content, {
        ...options,
        format: 'markdown'
      });
      
      return finalPath;
    } catch (error) {
      throw new Error(`Failed to write Markdown file: ${error.message}`);
    }
  }

  /**
   * HTMLファイルを書き込み
   * @param {string} filePath ファイルパス
   * @param {string} content HTML内容
   * @param {Object} options オプション
   * @returns {Promise<string>} 書き込まれたファイルパス
   */
  async writeHTML(filePath, content, options = {}) {
    try {
      // HTMLドキュメントの自動補完
      if (options.autoComplete && !content.includes('<!DOCTYPE')) {
        content = this._wrapInHtmlDocument(content, options);
      }
      
      const finalPath = await this._writeWithRetry(filePath, content, {
        ...options,
        format: 'html'
      });
      
      return finalPath;
    } catch (error) {
      throw new Error(`Failed to write HTML file: ${error.message}`);
    }
  }

  /**
   * 圧縮ファイルを書き込み
   * @param {string} filePath ファイルパス
   * @param {Buffer|string} data データ
   * @param {Object} options オプション
   * @returns {Promise<string>} 書き込まれたファイルパス
   */
  async writeCompressed(filePath, data, options = {}) {
    try {
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, this.config.encoding);
      const compressed = await gzip(buffer, {
        level: options.compressionLevel || this.config.compressionLevel
      });
      
      const compressedPath = filePath + '.gz';
      await this._writeWithRetry(compressedPath, compressed, {
        ...options,
        format: 'compressed',
        skipCompression: true // 既に圧縮済み
      });
      
      return compressedPath;
    } catch (error) {
      throw new Error(`Failed to write compressed file: ${error.message}`);
    }
  }

  /**
   * 複数ファイルを一括書き込み
   * @param {Array} fileOperations ファイル操作の配列
   * @returns {Promise<Array>} 書き込み結果の配列
   */
  async writeBatch(fileOperations) {
    try {
      const results = await Promise.allSettled(
        fileOperations.map(operation => this._executeFileOperation(operation))
      );
      
      const failures = results
        .filter(result => result.status === 'rejected')
        .map((result, index) => ({
          operation: fileOperations[index],
          error: result.reason
        }));
      
      if (failures.length > 0) {
        console.warn(`⚠️ バッチ書き込みで${failures.length}件の失敗`);
        failures.forEach(failure => {
          console.warn(`  失敗: ${failure.operation.filePath} - ${failure.error.message}`);
        });
      }
      
      return results.map(result => 
        result.status === 'fulfilled' ? result.value : null
      );
    } catch (error) {
      throw new Error(`Failed to execute batch write: ${error.message}`);
    }
  }

  /**
   * ファイルを読み込み（解凍対応）
   * @param {string} filePath ファイルパス
   * @param {Object} options オプション
   * @returns {Promise<Buffer|string>} ファイル内容
   */
  async readFile(filePath, options = {}) {
    try {
      let data = await fs.readFile(filePath);
      
      // 圧縮ファイルの自動解凍
      if (filePath.endsWith('.gz') || options.decompress) {
        data = await gunzip(data);
      }
      
      // テキスト形式で返す場合
      if (options.encoding) {
        return data.toString(options.encoding);
      }
      
      return data;
    } catch (error) {
      throw new Error(`Failed to read file: ${error.message}`);
    }
  }

  /**
   * ファイル存在確認
   * @param {string} filePath ファイルパス
   * @returns {Promise<boolean>} 存在するかどうか
   */
  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * ファイルサイズ取得
   * @param {string} filePath ファイルパス
   * @returns {Promise<number>} ファイルサイズ（バイト）
   */
  async getFileSize(filePath) {
    try {
      const stats = await fs.stat(filePath);
      return stats.size;
    } catch (error) {
      throw new Error(`Failed to get file size: ${error.message}`);
    }
  }

  // プライベートメソッド

  /**
   * リトライ付きファイル書き込み
   * @param {string} filePath ファイルパス
   * @param {Buffer|string} content 内容
   * @param {Object} options オプション
   * @returns {Promise<string>} 最終的なファイルパス
   * @private
   */
  async _writeWithRetry(filePath, content, options = {}) {
    let lastError;
    const maxRetries = options.maxRetries || this.config.maxRetries;
    const retryDelay = options.retryDelay || this.config.retryDelay;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const finalPath = await this._writeFile(filePath, content, options);
        
        if (attempt > 0) {
          console.log(`✅ リトライ成功: ${path.basename(filePath)} (${attempt}回目)`);
        }
        
        return finalPath;
      } catch (error) {
        lastError = error;
        
        if (attempt < maxRetries) {
          console.warn(`⚠️ 書き込み失敗、リトライ中... (${attempt + 1}/${maxRetries}): ${error.message}`);
          await this._delay(retryDelay * (attempt + 1)); // 指数バックオフ
        }
      }
    }
    
    throw new Error(`File write failed after ${maxRetries} retries: ${lastError.message}`);
  }

  /**
   * 実際のファイル書き込み処理
   * @param {string} filePath ファイルパス
   * @param {Buffer|string} content 内容
   * @param {Object} options オプション
   * @returns {Promise<string>} 書き込まれたファイルパス
   * @private
   */
  async _writeFile(filePath, content, options = {}) {
    // ディレクトリの存在確認・作成
    await this._ensureDirectoryExists(path.dirname(filePath));
    
    let finalContent = content;
    let finalPath = filePath;
    
    // 圧縮処理
    if (this.config.compressionEnabled && !options.skipCompression && this._shouldCompress(content, options)) {
      if (typeof content === 'string') {
        finalContent = await gzip(Buffer.from(content, this.config.encoding), {
          level: this.config.compressionLevel
        });
      } else {
        finalContent = await gzip(content, {
          level: this.config.compressionLevel
        });
      }
      finalPath = filePath + '.gz';
    }
    
    // ファイル書き込み
    if (typeof finalContent === 'string') {
      await fs.writeFile(finalPath, finalContent, { 
        encoding: options.encoding || this.config.encoding 
      });
    } else {
      await fs.writeFile(finalPath, finalContent);
    }
    
    return finalPath;
  }

  /**
   * ディレクトリの存在確認・作成
   * @param {string} dirPath ディレクトリパス
   * @private
   */
  async _ensureDirectoryExists(dirPath) {
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
   * 圧縮すべきかどうかを判定
   * @param {Buffer|string} content 内容
   * @param {Object} options オプション
   * @returns {boolean} 圧縮すべきかどうか
   * @private
   */
  _shouldCompress(content, options = {}) {
    // 明示的に圧縮を無効化
    if (options.compression === false) {
      return false;
    }
    
    // 既に圧縮されているファイル形式
    const noCompressFormats = ['binary', 'compressed'];
    if (noCompressFormats.includes(options.format)) {
      return false;
    }
    
    // サイズが小さすぎる場合は圧縮しない
    const minSize = options.minCompressionSize || 1024; // 1KB
    const size = typeof content === 'string' ? 
      Buffer.byteLength(content, this.config.encoding) : 
      content.length;
    
    return size >= minSize;
  }

  /**
   * CSVセルのエスケープ処理
   * @param {any} cell セルの値
   * @param {string} separator 区切り文字
   * @returns {string} エスケープされた値
   * @private
   */
  _escapeCsvCell(cell, separator) {
    const value = String(cell);
    
    // ダブルクォート、改行、区切り文字が含まれている場合はエスケープ
    if (value.includes('"') || value.includes('\n') || value.includes(separator)) {
      return '"' + value.replace(/"/g, '""') + '"';
    }
    
    return value;
  }

  /**
   * Markdownフロントマターを生成
   * @param {Object} frontMatter フロントマターオブジェクト
   * @returns {string} フロントマター文字列
   * @private
   */
  _generateFrontMatter(frontMatter) {
    const defaultMatter = {
      created: new Date().toISOString(),
      generator: 'AutoPlaywright'
    };
    
    const matter = { ...defaultMatter, ...frontMatter };
    const yamlContent = Object.entries(matter)
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join('\n');
    
    return `---\n${yamlContent}\n---\n\n`;
  }

  /**
   * HTMLドキュメントとして包装
   * @param {string} content HTML内容
   * @param {Object} options オプション
   * @returns {string} 完全なHTMLドキュメント
   * @private
   */
  _wrapInHtmlDocument(content, options = {}) {
    const title = options.title || 'AutoPlaywright Report';
    const charset = options.charset || 'UTF-8';
    
    return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="${charset}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <meta name="generator" content="AutoPlaywright">
</head>
<body>
${content}
</body>
</html>`;
  }

  /**
   * ファイル操作を実行
   * @param {Object} operation ファイル操作定義
   * @returns {Promise<string>} 結果ファイルパス
   * @private
   */
  async _executeFileOperation(operation) {
    const { type, filePath, data, options = {} } = operation;
    
    switch (type) {
      case 'json':
        return await this.writeJSON(filePath, data, options);
      case 'text':
        return await this.writeText(filePath, data, options);
      case 'binary':
        return await this.writeBinary(filePath, data, options);
      case 'csv':
        return await this.writeCSV(filePath, data, options);
      case 'markdown':
        return await this.writeMarkdown(filePath, data, options);
      case 'html':
        return await this.writeHTML(filePath, data, options);
      default:
        throw new Error(`Unknown file operation type: ${type}`);
    }
  }

  /**
   * 指定時間待機
   * @param {number} ms 待機時間（ミリ秒）
   * @returns {Promise<void>}
   * @private
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = FileWriter; 