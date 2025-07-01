#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { parseArguments } from './utils/cliParser.js';

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
    } else {
      return 'unknown';
    }
  }

  /**
   * 要素の修正提案を生成（学習機能付き、ユーザーストーリー考慮）
   */
  generateElementFix(step, verificationResult) {
    const { exists, isVisible, isEnabled, isClickable } = verificationResult;
    
    // エラータイプを特定
    let errorType = 'unknown';
    if (!exists) {
      errorType = 'element_not_found';
    } else if (!isVisible) {
      errorType = 'not_visible';
    } else if (!isEnabled) {
      errorType = 'not_enabled';
    } else if (!isClickable && step.action === 'click') {
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
      if (!isVisible) {
        return { 
          type: 'wait_and_scroll', 
          reason: '要素が非可視のため、スクロールして可視化を試行',
          newAction: 'scroll_and_fill',
          confidence: 0.7
        };
      }
      if (!isEnabled) {
        return { 
          type: 'skip', 
          reason: '入力フィールドが無効化されている',
          confidence: 0.9
        };
      }
    }

    if (step.action === 'click') {
      if (!isVisible) {
        return { 
          type: 'scroll_to_element', 
          reason: '要素が非可視のため、スクロールしてからクリック',
          newAction: 'scroll_and_click',
          confidence: 0.7
        };
      }
      if (!isClickable) {
        return { 
          type: 'force_click', 
          reason: '通常のクリックが失敗するため、強制クリックを試行',
          newAction: 'force_click',
          confidence: 0.6
        };
      }
    }

    if (step.action === 'assertVisible') {
      if (!isVisible) {
        return { 
          type: 'skip', 
          reason: '要素は存在するが非可視のため、アサーションをスキップ',
          confidence: 0.8
        };
      }
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
   * 修正されたルートを生成
   */
  async generateFixedRoute(originalRoute, failedSteps, url) {
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
      alternative_selectors: fixedSteps.filter(s => s.original_target && s.target !== s.original_target).length
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

    return fixedRoute;
  }

  /**
   * メイン分析処理
   */
  async analyze() {
    try {
      console.log('🔍 失敗したテストケースの分析を開始します...');
      
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
      failedSteps.forEach(step => {
        console.log(`  - ${step.label}: ${step.error}`);
        
        // ユーザーストーリーとの関連性を分析
        if (this.userStory) {
          const guidance = this.getFixGuidanceFromUserStory(step, 'element_not_found');
          if (guidance.isImportant) {
            console.log(`    🎯 ユーザーストーリー関連: ${guidance.reason} (重要度: ${guidance.importance})`);
          }
        }
      });

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
      
      // URLを取得（config.jsonから）
      const configPath = path.join(process.cwd(), 'config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const url = config.targetUrl;

      await this.init();

      // 修正されたルートを生成
      const fixedRoute = await this.generateFixedRoute(originalRoute, failedSteps, url);

      // 修正されたルートを保存
      const fixedRoutePath = path.join(process.cwd(), 'test-results', `${fixedRoute.route_id}.json`);
      fs.writeFileSync(fixedRoutePath, JSON.stringify(fixedRoute, null, 2));

      console.log(`\n📝 修正されたルートを保存しました: ${fixedRoutePath}`);
      console.log(`🔧 修正サマリー:`);
      console.log(`  - 総ステップ数: ${fixedRoute.fix_summary.total_steps}`);
      console.log(`  - 修正ステップ数: ${fixedRoute.fix_summary.fixed_steps}`);
      console.log(`  - スキップステップ数: ${fixedRoute.fix_summary.skipped_steps}`);

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
}

// CLI実行
if (import.meta.url === `file://${process.argv[1]}`) {
  // コマンドライン引数を解析
  const args = parseArguments(process.argv.slice(2), {
    url: { alias: 'u', type: 'string' },
    goal: { alias: 'g', type: 'string' },
    'spec-pdf': { type: 'string' },
    'test-csv': { type: 'string' }
  });

  // 分析オプションを設定
  const options = {
    userStory: args.goal,
    targetUrl: args.url,
    specPdf: args['spec-pdf'],
    testCsv: args['test-csv']
  };

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