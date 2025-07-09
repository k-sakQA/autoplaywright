// tests/generateSmartRoutes.js
// DOM照合 + Playwright変換特化版
// 自然言語テストケース(generateTestCases.js出力)をDOM情報と照合してPlaywright実装に変換

import 'dotenv/config';
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { chromium } from 'playwright';
import { z } from "zod";
import { OpenAI } from "openai";
import { parseCLIArgs, validateOptions } from './utils/cliParser.js';
import { uploadPDFToOpenAI, createPDFPrompt } from './utils/pdfParser.js';

// configのスキーマ定義
const ConfigSchema = z.object({
  openai: z.object({
    apiKeyEnv: z.string(),
    model: z.string(),
    temperature: z.number().min(0).max(2),
    max_tokens: z.number().optional(),
    top_p: z.number().min(0).max(1).optional(),
    timeout: z.number().optional(),
    maxRetries: z.number().optional(),
  }),
  targetUrl: z.string().url(),
});

// config.json をロード
const loadConfig = () => {
  try {
    const configPath = path.resolve(__dirname, "../config.json");
    const rawConfig = fs.readFileSync(configPath, "utf-8");
    const parsedConfig = JSON.parse(rawConfig);
    return ConfigSchema.parse(parsedConfig);
  } catch (error) {
    if (error instanceof Error) {
      console.error("Failed to load config:", error.message);
    }
    process.exit(1);
  }
};

// OpenAI クライアントの設定
const getOpenAIConfig = (config) => {
  const apiKey = process.env[config.openai.apiKeyEnv];
  if (!apiKey) {
    console.error("ERROR: OpenAI API key not set in", config.openai.apiKeyEnv);
    process.exit(1);
  }

  const openAIConfig = {
    apiKey,
    model: config.openai.model,
    temperature: config.openai.temperature,
  };

  // オプション設定を追加
  if (config.openai.max_tokens) openAIConfig.max_tokens = config.openai.max_tokens;
  if (config.openai.top_p) openAIConfig.top_p = config.openai.top_p;
  if (config.openai.timeout) openAIConfig.timeout = config.openai.timeout;
  if (config.openai.maxRetries) openAIConfig.maxRetries = config.openai.maxRetries;

  return openAIConfig;
};

export const config = loadConfig();
export const openAIConfig = getOpenAIConfig(config);

// 動的DOM情報を取得する関数
async function extractDynamicPageInfo(url) {
  console.log(`🔍 動的DOM取得開始: ${url}`);
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    // ページを読み込み
    await page.goto(url, { waitUntil: 'networkidle' });
    console.log('✅ ページ読み込み完了');
    
    // DOM情報を取得
    const pageInfo = await page.evaluate(() => {
      // 基本情報
      const info = {
        title: document.title,
        url: window.location.href,
        elements: {
          headings: [],
          links: [],
          buttons: [],
          inputs: [],
          images: [],
          navigation: []
        }
      };
      
      // 見出し要素
      document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((el, index) => {
        if (el.textContent.trim() && index < 10) {
          info.elements.headings.push({
            tag: el.tagName.toLowerCase(),
            text: el.textContent.trim(),
            selector: `${el.tagName.toLowerCase()}:has-text("${el.textContent.trim()}")`,
            fallbackSelector: el.tagName.toLowerCase()
          });
        }
      });
      
      // リンク要素
      document.querySelectorAll('a[href]').forEach((el, index) => {
        if (el.textContent.trim() && index < 15) {
          info.elements.links.push({
            text: el.textContent.trim(),
            href: el.href,
            selector: `text="${el.textContent.trim()}"`,
            fallbackSelector: `a[href*="${el.href.split('/').pop()}"]`
          });
        }
      });
      
      // ボタン要素 - より具体的なセレクタ生成
      document.querySelectorAll('button, input[type="button"], input[type="submit"]').forEach((el, index) => {
        if (index < 10) {
          const text = el.textContent?.trim() || el.value || el.getAttribute('aria-label') || '';
          if (text) {
            // 🔧 Strict Mode Violation対策 - より具体的なセレクタを優先
            let primarySelector = `text="${text}"`;
            let robustSelector = primarySelector;
            
            // ログインボタンの場合は特別対応
            if (text.includes('ログイン') || text.includes('login')) {
              if (el.type === 'submit') {
                robustSelector = `button[type="submit"]:has-text("${text}")`;
              } else if (el.id) {
                robustSelector = `#${el.id}`;
              } else {
                robustSelector = `button:has-text("${text}")`;
              }
            }
            // その他のボタンも type や id を活用
            else if (el.id) {
              robustSelector = `#${el.id}`;
            } else if (el.type === 'submit') {
              robustSelector = `button[type="submit"]:has-text("${text}")`;
            } else if (el.className) {
              const mainClass = el.className.split(' ')[0];
              robustSelector = `button.${mainClass}:has-text("${text}")`;
            }
            
            info.elements.buttons.push({
              text: text,
              type: el.type || 'button',
              id: el.id || '',
              className: el.className || '',
              selector: robustSelector, // より具体的なセレクタを使用
              fallbackSelector: el.type ? `[type="${el.type}"]` : 'button',
              basicSelector: primarySelector // 基本セレクタも保持
            });
          }
        }
      });
      
      // 入力要素 - 詳細情報を取得
      document.querySelectorAll('input, textarea, select').forEach((el, index) => {
        if (index < 15) {
          const placeholder = el.placeholder || '';
          const name = el.name || '';
          const id = el.id || '';
          const type = el.type || 'text';
          const disabled = el.disabled;
          const required = el.required;
          const className = el.className || '';
          
          let recommendedSelector = '';
          if (name) {
            recommendedSelector = `[name="${name}"]`;
          } else if (id) {
            recommendedSelector = `#${id}`;
          } else {
            recommendedSelector = `[type="${type}"]`;
          }
          
          info.elements.inputs.push({
            tagName: el.tagName,
            type: type,
            name: name,
            id: id,
            placeholder: placeholder,
            disabled: disabled,
            required: required,
            className: className,
            recommendedSelector: recommendedSelector,
            note: disabled ? '⚠️ この要素は無効化されています' : ''
          });
        }
      });
      
      // 画像要素
      document.querySelectorAll('img[alt], img[src*="logo"]').forEach((el, index) => {
        if (index < 5) {
          const alt = el.alt || '';
          const src = el.src || '';
          
          info.elements.images.push({
            alt: alt,
            src: src.split('/').pop(),
            selector: alt ? `img[alt*="${alt}"]` : `img[src*="${src.split('/').pop()}"]`,
            fallbackSelector: 'img'
          });
        }
      });
      
      return info;
    });
    
    console.log(`📊 DOM情報取得完了: 見出し${pageInfo.elements.headings.length}個, リンク${pageInfo.elements.links.length}個, ボタン${pageInfo.elements.buttons.length}個`);
    
    return pageInfo;
    
  } finally {
    await browser.close();
  }
}

/**
 * 自然言語テストケースファイルを読み込み
 * @param {string} naturalTestCasesFile - 自然言語テストケースファイルパス
 * @returns {Object} テストケースデータ
 */
function loadNaturalLanguageTestCases(naturalTestCasesFile) {
  try {
    const filePath = path.isAbsolute(naturalTestCasesFile) 
      ? naturalTestCasesFile 
      : path.join(__dirname, '../test-results', naturalTestCasesFile);
    
    console.log(`📋 自然言語テストケースを読み込み中: ${filePath}`);
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`自然言語テストケースファイルが見つかりません: ${filePath}`);
    }

    const data = fs.readFileSync(filePath, 'utf8');
    const testCasesData = JSON.parse(data);
    
    // インデックスファイルの場合は分類別ファイルを読み込み
    if (testCasesData.metadata.version_type === 'category_index') {
      console.log(`📂 インデックスファイルを検出: ${testCasesData.metadata.total_categories}カテゴリ`);
      
      const combinedTestCases = [];
      const categoryResults = [];
      const baseDir = path.dirname(filePath);
      
      for (const categoryInfo of testCasesData.categories) {
        const categoryFilePath = path.join(baseDir, categoryInfo.file);
        
        if (fs.existsSync(categoryFilePath)) {
          console.log(`   📁 読み込み中: ${categoryInfo.category} (${categoryInfo.count}件)`);
          
          const categoryData = JSON.parse(fs.readFileSync(categoryFilePath, 'utf8'));
          
          // 分類別データを統合
          combinedTestCases.push(...categoryData.testCases);
          categoryResults.push({
            category: categoryInfo.category,
            testCases: categoryData.testCases,
            metadata: categoryData.metadata
          });
        } else {
          console.warn(`⚠️ 分類ファイルが見つかりません: ${categoryFilePath}`);
        }
      }
      
      // 統合データを返す
      return {
        metadata: {
          ...testCasesData.metadata,
          loaded_categories: categoryResults.length,
          processing_mode: 'category_batch'
        },
        testCases: combinedTestCases,
        categoryData: categoryResults
      };
    }
    
    // 単一ファイル（分類別または統合）の場合
    console.log(`✅ ${testCasesData.metadata.total_test_cases}件の自然言語テストケースを読み込みました`);
    
    if (testCasesData.metadata.version_type === 'category_detailed') {
      console.log(`📂 分類: ${testCasesData.metadata.category}`);
    } else {
      console.log(`📊 カテゴリ内訳:`, testCasesData.metadata.categories);
    }
    
    return {
      ...testCasesData,
      metadata: {
        ...testCasesData.metadata,
        processing_mode: testCasesData.metadata.version_type === 'category_detailed' ? 'single_category' : 'legacy'
      }
    };
  } catch (error) {
    console.error('❌ 自然言語テストケース読み込みに失敗:', error.message);
    throw error;
  }
}

/**
 * DOM情報と自然言語テストケースを照合して実行可能性を分析
 * @param {Object} domInfo - DOM情報
 * @param {Array} testCases - 自然言語テストケース配列
 * @returns {Object} 照合結果
 */
function analyzeTestCaseFeasibility(domInfo, testCases) {
  console.log('🔍 DOM照合分析を開始...');
  
  const analysis = {
    totalCases: testCases.length,
    feasibleCases: [],
    problematicCases: [],
    suggestedCases: [],
    domCapabilities: {
      hasInputs: domInfo.elements.inputs.length > 0,
      hasButtons: domInfo.elements.buttons.length > 0,
      hasLinks: domInfo.elements.links.length > 0,
      hasNavigation: domInfo.elements.navigation.length > 0,
      inputTypes: [...new Set(domInfo.elements.inputs.map(input => input.type))],
      availableActions: []
    }
  };

  // DOM機能の分析
  if (analysis.domCapabilities.hasInputs) analysis.domCapabilities.availableActions.push('データ入力');
  if (analysis.domCapabilities.hasButtons) analysis.domCapabilities.availableActions.push('ボタン操作');
  if (analysis.domCapabilities.hasLinks) analysis.domCapabilities.availableActions.push('ナビゲーション');

  // 各テストケースの実行可能性を分析
  testCases.forEach((testCase, index) => {
    const feasibilityScore = calculateFeasibilityScore(testCase, domInfo);
    
    if (feasibilityScore.score >= 0.7) {
      analysis.feasibleCases.push({
        ...testCase,
        feasibilityScore: feasibilityScore.score,
        matchedElements: feasibilityScore.matchedElements,
        suggestions: feasibilityScore.suggestions
      });
    } else if (feasibilityScore.score >= 0.3) {
      analysis.problematicCases.push({
        ...testCase,
        feasibilityScore: feasibilityScore.score,
        issues: feasibilityScore.issues,
        suggestions: feasibilityScore.suggestions
      });
    }
    
    console.log(`📝 ${index + 1}. ${testCase.category}: ${feasibilityScore.score.toFixed(2)} (${feasibilityScore.score >= 0.7 ? '実行可能' : feasibilityScore.score >= 0.3 ? '要検討' : '困難'})`);
  });

  // 実行推奨ケースを優先度順に並び替え
  analysis.suggestedCases = analysis.feasibleCases
    .sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[b.priority] - priorityOrder[a.priority];
      }
      return b.feasibilityScore - a.feasibilityScore;
    })
    .slice(0, 10); // 上位10件に限定

  console.log(`✅ DOM照合分析完了: 実行可能${analysis.feasibleCases.length}件, 要検討${analysis.problematicCases.length}件`);
  console.log(`🎯 推奨実行ケース: ${analysis.suggestedCases.length}件を選定`);
  
  return analysis;
}

/**
 * テストケースの実行可能性スコアを計算
 */
function calculateFeasibilityScore(testCase, domInfo) {
  let score = 0;
  const matchedElements = [];
  const issues = [];
  const suggestions = [];

  // 🔧 新機能: URLベースの適合性判定
  const currentPageUrl = domInfo.url || domInfo.pageUrl || '';
  const urlCompatibilityScore = calculateUrlCompatibility(testCase, currentPageUrl);
  
  if (urlCompatibilityScore < 0.3) {
    score = Math.max(score * 0.2, 0.1); // 不適合な場合は大幅減点
    issues.push(`ページURL適合性が低い (スコア: ${urlCompatibilityScore.toFixed(2)})`);
    suggestions.push('対象ページとテストケースの整合性を確認してください');
    console.log(`⚠️ URL不適合: ${testCase.category} - ${currentPageUrl} (スコア: ${urlCompatibilityScore.toFixed(2)})`);
  } else {
    score += urlCompatibilityScore * 0.3; // 適合する場合はボーナス
    console.log(`✅ URL適合: ${testCase.category} - ${currentPageUrl} (スコア: ${urlCompatibilityScore.toFixed(2)})`);
  }

  // カテゴリ別の実行可能性判定
  switch (testCase.category) {
    case 'display':
      // 表示系は基本的に実行可能
      score += 0.8;
      if (domInfo.elements.headings.length > 0) score += 0.1;
      if (domInfo.elements.images.length > 0) score += 0.1;
      matchedElements.push('画面表示要素');
      break;

    case 'input_validation':
      // 入力フィールドの存在確認
      if (domInfo.elements.inputs.length > 0) {
        score += 0.6;
        matchedElements.push(`入力フィールド${domInfo.elements.inputs.length}個`);
        
        const hasRequiredInputs = domInfo.elements.inputs.some(input => input.required);
        if (hasRequiredInputs) {
          score += 0.2;
          matchedElements.push('必須入力フィールド');
        }
        
        if (domInfo.elements.buttons.length > 0) {
          score += 0.2;
          matchedElements.push('送信ボタン');
        }
      } else {
        issues.push('入力フィールドが見つかりません');
        suggestions.push('フォーム要素の存在確認をお願いします');
      }
      break;

    case 'interaction':
      // ボタンやプルダウンの存在確認
      if (domInfo.elements.buttons.length > 0) {
        score += 0.5;
        matchedElements.push(`ボタン${domInfo.elements.buttons.length}個`);
      }
      
      const hasSelectInputs = domInfo.elements.inputs.some(input => input.tagName === 'SELECT');
      if (hasSelectInputs) {
        score += 0.3;
        matchedElements.push('プルダウン要素');
      }
      
      if (score === 0) {
        issues.push('操作可能な要素が見つかりません');
      } else {
        score += 0.2; // 基本実行可能性
      }
      break;

    case 'navigation':
      // リンクの存在確認
      if (domInfo.elements.links.length > 0) {
        score += 0.7;
        matchedElements.push(`リンク${domInfo.elements.links.length}個`);
        
        if (domInfo.elements.buttons.length > 0) {
          score += 0.2;
          matchedElements.push('ナビゲーションボタン');
        }
        score += 0.1; // 基本実行可能性
      } else {
        issues.push('ナビゲーション要素が見つかりません');
        suggestions.push('リンクまたはナビゲーションボタンの存在確認をお願いします');
      }
      break;

    case 'data_verification':
      // データ入力・確認系
      if (domInfo.elements.inputs.length > 0 && domInfo.elements.buttons.length > 0) {
        score += 0.8;
        matchedElements.push('データ入力・確認フロー');
        score += 0.2; // 実行完了可能性
      } else {
        issues.push('データ入力または確認機能が不足しています');
      }
      break;

    case 'error_handling':
      // エラー系は条件次第で実行可能
      score += 0.6;
      suggestions.push('エラー発生条件の手動確認が必要です');
      break;

    case 'edge_case':
      // エッジケースは部分的に実行可能
      score += 0.4;
      suggestions.push('エッジケースの安全な実行環境の確認が必要です');
      break;

    default:
      // 汎用ケース
      score += 0.5;
      break;
  }

  return {
    score: Math.min(score, 1.0),
    matchedElements,
    issues,
    suggestions
  };
}

