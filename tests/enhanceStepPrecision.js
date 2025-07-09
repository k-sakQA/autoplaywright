#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { parseArguments } from './utils/cliParser.js';
import OpenAI from 'openai';

/**
 * 失敗パターンを学習し、新しいテストケースを生成する強化版失敗分析
 */
class EnhancedFailureAnalyzer {
  constructor(options = {}) {
    this.browser = null;
    this.page = null;
    this.options = options;
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    
    // 失敗パターンの学習データ
    this.failurePatterns = this.loadFailurePatterns();
  }

  async init() {
    this.browser = await chromium.launch({ headless: true });
    this.page = await this.browser.newPage();
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  /**
   * 失敗パターンの学習データを読み込み
   */
  loadFailurePatterns() {
    try {
      const patternsFile = path.join(process.cwd(), 'test-results', 'failure_patterns.json');
      if (fs.existsSync(patternsFile)) {
        return JSON.parse(fs.readFileSync(patternsFile, 'utf-8'));
      }
    } catch (error) {
      console.log('📋 失敗パターンファイルが見つかりません（新規作成します）');
    }
    
    return {
      patterns: [],
      statistics: {
        totalFailures: 0,
        resolvedFailures: 0,
        commonIssues: {}
      }
    };
  }

  /**
   * 失敗パターンを保存
   */
  saveFailurePatterns() {
    const patternsFile = path.join(process.cwd(), 'test-results', 'failure_patterns.json');
    fs.writeFileSync(patternsFile, JSON.stringify(this.failurePatterns, null, 2));
  }

  /**
   * 最新のテスト結果を取得
   */
  getLatestTestResult() {
    const testResultsDir = path.join(process.cwd(), 'test-results');
    const files = fs.readdirSync(testResultsDir)
      .filter(file => file.startsWith('result_') && file.endsWith('.json'))
      .sort()
      .reverse();

    if (files.length === 0) {
      throw new Error('テスト結果ファイルが見つかりません');
    }

    const latestFile = files[0];
    const filePath = path.join(testResultsDir, latestFile);
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }

  /**
   * 汎用的な依存関係パターンの定義
   */
  getDependencyPatterns() {
    return [
      {
        name: 'email_field',
        targetPattern: /email/i,
        dependencies: [
          {
            type: 'select',
            target: '[name="contact"]',
            value: 'email',
            description: '確認のご連絡でメールを選択'
          },
          {
            type: 'wait',
            target: '[name="email"]',
            description: 'メール欄の表示待機'
          }
        ]
      },
      {
        name: 'phone_field',
        targetPattern: /phone|tel/i,
        dependencies: [
          {
            type: 'select',
            target: '[name="contact"]',
            value: 'tel',
            description: '確認のご連絡で電話を選択'
          },
          {
            type: 'wait',
            target: '[name="phone"]',
            description: '電話欄の表示待機'
          }
        ]
      },
      {
        name: 'address_field',
        targetPattern: /address|住所/i,
        dependencies: [
          {
            type: 'select',
            target: '[name="address_type"]',
            value: 'home',
            description: '住所種別で自宅を選択'
          },
          {
            type: 'wait',
            target: '[name="address"]',
            description: '住所欄の表示待機'
          }
        ]
      },
      {
        name: 'dynamic_checkbox',
        targetPattern: /checkbox.*dynamic|動的.*チェックボックス/i,
        dependencies: [
          {
            type: 'click',
            target: '[name="enable_dynamic"]',
            description: '動的要素を有効化'
          },
          {
            type: 'wait',
            target: '[name="dynamic_field"]',
            description: '動的要素の表示待機'
          }
        ]
      }
    ];
  }

  /**
   * 汎用的な依存関係チェック
   */
  checkDependencies(step, allSteps) {
    const patterns = this.getDependencyPatterns();
    
    for (const pattern of patterns) {
      if (pattern.targetPattern.test(step.target || step.label || '')) {
        const missingDependencies = [];
        
        for (const dependency of pattern.dependencies) {
          const hasDependency = allSteps.some(s => {
            if (dependency.type === 'select') {
              return s.target === dependency.target && s.action === 'fill' && s.value === dependency.value;
            } else if (dependency.type === 'wait') {
              return s.target === dependency.target && s.action === 'waitForSelector';
            } else if (dependency.type === 'click') {
              return s.target === dependency.target && s.action === 'click';
            }
            return false;
          });
          
          if (!hasDependency) {
            missingDependencies.push(dependency);
          }
        }
        
        if (missingDependencies.length > 0) {
          return {
            message: `${pattern.name}パターン: ${missingDependencies.map(d => d.description).join('、')}が必要です。`,
            requiredSteps: missingDependencies.map(d => ({
              label: d.description,
              action: d.type === 'select' ? 'fill' : d.type === 'wait' ? 'waitForSelector' : 'click',
              target: d.target,
              value: d.value
            }))
          };
        }
      }
    }

    return null;
  }

  /**
   * 重複ルートの高精度チェック
   */
  checkForDuplicateRoutes(originalRoute, proposedFixedRoute) {
    if (!originalRoute || !proposedFixedRoute) {
      return { isDuplicate: false, similarity: 0 };
    }

    const originalSteps = originalRoute.steps || originalRoute.test_steps || [];
    const fixedSteps = proposedFixedRoute.steps || proposedFixedRoute.test_steps || [];

    // 🔍 詳細な類似度分析
    const analysis = this.analyzeRouteChanges(originalSteps, fixedSteps);
    
    console.log(`🔬 ルート変更分析:`);
    console.log(`   - 基本類似度: ${(analysis.basicSimilarity * 100).toFixed(1)}%`);
    console.log(`   - 実質的変更: ${analysis.substantialChanges}件`);
    console.log(`   - 新規ステップ: ${analysis.newSteps}件`);
    console.log(`   - 価値スコア: ${analysis.valueScore}/10`);

    // 🎯 重複判定の精密化
    const isDuplicate = this.evaluateDuplicateWithPrecision(analysis);
    
    if (isDuplicate.isRealDuplicate) {
      console.log(`⚠️  実質的重複を検出: ${isDuplicate.reason}`);
      return { 
        isDuplicate: true, 
        similarity: analysis.basicSimilarity,
        message: isDuplicate.reason,
        analysis,
        recommendAction: isDuplicate.recommendAction
      };
    }

    return { 
      isDuplicate: false, 
      similarity: analysis.basicSimilarity,
      analysis,
      hasValue: analysis.valueScore >= 6 // 6点以上は価値ありと判定
    };
  }

  /**
   * ルート変更の詳細分析
   */
  analyzeRouteChanges(originalSteps, fixedSteps) {
    const analysis = {
      basicSimilarity: this.calculateRouteSimilarity(originalSteps, fixedSteps),
      substantialChanges: 0,
      newSteps: 0,
      valueScore: 0,
      changeDetails: []
    };

    // 🔄 ステップ数の変化
    const stepDiff = Math.abs(originalSteps.length - fixedSteps.length);
    if (stepDiff > 0) {
      analysis.newSteps = stepDiff;
      analysis.valueScore += Math.min(stepDiff * 2, 4); // 新ステップは価値が高い
      analysis.changeDetails.push(`${stepDiff}個のステップが追加/削除`);
    }

    // 🔍 個別ステップの変更分析
    for (let i = 0; i < Math.min(originalSteps.length, fixedSteps.length); i++) {
      const original = originalSteps[i];
      const fixed = fixedSteps[i];
      
      const changeType = this.analyzeStepChange(original, fixed);
      if (changeType.isSubstantial) {
        analysis.substantialChanges++;
        analysis.valueScore += changeType.value;
        analysis.changeDetails.push(changeType.description);
      }
    }

    // 🎯 価値判定の調整
    if (analysis.substantialChanges >= 3) analysis.valueScore += 2; // 複数改善
    if (analysis.newSteps >= 2) analysis.valueScore += 1; // 新機能追加
    
    return analysis;
  }

  /**
   * 個別ステップの変更分析
   */
  analyzeStepChange(originalStep, fixedStep) {
    const change = {
      isSubstantial: false,
      value: 0,
      description: ''
    };

    // アクションの変更（高価値）
    if (originalStep.action !== fixedStep.action) {
      change.isSubstantial = true;
      change.value = 3;
      change.description = `アクション変更: ${originalStep.action} → ${fixedStep.action}`;
      return change;
    }

    // ターゲットの変更（中価値）
    if (originalStep.target !== fixedStep.target) {
      change.isSubstantial = true;
      change.value = 2;
      change.description = `セレクタ変更: ${originalStep.target} → ${fixedStep.target}`;
      return change;
    }

    // 値の変更（低価値）
    if ((originalStep.value || '') !== (fixedStep.value || '')) {
      // 空文字から有効値への変更は価値が高い
      if (!originalStep.value && fixedStep.value) {
        change.isSubstantial = true;
        change.value = 2;
        change.description = `値の追加: "${fixedStep.value}"`;
      } else {
        change.value = 1;
        change.description = `値の変更: "${originalStep.value}" → "${fixedStep.value}"`;
      }
      return change;
    }

    return change;
  }

  /**
   * 精密重複判定
   */
  evaluateDuplicateWithPrecision(analysis) {
    // 🚫 完全重複の判定
    if (analysis.basicSimilarity > 0.95 && analysis.substantialChanges === 0) {
      return {
        isRealDuplicate: true,
        reason: `完全重複: 類似度${(analysis.basicSimilarity * 100).toFixed(1)}%で実質的変更なし`,
        recommendAction: 'skip_and_generate_alternative'
      };
    }

    // 🔄 微小変更の判定
    if (analysis.basicSimilarity > 0.85 && analysis.valueScore < 4) {
      return {
        isRealDuplicate: true,
        reason: `微小変更: 類似度${(analysis.basicSimilarity * 100).toFixed(1)}%で価値スコア${analysis.valueScore}/10`,
        recommendAction: 'enhance_or_alternative'
      };
    }

    // 📈 価値不足の判定
    if (analysis.substantialChanges < 2 && analysis.newSteps === 0 && analysis.valueScore < 3) {
      return {
        isRealDuplicate: true,
        reason: `価値不足: 実質的変更${analysis.substantialChanges}件、価値スコア${analysis.valueScore}/10`,
        recommendAction: 'generate_innovative_approach'
      };
    }

    return { isRealDuplicate: false };
  }

  /**
   * ルート間の類似度を計算
   */
  calculateRouteSimilarity(steps1, steps2) {
    if (steps1.length === 0 && steps2.length === 0) return 1.0;
    if (steps1.length === 0 || steps2.length === 0) return 0.0;

    let matches = 0;
    const maxSteps = Math.max(steps1.length, steps2.length);

    for (let i = 0; i < Math.min(steps1.length, steps2.length); i++) {
      const step1 = steps1[i];
      const step2 = steps2[i];

      // アクション、ターゲット、値の比較
      const actionMatch = step1.action === step2.action;
      const targetMatch = step1.target === step2.target;
      const valueMatch = (step1.value || '') === (step2.value || '');

      // 部分マッチングでスコア計算
      let stepScore = 0;
      if (actionMatch) stepScore += 0.4;
      if (targetMatch) stepScore += 0.4;
      if (valueMatch) stepScore += 0.2;

      matches += stepScore;
    }

    return matches / maxSteps;
  }

  /**
   * AIによる新しいテストアプローチの生成
   */
  async generateAlternativeTestApproach(failedRoute, failurePatterns, currentState) {
    console.log('🤖 AIによる新しいテストアプローチを生成中...');
    
    try {
      const prompt = this.buildAlternativeApproachPrompt(failedRoute, failurePatterns, currentState);
      
      const response = await this.openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "あなたはPlaywrightテスト自動化の専門家です。失敗したテストルートを分析し、全く異なるアプローチでテストを実現する新しい方法を提案してください。"
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.8, // 創造性を高めるために温度を上げる
        max_tokens: 2000
      });

      const content = response.choices[0].message.content;
      return this.parseAlternativeApproach(content);
      
    } catch (error) {
      console.error('❌ AI生成中にエラーが発生:', error.message);
      return this.generateFallbackAlternativeApproach(failedRoute, failurePatterns);
    }
  }

  /**
   * 新しいアプローチ生成用のプロンプト構築
   */
  buildAlternativeApproachPrompt(failedRoute, failurePatterns, currentState) {
    const failedSteps = failedRoute.steps || failedRoute.test_steps || [];
    const recentFailures = failurePatterns.patterns.slice(-5); // 最近の5つの失敗パターン

    return `
## 失敗したテストルートの分析と新しいアプローチの提案

### 現在の失敗ルート:
${JSON.stringify(failedSteps.map(s => ({
  action: s.action,
  target: s.target,
  value: s.value,
  label: s.label
})), null, 2)}

### 最近の失敗パターン:
${recentFailures.map(p => `- ${p.error_type}: ${p.description}`).join('\n')}

### ページの現在状態:
- 利用可能な要素: ${currentState?.availableElements?.length || 0}個
- フォーム数: ${currentState?.forms?.length || 0}個
- 動的要素: ${currentState?.dynamicElements?.length || 0}個

## 要求:
1. **完全に異なるアプローチ**でテストを実現する新しいルートを提案してください
2. 以下の観点で革新的な解決策を考えてください:
   - セレクタ戦略の変更（ID、クラス、属性、テキスト等）
   - 操作順序の根本的見直し
   - 待機戦略の改善（時間ベース→状態ベース）
   - フォーカス管理やイベント発火の考慮
   - ユーザー操作の自然な流れの模倣

3. 出力形式:
\`\`\`json
{
  "approach_name": "アプローチの名前",
  "strategy_change": "戦略変更の説明",
  "new_steps": [
    {
      "label": "ステップの説明",
      "action": "playwright_action",
      "target": "selector",
      "value": "value_if_needed",
      "wait_strategy": "待機戦略"
    }
  ],
  "expected_improvement": "期待される改善点",
  "risk_mitigation": "リスクとその対策"
}
\`\`\`

従来のアプローチでは解決できない問題に対して、創造的で実践的な解決策を提案してください。
`;
  }

  /**
   * AIで生成された新しいアプローチをパース
   */
  parseAlternativeApproach(content) {
    try {
      // JSON部分を抽出
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        const approach = JSON.parse(jsonMatch[1]);
        
        // バリデーション
        if (approach.new_steps && Array.isArray(approach.new_steps)) {
          console.log(`✅ 新しいアプローチ「${approach.approach_name}」を生成しました`);
          console.log(`📋 戦略: ${approach.strategy_change}`);
          console.log(`🎯 期待効果: ${approach.expected_improvement}`);
          
          return approach;
        }
      }
    } catch (error) {
      console.error('❌ AIレスポンスのパースに失敗:', error.message);
    }

    return null;
  }

  /**
   * フォールバック用の新しいアプローチ生成
   */
  generateFallbackAlternativeApproach(failedRoute, failurePatterns) {
    console.log('🔄 フォールバック: 基本的な新アプローチを生成中...');
    
    const failedSteps = failedRoute.steps || failedRoute.test_steps || [];
    const commonErrors = this.analyzeCommonErrors(failurePatterns);
    
    // 基本的な改善パターン
    const improvements = [
      {
        name: "セレクタ戦略の多様化",
        changes: ["data-testid属性の使用", "テキストベースセレクタ", "相対位置指定"]
      },
      {
        name: "待機戦略の強化", 
        changes: ["networkidle状態の待機", "要素の可視化待機", "アニメーション完了待機"]
      },
      {
        name: "操作順序の最適化",
        changes: ["フォーカス管理の改善", "イベント発火の確実化", "バリデーション待機"]
      }
    ];
    
    const selectedImprovement = improvements[Math.floor(Math.random() * improvements.length)];
    
    return {
      approach_name: selectedImprovement.name,
      strategy_change: `従来の${commonErrors.most_common_type}エラーを避けるため、${selectedImprovement.changes.join('、')}を採用`,
      new_steps: this.generateImprovedSteps(failedSteps, selectedImprovement),
      expected_improvement: `${commonErrors.most_common_type}エラーの削減と実行安定性の向上`,
      risk_mitigation: "段階的実行と詳細ログによる問題早期発見"
    };
  }

  /**
   * 改善されたステップの生成
   */
  generateImprovedSteps(originalSteps, improvement) {
    return originalSteps.map((step, index) => {
      const improvedStep = { ...step };
      
      // セレクタ戦略の改善
      if (improvement.name.includes("セレクタ")) {
        if (step.target && step.target.includes('[name=')) {
          const nameAttr = step.target.match(/name="([^"]+)"/)?.[1];
          if (nameAttr) {
            improvedStep.target = `[data-testid="${nameAttr}"], ${step.target}, text="${nameAttr}"`;
            improvedStep.label = `${step.label} (マルチセレクタ対応)`;
          }
        }
      }
      
      // 待機戦略の改善
      if (improvement.name.includes("待機")) {
        if (step.action === 'fill' || step.action === 'click') {
          return [
            {
              label: `${step.label}の前処理: 要素の準備待機`,
              action: 'waitForFunction',
              target: `() => {
                const el = document.querySelector('${step.target}');
                return el && el.offsetParent !== null && !el.disabled;
              }`,
              value: '',
              wait_strategy: '要素の完全準備待機'
            },
            {
              ...improvedStep,
              wait_strategy: '安定化後実行'
            }
          ];
        }
      }
      
      return improvedStep;
    }).flat();
  }

  /**
   * 共通エラーパターンの分析
   */
  analyzeCommonErrors(failurePatterns) {
    const errorTypes = {};
    
    failurePatterns.patterns.forEach(pattern => {
      errorTypes[pattern.error_type] = (errorTypes[pattern.error_type] || 0) + 1;
    });
    
    const mostCommon = Object.entries(errorTypes)
      .sort(([,a], [,b]) => b - a)[0];
    
    return {
      most_common_type: mostCommon?.[0] || 'timeout',
      frequency: mostCommon?.[1] || 0,
      total_patterns: failurePatterns.patterns.length
    };
  }

  /**
   * 失敗パターンを詳細分析
   */
  async analyzeFailurePattern(step, url, allSteps = []) {
    console.log(`🔍 失敗パターンを分析中: ${step.label}`);
    
    // 1. エラーメッセージの分類
    const errorType = this.classifyError(step.error);
    
    // 2. 現在のページ状態を取得
    await this.init();
    await this.page.goto(url);
    const currentState = await this.getPageState();
    
    // 3. 失敗原因の特定
    const failureReason = await this.identifyFailureReason(step, currentState, errorType);
    
    // 4. 汎用的な依存関係チェックと修正案生成
    const dependencyFix = this.checkDependencies(step, allSteps);
    
    // 5. 新しいテストケースの生成
    const newTestCases = await this.generateNewTestCases(step, failureReason, currentState);
    
    // 6. 失敗パターンの学習
    this.learnFailurePattern(step, failureReason, newTestCases);
    
    return {
      originalStep: step,
      failureReason,
      newTestCases,
      errorType,
      currentState,
      dependencyFix
    };
  }

  /**
   * エラーの分類
   */
  classifyError(error) {
    const errorMessage = error?.message || error?.toString() || '';
    
    if (errorMessage.includes('Timeout')) {
      return 'TIMEOUT';
    } else if (errorMessage.includes('disabled')) {
      return 'ELEMENT_DISABLED';
    } else if (errorMessage.includes('not visible')) {
      return 'ELEMENT_NOT_VISIBLE';
    } else if (errorMessage.includes('not found')) {
      return 'ELEMENT_NOT_FOUND';
    } else if (errorMessage.includes('invalid')) {
      return 'INVALID_INPUT';
    } else if (errorMessage.includes('format')) {
      return 'FORMAT_ERROR';
    } else {
      return 'UNKNOWN';
    }
  }

  /**
   * ページの現在状態を取得
   */
  async getPageState() {
    const state = {
      url: this.page.url(),
      title: await this.page.title(),
      elements: {},
      formData: {},
      dynamicElements: []
    };

    // フォーム要素の状態を取得
    const inputs = await this.page.$$eval('input, select, textarea', elements => {
      return elements.map(el => ({
        name: el.name,
        id: el.id,
        type: el.type,
        value: el.value,
        disabled: el.disabled,
        visible: el.offsetParent !== null,
        placeholder: el.placeholder,
        required: el.required,
        className: el.className
      }));
    });

    state.elements.inputs = inputs;

    // 動的要素の検出
    const dynamicElements = await this.page.$$eval('[style*="display"], [class*="hidden"], [class*="show"]', elements => {
      return elements.map(el => ({
        tagName: el.tagName,
        id: el.id,
        className: el.className,
        style: el.style.cssText,
        visible: el.offsetParent !== null
      }));
    });

    state.dynamicElements = dynamicElements;

    return state;
  }

  /**
   * 失敗原因の特定
   */
  async identifyFailureReason(step, currentState, errorType) {
    const analysis = {
      errorType,
      possibleCauses: [],
      dataFormatIssues: [],
      dynamicBehaviorIssues: [],
      selectorIssues: [],
      timingIssues: []
    };

    // データ形式の問題を検出
    if (step.action === 'fill' && step.value) {
      const formatIssues = this.analyzeDataFormat(step.target, step.value, currentState);
      analysis.dataFormatIssues = formatIssues;
    }

    // 動的要素の問題を検出
    const dynamicIssues = this.analyzeDynamicBehavior(step, currentState);
    analysis.dynamicBehaviorIssues = dynamicIssues;

    // セレクタの問題を検出
    const selectorIssues = await this.analyzeSelectorIssues(step, currentState);
    analysis.selectorIssues = selectorIssues;

    // タイミングの問題を検出
    const timingIssues = this.analyzeTimingIssues(step, errorType);
    analysis.timingIssues = timingIssues;

    return analysis;
  }

  /**
   * データ形式の問題を分析
   */
  analyzeDataFormat(target, value, currentState) {
    const issues = [];
    
    // 日付形式の検証
    if (target.includes('date') && value) {
      const datePatterns = [
        /^\d{4}-\d{2}-\d{2}$/,  // YYYY-MM-DD
        /^\d{4}\/\d{2}\/\d{2}$/, // YYYY/MM/DD
        /^\d{2}\/\d{2}\/\d{4}$/  // MM/DD/YYYY
      ];
      
      const isValidFormat = datePatterns.some(pattern => pattern.test(value));
      if (!isValidFormat) {
        issues.push({
          type: 'DATE_FORMAT',
          currentValue: value,
          suggestedFormats: ['2025-07-04', '2025/07/04', '07/04/2025'],
          description: '日付形式が期待される形式と異なります'
        });
      }
    }

    // 数値形式の検証
    if (target.includes('term') || target.includes('head-count')) {
      if (isNaN(Number(value))) {
        issues.push({
          type: 'NUMBER_FORMAT',
          currentValue: value,
          suggestedValue: '123',
          description: '数値フィールドに文字列が入力されています'
        });
      }
    }

    // メール形式の検証
    if (target.includes('email') && value) {
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailPattern.test(value)) {
        issues.push({
          type: 'EMAIL_FORMAT',
          currentValue: value,
          suggestedValue: 'test@example.com',
          description: 'メールアドレスの形式が正しくありません'
        });
      }
    }

    return issues;
  }

  /**
   * 動的要素の問題を分析
   */
  analyzeDynamicBehavior(step, currentState) {
    const issues = [];
    
    // プルダウン選択による動的表示
    if (step.target.includes('email')) {
      const contactSelect = currentState.elements.inputs.find(input => 
        input.name === 'contact' || input.name === 'contact-method'
      );
      
      if (contactSelect) {
        issues.push({
          type: 'DYNAMIC_DISPLAY',
          dependency: 'contact',
          description: 'メールフィールドは「確認のご連絡」でメールを選択後に表示されます',
          requiredAction: 'プルダウンで「メール」を選択してからメールフィールドに入力'
        });
      }
    }

    // disabled状態の要素
    const targetElement = currentState.elements.inputs.find(input => 
      step.target.includes(input.name) || step.target.includes(input.id)
    );
    
    if (targetElement && targetElement.disabled) {
      issues.push({
        type: 'ELEMENT_DISABLED',
        element: targetElement.name || targetElement.id,
        description: '要素が無効化されています',
        possibleCauses: ['条件未満', 'JavaScript制御', 'フォーム状態']
      });
    }

    return issues;
  }

  /**
   * セレクタの問題を分析
   */
  async analyzeSelectorIssues(step, currentState) {
    const issues = [];
    
    try {
      // セレクタで要素を検索
      const elements = await this.page.$$(step.target);
      
      if (elements.length === 0) {
        issues.push({
          type: 'SELECTOR_NOT_FOUND',
          selector: step.target,
          description: '指定されたセレクタで要素が見つかりません',
          suggestions: this.suggestAlternativeSelectors(step.target, currentState)
        });
      } else if (elements.length > 1) {
        issues.push({
          type: 'MULTIPLE_ELEMENTS',
          selector: step.target,
          count: elements.length,
          description: '複数の要素がマッチしています'
        });
      }
    } catch (error) {
      issues.push({
        type: 'INVALID_SELECTOR',
        selector: step.target,
        error: error.message,
        description: 'セレクタの構文が正しくありません'
      });
    }

    return issues;
  }

  /**
   * 代替セレクタを提案
   */
  suggestAlternativeSelectors(target, currentState) {
    const suggestions = [];
    
    // name属性から検索
    const nameMatch = target.match(/\[name="([^"]+)"\]/);
    if (nameMatch) {
      const nameValue = nameMatch[1];
      const similarElements = currentState.elements.inputs.filter(input => 
        input.name && (
          input.name.includes(nameValue.split('-')[0]) ||
          nameValue.includes(input.name.split('-')[0])
        )
      );
      
      similarElements.forEach(element => {
        suggestions.push({
          selector: `[name="${element.name}"]`,
          reason: `類似name属性: ${element.name}`,
          confidence: element.name === nameValue ? 0.9 : 0.7
        });
      });
    }

    return suggestions;
  }

  /**
   * タイミングの問題を分析
   */
  analyzeTimingIssues(step, errorType) {
    const issues = [];
    
    if (errorType === 'TIMEOUT') {
      issues.push({
        type: 'TIMEOUT',
        description: '要素の待機がタイムアウトしました',
        possibleCauses: [
          'ページの読み込みが遅い',
          'JavaScriptによる動的生成',
          'ネットワーク遅延',
          '要素が条件付きで表示される'
        ],
        suggestions: [
          'waitForSelectorの使用',
          'ページ読み込み完了の待機',
          '動的要素の表示待機'
        ]
      });
    }

    return issues;
  }

  /**
   * 新しいテストケースを生成
   */
  async generateNewTestCases(step, failureReason, currentState) {
    console.log('🤖 AIによる新しいテストケース生成中...');
    
    const prompt = this.buildTestCaseGenerationPrompt(step, failureReason, currentState);
    
    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "あなたはテスト自動化の専門家です。失敗したテストステップを分析し、根本原因を特定して新しいテストケースを生成してください。"
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.3
      });

      const generatedContent = response.choices[0].message.content;
      return this.parseGeneratedTestCases(generatedContent);
    } catch (error) {
      console.log('❌ AIによるテストケース生成に失敗しました:', error.message);
      return this.generateFallbackTestCases(step, failureReason);
    }
  }

  /**
   * テストケース生成用のプロンプトを構築
   */
  buildTestCaseGenerationPrompt(step, failureReason, currentState) {
    return `
失敗したテストステップを分析し、新しいテストケースを生成してください。

## 失敗したステップ
- ラベル: ${step.label}
- アクション: ${step.action}
- ターゲット: ${step.target}
- 値: ${step.value || 'なし'}
- エラー: ${step.error?.message || 'なし'}

## 失敗原因分析
${JSON.stringify(failureReason, null, 2)}

## 現在のページ状態
${JSON.stringify(currentState, null, 2)}

## 要求事項
1. 失敗の根本原因を特定してください
2. その原因を検証する新しいテストケースを3-5個生成してください
3. 各テストケースには以下の情報を含めてください：
   - テストケース名
   - 目的
   - 前提条件
   - 実行手順
   - 期待結果
   - データ形式の検証（必要に応じて）

## 出力形式
JSON形式で出力してください：
{
  "rootCause": "失敗の根本原因",
  "testCases": [
    {
      "name": "テストケース名",
      "purpose": "目的",
      "prerequisites": ["前提条件1", "前提条件2"],
      "steps": [
        {"action": "アクション", "target": "ターゲット", "value": "値", "description": "説明"}
      ],
      "expectedResult": "期待結果",
      "dataValidation": "データ形式の検証内容"
    }
  ]
}
`;
  }

  /**
   * 生成されたテストケースを解析
   */
  parseGeneratedTestCases(content) {
    try {
      // JSON部分を抽出
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      console.log('❌ 生成されたテストケースの解析に失敗しました');
    }
    
    return this.generateFallbackTestCases();
  }

  /**
   * フォールバックテストケースの生成
   */
  generateFallbackTestCases(step, failureReason) {
    const testCases = [];
    
    // データ形式の問題に対するテストケース
    failureReason.dataFormatIssues.forEach(issue => {
      testCases.push({
        name: `${issue.type}検証テスト`,
        purpose: `${issue.description}を検証`,
        prerequisites: ['ページにアクセス済み'],
        steps: [
          {
            action: 'fill',
            target: step.target,
            value: issue.suggestedValue || 'test',
            description: `正しい形式で値を入力`
          }
        ],
        expectedResult: '入力が正常に受け入れられる',
        dataValidation: issue.description
      });
    });

    // 動的要素の問題に対するテストケース
    failureReason.dynamicBehaviorIssues.forEach(issue => {
      if (issue.type === 'DYNAMIC_DISPLAY') {
        testCases.push({
          name: '動的表示テスト',
          purpose: '条件付き表示の動作を検証',
          prerequisites: ['ページにアクセス済み'],
          steps: [
            {
              action: 'fill',
              target: `[name="${issue.dependency}"]`,
              value: 'email',
              description: '依存要素を設定'
            },
            {
              action: 'waitForSelector',
              target: step.target,
              description: '動的要素の表示を待機'
            },
            {
              action: 'fill',
              target: step.target,
              value: 'test@example.com',
              description: '動的要素に入力'
            }
          ],
          expectedResult: '動的要素が正しく表示され、入力が可能',
          dataValidation: '条件付き表示の動作'
        });
      }
    });

    return {
      rootCause: 'データ形式または動的要素の問題',
      testCases
    };
  }

  /**
   * 失敗パターンを学習
   */
  learnFailurePattern(step, failureReason, newTestCases) {
    const pattern = {
      timestamp: new Date().toISOString(),
      step: {
        label: step.label,
        action: step.action,
        target: step.target,
        value: step.value
      },
      failureReason,
      newTestCases,
      resolved: false
    };

    this.failurePatterns.patterns.push(pattern);
    this.failurePatterns.statistics.totalFailures++;
    
    // 統計情報を更新
    const errorType = failureReason.errorType;
    this.failurePatterns.statistics.commonIssues[errorType] = 
      (this.failurePatterns.statistics.commonIssues[errorType] || 0) + 1;
    
    this.saveFailurePatterns();
  }

  /**
   * テストルートの自動修正
   */
  fixTestRoute(route, dependencyFix) {
    if (!dependencyFix || !dependencyFix.requiredSteps) {
      return route;
    }

    console.log(`🔧 テストルートの自動修正を実行: ${route.route_id}`);
    console.log(`📝 修正理由: ${dependencyFix.message}`);

    const fixedRoute = {
      ...route,
      steps: [...route.steps],
      fix_timestamp: new Date().toISOString(),
      fix_summary: {
        original_steps: route.steps.length,
        added_steps: dependencyFix.requiredSteps.length,
        fix_reason: dependencyFix.message
      }
    };

    // 失敗したステップの前に依存ステップを挿入
    const failedStepIndex = fixedRoute.steps.findIndex(step => 
      step.target && step.target.includes('email') && step.action === 'fill'
    );

    if (failedStepIndex !== -1) {
      // 失敗ステップを削除（後で正しい順序で再追加）
      const failedStep = fixedRoute.steps.splice(failedStepIndex, 1)[0];
      
      // 依存ステップを挿入（重複を避けるため、既存のステップをチェック）
      const existingSteps = new Set();
      fixedRoute.steps.forEach(step => {
        existingSteps.add(`${step.action}:${step.target}:${step.value || ''}`);
      });

      dependencyFix.requiredSteps.forEach(dep => {
        const stepKey = `${dep.action}:${dep.target}:${dep.value || ''}`;
        if (!existingSteps.has(stepKey)) {
          fixedRoute.steps.splice(failedStepIndex, 0, dep);
          existingSteps.add(stepKey);
        }
      });

      // 失敗ステップを正しい順序で再追加（値も保持）
      if (failedStep.value) {
        // 元の値がある場合は保持
        fixedRoute.steps.push(failedStep);
      } else {
        // 値がない場合は適切な値を設定
        const stepWithValue = {
          ...failedStep,
          value: failedStep.target.includes('email') ? 'test@example.com' : 'テストデータ'
        };
        fixedRoute.steps.push(stepWithValue);
      }
    }

    // 他のステップの値も適切に設定
    fixedRoute.steps.forEach(step => {
      if (step.action === 'fill' && !step.value) {
        if (step.target.includes('date')) {
          step.value = '2025/07/25';
        } else if (step.target.includes('term') || step.target.includes('head-count')) {
          step.value = '2';
        } else if (step.target.includes('username')) {
          step.value = 'テスト太郎';
        } else if (step.target.includes('email')) {
          step.value = 'test@example.com';
        } else if (step.target.includes('contact')) {
          step.value = 'email';
        } else {
          step.value = 'テストデータ';
        }
      }
    });

    console.log(`✅ 修正完了: ${dependencyFix.requiredSteps.length}ステップを追加`);
    return fixedRoute;
  }

  /**
   * 修正されたルートを保存
   */
  saveFixedRoute(fixedRoute) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fixedRouteFile = path.join(process.cwd(), 'test-results', `fixed_route_${fixedRoute.route_id}_${timestamp}.json`);
    
    fs.writeFileSync(fixedRouteFile, JSON.stringify(fixedRoute, null, 2));
    console.log(`💾 修正されたルートを保存: ${fixedRouteFile}`);
    
    return fixedRouteFile;
  }

  /**
   * AIによる新テストケース生成と適用
   */
  async generateAndApplyNewTestCases(analysis) {
    if (!analysis.newTestCases || !analysis.newTestCases.testCases) {
      return null;
    }

    console.log(`🤖 AIによる新テストケースを適用中...`);
    
    const newRoute = {
      scenario_id: `scenario_ai_generated_${Date.now()}`,
      route_id: `ai_generated_${Date.now()}`, // 🔄 後方互換性のために保持
      generated_from_analysis: analysis.originalStep.label,
      original_viewpoint: analysis.originalStep.label,
      category: 'ai_generated',
      priority: 'high',
      user_story_id: null,
      steps: [],
      generated_at: new Date().toISOString(),
      metadata: {
        source: 'enhanceStepPrecision.js AI生成',
        version: '2.0.0',
        type: 'ai_generated_test_case',
        generation_method: 'failure_analysis'
      }
    };

    // 新テストケースをステップに変換
    for (const testCase of analysis.newTestCases.testCases) {
      if (testCase.steps && Array.isArray(testCase.steps)) {
        for (const step of testCase.steps) {
          newRoute.steps.push({
            label: step.description || `${step.action} ${step.target}`,
            action: step.action,
            target: step.target,
            value: step.value
          });
        }
      }
    }

    // 新ルートを保存
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const newRouteFile = path.join(process.cwd(), 'test-results', `ai_generated_route_${timestamp}.json`);
    
    fs.writeFileSync(newRouteFile, JSON.stringify(newRoute, null, 2));
    console.log(`💾 AI生成ルートを保存: ${newRouteFile}`);
    
    return newRouteFile;
  }

  /**
   * チェックボックス操作の自動修正
   */
  fixCheckboxActions(step) {
    // チェックボックスエラーの検出
    const isCheckboxError = step.error && 
      step.error.includes('Input of type "checkbox" cannot be filled');
    
    if (!isCheckboxError) {
      return null;
    }

    console.log(`🔧 チェックボックス操作エラーを検出: ${step.label}`);
    
    // 修正されたステップを生成
    const fixedStep = {
      ...step,
      action: 'check', // fillからcheckに変更
      value: true, // チェックボックスはboolean値
      fix_reason: 'チェックボックス要素にはfillではなくcheckアクションを使用',
      fixed_at: new Date().toISOString()
    };

    return {
      message: `チェックボックス「${step.target}」の操作方法を修正: fill → check`,
      fixedStep,
      isSimpleFix: true
    };
  }

  /**
   * 数値入力フィールドの自動修正  
   */
  fixNumberInputActions(step) {
    // 数値入力エラーの検出
    const isNumberInputError = step.error && 
      step.error.includes('Cannot type text into input[type=number]');
    
    if (!isNumberInputError) {
      return null;
    }

    console.log(`🔧 数値入力エラーを検出: ${step.label}`);
    
    // ターゲット名から適切な数値を推測
    let numericValue = '1';
    if (step.target.includes('term')) {
      numericValue = '2'; // 宿泊数
    } else if (step.target.includes('head-count')) {
      numericValue = '2'; // 人数
    }

    const fixedStep = {
      ...step,
      value: numericValue,
      fix_reason: 'input[type=number]には文字列ではなく数値を入力',
      fixed_at: new Date().toISOString()
    };

    return {
      message: `数値入力「${step.target}」の値を修正: テキスト → ${numericValue}`,
      fixedStep,
      isSimpleFix: true
    };
  }

  /**
   * hidden要素操作の自動修正
   */
  fixHiddenElementActions(step) {
    // hidden要素エラーの検出
    const isHiddenError = step.error && 
      (step.error.includes('Timeout') && step.target.includes('hidden'));
    
    if (!isHiddenError) {
      return null;
    }

    console.log(`🔧 hidden要素操作エラーを検出: ${step.label}`);
    
    return {
      message: `hidden要素「${step.target}」は操作対象外のため、ステップをスキップ`,
      fixedStep: null, // スキップするためnull
      isSimpleFix: true,
      shouldSkip: true
    };
  }

  /**
   * 簡単な修正の統合チェック
   */
  checkForSimpleFixes(step) {
    // チェックボックス修正
    const checkboxFix = this.fixCheckboxActions(step);
    if (checkboxFix) return checkboxFix;

    // 数値入力修正
    const numberFix = this.fixNumberInputActions(step);
    if (numberFix) return numberFix;

    // hidden要素修正
    const hiddenFix = this.fixHiddenElementActions(step);
    if (hiddenFix) return hiddenFix;

    return null;
  }

  /**
   * フォールバック未実施アプローチ
   */
  generateFallbackUntestedApproaches(originalRoute) {
    console.log('🔄 フォールバック: 基本的な未実施アプローチを生成中...');
    
    return [
      {
        approach_id: "selector_diversity",
        approach_name: "セレクタ多様化戦略",
        strategy: "CSS、XPath、テキストベース、属性ベースの複数セレクタを組み合わせ",
        steps: this.generateDiverseSelectorSteps(originalRoute),
        expected_success_rate: "70%",
        unique_points: ["複数セレクタの同時使用", "フォールバック機能"],
        risk_level: "low"
      },
      {
        approach_id: "event_driven",
        approach_name: "イベント駆動型操作",
        strategy: "ユーザーイベントの自然な発火を重視した操作順序",
        steps: this.generateEventDrivenSteps(originalRoute),
        expected_success_rate: "65%", 
        unique_points: ["フォーカス管理", "イベント連鎖"],
        risk_level: "medium"
      },
      {
        approach_id: "javascript_direct",
        approach_name: "JavaScript直接実行",
        strategy: "Playwrightの通常操作ではなくJavaScript直接実行による代替",
        steps: this.generateJavaScriptDirectSteps(originalRoute),
        expected_success_rate: "80%",
        unique_points: ["DOM直接操作", "ブラウザAPI活用"],
        risk_level: "medium"
      }
    ];
  }

  /**
   * セレクタ多様化ステップの生成
   */
  generateDiverseSelectorSteps(originalRoute) {
    const originalSteps = originalRoute.steps || [];
    const diverseSteps = [];

    diverseSteps.push({
      label: "対象ページにアクセス",
      action: "load",
      target: "https://hotel-example-site.takeyaqa.dev/ja/reserve.html?plan-id=0",
      timeout: 10000
    });

    // 入力フィールドを複数セレクタで操作
    const inputFields = [
      { name: 'date', label: '宿泊日入力', value: '2025/07/25' },
      { name: 'term', label: '宿泊数入力', value: '2' },
      { name: 'head-count', label: '人数入力', value: '2' },
      { name: 'username', label: '氏名入力', value: 'テスト太郎' }
    ];

    inputFields.forEach(field => {
      diverseSteps.push({
        label: `${field.label}（セレクタ多様化）`,
        action: "evaluate",
        target: `
          // 複数セレクタでのフォールバック
          const selectors = [
            '[name="${field.name}"]',
            '#${field.name}',
            'input[id="${field.name}"]',
            'input.form-control[name="${field.name}"]'
          ];
          
          let element = null;
          for (const selector of selectors) {
            element = document.querySelector(selector);
            if (element && element.offsetParent !== null) break;
          }
          
          if (element) {
            element.focus();
            element.value = '${field.value}';
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
          return false;
        `,
        retry_strategy: "3回リトライ、間隔500ms"
      });
    });

    return diverseSteps;
  }

  /**
   * イベント駆動型ステップの生成
   */
  generateEventDrivenSteps(originalRoute) {
    const eventSteps = [];

    eventSteps.push({
      label: "対象ページにアクセス",
      action: "load", 
      target: "https://hotel-example-site.takeyaqa.dev/ja/reserve.html?plan-id=0",
      timeout: 10000
    });

    // フォーカス管理を重視した操作
    eventSteps.push({
      label: "ページ全体の読み込み完了を待機",
      action: "waitForLoadState",
      target: "networkidle",
      timeout: 15000
    });

    eventSteps.push({
      label: "フォーム要素の可視化確認",
      action: "waitForSelector",
      target: "form.needs-validation",
      timeout: 10000
    });

    // 自然なユーザー操作の模倣
    const naturalFlow = [
      {
        field: "date",
        label: "宿泊日選択（自然な操作）",
        action: "evaluate", 
        target: `
          const dateInput = document.querySelector('[name="date"]');
          dateInput.focus();
          await new Promise(r => setTimeout(r, 100));
          dateInput.value = '2025/07/25';
          dateInput.dispatchEvent(new Event('change', { bubbles: true }));
          dateInput.blur();
        `
      },
      {
        field: "term",
        label: "宿泊数入力（段階的入力）", 
        action: "evaluate",
        target: `
          const termInput = document.querySelector('[name="term"]');
          termInput.focus();
          termInput.value = '';
          await new Promise(r => setTimeout(r, 50));
          termInput.value = '2';
          termInput.dispatchEvent(new Event('input', { bubbles: true }));
          termInput.dispatchEvent(new Event('change', { bubbles: true }));
        `
      }
    ];

    naturalFlow.forEach(step => {
      eventSteps.push({
        label: step.label,
        action: step.action,
        target: step.target,
        timeout: 5000,
        retry_strategy: "失敗時は100ms待機してリトライ"
      });
    });

    return eventSteps;
  }

  /**
   * JavaScript直接実行ステップの生成
   */
  generateJavaScriptDirectSteps(originalRoute) {
    const jsSteps = [];

    jsSteps.push({
      label: "対象ページにアクセス",
      action: "load",
      target: "https://hotel-example-site.takeyaqa.dev/ja/reserve.html?plan-id=0", 
      timeout: 10000
    });

    jsSteps.push({
      label: "フォーム一括入力（JavaScript直接実行）",
      action: "evaluate",
      target: `
        // フォームデータを一括設定
        const formData = {
          'date': '2025/07/25',
          'term': '2',
          'head-count': '2', 
          'username': 'テスト太郎',
          'comment': 'テスト用コメント'
        };

        let successCount = 0;
        for (const [name, value] of Object.entries(formData)) {
          const element = document.querySelector(\`[name="\${name}"]\`);
          if (element) {
            // 直接値設定
            element.value = value;
            
            // 必要なイベントを発火
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            element.dispatchEvent(new Event('blur', { bubbles: true }));
            
            successCount++;
          }
        }

        return { success: successCount, total: Object.keys(formData).length };
      `,
      timeout: 5000
    });

    jsSteps.push({
      label: "チェックボックス一括操作（DOM直接）",
      action: "evaluate",
      target: `
        const checkboxes = ['breakfast', 'early-check-in', 'sightseeing'];
        let checkedCount = 0;
        
        checkboxes.forEach(name => {
          const checkbox = document.querySelector(\`[name="\${name}"]\`);
          if (checkbox) {
            checkbox.checked = true;
            checkbox.dispatchEvent(new Event('change', { bubbles: true }));
            checkedCount++;
          }
        });

        return { checked: checkedCount, total: checkboxes.length };
      `,
      timeout: 3000
    });

    jsSteps.push({
      label: "連絡方法選択とメール表示（イベント連鎖）",
      action: "evaluate",
      target: `
        const contactSelect = document.querySelector('[name="contact"]');
        if (contactSelect) {
          contactSelect.value = 'email';
          contactSelect.dispatchEvent(new Event('change', { bubbles: true }));
          
          // メール欄の表示を待機
          return new Promise((resolve) => {
            const checkEmailField = () => {
              const emailField = document.querySelector('[name="email"]');
              if (emailField && emailField.offsetParent !== null) {
                emailField.value = 'test@example.com';
                emailField.dispatchEvent(new Event('input', { bubbles: true }));
                resolve({ success: true, method: 'email_selected' });
              } else {
                setTimeout(checkEmailField, 100);
              }
            };
            checkEmailField();
          });
        }
        return { success: false, reason: 'contact_select_not_found' };
      `,
      timeout: 10000
    });

    return jsSteps;
  }

  /**
   * メイン分析処理
   */
  async analyze() {
    try {
      console.log('🔍 強化版失敗分析を開始します...');
      
      const testResult = this.getLatestTestResult();
      // testResult.urlがなければstepsから取得
      let testUrl = testResult.url;
      if (!testUrl && Array.isArray(testResult.steps)) {
        const loadStep = testResult.steps.find(s => s.action === 'load' && typeof s.target === 'string');
        if (loadStep) testUrl = loadStep.target;
      }
      const failedSteps = testResult.steps.filter(step => step.status === 'failed');
      
      if (failedSteps.length === 0) {
        console.log('✅ 失敗したステップはありません');
        return;
      }

      console.log(`📊 失敗したステップ数: ${failedSteps.length}`);
      
      const analyses = [];
      const fixedRoutes = [];
      const aiGeneratedRoutes = [];
      
      for (const step of failedSteps) {
        console.log(`\n🔍 ステップ分析中: ${step.label}`);
        const analysis = await this.analyzeFailurePattern(step, testUrl, testResult.steps);
        analyses.push(analysis);

        // 依存関係修正の適用
        if (analysis.dependencyFix) {
          console.log(`\n🔧 依存関係修正を検出: ${analysis.dependencyFix.message}`);
          
          // 元のルート情報を取得（テスト結果から推測）
          const originalRoute = {
            route_id: testResult.route_id || 'unknown_route',
            steps: testResult.steps.map(s => ({
              label: s.label,
              action: s.action,
              target: s.target,
              value: s.value
            }))
          };

          // ルートを修正
          const fixedRoute = this.fixTestRoute(originalRoute, analysis.dependencyFix);
          
          if (fixedRoute) {
            // 🔄 強化版重複チェックを実行
            const duplicateCheck = this.checkForDuplicateRoutes(originalRoute, fixedRoute);
            
            if (duplicateCheck.isDuplicate) {
              console.log(`\n⚠️  実質的重複を検出: ${duplicateCheck.message}`);
              console.log(`🎯 推奨アクション: ${duplicateCheck.recommendAction}`);
              
              // 📊 重複レベルに応じた対応
              if (duplicateCheck.recommendAction === 'skip_and_generate_alternative') {
                console.log(`🚀 完全重複のため、未実施テスト方法を生成します...`);
                
                const currentState = await this.getPageState();
                const untestedApproaches = await this.generateUntestedApproaches(
                  originalRoute, 
                  this.failurePatterns, 
                  currentState
                );
                
                if (untestedApproaches && untestedApproaches.length > 0) {
                  console.log(`✅ ${untestedApproaches.length}種類の未実施アプローチを生成しました`);
                  
                  // 最も成功率の高いアプローチを選択
                  const bestApproach = untestedApproaches.sort((a, b) => 
                    parseFloat(b.expected_success_rate) - parseFloat(a.expected_success_rate)
                  )[0];
                  
                  const innovativeRoute = {
                    ...originalRoute,
                    scenario_id: `scenario_untested_${bestApproach.approach_id}_${Date.now()}`,
                    route_id: `untested_${bestApproach.approach_id}_${Date.now()}`, // 🔄 後方互換性のために保持
                    approach_name: bestApproach.approach_name,
                    strategy: bestApproach.strategy,
                    expected_success_rate: bestApproach.expected_success_rate,
                    unique_points: bestApproach.unique_points,
                    risk_level: bestApproach.risk_level,
                    steps: bestApproach.steps,
                    generated_by: 'untested_approach_generator',
                    fix_timestamp: new Date().toISOString()
                  };
                  
                  const innovativeRouteFile = this.saveFixedRoute(innovativeRoute);
                  fixedRoutes.push(innovativeRouteFile);
                  
                  console.log(`🎯 最適アプローチ「${bestApproach.approach_name}」を適用`);
                  console.log(`📈 期待成功率: ${bestApproach.expected_success_rate}`);
                  console.log(`🔒 リスクレベル: ${bestApproach.risk_level}`);
                  
                  // 他のアプローチも保存
                  untestedApproaches.slice(1).forEach((approach, index) => {
                    const alternativeRoute = {
                      ...originalRoute,
                      scenario_id: `scenario_alternative_${approach.approach_id}_${Date.now()}_${index}`,
                      route_id: `alternative_${approach.approach_id}_${Date.now()}_${index}`, // 🔄 後方互換性のために保持
                      approach_name: approach.approach_name,
                      strategy: approach.strategy,
                      steps: approach.steps,
                      generated_by: 'alternative_untested_approach',
                      fix_timestamp: new Date().toISOString()
                    };
                    
                    const altRouteFile = this.saveFixedRoute(alternativeRoute);
                    fixedRoutes.push(altRouteFile);
                    console.log(`💡 代替案「${approach.approach_name}」も生成済み`);
                  });
                  
                } else {
                  console.log(`❌ 未実施アプローチの生成に失敗。従来修正を適用します。`);
                  const fixedRouteFile = this.saveFixedRoute(fixedRoute);
                  fixedRoutes.push(fixedRouteFile);
                }
                
              } else if (duplicateCheck.recommendAction === 'enhance_or_alternative') {
                console.log(`🔧 微小変更のため、強化版修正を適用します...`);
                
                // 価値スコアが低い場合は代替アプローチも生成
                if (duplicateCheck.analysis.valueScore < 3) {
                  console.log(`💡 価値スコア${duplicateCheck.analysis.valueScore}/10のため、代替案も生成します`);
                  
                  const currentState = await this.getPageState();
                  const alternativeApproach = await this.generateAlternativeTestApproach(
                    originalRoute, 
                    this.failurePatterns, 
                    currentState
                  );
                  
                  if (alternativeApproach) {
                    const enhancedRoute = {
                      ...originalRoute,
                      scenario_id: `scenario_enhanced_${Date.now()}`,
                      route_id: `enhanced_${Date.now()}`, // 🔄 後方互換性のために保持
                      approach_name: alternativeApproach.approach_name,
                      strategy_change: alternativeApproach.strategy_change,
                      expected_improvement: alternativeApproach.expected_improvement,
                      steps: alternativeApproach.new_steps,
                      generated_by: 'enhanced_alternative',
                      fix_timestamp: new Date().toISOString()
                    };
                    
                    const enhancedRouteFile = this.saveFixedRoute(enhancedRoute);
                    fixedRoutes.push(enhancedRouteFile);
                    console.log(`✅ 強化版「${alternativeApproach.approach_name}」を生成`);
                  }
                }
                
                // 元の修正も保存
                const fixedRouteFile = this.saveFixedRoute(fixedRoute);
                fixedRoutes.push(fixedRouteFile);
                
              } else {
                console.log(`🤖 革新的アプローチを生成します...`);
                
                const currentState = await this.getPageState();
                const alternativeApproach = await this.generateAlternativeTestApproach(
                  originalRoute, 
                  this.failurePatterns, 
                  currentState
                );
                
                if (alternativeApproach) {
                  const innovativeRoute = {
                    ...originalRoute,
                    scenario_id: `scenario_innovative_${Date.now()}`,
                    route_id: `innovative_${Date.now()}`, // 🔄 後方互換性のために保持
                    approach_name: alternativeApproach.approach_name,
                    strategy_change: alternativeApproach.strategy_change,
                    expected_improvement: alternativeApproach.expected_improvement,
                    steps: alternativeApproach.new_steps,
                    generated_by: 'AI_innovative_approach',
                    fix_timestamp: new Date().toISOString()
                  };
                  
                  const innovativeRouteFile = this.saveFixedRoute(innovativeRoute);
                  fixedRoutes.push(innovativeRouteFile);
                  
                  console.log(`✅ 革新的アプローチ「${alternativeApproach.approach_name}」を生成`);
                  console.log(`📈 期待効果: ${alternativeApproach.expected_improvement}`);
                } else {
                  console.log(`❌ 革新的アプローチの生成に失敗。従来修正を適用します。`);
                  const fixedRouteFile = this.saveFixedRoute(fixedRoute);
                  fixedRoutes.push(fixedRouteFile);
                }
              }
              
            } else {
              console.log(`✅ 価値ある修正ルートを適用 (類似度: ${(duplicateCheck.similarity * 100).toFixed(1)}%, 価値: ${duplicateCheck.analysis?.valueScore || 'N/A'}/10)`);
              const fixedRouteFile = this.saveFixedRoute(fixedRoute);
              fixedRoutes.push(fixedRouteFile);
            }
          }
        }

        // 🛠️ 簡単な修正のチェック（NEW）
        const simpleFix = this.checkForSimpleFixes(step);
        if (simpleFix && simpleFix.isSimpleFix) {
          console.log(`\n🔧 簡単な修正を適用: ${simpleFix.message}`);
          
          if (!simpleFix.shouldSkip) {
            // 修正されたステップでルートを生成
            const originalRoute = {
              route_id: testResult.route_id || 'unknown_route',
              steps: testResult.steps.map(s => ({
                label: s.label,
                action: s.action,
                target: s.target,
                value: s.value
              }))
            };

            // 該当ステップを修正されたものに置き換え
            const quickFixedRoute = {
              ...originalRoute,
              scenario_id: `scenario_quick_fix_${Date.now()}`,
              route_id: `quick_fix_${Date.now()}`, // 🔄 後方互換性のために保持
              steps: originalRoute.steps.map(s => 
                s.label === step.label ? simpleFix.fixedStep : s
              ),
              fix_type: 'quick_fix',
              fix_reason: simpleFix.message,
              fix_timestamp: new Date().toISOString()
            };

            const quickFixedRouteFile = this.saveFixedRoute(quickFixedRoute);
            fixedRoutes.push(quickFixedRouteFile);
            console.log(`✅ 簡単修正ルートを生成: ${path.basename(quickFixedRouteFile)}`);
          } else {
            console.log(`⏭️  ステップをスキップ: ${step.label}`);
          }
        }

        // AI生成テストケースの適用
        if (analysis.newTestCases && analysis.newTestCases.testCases.length > 0) {
          console.log(`\n🤖 AI生成テストケースを検出: ${analysis.newTestCases.testCases.length}件`);
          const aiRouteFile = await this.generateAndApplyNewTestCases(analysis);
          if (aiRouteFile) {
            aiGeneratedRoutes.push(aiRouteFile);
          }
        }
      }

      // 分析結果を保存
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const analysisFile = path.join(process.cwd(), 'test-results', `enhanced_analysis_${timestamp}.json`);
      
      fs.writeFileSync(analysisFile, JSON.stringify({
        originalTestResult: testResult.route_id,
        analyses,
        fixedRoutes,
        aiGeneratedRoutes,
        summary: {
          totalFailures: failedSteps.length,
          errorTypes: analyses.map(a => a.errorType),
          newTestCasesGenerated: analyses.reduce((sum, a) => sum + (a.newTestCases?.testCases?.length || 0), 0),
          fixedRoutesCount: fixedRoutes.length,
          aiGeneratedRoutesCount: aiGeneratedRoutes.length
        }
      }, null, 2));

      console.log(`\n🎉 強化版失敗分析が完了しました`);
      console.log(`📁 分析結果: ${analysisFile}`);
      console.log(`📊 生成されたテストケース数: ${analyses.reduce((sum, a) => sum + (a.newTestCases?.testCases?.length || 0), 0)}`);
      console.log(`🔧 修正されたルート数: ${fixedRoutes.length}`);
      console.log(`🤖 AI生成ルート数: ${aiGeneratedRoutes.length}`);
      
      // 修正されたルートの実行提案
      if (fixedRoutes.length > 0) {
        console.log(`\n🚀 修正されたルートを実行するには:`);
        fixedRoutes.forEach(routeFile => {
          console.log(`   node tests/runScenarios.js --route-file ${path.basename(routeFile)}`);
        });
      }

      // AI生成ルートの実行提案
      if (aiGeneratedRoutes.length > 0) {
        console.log(`\n🤖 AI生成シナリオを実行するには:`);
        aiGeneratedRoutes.forEach(routeFile => {
          console.log(`   node tests/runScenarios.js --route-file ${path.basename(routeFile)}`);
        });
      }
      
      return {
        analyses,
        fixedRoutes,
        aiGeneratedRoutes
      };
      
    } catch (error) {
      console.error('❌ 強化版失敗分析でエラーが発生しました:', error);
      throw error;
    } finally {
      await this.close();
    }
  }
}

// CLI実行
async function main() {
  try {
    // 簡単な引数解析
    const args = {};
    for (let i = 2; i < process.argv.length; i++) {
      const arg = process.argv[i];
      if (arg.startsWith('--')) {
        const key = arg.substring(2);
        if (i + 1 < process.argv.length && !process.argv[i + 1].startsWith('--')) {
          args[key] = process.argv[i + 1];
          i++;
        } else {
          args[key] = true;
        }
      }
    }
    
    const analyzer = new EnhancedFailureAnalyzer({
      userStory: args.userStory,
      targetUrl: args.url,
      specPdf: args.specPdf,
      testCsv: args.testCsv
    });

    await analyzer.analyze();
  } catch (error) {
    console.error('❌ エラーが発生しました:', error.message);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export default EnhancedFailureAnalyzer;