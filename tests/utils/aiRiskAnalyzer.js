import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';

/**
 * AI駆動リスク分析エンジン
 * 要件: AI不具合分析
 */
export class AIRiskAnalyzer {
  constructor(config = {}) {
    this.config = {
      model: 'gpt-4-turbo-preview',
      temperature: 0.3,
      maxTokens: 1500,
      ...config
    };
    
    this.openai = null;
    this.analysisHistory = [];
    this.initializeAI();
  }
  
  /**
   * AI機能の初期化
   */
  async initializeAI() {
    try {
      const configPath = path.join(process.cwd(), 'config.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config.openaiApiKey) {
          this.openai = new OpenAI({
            apiKey: config.openaiApiKey
          });
          console.log('✅ AI Risk Analyzer初期化完了');
        }
      }
    } catch (error) {
      console.warn('⚠️ AI Risk Analyzer初期化失敗:', error.message);
    }
  }
  
  /**
   * 包括的なテスト結果リスク分析
   * @param {Object} testResult テスト実行結果
   * @param {Object} route テストルート（オプション）
   * @param {Array} testPoints テスト観点（オプション）
   * @returns {Object} 包括的リスク分析結果
   */
  async analyzeTestResults(testResult, route = null, testPoints = []) {
    try {
      console.log('🤖 AI包括リスク分析を開始...');
      
      const analyses = await Promise.all([
        this.analyzePotentialBugs(testResult, route, testPoints),
        this.analyzePerformanceRisks(testResult),
        this.analyzeCoverageGaps(testResult, testPoints),
        this.predictFutureFailures(testResult, route)
      ]);
      
      const overallRiskScore = this.calculateOverallRisk(analyses);
      
      const comprehensiveAnalysis = {
        riskAssessment: analyses[0],
        performanceAnalysis: analyses[1],
        coverageAnalysis: analyses[2],
        predictionAnalysis: analyses[3],
        overallRiskScore,
        generatedAt: new Date().toISOString(),
        analysisVersion: '2.0',
        confidence: this.calculateAnalysisConfidence(analyses)
      };
      
      // 分析履歴に保存
      this.analysisHistory.push({
        timestamp: new Date().toISOString(),
        result: comprehensiveAnalysis,
        inputHash: this.generateInputHash(testResult)
      });
      
      console.log(`✅ AI分析完了 - 総合リスクスコア: ${(overallRiskScore * 100).toFixed(1)}%`);
      return comprehensiveAnalysis;
      
    } catch (error) {
      console.error('❌ AI分析エラー:', error);
      return this.getFallbackAnalysis();
    }
  }
  
  /**
   * 潜在的不具合の分析
   * @param {Object} testResult テスト結果
   * @param {Object} route ルート情報
   * @param {Array} testPoints テスト観点
   * @returns {Object} 不具合リスク分析
   */
  async analyzePotentialBugs(testResult, route, testPoints) {
    if (!this.openai) {
      return this.getFallbackBugAnalysis();
    }
    
    const prompt = this.buildBugAnalysisPrompt(testResult, route, testPoints);
    
    try {
      const response = await this.openai.chat.completions.create({
        model: this.config.model,
        messages: [
          {
            role: 'system',
            content: 'あなたはWebアプリケーションのテスト品質とリスク分析の専門家です。テスト結果から潜在的な不具合を予測し、実用的な対策を提案してください。'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens
      });
      
      const content = response.choices[0].message.content.trim();
      const analysis = JSON.parse(content);
      
      // 分析結果の検証と正規化
      return this.validateAndNormalizeBugAnalysis(analysis);
      
    } catch (error) {
      console.warn(`⚠️ AI不具合分析失敗: ${error.message}`);
      return this.getFallbackBugAnalysis();
    }
  }
  
  /**
   * 不具合分析プロンプト構築
   * @param {Object} testResult テスト結果
   * @param {Object} route ルート情報
   * @param {Array} testPoints テスト観点
   * @returns {string} 分析プロンプト
   */
  buildBugAnalysisPrompt(testResult, route, testPoints) {
    const steps = testResult.steps || [];
    const failedSteps = steps.filter(step => step.status === 'failed');
    const successRate = steps.length > 0 ? (steps.filter(s => s.status === 'success').length / steps.length * 100).toFixed(1) : '0.0';
    
    return `
# Webアプリケーションテスト結果分析

## テスト実行概要
- **対象URL**: ${route?.url || testResult.url || 'N/A'}
- **実行ステップ数**: ${steps.length}
- **成功率**: ${successRate}%
- **失敗ステップ数**: ${failedSteps.length}
- **実行時間**: ${testResult.duration || 'N/A'}ms

## 失敗ステップ詳細
${failedSteps.map((step, index) => `
### 失敗 ${index + 1}: ${step.label || step.action}
- **アクション**: ${step.action}
- **対象**: ${step.target || 'N/A'}
- **エラー**: ${step.error || 'エラー詳細なし'}
- **実行時間**: ${step.duration || step.executionTime || 'N/A'}ms
`).join('\n')}

## 実行ステップパターン
${steps.slice(0, 10).map((step, index) => `
${index + 1}. ${step.action} (${step.status}) - ${step.label || step.target || 'N/A'}
`).join('')}
${steps.length > 10 ? `... 他 ${steps.length - 10} ステップ` : ''}

## テスト観点情報
${testPoints.slice(0, 5).map(tp => `- ${tp.category || 'カテゴリなし'}: ${tp.point || tp.testPerspective || 'N/A'}`).join('\n')}

# 分析要求

以下の観点で潜在的不具合リスクを分析してください：

1. **UI/UX関連の不具合**
   - レスポンシブデザインの問題
   - アクセシビリティの課題
   - ユーザビリティの問題

2. **機能的不具合**
   - データ処理の異常
   - バリデーションの不備
   - 状態管理の問題

3. **パフォーマンス関連**
   - 表示速度の問題
   - メモリリークのリスク
   - ネットワーク効率性

4. **セキュリティリスク**
   - 入力値検証の不備
   - 認証・認可の問題
   - データ漏洩のリスク

## 回答形式（必須JSON）

\`\`\`json
{
  "potentialBugs": [
    {
      "description": "具体的な不具合の説明",
      "severity": "critical|high|medium|low",
      "likelihood": 0.8,
      "category": "ui|functional|performance|security",
      "affectedFunctions": ["機能1", "機能2"],
      "recommendedActions": ["具体的な対応策1", "対応策2"],
      "estimatedImpact": "ユーザーへの影響度説明",
      "detectionMethod": "この不具合を発見する方法"
    }
  ],
  "overallRiskScore": 0.6,
  "riskSummary": "全体的なリスク評価の概要",
  "priorityActions": ["最優先で対応すべき項目1", "項目2"]
}
\`\`\`

**重要**: 実際のテスト失敗を基に現実的で実用的な分析を行ってください。推測ではなく、提供されたデータに基づいた分析をお願いします。
    `;
  }
  
  /**
   * パフォーマンスリスク分析
   * @param {Object} testResult テスト結果
   * @returns {Object} パフォーマンス分析結果
   */
  async analyzePerformanceRisks(testResult) {
    const steps = testResult.steps || [];
    const slowThreshold = 3000; // 3秒
    const verySlowThreshold = 10000; // 10秒
    
    const slowSteps = steps
      .filter(step => (step.duration || step.executionTime || 0) > slowThreshold)
      .map(step => ({
        stepId: step.label || step.action || 'unknown',
        executionTime: step.duration || step.executionTime || 0,
        action: step.action,
        target: step.target,
        suggestedOptimizations: this.generateOptimizationSuggestions(step)
      }))
      .sort((a, b) => b.executionTime - a.executionTime);
    
    const performanceMetrics = {
      totalExecutionTime: steps.reduce((sum, step) => sum + (step.duration || step.executionTime || 0), 0),
      averageStepTime: steps.length > 0 ? 
        steps.reduce((sum, step) => sum + (step.duration || step.executionTime || 0), 0) / steps.length : 0,
      slowStepsCount: slowSteps.length,
      verySlowStepsCount: slowSteps.filter(step => step.executionTime > verySlowThreshold).length
    };
    
    const riskLevel = this.calculatePerformanceRisk(performanceMetrics);
    
    return {
      slowSteps,
      performanceMetrics,
      riskLevel,
      recommendations: this.generatePerformanceRecommendations(performanceMetrics, slowSteps)
    };
  }
  
  /**
   * 最適化提案生成
   * @param {Object} step テストステップ
   * @returns {Array} 最適化提案配列
   */
  generateOptimizationSuggestions(step) {
    const suggestions = [];
    const executionTime = step.duration || step.executionTime || 0;
    
    if (step.action === 'load' || step.action === 'goto') {
      suggestions.push('ページ読み込み最適化');
      if (executionTime > 5000) {
        suggestions.push('CDN使用検討');
        suggestions.push('画像最適化');
      }
    }
    
    if (step.action === 'fill') {
      suggestions.push('入力フィールド最適化');
      if (executionTime > 2000) {
        suggestions.push('バリデーション見直し');
      }
    }
    
    if (step.action === 'click') {
      suggestions.push('レスポンス性改善');
      if (executionTime > 3000) {
        suggestions.push('API処理最適化');
      }
    }
    
    if (executionTime > 10000) {
      suggestions.push('タイムアウト設定見直し');
      suggestions.push('非同期処理改善');
    }
    
    return suggestions;
  }
  
  /**
   * カバレッジギャップ分析
   * @param {Object} testResult テスト結果
   * @param {Array} testPoints テスト観点
   * @returns {Object} カバレッジ分析結果
   */
  async analyzeCoverageGaps(testResult, testPoints) {
    const steps = testResult.steps || [];
    const executedActions = new Set(steps.map(s => s.action).filter(Boolean));
    
    // テスト観点から期待されるアクション
    const requiredActions = new Set();
    testPoints.forEach(tp => {
      if (tp.expectedAction) {
        requiredActions.add(tp.expectedAction);
      }
      // カテゴリベースの期待アクション
      if (tp.category && tp.category.includes('入力')) {
        requiredActions.add('fill');
      }
      if (tp.category && tp.category.includes('表示')) {
        requiredActions.add('load');
      }
    });
    
    // 基本的なWebアプリケーションアクション
    const standardActions = ['load', 'click', 'fill', 'select', 'check'];
    standardActions.forEach(action => requiredActions.add(action));
    
    const testedFunctions = Array.from(executedActions);
    const untestedFunctions = Array.from(requiredActions).filter(action => !executedActions.has(action));
    
    // 修正: カバレッジ計算の正確性向上
    const coveragePercentage = requiredActions.size > 0 
      ? ((requiredActions.size - untestedFunctions.length) / requiredActions.size) * 100 
      : 100;
    
    return {
      testedFunctions,
      untestedFunctions,
      coveragePercentage: Math.round(coveragePercentage),
      gapAnalysis: this.analyzeSpecificGaps(untestedFunctions, testPoints),
      recommendations: this.generateCoverageRecommendations(untestedFunctions)
    };
  }
  
  /**
   * 将来の失敗予測
   * @param {Object} testResult テスト結果
   * @param {Object} route ルート情報
   * @returns {Object} 失敗予測分析
   */
  async predictFutureFailures(testResult, route) {
    const steps = testResult.steps || [];
    const failurePatterns = this.detectFailurePatterns(steps);
    const riskFactors = this.identifyRiskFactors(testResult, route);
    
    return {
      failurePatterns,
      riskFactors,
      predictionConfidence: this.calculatePredictionConfidence(failurePatterns, riskFactors),
      preventiveActions: this.suggestPreventiveActions(failurePatterns, riskFactors)
    };
  }
  
  /**
   * 失敗パターン検出
   * @param {Array} steps テストステップ配列
   * @returns {Array} 検出された失敗パターン
   */
  detectFailurePatterns(steps) {
    const patterns = [];
    
    // タイムアウトパターン
    const timeoutSteps = steps.filter(step => 
      step.error && step.error.toLowerCase().includes('timeout')
    );
    if (timeoutSteps.length > 0) {
      patterns.push({
        type: 'timeout',
        frequency: timeoutSteps.length,
        description: 'タイムアウトエラーの頻発',
        riskLevel: timeoutSteps.length > 2 ? 'high' : 'medium'
      });
    }
    
    // 要素見つからないパターン
    const elementNotFoundSteps = steps.filter(step => 
      step.error && (
        step.error.includes('not found') || 
        step.error.includes('not visible') ||
        step.error.includes('not attached')
      )
    );
    if (elementNotFoundSteps.length > 0) {
      patterns.push({
        type: 'element_not_found',
        frequency: elementNotFoundSteps.length,
        description: 'UI要素の検出失敗',
        riskLevel: elementNotFoundSteps.length > 1 ? 'high' : 'medium'
      });
    }
    
    // 連続失敗パターン
    let consecutiveFailures = 0;
    let maxConsecutiveFailures = 0;
    steps.forEach(step => {
      if (step.status === 'failed') {
        consecutiveFailures++;
        maxConsecutiveFailures = Math.max(maxConsecutiveFailures, consecutiveFailures);
      } else {
        consecutiveFailures = 0;
      }
    });
    
    if (maxConsecutiveFailures >= 3) {
      patterns.push({
        type: 'consecutive_failures',
        frequency: maxConsecutiveFailures,
        description: '連続的な処理失敗',
        riskLevel: maxConsecutiveFailures >= 5 ? 'critical' : 'high'
      });
    }
    
    return patterns;
  }
  
  /**
   * リスク要因特定
   * @param {Object} testResult テスト結果
   * @param {Object} route ルート情報
   * @returns {Array} リスク要因配列
   */
  identifyRiskFactors(testResult, route) {
    const factors = [];
    const steps = testResult.steps || [];
    
    // 複雑性要因
    if (steps.length > 50) {
      factors.push({
        type: 'complexity',
        description: 'テストケースの複雑性が高い',
        impact: 'high',
        mitigation: 'テストを小さな単位に分割'
      });
    }
    
    // 実行時間要因
    const totalTime = steps.reduce((sum, step) => sum + (step.duration || step.executionTime || 0), 0);
    if (totalTime > 60000) { // 1分超
      factors.push({
        type: 'execution_time',
        description: '実行時間が長すぎる',
        impact: 'medium',
        mitigation: 'パフォーマンス最適化とタイムアウト調整'
      });
    }
    
    // 失敗率要因
    const failureRate = steps.length > 0 ? steps.filter(s => s.status === 'failed').length / steps.length : 0;
    if (failureRate > 0.3) { // 30%以上の失敗率
      factors.push({
        type: 'high_failure_rate',
        description: '失敗率が高い',
        impact: 'critical',
        mitigation: 'テスト設計の見直しとアプリケーション改善'
      });
    }
    
    return factors;
  }
  
  /**
   * 総合リスクスコア計算
   * @param {Array} analyses 各種分析結果
   * @returns {number} 総合リスクスコア (0-1)
   */
  calculateOverallRisk(analyses) {
    let totalRisk = 0;
    let weights = 0;
    
    // 不具合リスク (重み: 0.4)
    if (analyses[0] && analyses[0].overallRiskScore !== undefined) {
      totalRisk += analyses[0].overallRiskScore * 0.4;
      weights += 0.4;
    }
    
    // パフォーマンスリスク (重み: 0.2)
    if (analyses[1] && analyses[1].riskLevel) {
      const perfRisk = this.riskLevelToScore(analyses[1].riskLevel);
      totalRisk += perfRisk * 0.2;
      weights += 0.2;
    }
    
    // カバレッジリスク (重み: 0.2)
    if (analyses[2] && analyses[2].coveragePercentage !== undefined) {
      const coverageRisk = 1 - (analyses[2].coveragePercentage / 100);
      totalRisk += coverageRisk * 0.2;
      weights += 0.2;
    }
    
    // 予測リスク (重み: 0.2)
    if (analyses[3] && analyses[3].predictionConfidence !== undefined) {
      totalRisk += analyses[3].predictionConfidence * 0.2;
      weights += 0.2;
    }
    
    return weights > 0 ? totalRisk / weights : 0.3; // デフォルト値
  }
  
  /**
   * リスクレベルをスコアに変換
   * @param {string} riskLevel リスクレベル
   * @returns {number} スコア (0-1)
   */
  riskLevelToScore(riskLevel) {
    switch (riskLevel) {
      case 'critical': return 1.0;
      case 'high': return 0.8;
      case 'medium': return 0.5;
      case 'low': return 0.2;
      default: return 0.3;
    }
  }
  
  /**
   * 分析信頼度計算
   * @param {Array} analyses 分析結果配列
   * @returns {number} 信頼度 (0-1)
   */
  calculateAnalysisConfidence(analyses) {
    let confidence = 0.5; // ベース信頼度
    
    // AI分析が成功している場合
    if (analyses[0] && analyses[0].potentialBugs) {
      confidence += 0.3;
    }
    
    // 十分なデータがある場合
    if (analyses.every(analysis => analysis && Object.keys(analysis).length > 0)) {
      confidence += 0.2;
    }
    
    return Math.min(confidence, 1.0);
  }
  
  /**
   * パフォーマンスリスク計算
   * @param {Object} metrics パフォーマンスメトリクス
   * @returns {string} リスクレベル
   */
  calculatePerformanceRisk(metrics) {
    if (metrics.verySlowStepsCount > 0) return 'critical';
    if (metrics.slowStepsCount > 3) return 'high';
    if (metrics.averageStepTime > 2000) return 'medium';
    return 'low';
  }
  
  /**
   * 不具合分析結果の検証と正規化
   * @param {Object} analysis AI分析結果
   * @returns {Object} 正規化された分析結果
   */
  validateAndNormalizeBugAnalysis(analysis) {
    const normalized = {
      potentialBugs: [],
      overallRiskScore: 0.3,
      riskSummary: '',
      priorityActions: []
    };
    
    if (analysis.potentialBugs && Array.isArray(analysis.potentialBugs)) {
      normalized.potentialBugs = analysis.potentialBugs.map(bug => ({
        description: bug.description || '不具合詳細不明',
        severity: ['critical', 'high', 'medium', 'low'].includes(bug.severity) ? bug.severity : 'medium',
        likelihood: typeof bug.likelihood === 'number' ? Math.max(0, Math.min(1, bug.likelihood)) : 0.5,
        category: bug.category || 'general',
        affectedFunctions: Array.isArray(bug.affectedFunctions) ? bug.affectedFunctions : ['不明'],
        recommendedActions: Array.isArray(bug.recommendedActions) ? bug.recommendedActions : ['調査が必要'],
        estimatedImpact: bug.estimatedImpact || '影響度不明',
        detectionMethod: bug.detectionMethod || '手動確認'
      }));
    }
    
    if (typeof analysis.overallRiskScore === 'number') {
      normalized.overallRiskScore = Math.max(0, Math.min(1, analysis.overallRiskScore));
    }
    
    normalized.riskSummary = analysis.riskSummary || '総合的なリスク評価を実施';
    normalized.priorityActions = Array.isArray(analysis.priorityActions) ? analysis.priorityActions : [];
    
    return normalized;
  }
  
  /**
   * 入力データのハッシュ生成
   * @param {Object} testResult テスト結果
   * @returns {string} ハッシュ値
   */
  generateInputHash(testResult) {
    const content = JSON.stringify({
      stepCount: testResult.steps?.length || 0,
      url: testResult.url,
      timestamp: testResult.timestamp
    });
    
    // 簡易ハッシュ生成
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 32bit整数に変換
    }
    return hash.toString(36);
  }
  
  /**
   * フォールバック分析データ
   * @returns {Object} デフォルト分析結果
   */
  getFallbackAnalysis() {
    return {
      riskAssessment: this.getFallbackBugAnalysis(),
      performanceAnalysis: { slowSteps: [], riskLevel: 'low' },
      coverageAnalysis: { coveragePercentage: 70, untestedFunctions: [] },
      predictionAnalysis: { failurePatterns: [], riskFactors: [] },
      overallRiskScore: 0.3,
      generatedAt: new Date().toISOString(),
      analysisVersion: '2.0-fallback',
      confidence: 0.2
    };
  }
  
  /**
   * フォールバック不具合分析
   * @returns {Object} デフォルト不具合分析
   */
  getFallbackBugAnalysis() {
    return {
      potentialBugs: [],
      overallRiskScore: 0.3,
      riskSummary: 'AI分析が利用できないため、基本的なリスク評価を提供',
      priorityActions: ['手動での詳細確認を推奨']
    };
  }
  
  /**
   * 特定のギャップ分析
   * @param {Array} untestedFunctions 未テスト機能
   * @param {Array} testPoints テスト観点
   * @returns {Object} ギャップ分析結果
   */
  analyzeSpecificGaps(untestedFunctions, testPoints) {
    const gaps = {
      criticalGaps: [],
      improvementAreas: [],
      recommendations: []
    };
    
    untestedFunctions.forEach(func => {
      switch (func) {
        case 'fill':
          gaps.criticalGaps.push('入力機能のテストが不足');
          break;
        case 'click':
          gaps.criticalGaps.push('クリック操作のテストが不足');
          break;
        case 'select':
          gaps.improvementAreas.push('選択操作のテストを追加検討');
          break;
        default:
          gaps.improvementAreas.push(`${func}機能のテストを検討`);
      }
    });
    
    return gaps;
  }
  
  /**
   * カバレッジ改善推奨事項生成
   * @param {Array} untestedFunctions 未テスト機能
   * @returns {Array} 推奨事項配列
   */
  generateCoverageRecommendations(untestedFunctions) {
    const recommendations = [];
    
    if (untestedFunctions.includes('fill')) {
      recommendations.push('フォーム入力のテストケースを追加');
    }
    
    if (untestedFunctions.includes('click')) {
      recommendations.push('ボタンやリンクのクリックテストを追加');
    }
    
    if (untestedFunctions.includes('select')) {
      recommendations.push('ドロップダウン選択のテストを追加');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('現在のテストカバレッジは適切です');
    }
    
    return recommendations;
  }
  
  /**
   * パフォーマンス改善推奨事項生成
   * @param {Object} metrics パフォーマンスメトリクス
   * @param {Array} slowSteps 処理の遅いステップ
   * @returns {Array} 推奨事項配列
   */
  generatePerformanceRecommendations(metrics, slowSteps) {
    const recommendations = [];
    
    if (slowSteps.length > 0) {
      recommendations.push(`${slowSteps.length}個の処理時間の長いステップを最適化`);
    }
    
    if (metrics.averageStepTime > 2000) {
      recommendations.push('全体的な処理速度の改善を検討');
    }
    
    if (metrics.totalExecutionTime > 60000) {
      recommendations.push('テスト実行時間の短縮を検討');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('パフォーマンスは良好です');
    }
    
    return recommendations;
  }
  
  /**
   * 予測信頼度計算
   * @param {Array} failurePatterns 失敗パターン
   * @param {Array} riskFactors リスク要因
   * @returns {number} 予測信頼度 (0-1)
   */
  calculatePredictionConfidence(failurePatterns, riskFactors) {
    const patternWeight = failurePatterns.length * 0.1;
    const factorWeight = riskFactors.length * 0.1;
    
    return Math.min(patternWeight + factorWeight, 1.0);
  }
  
  /**
   * 予防的アクション提案
   * @param {Array} failurePatterns 失敗パターン
   * @param {Array} riskFactors リスク要因
   * @returns {Array} 予防的アクション配列
   */
  suggestPreventiveActions(failurePatterns, riskFactors) {
    const actions = [];
    
    failurePatterns.forEach(pattern => {
      switch (pattern.type) {
        case 'timeout':
          actions.push('タイムアウト設定の見直し');
          break;
        case 'element_not_found':
          actions.push('UI要素の安定性改善');
          break;
        case 'consecutive_failures':
          actions.push('エラーハンドリングの強化');
          break;
      }
    });
    
    riskFactors.forEach(factor => {
      if (factor.mitigation) {
        actions.push(factor.mitigation);
      }
    });
    
    return [...new Set(actions)]; // 重複除去
  }
} 