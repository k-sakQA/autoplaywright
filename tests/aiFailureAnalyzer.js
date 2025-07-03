/**
 * AI-Powered Test Failure Analyzer
 * ChatGPT/OpenAI APIを使用した高度な失敗テスト分析・修正システム
 */

import fs from 'fs';
import path from 'path';

class AIFailureAnalyzer {
  constructor(config = {}) {
    this.config = {
      apiKey: process.env.OPENAI_API_KEY || config.apiKey,
      model: config.model || 'gpt-4-turbo-preview',
      maxTokens: config.maxTokens || 2000,
      temperature: config.temperature || 0.3,
      apiEndpoint: 'https://api.openai.com/v1/chat/completions',
      ...config
    };
    
    this.retryCount = 0;
    this.maxRetries = 3;
  }

  /**
   * 失敗テストの AI 分析・修正提案
   */
  async analyzeFailureWithAI(testResult, domInfo = null, previousAttempts = []) {
    console.log('\n🤖 AI による失敗テスト分析を開始...');
    
    if (!this.config.apiKey) {
      console.log('⚠️ OpenAI API キーが設定されていません。環境変数 OPENAI_API_KEY を設定してください。');
      return this.getFallbackSuggestion(testResult);
    }

    try {
      const failedSteps = testResult.steps.filter(step => step.status === 'failed');
      const analysisResults = [];

      for (const step of failedSteps) {
        console.log(`🔍 ステップ分析中: ${step.label}`);
        
        const analysis = await this.analyzeStepWithAI(step, testResult, domInfo, previousAttempts);
        analysisResults.push(analysis);
        
        // API レート制限対応
        await this.delay(1000);
      }

      return {
        success: true,
        analysisResults,
        aiPowered: true,
        model: this.config.model,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('❌ AI 分析エラー:', error.message);
      return this.getFallbackSuggestion(testResult);
    }
  }

  /**
   * 個別ステップの AI 分析
   */
  async analyzeStepWithAI(failedStep, testResult, domInfo, previousAttempts) {
    const prompt = this.buildAnalysisPrompt(failedStep, testResult, domInfo, previousAttempts);
    
    try {
      const response = await this.callOpenAI(prompt);
      const aiSuggestion = this.parseAIResponse(response);
      
      return {
        step: failedStep,
        aiAnalysis: aiSuggestion,
        confidence: aiSuggestion.confidence || 0.8,
        implementable: aiSuggestion.implementable || true,
        fixedStep: aiSuggestion.fixedStep || null,
        explanation: aiSuggestion.explanation || 'AI による修正提案',
        alternatives: aiSuggestion.alternatives || []
      };

    } catch (error) {
      console.error(`❌ ステップ分析エラー (${failedStep.label}):`, error.message);
      return this.getFallbackStepAnalysis(failedStep);
    }
  }

  /**
   * AI 分析用プロンプト構築
   */
  buildAnalysisPrompt(failedStep, testResult, domInfo, previousAttempts) {
    const contextInfo = this.buildContextInfo(testResult, domInfo);
    const attemptHistory = this.buildAttemptHistory(previousAttempts);
    
    return `あなたはPlaywrightのテスト自動化エキスパートです。以下のエラーログを解析し、失敗箇所を修正した新しいコードを提案してください。

## 失敗ステップ情報
- **ラベル**: ${failedStep.label}
- **アクション**: ${failedStep.action}
- **ターゲット**: ${failedStep.target}
- **値**: ${failedStep.value || 'なし'}
- **エラーメッセージ**: ${failedStep.error}

## 実行コンテキスト
${contextInfo}

## DOM情報
${domInfo ? this.formatDOMInfo(domInfo) : 'DOM情報は利用できません'}

## 過去の修正試行履歴
${attemptHistory}

## 要求事項
1. **エラー原因の特定**: 技術的な根本原因を分析
2. **修正されたステップ**: 実行可能なPlaywrightコードとして提案
3. **代替案**: 複数のアプローチを提示
4. **信頼度**: 修正成功の見込み（0.0-1.0）
5. **実装の難易度**: easy/medium/hard

## 出力形式（JSON）
\`\`\`json
{
  "rootCause": "エラーの根本原因（日本語）",
  "fixedStep": {
    "label": "修正されたステップのラベル",
    "action": "修正されたアクション",
    "target": "修正されたターゲットセレクタ",
    "value": "修正された値（必要に応じて）",
    "timeout": 修正されたタイムアウト値,
    "waitCondition": "事前待機条件（必要に応じて）"
  },
  "alternatives": [
    {
      "approach": "代替アプローチの説明",
      "step": { /* 代替ステップ */ },
      "pros": "利点",
      "cons": "欠点"
    }
  ],
  "confidence": 0.85,
  "difficulty": "medium",
  "explanation": "修正の根拠と期待される効果",
  "implementable": true,
  "additionalSteps": [
    /* 必要に応じて追加する前処理ステップ */
  ]
}
\`\`\`

JSON形式で回答してください。`;
  }

  /**
   * OpenAI API 呼び出し
   */
  async callOpenAI(prompt) {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`
    };

    const body = {
      model: this.config.model,
      messages: [
        {
          role: 'system',
          content: 'あなたはPlaywrightテスト自動化の専門家です。技術的で実践的な修正提案を行い、常にJSON形式で正確に回答してください。'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      // メモリー機能無効化のため、各呼び出しを独立させる
      user: `failure_analysis_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, // 一意のセッションID
      seed: Math.floor(Math.random() * 10000), // ランダムシード
      n: 1, // 単一回答のみ
      stream: false // ストリーミング無効
    };

    const response = await fetch(this.config.apiEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`OpenAI API エラー: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  /**
   * AI レスポンス解析
   */
  parseAIResponse(response) {
    try {
      // JSON 部分を抽出
      const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
      }
      
      // JSON ブロックがない場合は直接パース試行
      return JSON.parse(response);
      
    } catch (error) {
      console.warn('⚠️ AI レスポンス解析失敗:', error.message);
      
      // パースに失敗した場合はテキスト分析で抽出試行
      return this.extractSuggestionsFromText(response);
    }
  }

  /**
   * コンテキスト情報構築
   */
  buildContextInfo(testResult, domInfo) {
    return `
- **実行URL**: ${testResult.targetUrl || 'Unknown'}
- **総ステップ数**: ${testResult.steps.length}
- **成功ステップ数**: ${testResult.steps.filter(s => s.status === 'success').length}
- **失敗ステップ数**: ${testResult.steps.filter(s => s.status === 'failed').length}
- **実行時間**: ${testResult.execution_time || 'Unknown'}ms
- **ブラウザ**: Playwright (Chromium)
- **タイムスタンプ**: ${testResult.timestamp}`;
  }

  /**
   * DOM情報フォーマット
   */
  formatDOMInfo(domInfo) {
    if (!domInfo) return 'DOM情報なし';
    
    return `
**利用可能な要素**:
${domInfo.elements ? `
- ボタン: ${domInfo.elements.buttons?.length || 0}個
- 入力欄: ${domInfo.elements.inputs?.length || 0}個  
- リンク: ${domInfo.elements.links?.length || 0}個
- セレクト: ${domInfo.elements.selects?.length || 0}個
` : '要素情報なし'}

**推奨セレクタ**:
${domInfo.recommendedSelectors ? Object.entries(domInfo.recommendedSelectors).map(([key, value]) => `- ${key}: ${value}`).join('\n') : 'セレクタ情報なし'}`;
  }

  /**
   * 修正試行履歴構築
   */
  buildAttemptHistory(previousAttempts) {
    if (!previousAttempts || previousAttempts.length === 0) {
      return '初回分析（過去の試行なし）';
    }
    
    return previousAttempts.map((attempt, index) => `
**試行 ${index + 1}**:
- 修正内容: ${attempt.approach}
- 結果: ${attempt.success ? '成功' : '失敗'}
- エラー: ${attempt.error || 'なし'}
`).join('\n');
  }

  /**
   * テキストから修正提案抽出（フォールバック）
   */
  extractSuggestionsFromText(text) {
    return {
      rootCause: 'AI レスポンス解析エラー',
      fixedStep: null,
      confidence: 0.5,
      difficulty: 'unknown',
      explanation: text.substring(0, 200) + '...',
      implementable: false,
      alternatives: []
    };
  }

  /**
   * フォールバック修正提案
   */
  getFallbackSuggestion(testResult) {
    return {
      success: false,
      analysisResults: testResult.steps
        .filter(step => step.status === 'failed')
        .map(step => this.getFallbackStepAnalysis(step)),
      aiPowered: false,
      fallback: true,
      reason: 'AI API利用不可'
    };
  }

  /**
   * フォールバックステップ分析
   */
  getFallbackStepAnalysis(failedStep) {
    const basicFixes = this.getBasicFixSuggestions(failedStep);
    
    return {
      step: failedStep,
      aiAnalysis: {
        rootCause: 'ルールベース分析による推定',
        fixedStep: basicFixes.fixedStep,
        confidence: 0.6,
        difficulty: 'medium',
        explanation: basicFixes.explanation,
        implementable: true,
        alternatives: basicFixes.alternatives
      },
      confidence: 0.6,
      implementable: true
    };
  }

  /**
   * 基本修正提案（非AI）
   */
  getBasicFixSuggestions(failedStep) {
    const error = failedStep.error?.toLowerCase() || '';
    const target = failedStep.target || '';
    
    if (error.includes('timeout')) {
      return {
        fixedStep: {
          ...failedStep,
          timeout: 10000,
          waitCondition: 'visible'
        },
        explanation: 'タイムアウト時間を延長し、要素の可視性を確認',
        alternatives: [
          {
            approach: '動的待機の追加',
            step: {
              action: 'waitForSelector',
              target: target,
              timeout: 10000
            }
          }
        ]
      };
    }
    
    if (error.includes('not visible') || error.includes('not found')) {
      return {
        fixedStep: {
          ...failedStep,
          target: this.suggestAlternativeSelector(target)
        },
        explanation: '代替セレクタの使用を提案',
        alternatives: [
          {
            approach: 'CSS セレクタの変更',
            step: { ...failedStep, target: `[data-testid="${target.replace(/[^\w]/g, '')}"]` }
          }
        ]
      };
    }
    
    return {
      fixedStep: failedStep,
      explanation: '具体的な修正提案なし - 手動確認推奨',
      alternatives: []
    };
  }

  /**
   * 代替セレクタ提案
   */
  suggestAlternativeSelector(originalTarget) {
    // 基本的な代替セレクタ生成ロジック
    if (originalTarget.startsWith('#')) {
      return `[id="${originalTarget.substring(1)}"]`;
    }
    if (originalTarget.startsWith('.')) {
      return `[class*="${originalTarget.substring(1)}"]`;
    }
    return originalTarget;
  }

  /**
   * 遅延ユーティリティ
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 修正済みルート生成
   */
  async generateFixedRoute(originalRoute, analysisResults) {
    console.log('\n🔧 AI 分析結果を基に修正ルートを生成中...');
    
    const fixedRoute = {
      ...originalRoute,
      route_id: `ai_fixed_${originalRoute.route_id}_${Date.now()}`,
      original_route_id: originalRoute.route_id,
      fix_timestamp: new Date().toISOString(),
      ai_analysis: true,
      fix_source: 'ai_powered_analysis'
    };

    // AI 分析結果を適用
    fixedRoute.steps = originalRoute.steps.map((step, index) => {
      const analysis = analysisResults.find(a => a.step.label === step.label);
      
      if (analysis && analysis.aiAnalysis.fixedStep) {
        console.log(`🤖 AI修正適用: ${step.label}`);
        return {
          ...analysis.aiAnalysis.fixedStep,
          originalStep: step,
          aiFixed: true,
          confidence: analysis.confidence,
          explanation: analysis.aiAnalysis.explanation
        };
      }
      
      return step;
    });

    // 追加ステップがある場合は挿入
    analysisResults.forEach(analysis => {
      if (analysis.aiAnalysis.additionalSteps?.length > 0) {
        analysis.aiAnalysis.additionalSteps.forEach(additionalStep => {
          fixedRoute.steps.push({
            ...additionalStep,
            aiGenerated: true,
            purpose: 'ai_suggested_enhancement'
          });
        });
      }
    });

    fixedRoute.ai_fix_summary = {
      total_steps: fixedRoute.steps.length,
      ai_fixed_steps: fixedRoute.steps.filter(s => s.aiFixed).length,
      ai_generated_steps: fixedRoute.steps.filter(s => s.aiGenerated).length,
      average_confidence: analysisResults.reduce((sum, a) => sum + a.confidence, 0) / analysisResults.length,
      model_used: this.config.model
    };

    return fixedRoute;
  }

  /**
   * 設定検証
   */
  validateConfig() {
    const issues = [];
    
    if (!this.config.apiKey) {
      issues.push('OpenAI API キーが設定されていません');
    }
    
    if (!this.config.model) {
      issues.push('AI モデルが指定されていません');
    }
    
    return {
      valid: issues.length === 0,
      issues
    };
  }
}

/**
 * AI失敗分析の実行
 */
export async function analyzeFailuresWithAI(testResults, options = {}) {
  const analyzer = new AIFailureAnalyzer(options);
  
  console.log('🤖 AI-Powered 失敗テスト分析を開始...');
  
  const validation = analyzer.validateConfig();
  if (!validation.valid) {
    console.log('⚠️ 設定エラー:', validation.issues.join(', '));
    console.log('💡 フォールバックモードで実行します');
  }

  const results = [];
  
  for (const testResult of testResults) {
    if (testResult.steps.some(step => step.status === 'failed')) {
      console.log(`\n🔍 テスト分析: ${testResult.route_id}`);
      
      const analysis = await analyzer.analyzeFailureWithAI(testResult, options.domInfo);
      results.push({
        testResult,
        analysis,
        aiPowered: analysis.aiPowered
      });
      
      // 修正ルート生成
      if (analysis.success && analysis.analysisResults.length > 0) {
        const fixedRoute = await analyzer.generateFixedRoute(testResult, analysis.analysisResults);
        results[results.length - 1].fixedRoute = fixedRoute;
      }
    }
  }

  return {
    results,
    summary: {
      total_analyzed: results.length,
      ai_powered: results.filter(r => r.aiPowered).length,
      fallback: results.filter(r => !r.aiPowered).length,
      fixed_routes_generated: results.filter(r => r.fixedRoute).length
    }
  };
}

export default AIFailureAnalyzer; 