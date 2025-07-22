import fs from 'fs';
import path from 'path';
import { TestPointFunctionMapper } from './testPointFunctionMapper.js';

/**
 * 拡張テストレポート生成クラス
 * 要件: 成功ステップ明示、失敗ステップ明示、AI不具合分析
 */
export class EnhancedReportGenerator {
  constructor(testPointMapper = null, aiAnalyzer = null) {
    this.testPointMapper = testPointMapper;
    this.aiAnalyzer = aiAnalyzer;
    this.templatePath = path.join(process.cwd(), 'tests', 'templates');
  }
  
  /**
   * 改善されたHTMLレポートを生成
   * @param {Object} testResults テスト実行結果データ
   * @param {Object} options オプション設定
   * @returns {string} HTMLレポート文字列
   */
  async generateEnhancedHTMLReport(testResults, options = {}) {
    try {
      console.log('🔧 拡張HTMLレポート生成開始...');
      
      const reportData = await this.prepareReportData(testResults, options);
      
      const html = `
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AutoPlaywright 拡張テストレポート</title>
    <style>
        ${this.getEnhancedCSS()}
    </style>
</head>
<body>
    <div class="report-container">
        ${this.generateHeader(reportData.summary)}
        ${this.generateTestPointFunctionMatrix(reportData.mappingMatrix)}
        ${this.generateDetailedResults(reportData.testResults)}
        ${this.generateAIAnalysis(reportData.aiAnalysis)}
        ${this.generateRiskAssessment(reportData.riskAssessment)}
        ${this.generateFooter()}
    </div>
    
    <script>
        ${this.getInteractiveScripts()}
    </script>
</body>
</html>
      `;
      
      console.log('✅ 拡張HTMLレポート生成完了');
      return html;
      
    } catch (error) {
      console.error('❌ HTMLレポート生成エラー:', error);
      throw error;
    }
  }
  
  /**
   * レポートデータの準備
   * @param {Object} testResults テスト結果
   * @param {Object} options オプション
   * @returns {Object} 準備されたレポートデータ
   */
  async prepareReportData(testResults, options) {
    console.log('📊 レポートデータ準備中...');
    
    const summary = this.generateSummary(testResults);
    const mappingMatrix = this.testPointMapper ? this.testPointMapper.getMappingMatrix() : new Map();
    const enhancedTestResults = await this.enhanceTestResults(testResults);
    
    let aiAnalysis = null;
    let riskAssessment = null;
    
    // AI分析実行
    if (this.aiAnalyzer && options.enableAIAnalysis !== false) {
      try {
        aiAnalysis = await this.aiAnalyzer.analyzeTestResults(testResults);
        riskAssessment = aiAnalysis.riskAssessment;
        console.log('🤖 AI分析完了');
      } catch (error) {
        console.warn('⚠️ AI分析エラー:', error.message);
        aiAnalysis = this.getFallbackAIAnalysis();
        riskAssessment = aiAnalysis.riskAssessment;
      }
    }
    
    return {
      summary,
      mappingMatrix,
      testResults: enhancedTestResults,
      aiAnalysis: aiAnalysis || this.getFallbackAIAnalysis(),
      riskAssessment: riskAssessment || this.getFallbackRiskAssessment()
    };
  }
  
  /**
   * サマリー情報生成
   * @param {Object} testResults テスト結果
   * @returns {Object} サマリー情報
   */
  generateSummary(testResults) {
    const steps = testResults.steps || [];
    const totalSteps = steps.length;
    const successfulSteps = steps.filter(step => step.status === 'success').length;
    const failedSteps = steps.filter(step => step.status === 'failed').length;
    const skippedSteps = steps.filter(step => step.status === 'skipped').length;
    
    return {
      executionTime: testResults.timestamp || new Date().toISOString(),
      testName: testResults.testName || 'テスト実行',
      url: testResults.url || testResults.targetUrl || '',
      totalSteps,
      successfulSteps,
      failedSteps,
      skippedSteps,
      successRate: totalSteps > 0 ? ((successfulSteps / totalSteps) * 100).toFixed(1) : '0.0',
      duration: testResults.duration || 0
    };
  }
  