/**
 * URLとテストケースの適合性を計算
 * @param {Object} testCase - テストケース
 * @param {string} currentPageUrl - 現在のページURL
 * @returns {number} 適合性スコア (0-1)
 */
function calculateUrlCompatibility(testCase, currentPageUrl) {
  if (!currentPageUrl || !testCase.original_viewpoint) {
    return 0.5; // 情報不足の場合は中間値
  }
  
  const urlLower = currentPageUrl.toLowerCase();
  const viewpointLower = testCase.original_viewpoint.toLowerCase();
  
  // URL パターンとテストケース内容のマッピング
  const urlPatterns = [
    {
      pattern: /login\.html?$/,
      keywords: ['ログイン', 'login', 'メールアドレス', 'パスワード', 'email', 'password'],
      negativeKeywords: ['宿泊', '予約', '連絡方法', 'contact', 'reserve', 'booking']
    },
    {
      pattern: /plans\.html?$|reserve|booking/,
      keywords: ['宿泊', '予約', '連絡方法', 'contact', 'reserve', 'booking', '宿泊日', '人数'],
      negativeKeywords: ['ログイン', 'login', 'signup', '会員登録']
    },
    {
      pattern: /signup\.html?$|register/,
      keywords: ['会員登録', 'signup', 'register', '新規', '登録'],
      negativeKeywords: ['ログイン', 'login', '宿泊', '予約']
    },
    {
      pattern: /index\.html?$|home|top/,
      keywords: ['ホーム', 'home', 'トップ', 'index'],
      negativeKeywords: []
    }
  ];
  
  for (const urlPattern of urlPatterns) {
    if (urlPattern.pattern.test(urlLower)) {
      let score = 0.5; // 基本スコア
      
      // 適合キーワードのチェック
      const matchingKeywords = urlPattern.keywords.filter(keyword => 
        viewpointLower.includes(keyword)
      );
      if (matchingKeywords.length > 0) {
        score += 0.3 + (matchingKeywords.length * 0.1); // キーワード数に応じてボーナス
      }
      
      // 不適合キーワードのチェック
      const negativeMatches = urlPattern.negativeKeywords.filter(keyword => 
        viewpointLower.includes(keyword)
      );
      if (negativeMatches.length > 0) {
        score -= 0.6; // 不適合キーワードがある場合は大幅減点
        console.log(`🔍 不適合キーワード検出: ${negativeMatches.join(', ')} in ${viewpointLower.substring(0, 50)}...`);
      }
      
      return Math.max(0, Math.min(1, score));
    }
  }
  
  // どのパターンにも一致しない場合は中間値
  return 0.4;
}

/**
 * 実行可能なテストケースをPlaywright形式に変換
 * @param {Object} testCase - 自然言語テストケース
 * @param {Object} domInfo - DOM情報
 * @param {string} targetUrl - 対象URL
 * @returns {Object} Playwright実装
 */
function convertToPlaywrightImplementation(testCase, domInfo, targetUrl) {
  console.log(`🔄 変換中: ${testCase.title}`);
  
  // 新しいDOM解析ベースのテストジェネレータを初期化
  const domGenerator = new DOMBasedTestGenerator(domInfo);
  
  // フェーズ2: 包括的テストジェネレータも初期化
  const comprehensiveGenerator = new ComprehensiveTestGenerator(domInfo, { targetUrl });
  
  const steps = [];

  // 1. ページ読み込み
  steps.push({
    label: 'ページにアクセス',
    action: 'load',
    target: targetUrl
  });

  // 2. 包括的テストが必要かどうかを判定
  const needsComprehensiveTest = testCase.priority === 'high' || 
                                  testCase.description.includes('包括') || 
                                  testCase.description.includes('詳細') ||
                                  testCase.description.includes('バリデーション');

  if (needsComprehensiveTest) {
    console.log(`🎯 包括的テスト生成モード: ${testCase.title}`);
    
    // DOM要素に対する包括的テストケース生成
    const relevantElements = findRelevantElements(testCase, domInfo);
    
    relevantElements.forEach(element => {
      const comprehensiveTestCase = comprehensiveGenerator.generateComprehensiveTestCase(element, 'complete_validation');
      
      // 包括的テストケースのステップを統合
      comprehensiveTestCase.steps.forEach(step => {
        steps.push({
          ...step,
          // 元のテストケース情報を保持
          original_viewpoint: testCase.original_viewpoint,
          test_case_id: testCase.id,
          comprehensive_test: true
        });
      });
      
      console.log(`✅ ${element.name || element.id}要素の包括的テスト生成完了: ${comprehensiveTestCase.steps.length}ステップ`);
    });
  } else {
    // 3. 標準のDOM解析ベースのスマートステップ生成
    if (testCase.description.includes('プルダウン') || testCase.description.includes('select') || testCase.description.includes('選択')) {
      generateSmartSelectSteps(testCase, domInfo, steps, domGenerator);
    }
    
    if (testCase.description.includes('入力') || testCase.description.includes('input') || testCase.description.includes('フィールド')) {
      generateSmartInputSteps(testCase, domInfo, steps, domGenerator);
    }
    
    if (testCase.description.includes('ボタン') || testCase.description.includes('button') || testCase.description.includes('クリック')) {
      generateSmartButtonSteps(testCase, domInfo, steps, domGenerator);
    }
    
    if (testCase.description.includes('表示') || testCase.description.includes('確認') || testCase.description.includes('検証')) {
      generateSmartValidationSteps(testCase, domInfo, steps, domGenerator);
    }

    // 従来のロジックも併用（後方互換性）
    generateDisplaySteps(testCase, domInfo, steps);
    generateInputValidationSteps(testCase, domInfo, steps);
    generateInteractionSteps(testCase, domInfo, steps);
    generateNavigationSteps(testCase, domInfo, steps);
    generateDataVerificationSteps(testCase, domInfo, steps);
    generateGeneralSteps(testCase, domInfo, steps);
  }

  console.log(`✅ 変換完了: ${steps.length}ステップ生成 (包括的: ${needsComprehensiveTest})`);
  return steps;
}

/**
 * テストケースに関連する要素を特定
 */
function findRelevantElements(testCase, domInfo) {
  const relevantElements = [];
  const allElements = [
    ...(domInfo.elements.inputs || []),
    ...(domInfo.elements.buttons || [])
  ];

  allElements.forEach(element => {
    const elementName = element.name || element.id || element.text || '';
    const elementType = element.tagName || element.type || '';
    
    // テストケースの説明に要素名やタイプが含まれているかチェック
    if (testCase.description.includes(elementName) || 
        testCase.description.includes(elementType) ||
        testCase.title.includes(elementName)) {
      relevantElements.push(element);
    }
    
    // select要素で「ご連絡方法」関連の場合
    if (element.tagName === 'select' && element.name === 'contact' && 
        (testCase.description.includes('連絡') || testCase.description.includes('選択'))) {
      relevantElements.push(element);
    }
  });

  // 関連要素が見つからない場合は、全ての主要要素を対象にする
  if (relevantElements.length === 0 && testCase.priority === 'high') {
    return allElements.slice(0, 3); // 最初の3要素に限定
  }

  return relevantElements;
}

/**
 * スマートなselect要素ステップ生成
 */
function generateSmartSelectSteps(testCase, domInfo, steps, domGenerator) {
  const selectElements = domInfo.elements.inputs?.filter(el => el.tagName === 'select') || [];
  
  selectElements.forEach(selectElement => {
    if (testCase.description.includes(selectElement.name) || testCase.description.includes('ご連絡方法')) {
      console.log(`🎯 select要素「${selectElement.name}」の高度テスト生成中...`);
      
      // 複雑なテストシーケンスを生成
      const actionSequence = domGenerator.generateOptimalActionSequence(selectElement, 'complex');
      
      actionSequence.forEach(action => {
        steps.push({
          ...action,
          // トレーサビリティ情報を追加
          original_viewpoint: testCase.original_viewpoint,
          generated_from_dom: true,
          dom_element_info: {
            tagName: selectElement.tagName,
            name: selectElement.name,
            options: selectElement.options
          }
        });
      });
      
      console.log(`✅ select要素「${selectElement.name}」に${actionSequence.length}個のアクションを生成`);
    }
  });
}

/**
 * スマートな入力要素ステップ生成
 */
function generateSmartInputSteps(testCase, domInfo, steps, domGenerator) {
  const inputElements = domInfo.elements.inputs?.filter(el => el.tagName === 'input') || [];
  
  inputElements.forEach(inputElement => {
    const testComplexity = testCase.priority === 'high' ? 'complex' : 'validation';
    const actionSequence = domGenerator.generateOptimalActionSequence(inputElement, testComplexity);
    
    actionSequence.forEach(action => {
      steps.push({
        ...action,
        original_viewpoint: testCase.original_viewpoint,
        generated_from_dom: true,
        dom_element_info: {
          tagName: inputElement.tagName,
          type: inputElement.type,
          name: inputElement.name,
          required: inputElement.required
        }
      });
    });
  });
}

/**
 * スマートなボタン要素ステップ生成
 */
function generateSmartButtonSteps(testCase, domInfo, steps, domGenerator) {
  const buttonElements = domInfo.elements.buttons || [];
  
  buttonElements.forEach(buttonElement => {
    if (testCase.description.includes(buttonElement.text) || testCase.description.includes('送信') || testCase.description.includes('確認')) {
      const actionSequence = domGenerator.generateOptimalActionSequence(buttonElement, 'validation');
      
      actionSequence.forEach(action => {
        steps.push({
          ...action,
          original_viewpoint: testCase.original_viewpoint,
          generated_from_dom: true,
          dom_element_info: {
            tagName: buttonElement.tagName,
            text: buttonElement.text,
            type: buttonElement.type
          }
        });
      });
    }
  });
}

/**
 * スマートな検証ステップ生成
 */
function generateSmartValidationSteps(testCase, domInfo, steps, domGenerator) {
  // 全要素に対する包括的検証
  const allElements = [
    ...(domInfo.elements.inputs || []),
    ...(domInfo.elements.buttons || [])
  ];
  
  allElements.forEach(element => {
    // 要素の存在確認
    steps.push({
      label: `「${element.name || element.id || element.text}」要素の存在確認`,
      action: 'assertVisible',
      target: domGenerator.generateRobustSelector(element),
      original_viewpoint: testCase.original_viewpoint,
      generated_from_dom: true,
      validation_type: 'existence_check'
    });
  });
}

/**
 * 表示確認系Playwright実装生成
 */
function generateDisplaySteps(testCase, domInfo, steps) {
  // 主要要素の表示確認
  domInfo.elements.headings.forEach((heading, index) => {
    if (index < 3) { // 上位3つの見出しのみ
      steps.push({
        label: `見出し「${heading.text}」が表示されていることを確認`,
        action: "assertVisible",
        target: heading.selector
      });
    }
  });

  // 重要なボタンの表示確認
  domInfo.elements.buttons.forEach((button, index) => {
    if (index < 2) { // 上位2つのボタンのみ
      steps.push({
        label: `ボタン「${button.text}」が表示されていることを確認`,
        action: "assertVisible",
        target: button.selector
      });
    }
  });

  return createRouteObject(testCase, steps);
}

/**
 * 入力検証系Playwright実装生成
 */
function generateInputValidationSteps(testCase, domInfo, steps) {
  // 各入力フィールドに対する検証
  domInfo.elements.inputs.forEach((input, index) => {
    if (input.type === 'text' || input.type === 'email' || input.type === 'number') {
      const testValue = generateTestValue(input.type);
      
      steps.push({
        label: `${input.name || input.type}フィールドに有効な値を入力`,
        action: "fill",
        target: input.recommendedSelector,
        value: testValue
      });

      // 無効値のテスト
      const invalidValue = generateInvalidValue(input.type);
      steps.push({
        label: `${input.name || input.type}フィールドに無効な値を入力`,
        action: "fill",
        target: input.recommendedSelector,
        value: invalidValue
      });
    }
  });

  // 送信ボタンの操作 - 堅牢なセレクタを使用
  const submitButton = domInfo.elements.buttons.find(btn => 
    btn.text.includes('送信') || btn.text.includes('確認') || btn.type === 'submit'
  );
  
  if (submitButton) {
    steps.push({
      label: "フォームを送信",
      action: "click",
      target: submitButton.selector // 既に堅牢なセレクタが設定済み
    });
  }

  return createRouteObject(testCase, steps);
}

/**
 * 入力検証系のステップをDOM情報から生成（依存関係対応版）
 */
