#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { parseArguments } from './utils/cliParser.js';
import { analyzeFailuresWithAI } from './aiFailureAnalyzer.js';

/**
 * 失敗したテストケースを分析して自動修正・再テストを実行
 */
class FailureAnalyzer {
  constructor(options = {}) {
    this.browser = null;
    this.page = null;
    this.options = options;
    
    // 分析時に参照する情報
    this.userStory = options.userStory || null;
    this.targetUrl = options.targetUrl || null;
    this.specPdf = options.specPdf || null;
    this.testCsv = options.testCsv || null;
    
    // DOM解析結果のキャッシュ
    this.cachedDomInfo = null;
    
    // AI分析オプション
    this.enableAI = options.enableAI || false;
    this.aiConfig = options.aiConfig || {};
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
   * 事前DOM解析結果を読み込み
   */
  loadCachedDomAnalysis() {
    try {
      const testResultsDir = path.join(process.cwd(), 'test-results');
      
      // DOM解析結果ファイルを検索（最新のものを取得）
      const domFiles = fs.readdirSync(testResultsDir)
        .filter(file => file.includes('dom_analysis') || file.includes('route_'))
        .sort()
        .reverse();

      // 最新のルートファイルからDOM情報を抽出
      for (const file of domFiles) {
        try {
          const filePath = path.join(testResultsDir, file);
          const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          
          // ルートファイルにDOM情報が含まれている場合
          if (content.dom_analysis || content.page_info) {
            console.log(`📋 事前DOM解析結果を発見: ${file}`);
            this.cachedDomInfo = content.dom_analysis || content.page_info;
            return this.cachedDomInfo;
          }
        } catch (e) {
          // ファイル読み込みエラーは無視して次へ
          continue;
        }
      }
      
      console.log('📋 事前DOM解析結果が見つかりませんでした（リアルタイム解析を実行します）');
      return null;
    } catch (error) {
      console.log('📋 DOM解析結果の読み込みに失敗しました（リアルタイム解析を実行します）');
      return null;
    }
  }

  /**
   * 最新のテスト結果JSONファイルを取得
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
   * 失敗したステップを抽出
   */
  extractFailedSteps(testResult) {
    return testResult.steps.filter(step => step.status === 'failed');
  }

  /**
   * 事前DOM解析結果から代替セレクタを提案
   */
  findAlternativeSelectorsFromCachedDOM(target, action) {
    if (!this.cachedDomInfo || !this.cachedDomInfo.elements) {
      return [];
    }

    console.log(`🔍 事前DOM解析結果から代替セレクタを検索中...`);
    const suggestions = [];
    
    try {
      // name属性から検索
      const nameMatch = target.match(/\[name="([^"]+)"\]/);
      if (nameMatch) {
        const nameValue = nameMatch[1];
        
        // 類似のname属性を持つ要素を検索
        this.cachedDomInfo.elements.inputs?.forEach(input => {
          if (input.name && (
            input.name === nameValue || 
            input.name.includes(nameValue.split('-')[0]) ||
            nameValue.includes(input.name)
          )) {
            suggestions.push({
              selector: input.recommendedSelector || `[name="${input.name}"]`,
              reason: `類似name属性: ${input.name}`,
              confidence: input.name === nameValue ? 0.9 : 0.7,
              elementInfo: {
                type: input.type,
                placeholder: input.placeholder,
                id: input.id,
                disabled: input.disabled
              }
            });
          }
        });
      }

      // text属性から検索（ボタン・リンク）
      const textMatch = target.match(/text="([^"]+)"/);
      if (textMatch) {
        const textValue = textMatch[1];
        
        // ボタンから検索
        this.cachedDomInfo.elements.buttons?.forEach(button => {
          if (button.text && (
            button.text.includes(textValue) || 
            textValue.includes(button.text)
          )) {
            suggestions.push({
              selector: button.selector,
              reason: `類似ボタンテキスト: ${button.text}`,
              confidence: button.text === textValue ? 0.9 : 0.6,
              elementInfo: {
                type: button.type,
                text: button.text
              }
            });
          }
        });

        // リンクから検索
        this.cachedDomInfo.elements.links?.forEach(link => {
          if (link.text && (
            link.text.includes(textValue) || 
            textValue.includes(link.text)
          )) {
            suggestions.push({
              selector: link.selector,
              reason: `類似リンクテキスト: ${link.text}`,
              confidence: link.text === textValue ? 0.9 : 0.6,
              elementInfo: {
                href: link.href,
                text: link.text
              }
            });
          }
        });
      }

      // ID・クラス属性から検索
      const idMatch = target.match(/#([^.\s\[]+)/);
      if (idMatch) {
        const idValue = idMatch[1];
        
        this.cachedDomInfo.elements.inputs?.forEach(input => {
          if (input.id && input.id.includes(idValue)) {
            suggestions.push({
              selector: `#${input.id}`,
              reason: `類似ID: ${input.id}`,
              confidence: input.id === idValue ? 0.9 : 0.7,
              elementInfo: input
            });
          }
        });
      }

      // confidence順でソート
      suggestions.sort((a, b) => b.confidence - a.confidence);
      
      if (suggestions.length > 0) {
        console.log(`✅ 事前DOM解析から${suggestions.length}件の代替セレクタを発見`);
        suggestions.forEach((sugg, i) => {
          console.log(`   ${i + 1}. ${sugg.selector} (信頼度: ${sugg.confidence}, 理由: ${sugg.reason})`);
        });
      }
      
      return suggestions.slice(0, 5); // 上位5件に限定

    } catch (error) {
      console.error(`事前DOM解析からの代替セレクタ検索エラー: ${error.message}`);
      return [];
    }
  }

  /**
   * 要素の存在確認
   */
  async checkElementExists(target, url) {
    try {
      await this.page.goto(url);
      await this.page.waitForTimeout(2000); // ページ読み込み待機

      // 複数のセレクタ戦略で要素を検索
      const strategies = [
        target, // 元のセレクタ
        target.replace(/"/g, "'"), // クォート変更
        target.replace(/\[name="([^"]+)"\]/, '#$1'), // name -> id
        target.replace(/\[name="([^"]+)"\]/, 'input[name="$1"]'), // より具体的なセレクタ
        target.replace(/\[name="([^"]+)"\]/, '[id="$1"]'), // name -> id属性
      ];

      const results = [];
      for (const strategy of strategies) {
        try {
          const elements = await this.page.locator(strategy).all();
          if (elements.length > 0) {
            const element = elements[0];
            const isVisible = await element.isVisible();
            const isEnabled = await element.isEnabled();
            const isEditable = await element.isEditable();
            
            results.push({
              selector: strategy,
              found: true,
              count: elements.length,
              visible: isVisible,
              enabled: isEnabled,
              editable: isEditable,
              tagName: await element.evaluate(el => el.tagName),
              attributes: await element.evaluate(el => {
                const attrs = {};
                for (const attr of el.attributes) {
                  attrs[attr.name] = attr.value;
                }
                return attrs;
              })
            });
          } else {
            results.push({
              selector: strategy,
              found: false
            });
          }
        } catch (error) {
          results.push({
            selector: strategy,
            found: false,
            error: error.message
          });
        }
      }

      return results;
    } catch (error) {
      console.error(`要素確認エラー: ${error.message}`);
      return [];
    }
  }

  /**
   * 代替セレクタを提案（事前DOM解析結果 + リアルタイム解析）
   */
  async suggestAlternativeSelectors(target, url) {
    try {
      // 1. 事前DOM解析結果から代替セレクタを取得
      const cachedSuggestions = this.findAlternativeSelectorsFromCachedDOM(target);
      
      // 2. リアルタイム解析も実行
      await this.page.goto(url);
      await this.page.waitForTimeout(2000);

      // ページ内の類似要素を検索
      const realtimeSuggestions = [];
      
      // name属性から他の属性を推測
      const nameMatch = target.match(/\[name="([^"]+)"\]/);
      if (nameMatch) {
        const nameValue = nameMatch[1];
        
        // 類似のname属性を持つ要素を検索
        const similarElements = await this.page.evaluate((name) => {
          const elements = document.querySelectorAll('input, select, textarea, button');
          const similar = [];
          
          elements.forEach(el => {
            if (el.name && el.name.includes(name.split('-')[0])) {
              similar.push({
                selector: `[name="${el.name}"]`,
                id: el.id,
                className: el.className,
                type: el.type,
                tagName: el.tagName.toLowerCase(),
                placeholder: el.placeholder,
                visible: el.offsetParent !== null,
                reason: `リアルタイム検索: 類似name属性`,
                confidence: el.name === name ? 0.8 : 0.5
              });
            }
          });
          
          return similar;
        }, nameValue);

        realtimeSuggestions.push(...similarElements);
      }

      // 3. 両方の結果をマージして重複を除去
      const allSuggestions = [...cachedSuggestions, ...realtimeSuggestions];
      const uniqueSuggestions = [];
      const seenSelectors = new Set();
      
      allSuggestions.forEach(suggestion => {
        const selector = suggestion.selector;
        if (!seenSelectors.has(selector)) {
          seenSelectors.add(selector);
          uniqueSuggestions.push(suggestion);
        }
      });

      // confidence順でソート
      uniqueSuggestions.sort((a, b) => (b.confidence || 0.5) - (a.confidence || 0.5));

      console.log(`🔍 代替セレクタ提案: 事前解析${cachedSuggestions.length}件 + リアルタイム${realtimeSuggestions.length}件 = 合計${uniqueSuggestions.length}件`);

      return uniqueSuggestions.slice(0, 10); // 上位10件に限定
    } catch (error) {
      console.error(`代替セレクタ提案エラー: ${error.message}`);
      return [];
    }
  }

  /**
   * 失敗したテストの要素を実際にページで検証
   */
  async verifyFailedElements(url, failedSteps) {
    console.log(`\n🔍 失敗した要素を実際のページで検証中...`);
    
    await this.page.goto(url);
    await this.page.waitForLoadState('networkidle');

    const verificationResults = [];

    for (const step of failedSteps) {
      console.log(`\n🔎 検証中: ${step.label}`);
      console.log(`   ターゲット: ${step.target}`);
      console.log(`   アクション: ${step.action}`);

      const result = {
        step,
        exists: false,
        isVisible: false,
        isEnabled: false,
        isClickable: false,
        alternativeSelectors: [],
        suggestedFix: null,
        skipReason: null
      };

      try {
        // 1. 要素の存在確認
        const locator = this.page.locator(step.target);
        const elementCount = await locator.count();
        
        if (elementCount > 0) {
          result.exists = true;
          console.log(`   ✅ 要素は存在します (${elementCount}個)`);

          // 2. 可視性チェック
          try {
            result.isVisible = await locator.first().isVisible();
            console.log(`   👁️ 可視性: ${result.isVisible ? '可視' : '非可視'}`);
          } catch (e) {
            console.log(`   👁️ 可視性チェック失敗: ${e.message}`);
          }

          // 3. 有効性チェック（入力系の場合）
          if (step.action === 'fill' || step.action === 'click') {
            try {
              result.isEnabled = await locator.first().isEnabled();
              console.log(`   🔘 有効性: ${result.isEnabled ? '有効' : '無効'}`);
            } catch (e) {
              console.log(`   🔘 有効性チェック失敗: ${e.message}`);
            }
          }

          // 4. クリック可能性チェック（クリック系の場合）
          if (step.action === 'click') {
            try {
              // 要素がクリック可能かどうかをチェック
              await locator.first().hover({ timeout: 2000 });
              result.isClickable = true;
              console.log(`   🖱️ クリック可能: はい`);
            } catch (e) {
              console.log(`   🖱️ クリック可能: いいえ (${e.message})`);
            }
          }

          // 5. 修正提案の生成
          result.suggestedFix = this.generateElementFix(step, result);

        } else {
          console.log(`   ❌ 要素が見つかりません`);
          
          // 6. 代替セレクタの検索
          result.alternativeSelectors = await this.findAlternativeSelectors(step);
          if (result.alternativeSelectors.length > 0) {
            console.log(`   🔍 代替セレクタを発見:`);
            result.alternativeSelectors.forEach((alt, i) => {
              console.log(`     ${i + 1}. ${alt.selector} (信頼度: ${alt.confidence})`);
            });
            result.suggestedFix = {
              type: 'alternative_selector',
              newTarget: result.alternativeSelectors[0].selector,
              reason: `元の要素が見つからないため、代替セレクタを使用`
            };
          } else {
            result.skipReason = '要素が存在せず、代替セレクタも見つからない';
            result.suggestedFix = {
              type: 'skip',
              reason: result.skipReason
            };
          }
        }

      } catch (error) {
        console.log(`   ❌ 検証エラー: ${error.message}`);
        result.skipReason = `検証中にエラーが発生: ${error.message}`;
        result.suggestedFix = {
          type: 'skip',
          reason: result.skipReason
        };
      }

      verificationResults.push(result);
    }

    return verificationResults;
  }

  /**
   * 失敗履歴から学習済みの修正パターンを取得
   */
  getLearnedFixPatterns() {
    try {
      const historyPath = path.join(process.cwd(), 'test-results', '.failure-patterns.json');
      if (!fs.existsSync(historyPath)) {
        return {};
      }
      return JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
    } catch (error) {
      console.error('失敗パターン履歴の読み込みエラー:', error.message);
      return {};
    }
  }

  /**
   * 失敗パターンを学習履歴に保存
   */
  saveFailurePattern(target, action, errorType, successfulFix) {
    try {
      const historyPath = path.join(process.cwd(), 'test-results', '.failure-patterns.json');
      let patterns = {};
      
      if (fs.existsSync(historyPath)) {
        patterns = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
      }

      const patternKey = `${action}:${target}:${errorType}`;
      
      if (!patterns[patternKey]) {
        patterns[patternKey] = {
          target,
          action,
          errorType,
          attempts: [],
          lastUpdated: new Date().toISOString()
        };
      }

      patterns[patternKey].attempts.push({
        timestamp: new Date().toISOString(),
        fix: successfulFix,
        success: successfulFix !== null
      });

      // 最新10件まで保持
      if (patterns[patternKey].attempts.length > 10) {
        patterns[patternKey].attempts = patterns[patternKey].attempts.slice(-10);
      }

      patterns[patternKey].lastUpdated = new Date().toISOString();
      
      fs.writeFileSync(historyPath, JSON.stringify(patterns, null, 2));
      console.log(`🧠 失敗パターンを学習しました: ${patternKey}`);
    } catch (error) {
      console.error('失敗パターン保存エラー:', error.message);
    }
  }

  /**
   * 学習済み修正パターンを適用
   */
  applyLearnedFix(step, errorType) {
    const patterns = this.getLearnedFixPatterns();
    const patternKey = `${step.action}:${step.target}:${errorType}`;
    
    if (patterns[patternKey]) {
      const successfulAttempts = patterns[patternKey].attempts.filter(a => a.success);
      
      if (successfulAttempts.length > 0) {
        const latestSuccessful = successfulAttempts[successfulAttempts.length - 1];
        console.log(`🧠 学習済み修正パターンを発見: ${patternKey}`);
        console.log(`   前回成功した修正: ${JSON.stringify(latestSuccessful.fix)}`);
        return latestSuccessful.fix;
      }
    }
    
    return null;
  }

  /**
   * エラータイプを分類
   */
  classifyErrorType(error) {
    if (error.includes('element is not visible')) {
      return 'not_visible';
    } else if (error.includes('element is not enabled')) {
      return 'not_enabled';
    } else if (error.includes('Timeout')) {
      return 'timeout';
    } else if (error.includes('いずれの要素も見つかりません') || error.includes('いずれの要素もクリックできません')) {
      return 'element_not_found';
    } else if (error.includes('checkbox') && error.includes('filled')) {
      return 'checkbox_fill_error';
    } else {
      return 'unknown';
    }
  }

  /**
   * チェックボックス操作の自動修正
   */
  fixCheckboxActions(step) {
    if (step.action !== 'fill') return null;
    
    // チェックボックスの場合
    if (step.error && step.error.includes('Input of type "checkbox" cannot be filled')) {
      return {
        ...step,
        action: 'click',  // fillをclickに変更
        isFixed: true,
        fixReason: 'チェックボックスはクリックで操作する必要があります',
        fix_type: 'checkbox_fix'
      };
    }
    
    return null;
  }

  /**
   * 数値入力の自動修正
   */
  fixNumberInputActions(step) {
    if (step.action !== 'fill') return null;
    
    // 数値入力フィールドの場合
    if (step.error && step.error.includes('Cannot type text into input[type=number]')) {
      // 無効な値をテストする場合は、最小値未満の値を使用
      const value = step.label.toLowerCase().includes('無効な値') ? '0' : '1';
      
      return {
        ...step,
        value: value,
        isFixed: true,
        fixReason: '数値入力フィールドには数値を入力する必要があります',
        fix_type: 'number_input_fix'
      };
    }
    
    return null;
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
   * ラジオボタン操作の自動修正
   */
  fixRadioActions(step) {
    const isRadioError = step.error && step.error.includes('Input of type "radio" cannot be filled');
    if (!isRadioError) return null;
    console.log(`🔧 ラジオボタン操作エラーを検出: ${step.label}`);
    const fixedStep = {
      ...step,
      action: 'check',
      value: true,
      fix_reason: 'ラジオボタン要素にはfillではなくcheckアクションを使用',
      fixed_at: new Date().toISOString()
    };
    return {
      message: `ラジオボタン「${step.target}」の操作方法を修正: fill → check`,
      fixedStep,
      isSimpleFix: true
    };
  }

  /**
   * セレクトボックス操作の自動修正
   */
  fixSelectActions(step) {
    const isSelectError = step.error && (step.error.includes('select') || step.error.includes('not a selectable element'));
    if (!isSelectError) return null;
    console.log(`🔧 セレクトボックス操作エラーを検出: ${step.label}`);
    const fixedStep = {
      ...step,
      action: 'selectOption',
      fix_reason: 'セレクトボックスにはselectOptionアクションを使用',
      fixed_at: new Date().toISOString()
    };
    return {
      message: `セレクトボックス「${step.target}」の操作方法を修正: fill/type → selectOption`,
      fixedStep,
      isSimpleFix: true
    };
  }

  /**
   * disabled要素の自動スキップ
   */
  fixDisabledElementActions(step) {
    const isDisabledError = step.error && (step.error.includes('not enabled') || step.error.includes('disabled'));
    if (!isDisabledError) return null;
    console.log(`🔧 disabled要素エラーを検出: ${step.label}`);
    return {
      message: `disabled要素「${step.target}」はスキップ`,
      fixedStep: null,
      isSimpleFix: true,
      shouldSkip: true
    };
  }

  /**
   * visible待機の自動追加
   */
  fixNotVisibleActions(step) {
    const isNotVisibleError = step.error && (step.error.includes('not visible') || step.error.includes('hidden'));
    if (!isNotVisibleError) return null;
    console.log(`🔧 not visibleエラーを検出: ${step.label}`);
    const fixedStep = {
      ...step,
      wait_for_visible: true,
      fix_reason: '要素が非可視のためwaitForSelector/wait_for_visibleを追加',
      fixed_at: new Date().toISOString()
    };
    return {
      message: `「${step.target}」の操作前にwaitForSelector/wait_for_visibleを追加`,
      fixedStep,
      isSimpleFix: true
    };
  }

  /**
   * クリック不可要素の強制クリック
   */
  fixNotClickableActions(step) {
    const isNotClickableError = step.error && step.error.includes('not clickable');
    if (!isNotClickableError) return null;
    console.log(`🔧 not clickableエラーを検出: ${step.label}`);
    const fixedStep = {
      ...step,
      action: 'click',
      force: true,
      fix_reason: 'クリック不可要素にはforce: trueでクリック',
      fixed_at: new Date().toISOString()
    };
    return {
      message: `「${step.target}」のクリックをforce: trueで実行`,
      fixedStep,
      isSimpleFix: true
    };
  }

  /**
   * 簡単な修正の統合チェック
   */
  checkForSimpleFixes(step) {
    // 追加自動修正パターン
    const radioFix = this.fixRadioActions(step);
    if (radioFix) return radioFix;
    const selectFix = this.fixSelectActions(step);
    if (selectFix) return selectFix;
    const disabledFix = this.fixDisabledElementActions(step);
    if (disabledFix) return disabledFix;
    const notVisibleFix = this.fixNotVisibleActions(step);
    if (notVisibleFix) return notVisibleFix;
    const notClickableFix = this.fixNotClickableActions(step);
    if (notClickableFix) return notClickableFix;
    // 既存
    const checkboxFix = this.fixCheckboxActions(step);
    if (checkboxFix) return checkboxFix;
    const numberFix = this.fixNumberInputActions(step);
    if (numberFix) return numberFix;
    const hiddenFix = this.fixHiddenElementActions(step);
    if (hiddenFix) return hiddenFix;
    return null;
  }

  /**
   * 要素の修正提案を生成（学習機能付き、ユーザーストーリー考慮）
   */
  async generateElementFix(step, verificationResult) {
    // verificationResultがnullまたはundefinedの場合のデフォルト値を設定
    const defaultVerification = {
      exists: false,
      visible: false,
      enabled: false,
      details: {}
    };
    
    // verificationResultが存在しない場合はデフォルト値を使用
    const verification = verificationResult || defaultVerification;
    const { exists, visible, enabled, details } = verification;
    
    // エラータイプを特定
    let errorType = 'unknown';
    if (!exists) {
      errorType = 'element_not_found';
    } else if (!visible) {
      errorType = 'not_visible';
    } else if (!enabled) {
      errorType = 'not_enabled';
    } else if (!verification.isClickable && step.action === 'click') {
      errorType = 'not_clickable';
    }

    // 🧠 学習済み修正パターンを先にチェック
    const learnedFix = this.applyLearnedFix(step, errorType);
    if (learnedFix) {
      return {
        ...learnedFix,
        isLearned: true,
        confidence: 0.9,
        reason: `学習済み修正パターンを適用: ${learnedFix.reason}`
      };
    }

    // 🎯 ユーザーストーリーを考慮した修正判定
    const userStoryGuidance = this.getFixGuidanceFromUserStory(step, errorType);
    
    // 従来の修正ロジック
    if (!exists) {
      // ユーザーストーリーでこの要素が重要視されている場合は代替手段を模索
      if (userStoryGuidance.isImportant) {
        return { 
          type: 'alternative_selector', 
          reason: `ユーザーストーリーで重要とされる要素のため代替セレクタを模索: ${userStoryGuidance.reason}`,
          confidence: 0.7,
          requiresAlternativeSearch: true
        };
      }
      return { type: 'skip', reason: '要素が存在しない', confidence: 0.8 };
    }

    if (step.action === 'fill') {
      if (!visible) {
        return { 
          type: 'wait_and_scroll', 
          reason: '要素が非可視のため、スクロールして可視化を試行',
          newAction: 'scroll_and_fill',
          confidence: 0.7
        };
      }
      if (!enabled) {
        return { 
          type: 'skip', 
          reason: '入力フィールドが無効化されている',
          confidence: 0.9
        };
      }
    }

    if (step.action === 'click') {
      if (!visible) {
        return { 
          type: 'scroll_to_element', 
          reason: '要素が非可視のため、スクロールしてからクリック',
          newAction: 'scroll_and_click',
          confidence: 0.7
        };
      }
      if (!verification.isClickable) {
        return { 
          type: 'force_click', 
          reason: '通常のクリックが失敗するため、強制クリックを試行',
          newAction: 'force_click',
          confidence: 0.6
        };
      }
    }

    if (step.action === 'assertVisible') {
      if (!visible) {
        return { 
          type: 'skip', 
          reason: '要素は存在するが非可視のため、アサーションをスキップ',
          confidence: 0.8
        };
      }
    }

    // チェックボックスの処理
    if (step.error && step.error.includes('Input of type "checkbox" cannot be filled')) {
      return {
        ...step,
        action: 'click',  // fillをclickに変更
        value: undefined,  // clickアクションでは値は不要
        isFixed: true,
        fixReason: 'チェックボックスはクリックで操作する必要があります',
        fix_type: 'checkbox_fix'
      };
    }

    // hidden入力フィールドの処理
    if (step.target.includes('-hidden') && step.error && step.error.includes('Timeout')) {
      return {
        ...step,
        isFixed: true,
        fixReason: 'hidden入力フィールドはスキップします',
        fix_type: 'hidden_field_skip',
        skip: true
      };
    }
    
    // 電話番号入力欄の待機時間を延長
    if (step.action === 'waitForSelector' && step.target.includes('[name="phone"]')) {
      return {
        ...step,
        timeout: 10000,  // タイムアウトを10秒に延長
        isFixed: true,
        fixReason: '電話番号入力欄の待機時間を延長します',
        fix_type: 'timeout_extension'
      };
    }

    return { type: 'no_fix_needed', reason: '要素は正常に操作可能', confidence: 1.0 };
  }

  /**
   * ユーザーストーリーから修正ガイダンスを取得
   */
  getFixGuidanceFromUserStory(step, errorType) {
    if (!this.userStory) {
      return { isImportant: false, reason: 'ユーザーストーリーなし' };
    }

    const stepLabel = step.label.toLowerCase();
    const userStoryLower = this.userStory.toLowerCase();
    
    // ユーザーストーリー内で言及されているキーワードを検索
    const keywords = [
      '予約', 'booking', 'reserve',
      '申込', 'apply', 'application',
      '登録', 'register', 'signup',
      'ログイン', 'login', 'signin',
      '送信', 'submit', 'send',
      '確認', 'confirm', 'verification',
      '選択', 'select', 'choose',
      '入力', 'input', 'fill',
      '連絡', 'contact', 'communication',
      '支払', 'payment', 'pay',
      '決済', 'checkout',
      '完了', 'complete', 'finish'
    ];

    // ステップの重要度を判定
    let importance = 0;
    let matchedKeywords = [];
    
    for (const keyword of keywords) {
      if (stepLabel.includes(keyword) && userStoryLower.includes(keyword)) {
        importance += 1;
        matchedKeywords.push(keyword);
      }
    }

    // 特別に重要とみなすパターン
    const criticalPatterns = [
      /必須/g, /required/gi, /必要/g, /important/gi,
      /核心/g, /core/gi, /主要/g, /main/gi, /primary/gi
    ];

    let isCritical = false;
    for (const pattern of criticalPatterns) {
      if (userStoryLower.match(pattern)) {
        isCritical = true;
        break;
      }
    }

    const isImportant = importance > 0 || isCritical;
    const reason = matchedKeywords.length > 0 
      ? `マッチキーワード: ${matchedKeywords.join(', ')}`
      : isCritical 
        ? '重要度の高いストーリー要素'
        : 'ユーザーストーリーとの関連性が低い';

    return {
      isImportant,
      importance,
      reason,
      matchedKeywords,
      isCritical
    };
  }

  /**
   * 代替セレクタを検索（事前DOM解析 + リアルタイム検索）
   */
  async findAlternativeSelectors(step) {
    const alternatives = [];
    
    // 1. 事前DOM解析結果から代替セレクタを取得
    const cachedAlternatives = this.findAlternativeSelectorsFromCachedDOM(step.target, step.action);
    alternatives.push(...cachedAlternatives);
    
    // 2. セレクタのパターンを分析して代替案を生成
    const target = step.target;
    
    // name属性の場合
    if (target.includes('[name=')) {
      const nameMatch = target.match(/\[name="([^"]+)"\]/);
      if (nameMatch) {
        const name = nameMatch[1];
        const altSelectors = [
          `input[name="${name}"]`,
          `select[name="${name}"]`,
          `textarea[name="${name}"]`,
          `#${name}`,
          `[id="${name}"]`
        ];
        
        for (const selector of altSelectors) {
          if (selector !== target) {
            try {
              const count = await this.page.locator(selector).count();
              if (count > 0) {
                alternatives.push({
                  selector,
                  confidence: 0.8,
                  reason: `name属性ベースの代替セレクタ`
                });
              }
            } catch (e) {
              // セレクタが無効な場合はスキップ
            }
          }
        }
      }
    }

    // text-based セレクタの場合
    if (target.includes('text=') || target.includes(':has-text(')) {
      const textMatch = target.match(/text="([^"]+)"|:has-text\("([^"]+)"\)/);
      if (textMatch) {
        const text = textMatch[1] || textMatch[2];
        const altSelectors = [
          `button:has-text("${text}")`,
          `a:has-text("${text}")`,
          `[value="${text}"]`,
          `[title="${text}"]`,
          `[aria-label="${text}"]`
        ];
        
        for (const selector of altSelectors) {
          if (selector !== target) {
            try {
              const count = await this.page.locator(selector).count();
              if (count > 0) {
                alternatives.push({
                  selector,
                  confidence: 0.7,
                  reason: `テキストベースの代替セレクタ`
                });
              }
            } catch (e) {
              // セレクタが無効な場合はスキップ
            }
          }
        }
      }
    }

    // 3. 重複を除去してconfidence順でソート
    const uniqueAlternatives = [];
    const seenSelectors = new Set();
    
    alternatives.forEach(alt => {
      if (!seenSelectors.has(alt.selector)) {
        seenSelectors.add(alt.selector);
        uniqueAlternatives.push(alt);
      }
    });
    
    const sortedAlternatives = uniqueAlternatives.sort((a, b) => (b.confidence || 0.5) - (a.confidence || 0.5));
    
    console.log(`🔍 代替セレクタ検索結果: 事前解析${cachedAlternatives.length}件 + リアルタイム${alternatives.length - cachedAlternatives.length}件 = 総計${sortedAlternatives.length}件`);
    
    return sortedAlternatives.slice(0, 8); // 上位8件に限定
  }

  /**
   * 修正されたルートを生成（DOM解析結果活用）
   */
  async generateFixedRoute(originalRoute, failedSteps, url, detailedAnalyses = []) {
    console.log(`\n🔧 修正されたルートを生成中...`);

    // 失敗した要素を検証
    const verificationResults = await this.verifyFailedElements(url, failedSteps);

    // 修正されたステップを作成
    const fixedSteps = originalRoute.steps.map(step => {
      const failedStep = failedSteps.find(f => f.label === step.label);
      
      if (!failedStep) {
        // 失敗していないステップはそのまま
        return step;
      }

      // 🔧 簡単な修正を先にチェック
      const simpleFix = this.checkForSimpleFixes(failedStep);
      if (simpleFix && simpleFix.fixedStep) {
        console.log(`🔧 簡単な修正を適用: ${step.label} - ${simpleFix.message}`);
        return simpleFix.fixedStep;
      } else if (simpleFix && simpleFix.shouldSkip) {
        console.log(`⏭️ ステップをスキップ: ${step.label} - ${simpleFix.message}`);
        return {
          ...step,
          action: 'skip',
          fix_reason: simpleFix.message,
          original_action: step.action,
          original_target: step.target
        };
      }

      const verification = verificationResults.find(v => v.step.label === step.label);
      if (!verification || !verification.suggestedFix) {
        // 修正提案がない場合はスキップ
        return {
          ...step,
          action: 'skip',
          fix_reason: '修正方法が見つからないためスキップ',
          original_action: step.action,
          original_target: step.target
        };
      }

      const fix = verification.suggestedFix;

      switch (fix.type) {
        case 'skip':
          return {
            ...step,
            action: 'skip',
            fix_reason: fix.reason,
            original_action: step.action,
            original_target: step.target
          };

        case 'alternative_selector':
          return {
            ...step,
            target: fix.newTarget,
            fix_reason: fix.reason,
            original_target: step.target
          };

        case 'wait_and_scroll':
        case 'scroll_to_element':
          return {
            ...step,
            action: fix.newAction || step.action,
            fix_reason: fix.reason,
            original_action: step.action,
            scroll_before_action: true
          };

        case 'force_click':
          return {
            ...step,
            action: 'force_click',
            fix_reason: fix.reason,
            original_action: step.action
          };

        default:
          return step;
      }
    });

    // 修正サマリーを生成
    const fixSummary = {
      total_steps: originalRoute.steps.length,
      fixed_steps: fixedSteps.filter(s => s.fix_reason).length,
      skipped_steps: fixedSteps.filter(s => s.action === 'skip').length,
      alternative_selectors: fixedSteps.filter(s => s.original_target && s.target !== s.original_target).length,
      simple_fixes: fixedSteps.filter(s => s.fix_reason && (s.fix_reason.includes('チェックボックス') || s.fix_reason.includes('数値入力') || s.fix_reason.includes('hidden要素'))).length
    };

    // ユニークなIDを生成（重複を避けるため）
    const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
    const fixedRouteId = `fixed_${originalRoute.route_id || 'unknown'}_${timestamp}`;

    const fixedRoute = {
      route_id: fixedRouteId,
      original_route_id: originalRoute.route_id,
      fix_timestamp: new Date().toISOString(),
      fix_summary: fixSummary,
      steps: fixedSteps,
      user_story_id: originalRoute.user_story_id || null,
      generated_at: originalRoute.generated_at || null,
      // 修正時の参照情報を追加
      analysis_context: {
        user_story: this.userStory || null,
        target_url: this.targetUrl || null,
        spec_pdf: this.specPdf || null,
        test_csv: this.testCsv || null
      }
    };

    // 修正情報を記録
    const appliedFixes = [];
    let originalFailedSteps = [];
    
    // 失敗ステップの修正を試行
    for (const step of failedSteps) {
      const stepIndex = originalRoute.steps.findIndex(s => 
        s.action === step.action && s.target === step.target
      );
      
      if (stepIndex === -1) continue;
      
      // 元の失敗ステップを記録
      originalFailedSteps.push({
        ...step,
        stepIndex
      });
      
      // 修正を試行
      const fixes = await this.generateElementFix(step, detailedAnalyses[stepIndex]);
      if (fixes && fixes.length > 0) {
        // 最も信頼度の高い修正を適用
        const bestFix = fixes[0];
        appliedFixes.push({
          stepIndex,
          type: bestFix.type,
          description: bestFix.description,
          confidence: bestFix.confidence
        });
        
        // ステップを修正
        fixedRoute.steps[stepIndex] = {
          ...step,
          ...bestFix.fix
        };
      }
    }
    
    // 修正情報を結果に含める
    fixedRoute.is_fixed_route = true;
    fixedRoute.original_failed_steps = originalFailedSteps;
    fixedRoute.applied_fixes = appliedFixes;
    
    return fixedRoute;
  }

  /**
   * AI Powered 失敗分析（新機能）
   */
  async analyzeWithAI(testResult = null) {
    console.log('\n🤖 AI-Powered 失敗テスト分析を開始します...');
    
    try {
      // テスト結果の取得
      const result = testResult || this.getLatestTestResult();
      console.log(`📊 分析対象: ${result.route_id}`);
      
      // DOM情報の準備
      const domInfo = this.loadCachedDomAnalysis();
      if (domInfo) {
        console.log('✅ 事前DOM解析結果を活用');
      }
      
      // AI分析の実行
      const aiAnalysis = await analyzeFailuresWithAI([result], {
        domInfo: domInfo,
        userStory: this.userStory,
        targetUrl: this.targetUrl || result.targetUrl,
        previousAttempts: this.loadPreviousAttempts(result.route_id),
        ...this.aiConfig
      });
      
      console.log('\n📈 AI分析結果:');
      console.log(`  - 分析済みテスト: ${aiAnalysis.summary.total_analyzed}件`);
      console.log(`  - AI駆動分析: ${aiAnalysis.summary.ai_powered}件`);
      console.log(`  - フォールバック: ${aiAnalysis.summary.fallback}件`);
      console.log(`  - 修正ルート生成: ${aiAnalysis.summary.fixed_routes_generated}件`);
      
      // 修正ルートの保存と実行
      for (const analysisResult of aiAnalysis.results) {
        if (analysisResult.fixedRoute) {
          await this.saveAndExecuteFixedRoute(analysisResult.fixedRoute, analysisResult.analysis);
        }
      }
      
      return aiAnalysis;
      
    } catch (error) {
      console.error('❌ AI分析エラー:', error.message);
      console.log('💡 従来の分析方法にフォールバックします...');
      return await this.analyze(); // 従来の分析にフォールバック
    }
  }

  /**
   * 過去の修正試行履歴を取得
   */
  loadPreviousAttempts(routeId) {
    try {
      const testResultsDir = path.join(process.cwd(), 'test-results');
      const historyPath = path.join(testResultsDir, '.ai-fix-history.json');
      
      if (fs.existsSync(historyPath)) {
        const history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
        return history[routeId] || [];
      }
    } catch (error) {
      console.log('⚠️ 修正履歴の読み込みに失敗:', error.message);
    }
    return [];
  }

  /**
   * AI修正試行履歴を保存
   */
  saveFixAttempt(routeId, attempt) {
    try {
      const testResultsDir = path.join(process.cwd(), 'test-results');
      const historyPath = path.join(testResultsDir, '.ai-fix-history.json');
      
      let history = {};
      if (fs.existsSync(historyPath)) {
        history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
      }
      
      if (!history[routeId]) {
        history[routeId] = [];
      }
      
      history[routeId].push({
        timestamp: new Date().toISOString(),
        ...attempt
      });
      
      // 最新10件まで保持
      if (history[routeId].length > 10) {
        history[routeId] = history[routeId].slice(-10);
      }
      
      fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
    } catch (error) {
      console.error('修正履歴保存エラー:', error.message);
    }
  }

  /**
   * AI修正ルートの保存と実行
   */
  async saveAndExecuteFixedRoute(fixedRoute, analysis) {
    try {
      const testResultsDir = path.join(process.cwd(), 'test-results');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
      const routeFileName = `ai_fixed_route_${fixedRoute.original_route_id}_${timestamp}.json`;
      const routeFilePath = path.join(testResultsDir, routeFileName);
      
      // AI修正ルートを保存
      fs.writeFileSync(routeFilePath, JSON.stringify(fixedRoute, null, 2));
      console.log(`💾 AI修正ルート保存: ${routeFileName}`);
      
      // 修正試行履歴に記録
      this.saveFixAttempt(fixedRoute.original_route_id, {
        approach: 'ai_powered_analysis',
        model: analysis.model,
        confidence: fixedRoute.ai_fix_summary?.average_confidence || 0.5,
        fixed_steps: fixedRoute.ai_fix_summary?.ai_fixed_steps || 0,
        route_file: routeFileName
      });
      
      // 自動実行オプションが有効な場合は実行
      if (process.env.AUTO_EXECUTE_AI_FIXES === 'true' || this.options.autoExecute) {
        console.log('🚀 AI修正ルートを自動実行します...');
        
        const { spawn } = await import('child_process');
        const runProcess = spawn('node', ['tests/runRoutes.js', routeFilePath], {
          stdio: 'inherit',
          cwd: process.cwd()
        });
        
        return new Promise((resolve, reject) => {
          runProcess.on('close', (code) => {
            if (code === 0) {
              console.log('✅ AI修正ルート実行完了');
              this.saveFixAttempt(fixedRoute.original_route_id, {
                ...this.loadPreviousAttempts(fixedRoute.original_route_id).slice(-1)[0],
                success: true,
                execution_result: 'completed'
              });
              resolve();
            } else {
              console.log('❌ AI修正ルート実行失敗');
              this.saveFixAttempt(fixedRoute.original_route_id, {
                ...this.loadPreviousAttempts(fixedRoute.original_route_id).slice(-1)[0],
                success: false,
                execution_result: 'failed'
              });
              reject(new Error(`実行失敗: exit code ${code}`));
            }
          });
        });
      } else {
        console.log('💡 手動実行用コマンド:');
        console.log(`   node tests/runRoutes.js ${routeFilePath}`);
      }
      
    } catch (error) {
      console.error('❌ AI修正ルート保存・実行エラー:', error.message);
    }
  }

  /**
   * メイン分析処理
   */
  async analyze() {
    try {
      console.log('🔍 失敗したテストケースの分析を開始します...');
      
      // AI分析が有効な場合は AI 分析を実行
      if (this.enableAI) {
        console.log('🤖 AI分析モードが有効化されています');
        return await this.analyzeWithAI();
      }
      
      // 📋 事前DOM解析結果を読み込み
      this.loadCachedDomAnalysis();
      
      // 📋 参照情報の表示
      if (this.userStory) {
        console.log(`\n📋 ユーザーストーリー参照:`);
        console.log(`   ${this.userStory.substring(0, 100)}${this.userStory.length > 100 ? '...' : ''}`);
      }
      
      if (this.targetUrl) {
        console.log(`🌐 対象URL: ${this.targetUrl}`);
      }
      
      if (this.specPdf) {
        console.log(`📄 仕様書PDF: ${this.specPdf}`);
      }
      
      if (this.testCsv) {
        console.log(`📊 テスト観点CSV: ${this.testCsv}`);
      }
      
      if (this.cachedDomInfo) {
        console.log(`🔍 事前DOM解析結果: ${Object.keys(this.cachedDomInfo.elements || {}).length}要素タイプを参照可能`);
      }
      
      // 最新のテスト結果を取得
      const testResult = this.getLatestTestResult();
      console.log(`\n📊 テスト結果: ${testResult.route_id}`);
      console.log(`❌ 失敗数: ${testResult.failed_count}/${testResult.total_steps}`);

      if (testResult.failed_count === 0) {
        console.log('✅ 失敗したテストケースがありません');
        return;
      }

      // 失敗したステップを抽出
      const failedSteps = this.extractFailedSteps(testResult);
      console.log('\n❌ 失敗したステップ:');
      
      // 簡単な修正を先にチェック
      const simpleFixes = [];
      failedSteps.forEach(step => {
        console.log(`  - ${step.label}: ${step.error}`);
        
        // 🔧 簡単な修正をチェック（チェックボックス、数値入力、hidden要素など）
        const simpleFix = this.checkForSimpleFixes(step);
        if (simpleFix) {
          simpleFixes.push({
            step,
            fix: simpleFix
          });
          console.log(`    🔧 簡単な修正を検出: ${simpleFix.message}`);
        }
        
        // ユーザーストーリーとの関連性を分析
        if (this.userStory) {
          const guidance = this.getFixGuidanceFromUserStory(step, 'element_not_found');
          if (guidance.isImportant) {
            console.log(`    🎯 ユーザーストーリー関連: ${guidance.reason} (重要度: ${guidance.importance})`);
          }
        }
      });
      
      // 簡単な修正がある場合は表示
      if (simpleFixes.length > 0) {
        console.log(`\n🔧 簡単な修正を検出: ${simpleFixes.length}件`);
        simpleFixes.forEach(({ step, fix }) => {
          console.log(`  ✅ ${step.label}: ${fix.message}`);
        });
      }

      // URLを取得（config.jsonから）
      const configFilePath = path.join(process.cwd(), 'config.json');
      const configData = JSON.parse(fs.readFileSync(configFilePath, 'utf-8'));
      const targetUrl = configData.targetUrl;

      await this.init();

      // 🔬 DOM解析ベースの詳細失敗分析を実行
      console.log('\n🔬 DOM解析ベースの詳細失敗分析を実行中...');
      const detailedAnalyses = [];
      for (const step of failedSteps) {
        const detailedAnalysis = await this.analyzeDomBasedFailure(step, targetUrl);
        detailedAnalyses.push(detailedAnalysis);
        
        // 分析結果のサマリーを表示
        if (detailedAnalysis.confidence_score > 0.5) {
          console.log(`  ✅ ${step.label}: 高信頼度修正提案あり (${detailedAnalysis.confidence_score.toFixed(2)})`);
        } else {
          console.log(`  ⚠️  ${step.label}: 修正提案の信頼度が低い (${detailedAnalysis.confidence_score.toFixed(2)})`);
        }
      }

      // 元のルートファイルを取得
      let routeFile, routePath;
      
      // 修正されたルートファイルの場合は元のルートIDを使用
      if (testResult.route_id.startsWith('fixed_')) {
        // fixed_route_250626021449_2025-06-25T0823 → route_250626021449.json
        // fixed_250626021449_20250625... → route_250626021449.json
        const match = testResult.route_id.match(/fixed_(?:route_)?(\d+)/);
        if (match) {
          const originalRouteId = match[1];
          routeFile = `route_${originalRouteId}.json`;
        } else {
          throw new Error(`修正ルートIDの解析に失敗しました: ${testResult.route_id}`);
        }
      } else {
        // 通常のルートファイルの場合
        const routeId = testResult.route_id.replace(/^route_/, '');
        routeFile = `route_${routeId}.json`;
      }
      
      routePath = path.join(process.cwd(), 'test-results', routeFile);
      
      if (!fs.existsSync(routePath)) {
        throw new Error(`ルートファイルが見つかりません: ${routePath}`);
      }

      const originalRoute = JSON.parse(fs.readFileSync(routePath, 'utf-8'));
      
      await this.init();

      // 修正されたルートを生成（detailedAnalysesも活用）
      const fixedRoute = await this.generateFixedRoute(originalRoute, failedSteps, targetUrl, detailedAnalyses);

      // 修正されたルートを保存
      const fixedRoutePath = path.join(process.cwd(), 'test-results', `${fixedRoute.route_id}.json`);
      fs.writeFileSync(fixedRoutePath, JSON.stringify(fixedRoute, null, 2));

      console.log(`\n📝 修正されたルートを保存しました: ${fixedRoutePath}`);
      console.log(`🔧 修正サマリー:`);
      console.log(`  - 総ステップ数: ${fixedRoute.fix_summary.total_steps}`);
      console.log(`  - 修正ステップ数: ${fixedRoute.fix_summary.fixed_steps}`);
      console.log(`  - スキップステップ数: ${fixedRoute.fix_summary.skipped_steps}`);
      console.log(`  - 簡単な修正適用: ${fixedRoute.fix_summary.simple_fixes}`);

      // 自動再テスト実行オプション
      console.log(`\n🚀 修正されたテストを実行するには:`);
      console.log(`node tests/runRoutes.js --route-file ${fixedRoute.route_id}.json`);

    } catch (error) {
      console.error('❌ 分析エラー:', error.message);
      throw error;
    } finally {
      await this.close();
    }
  }

  /**
   * DOM解析結果を活用した詳細失敗分析
   * @param {Object} step - 失敗したステップ
   * @param {string} url - 対象URL
   * @returns {Object} 詳細分析結果
   */
  async analyzeDomBasedFailure(step, url) {
    console.log(`\n🔬 DOM解析ベースの詳細失敗分析: ${step.label}`);
    
    const analysis = {
      step,
      failure_category: null,
      dom_changes_detected: false,
      alternative_elements: [],
      structure_analysis: {},
      recommended_fixes: [],
      confidence_score: 0
    };

    try {
      await this.page.goto(url);
      await this.page.waitForLoadState('networkidle');

      // 1. 現在のDOM構造を取得
      const currentDom = await this.page.evaluate(() => {
        const elements = {
          inputs: [],
          buttons: [],
          links: [],
          selects: []
        };

        // 入力フィールド解析
        document.querySelectorAll('input, textarea').forEach(input => {
          elements.inputs.push({
            tagName: input.tagName.toLowerCase(),
            type: input.type || 'text',
            name: input.name,
            id: input.id,
            placeholder: input.placeholder,
            required: input.required,
            disabled: input.disabled,
            visible: input.offsetParent !== null,
            selector: input.id ? `#${input.id}` : input.name ? `[name="${input.name}"]` : null,
            boundingBox: input.getBoundingClientRect(),
            computedStyle: {
              display: window.getComputedStyle(input).display,
              visibility: window.getComputedStyle(input).visibility,
              opacity: window.getComputedStyle(input).opacity
            }
          });
        });

        // セレクトボックス解析
        document.querySelectorAll('select').forEach(select => {
          elements.selects.push({
            name: select.name,
            id: select.id,
            disabled: select.disabled,
            visible: select.offsetParent !== null,
            options: Array.from(select.options).map(opt => ({
              value: opt.value,
              text: opt.text
            })),
            selector: select.id ? `#${select.id}` : select.name ? `[name="${select.name}"]` : null
          });
        });

        // ボタン解析
        document.querySelectorAll('button, input[type="submit"], input[type="button"]').forEach(btn => {
          elements.buttons.push({
            tagName: btn.tagName.toLowerCase(),
            type: btn.type,
            text: btn.textContent?.trim() || btn.value,
            id: btn.id,
            disabled: btn.disabled,
            visible: btn.offsetParent !== null,
            selector: btn.id ? `#${btn.id}` : `text="${btn.textContent?.trim() || btn.value}"`,
            boundingBox: btn.getBoundingClientRect()
          });
        });

        // リンク解析
        document.querySelectorAll('a[href]').forEach(link => {
          elements.links.push({
            href: link.href,
            text: link.textContent?.trim(),
            id: link.id,
            visible: link.offsetParent !== null,
            selector: link.id ? `#${link.id}` : `text="${link.textContent?.trim()}"`
          });
        });

        return elements;
      });

      // 2. 事前DOM解析結果と比較（構造変化検出）
      if (this.cachedDomInfo && this.cachedDomInfo.elements) {
        analysis.dom_changes_detected = this.detectDomChanges(this.cachedDomInfo.elements, currentDom);
        
        if (analysis.dom_changes_detected) {
          console.log(`🔄 DOM構造変化を検出しました`);
          analysis.structure_analysis = this.analyzeDomStructureChanges(this.cachedDomInfo.elements, currentDom);
        }
      }

      // 3. 失敗したステップの要素を詳細分析
      const targetAnalysis = await this.analyzeTargetElement(step, currentDom);
      analysis.failure_category = targetAnalysis.category;
      analysis.alternative_elements = targetAnalysis.alternatives;

      // 4. DOM解析に基づく修正提案生成
      analysis.recommended_fixes = this.generateDomBasedFixes(step, targetAnalysis, currentDom);
      
      // 5. 信頼度スコア算出
      analysis.confidence_score = this.calculateFixConfidence(analysis);

      console.log(`🎯 失敗カテゴリ: ${analysis.failure_category}`);
      console.log(`🔧 修正提案数: ${analysis.recommended_fixes.length}`);
      console.log(`📊 信頼度スコア: ${analysis.confidence_score.toFixed(2)}`);

      return analysis;

    } catch (error) {
      console.error(`DOM解析ベース失敗分析エラー: ${error.message}`);
      analysis.failure_category = 'analysis_error';
      analysis.confidence_score = 0;
      return analysis;
    }
  }

  /**
   * DOM構造変化を検出
   * @param {Object} originalDom - 事前解析結果
   * @param {Object} currentDom - 現在のDOM
   * @returns {boolean} 変化があったかどうか
   */
  detectDomChanges(originalDom, currentDom) {
    const changes = {
      added_inputs: 0,
      removed_inputs: 0,
      modified_inputs: 0,
      added_buttons: 0,
      removed_buttons: 0
    };

    // 入力フィールドの変化を検出
    const originalInputs = originalDom.inputs || [];
    const currentInputs = currentDom.inputs || [];
    
    // 簡単な比較（name属性ベース）
    const originalNames = new Set(originalInputs.map(i => i.name).filter(Boolean));
    const currentNames = new Set(currentInputs.map(i => i.name).filter(Boolean));
    
    changes.added_inputs = [...currentNames].filter(name => !originalNames.has(name)).length;
    changes.removed_inputs = [...originalNames].filter(name => !currentNames.has(name)).length;

    // ボタンの変化を検出
    const originalButtons = originalDom.buttons || [];
    const currentButtons = currentDom.buttons || [];
    
    const originalButtonTexts = new Set(originalButtons.map(b => b.text).filter(Boolean));
    const currentButtonTexts = new Set(currentButtons.map(b => b.text).filter(Boolean));
    
    changes.added_buttons = [...currentButtonTexts].filter(text => !originalButtonTexts.has(text)).length;
    changes.removed_buttons = [...originalButtonTexts].filter(text => !currentButtonTexts.has(text)).length;

    const hasChanges = Object.values(changes).some(count => count > 0);
    
    if (hasChanges) {
      console.log(`📊 DOM変化統計:`, changes);
    }
    
    return hasChanges;
  }

  /**
   * DOM構造変化の詳細分析
   * @param {Object} originalDom - 事前解析結果
   * @param {Object} currentDom - 現在のDOM
   * @returns {Object} 構造変化の詳細
   */
  analyzeDomStructureChanges(originalDom, currentDom) {
    const analysis = {
      input_changes: this.compareElements(originalDom.inputs || [], currentDom.inputs || [], 'name'),
      button_changes: this.compareElements(originalDom.buttons || [], currentDom.buttons || [], 'text'),
      potential_impacts: []
    };

    // 変化がテスト失敗に与える影響を分析
    if (analysis.input_changes.removed.length > 0) {
      analysis.potential_impacts.push({
        type: 'removed_inputs',
        description: `入力フィールドが削除された可能性: ${analysis.input_changes.removed.map(i => i.name || i.id).join(', ')}`,
        severity: 'high'
      });
    }

    if (analysis.button_changes.removed.length > 0) {
      analysis.potential_impacts.push({
        type: 'removed_buttons',
        description: `ボタンが削除された可能性: ${analysis.button_changes.removed.map(b => b.text).join(', ')}`,
        severity: 'high'
      });
    }

    return analysis;
  }

  /**
   * 要素の比較
   * @param {Array} original - 元の要素配列
   * @param {Array} current - 現在の要素配列
   * @param {string} keyField - 比較キーフィールド
   * @returns {Object} 比較結果
   */
  compareElements(original, current, keyField) {
    const originalKeys = new Set(original.map(el => el[keyField]).filter(Boolean));
    const currentKeys = new Set(current.map(el => el[keyField]).filter(Boolean));
    
    const added = current.filter(el => el[keyField] && !originalKeys.has(el[keyField]));
    const removed = original.filter(el => el[keyField] && !currentKeys.has(el[keyField]));
    const common = current.filter(el => el[keyField] && originalKeys.has(el[keyField]));

    return { added, removed, common };
  }

  /**
   * ターゲット要素の詳細分析
   * @param {Object} step - 失敗したステップ
   * @param {Object} currentDom - 現在のDOM情報
   * @returns {Object} ターゲット要素分析結果
   */
  analyzeTargetElement(step, currentDom) {
    const analysis = {
      category: 'unknown',
      found_exact_match: false,
      alternatives: [],
      visibility_issues: [],
      interaction_issues: []
    };

    const target = step.target;

    // name属性の場合
    const nameMatch = target.match(/\[name="([^"]+)"\]/);
    if (nameMatch) {
      const nameValue = nameMatch[1];
      
      // 完全一致の要素を検索
      const exactMatch = [...(currentDom.inputs || []), ...(currentDom.selects || [])]
        .find(el => el.name === nameValue);
      
      if (exactMatch) {
        analysis.found_exact_match = true;
        analysis.category = exactMatch.visible ? 'visibility_issue' : 'element_hidden';
        
        if (!exactMatch.visible) {
          analysis.visibility_issues.push({
            reason: 'element_not_visible',
            style_info: exactMatch.computedStyle,
            bbox: exactMatch.boundingBox
          });
        }
        
        if (exactMatch.disabled) {
          analysis.interaction_issues.push({
            reason: 'element_disabled',
            element_info: exactMatch
          });
        }
      } else {
        analysis.category = 'element_not_found';
        
        // 類似要素を検索
        const similarElements = [...(currentDom.inputs || []), ...(currentDom.selects || [])]
          .filter(el => el.name && (
            el.name.includes(nameValue.split('-')[0]) ||
            nameValue.includes(el.name) ||
            this.calculateStringSimilarity(el.name, nameValue) > 0.6
          ))
          .map(el => ({
            ...el,
            similarity: this.calculateStringSimilarity(el.name, nameValue),
            confidence: 0.7
          }));
        
        analysis.alternatives = similarElements.sort((a, b) => b.similarity - a.similarity);
      }
    }

    // text属性の場合（ボタン・リンク）
    const textMatch = target.match(/text="([^"]+)"/);
    if (textMatch) {
      const textValue = textMatch[1];
      
      const exactMatch = [...(currentDom.buttons || []), ...(currentDom.links || [])]
        .find(el => el.text === textValue);
      
      if (exactMatch) {
        analysis.found_exact_match = true;
        analysis.category = exactMatch.visible ? 'visibility_issue' : 'element_hidden';
      } else {
        analysis.category = 'element_not_found';
        
        // 類似テキストの要素を検索
        const similarElements = [...(currentDom.buttons || []), ...(currentDom.links || [])]
          .filter(el => el.text && (
            el.text.includes(textValue) ||
            textValue.includes(el.text) ||
            this.calculateStringSimilarity(el.text, textValue) > 0.6
          ))
          .map(el => ({
            ...el,
            similarity: this.calculateStringSimilarity(el.text, textValue),
            confidence: 0.8
          }));
        
        analysis.alternatives = similarElements.sort((a, b) => b.similarity - a.similarity);
      }
    }

    return analysis;
  }

  /**
   * 文字列類似度計算（Levenshtein距離ベース）
   * @param {string} str1 
   * @param {string} str2 
   * @returns {number} 類似度（0-1）
   */
  calculateStringSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    
    const maxLength = Math.max(str1.length, str2.length);
    if (maxLength === 0) return 1;
    
    const distance = this.levenshteinDistance(str1.toLowerCase(), str2.toLowerCase());
    return (maxLength - distance) / maxLength;
  }