  /**
   * テスト結果の拡張
   * @param {Object} testResults 元のテスト結果
   * @returns {Array} 拡張されたテスト結果配列
   */
  async enhanceTestResults(testResults) {
    const steps = testResults.steps || [];
    
    return steps.map((step, index) => {
      const assertions = this.extractAssertionsFromStep(step);
      const enhancedAssertions = assertions.map(assertion => ({
        ...assertion,
        status: this.determineAssertionStatus(assertion),
        timestamp: new Date().toISOString(),
        evidenceLinks: this.collectEvidence(step, assertion)
      }));
      
      return {
        ...step,
        stepId: step.id || `step_${index + 1}`,
        stepName: step.label || step.action || `ステップ ${index + 1}`,
        assertions: enhancedAssertions,
        statusSummary: {
          totalAssertions: enhancedAssertions.length,
          successfulAssertions: enhancedAssertions.filter(a => a.status === 'success').length,
          failedAssertions: enhancedAssertions.filter(a => a.status === 'failed').length
        },
        executionTime: step.duration || step.executionTime || 0,
        // スクリーンショットパス情報の正確な設定
        screenshot: this.resolveScreenshotPath(step.screenshot, step.id || `step_${index + 1}`),
        domSnapshot: step.domSnapshot || null
      };
    });
  }
  
  /**
   * ステップからアサーションを抽出
   * @param {Object} step テストステップ
   * @returns {Array} アサーション配列
   */
  extractAssertionsFromStep(step) {
    const assertions = [];
    
    // 明示的なアサーション結果
    if (step.assertions && Array.isArray(step.assertions)) {
      assertions.push(...step.assertions);
    }
    
    // アクションベースのアサーション推定
    if (step.action && step.action.startsWith('assert')) {
      assertions.push({
        assertionId: `${step.action}_${Date.now()}`,
        description: `${step.action}アサーション`,
        expected: step.expectedValue || step.value || null,
        actual: step.actualValue || step.result || null,
        status: step.status === 'success' ? 'success' : 'failed',
        errorMessage: step.error || null
      });
    }
    
    // 成功/失敗ステータスベースのアサーション
    if (step.status) {
      assertions.push({
        assertionId: `status_check_${Date.now()}`,
        description: 'ステップ実行結果',
        expected: 'success',
        actual: step.status,
        status: step.status === 'success' ? 'success' : 'failed',
        errorMessage: step.error || null
      });
    }
    
    return assertions;
  }
  
  /**
   * アサーションステータスの判定
   * @param {Object} assertion アサーション
   * @returns {string} ステータス
   */
  determineAssertionStatus(assertion) {
    if (assertion.status) {
      return assertion.status;
    }
    
    if (assertion.expected === assertion.actual) {
      return 'success';
    }
    
    return 'failed';
  }
  
  /**
   * エビデンス収集
   * @param {Object} step テストステップ
   * @param {Object} assertion アサーション
   * @returns {Array} エビデンスリンク配列
   */
  collectEvidence(step, assertion) {
    const evidence = [];
    
    if (step.screenshot) {
      // screenshotがオブジェクトの場合は適切なパスを使用
      let screenshotPath;
      let absolutePath = null;
      let metadata = null;
      
      if (typeof step.screenshot === 'object') {
        // 新形式のスクリーンショット情報
        screenshotPath = step.screenshot.webPath || step.screenshot.relativePath || step.screenshot.path;
        absolutePath = step.screenshot.absolutePath;
        metadata = step.screenshot;
      } else {
        // 従来形式（文字列）
        screenshotPath = step.screenshot;
      }
      
      evidence.push({
        type: 'screenshot',
        path: screenshotPath,
        absolutePath: absolutePath,
        description: 'ステップ実行時のスクリーンショット',
        metadata: metadata,
        resolved: metadata ? metadata.resolved : null
      });
    }
    
    if (step.domSnapshot) {
      evidence.push({
        type: 'dom',
        path: step.domSnapshot,
        description: 'DOM構造スナップショット'
      });
    }
    
    if (step.networkLogs) {
      evidence.push({
        type: 'network',
        data: step.networkLogs,
        description: 'ネットワークアクティビティ'
      });
    }
    
    return evidence;
  }