function generateInputValidationStepsFromDOM(steps, domInfo, testGoal = null) {
  console.log('🔍 DOM情報から入力検証ステップを生成中...');
  
  // 包括的な値生成戦略を構築
  console.log('🎯 包括的な値生成戦略を構築中...');
  const valueStrategy = testGoal ? generateComprehensiveValueStrategy(testGoal, domInfo) : null;
  const recommendations = valueStrategy?.recommendations || {};
  
  // ユーザーストーリーから具体的な値を抽出
  console.log('🔍 ユーザーストーリーから具体的な値を抽出中...');
  if (testGoal && typeof testGoal === 'string') {
    const userStoryValues = extractUserStoryValues(testGoal);
    if (Object.keys(userStoryValues).length > 0) {
      console.log('✅ 抽出された値:', userStoryValues);
      Object.assign(recommendations, userStoryValues);
    }
  }
  
  console.log(`✅ 値生成戦略構築完了: ${Object.keys(recommendations).length}個のフィールドに対応`);
  
  // 現在のページURLを取得（domInfo.urlから）
  const currentPageUrl = domInfo.url || domInfo.pageUrl || '';
  console.log(`🔍 現在のページURL: ${currentPageUrl}`);
  
  // 動的要素の依存関係パターン（ページ別）
  const dynamicElementPatterns = [
    {
      name: 'email_field_reservation',
      targetPattern: /email/i,
      pagePattern: /reserve|plans|booking/i, // 宿泊予約ページのみ
      dependencies: [
        {
          label: '確認のご連絡方法のプルダウンから「メールでのご連絡」を選択',
          action: 'fill',
          target: '[name="contact"]',
          value: 'email'
        },
        {
          label: 'メールアドレス入力欄が表示されるまで待機',
          action: 'waitForSelector',
          target: '[name="email"]'
        }
      ]
    },
    {
      name: 'phone_field_reservation',
      targetPattern: /phone|tel/i,
      pagePattern: /reserve|plans|booking/i, // 宿泊予約ページのみ
      dependencies: [
        {
          label: '確認のご連絡方法のプルダウンから「電話でのご連絡」を選択',
          action: 'fill',
          target: '[name="contact"]',
          value: 'tel'
        },
        {
          label: '電話番号入力欄が表示されるまで待機',
          action: 'waitForSelector',
          target: '[name="phone"]'
        }
      ]
    }
  ];

  // 入力要素を処理
  domInfo.elements.inputs.forEach(input => {
    const inputSelector = input.recommendedSelector;
    
    // 動的要素の依存関係をチェック（ページURL判定付き）
    let dependencies = [];
    for (const pattern of dynamicElementPatterns) {
      // ページパターンが定義されている場合は、現在のページがマッチするかチェック
      if (pattern.pagePattern && !pattern.pagePattern.test(currentPageUrl)) {
        continue; // ページがマッチしない場合はスキップ
      }
      
      if (pattern.targetPattern.test(input.name || input.id || '')) {
        dependencies = pattern.dependencies;
        console.log(`📋 依存関係を適用: ${pattern.name} (${input.name})`);
        break;
      }
    }

    // 依存ステップを先に追加
    dependencies.forEach(dep => {
      steps.push({
        label: dep.label,
        action: dep.action,
        target: dep.target,
        value: dep.value
      });
    });

    // 入力要素のテストステップを追加
    if (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA') {
      // 推奨値戦略から最適な値を選択
      const validValue = recommendations[input.name]?.value || generateTestValueForInput(input.type);
      steps.push({
        label: `${input.name || input.id || input.type}に有効な値を入力`,
        action: 'fill',
        target: inputSelector,
        value: validValue
      });

      // 必須チェック（required属性がある場合）
      // シナリオ管理からの機能テストの場合は必須チェックをスキップ
      if (!testGoal?.includes('【機能テスト】') && input.required) {
        steps.push({
          label: `${input.name || input.id || input.type}を空にして必須チェック`,
          action: 'fill',
          target: inputSelector,
          value: ''
        });
      }

      // 無効な値のテスト（適切な場合のみ）
      // シナリオ管理からの機能テストの場合は無効値テストをスキップ
      if (!testGoal?.includes('【機能テスト】') && (input.type === 'email' || input.type === 'number')) {
        const invalidValue = generateInvalidValue(input.type);
        steps.push({
          label: `${input.name || input.id || input.type}に無効な値を入力してバリデーション確認`,
          action: 'fill',
          target: inputSelector,
          value: invalidValue
        });
      }
    } else if (input.tagName === 'SELECT') {
      // セレクトボックスの場合
      steps.push({
        label: `${input.name || input.id}から有効な値を選択`,
        action: 'selectOption',
        target: inputSelector,
        value: 'option1' // 実際のオプション値に置き換える必要がある
      });
    }
  });

  // 送信ボタンの操作 - 堅牢なセレクタを使用
  const submitButton = domInfo.elements.buttons.find(btn => 
    btn.text.includes('送信') || btn.text.includes('確認') || btn.text.includes('予約') || btn.text.includes('ログイン') || btn.type === 'submit'
  );
  
  if (submitButton) {
    steps.push({
      label: `「${submitButton.text}」ボタンをクリック`,
      action: "click",
      target: submitButton.selector // 既に堅牢なセレクタが設定済み
    });
  }

  console.log(`✅ 入力検証ステップ生成完了: ${steps.length}ステップ`);
  return steps;
}

/**
 * インタラクション系Playwright実装生成
 */
function generateInteractionSteps(testCase, domInfo, steps) {
  // ボタンクリック
  domInfo.elements.buttons.forEach((button, index) => {
    if (index < 2) {
      steps.push({
        label: `「${button.text}」ボタンをクリック`,
        action: "click",
        target: button.selector
      });
    }
  });

  // プルダウン選択
  const selectInputs = domInfo.elements.inputs.filter(input => input.tagName === 'SELECT');
  selectInputs.forEach((select, index) => {
    if (index < 2) {
      steps.push({
        label: `${select.name || 'プルダウン'}で選択`,
        action: "fill",
        target: select.recommendedSelector,
        value: "最初のオプション" // 実際の実装ではoptionを動的取得
      });
    }
  });

  return createRouteObject(testCase, steps);
}

/**
 * ナビゲーション系Playwright実装生成
 */
function generateNavigationSteps(testCase, domInfo, steps) {
  // リンククリック
  domInfo.elements.links.forEach((link, index) => {
    if (index < 2) {
      steps.push({
        label: `「${link.text}」リンクをクリック`,
        action: "click",
        target: link.selector
      });
      
      if (link.href && link.href !== '#') {
        steps.push({
          label: "ページ遷移を確認",
          action: "waitForURL",
          target: link.href
        });
      }
    }
  });

  return createRouteObject(testCase, steps);
}

/**
 * データ検証系Playwright実装生成
 */
function generateDataVerificationSteps(testCase, domInfo, steps) {
  // データ入力
  domInfo.elements.inputs.forEach((input, index) => {
    if (index < 3) {
      const testValue = generateTestValue(input.type);
      steps.push({
        label: `${input.name || input.type}に有効なテストデータを入力`,
        action: "fill",
        target: input.recommendedSelector,
        value: testValue
      });
    }
  });

  // 送信
  const submitButton = domInfo.elements.buttons.find(btn => 
    btn.text.includes('送信') || btn.text.includes('確認')
  );
  
  if (submitButton) {
    steps.push({
      label: "データを送信",
      action: "click",
      target: submitButton.selector
    });

    // データ確認
    steps.push({
      label: "入力データが正しく反映されていることを確認",
      action: "assertVisible",
      target: ":has-text(\"入力した値\")" // 実際には入力値を動的に設定
    });
  }

  return createRouteObject(testCase, steps);
}

/**
 * 汎用Playwright実装生成
 */
function generateGeneralSteps(testCase, domInfo, steps) {
  // 基本的な操作のみ
  if (domInfo.elements.buttons.length > 0) {
    const mainButton = domInfo.elements.buttons[0];
    steps.push({
      label: `メインボタン「${mainButton.text}」をクリック`,
      action: "click",
      target: mainButton.selector
    });
  }

  return createRouteObject(testCase, steps);
}

/**
 * ルートオブジェクトを作成
 */
function createRouteObject(testCase, steps) {
  return {
    route_id: `route_${getTimestamp()}`,
    generated_from_natural_case: testCase.id,
    original_viewpoint: testCase.original_viewpoint,
    category: testCase.category,
    priority: testCase.priority,
    steps: steps,
    generated_at: new Date().toISOString(),
    metadata: {
      source: 'generateSmartRoutes.js',
      version: '2.0.0',
      type: 'playwright_implementation',
      generation_method: 'dom_matching'
    }
  };
}

/**
 * テスト用の値を生成
 */
function generateTestValue(inputType) {
  switch (inputType) {
    case 'email':
      return 'test@example.com';
    case 'number':
      return '123';
    case 'date':
      return '2025/07/25';
    case 'tel':
      return '090-1234-5678';
    case 'text':
      return '有効なテキスト';
    case 'textarea':
      return '有効なテキスト';
    default:
      return '有効なテキスト'; // "テストデータ"から"有効なテキスト"に変更
  }
}

/**
 * 無効値を生成
 */
function generateInvalidValue(inputType) {
  switch (inputType) {
    case 'email':
      return 'invalid-email';
    case 'number':
      return 'abc';
    case 'date':
      // 過去の日付を返す（3ヶ月以内制限に違反）
      return '2023/12/25';
    default:
      return ''; // 空文字
  }
}

/**
 * 自然言語テストケースからPlaywright実装を生成
 * @param {Object} naturalCase - 自然言語テストケース
 * @param {Object} domInfo - DOM情報
 * @param {string} url - 対象URL
 * @param {Object} userStoryInfo - ユーザーストーリー情報
 * @param {string} testGoal - ユーザーストーリーの goal 文字列
 * @returns {Object} Playwright実装
 */
function generatePlaywrightRouteFromNaturalCase(naturalCase, domInfo, url, userStoryInfo, testGoal = null) {
  const steps = [];
  
  // 基本的なページアクセス
  steps.push({
    label: "対象ページにアクセスする",
    action: "load",
    target: url
  });

  // カテゴリ別の実装生成（ユーザーストーリーの具体的な値を渡す）
  switch (naturalCase.category) {
    case 'display':
      generateDisplayStepsFromDOM(steps, domInfo);
      break;
    case 'input_validation':
      generateInputValidationStepsFromDOM(steps, domInfo, testGoal);
      break;
    case 'interaction':
      generateInteractionStepsFromDOM(steps, domInfo);
      break;
    case 'navigation':
      generateNavigationStepsFromDOM(steps, domInfo);
      break;
    case 'data_verification':
      generateDataVerificationStepsFromDOM(steps, domInfo, testGoal);
      break;
    default:
      generateGeneralStepsFromDOM(steps, domInfo);
      break;
  }

  return {
    route_id: `route_${getTimestamp()}`,
    generated_from_natural_case: naturalCase.id,
    original_viewpoint: naturalCase.original_viewpoint,
    category: naturalCase.category,
    priority: naturalCase.priority,
    user_story_id: userStoryInfo ? userStoryInfo.currentId : null,
    steps: steps,
    generated_at: new Date().toISOString(),
    metadata: {
      source: 'generateSmartRoutes.js DOM照合',
      version: '2.0.0',
      type: 'playwright_implementation',
      generation_method: 'dom_matching'
    }
  };
}

/**
 * 表示確認系のステップをDOM情報から生成
 */
function generateDisplayStepsFromDOM(steps, domInfo) {
  // 主要要素の表示確認
  domInfo.elements.headings.forEach((heading, index) => {
    if (index < 3) { // 上位3つの見出しのみ
      steps.push({
        label: `見出し「${heading.text}」が表示されていることを確認`,
        action: "assertVisible",
        target: heading.selector
      });
    }
  });

  // 重要なボタンの表示確認
  domInfo.elements.buttons.forEach((button, index) => {
    if (index < 2) { // 上位2つのボタンのみ
      steps.push({
        label: `ボタン「${button.text}」が表示されていることを確認`,
        action: "assertVisible",
        target: button.selector
      });
    }
  });

  // 入力フィールドの表示確認
  domInfo.elements.inputs.forEach((input, index) => {
    if (index < 3) {
      const label = input.name || input.id || `入力フィールド${index + 1}`;
      steps.push({
        label: `${label}が表示されていることを確認`,
        action: "assertVisible",
        target: input.recommendedSelector
      });
    }
  });
}

/**
 * インタラクション系のステップをDOM情報から生成
 */
function generateInteractionStepsFromDOM(steps, domInfo) {
  // プルダウン選択（確認のご連絡の動的表示対応）
  const selectInputs = domInfo.elements.inputs.filter(input => input.tagName === 'SELECT');
  selectInputs.forEach((select, index) => {
    if (select.name === 'contact') {
      // 確認のご連絡の特別処理
      steps.push({
        label: "確認のご連絡方法のプルダウンから「メールでのご連絡」を選択",
        action: "fill",
        target: select.recommendedSelector,
        value: "email"
      });
      
      steps.push({
        label: "メールアドレス入力欄が表示されるまで待機",
        action: "waitForSelector",
        target: "[name='email']"
      });
      
      steps.push({
        label: "メールアドレスを入力",
        action: "fill",
        target: "[name='email']",
        value: "test@example.com"
      });
    } else if (index < 2) {
      const fieldLabel = select.name || `プルダウン${index + 1}`;
      steps.push({
        label: `${fieldLabel}で選択`,
        action: "click",
        target: select.recommendedSelector
      });
    }
  });

  // ボタンクリック（送信系以外）
  domInfo.elements.buttons.forEach((button, index) => {
    if (index < 2 && !button.text.includes('送信') && !button.text.includes('確認')) {
      steps.push({
        label: `「${button.text}」ボタンをクリック`,
        action: "click",
        target: button.selector
      });
    }
  });
}

/**
 * ナビゲーション系のステップをDOM情報から生成
 */
function generateNavigationStepsFromDOM(steps, domInfo) {
  // リンククリック
  domInfo.elements.links.forEach((link, index) => {
    if (index < 2 && link.href && link.href !== '#') {
      steps.push({
        label: `「${link.text}」リンクをクリック`,
        action: "click",
        target: link.selector
      });
      
      // 外部リンクでなければページ遷移を確認
      if (link.href.includes(domInfo.url.split('/')[2])) {
        steps.push({
          label: "ページ遷移を確認",
          action: "waitForURL",
          target: link.href
        });
      }
    }
  });
}

/**
 * ユーザーストーリーから具体的な値を抽出
 * @param {string} testGoal - ユーザーストーリーまたはテスト目標
 * @returns {Object} 抽出された値のマッピング
 */
