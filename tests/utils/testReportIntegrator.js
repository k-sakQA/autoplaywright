import fs from 'fs';
import path from 'path';
import { TestPointFunctionMapper } from './testPointFunctionMapper.js';
import { EnhancedReportGenerator } from './enhancedReportGenerator.js';
import { AIRiskAnalyzer } from './aiRiskAnalyzer.js';

/**
 * テストレポート統合管理クラス
 * 既存システムと新機能の橋渡し役
 */
export class TestReportIntegrator {
  constructor(options = {}) {
    this.options = {
      enableMapping: true,
      enableAIAnalysis: true,
      enableEnhancedReporting: true,
      outputDir: path.join(process.cwd(), 'test-results'),
      ...options
    };
    
    this.testPointMapper = null;
    this.reportGenerator = null;
    this.aiAnalyzer = null;
    
    this.initializeComponents();
  }
  
  /**
   * コンポーネント初期化
   */
  async initializeComponents() {
    try {
      // TestPointFunctionMapper初期化
      if (this.options.enableMapping) {
        this.testPointMapper = new TestPointFunctionMapper();
        console.log('✅ TestPointFunctionMapper初期化完了');
      }
      
      // AIRiskAnalyzer初期化
      if (this.options.enableAIAnalysis) {
        this.aiAnalyzer = new AIRiskAnalyzer();
        console.log('✅ AIRiskAnalyzer初期化完了');
      }
      
      // EnhancedReportGenerator初期化
      if (this.options.enableEnhancedReporting) {
        this.reportGenerator = new EnhancedReportGenerator(
          this.testPointMapper,
          this.aiAnalyzer
        );
        console.log('✅ EnhancedReportGenerator初期化完了');
      }
      
    } catch (error) {
      console.warn('⚠️ 一部のコンポーネント初期化に失敗:', error.message);
    }
  }
  
  /**
   * 拡張テストレポートの作成
   * @param {Array} testPoints テスト観点配列
   * @param {Object} route テストルート
   * @param {Object} result テスト実行結果
   * @param {Object} userStoryInfo ユーザーストーリー情報
   * @returns {Object} 生成されたレポート情報
   */
  async createEnhancedTestReport(testPoints, route, result, userStoryInfo = null) {
    try {
      console.log('🚀 拡張テストレポート生成開始...');
      
      // 1. テスト観点マッピングの実行
      let mappingMatrix = new Map();
      if (this.testPointMapper && testPoints && testPoints.length > 0) {
        console.log('📊 テスト観点マッピング実行中...');
        
        // ルートから機能情報を抽出
        const detectedFunctions = this.extractFunctionsFromRoute(route);
        
        await this.testPointMapper.loadTestPointMappings(
          path.join(process.cwd(), 'test_point', 'TestPoint_Format.csv'),
          detectedFunctions
        );
        
        mappingMatrix = this.testPointMapper.getMappingMatrix();
        console.log(`✅ ${mappingMatrix.size}件の観点マッピング完了`);
      }
      
      // 2. 従来のCSVレポートを生成（createTraceableTestReportの代替）
      const csvReport = await this.generateTraceableCSVReport(testPoints, route, result, userStoryInfo);
      
      // 3. 拡張HTMLレポートを生成
      let htmlReport = null;
      if (this.reportGenerator) {
        console.log('📊 拡張HTMLレポート生成中...');
        
        const enhancedTestData = {
          testName: userStoryInfo?.content || 'テスト実行',
          url: route.url || result.url || '',
          timestamp: new Date().toISOString(),
          steps: result.steps || [],
          userStoryInfo,
          route,
          mappingMatrix
        };
        
        htmlReport = await this.reportGenerator.generateEnhancedHTMLReport(
          enhancedTestData,
          this.options
        );
        
        console.log('✅ 拡張HTMLレポート生成完了');
      }
      
      // 4. レポートファイル保存
      const reportFiles = await this.saveReports(csvReport, htmlReport, userStoryInfo);
      
      // 5. 統計情報とメタデータの保存
      const metadata = this.generateReportMetadata(testPoints, route, result, mappingMatrix);
      await this.saveReportMetadata(metadata);
      
      console.log('🎉 拡張テストレポート生成完了！');
      
      return {
        success: true,
        files: reportFiles,
        metadata,
        mappingStats: this.testPointMapper?.getStatistics(),
        message: '拡張テストレポートが正常に生成されました'
      };
      
    } catch (error) {
      console.error('❌ 拡張テストレポート生成エラー:', error);
      return {
        success: false,
        error: error.message,
        fallbackMessage: '基本レポートの生成に切り替えてください'
      };
    }
  }
  