  /**
   * スクリーンショットパス解決
   * @param {string|Object} screenshotInfo スクリーンショット情報
   * @param {string} stepId ステップID
   * @returns {string|null} 解決されたパス
   */
  resolveScreenshotPath(screenshotInfo, stepId) {
    if (!screenshotInfo) return null;
    
    // 新形式（オブジェクト）の場合
    if (typeof screenshotInfo === 'object') {
      if (screenshotInfo.webPath) {
        return screenshotInfo.webPath;
      }
      if (screenshotInfo.relativePath) {
        return screenshotInfo.relativePath.replace(/\\/g, '/');
      }
      if (screenshotInfo.path) {
        return screenshotInfo.path.replace(/\\/g, '/');
      }
      // オブジェクトだが適切なパスが見つからない場合
      return screenshotInfo;
    }
    
    // 従来形式（文字列）の場合
    if (typeof screenshotInfo === 'string') {
      return screenshotInfo.replace(/\\/g, '/');
    }
    
    return null;
  }
  
  /**
   * ヘッダー部分生成
   * @param {Object} summary サマリー情報
   * @returns {string} HTMLヘッダー
   */
  generateHeader(summary) {
    return `
<header class="report-header">
    <div class="header-container">
        <h1>🤖 AutoPlaywright 拡張テストレポート</h1>
        <div class="header-meta">
            <div class="meta-item">
                <span class="meta-label">実行日時:</span>
                <span class="meta-value">${new Date(summary.executionTime).toLocaleString('ja-JP')}</span>
            </div>
            <div class="meta-item">
                <span class="meta-label">テスト名:</span>
                <span class="meta-value">${summary.testName}</span>
            </div>
            <div class="meta-item">
                <span class="meta-label">対象URL:</span>
                <span class="meta-value">${summary.url}</span>
            </div>
        </div>
        
        <div class="summary-stats">
            <div class="stat-card success">
                <div class="stat-value">${summary.successfulSteps}</div>
                <div class="stat-label">成功</div>
            </div>
            <div class="stat-card failed">
                <div class="stat-value">${summary.failedSteps}</div>
                <div class="stat-label">失敗</div>
            </div>
            <div class="stat-card skipped">
                <div class="stat-value">${summary.skippedSteps}</div>
                <div class="stat-label">スキップ</div>
            </div>
            <div class="stat-card rate">
                <div class="stat-value">${summary.successRate}%</div>
                <div class="stat-label">成功率</div>
            </div>
        </div>
    </div>
</header>
    `;
  }
  
  /**
   * テスト観点-機能マトリックス表示
   * @param {Map} mappingMatrix マッピングマトリックス
   * @returns {string} HTMLマトリックス
   */
  generateTestPointFunctionMatrix(mappingMatrix) {
    if (!mappingMatrix || mappingMatrix.size === 0) {
      return `
<section class="mapping-matrix">
    <h2>🎯 テスト観点-機能マッピング</h2>
    <div class="no-mapping-message">
        <p>テスト観点マッピングデータが利用できません</p>
    </div>
</section>
      `;
    }
    
    return `
<section class="mapping-matrix">
    <h2>🎯 テスト観点-機能マッピング</h2>
    <div class="matrix-container">
        <table class="mapping-table">
            <thead>
                <tr>
                    <th>テスト観点</th>
                    <th>カテゴリ</th>
                    <th>関連機能</th>
                    <th>実行状況</th>
                    <th>信頼度</th>
                </tr>
            </thead>
            <tbody>
                ${Array.from(mappingMatrix.entries()).map(([id, mapping]) => `
                <tr class="mapping-row" data-test-point-id="${id}">
                    <td class="test-perspective">
                        <div class="perspective-text">${mapping.testPerspective}</div>
                        <div class="perspective-id">ID: ${id}</div>
                    </td>
                    <td class="category">
                        <div class="category-path">
                            ${mapping.category} &gt; ${mapping.subCategory} &gt; ${mapping.detailCategory}
                        </div>
                    </td>
                    <td class="related-functions">
                        ${mapping.relatedFunctions.map(func => `
                            <span class="function-tag">${func}</span>
                        `).join('')}
                    </td>
                    <td class="execution-status">
                        <span class="status-badge pending">未実行</span>
                    </td>
                    <td class="confidence">
                        <div class="confidence-bar">
                            <div class="confidence-fill" style="width: ${(mapping.mappingConfidence * 100)}%"></div>
                        </div>
                        <span class="confidence-text">${(mapping.mappingConfidence * 100).toFixed(1)}%</span>
                    </td>
                </tr>
                `).join('')}
            </tbody>
        </table>
    </div>
</section>
    `;
  }
  
