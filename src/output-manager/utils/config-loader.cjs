const fs = require('fs').promises;
const path = require('path');

/**
 * AutoPlaywright設定ファイル読み込みクラス
 * グローバル設定とセッション設定の管理を行う
 */
class ConfigLoader {
  /**
   * @param {string} baseDir ベースディレクトリパス
   */
  constructor(baseDir = 'test-results') {
    this.baseDir = baseDir;
    this.configDir = path.join(baseDir, '.autoplaywright');
    this.globalConfigPath = path.join(this.configDir, 'global-config.json');
    
    // デフォルト設定
    this.defaultConfig = {
      output: {
        baseDirectory: 'test-results',
        sessionIdFormat: 'YYYY-MM-DD_HH-mm-ss',
        enableAutoArchiving: true,
        retentionDays: 30,
        compressionLevel: 6
      },
      artifacts: {
        testPoints: {
          enabled: true,
          format: 'json'
        },
        testCases: {
          enabled: true,
          format: 'markdown'
        },
        scripts: {
          enabled: true,
          language: 'javascript'
        },
        domSnapshots: {
          enabled: true,
          includeScreenshots: true,
          compressionEnabled: true
        }
      },
      results: {
        reports: {
          formats: ['html', 'json'],
          includeScreenshots: true,
          includeTraces: true
        },
        screenshots: {
          format: 'png',
          quality: 90,
          captureOnFailure: true,
          captureOnStep: false
        },
        traces: {
          enabled: true,
          includeNetworkData: true,
          includeConsole: true
        },
        logs: {
          level: 'info',
          includeTimestamps: true,
          separateErrorLog: true
        }
      }
    };
  }

  /**
   * グローバル設定を読み込み
   * @returns {Promise<Object>} 設定オブジェクト
   */
  async loadGlobalConfig() {
    try {
      // 設定ディレクトリの存在確認・作成
      await this._ensureConfigDirectory();
      
      // 設定ファイルの存在確認
      const configExists = await this._fileExists(this.globalConfigPath);
      
      if (!configExists) {
        // デフォルト設定ファイルを作成
        await this._createDefaultGlobalConfig();
        console.log(`🔧 デフォルト設定ファイルを作成: ${this.globalConfigPath}`);
        return { ...this.defaultConfig };
      }
      
      // 設定ファイルを読み込み
      const configContent = await fs.readFile(this.globalConfigPath, 'utf8');
      const config = JSON.parse(configContent);
      
      // デフォルト設定とマージ
      const mergedConfig = this._mergeConfigs(this.defaultConfig, config);
      
      console.log(`📋 グローバル設定読み込み完了: ${this.globalConfigPath}`);
      return mergedConfig;
      
    } catch (error) {
      console.warn(`⚠️ 設定読み込み失敗、デフォルト設定を使用: ${error.message}`);
      return { ...this.defaultConfig };
    }
  }

  /**
   * グローバル設定を保存
   * @param {Object} config 設定オブジェクト
   * @returns {Promise<void>}
   */
  async saveGlobalConfig(config) {
    try {
      await this._ensureConfigDirectory();
      
      const configJson = JSON.stringify(config, null, 2);
      await fs.writeFile(this.globalConfigPath, configJson, 'utf8');
      
      console.log(`💾 グローバル設定保存完了: ${this.globalConfigPath}`);
    } catch (error) {
      throw new Error(`Failed to save global config: ${error.message}`);
    }
  }

  /**
   * セッション設定を読み込み
   * @param {string} sessionId セッションID
   * @returns {Promise<Object>} セッション設定オブジェクト
   */
  async loadSessionConfig(sessionId) {
    try {
      const sessionConfigPath = path.join(
        this.baseDir, 'runs', sessionId, 'config', 'run-config.json'
      );
      
      const configExists = await this._fileExists(sessionConfigPath);
      if (!configExists) {
        throw new Error(`Session config not found: ${sessionId}`);
      }
      
      const configContent = await fs.readFile(sessionConfigPath, 'utf8');
      const config = JSON.parse(configContent);
      
      console.log(`📋 セッション設定読み込み: ${sessionId}`);
      return config;
      
    } catch (error) {
      throw new Error(`Failed to load session config: ${error.message}`);
    }
  }

  /**
   * セッション設定を保存
   * @param {string} sessionId セッションID
   * @param {Object} config セッション設定オブジェクト
   * @returns {Promise<void>}
   */
  async saveSessionConfig(sessionId, config) {
    try {
      const sessionConfigDir = path.join(
        this.baseDir, 'runs', sessionId, 'config'
      );
      const sessionConfigPath = path.join(sessionConfigDir, 'run-config.json');
      
      // 設定ディレクトリを作成
      await this._ensureDirectoryExists(sessionConfigDir);
      
      const configJson = JSON.stringify(config, null, 2);
      await fs.writeFile(sessionConfigPath, configJson, 'utf8');
      
      console.log(`💾 セッション設定保存: ${sessionId}`);
    } catch (error) {
      throw new Error(`Failed to save session config: ${error.message}`);
    }
  }

  /**
   * 環境設定を読み込み
   * @param {string} sessionId セッションID
   * @returns {Promise<Object>} 環境設定オブジェクト
   */
  async loadEnvironmentConfig(sessionId) {
    try {
      const envConfigPath = path.join(
        this.baseDir, 'runs', sessionId, 'config', 'env-config.json'
      );
      
      const configExists = await this._fileExists(envConfigPath);
      if (!configExists) {
        // デフォルト環境設定を返す
        return this._getDefaultEnvironmentConfig();
      }
      
      const configContent = await fs.readFile(envConfigPath, 'utf8');
      const config = JSON.parse(configContent);
      
      console.log(`🌍 環境設定読み込み: ${sessionId}`);
      return config;
      
    } catch (error) {
      console.warn(`⚠️ 環境設定読み込み失敗、デフォルトを使用: ${error.message}`);
      return this._getDefaultEnvironmentConfig();
    }
  }