function extractUserStoryValues(testGoal) {
  console.log('🔍 ユーザーストーリーから具体的な値を抽出中...');
  const values = {};
  
  if (!testGoal || typeof testGoal !== 'string') {
    return values;
  }
  
  // メールアドレスの抽出
  const emailMatch = testGoal.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (emailMatch) {
    values.email = emailMatch[1];
    console.log(`  📧 メールアドレス: ${values.email}`);
  }
  
  // パスワードの抽出
  const passwordMatch = testGoal.match(/パスワード[：:\s]*([^\s、,。\n]+)/i) || 
                       testGoal.match(/password[：:\s]*([^\s、,。\n]+)/i);
  if (passwordMatch) {
    values.password = passwordMatch[1];
    console.log(`  🔑 パスワード: ${values.password}`);
  }
  
  // 名前の抽出
  const nameMatch = testGoal.match(/名前[：:\s]*([^\s、,。\n]+)/i) || 
                   testGoal.match(/氏名[：:\s]*([^\s、,。\n]+)/i) ||
                   testGoal.match(/username[：:\s]*([^\s、,。\n]+)/i);
  if (nameMatch) {
    values.username = nameMatch[1];
    values.name = nameMatch[1];
    console.log(`  👤 名前: ${values.username}`);
  }
  
  // 日付の抽出
  const dateMatch = testGoal.match(/(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/);
  if (dateMatch) {
    values.date = dateMatch[1];
    console.log(`  📅 日付: ${values.date}`);
  }
  
  // 電話番号の抽出
  const phoneMatch = testGoal.match(/(\d{2,4}[\-\s]?\d{2,4}[\-\s]?\d{4})/);
  if (phoneMatch) {
    values.phone = phoneMatch[1];
    values.tel = phoneMatch[1];
    console.log(`  📞 電話番号: ${values.phone}`);
  }
  
  console.log(`✅ ${Object.keys(values).length}個の具体的な値を抽出しました`);
  return values;
}

/**
 * データ検証系のステップをDOM情報から生成
 * @param {Array} steps - ステップ配列
 * @param {Object} domInfo - DOM情報
 * @param {string} testGoal - ユーザーストーリーまたはgoal文字列
 */
function generateDataVerificationStepsFromDOM(steps, domInfo, testGoal = null) {
  // ユーザーストーリーから具体的な値を抽出
  const userStoryValues = testGoal ? extractUserStoryValues(testGoal) : {};
  
  // デフォルト値（フォールバック用）
  const defaultTestDataSet = {
    date: "2025/07/25",
    term: "2",
    "head-count": "2", 
    username: "山田太郎",
    email: "test@example.com"
  };
  
  // ユーザーストーリーの値を優先し、不足分はデフォルト値で補完
  const testDataSet = { ...defaultTestDataSet, ...userStoryValues };
  
  console.log('📋 使用するテストデータ:', testDataSet);

  // データ入力
  domInfo.elements.inputs.forEach((input, index) => {
    if (input.name && testDataSet[input.name]) {
      steps.push({
        label: `${input.name}に有効な値を入力`,
        action: "fill",
        target: input.recommendedSelector,
        value: testDataSet[input.name]
      });
    } else if (input.type && input.type !== 'submit' && input.type !== 'button') {
      const testValue = generateTestValueForInput(input.type);
      const fieldLabel = input.placeholder || input.id || `フィールド${index + 1}`;
      steps.push({
        label: `${fieldLabel}に有効な値を入力`,
        action: "fill",
        target: input.recommendedSelector,
        value: testValue
      });
    }
  });

  // プルダウン選択（確認のご連絡の動的表示対応）
  const selectInputs = domInfo.elements.inputs.filter(input => input.tagName === 'SELECT');
  selectInputs.forEach((select) => {
    if (select.name === 'contact' && testDataSet.contact) {
      // 確認のご連絡の特別処理
      const contactText = testDataSet.contact === 'email' ? 'メールでのご連絡' : 'telでのご連絡';
      steps.push({
        label: `確認のご連絡方法のプルダウンから「${contactText}」を選択`,
        action: "fill",
        target: select.recommendedSelector,
        value: testDataSet.contact
      });
      
      if (testDataSet.contact === 'email') {
        steps.push({
          label: "メールアドレス入力欄が表示されるまで待機",
          action: "waitForSelector",
          target: "[name='email']"
        });
        
        steps.push({
          label: "メールアドレスを入力",
          action: "fill",
          target: "[name='email']",
          value: testDataSet.email
        });
      } else if (testDataSet.contact === 'tel') {
        steps.push({
          label: "電話番号入力欄が表示されるまで待機",
          action: "waitForSelector",
          target: "[name='tel'], [name='phone']"
        });
        
        steps.push({
          label: "電話番号を入力",
          action: "fill",
          target: "[name='tel'], [name='phone']",
          value: "090-1234-5678"
        });
      }
    } else {
      const fieldLabel = select.name || `プルダウン${selectInputs.indexOf(select) + 1}`;
      steps.push({
        label: `${fieldLabel}で選択`,
        action: "selectOption",
        target: select.recommendedSelector,
        value: "最初のオプション"
      });
    }
  });

  // チェックボックス処理（朝食バイキングなど）
  if (testDataSet.breakfast) {
    const breakfastCheckbox = domInfo.elements.inputs.find(input => 
      input.name === 'breakfast' || input.id === 'breakfast'
    );
    if (breakfastCheckbox) {
      steps.push({
        label: "朝食バイキングを選択",
        action: "click",
        target: breakfastCheckbox.recommendedSelector
      });
    }
  }

  // コメント入力
  if (testDataSet.comment) {
    const commentField = domInfo.elements.inputs.find(input => 
      input.name === 'comment' || input.id === 'comment'
    );
    if (commentField) {
      steps.push({
        label: "ご要望・ご連絡事項を入力",
        action: "fill",
        target: commentField.recommendedSelector,
        value: testDataSet.comment
      });
    }
  }

  // 送信ボタンの操作
  const submitButton = domInfo.elements.buttons.find(btn => 
    btn.text.includes('送信') || btn.text.includes('確認') || btn.text.includes('予約') || btn.type === 'submit'
  );
  
  if (submitButton) {
    steps.push({
      label: `「${submitButton.text}」ボタンをクリック`,
      action: "click",
      target: submitButton.selector
    });
  }
  
  console.log(`✅ データ検証ステップ生成完了: ${steps.length}ステップ`);
}

/**
 * 汎用のステップをDOM情報から生成
 */
function generateGeneralStepsFromDOM(steps, domInfo) {
  // 基本的な操作のみ
  if (domInfo.elements.buttons.length > 0) {
    const mainButton = domInfo.elements.buttons[0];
    steps.push({
      label: `メインボタン「${mainButton.text}」をクリック`,
      action: "click",
      target: mainButton.selector
    });
  }

  if (domInfo.elements.links.length > 0) {
    const mainLink = domInfo.elements.links[0];
    steps.push({
      label: `メインリンク「${mainLink.text}」をクリック`,
      action: "click",
      target: mainLink.selector
    });
  }
}

/**
 * 入力タイプに応じたテスト値を生成
 */
function generateTestValueForInput(inputType) {
  switch (inputType) {
    case 'email':
      return 'test@example.com';
    case 'number':
      return '123';
    case 'date':
      return '2025/07/25';
    case 'tel':
      return '090-1234-5678';
    case 'password':
      return 'password123';
    case 'url':
      return 'https://example.com';
    case 'text':
      return '有効なテキスト';
    case 'textarea':
      return '有効なテキスト';
    default:
      return '有効なテキスト'; // "テストデータ"から"有効なテキスト"に変更
  }
}

/**
 * 汎用的な日付バリデーションテストステップの生成
 */
function generateGenericDateValidationSteps(domInfo, baseUrl) {
  const steps = [];
  
  // 日付フィールドを検索
  const dateFields = domInfo.elements.inputs.filter(input => 
    input.type === 'date' || 
    input.name && input.name.toLowerCase().includes('date') ||
    input.id && input.id.toLowerCase().includes('date') ||
    input.placeholder && input.placeholder.toLowerCase().includes('日付')
  );

  if (dateFields.length === 0) {
    console.log('⏭️ 日付フィールドが見つからないため、日付バリデーションテストをスキップします');
    return null;
  }

  steps.push({
    label: "対象ページにアクセス",
    action: "load",
    target: baseUrl
  });

  // 各日付フィールドに対してテスト
  dateFields.forEach((dateField, index) => {
    const fieldName = dateField.name || dateField.id || `date-field-${index}`;
    const fieldSelector = dateField.recommendedSelector || `[name="${dateField.name}"]` || `#${dateField.id}`;

    // 過去の日付テスト
    const pastDate = getPastDateString();
    steps.push({
      label: `${fieldName}に過去の日付を入力`,
      action: "fill",
      target: fieldSelector,
      value: pastDate
    });

    // 他の必須フィールドを埋める（汎用的に）
    fillRequiredFields(steps, domInfo, dateField);

    // バリデーションエラーの確認（複数のパターンを試行）
    steps.push({
      label: `${fieldName}のバリデーションエラーを確認`,
      action: "checkValidationError",
      target: fieldSelector,
      expectedErrorIndicators: [
        `.invalid-feedback:visible`,
        `.error:visible`,
        `[class*="error"]:visible`,
        `.form-error:visible`,
        `.field-error:visible`,
        `[aria-invalid="true"]`
      ]
    });

    // フォーム送信テスト
    const submitButton = findSubmitButton(domInfo);
    if (submitButton) {
      steps.push({
        label: "フォーム送信を試行",
        action: "click",
        target: submitButton.selector
      });

      steps.push({
        label: "無効な日付のためページに留まることを確認",
        action: "checkPageStay",
        target: baseUrl,
        timeout: 3000
      });
    }

    // 有効な日付でのテスト
    const futureDate = getFutureDateString(7); // 1週間後
    steps.push({
      label: `${fieldName}に有効な日付を入力`,
      action: "fill",
      target: fieldSelector,
      value: futureDate
    });

    if (submitButton) {
      steps.push({
        label: "有効な日付でフォーム送信",
        action: "click",
        target: submitButton.selector
      });

      steps.push({
        label: "有効な日付のため次画面に遷移することを確認",
        action: "checkPageTransition",
        target: baseUrl,
        timeout: 10000
      });
    }
  });

  return {
    route_id: `generic_date_validation_${getTimestamp()}`,
    category: 'date_validation',
    title: '汎用日付バリデーションテスト',
    steps: steps,
    generated_at: new Date().toISOString(),
    test_focus: 'generic_date_validation',
    fields_tested: dateFields.map(f => f.name || f.id)
  };
}

/**
 * 過去の日付文字列を生成（汎用的）
 */
function getPastDateString() {
  const pastDate = new Date();
  pastDate.setFullYear(pastDate.getFullYear() - 1); // 1年前
  return formatDateForInput(pastDate);
}

/**
 * 未来の日付文字列を生成（汎用的）
 */
function getFutureDateString(daysFromNow = 7) {
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + daysFromNow);
  return formatDateForInput(futureDate);
}

/**
 * 日付を複数の形式で生成（サイトによって異なるため）
 */
function formatDateForInput(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  
  // 一般的な日付形式を試行（サイトに応じて自動調整）
  return `${yyyy}/${mm}/${dd}`; // デフォルト形式
}

/**
 * 必須フィールドを汎用的に埋める
 */
function fillRequiredFields(steps, domInfo, excludeField) {
  const requiredFields = domInfo.elements.inputs.filter(input => 
    input.required && input !== excludeField
  );

  requiredFields.forEach(field => {
    const testValue = generateTestValueForInput(field.type);
    if (testValue) {
      steps.push({
        label: `${field.name || field.id || 'フィールド'}に有効な値を入力`,
        action: "fill",
        target: field.recommendedSelector || `[name="${field.name}"]` || `#${field.id}`,
        value: testValue
      });
    }
  });
}

/**
 * 送信ボタンを汎用的に検索
 */
function findSubmitButton(domInfo) {
  return domInfo.elements.buttons.find(btn => 
    btn.type === 'submit' ||
    btn.text && (
      btn.text.includes('送信') || 
      btn.text.includes('確認') || 
      btn.text.includes('予約') ||
      btn.text.includes('Submit') ||
      btn.text.includes('送る')
    )
  );
}

/**
 * 分類別一括処理モード
 */
async function processCategoryBatch(testCasesData, pageInfo, url, userStoryInfo, testGoal = null) {
  const batchResults = {
    batch_id: `batch_${getTimestamp()}`,
    processing_mode: 'category_batch',
    processed_at: new Date().toISOString(),
    categories: [],
    summary: {
      total_categories: testCasesData.categoryData.length,
      total_test_cases: testCasesData.testCases.length,
      feasible_categories: 0,
      generated_routes: 0
    }
  };

  console.log(`📊 ${batchResults.summary.total_categories}分類の一括処理を開始...`);

  for (const categoryData of testCasesData.categoryData) {
    console.log(`\n🔄 処理中: ${categoryData.category} (${categoryData.testCases.length}件)`);
    
    try {
      const feasibilityAnalysis = analyzeTestCaseFeasibility(pageInfo, categoryData.testCases);
      
      const categoryResult = {
        category: categoryData.category,
        test_case_count: categoryData.testCases.length,
        feasible_count: feasibilityAnalysis.feasibleCases.length,
        problematic_count: feasibilityAnalysis.problematicCases.length,
        routes: []
      };

      if (feasibilityAnalysis.suggestedCases.length > 0) {
        // 各分類で最大3つのテストルートを生成
        const routesToGenerate = feasibilityAnalysis.suggestedCases.slice(0, 3);
        
        for (const selectedCase of routesToGenerate) {
          const playwrightRoute = generatePlaywrightRouteFromNaturalCase(selectedCase, pageInfo, url, userStoryInfo, testGoal || selectedCase.original_viewpoint);
          playwrightRoute.category = categoryData.category;
          playwrightRoute.feasibility_score = selectedCase.feasibilityScore;
          
          categoryResult.routes.push(playwrightRoute);
          batchResults.summary.generated_routes++;
        }
        
        batchResults.summary.feasible_categories++;
        console.log(`   ✅ ${categoryResult.routes.length}件のルートを生成`);
      } else {
        console.log(`   ⚠️ 実行可能なテストケースが見つかりませんでした`);
      }

      batchResults.categories.push(categoryResult);
      
    } catch (error) {
      console.error(`   ❌ ${categoryData.category}の処理に失敗:`, error.message);
      batchResults.categories.push({
        category: categoryData.category,
        error: error.message,
        routes: []
      });
    }
  }

  console.log(`\n📊 一括処理完了: ${batchResults.summary.feasible_categories}/${batchResults.summary.total_categories}分類, ${batchResults.summary.generated_routes}ルート生成`);
  return batchResults;
}

/**
 * 単一分類処理モード
 */