  /**
   * ステップ別詳細結果表示（成功/失敗明示）
   * @param {Array} testResults テスト結果配列
   * @returns {string} HTML詳細結果
   */
  generateDetailedResults(testResults) {
    return `
<section class="detailed-results">
    <h2>📊 詳細実行結果</h2>
    <div class="results-container">
        ${testResults.map((step, index) => `
        <div class="step-card ${step.status}" data-step-id="${step.stepId}">
            <div class="step-header" onclick="toggleStepDetails('${step.stepId}')">
                <span class="step-status-icon">${this.getStatusIcon(step.status)}</span>
                <span class="step-name">${step.stepName}</span>
                <span class="step-meta">
                    <span class="execution-time">${step.executionTime}ms</span>
                    <span class="assertion-count">${step.assertions.length}件検証</span>
                </span>
                <span class="expand-icon">▼</span>
            </div>
            
            <div class="step-details" id="details-${step.stepId}" style="display: none;">
                <div class="action-info">
                    <div class="info-grid">
                        <div class="info-item">
                            <strong>アクション:</strong> <code>${step.action || 'N/A'}</code>
                        </div>
                        <div class="info-item">
                            <strong>対象:</strong> <code>${step.target || 'N/A'}</code>
                        </div>
                        ${step.value ? `
                        <div class="info-item">
                            <strong>値:</strong> <code>${step.value}</code>
                        </div>
                        ` : ''}
                    </div>
                </div>
                
                ${step.assertions.length > 0 ? `
                <div class="assertions">
                    <h4>🔍 アサーション結果</h4>
                    ${step.assertions.map(assertion => `
                    <div class="assertion ${assertion.status}">
                        <div class="assertion-header">
                            <span class="assertion-icon">${this.getStatusIcon(assertion.status)}</span>
                            <span class="assertion-description">${assertion.description}</span>
                        </div>
                        <div class="assertion-details">
                            <div class="assertion-values">
                                <div class="expected">
                                    <strong>期待値:</strong> <code>${JSON.stringify(assertion.expected)}</code>
                                </div>
                                <div class="actual">
                                    <strong>実際値:</strong> <code>${JSON.stringify(assertion.actual)}</code>
                                </div>
                            </div>
                            ${assertion.status === 'failed' && assertion.errorMessage ? `
                            <div class="error-message">
                                <strong>エラー:</strong> ${assertion.errorMessage}
                            </div>
                            ` : ''}
                        </div>
                    </div>
                    `).join('')}
                </div>
                ` : ''}
                
                <div class="evidence-section">
                    ${step.screenshot ? `
                    <div class="evidence-item">
                        <h5>📸 スクリーンショット</h5>
                        <img src="${step.screenshot}" alt="ステップスクリーンショット" class="step-screenshot" onclick="openImageModal('${step.screenshot}')">
                    </div>
                    ` : ''}
                    
                    ${step.domSnapshot ? `
                    <div class="evidence-item">
                        <h5>🌐 DOM スナップショット</h5>
                        <a href="${step.domSnapshot}" target="_blank" class="dom-link">DOM構造を表示</a>
                    </div>
                    ` : ''}
                </div>
            </div>
        </div>
        `).join('')}
    </div>
</section>
    `;
  }
  