  /**
   * 環境設定を保存
   * @param {string} sessionId セッションID
   * @param {Object} config 環境設定オブジェクト
   * @returns {Promise<void>}
   */
  async saveEnvironmentConfig(sessionId, config) {
    try {
      const sessionConfigDir = path.join(
        this.baseDir, 'runs', sessionId, 'config'
      );
      const envConfigPath = path.join(sessionConfigDir, 'env-config.json');
      
      // 設定ディレクトリを作成
      await this._ensureDirectoryExists(sessionConfigDir);
      
      const configJson = JSON.stringify(config, null, 2);
      await fs.writeFile(envConfigPath, configJson, 'utf8');
      
      console.log(`🌍 環境設定保存: ${sessionId}`);
    } catch (error) {
      throw new Error(`Failed to save environment config: ${error.message}`);
    }
  }

  /**
   * 設定の妥当性を検証
   * @param {Object} config 設定オブジェクト
   * @returns {Object} 検証結果
   */
  validateConfig(config) {
    const issues = [];
    const warnings = [];
    
    try {
      // 必須フィールドの検証
      if (!config.output) {
        issues.push('output section is missing');
      } else {
        if (!config.output.baseDirectory) {
          issues.push('output.baseDirectory is required');
        }
        if (typeof config.output.retentionDays !== 'number' || config.output.retentionDays < 1) {
          warnings.push('output.retentionDays should be a positive number');
        }
      }
      
      // artifacts設定の検証
      if (config.artifacts) {
        if (config.artifacts.scripts && !['javascript', 'typescript'].includes(config.artifacts.scripts.language)) {
          warnings.push('artifacts.scripts.language should be "javascript" or "typescript"');
        }
      }
      
      // results設定の検証
      if (config.results) {
        if (config.results.screenshots) {
          if (!['png', 'jpg', 'jpeg'].includes(config.results.screenshots.format)) {
            warnings.push('results.screenshots.format should be "png", "jpg", or "jpeg"');
          }
          const quality = config.results.screenshots.quality;
          if (typeof quality === 'number' && (quality < 1 || quality > 100)) {
            warnings.push('results.screenshots.quality should be between 1 and 100');
          }
        }
      }
      
    } catch (error) {
      issues.push(`Config validation error: ${error.message}`);
    }
    
    return {
      isValid: issues.length === 0,
      issues,
      warnings
    };
  }

  /**
   * 設定をリセット（デフォルトに戻す）
   * @returns {Promise<void>}
   */
  async resetToDefaults() {
    try {
      await this.saveGlobalConfig(this.defaultConfig);
      console.log(`🔄 設定をデフォルトにリセット`);
    } catch (error) {
      throw new Error(`Failed to reset config: ${error.message}`);
    }
  }

  /**
   * 設定をバックアップ
   * @returns {Promise<string>} バックアップファイルパス
   */
  async backupConfig() {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(
        this.configDir,
        `global-config.backup.${timestamp}.json`
      );
      
      const configExists = await this._fileExists(this.globalConfigPath);
      if (configExists) {
        const config = await fs.readFile(this.globalConfigPath, 'utf8');
        await fs.writeFile(backupPath, config, 'utf8');
        
        console.log(`📦 設定バックアップ作成: ${backupPath}`);
        return backupPath;
      }
      
      return null;
    } catch (error) {
      throw new Error(`Failed to backup config: ${error.message}`);
    }
  }

  // プライベートメソッド

  /**
   * 設定ディレクトリの存在確認・作成
   * @private
   */
  async _ensureConfigDirectory() {
    await this._ensureDirectoryExists(this.configDir);
    await this._ensureDirectoryExists(path.join(this.configDir, 'templates'));
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
   * ファイルの存在確認
   * @param {string} filePath ファイルパス
   * @returns {Promise<boolean>} 存在するかどうか
   * @private
   */
  async _fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * デフォルトグローバル設定ファイルを作成
   * @private
   */
  async _createDefaultGlobalConfig() {
    const configJson = JSON.stringify(this.defaultConfig, null, 2);
    await fs.writeFile(this.globalConfigPath, configJson, 'utf8');
  }

  /**
   * 設定をマージ（深いマージ）
   * @param {Object} defaultConfig デフォルト設定
   * @param {Object} userConfig ユーザー設定
   * @returns {Object} マージされた設定
   * @private
   */
  _mergeConfigs(defaultConfig, userConfig) {
    const result = { ...defaultConfig };
    
    for (const key in userConfig) {
      if (userConfig.hasOwnProperty(key)) {
        if (typeof userConfig[key] === 'object' && 
            userConfig[key] !== null && 
            !Array.isArray(userConfig[key])) {
          result[key] = this._mergeConfigs(result[key] || {}, userConfig[key]);
        } else {
          result[key] = userConfig[key];
        }
      }
    }
    
    return result;
  }

  /**
   * デフォルト環境設定を取得
   * @returns {Object} デフォルト環境設定
   * @private
   */
  _getDefaultEnvironmentConfig() {
    return {
      browser: {
        name: 'chromium',
        headless: true,
        viewport: {
          width: 1280,
          height: 720
        }
      },
      network: {
        timeout: 30000,
        retries: 2,
        slowMo: 0
      },
      testing: {
        takeScreenshotOnFailure: true,
        recordTrace: false,
        recordVideo: false
      },
      environment: {
        NODE_ENV: 'test',
        CI: false
      }
    };
  }
}

module.exports = ConfigLoader; 