async function processSingleCategory(testCasesData, pageInfo, url, userStoryInfo, testGoal = null) {
  const feasibilityAnalysis = analyzeTestCaseFeasibility(pageInfo, testCasesData.testCases);
  
  if (feasibilityAnalysis.suggestedCases.length === 0) {
    console.log('⚠️ 実行可能なテストケースが見つかりませんでした');
    console.log('📋 問題のあるケース:', feasibilityAnalysis.problematicCases.length);
    throw new Error(`${testCasesData.metadata.category}分類で実行可能なテストケースが見つかりませんでした`);
  }

  // 最も適したテストケースをPlaywright実装に変換
  const selectedCase = feasibilityAnalysis.suggestedCases[0];
  console.log(`🎯 選択されたテストケース: ${selectedCase.category} - ${selectedCase.original_viewpoint.substring(0, 60)}...`);
  
  const playwrightRoute = generatePlaywrightRouteFromNaturalCase(selectedCase, pageInfo, url, userStoryInfo, testGoal || selectedCase.original_viewpoint);
  playwrightRoute.category = testCasesData.metadata.category;
  playwrightRoute.feasibility_score = selectedCase.feasibilityScore;
  playwrightRoute.processing_mode = 'single_category';
  
  console.log('✅ DOM照合によるPlaywright実装生成が完了しました');
  return playwrightRoute;
}

/**
 * レガシー互換モード
 */
async function processLegacyMode(testCasesData, pageInfo, url, userStoryInfo, testGoal = null) {
  const feasibilityAnalysis = analyzeTestCaseFeasibility(pageInfo, testCasesData.testCases);
  
  if (feasibilityAnalysis.suggestedCases.length === 0) {
    console.log('⚠️ 実行可能なテストケースが見つかりませんでした');
    console.log('📋 問題のあるケース:', feasibilityAnalysis.problematicCases.length);
    // フォールバックとして従来のAI生成を実行
    console.log('🔄 フォールバック: AI生成モードに切り替えます');
    return null; // 後続のAI生成処理にフォールバック
  }

  // 最も適したテストケースをPlaywright実装に変換
  const selectedCase = feasibilityAnalysis.suggestedCases[0];
  console.log(`🎯 選択されたテストケース: ${selectedCase.category} - ${selectedCase.original_viewpoint.substring(0, 60)}...`);
  
  const playwrightRoute = generatePlaywrightRouteFromNaturalCase(selectedCase, pageInfo, url, userStoryInfo, testGoal || selectedCase.original_viewpoint);
  playwrightRoute.processing_mode = 'legacy';
  
  console.log('✅ DOM照合によるPlaywright実装生成が完了しました');
  return playwrightRoute;
}

// スマートテストルート生成
async function generateSmartTestRoute(url, testGoal, pageInfo, testPoints = null, pdfFileInfo = null, userStoryInfo = null, naturalTestCasesFile = null) {
  // 🚀 包括的テストが要求された場合の処理（フェーズ4実装）
  if (testGoal.includes('包括') || testGoal.includes('バリデーション') || testGoal.includes('詳細') || testGoal.includes('comprehensive')) {
    console.log('🎯 包括的テスト生成モードを検出');
    
    // 包括的テストジェネレータを使用
    const comprehensiveGenerator = new ComprehensiveTestGenerator(pageInfo, userStoryInfo);
    
    // select要素が存在する場合、包括的テストを生成
    const selectElements = pageInfo.elements.inputs?.filter(el => el.tagName === 'select') || [];
    
    if (selectElements.length > 0) {
      console.log(`📋 ${selectElements.length}個のselect要素に対する包括的テスト生成中...`);
      
      const comprehensiveSteps = [];
      
      // ページ読み込み
      comprehensiveSteps.push({
        label: 'ページにアクセス',
        action: 'load',
        target: url
      });
      
      selectElements.forEach(selectElement => {
        const comprehensiveTestCase = comprehensiveGenerator.generateComprehensiveTestCase(selectElement, 'complete_validation');
        
        comprehensiveTestCase.steps.forEach(step => {
          comprehensiveSteps.push({
            ...step,
            comprehensive_test: true,
            generated_from_dom: true
          });
        });
        
        console.log(`✅ ${selectElement.name || selectElement.id}要素の包括的テスト: ${comprehensiveTestCase.steps.length}ステップ生成`);
      });
      
      // 包括的ルートを返す
      return {
        route_id: `comprehensive_route_${getTimestamp()}`,
        user_story_id: userStoryInfo?.currentId || null,
        generated_from_natural_case: naturalTestCasesFile ? `comprehensive_${Date.now()}` : null,
        original_viewpoint: testGoal,
        route_metadata: {
          complexity: 'comprehensive',
          test_approach: 'dom_based_comprehensive',
          element_count: selectElements.length,
          validation_count: comprehensiveSteps.filter(s => s.action?.startsWith('assert')).length
        },
        steps: comprehensiveSteps,
        generated_at: new Date().toISOString()
      };
    } else {
      console.log('⚠️ select要素が見つかりません。標準テスト生成にフォールバック');
    }
  }

  // 自然言語テストケースが指定されている場合はDOM照合モードで実行
  if (naturalTestCasesFile) {
    console.log('🔄 DOM照合モードで実行します');
    
    // 1. 自然言語テストケースを読み込み
    const testCasesData = loadNaturalLanguageTestCases(naturalTestCasesFile);
    
    // 処理モード別に分岐
    if (testCasesData.metadata.processing_mode === 'category_batch') {
      console.log('📂 分類別一括処理モードで実行します');
      return await processCategoryBatch(testCasesData, pageInfo, url, userStoryInfo, testGoal);
    } else if (testCasesData.metadata.processing_mode === 'single_category') {
      console.log(`📁 単一分類処理モード: ${testCasesData.metadata.category}`);
      return await processSingleCategory(testCasesData, pageInfo, url, userStoryInfo, testGoal);
    } else {
      console.log('🔄 レガシー互換モードで実行します');
      const legacyResult = await processLegacyMode(testCasesData, pageInfo, url, userStoryInfo, testGoal);
      if (legacyResult) {
        return legacyResult;
      }
      // nullの場合は従来のAI生成にフォールバック
    }
  }

  // OpenAI設定を取得
  const config = loadConfig();
  const openAIConfig = getOpenAIConfig(config);
  const openai = new OpenAI(openAIConfig);

  // 失敗制約は初回生成では使用しない（analyzeFailures.jsで使用）
  
  const system = `あなたはWebページのE2Eテストシナリオを生成する専門AIです。

重要原則：
- 実際にページに存在する要素のみを使用する
- ユーザーの意図を正確に理解し、それに沿ったテストを生成する
- 動的に取得されたDOM情報を最大限活用する
- 高い成功率を重視する
- 【機能テスト】の場合は、指定された具体的な値のみを使用し、バリデーションテストは行わない

提供される情報：
1. ページの動的DOM情報（実際に存在する要素）
2. ユーザーのテスト意図・目標
3. テスト観点（オプション）

セレクタ選択方針：
- :has-text("テキスト") を最優先（要素内テキストの柔軟な検索）
- 次に属性ベースセレクタ
- 最後にタグベースセレクタ
- 複数候補をカンマ区切りで提供

テキスト検証の重要原則：
- 入力値と一致する値で検証する（入力と同じ形式を使用）
- 例：入力「2025/07/25」→ 検証「2025/07/25」
- 例：入力「2」→ 検証「2」（単位なし）
- :has-text()により部分一致で柔軟に検索可能`;

  // 包括的な値生成戦略を構築
  const valueStrategy = generateComprehensiveValueStrategy(testGoal, pageInfo);
  
  // AIプロンプト用の値説明を生成
  const valueInstructions = generateValueInstructionsForAI(valueStrategy);
  
  let user = `以下の情報を基に、ユーザーの意図に沿った精密なE2Eテストシナリオを生成してください。

【ユーザーのテスト意図】
${testGoal}

【入力値の使用指針】
${valueInstructions}

【ページ動的DOM情報】
\`\`\`json
${JSON.stringify(pageInfo, null, 2)}
\`\`\`

【重要】
1. 上記DOM情報に含まれる要素のみを使用してください。存在しない要素は絶対に使用しないでください。
2. ユーザーストーリーから抽出された具体的な値を必ず使用してください。「テストデータ」のような汎用値は使用禁止です。
3. 【機能テスト】の場合は、正常動作の確認のみを行い、バリデーションテスト（無効値、空値テスト）は一切生成しないでください。

利用可能なアクション：
- load: ページ読み込み
- click: 要素クリック  
- fill: 入力
- assertVisible: 要素表示確認
- assertNotVisible: 要素非表示確認
- waitForSelector: 要素待機
- waitForURL: URL遷移待機

セレクタ優先順位：
1. :has-text("実際のテキスト") (DOM情報のtextから選択)
2. 属性セレクタ [name="name"], [type="type"]
3. 複数候補 "selector1, selector2, selector3"

重要：テキスト検証では入力値と完全に一致する値を使用すること

出力形式：
\`\`\`json
{
  "route_id": "route_${getTimestamp()}",
  "user_story_id": ${userStoryInfo ? userStoryInfo.currentId : 'null'},
  "steps": [
    {
      "label": "ステップ説明",
      "action": "アクション",
      "target": "セレクタ",
      "value": "入力値（オプション）"
    }
  ]
}
\`\`\``;

  if (testPoints) {
    user += `\n\n【テスト観点】
\`\`\`json
${JSON.stringify(testPoints, null, 2)}
\`\`\``;
  }

  if (pdfFileInfo) {
    user += `\n\n【仕様書】
${createPDFPrompt(pdfFileInfo)}`;
  }

  const client = new OpenAI(openAIConfig);
  
  const messages = [
    { role: 'system', content: system.trim() },
    { role: 'user', content: user.trim() }
  ];

  const res = await client.chat.completions.create({
    model: openAIConfig.model || 'gpt-4o-mini',
    messages: messages,
    temperature: openAIConfig.temperature || 0.3, // より確実性を重視
    max_tokens: openAIConfig.max_tokens || 4000,
    top_p: openAIConfig.top_p || 0.9,
  });

  // JSON抽出と解析
  const content = res.choices[0].message.content.trim();
  console.log('🛠️ [Debug] AI Response length:', content.length);
  
  // ```json ブロックまたは単純な { } ブロックを抽出
  let jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
  if (!jsonMatch) {
    jsonMatch = content.match(/\{[\s\S]*\}/);
  } else {
    jsonMatch = [null, jsonMatch[1]];
  }
  
  if (!jsonMatch) {
    throw new Error('AI応答からJSONを抽出できませんでした');
  }
  
  try {
    let jsonText = jsonMatch[1] || jsonMatch[0];
    
    // 最小限の安全なクリーニング
    jsonText = jsonText.replace(/,(\s*[}\]])/g, '$1');
    
    const routeJson = JSON.parse(jsonText);
    if (!routeJson.route_id || !routeJson.steps || !Array.isArray(routeJson.steps)) {
      throw new Error('JSONの形式が正しくありません');
    }
    
    // 動的なrouteIDとユーザーストーリーIDを設定（トレーサビリティ確保）
    const timestamp = getTimestamp();
    routeJson.route_id = `route_${timestamp}`;
    routeJson.user_story_id = userStoryInfo ? userStoryInfo.currentId : null;
    routeJson.generated_at = new Date().toISOString();
    
    return routeJson;
  } catch (parseError) {
    console.error('JSON解析エラー:', parseError);
    console.error('AI応答:', content);
    throw new Error('AI応答のJSON解析に失敗しました');
  }
}

/**
 * 失敗パターンから学習した制約を取得
 */
function getFailureConstraints() {
  try {
    const constraintsPath = path.join(process.cwd(), 'test-results', '.failure-patterns.json');
    if (!fs.existsSync(constraintsPath)) {
      return null;
    }
    
    const patterns = JSON.parse(fs.readFileSync(constraintsPath, 'utf-8'));
    const constraints = [];
    
    for (const [patternKey, pattern] of Object.entries(patterns)) {
      const failedAttempts = pattern.attempts.filter(a => !a.success);
      if (failedAttempts.length > 0) {
        constraints.push({
          target: pattern.target,
          action: pattern.action,
          errorType: pattern.errorType,
          failureCount: failedAttempts.length,
          lastFailure: failedAttempts[failedAttempts.length - 1].timestamp,
          avoidReason: `過去に${failedAttempts.length}回失敗したパターン`
        });
      }
    }
    
    return constraints.length > 0 ? constraints : null;
  } catch (error) {
    console.error('失敗制約取得エラー:', error.message);
    return null;
  }
}

/**
 * AIプロンプトに失敗制約を追加
 */
function addFailureConstraintsToPrompt(basePrompt, constraints) {
  if (!constraints || constraints.length === 0) {
    return basePrompt;
  }
  
  const constraintText = constraints.map(c => 
    `- ❌ 避けるべき: action="${c.action}", target="${c.target}" (理由: ${c.avoidReason})`
  ).join('\n');
  
  return `${basePrompt}

🚨 **重要: 以下の失敗パターンを避けてください**
${constraintText}

これらのセレクタ・アクションは過去に失敗しているため、代替手段を使用してください。
- 同じセレクタでも異なるアクション
- 同じアクションでも異なるセレクタ（より具体的、または代替セレクタ）
- より安全で確実な操作方法

必ず上記の制約を考慮してJSONを生成してください。`;
}

/**
 * 汎用的なblurバリデーションテストステップの生成
 */
function generateBlurValidationSteps(domInfo, baseUrl) {
  const steps = [];
  
  // バリデーション対象フィールドを検索
  const validationFields = domInfo.elements.inputs.filter(input => 
    input.required || 
    input.type === 'email' || 
    input.type === 'number' || 
    input.type === 'tel' ||
    input.type === 'date' ||
    (input.name && (
      input.name.toLowerCase().includes('email') ||
      input.name.toLowerCase().includes('phone') ||
      input.name.toLowerCase().includes('tel') ||
      input.name.toLowerCase().includes('date') ||
      input.name.toLowerCase().includes('name')
    ))
  );

  if (validationFields.length === 0) {
    console.log('⏭️ バリデーション対象フィールドが見つからないため、blurバリデーションテストをスキップします');
    return null;
  }

  steps.push({
    label: "対象ページにアクセス",
    action: "load",
    target: baseUrl
  });

  // 各フィールドに対してblurバリデーションテスト
  validationFields.forEach((field, index) => {
    const fieldName = field.name || field.id || `field-${index}`;
    const fieldSelector = field.recommendedSelector || `[name="${field.name}"]` || `#${field.id}`;

    // 1. 必須フィールドの空白テスト
    if (field.required) {
      steps.push({
        label: `${fieldName}にフォーカスを当てる`,
        action: "focus",
        target: fieldSelector
      });

      steps.push({
        label: `${fieldName}を空のままフォーカスを外す`,
        action: "blur",
        target: fieldSelector
      });

      steps.push({
        label: `${fieldName}の必須エラーメッセージを確認`,
        action: "checkValidationError",
        target: fieldSelector,
        expectedErrorIndicators: [
          `.invalid-feedback:visible`,
          `.error:visible`,
          `[class*="error"]:visible`,
          `.form-error:visible`,
          `.field-error:visible`,
          `[aria-invalid="true"]`
        ]
      });
    }

    // 2. フォーマット無効値のテスト
    const invalidValue = getInvalidValueForField(field);
    if (invalidValue) {
      steps.push({
        label: `${fieldName}に無効な値「${invalidValue}」を入力`,
        action: "fill",
        target: fieldSelector,
        value: invalidValue
      });

      steps.push({
        label: `${fieldName}からフォーカスを外す`,
        action: "blur",
        target: fieldSelector
      });

      steps.push({
        label: `${fieldName}のフォーマットエラーメッセージを確認`,
        action: "checkValidationError",
        target: fieldSelector,
        expectedErrorIndicators: [
          `.invalid-feedback:visible`,
          `.error:visible`,
          `[class*="error"]:visible`,
          `.form-error:visible`,
          `.field-error:visible`,
          `[aria-invalid="true"]`
        ]
      });
    }

    // 3. 有効値でエラーが消えることの確認
    const validValue = getValidValueForField(field);
    if (validValue) {
      steps.push({
        label: `${fieldName}に有効な値「${validValue}」を入力`,
        action: "fill",
        target: fieldSelector,
        value: validValue
      });

      steps.push({
        label: `${fieldName}からフォーカスを外す`,
        action: "blur",
        target: fieldSelector
      });

      steps.push({
        label: `${fieldName}のエラーメッセージが消えることを確認`,
        action: "checkValidationCleared",
        target: fieldSelector,
        timeout: 2000
      });
    }
  });

  return {
    route_id: `blur_validation_${getTimestamp()}`,
    category: 'blur_validation',
    title: '汎用blurバリデーションテスト',
    steps: steps,
    generated_at: new Date().toISOString(),
    test_focus: 'real_time_field_validation',
    fields_tested: validationFields.map(f => f.name || f.id)
  };
}