  /**
   * AI分析結果表示
   * @param {Object} aiAnalysis AI分析結果
   * @returns {string} HTML AI分析
   */
  generateAIAnalysis(aiAnalysis) {
    if (!aiAnalysis) {
      return '<section class="ai-analysis"><h2>🤖 AI分析</h2><p>AI分析が利用できません</p></section>';
    }
    
    return `
<section class="ai-analysis">
    <h2>🤖 AI分析結果</h2>
    
    <div class="analysis-container">
        <div class="risk-section">
            <h3>🚨 リスク評価</h3>
            <div class="overall-risk">
                <div class="risk-score ${this.getRiskLevel(aiAnalysis.overallRiskScore || 0)}">
                    全体リスクスコア: <span class="score-value">${((aiAnalysis.overallRiskScore || 0) * 100).toFixed(1)}%</span>
                </div>
            </div>
            
            ${aiAnalysis.potentialBugs && aiAnalysis.potentialBugs.length > 0 ? `
            <div class="potential-bugs">
                <h4>潜在的不具合</h4>
                ${aiAnalysis.potentialBugs.map(bug => `
                <div class="bug-item ${bug.severity}">
                    <div class="bug-header">
                        <span class="severity-badge ${bug.severity}">${bug.severity}</span>
                        <span class="likelihood">発生確率: ${(bug.likelihood * 100).toFixed(1)}%</span>
                    </div>
                    <div class="bug-description">${bug.description}</div>
                    <div class="affected-functions">
                        <strong>影響機能:</strong> ${bug.affectedFunctions.join(', ')}
                    </div>
                    <div class="recommendations">
                        <strong>推奨対応:</strong>
                        <ul>
                            ${bug.recommendedActions.map(action => `<li>${action}</li>`).join('')}
                        </ul>
                    </div>
                </div>
                `).join('')}
            </div>
            ` : ''}
        </div>
        
        ${aiAnalysis.performanceAnalysis ? `
        <div class="performance-section">
            <h3>⚡ パフォーマンス分析</h3>
            <div class="performance-metrics">
                ${aiAnalysis.performanceAnalysis.slowSteps && aiAnalysis.performanceAnalysis.slowSteps.length > 0 ? `
                <h4>処理時間の長いステップ</h4>
                ${aiAnalysis.performanceAnalysis.slowSteps.map(step => `
                <div class="slow-step">
                    <span class="step-name">${step.stepId}</span>
                    <span class="execution-time">${step.executionTime}ms</span>
                    <div class="optimizations">
                        ${step.suggestedOptimizations.map(opt => `<span class="optimization-tag">${opt}</span>`).join('')}
                    </div>
                </div>
                `).join('')}
                ` : '<p>パフォーマンス問題は検出されませんでした</p>'}
            </div>
        </div>
        ` : ''}
    </div>
</section>
    `;
  }
  
  /**
   * リスク評価表示
   * @param {Object} riskAssessment リスク評価
   * @returns {string} HTMLリスク評価
   */
  generateRiskAssessment(riskAssessment) {
    return `
<section class="risk-assessment">
    <h2>📈 総合リスク評価</h2>
    <div class="risk-summary">
        <p>このテスト実行に基づく総合的なリスク評価と推奨アクションです。</p>
        <!-- リスク評価の詳細内容 -->
    </div>
</section>
    `;
  }
  
  /**
   * フッター生成
   * @returns {string} HTMLフッター
   */
  generateFooter() {
    return `
<footer class="report-footer">
    <div class="footer-content">
        <p>Generated by AutoPlaywright Enhanced Reporter at ${new Date().toLocaleString('ja-JP')}</p>
        <p>このレポートは自動生成されました。詳細な分析結果については各セクションをご確認ください。</p>
    </div>
</footer>
    `;
  }
  