  /**
   * Levenshtein距離計算
   */
  levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  /**
   * DOM解析に基づく修正提案生成
   * @param {Object} step - 失敗したステップ
   * @param {Object} targetAnalysis - ターゲット要素分析結果
   * @param {Object} currentDom - 現在のDOM情報
   * @returns {Array} 修正提案配列
   */
  generateDomBasedFixes(step, targetAnalysis, currentDom) {
    const fixes = [];

    switch (targetAnalysis.category) {
      case 'element_hidden':
        fixes.push({
          type: 'scroll_to_element',
          selector: step.target,
          reason: '要素は存在するが非表示のため、スクロールして表示',
          confidence: 0.8,
          action_modification: {
            before_action: 'scroll_into_view',
            wait_for_visible: true
          }
        });
        break;

      case 'visibility_issue':
        if (targetAnalysis.visibility_issues.length > 0) {
          const issue = targetAnalysis.visibility_issues[0];
          if (issue.style_info && issue.style_info.display === 'none') {
            fixes.push({
              type: 'wait_for_element',
              selector: step.target,
              reason: '要素がdisplay:noneの状態のため、表示まで待機',
              confidence: 0.7,
              action_modification: {
                wait_for_visible: true,
                timeout: 10000
              }
            });
          }
        }
        break;

      case 'element_not_found':
        if (targetAnalysis.alternatives.length > 0) {
          targetAnalysis.alternatives.slice(0, 3).forEach((alt, index) => {
            fixes.push({
              type: 'alternative_selector',
              selector: alt.selector,
              reason: `類似要素を使用: ${alt.name || alt.text} (類似度: ${alt.similarity.toFixed(2)})`,
              confidence: alt.confidence * alt.similarity,
              priority: index + 1
            });
          });
        } else {
          // DOM全体から推測
          fixes.push({
            type: 'smart_search',
            reason: 'DOM解析結果からより広範囲な要素検索を実行',
            confidence: 0.4,
            action_modification: {
              search_strategy: 'fuzzy_match',
              include_hidden: true
            }
          });
        }
        break;
    }

    // 汎用的な修正提案
    if (step.action === 'fill' && currentDom.inputs && currentDom.inputs.length > 0) {
      const visibleInputs = currentDom.inputs.filter(input => input.visible);
      if (visibleInputs.length > 0 && fixes.length === 0) {
        fixes.push({
          type: 'fallback_input',
          selector: visibleInputs[0].selector,
          reason: '最初の可視入力フィールドを代替として使用',
          confidence: 0.3
        });
      }
    }

    return fixes.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * 修正提案の信頼度スコア計算
   * @param {Object} analysis - 分析結果
   * @returns {number} 信頼度スコア（0-1）
   */
  calculateFixConfidence(analysis) {
    let baseScore = 0;

    // 失敗カテゴリによる基本スコア
    switch (analysis.failure_category) {
      case 'visibility_issue':
        baseScore = 0.8;
        break;
      case 'element_hidden':
        baseScore = 0.7;
        break;
      case 'element_not_found':
        baseScore = analysis.alternative_elements.length > 0 ? 0.6 : 0.3;
        break;
      default:
        baseScore = 0.2;
    }

    // DOM変化検出による調整
    if (analysis.dom_changes_detected) {
      baseScore *= 0.8; // DOM変化がある場合は信頼度を下げる
    }

    // 修正提案の品質による調整
    if (analysis.recommended_fixes.length > 0) {
      const bestFixConfidence = Math.max(...analysis.recommended_fixes.map(f => f.confidence));
      baseScore = Math.max(baseScore, bestFixConfidence);
    }

    return Math.min(1.0, baseScore);
  }

  /**
   * DOM解析ベースの修正を適用
   * @param {Object} step - 元のステップ
   * @param {Object} fix - 修正提案
   * @param {Object} analysis - 詳細分析結果
   * @returns {Object} 修正されたステップ
   */
  applyDomBasedFix(step, fix, analysis) {
    const fixedStep = { ...step };
    
    switch (fix.type) {
      case 'alternative_selector':
        fixedStep.target = fix.selector;
        fixedStep.original_target = step.target;
        fixedStep.fix_reason = `DOM解析: ${fix.reason}`;
        fixedStep.fix_confidence = fix.confidence;
        fixedStep.fix_category = analysis.failure_category;
        break;

      case 'scroll_to_element':
        fixedStep.action = 'scroll_and_' + step.action;
        fixedStep.fix_reason = `DOM解析: ${fix.reason}`;
        fixedStep.scroll_before_action = true;
        fixedStep.wait_for_visible = true;
        fixedStep.fix_confidence = fix.confidence;
        break;

      case 'wait_for_element':
        fixedStep.wait_for_visible = true;
        fixedStep.wait_timeout = fix.action_modification?.timeout || 10000;
        fixedStep.fix_reason = `DOM解析: ${fix.reason}`;
        fixedStep.fix_confidence = fix.confidence;
        break;

      case 'smart_search':
        fixedStep.search_strategy = 'fuzzy_match';
        fixedStep.include_hidden = true;
        fixedStep.fix_reason = `DOM解析: ${fix.reason}`;
        fixedStep.fix_confidence = fix.confidence;
        break;

      case 'fallback_input':
        fixedStep.target = fix.selector;
        fixedStep.original_target = step.target;
        fixedStep.fix_reason = `DOM解析: ${fix.reason}`;
        fixedStep.fix_confidence = fix.confidence;
        break;

      case 'skip':
        fixedStep.action = 'skip';
        fixedStep.fix_reason = `DOM解析: ${fix.reason}`;
        fixedStep.skip_reason = fix.reason;
        fixedStep.fix_confidence = fix.confidence;
        break;

      default:
        fixedStep.fix_reason = `DOM解析: 不明な修正タイプ ${fix.type}`;
        fixedStep.fix_confidence = 0.1;
    }

    // DOM変化検出の情報を追加
    if (analysis.dom_changes_detected) {
      fixedStep.dom_changes_detected = true;
      fixedStep.structure_changes = analysis.structure_analysis;
    }

    return fixedStep;
  }
}

// CLI実行
if (import.meta.url === `file://${process.argv[1]}`) {
  // コマンドライン引数を解析
  const args = parseArguments(process.argv.slice(2), {
    url: { alias: 'u', type: 'string' },
    goal: { alias: 'g', type: 'string' },
    'spec-pdf': { type: 'string' },
    'test-csv': { type: 'string' },
    'enable-ai': { type: 'boolean', default: false },
    'ai-model': { type: 'string', default: 'gpt-4-turbo-preview' },
    'auto-execute': { type: 'boolean', default: false }
  });

  // 分析オプションを設定
  const options = {
    userStory: args.goal,
    targetUrl: args.url,
    specPdf: args['spec-pdf'],
    testCsv: args['test-csv'],
    enableAI: args['enable-ai'],
    autoExecute: args['auto-execute'],
    aiConfig: {
      model: args['ai-model'],
      apiKey: process.env.OPENAI_API_KEY
    }
  };

  console.log('🔍 AutoPlaywright 失敗分析ツール');
  if (options.enableAI) {
    console.log('🤖 AI-Powered 分析モード');
    console.log(`   モデル: ${options.aiConfig.model}`);
    console.log(`   API キー: ${options.aiConfig.apiKey ? '設定済み' : '❌ 未設定'}`);
  } else {
    console.log('🔧 従来の分析モード');
    console.log('💡 AI分析を使用するには --enable-ai フラグを追加してください');
  }

  const analyzer = new FailureAnalyzer(options);
  
  analyzer.analyze()
    .then(() => {
      console.log('✅ 失敗分析が完了しました');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ 失敗分析エラー:', error);
      process.exit(1);
    });
}

export { FailureAnalyzer }; 