/**
 * フィールドタイプに応じた無効値を生成
 */
function getInvalidValueForField(field) {
  if (field.type === 'email' || field.name?.toLowerCase().includes('email')) {
    return 'invalid-email-format';
  }
  if (field.type === 'number' || field.name?.toLowerCase().includes('number')) {
    return 'abc123';
  }
  if (field.type === 'tel' || field.name?.toLowerCase().includes('phone') || field.name?.toLowerCase().includes('tel')) {
    return 'invalid-phone';
  }
  if (field.type === 'date' || field.name?.toLowerCase().includes('date')) {
    return getPastDateString(); // 過去の日付
  }
  if (field.name?.toLowerCase().includes('name')) {
    return '123'; // 名前フィールドに数字のみ
  }
  return null;
}

/**
 * フィールドタイプに応じた有効値を生成
 */
function getValidValueForField(field) {
  if (field.type === 'email' || field.name?.toLowerCase().includes('email')) {
    return 'test@example.com';
  }
  if (field.type === 'number' || field.name?.toLowerCase().includes('number')) {
    return '123';
  }
  if (field.type === 'tel' || field.name?.toLowerCase().includes('phone') || field.name?.toLowerCase().includes('tel')) {
    return '090-1234-5678';
  }
  if (field.type === 'date' || field.name?.toLowerCase().includes('date')) {
    return getFutureDateString(7); // 1週間後
  }
  if (field.name?.toLowerCase().includes('name')) {
    return 'テスト太郎';
  }
  if (field.name?.toLowerCase().includes('term')) {
    return '2';
  }
  if (field.name?.toLowerCase().includes('count')) {
    return '2';
  }
  return 'テスト値';
}

/**
 * 包括的なフォームバリデーションテストの生成（blur + submit）
 */
function generateComprehensiveValidationSteps(domInfo, baseUrl) {
  const steps = [];
  
  steps.push({
    label: "対象ページにアクセス",
    action: "load",
    target: baseUrl
  });

  // 1. 全フィールドのblurバリデーション
  const blurTest = generateBlurValidationSteps(domInfo, baseUrl);
  if (blurTest) {
    steps.push(...blurTest.steps.slice(1)); // 最初のloadステップは除く
  }

  // 2. 日付バリデーション
  const dateTest = generateGenericDateValidationSteps(domInfo, baseUrl);
  if (dateTest) {
    steps.push(...dateTest.steps.slice(1)); // 最初のloadステップは除く
  }

  return {
    route_id: `comprehensive_validation_${getTimestamp()}`,
    category: 'comprehensive_validation',
    title: '包括的フォームバリデーションテスト',
    steps: steps,
    generated_at: new Date().toISOString(),
    test_focus: 'complete_form_validation_coverage'
  };
}

/**
 * 高度なSPA・JS UI対応のDOM解析
 */
async function extractAdvancedDynamicPageInfo(url) {
  console.log(`🚀 高度な動的DOM解析開始: ${url}`);
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    // 1. ページ読み込み + 複数の待機戦略
    await page.goto(url, { waitUntil: 'networkidle' });
    console.log('✅ 初期ページ読み込み完了');

    // 2. SPA用の追加待機戦略
    await waitForSPAReady(page);
    
    // 3. 動的要素の完全読み込み待機
    await waitForLazyElements(page);
    
    // 4. 包括的DOM情報取得
    const pageInfo = await page.evaluate(() => {
      const info = {
        title: document.title,
        url: window.location.href,
        framework: detectFramework(),
        elements: {
          headings: [],
          links: [],
          buttons: [],
          inputs: [],
          dynamicInputs: [],
          asyncElements: [],
          forms: [],
          navigation: []
        },
        spa_info: {
          has_router: false,
          framework_detected: null,
          lazy_loaded_count: 0
        }
      };

      // フレームワーク検出
      function detectFramework() {
        if (window.React) return 'React';
        if (window.Vue) return 'Vue';
        if (window.angular) return 'Angular';
        if (window.jQuery) return 'jQuery';
        if (document.querySelector('[ng-app]')) return 'AngularJS';
        return 'Vanilla';
      }

      // 動的入力フィールド検出（より高度）
      document.querySelectorAll('input, textarea, select').forEach(input => {
        const elementInfo = {
          tagName: input.tagName.toLowerCase(),
          type: input.type || 'text',
          name: input.name,
          id: input.id,
          placeholder: input.placeholder,
          required: input.required,
          disabled: input.disabled,
          visible: input.offsetParent !== null,
          computed_style: {
            display: window.getComputedStyle(input).display,
            visibility: window.getComputedStyle(input).visibility,
            opacity: window.getComputedStyle(input).opacity
          },
          event_listeners: getEventListenerCount(input),
          validation_attributes: getValidationAttributes(input),
          dependent_elements: findDependentElements(input),
          selector: generateRobustSelector(input)
        };

        if (elementInfo.visible) {
          info.elements.inputs.push(elementInfo);
        } else {
          info.elements.dynamicInputs.push(elementInfo);
        }
      });

      // ボタンの高度解析
      document.querySelectorAll('button, input[type="submit"], input[type="button"]').forEach(btn => {
        info.elements.buttons.push({
          tagName: btn.tagName.toLowerCase(),
          type: btn.type,
          text: btn.textContent?.trim() || btn.value,
          id: btn.id,
          className: btn.className,
          disabled: btn.disabled,
          visible: btn.offsetParent !== null,
          has_click_handler: hasClickHandler(btn),
          prevents_default: detectPreventDefault(btn),
          selector: generateRobustSelector(btn),
          form_association: btn.form ? btn.form.id : null
        });
      });

      // 非同期読み込み要素の検出
      const observers = document.querySelectorAll('[data-lazy], [loading="lazy"], .lazy');
      info.spa_info.lazy_loaded_count = observers.length;

      // ヘルパー関数
      function getEventListenerCount(element) {
        return {
          click: element.onclick ? 1 : 0,
          change: element.onchange ? 1 : 0,
          input: element.oninput ? 1 : 0,
          focus: element.onfocus ? 1 : 0,
          blur: element.onblur ? 1 : 0
        };
      }

      function getValidationAttributes(input) {
        return {
          pattern: input.pattern,
          min: input.min,
          max: input.max,
          minLength: input.minLength,
          maxLength: input.maxLength,
          step: input.step
        };
      }

      function findDependentElements(input) {
        const dependents = [];
        if (input.name === 'contact') {
          const emailField = document.querySelector('[name="email"]');
          const phoneField = document.querySelector('[name="phone"], [name="tel"]');
          if (emailField) dependents.push('email');
          if (phoneField) dependents.push('phone');
        }
        return dependents;
      }

      function generateRobustSelector(element) {
        if (element.id) return `#${element.id}`;
        if (element.name) return `[name="${element.name}"]`;
        if (element.type) return `${element.tagName.toLowerCase()}[type="${element.type}"]`;
        return element.tagName.toLowerCase();
      }

      function hasClickHandler(button) {
        return !!(button.onclick || button.addEventListener);
      }

      function detectPreventDefault(button) {
        // 簡易的な検出（実際のhandlerの解析は困難）
        return button.type === 'button' && !button.form;
      }

      return info;
    });

    // 5. SPA特有の情報を追加取得
    const spaInfo = await analyzeSPAFeatures(page);
    pageInfo.spa_info = { ...pageInfo.spa_info, ...spaInfo };

    console.log(`🎯 高度DOM解析完了:`);
    console.log(`  📱 フレームワーク: ${pageInfo.framework}`);
    console.log(`  📝 入力要素: 表示${pageInfo.elements.inputs.length}個, 非表示${pageInfo.elements.dynamicInputs.length}個`);
    console.log(`  🔄 SPA機能: ルータ=${pageInfo.spa_info.has_router}, 遅延読み込み=${pageInfo.spa_info.lazy_loaded_count}個`);
    
    return pageInfo;
    
  } finally {
    await browser.close();
  }
}

/**
 * SPA準備完了待機
 */
async function waitForSPAReady(page) {
  console.log('⏳ SPA準備完了を待機中...');
  
  // 複数の戦略を並行実行
  await Promise.race([
    // 戦略1: React/Vue等の準備完了検出
    page.waitForFunction(() => {
      return window.React || window.Vue || window.angular || 
             document.querySelector('[data-reactroot]') ||
             document.querySelector('[data-vue-root]');
    }, { timeout: 5000 }).catch(() => {}),
    
    // 戦略2: カスタムローディング完了検出
    page.waitForFunction(() => {
      const loader = document.querySelector('.loading, .spinner, [data-loading]');
      return !loader || loader.style.display === 'none';
    }, { timeout: 5000 }).catch(() => {}),
    
    // 戦略3: 固定時間待機（フォールバック）
    page.waitForTimeout(3000)
  ]);
  
  console.log('✅ SPA準備完了');
}

/**
 * 遅延読み込み要素の待機
 */
async function waitForLazyElements(page) {
  console.log('⏳ 遅延読み込み要素を待機中...');
  
  try {
    // Intersection Observer の完了を待機
    await page.waitForFunction(() => {
      const lazyElements = document.querySelectorAll('[data-lazy], [loading="lazy"]');
      return Array.from(lazyElements).every(el => 
        el.getAttribute('data-loaded') === 'true' || 
        !el.hasAttribute('data-lazy')
      );
    }, { timeout: 5000 });
  } catch (error) {
    console.log('⚠️ 遅延読み込み要素の待機タイムアウト（処理を続行）');
  }
  
  console.log('✅ 遅延読み込み要素の解析完了');
}

/**
 * SPA機能の解析
 */
async function analyzeSPAFeatures(page) {
  return await page.evaluate(() => {
    const spaInfo = {
      has_router: false,
      framework_detected: null,
      api_endpoints: [],
      state_management: false
    };

    // ルータ検出
    if (window.history && window.history.pushState) {
      spaInfo.has_router = true;
    }

    // フレームワーク固有検出
    if (window.React) {
      spaInfo.framework_detected = 'React';
      spaInfo.state_management = !!(window.Redux || window.__REDUX_DEVTOOLS_EXTENSION__);
    } else if (window.Vue) {
      spaInfo.framework_detected = 'Vue';
      spaInfo.state_management = !!(window.Vuex);
    } else if (window.angular) {
      spaInfo.framework_detected = 'Angular';
    }

    // API エンドポイント検出（Network interceptはできないので基本的な検出のみ）
    const scripts = Array.from(document.scripts);
    const apiPatterns = ['/api/', '/v1/', '/graphql', 'fetch(', 'axios.'];
    scripts.forEach(script => {
      if (script.textContent) {
        apiPatterns.forEach(pattern => {
          if (script.textContent.includes(pattern)) {
            spaInfo.api_endpoints.push(pattern);
          }
        });
      }
    });

    return spaInfo;
  });
}

/**
 * DOM解析ベースの高度要素タイプ判定とアクション最適化
 */
class DOMBasedTestGenerator {
  constructor(domInfo) {
    this.domInfo = domInfo;
    this.elementActionMap = this.buildElementActionMap();
  }

  /**
   * 要素タイプとアクションの最適なマッピングを構築
   */
  buildElementActionMap() {
    const actionMap = new Map();
    
    // 入力フィールドのアクションマッピング
    actionMap.set('input[type="text"]', { 
      primary: 'fill', 
      validation: ['clear', 'fill', 'assertValue'],
      complex: ['fill', 'blur', 'assertValidation', 'assertPlaceholder'] 
    });
    
    actionMap.set('input[type="email"]', { 
      primary: 'fill', 
      validation: ['fill', 'blur', 'assertEmailValidation'],
      complex: ['fill', 'blur', 'assertPattern', 'assertInvalidEmail'] 
    });
    
    actionMap.set('input[type="tel"]', { 
      primary: 'fill', 
      validation: ['fill', 'blur', 'assertPhoneValidation'],
      complex: ['fill', 'blur', 'assertFormat', 'assertInternationalFormat'] 
    });
    
    actionMap.set('input[type="number"]', { 
      primary: 'fill', 
      validation: ['fill', 'assertMinMax', 'assertStep'],
      complex: ['fill', 'assertNumericValidation', 'assertDecimalHandling'] 
    });
    
    actionMap.set('input[type="date"]', { 
      primary: 'fill', 
      validation: ['fill', 'assertDateFormat', 'assertMinMaxDate'],
      complex: ['fill', 'assertCalendarPicker', 'assertDateValidation'] 
    });
    
    // ⭐ select要素の完全対応
    actionMap.set('select', { 
      primary: 'selectOption', 
      validation: ['selectOption', 'assertSelectedValue', 'assertOptionCount'],
      complex: ['assertOptionCount', 'assertOptionTexts', 'assertOptionValues', 'selectOption', 'assertSelectedValue', 'assertDependentFields'] 
    });
    
    // ボタンのアクションマッピング
    actionMap.set('button', { 
      primary: 'click', 
      validation: ['click', 'assertNavigation'],
      complex: ['assertEnabled', 'click', 'assertResponse', 'assertStateChange'] 
    });
    
    actionMap.set('input[type="submit"]', { 
      primary: 'click', 
      validation: ['click', 'assertFormSubmission'],
      complex: ['assertFormValidation', 'click', 'assertSubmissionResponse'] 
    });
    
    // checkbox & radio
    actionMap.set('input[type="checkbox"]', { 
      primary: 'check', 
      validation: ['check', 'assertChecked', 'uncheck', 'assertUnchecked'],
      complex: ['assertInitialState', 'check', 'assertGroupBehavior', 'assertDependentElements'] 
    });
    
    actionMap.set('input[type="radio"]', { 
      primary: 'check', 
      validation: ['check', 'assertChecked', 'assertGroupExclusive'],
      complex: ['assertGroupOptions', 'check', 'assertExclusiveSelection', 'assertValue'] 
    });
    
    return actionMap;
  }