  /**
   * 拡張CSS取得
   * @returns {string} CSSスタイル
   */
  getEnhancedCSS() {
    return `
/* Enhanced Report Styles */
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    line-height: 1.6;
    color: #333;
    background-color: #f5f5f5;
}

.report-container {
    max-width: 1200px;
    margin: 0 auto;
    background: white;
    box-shadow: 0 0 20px rgba(0,0,0,0.1);
}

/* Header Styles */
.report-header {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 30px;
}

.header-container h1 {
    font-size: 2.5em;
    margin-bottom: 20px;
    text-align: center;
}

.header-meta {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 15px;
    margin-bottom: 30px;
}

.meta-item {
    background: rgba(255, 255, 255, 0.1);
    padding: 10px 15px;
    border-radius: 8px;
}

.meta-label {
    font-weight: 600;
    margin-right: 8px;
}

.summary-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 20px;
}

.stat-card {
    background: rgba(255, 255, 255, 0.15);
    padding: 20px;
    border-radius: 12px;
    text-align: center;
    backdrop-filter: blur(10px);
}

.stat-value {
    font-size: 2.5em;
    font-weight: bold;
    margin-bottom: 8px;
}

.stat-label {
    font-size: 0.9em;
    opacity: 0.9;
}

.stat-card.success .stat-value { color: #4CAF50; }
.stat-card.failed .stat-value { color: #f44336; }
.stat-card.skipped .stat-value { color: #ff9800; }
.stat-card.rate .stat-value { color: #2196F3; }

/* Mapping Matrix Styles */
.mapping-matrix {
    margin: 30px;
    background: #f8f9fa;
    border-radius: 12px;
    padding: 25px;
}

.mapping-matrix h2 {
    color: #2c3e50;
    margin-bottom: 20px;
    font-size: 1.8em;
}

.mapping-table {
    width: 100%;
    border-collapse: collapse;
    background: white;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
}

.mapping-table th {
    background: #2c3e50;
    color: white;
    padding: 15px;
    text-align: left;
    font-weight: 600;
}

.mapping-table td {
    padding: 12px 15px;
    border-bottom: 1px solid #eee;
}

.mapping-table tr:hover {
    background-color: #f8f9fa;
}

.function-tag {
    display: inline-block;
    background: #e3f2fd;
    color: #1976d2;
    padding: 4px 8px;
    margin: 2px;
    border-radius: 12px;
    font-size: 0.8em;
    font-weight: 500;
}

.confidence-bar {
    width: 80px;
    height: 8px;
    background: #e0e0e0;
    border-radius: 4px;
    overflow: hidden;
    display: inline-block;
    vertical-align: middle;
    margin-right: 8px;
}

.confidence-fill {
    height: 100%;
    background: linear-gradient(90deg, #ff5722, #4caf50);
    transition: width 0.3s ease;
}

/* Detailed Results Styles */
.detailed-results {
    margin: 30px;
}

.detailed-results h2 {
    color: #2c3e50;
    margin-bottom: 20px;
    font-size: 1.8em;
}

.step-card {
    border: 1px solid #ddd;
    border-radius: 8px;
    margin: 15px 0;
    overflow: hidden;
    transition: box-shadow 0.3s ease;
}

.step-card:hover {
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}

.step-card.success {
    border-left: 4px solid #4CAF50;
}

.step-card.failed {
    border-left: 4px solid #f44336;
}

.step-card.skipped {
    border-left: 4px solid #ff9800;
}

.step-header {
    padding: 15px 20px;
    background: #fafafa;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.step-header:hover {
    background: #f0f0f0;
}

.step-status-icon {
    font-size: 1.2em;
    margin-right: 10px;
}

.step-name {
    flex-grow: 1;
    font-weight: 600;
}

.step-meta {
    display: flex;
    gap: 15px;
    font-size: 0.9em;
    color: #666;
}

.expand-icon {
    transition: transform 0.3s ease;
}

.step-header.expanded .expand-icon {
    transform: rotate(180deg);
}

.step-details {
    padding: 20px;
    background: white;
}

.action-info {
    background: #f8f9fa;
    padding: 15px;
    border-radius: 6px;
    margin-bottom: 20px;
}

.info-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 10px;
}

.info-item code {
    background: #e9ecef;
    padding: 2px 6px;
    border-radius: 3px;
    font-family: 'Courier New', monospace;
}

/* Assertion Styles */
.assertions h4 {
    color: #2c3e50;
    margin-bottom: 15px;
}

.assertion {
    padding: 12px 15px;
    margin: 10px 0;
    border-radius: 6px;
    border-left: 3px solid;
}

.assertion.success {
    background: #e8f5e8;
    border-left-color: #4CAF50;
}

.assertion.failed {
    background: #ffebee;
    border-left-color: #f44336;
}

.assertion-header {
    display: flex;
    align-items: center;
    margin-bottom: 10px;
}

.assertion-icon {
    margin-right: 8px;
}

.assertion-description {
    font-weight: 600;
}

.assertion-values {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 15px;
    margin-bottom: 10px;
}

.assertion-values code {
    background: rgba(0,0,0,0.05);
    padding: 4px 8px;
    border-radius: 4px;
    font-family: 'Courier New', monospace;
}

.error-message {
    background: #ffcdd2;
    padding: 10px;
    border-radius: 4px;
    color: #c62828;
    font-family: 'Courier New', monospace;
    font-size: 0.9em;
}

/* Evidence Styles */
.evidence-section {
    margin-top: 20px;
}

.evidence-item {
    margin: 15px 0;
}

.evidence-item h5 {
    color: #2c3e50;
    margin-bottom: 8px;
}

.step-screenshot {
    max-width: 300px;
    max-height: 200px;
    border: 2px solid #ddd;
    border-radius: 6px;
    cursor: pointer;
    transition: transform 0.3s ease;
}

.step-screenshot:hover {
    transform: scale(1.02);
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
}

.dom-link {
    color: #1976d2;
    text-decoration: none;
    padding: 8px 16px;
    background: #e3f2fd;
    border-radius: 20px;
    display: inline-block;
    transition: background 0.3s ease;
}

.dom-link:hover {
    background: #bbdefb;
}

/* AI Analysis Styles */
.ai-analysis {
    margin: 30px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border-radius: 12px;
    padding: 25px;
}

.ai-analysis h2, .ai-analysis h3, .ai-analysis h4 {
    color: white;
    margin-bottom: 15px;
}

.risk-score {
    background: rgba(255, 255, 255, 0.1);
    padding: 20px;
    border-radius: 8px;
    text-align: center;
    margin-bottom: 20px;
    font-size: 1.2em;
}

.score-value {
    font-size: 1.5em;
    font-weight: bold;
}

.risk-score.low { border-left: 4px solid #4CAF50; }
.risk-score.medium { border-left: 4px solid #ff9800; }
.risk-score.high { border-left: 4px solid #f44336; }

.bug-item {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 15px;
    margin: 10px 0;
}

.bug-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
}

.severity-badge {
    padding: 4px 12px;
    border-radius: 12px;
    font-size: 0.8em;
    font-weight: bold;
    text-transform: uppercase;
}

.severity-badge.critical { background: #f44336; }
.severity-badge.high { background: #ff5722; }
.severity-badge.medium { background: #ff9800; color: #000; }
.severity-badge.low { background: #4CAF50; }

.likelihood {
    font-size: 0.9em;
    opacity: 0.9;
}

.bug-description {
    margin: 10px 0;
    line-height: 1.6;
}

.affected-functions, .recommendations {
    margin: 10px 0;
}

.recommendations ul {
    margin: 8px 0 0 20px;
}

.recommendations li {
    margin: 5px 0;
}

/* Performance Analysis */
.slow-step {
    background: rgba(255, 255, 255, 0.1);
    padding: 12px 15px;
    margin: 8px 0;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.optimization-tag {
    background: rgba(255, 255, 255, 0.2);
    padding: 2px 8px;
    margin: 0 2px;
    border-radius: 10px;
    font-size: 0.8em;
}

/* Footer Styles */
.report-footer {
    background: #2c3e50;
    color: white;
    padding: 20px 30px;
    text-align: center;
}

.report-footer p {
    margin: 5px 0;
    opacity: 0.8;
}

/* Responsive Design */
@media (max-width: 768px) {
    .header-meta {
        grid-template-columns: 1fr;
    }
    
    .summary-stats {
        grid-template-columns: repeat(2, 1fr);
    }
    
    .assertion-values {
        grid-template-columns: 1fr;
    }
    
    .step-meta {
        flex-direction: column;
        gap: 5px;
    }
    
    .bug-header {
        flex-direction: column;
        align-items: flex-start;
        gap: 10px;
    }
}

/* Utility Classes */
.no-mapping-message {
    text-align: center;
    padding: 40px;
    color: #666;
    font-style: italic;
}

.status-badge {
    padding: 4px 12px;
    border-radius: 12px;
    font-size: 0.8em;
    font-weight: bold;
}

.status-badge.pending {
    background: #e0e0e0;
    color: #666;
}

.status-badge.success {
    background: #c8e6c9;
    color: #2e7d32;
}

.status-badge.failed {
    background: #ffcdd2;
    color: #c62828;
}
    `;
  }
  