  /**
   * ルートから機能情報を抽出
   * @param {Object} route テストルート
   * @returns {Array} 機能定義配列
   */
  extractFunctionsFromRoute(route) {
    const functions = [];
    
    if (!route || !route.steps) {
      return this.getDefaultFunctions();
    }
    
    // ルートステップから機能を推定
    route.steps.forEach(step => {
      switch (step.action) {
        case 'load':
        case 'goto':
          functions.push({
            name: 'ページ表示',
            description: 'ページの読み込みと表示',
            category: 'display'
          });
          break;
        case 'fill':
          functions.push({
            name: 'データ入力',
            description: 'フォームフィールドへの入力',
            category: 'input'
          });
          break;
        case 'click':
          functions.push({
            name: 'ボタン操作',
            description: 'ボタンやリンクのクリック',
            category: 'interaction'
          });
          break;
        case 'select':
          functions.push({
            name: '選択操作',
            description: 'ドロップダウンやオプションの選択',
            category: 'selection'
          });
          break;
        case 'check':
        case 'uncheck':
          functions.push({
            name: 'チェック操作',
            description: 'チェックボックスの操作',
            category: 'interaction'
          });
          break;
      }
    });
    
    // 重複除去
    const uniqueFunctions = functions.filter((func, index, self) => 
      index === self.findIndex(f => f.name === func.name)
    );
    
    return uniqueFunctions.length > 0 ? uniqueFunctions : this.getDefaultFunctions();
  }
  
  /**
   * デフォルト機能定義取得
   * @returns {Array} デフォルト機能配列
   */
  getDefaultFunctions() {
    return [
      { name: 'ページ表示', description: 'ページの読み込みと表示', category: 'display' },
      { name: 'データ入力', description: 'フォームフィールドへの入力', category: 'input' },
      { name: 'ボタン操作', description: 'ボタンやリンクのクリック', category: 'interaction' },
      { name: '選択操作', description: 'ドロップダウンやオプションの選択', category: 'selection' },
      { name: 'ナビゲーション', description: 'ページ間の移動', category: 'navigation' }
    ];
  }
  
  /**
   * 従来のCSVレポート生成（既存ロジックの簡略版）
   * @param {Array} testPoints テスト観点
   * @param {Object} route ルート
   * @param {Object} result 結果
   * @param {Object} userStoryInfo ユーザーストーリー
   * @returns {string} CSVレポート文字列
   */
  async generateTraceableCSVReport(testPoints, route, result, userStoryInfo) {
    const executionTime = new Date().toISOString();
    const userStory = userStoryInfo?.content || 'テストシナリオ実行';
    const userStoryId = userStoryInfo?.currentId || 1;
    const testUrl = route.url || result.url || '';
    
    const headers = [
      '実行日時',
      'ID',
      'ユーザーストーリー',
      '機能',
      '観点',
      'テスト手順',
      '実行結果',
      'エラー詳細',
      'URL',
      '実行種別',
      'テスト複雑度',
      'リスクスコア'
    ];
    
    const reportData = [];
    
    if (result.steps && Array.isArray(result.steps)) {
      result.steps.forEach((step, stepIndex) => {
        const testCaseId = `${userStoryId}.1.${stepIndex + 1}`;
        const functionName = this.inferFunctionFromStep(step);
        const viewpoint = testPoints && testPoints[stepIndex % testPoints.length] 
          ? testPoints[stepIndex % testPoints.length].point || testPoints[stepIndex % testPoints.length].testPerspective
          : `実行ステップ${stepIndex + 1}`;
        
        const riskScore = this.calculateStepRiskScore(step);
        
        reportData.push({
          executionTime,
          id: testCaseId,
          userStory,
          function: functionName,
          viewpoint,
          testSteps: this.formatStepDescription(step),
          executionResult: step.status === 'success' ? 'success' : 'failed',
          errorDetail: step.error || '',
          url: testUrl,
          executionType: '自動実行',
          testComplexity: 'enhanced',
          riskScore: riskScore.toFixed(2)
        });
      });
    }
    
    // CSV生成
    const csvRows = [headers.join(',')];
    reportData.forEach(data => {
      const row = [
        this.escapeCSVField(data.executionTime),
        this.escapeCSVField(data.id),
        this.escapeCSVField(data.userStory),
        this.escapeCSVField(data.function),
        this.escapeCSVField(data.viewpoint),
        this.escapeCSVField(data.testSteps),
        this.escapeCSVField(data.executionResult),
        this.escapeCSVField(data.errorDetail),
        this.escapeCSVField(data.url),
        this.escapeCSVField(data.executionType),
        this.escapeCSVField(data.testComplexity),
        this.escapeCSVField(data.riskScore)
      ];
      csvRows.push(row.join(','));
    });
    
    return csvRows.join('\n');
  }
  
  /**
   * ステップから機能を推定
   * @param {Object} step テストステップ
   * @returns {string} 機能名
   */
  inferFunctionFromStep(step) {
    switch (step.action) {
      case 'load':
      case 'goto':
        return 'ページ表示';
      case 'fill':
        return 'データ入力';
      case 'click':
        return 'ボタン操作';
      case 'select':
        return '選択操作';
      case 'check':
      case 'uncheck':
        return 'チェック操作';
      default:
        return 'その他機能';
    }
  }
  