  /**
   * 要素に最適なアクションシーケンスを生成
   */
  generateOptimalActionSequence(element, testComplexity = 'validation') {
    const elementType = this.determineElementType(element);
    const actionConfig = this.elementActionMap.get(elementType);
    
    if (!actionConfig) {
      console.warn(`🤷‍♂️ 未知の要素タイプ: ${elementType}`);
      return [{ action: 'click', reason: 'fallback action' }];
    }
    
    const actions = actionConfig[testComplexity] || actionConfig.primary;
    return this.buildDetailedActionSteps(element, actions, elementType);
  }

  /**
   * 詳細な要素タイプ判定
   */
  determineElementType(element) {
    const tagName = element.tagName?.toLowerCase();
    const type = element.type?.toLowerCase();
    
    if (tagName === 'select') {
      return 'select';
    }
    
    if (tagName === 'input') {
      return `input[type="${type || 'text'}"]`;
    }
    
    if (tagName === 'button') {
      return 'button';
    }
    
    if (tagName === 'textarea') {
      return 'textarea';
    }
    
    return `${tagName}`;
  }

  /**
   * 詳細なアクションステップを構築
   */
  buildDetailedActionSteps(element, actions, elementType) {
    const steps = [];
    
    for (const action of actions) {
      const step = this.createDetailedStep(element, action, elementType);
      if (step) {
        steps.push(step);
      }
    }
    
    return steps;
  }

  /**
   * 詳細なステップ作成（要素タイプ特化）
   */
  createDetailedStep(element, action, elementType) {
    const baseStep = {
      target: this.generateRobustSelector(element),
      elementType: elementType,
      elementInfo: {
        name: element.name,
        id: element.id,
        visible: element.visible,
        required: element.required
      }
    };

    switch (action) {
      case 'fill':
        return {
          ...baseStep,
          label: `「${element.name || element.id || 'input'}」フィールドに値を入力`,
          action: 'fill',
          value: this.generateTestValueForElement(element),
          validation: {
            beforeAction: ['assertVisible', 'assertEnabled'],
            afterAction: ['assertValue']
          }
        };

      case 'selectOption':
        const options = element.options || [];
        if (options.length === 0) {
          console.warn(`⚠️ select要素にoptionがありません: ${element.name}`);
          return null;
        }
        
        return {
          ...baseStep,
          label: `「${element.name || element.id || 'select'}」プルダウンから選択`,
          action: 'selectOption',
          value: options[0]?.value || options[0]?.text,
          options: options,
          validation: {
            beforeAction: ['assertVisible', 'assertEnabled', 'assertOptionCount'],
            afterAction: ['assertSelectedValue']
          }
        };

      case 'assertOptionCount':
        return {
          ...baseStep,
          label: `「${element.name || element.id}」の選択肢数を確認`,
          action: 'assertOptionCount',
          expectedCount: element.options?.length || 0,
          validation: {
            beforeAction: ['assertVisible']
          }
        };

      case 'assertOptionTexts':
        return {
          ...baseStep,
          label: `「${element.name || element.id}」の選択肢テキストを確認`,
          action: 'assertOptionTexts',
          expectedTexts: element.options?.map(opt => opt.text) || [],
          validation: {
            beforeAction: ['assertVisible']
          }
        };

      case 'assertOptionValues':
        return {
          ...baseStep,
          label: `「${element.name || element.id}」の選択肢値を確認`,
          action: 'assertOptionValues',
          expectedValues: element.options?.map(opt => opt.value) || [],
          validation: {
            beforeAction: ['assertVisible']
          }
        };

      case 'check':
        return {
          ...baseStep,
          label: `「${element.name || element.id || 'checkbox'}」をチェック`,
          action: 'check',
          validation: {
            beforeAction: ['assertVisible', 'assertEnabled'],
            afterAction: ['assertChecked']
          }
        };

      case 'click':
        return {
          ...baseStep,
          label: `「${element.text || element.name || element.id || 'button'}」をクリック`,
          action: 'click',
          validation: {
            beforeAction: ['assertVisible', 'assertEnabled'],
            afterAction: ['assertResponse'] // ナビゲーションまたは状態変化
          }
        };

      case 'assertSelectedValue':
        return {
          ...baseStep,
          label: `「${element.name || element.id}」の選択値を確認`,
          action: 'assertSelectedValue',
          expectedValue: element.options?.[0]?.value,
          validation: {
            beforeAction: ['assertVisible']
          }
        };

      default:
        console.warn(`🤷‍♂️ 未知のアクション: ${action}`);
        return null;
    }
  }

  /**
   * 堅牢なセレクタ生成
   */
  generateRobustSelector(element) {
    // 優先順位: id > name > type+attributes > xpath
    if (element.id) {
      return `#${element.id}`;
    }
    
    if (element.name) {
      return `[name="${element.name}"]`;
    }
    
    if (element.tagName === 'select') {
      return 'select';
    }
    
    if (element.type) {
      return `${element.tagName?.toLowerCase()}[type="${element.type}"]`;
    }
    
    return element.tagName?.toLowerCase() || 'unknown';
  }

  /**
   * 要素に最適なテストデータ生成
   */
  generateTestValueForElement(element) {
    const elementType = this.determineElementType(element);
    
    switch (elementType) {
      case 'input[type="email"]':
        return 'test@example.com';
      case 'input[type="tel"]':
        return '090-1234-5678';
      case 'input[type="number"]':
        const min = element.min ? parseInt(element.min) : 1;
        const max = element.max ? parseInt(element.max) : 100;
        return Math.floor(Math.random() * (max - min + 1)) + min;
      case 'input[type="date"]':
        return new Date().toISOString().split('T')[0];
      case 'input[type="text"]':
      default:
        return element.placeholder || `テスト値_${element.name || 'input'}`;
    }
  }
}

/**
 * フェーズ2: 複雑なvalidation機能を持つ包括的テストケースジェネレータ
 */
class ComprehensiveTestGenerator extends DOMBasedTestGenerator {
  constructor(domInfo, userStoryInfo = null) {
    super(domInfo);
    this.userStoryInfo = userStoryInfo;
    this.testPriorities = {
      critical: ['form_submission', 'navigation', 'data_validation'],
      important: ['user_interaction', 'input_validation', 'display_verification'],
      standard: ['ui_consistency', 'edge_cases', 'accessibility']
    };
  }

  /**
   * ユーザー提案レベルの包括的テストケース生成
   * 例: test('「ご連絡方法」select要素のテスト', async ({ page }) => { ... })
   */
  generateComprehensiveTestCase(element, testFocus = 'complete_validation') {
    const testCase = {
      id: `comprehensive_${element.name || element.id}_${Date.now()}`,
      title: this.generateTestTitle(element),
      description: this.generateTestDescription(element, testFocus),
      steps: [],
      expectations: [],
      metadata: {
        complexity: 'comprehensive',
        element_type: this.determineElementType(element),
        test_focus: testFocus,
        original_viewpoint: `${element.name || element.id}要素の包括的テスト`,
        user_story_id: this.userStoryInfo?.currentId
      }
    };

    // テストフォーカスに応じた包括的ステップ生成
    switch (testFocus) {
      case 'complete_validation':
        this.generateCompleteValidationSteps(element, testCase);
        break;
      case 'edge_case_testing':
        this.generateEdgeCaseSteps(element, testCase);
        break;
      case 'user_experience':
        this.generateUXTestSteps(element, testCase);
        break;
      case 'accessibility':
        this.generateAccessibilitySteps(element, testCase);
        break;
      default:
        this.generateCompleteValidationSteps(element, testCase);
    }

    return testCase;
  }

  /**
   * 完全バリデーションステップ生成（ユーザー提案レベル）
   */
  generateCompleteValidationSteps(element, testCase) {
    if (element.tagName === 'select') {
      this.generateSelectCompleteValidation(element, testCase);
    } else if (element.tagName === 'input') {
      this.generateInputCompleteValidation(element, testCase);
    } else if (element.tagName === 'button') {
      this.generateButtonCompleteValidation(element, testCase);
    }
  }

  /**
   * select要素の包括的バリデーション（ユーザー提案を実装）
   */
  generateSelectCompleteValidation(selectElement, testCase) {
    const options = selectElement.options || [];
    
    // 1. フェーズ: 構造検証
    testCase.steps.push({
      phase: 'structure_validation',
      label: 'ページにアクセス',
      action: 'load',
      target: this.getBaseUrl(),
      description: 'テスト対象のページに移動'
    });

    testCase.steps.push({
      phase: 'structure_validation',
      label: `${selectElement.name || selectElement.id}の取得`,
      action: 'locator_setup',
      target: this.generateRobustSelector(selectElement),
      description: `select[name="${selectElement.name}"]を取得`
    });

    testCase.steps.push({
      phase: 'structure_validation',
      label: 'option要素数の検証',
      action: 'assertOptionCount',
      target: this.generateRobustSelector(selectElement),
      expectedCount: options.length,
      description: `option要素が${options.length}個存在することを確認`
    });

    // 2. フェーズ: 値検証
    testCase.steps.push({
      phase: 'value_validation',
      label: 'テキストとvalue属性の検証',
      action: 'assertOptionTexts',
      target: this.generateRobustSelector(selectElement),
      expectedTexts: options.map(opt => opt.text),
      description: '選択肢のテキスト内容を検証'
    });

    testCase.steps.push({
      phase: 'value_validation',
      label: 'value属性の検証',
      action: 'assertOptionValues',
      target: this.generateRobustSelector(selectElement),
      expectedValues: options.map(opt => opt.value),
      description: '選択肢のvalue属性を検証'
    });

    // 3. フェーズ: 選択操作テスト
    options.forEach((option, index) => {
      testCase.steps.push({
        phase: 'operation_test',
        label: `「${option.text}」の選択操作`,
        action: 'selectOption',
        target: this.generateRobustSelector(selectElement),
        value: option.value,
        description: `${option.text}を選択`
      });

      testCase.steps.push({
        phase: 'operation_test',
        label: `選択結果の確認`,
        action: 'assertSelectedValue',
        target: this.generateRobustSelector(selectElement),
        expectedValue: option.value,
        description: `選択値が${option.value}であることを確認`
      });
    });

    // 4. フェーズ: 依存関係テスト（該当する場合）
    if (selectElement.name === 'contact') {
      this.generateDependencyValidation(selectElement, testCase);
    }

    // Expectations設定
    testCase.expectations = [
      `select要素に${options.length}個の選択肢が存在する`,
      `各選択肢のテキストが正しく表示される`,
      `各選択肢のvalue属性が正しく設定されている`,
      `全ての選択肢が正常に選択できる`,
      `選択結果が正しく反映される`
    ];
  }

  /**
   * input要素の包括的バリデーション
   */
  generateInputCompleteValidation(inputElement, testCase) {
    const inputType = inputElement.type || 'text';
    
    // 基本構造確認
    testCase.steps.push({
      phase: 'structure_validation',
      label: `${inputElement.name || inputElement.id}フィールドの存在確認`,
      action: 'assertVisible',
      target: this.generateRobustSelector(inputElement),
      description: '入力フィールドが表示されていることを確認'
    });

    // タイプ別包括テスト
    switch (inputType) {
      case 'email':
        this.generateEmailComprehensiveTest(inputElement, testCase);
        break;
      case 'tel':
        this.generatePhoneComprehensiveTest(inputElement, testCase);
        break;
      case 'number':
        this.generateNumberComprehensiveTest(inputElement, testCase);
        break;
      case 'date':
        this.generateDateComprehensiveTest(inputElement, testCase);
        break;
      default:
        this.generateTextComprehensiveTest(inputElement, testCase);
    }
  }

  /**
   * メールアドレス入力の包括的テスト
   */
  generateEmailComprehensiveTest(emailElement, testCase) {
    const validEmails = ['test@example.com', 'user.name+tag@domain.co.jp'];
    const invalidEmails = ['invalid-email', '@domain.com', 'user@', 'user@domain'];

    // 有効値テスト
    validEmails.forEach(email => {
      testCase.steps.push({
        phase: 'valid_input_test',
        label: `有効なメールアドレス入力: ${email}`,
        action: 'fill',
        target: this.generateRobustSelector(emailElement),
        value: email,
        description: `有効なメールアドレス「${email}」を入力`
      });

      testCase.steps.push({
        phase: 'valid_input_test',
        label: 'メールアドレス形式確認',
        action: 'assertEmailValidation',
        target: this.generateRobustSelector(emailElement),
        description: 'メールアドレス形式が正しいことを確認'
      });
    });

    // 無効値テスト
    invalidEmails.forEach(email => {
      testCase.steps.push({
        phase: 'invalid_input_test',
        label: `無効なメールアドレス入力: ${email}`,
        action: 'fill',
        target: this.generateRobustSelector(emailElement),
        value: email,
        description: `無効なメールアドレス「${email}」を入力`
      });

      testCase.steps.push({
        phase: 'invalid_input_test',
        label: 'バリデーションエラー確認',
        action: 'assertValidationError',
        target: this.generateRobustSelector(emailElement),
        description: 'バリデーションエラーが表示されることを確認'
      });
    });
  }

  /**
   * 依存関係バリデーション生成
   */
  generateDependencyValidation(selectElement, testCase) {
    if (selectElement.name === 'contact') {
      testCase.steps.push({
        phase: 'dependency_test',
        label: 'メール選択時の依存フィールド確認',
        action: 'selectOption',
        target: this.generateRobustSelector(selectElement),
        value: 'email',
        description: 'メールでのご連絡を選択'
      });

      testCase.steps.push({
        phase: 'dependency_test',
        label: 'メールフィールドの表示確認',
        action: 'assertVisible',
        target: '[name="email"]',
        description: 'メールアドレス入力フィールドが表示されることを確認'
      });

      testCase.steps.push({
        phase: 'dependency_test',
        label: '電話選択時の依存フィールド確認',
        action: 'selectOption',
        target: this.generateRobustSelector(selectElement),
        value: 'phone',
        description: '電話でのご連絡を選択'
      });

      testCase.steps.push({
        phase: 'dependency_test',
        label: '電話フィールドの表示確認',
        action: 'assertVisible',
        target: '[name="phone"], [name="tel"]',
        description: '電話番号入力フィールドが表示されることを確認'
      });
    }
  }