  /**
   * インタラクティブJavaScript取得
   * @returns {string} JavaScriptコード
   */
  getInteractiveScripts() {
    return `
// Interactive Report Functions
function toggleStepDetails(stepId) {
    const details = document.getElementById('details-' + stepId);
    const header = details.previousElementSibling;
    
    if (details.style.display === 'none') {
        details.style.display = 'block';
        header.classList.add('expanded');
    } else {
        details.style.display = 'none';
        header.classList.remove('expanded');
    }
}

function openImageModal(imageSrc) {
    const modal = document.createElement('div');
    modal.className = 'image-modal';
    modal.innerHTML = \`
        <div class="modal-backdrop" onclick="closeImageModal()">
            <div class="modal-content" onclick="event.stopPropagation()">
                <img src="\${imageSrc}" alt="拡大画像" class="modal-image">
                <button class="modal-close" onclick="closeImageModal()">✕</button>
            </div>
        </div>
    \`;
    
    modal.style.cssText = \`
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
    \`;
    
    const backdrop = modal.querySelector('.modal-backdrop');
    backdrop.style.cssText = \`
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.8);
        display: flex;
        align-items: center;
        justify-content: center;
    \`;
    
    const content = modal.querySelector('.modal-content');
    content.style.cssText = \`
        position: relative;
        max-width: 90%;
        max-height: 90%;
    \`;
    
    const image = modal.querySelector('.modal-image');
    image.style.cssText = \`
        max-width: 100%;
        max-height: 100%;
        border-radius: 8px;
    \`;
    
    const closeBtn = modal.querySelector('.modal-close');
    closeBtn.style.cssText = \`
        position: absolute;
        top: -40px;
        right: 0;
        background: white;
        border: none;
        border-radius: 50%;
        width: 30px;
        height: 30px;
        font-size: 16px;
        cursor: pointer;
        color: #333;
    \`;
    
    document.body.appendChild(modal);
    window.currentModal = modal;
}

function closeImageModal() {
    if (window.currentModal) {
        document.body.removeChild(window.currentModal);
        window.currentModal = null;
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    console.log('📊 Enhanced Report initialized');
    
    // Add smooth scrolling to section links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });
    
    // Add keyboard navigation
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && window.currentModal) {
            closeImageModal();
        }
    });
});
    `;
  }
  
  /**
   * ステータスアイコン取得
   * @param {string} status ステータス
   * @returns {string} アイコン
   */
  getStatusIcon(status) {
    switch (status) {
      case 'success': return '✅';
      case 'failed': return '❌';
      case 'skipped': return '⏭️';
      default: return '❓';
    }
  }
  
  /**
   * リスクレベル取得
   * @param {number} riskScore リスクスコア (0-1)
   * @returns {string} リスクレベル
   */
  getRiskLevel(riskScore) {
    if (riskScore >= 0.7) return 'high';
    if (riskScore >= 0.4) return 'medium';
    return 'low';
  }
  
  /**
   * フォールバックAI分析データ
   * @returns {Object} フォールバック分析データ
   */
  getFallbackAIAnalysis() {
    return {
      overallRiskScore: 0.3,
      potentialBugs: [],
      performanceAnalysis: {
        slowSteps: []
      },
      generatedAt: new Date().toISOString()
    };
  }
  
  /**
   * フォールバックリスク評価データ
   * @returns {Object} フォールバックリスク評価
   */
  getFallbackRiskAssessment() {
    return {
      overallRisk: 'low',
      summary: 'AI分析が利用できないため、基本的なリスク評価を提供しています。'
    };
  }
} 