  /**
   * ステップ説明のフォーマット
   * @param {Object} step テストステップ
   * @returns {string} フォーマットされた説明
   */
  formatStepDescription(step) {
    let description = step.label || step.action || '実行';
    
    if (step.target) {
      description += ` (対象: ${step.target})`;
    }
    
    if (step.value) {
      description += ` (値: ${step.value})`;
    }
    
    return description;
  }
  
  /**
   * ステップリスクスコア計算
   * @param {Object} step テストステップ
   * @returns {number} リスクスコア (0-1)
   */
  calculateStepRiskScore(step) {
    let risk = 0.0;
    
    // 失敗ステップの場合
    if (step.status === 'failed') {
      risk += 0.5;
    }
    
    // 実行時間が長い場合
    const executionTime = step.duration || step.executionTime || 0;
    if (executionTime > 5000) {
      risk += 0.3;
    } else if (executionTime > 2000) {
      risk += 0.1;
    }
    
    // エラーがある場合
    if (step.error) {
      risk += 0.2;
    }
    
    return Math.min(risk, 1.0);
  }
  
  /**
   * CSVフィールドエスケープ
   * @param {string} str エスケープする文字列
   * @returns {string} エスケープされた文字列
   */
  escapeCSVField(str) {
    if (str == null) return '""';
    
    const stringValue = String(str);
    
    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n') || stringValue.includes('\r')) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    
    return stringValue;
  }
  
  /**
   * レポートファイル保存
   * @param {string} csvReport CSVレポート
   * @param {string} htmlReport HTMLレポート
   * @param {Object} userStoryInfo ユーザーストーリー情報
   * @returns {Object} 保存されたファイル情報
   */
  async saveReports(csvReport, htmlReport, userStoryInfo) {
    const timestamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '');
    const files = {};
    
    try {
      // CSV保存
      if (csvReport) {
        const csvFilename = `AutoPlaywright 拡張テスト結果 - Enhanced_${timestamp}.csv`;
        const csvPath = path.join(this.options.outputDir, csvFilename);
        await fs.promises.writeFile(csvPath, csvReport, 'utf8');
        files.csv = { path: csvPath, filename: csvFilename };
        console.log(`✅ CSV保存: ${csvFilename}`);
      }
      
      // HTML保存
      if (htmlReport) {
        const htmlFilename = `AutoPlaywright_Enhanced_Report_${timestamp}.html`;
        const htmlPath = path.join(this.options.outputDir, htmlFilename);
        await fs.promises.writeFile(htmlPath, htmlReport, 'utf8');
        files.html = { path: htmlPath, filename: htmlFilename };
        console.log(`✅ HTML保存: ${htmlFilename}`);
      }
      
      return files;
      
    } catch (error) {
      console.error('❌ レポートファイル保存エラー:', error);
      throw error;
    }
  }
  
  /**
   * レポートメタデータ生成
   * @param {Array} testPoints テスト観点
   * @param {Object} route ルート
   * @param {Object} result 結果
   * @param {Map} mappingMatrix マッピングマトリックス
   * @returns {Object} メタデータ
   */
  generateReportMetadata(testPoints, route, result, mappingMatrix) {
    const steps = result.steps || [];
    
    return {
      generatedAt: new Date().toISOString(),
      version: '2.0-enhanced',
      testSummary: {
        totalSteps: steps.length,
        successfulSteps: steps.filter(s => s.status === 'success').length,
        failedSteps: steps.filter(s => s.status === 'failed').length,
        successRate: steps.length > 0 ? ((steps.filter(s => s.status === 'success').length / steps.length) * 100).toFixed(1) : '0.0'
      },
      mappingSummary: {
        totalMappings: mappingMatrix.size,
        averageConfidence: this.testPointMapper?.getStatistics()?.averageConfidence || 0,
        functionsDetected: this.extractFunctionsFromRoute(route).length
      },
      aiAnalysisEnabled: !!this.aiAnalyzer,
      enhancedFeaturesEnabled: {
        mapping: !!this.testPointMapper,
        aiAnalysis: !!this.aiAnalyzer,
        enhancedReporting: !!this.reportGenerator
      }
    };
  }
  
  /**
   * レポートメタデータ保存
   * @param {Object} metadata メタデータ
   */
  async saveReportMetadata(metadata) {
    try {
      const timestamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '');
      const metadataPath = path.join(this.options.outputDir, `enhanced_report_metadata_${timestamp}.json`);
      
      await fs.promises.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
      console.log(`✅ メタデータ保存: enhanced_report_metadata_${timestamp}.json`);
      
    } catch (error) {
      console.warn('⚠️ メタデータ保存エラー:', error.message);
    }
  }
  
  /**
   * 統合テストレポートのステータス取得
   * @returns {Object} ステータス情報
   */
  getStatus() {
    return {
      initialized: true,
      components: {
        testPointMapper: !!this.testPointMapper,
        reportGenerator: !!this.reportGenerator,
        aiAnalyzer: !!this.aiAnalyzer
      },
      options: this.options,
      lastUpdate: new Date().toISOString()
    };
  }
} 