  /**
   * テストタイトル生成
   */
  generateTestTitle(element) {
    const elementName = element.name || element.id || element.text || 'unknown';
    const elementType = this.determineElementType(element);
    
    if (elementType === 'select') {
      return `「${elementName}」select要素のテスト`;
    } else if (elementType.startsWith('input')) {
      return `「${elementName}」input要素のテスト`;
    } else if (elementType === 'button') {
      return `「${elementName}」button要素のテスト`;
    }
    
    return `「${elementName}」要素のテスト`;
  }

  /**
   * テスト説明生成
   */
  generateTestDescription(element, testFocus) {
    const focusDescriptions = {
      complete_validation: '包括的なバリデーションテスト',
      edge_case_testing: 'エッジケースと境界値テスト',
      user_experience: 'ユーザビリティとUXテスト',
      accessibility: 'アクセシビリティテスト'
    };
    
    return `${element.name || element.id}要素の${focusDescriptions[testFocus] || '包括的テスト'}`;
  }

  /**
   * ベースURL取得（userStoryInfoから取得またはデフォルト）
   */
  getBaseUrl() {
    return this.userStoryInfo?.targetUrl || 'http://localhost:3000';
  }
}

/**
 * AIケース生成用の包括的な値生成戦略
 * @param {string} goalOrStory - ユーザーストーリーまたはgoal文字列
 * @param {Object} domInfo - DOM情報
 * @returns {Object} 生成戦略と推奨値のマッピング
 */
function generateComprehensiveValueStrategy(goalOrStory, domInfo) {
  console.log('🎯 包括的な値生成戦略を構築中...');
  
  // レベル1: ユーザーストーリーから抽出された具体的な値
  const userStoryValues = extractUserStoryValues(goalOrStory);
  
  // レベル2: DOM情報から文脈推測
  const contextualValues = generateContextualValues(domInfo);
  
  // レベル3: フィールドタイプ別適切値
  const typeBasedValues = generateTypeBasedValues(domInfo);
  
  // レベル4: 汎用デフォルト値
  const genericValues = generateGenericValues();
  
  const strategy = {
    userStoryValues,
    contextualValues,
    typeBasedValues,
    genericValues,
    recommendations: buildValueRecommendations(userStoryValues, contextualValues, typeBasedValues, genericValues)
  };
  
  console.log(`✅ 値生成戦略構築完了: ${Object.keys(strategy.recommendations).length}個のフィールドに対応`);
  return strategy;
}

/**
 * DOM情報から文脈に応じた値を推測
 * @param {Object} domInfo - DOM情報
 * @returns {Object} 文脈推測値
 */
function generateContextualValues(domInfo) {
  const contextualValues = {};
  
  if (!domInfo?.elements?.inputs) return contextualValues;
  
  domInfo.elements.inputs.forEach(input => {
    const fieldName = input.name || input.id || '';
    const placeholder = input.placeholder || '';
    const fieldContext = (fieldName + ' ' + placeholder).toLowerCase();
    
    // 日付関連フィールド
    if (fieldContext.includes('date') || fieldContext.includes('日付') || fieldContext.includes('宿泊日')) {
      contextualValues[input.name] = getReasonableDate();
    }
    
    // 期間関連フィールド
    else if (fieldContext.includes('term') || fieldContext.includes('期間') || fieldContext.includes('宿泊数')) {
      contextualValues[input.name] = getReasonableTerm();
    }
    
    // 人数関連フィールド
    else if (fieldContext.includes('count') || fieldContext.includes('人数') || fieldContext.includes('head')) {
      contextualValues[input.name] = getReasonableHeadCount();
    }
    
    // 名前関連フィールド
    else if (fieldContext.includes('name') || fieldContext.includes('氏名') || fieldContext.includes('username')) {
      contextualValues[input.name] = getReasonableName();
    }
    
    // メール関連フィールド
    else if (fieldContext.includes('email') || fieldContext.includes('メール')) {
      contextualValues[input.name] = getReasonableEmail();
    }
    
    // 電話関連フィールド
    else if (fieldContext.includes('phone') || fieldContext.includes('tel') || fieldContext.includes('電話')) {
      contextualValues[input.name] = getReasonablePhone();
    }
    
    // コメント関連フィールド
    else if (fieldContext.includes('comment') || fieldContext.includes('要望') || fieldContext.includes('連絡')) {
      contextualValues[input.name] = getReasonableComment();
    }
  });
  
  return contextualValues;
}

/**
 * フィールドタイプに基づく適切な値を生成
 * @param {Object} domInfo - DOM情報
 * @returns {Object} タイプ別推奨値
 */
function generateTypeBasedValues(domInfo) {
  const typeBasedValues = {};
  
  if (!domInfo?.elements?.inputs) return typeBasedValues;
  
  domInfo.elements.inputs.forEach(input => {
    if (input.name && input.type) {
      switch (input.type) {
        case 'email':
          typeBasedValues[input.name] = 'test.user@example.com';
          break;
        case 'tel':
          typeBasedValues[input.name] = '090-1234-5678';
          break;
        case 'number':
          typeBasedValues[input.name] = '2';
          break;
        case 'date':
          typeBasedValues[input.name] = getReasonableDate();
          break;
        case 'password':
          typeBasedValues[input.name] = 'SecurePass123';
          break;
        case 'url':
          typeBasedValues[input.name] = 'https://example.com';
          break;
        default:
          typeBasedValues[input.name] = '適切なテキスト';
          break;
      }
    }
  });
  
  return typeBasedValues;
}

/**
 * 汎用デフォルト値を生成
 * @returns {Object} 汎用値
 */
function generateGenericValues() {
  return {
    text: '有効なテキスト',
    email: 'user@example.com',
    number: '1',
    date: getReasonableDate(),
    phone: '090-1234-5678',
    name: '山田太郎',
    comment: 'テスト用コメント'
  };
}

/**
 * 各フィールドに対する最適な値の推奨を構築
 * @param {Object} userStoryValues - ユーザーストーリー値
 * @param {Object} contextualValues - 文脈推測値
 * @param {Object} typeBasedValues - タイプ別値
 * @param {Object} genericValues - 汎用値
 * @returns {Object} フィールド別推奨値
 */
function buildValueRecommendations(userStoryValues, contextualValues, typeBasedValues, genericValues) {
  const recommendations = {};
  
  // 全てのフィールドを収集
  const allFields = new Set([
    ...Object.keys(userStoryValues),
    ...Object.keys(contextualValues),
    ...Object.keys(typeBasedValues)
  ]);
  
  allFields.forEach(fieldName => {
    // 優先順位に従って値を選択
    if (userStoryValues[fieldName]) {
      recommendations[fieldName] = {
        value: userStoryValues[fieldName],
        source: 'user_story',
        confidence: 'high'
      };
    } else if (contextualValues[fieldName]) {
      recommendations[fieldName] = {
        value: contextualValues[fieldName],
        source: 'contextual',
        confidence: 'medium'
      };
    } else if (typeBasedValues[fieldName]) {
      recommendations[fieldName] = {
        value: typeBasedValues[fieldName],
        source: 'type_based',
        confidence: 'low'
      };
    } else {
      recommendations[fieldName] = {
        value: genericValues.text,
        source: 'generic',
        confidence: 'minimal'
      };
    }
  });
  
  return recommendations;
}

// 文脈に応じた合理的な値を生成するヘルパー関数群

function getReasonableDate() {
  const date = new Date();
  date.setDate(date.getDate() + 7); // 1週間後
  return date.toISOString().split('T')[0].replace(/-/g, '/');
}

function getReasonableTerm() {
  return '2'; // 2泊が一般的
}

function getReasonableHeadCount() {
  return '2'; // 2名が一般的
}

function getReasonableName() {
  return '山田太郎'; // 日本の一般的な名前
}

function getReasonableEmail() {
  return 'yamada.taro@example.com';
}

function getReasonablePhone() {
  return '090-1234-5678';
}

function getReasonableComment() {
  return '特になし';
}

/**
 * AIプロンプト用の値説明を生成
 * @param {Object} valueStrategy - 値生成戦略
 * @returns {string} AIプロンプト用の値説明
 */
function generateValueInstructionsForAI(valueStrategy) {
  const { userStoryValues, recommendations } = valueStrategy;
  
  let instructions = '';
  
  // ユーザーストーリーから具体的な値が抽出された場合
  if (Object.keys(userStoryValues).length > 0) {
    instructions += `🎯 **ユーザーストーリーから抽出された具体的な値（最優先使用）**\n`;
    for (const [field, value] of Object.entries(userStoryValues)) {
      instructions += `- ${field}: "${value}"\n`;
    }
    instructions += `\n`;
  }
  
  // 推奨値の説明
  if (Object.keys(recommendations).length > 0) {
    instructions += `📋 **各フィールドの推奨入力値**\n`;
    for (const [field, rec] of Object.entries(recommendations)) {
      const confidenceEmoji = {
        'high': '🟢',
        'medium': '🟡', 
        'low': '🟠',
        'minimal': '🔴'
      }[rec.confidence] || '⚪';
      
      const sourceText = {
        'user_story': 'ユーザーストーリー',
        'contextual': '文脈推測',
        'type_based': 'フィールドタイプ',
        'generic': '汎用デフォルト'
      }[rec.source] || '不明';
      
      instructions += `- ${field}: "${rec.value}" ${confidenceEmoji} (${sourceText})\n`;
    }
    instructions += `\n`;
  }
  
  instructions += `📝 **値使用の優先順位**\n`;
  instructions += `1. 🟢 ユーザーストーリーから抽出された具体的な値を最優先で使用\n`;
  instructions += `2. 🟡 フィールド名や文脈から推測した適切な値を使用\n`;
  instructions += `3. 🟠 フィールドタイプに基づく標準的な値を使用\n`;
  instructions += `4. 🔴 汎用的な有効値を最後の手段として使用\n\n`;
  
  instructions += `⚠️ **重要な注意事項**\n`;
  instructions += `- 上記の推奨値を必ず使用してください\n`;
  instructions += `- 「テストデータ」のような汎用的な値は避けてください\n`;
  instructions += `- 実際のユーザーが入力するような現実的な値を使用してください\n`;
  instructions += `- 日付は未来の日付を使用してください\n`;
  
  return instructions;
}

// メイン処理
(async () => {
  try {
    console.log('🚀 スマートテストシナリオ生成開始');

    // CLI引数の解析
    const cliOptions = parseCLIArgs();
    validateOptions(cliOptions);
    
    console.log('📋 CLIオプション:', cliOptions);

    // 必須パラメータの確認
    let url = cliOptions.url || config.targetUrl;
    let testGoal = cliOptions.goal || "基本的な機能テスト";
    
    if (!url) {
      throw new Error('テスト対象URLが指定されていません');
    }
    
    // 📊 テスト観点フォーマットファイルの動的読み込み（WebUIアップロード対応）
    let testPointFormatPath;
    const uploadedCsvPath = path.resolve(__dirname, '../test_point/uploaded_TestPoint_Format.csv');
    if (fs.existsSync(uploadedCsvPath)) {
      testPointFormatPath = uploadedCsvPath;
      console.log(`🛠️ [Debug] WebUIアップロード済みテスト観点フォーマットを使用: ${testPointFormatPath}`);
    } else {
      testPointFormatPath = path.resolve(__dirname, '../test_point/TestPoint_Format.csv');
      console.log(`🛠️ [Debug] デフォルトテスト観点フォーマットを使用: ${testPointFormatPath}`);
    }
    
    // config.jsonからユーザーストーリー情報を読み取り（トレーサビリティ確保）
    let userStoryInfo = null;
    try {
      if (config.userStory) {
        userStoryInfo = config.userStory;
        console.log(`📝 ユーザーストーリーID ${userStoryInfo.currentId} を使用してrouteを生成します`);
      }
    } catch (error) {
      console.log('⚠️ ユーザーストーリー情報を読み取れませんでした');
    }

    // PDF処理
    let pdfFileInfo = null;
    let openai = new OpenAI(openAIConfig);
    
    if (cliOptions.specPdf) {
      console.log(`📄 PDF仕様書を処理中: ${cliOptions.specPdf}`);
      pdfFileInfo = await uploadPDFToOpenAI(cliOptions.specPdf, openai);
    }

    // 1. 動的DOM情報取得
    const pageInfo = await extractDynamicPageInfo(url);

    // 2. テストポイント読み込み（最新ファイル、オプション）
    let testPoints = null;
    const resultsDir = path.resolve(__dirname, '../test-results');
    const tpFiles = fs.readdirSync(resultsDir)
      .filter(f => f.startsWith('testPoints_') && f.endsWith('.json'))
      .sort();
    
    if (tpFiles.length > 0) {
      const latestTP = tpFiles[tpFiles.length - 1];
      testPoints = JSON.parse(fs.readFileSync(path.join(resultsDir, latestTP), 'utf-8'));
      console.log(`🛠️ [Debug] Loaded testPoints from: ${latestTP}`);
    }

    // 3. 自然言語テストケースファイルの確認（新機能）
    let naturalTestCasesFile = cliOptions.naturalTestCases || null;
    
    // 🔧 新機能: modeパラメータによる強制切り替え
    const forceMode = cliOptions.mode || null;
    if (forceMode === 'ai_analysis') {
      console.log('🤖 AI分析モード強制実行: DOM照合をスキップします');
      naturalTestCasesFile = null; // DOM照合を無効化
    } else if (naturalTestCasesFile) {
      console.log(`🔄 DOM照合モードを使用: ${naturalTestCasesFile}`);
    }

    // 4. スマートAI呼び出し（DOM照合または従来モード）
    console.log('🤖 AI分析開始...');
    const routeJson = await generateSmartTestRoute(url, testGoal, pageInfo, testPoints, pdfFileInfo, userStoryInfo, naturalTestCasesFile);
    if (!routeJson) throw new Error('ルート生成に失敗しました');

    // 5. 保存
    const outPath = path.join(resultsDir, `route_${getTimestamp()}.json`);
    fs.writeFileSync(outPath, JSON.stringify(routeJson, null, 2), 'utf-8');
    console.log(`💾 Smart Route JSON saved to ${outPath}`);
    
    // DOM照合モードの場合、使用された自然言語テストケース情報をログ出力
    if (naturalTestCasesFile && routeJson.generated_from_natural_case) {
      console.log(`🔗 トレーサビリティ: 自然言語テストケース ID ${routeJson.generated_from_natural_case} から生成`);
      console.log(`📝 元観点: ${routeJson.original_viewpoint?.substring(0, 100)}...`);
    }
    
    console.log('✅ スマートテストシナリオ生成が完了しました');
    process.exit(0);
  } catch (err) {
    console.error('❌ エラーが発生しました:', err);
    process.exit(1);
  }
})();

// ヘルパー: JSTタイムスタンプ（yymmddhhmmss）
function getTimestamp() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  const pad = n => String(n).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${yy}${mm}${dd}${hh}${mi}${ss}`;
}