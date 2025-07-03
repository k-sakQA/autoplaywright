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
      
      // ボタン要素
      document.querySelectorAll('button, input[type="button"], input[type="submit"]').forEach((el, index) => {
        if (index < 10) {
          const text = el.textContent?.trim() || el.value || el.getAttribute('aria-label') || '';
          if (text) {
            info.elements.buttons.push({
              text: text,
              type: el.type || 'button',
              selector: `text="${text}"`,
              fallbackSelector: el.type ? `[type="${el.type}"]` : 'button'
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
 * 実行可能なテストケースをPlaywright形式に変換
 * @param {Object} testCase - 自然言語テストケース
 * @param {Object} domInfo - DOM情報
 * @param {string} targetUrl - 対象URL
 * @returns {Object} Playwright実装
 */
function convertToPlaywrightImplementation(testCase, domInfo, targetUrl) {
  const steps = [];
  
  // 基本的なページアクセス
  steps.push({
    label: "対象ページにアクセスする",
    action: "load",
    target: targetUrl
  });

  // カテゴリ別の実装生成
  switch (testCase.category) {
    case 'display':
      return generateDisplaySteps(testCase, domInfo, steps);
    case 'input_validation':
      return generateInputValidationSteps(testCase, domInfo, steps);
    case 'interaction':
      return generateInteractionSteps(testCase, domInfo, steps);
    case 'navigation':
      return generateNavigationSteps(testCase, domInfo, steps);
    case 'data_verification':
      return generateDataVerificationSteps(testCase, domInfo, steps);
    default:
      return generateGeneralSteps(testCase, domInfo, steps);
  }
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

  // 送信ボタンの操作
  const submitButton = domInfo.elements.buttons.find(btn => 
    btn.text.includes('送信') || btn.text.includes('確認') || btn.type === 'submit'
  );
  
  if (submitButton) {
    steps.push({
      label: "フォームを送信",
      action: "click",
      target: submitButton.selector
    });
  }

  return createRouteObject(testCase, steps);
}

/**
 * 入力検証系のステップをDOM情報から生成（依存関係対応版）
 */
function generateInputValidationStepsFromDOM(steps, domInfo) {
  console.log('🔍 DOM情報から入力検証ステップを生成中...');
  
  // 動的要素の依存関係パターン
  const dynamicElementPatterns = [
    {
      name: 'email_field',
      targetPattern: /email/i,
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
      name: 'phone_field',
      targetPattern: /phone|tel/i,
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
    
    // 動的要素の依存関係をチェック
    let dependencies = [];
    for (const pattern of dynamicElementPatterns) {
      if (pattern.targetPattern.test(input.name || input.id || '')) {
        dependencies = pattern.dependencies;
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
      // 有効な値の入力
      const validValue = generateTestValueForInput(input.type);
      steps.push({
        label: `${input.name || input.id || input.type}に有効な値を入力`,
        action: 'fill',
        target: inputSelector,
        value: validValue
      });

      // 必須チェック（required属性がある場合）
      if (input.required) {
        steps.push({
          label: `${input.name || input.id || input.type}を空にして必須チェック`,
          action: 'fill',
          target: inputSelector,
          value: ''
        });
      }

      // 無効な値のテスト（適切な場合）
      if (input.type === 'email' || input.type === 'number') {
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
        label: `${input.name || input.type}にテストデータを入力`,
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
    default:
      return 'テストデータ';
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
 * @returns {Object} Playwright実装
 */
function generatePlaywrightRouteFromNaturalCase(naturalCase, domInfo, url, userStoryInfo) {
  const steps = [];
  
  // 基本的なページアクセス
  steps.push({
    label: "対象ページにアクセスする",
    action: "load",
    target: url
  });

  // カテゴリ別の実装生成
  switch (naturalCase.category) {
    case 'display':
      generateDisplayStepsFromDOM(steps, domInfo);
      break;
    case 'input_validation':
      generateInputValidationStepsFromDOM(steps, domInfo);
      break;
    case 'interaction':
      generateInteractionStepsFromDOM(steps, domInfo);
      break;
    case 'navigation':
      generateNavigationStepsFromDOM(steps, domInfo);
      break;
    case 'data_verification':
      generateDataVerificationStepsFromDOM(steps, domInfo);
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
 * データ検証系のステップをDOM情報から生成
 */
function generateDataVerificationStepsFromDOM(steps, domInfo) {
  const testDataSet = {
    date: "2025/07/25",
    term: "2",
    "head-count": "2", 
    username: "山田太郎",
    email: "test@example.com"
  };

  // データ入力
  domInfo.elements.inputs.forEach((input, index) => {
    if (input.name && testDataSet[input.name]) {
      steps.push({
        label: `${input.name}に「${testDataSet[input.name]}」を入力`,
        action: "fill",
        target: input.recommendedSelector,
        value: testDataSet[input.name]
      });
    } else if (input.type && input.type !== 'submit' && input.type !== 'button') {
      const testValue = generateTestValueForInput(input.type);
      const fieldLabel = input.placeholder || input.id || `フィールド${index + 1}`;
      steps.push({
        label: `${fieldLabel}に「${testValue}」を入力`,
        action: "fill",
        target: input.recommendedSelector,
        value: testValue
      });
    }
  });

  // プルダウン選択（確認のご連絡の動的表示対応）
  const selectInputs = domInfo.elements.inputs.filter(input => input.tagName === 'SELECT');
  selectInputs.forEach((select) => {
    if (select.name === 'contact') {
      steps.push({
        label: "確認のご連絡方法のプルダウンから「メールでのご連絡」を選択",
        action: "fill",
        target: select.recommendedSelector,
        value: "email"
      });
      
      // メールアドレス入力欄が動的に表示されるまで待機
      steps.push({
        label: "メールアドレス入力欄が表示されるまで待機",
        action: "waitForSelector",
        target: "[name='email']"
      });
      
      // メールアドレスを入力
      steps.push({
        label: "メールアドレスを入力",
        action: "fill",
        target: "[name='email']",
        value: testDataSet.email
      });
    }
  });

  // 送信・確認
  const submitButton = domInfo.elements.buttons.find(btn => 
    btn.text.includes('確認') || btn.text.includes('送信') || btn.text.includes('予約')
  );
  
  if (submitButton) {
    steps.push({
      label: `「${submitButton.text}」ボタンをクリック`,
      action: "click",
      target: submitButton.selector
    });

    // データ確認ステップ
    Object.entries(testDataSet).forEach(([key, value]) => {
      if (key !== 'email') { // emailは後で個別確認
        steps.push({
          label: `入力した${key}「${value}」が正しく表示されることを確認`,
          action: "assertVisible",
          target: `:has-text("${value}")`
        });
      }
    });

    // メールアドレスの確認
    steps.push({
      label: `入力したメールアドレス「${testDataSet.email}」が正しく表示されることを確認`,
      action: "assertVisible", 
      target: `:has-text("${testDataSet.email}")`
    });
  }
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
    default:
      return 'テストデータ';
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
async function processCategoryBatch(testCasesData, pageInfo, url, userStoryInfo) {
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
          const playwrightRoute = generatePlaywrightRouteFromNaturalCase(selectedCase, pageInfo, url, userStoryInfo);
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
async function processSingleCategory(testCasesData, pageInfo, url, userStoryInfo) {
  const feasibilityAnalysis = analyzeTestCaseFeasibility(pageInfo, testCasesData.testCases);
  
  if (feasibilityAnalysis.suggestedCases.length === 0) {
    console.log('⚠️ 実行可能なテストケースが見つかりませんでした');
    console.log('📋 問題のあるケース:', feasibilityAnalysis.problematicCases.length);
    throw new Error(`${testCasesData.metadata.category}分類で実行可能なテストケースが見つかりませんでした`);
  }

  // 最も適したテストケースをPlaywright実装に変換
  const selectedCase = feasibilityAnalysis.suggestedCases[0];
  console.log(`🎯 選択されたテストケース: ${selectedCase.category} - ${selectedCase.original_viewpoint.substring(0, 60)}...`);
  
  const playwrightRoute = generatePlaywrightRouteFromNaturalCase(selectedCase, pageInfo, url, userStoryInfo);
  playwrightRoute.category = testCasesData.metadata.category;
  playwrightRoute.feasibility_score = selectedCase.feasibilityScore;
  playwrightRoute.processing_mode = 'single_category';
  
  console.log('✅ DOM照合によるPlaywright実装生成が完了しました');
  return playwrightRoute;
}

/**
 * レガシー互換モード
 */
async function processLegacyMode(testCasesData, pageInfo, url, userStoryInfo) {
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
  
  const playwrightRoute = generatePlaywrightRouteFromNaturalCase(selectedCase, pageInfo, url, userStoryInfo);
  playwrightRoute.processing_mode = 'legacy';
  
  console.log('✅ DOM照合によるPlaywright実装生成が完了しました');
  return playwrightRoute;
}

// スマートテストルート生成
async function generateSmartTestRoute(url, testGoal, pageInfo, testPoints = null, pdfFileInfo = null, userStoryInfo = null, naturalTestCasesFile = null) {
  // 自然言語テストケースが指定されている場合はDOM照合モードで実行
  if (naturalTestCasesFile) {
    console.log('🔄 DOM照合モードで実行します');
    
    // 1. 自然言語テストケースを読み込み
    const testCasesData = loadNaturalLanguageTestCases(naturalTestCasesFile);
    
    // 処理モード別に分岐
    if (testCasesData.metadata.processing_mode === 'category_batch') {
      console.log('📂 分類別一括処理モードで実行します');
      return await processCategoryBatch(testCasesData, pageInfo, url, userStoryInfo);
    } else if (testCasesData.metadata.processing_mode === 'single_category') {
      console.log(`📁 単一分類処理モード: ${testCasesData.metadata.category}`);
      return await processSingleCategory(testCasesData, pageInfo, url, userStoryInfo);
    } else {
      console.log('🔄 レガシー互換モードで実行します');
      const legacyResult = await processLegacyMode(testCasesData, pageInfo, url, userStoryInfo);
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

  let user = `以下の情報を基に、ユーザーの意図に沿った精密なE2Eテストシナリオを生成してください。

【ユーザーのテスト意図】
${testGoal}

【ページ動的DOM情報】
\`\`\`json
${JSON.stringify(pageInfo, null, 2)}
\`\`\`

【重要】上記DOM情報に含まれる要素のみを使用してください。存在しない要素は絶対に使用しないでください。

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
    if (naturalTestCasesFile) {
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