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
      return '2025-07-25';
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
      return '無効な日付';
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
 * 入力検証系のステップをDOM情報から生成
 */
function generateInputValidationStepsFromDOM(steps, domInfo) {
  // 各入力フィールドに対する検証
  domInfo.elements.inputs.forEach((input, index) => {
    if (input.type === 'text' || input.type === 'email' || input.type === 'number' || input.type === 'date') {
      const testValue = generateTestValueForInput(input.type);
      const fieldLabel = input.name || input.placeholder || `入力フィールド${index + 1}`;
      
      steps.push({
        label: `${fieldLabel}に有効な値を入力`,
        action: "fill",
        target: input.recommendedSelector,
        value: testValue
      });

      // 必須フィールドの場合は空文字テストも追加
      if (input.required) {
        steps.push({
          label: `${fieldLabel}を空にして必須チェック`,
          action: "fill",
          target: input.recommendedSelector,
          value: ""
        });
      }
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
}

/**
 * インタラクション系のステップをDOM情報から生成
 */
function generateInteractionStepsFromDOM(steps, domInfo) {
  // プルダウン選択
  const selectInputs = domInfo.elements.inputs.filter(input => input.tagName === 'SELECT');
  selectInputs.forEach((select, index) => {
    if (index < 2) {
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

  // プルダウン選択
  const selectInputs = domInfo.elements.inputs.filter(input => input.tagName === 'SELECT');
  selectInputs.forEach((select) => {
    if (select.name === 'contact') {
      steps.push({
        label: "確認のご連絡方法を選択",
        action: "fill",
        target: select.recommendedSelector,
        value: "email"
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
      return '2025-07-25';
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