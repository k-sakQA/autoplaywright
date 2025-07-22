import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { ScreenshotPathManager } from './utils/screenshotPathManager.js';
import { ScreenshotResolver } from './utils/screenshotResolver.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function readJsonFile(filePath) {
  try {
    const content = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error);
    return null;
  }
}

async function readCsvFile(filePath) {
  try {
    const content = await fs.promises.readFile(filePath, 'utf8');
    return content;
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error);
    return null;
  }
}

function createTraceableTestReport(testPoints, route, result, userStoryInfo = null) {
  const executionTime = new Date().toISOString();
  
  // 修正ルートかどうかを判定
  const isFixedRoute = result?.is_fixed_route || false;
  const appliedFixes = result?.applied_fixes || [];
  
  // 🚀 フェーズ3: 包括的テストフォーマット対応のトレーサビリティ強化
  const isComprehensiveTest = result?.steps?.some(step => step.comprehensive_test) || false;
  const testComplexity = isComprehensiveTest ? 'comprehensive' : 'standard';
  
  console.log(`📊 テストフォーマット: ${testComplexity} (包括的: ${isComprehensiveTest})`);
  
  // URL取得の優先順位を改善：ルート、結果、実行ステップのloadアクションから取得
  let testUrl = route.url || result.url || '';
  
  // ルートのステップから最初のload URLを取得
  if (!testUrl && route.steps && Array.isArray(route.steps)) {
    const loadStep = route.steps.find(step => 
      step.action === 'load' || step.action === 'goto'
    );
    if (loadStep) {
      testUrl = loadStep.target || loadStep.value || '';
    }
  }
  
  // 結果のステップから最初のload URLを取得
  if (!testUrl && result.steps && Array.isArray(result.steps)) {
    const loadStep = result.steps.find(step => 
      step.action === 'load' || step.action === 'goto'
    );
    if (loadStep) {
      testUrl = loadStep.target || loadStep.value || '';
    }
  }
  
  console.log(`🔗 テストURL: ${testUrl || '未設定'}`);
  
  // config.jsonからのユーザーストーリー情報を優先使用（完全なトレーサビリティ）
  let userStory, userStoryId;
  if (userStoryInfo && userStoryInfo.currentId && userStoryInfo.content) {
    // スプレッドシート表示対応：改行文字を削除してスペースに置換
    userStory = userStoryInfo.content.replace(/[\r\n]+/g, ' ').trim();
    userStoryId = userStoryInfo.currentId;
    console.log(`🔗 UIからのトレーサビリティ確保: ユーザーストーリーID ${userStoryId}`);
    console.log(`📖 使用するユーザーストーリー: ${userStory.substring(0, 100)}...`);
  } else {
    // 複数のソースからユーザーストーリーを取得試行
    const potentialStories = [
      route.userStory,
      route.goal, 
      route.analysis_context?.user_story,
      route.context?.userStory,
      result.userStory,
      result.goal
    ].filter(Boolean);
    
    if (potentialStories.length > 0) {
      userStory = potentialStories[0].replace(/[\r\n]+/g, ' ').trim();
      console.log(`📖 ルート/結果からユーザーストーリーを取得: ${userStory.substring(0, 100)}...`);
    } else {
      userStory = 'テストシナリオ実行';
      console.log(`⚠️ ユーザーストーリーが見つかりません。デフォルト値を使用: ${userStory}`);
    }
    
    userStoryId = extractUserStoryId(userStory) || 1;
    console.log(`⚠️ フォールバック: 推定ユーザーストーリーID ${userStoryId}`);
  }
  
  const reportData = [];
  
  // 重複問題解決：実行されたステップベースでレポートを生成
  if (result.steps && Array.isArray(result.steps) && result.steps.length > 0) {
    console.log(`📊 実行されたステップ数: ${result.steps.length}件`);
    
    // 🚀 包括的テスト用のステップマッピング強化
    const stepToViewpointMapping = isComprehensiveTest 
      ? createComprehensiveStepMapping(testPoints, result.steps)
      : createStepToViewpointMapping(testPoints, result.steps);
    
    result.steps.forEach((step, stepIndex) => {
      const mapping = stepToViewpointMapping[stepIndex];
      
      // ステップに適用された修正を取得
      const stepFixes = appliedFixes.filter(fix => fix.stepIndex === stepIndex);
      const fixDetails = stepFixes.length > 0 
        ? stepFixes.map(f => `${f.type}: ${f.description}`).join('; ')
        : '';
      
      // 🚀 包括的テスト特有の情報を抽出
      const isComprehensiveStep = step.comprehensive_test || false;
      const testPhase = step.phase || 'execution';
      const elementInfo = step.dom_element_info || {};
      
      if (mapping) {
        // 観点にマッピングできた場合
        const functionId = getFunctionId(mapping.functionKey, mapping.functionIndex);
        let traceableId;
        
        if (isComprehensiveStep) {
          // 包括的テストの場合：フェーズ情報を含めたID生成
          traceableId = `${userStoryId}.${functionId}.${mapping.viewpointIndex + 1}.${testPhase}`;
        } else {
          // 標準テストの場合
          traceableId = `${userStoryId}.${functionId}.${mapping.viewpointIndex + 1}`;
        }
        
        const uniqueTestCaseId = `${traceableId}-${mapping.stepInViewpoint + 1}`;
        
        // 🎯 包括的テストレポートエントリ
        const reportEntry = {
          executionTime,
          id: uniqueTestCaseId,
          userStory,
          function: mapping.functionName,
          viewpoint: mapping.viewpoint,
          testSteps: formatComprehensiveTestSteps(step, isComprehensiveStep),
          executionResult: step.status === 'success' ? 'success' : 'failed',
          errorDetail: step.error || '',
          url: testUrl,
          isFixedRoute: isFixedRoute,
          appliedFixes: fixDetails,
          // 🚀 フェーズ3: 包括的テスト固有フィールド
          testComplexity: testComplexity,
          testPhase: testPhase,
          elementType: elementInfo.tagName || 'unknown',
          elementName: elementInfo.name || elementInfo.id || 'unnamed',
          validationCount: getValidationCount(step),
          traceabilityLevel: isComprehensiveStep ? 'comprehensive' : 'standard'
        };
        
        reportData.push(reportEntry);
      } else {
        // 観点にマッピングできなかった場合は追加ステップとして扱う
        const viewpointId = Math.floor(stepIndex / 5) + 1; // 5ステップごとに新しい観点
        const testCaseId = (stepIndex % 5) + 1;
        
        let uniqueTestCaseId;
        if (isComprehensiveStep) {
          uniqueTestCaseId = `${userStoryId}.X.${viewpointId}.${testPhase}-${testCaseId}`;
        } else {
          uniqueTestCaseId = `${userStoryId}.X.${viewpointId}-${testCaseId}`;
        }
        
        reportData.push({
          executionTime,
          id: uniqueTestCaseId,
          userStory,
          function: 'その他機能',
          viewpoint: isComprehensiveStep ? `包括テスト${viewpointId}(${testPhase})` : `追加実行ステップ${viewpointId}`,
          testSteps: formatComprehensiveTestSteps(step, isComprehensiveStep),
          executionResult: step.status === 'success' ? 'success' : 'failed',
          errorDetail: step.error || '',
          url: testUrl,
          isFixedRoute: isFixedRoute,
          appliedFixes: fixDetails,
          testComplexity: testComplexity,
          testPhase: testPhase,
          elementType: elementInfo.tagName || 'unknown',
          elementName: elementInfo.name || elementInfo.id || 'unnamed',
          validationCount: getValidationCount(step),
          traceabilityLevel: isComprehensiveStep ? 'comprehensive' : 'standard'
        });
      }
    });
  } else {
    console.log('⚠️ 実行されたステップが見つかりません');
  }
  
  return reportData;
}

function extractUserStoryId(userStory) {
  // ユーザーストーリーからIDを抽出（例：「ユーザーストーリー1」→1）
  const match = userStory.match(/(?:ユーザーストーリー|US|Story)(\d+)/i);
  return match ? parseInt(match[1]) : null;
}

function groupTestPointsByFunction(testPoints) {
  if (!testPoints || !Array.isArray(testPoints)) {
    return { 'Default': [] };
  }
  
  const groups = {};
  
  testPoints.forEach(testPoint => {
    const functionKey = determineFunctionKey(testPoint);
    if (!groups[functionKey]) {
      groups[functionKey] = [];
    }
    groups[functionKey].push(testPoint);
  });
  
  return groups;
}

function determineFunctionKey(testPoint) {
  // 自然言語テストケースのカテゴリを優先使用
  if (testPoint.category) {
    switch (testPoint.category) {
      case 'display':
        return 'Display';
      case 'input_validation':
        return 'Input';
      case 'error_handling':
        return 'Error';
      case 'navigation':
        return 'Navigation';
      case 'interaction':
        return 'Interaction';
      case 'data_verification':
        return 'DataVerification';
      case 'edge_case':
        return 'EdgeCase';
      case 'compatibility':
        return 'Compatibility';
      case 'operations':
        return 'Operations';
      default:
        return 'General';
    }
  }
  
  // フォールバック：説明文からキーワードベースで分類
  const description = testPoint['考慮すべき仕様の具体例'] || 
                     testPoint.description || 
                     testPoint.viewpoint || 
                     testPoint.content || 
                     testPoint.original_viewpoint || '';
  
  // 機能を推定するキーワードベースの分類
  if (description.includes('入力') || description.includes('フォーム') || description.includes('記入')) {
    return 'Input';
  } else if (description.includes('表示') || description.includes('画面') || description.includes('確認')) {
    return 'Display';
  } else if (description.includes('ログイン') || description.includes('認証')) {
    return 'Authentication';
  } else if (description.includes('予約') || description.includes('申込') || description.includes('注文')) {
    return 'Booking';
  } else if (description.includes('検索') || description.includes('絞り込み')) {
    return 'Search';
  } else if (description.includes('決済') || description.includes('支払') || description.includes('精算')) {
    return 'Payment';
  } else if (description.includes('ナビゲーション') || description.includes('メニュー') || description.includes('遷移')) {
    return 'Navigation';
  } else if (description.includes('エラー') || description.includes('メッセージ')) {
    return 'Error';
  } else {
    return 'General';
  }
}

function getFunctionId(functionKey, index) {
  const functionIdMap = {
    'Authentication': 'A',
    'Display': 'B', 
    'Input': 'C',
    'Booking': 'D',
    'Search': 'E',
    'Payment': 'F',
    'Navigation': 'G',
    'Error': 'H',
    'Interaction': 'I',
    'DataVerification': 'J',
    'EdgeCase': 'K',
    'Compatibility': 'L',
    'Operations': 'M',
    'General': 'N'
  };
  
  return functionIdMap[functionKey] || String.fromCharCode(65 + index); // A, B, C, ...
}

function determineFunctionName(testPoint, functionKey) {
  const functionNameMap = {
    'Authentication': '認証機能',
    'Display': '表示機能',
    'Input': '入力機能', 
    'Booking': '予約機能',
    'Search': '検索機能',
    'Payment': '決済機能',
    'Navigation': 'ナビゲーション機能',
    'Error': 'エラーハンドリング機能',
    'Interaction': 'インタラクション機能',
    'DataVerification': 'データ検証機能',
    'EdgeCase': 'エッジケース機能',
    'Compatibility': '互換性機能',
    'Operations': '運用機能',
    'General': '基本機能'
  };
  
  return functionNameMap[functionKey] || '汎用機能';
}

function findRelatedSteps(testPoint, steps, fallbackIndex) {
  if (!steps || !Array.isArray(steps)) return [];
  
  const description = testPoint['考慮すべき仕様の具体例'] || 
                     testPoint.description || 
                     testPoint.viewpoint || 
                     testPoint.content || '';
  
  // 観点の内容に関連するステップを検索
  const relatedSteps = steps.filter(step => {
    if (!step.label && !step.action) return false;
    
    const stepText = (step.label + ' ' + step.action).toLowerCase();
    const keywords = extractKeywords(description);
    
    return keywords.some(keyword => stepText.includes(keyword.toLowerCase()));
  });
  
  // 関連ステップが見つからない場合、フォールバックとして順番に対応
  if (relatedSteps.length === 0 && fallbackIndex < steps.length) {
    return [steps[fallbackIndex]];
  }
  
  return relatedSteps;
}

function findRelatedResults(testPoint, resultSteps, fallbackIndex) {
  if (!resultSteps || !Array.isArray(resultSteps)) return [];
  
  const description = testPoint['考慮すべき仕様の具体例'] || 
                     testPoint.description || 
                     testPoint.viewpoint || 
                     testPoint.content || '';
  
  // 観点の内容に関連する結果を検索
  const relatedResults = resultSteps.filter(step => {
    if (!step.label && !step.action) return false;
    
    const stepText = (step.label + ' ' + step.action).toLowerCase();
    const keywords = extractKeywords(description);
    
    return keywords.some(keyword => stepText.includes(keyword.toLowerCase()));
  });
  
  // 関連結果が見つからない場合、フォールバックとして順番に対応
  if (relatedResults.length === 0 && fallbackIndex < resultSteps.length) {
    return [resultSteps[fallbackIndex]];
  }
  
  return relatedResults;
}

function extractKeywords(text) {
  // テスト観点から重要なキーワードを抽出
  const keywords = [];
  
  // 動詞キーワード
  const verbs = ['入力', '選択', '確認', '表示', 'クリック', '押下', '遷移', 'ログイン', '検索', '予約'];
  verbs.forEach(verb => {
    if (text.includes(verb)) keywords.push(verb);
  });
  
  // 名詞キーワード（UI要素など）
  const nouns = ['ボタン', 'フォーム', 'メニュー', 'ページ', '画面', 'フィールド', 'リンク'];
  nouns.forEach(noun => {
    if (text.includes(noun)) keywords.push(noun);
  });
  
  return keywords.length > 0 ? keywords : [text.substring(0, 10)]; // フォールバック
}

function hasKeywordMatch(routeViewpoint, testCaseTitle) {
  // ルートの観点とテストケースのタイトルでキーワードマッチング
  const routeKeywords = extractKeywords(routeViewpoint);
  const testCaseKeywords = extractKeywords(testCaseTitle);
  
  // 共通キーワードを検索
  const commonKeywords = routeKeywords.filter(keyword => 
    testCaseKeywords.some(tcKeyword => 
      tcKeyword.includes(keyword) || keyword.includes(tcKeyword)
    )
  );
  
  // 2つ以上のキーワードが一致する場合にマッチとする
  return commonKeywords.length >= 2;
}

function createStepToViewpointMapping(testPoints, executedSteps) {
  const mapping = {};
  
  if (!testPoints || !Array.isArray(testPoints) || !executedSteps || !Array.isArray(executedSteps)) {
    return mapping;
  }
  
  // テスト観点を機能別にグループ化
  const functionalGroups = groupTestPointsByFunction(testPoints);
  let globalStepIndex = 0;
  
  // 実行されたステップを順番に各観点に均等に分散
  const totalViewpoints = Object.keys(functionalGroups).reduce((total, key) => total + functionalGroups[key].length, 0);
  const stepsPerViewpoint = Math.ceil(executedSteps.length / Math.max(totalViewpoints, 1));
  
  let currentViewpointIndex = 0;
  let stepInViewpoint = 0;
  
  Object.keys(functionalGroups).forEach((functionKey, functionIndex) => {
    const testPointsInFunction = functionalGroups[functionKey];
    
    testPointsInFunction.forEach((testPoint, viewpointIndex) => {
      // 実際のテスト観点内容を優先使用
      const viewpoint = testPoint['考慮すべき仕様の具体例'] || 
                       testPoint.original_viewpoint || 
                       testPoint.description || 
                       testPoint.viewpoint || 
                       testPoint.content || 
                       `テスト観点${viewpointIndex + 1}`;
      const functionName = determineFunctionName(testPoint, functionKey);
      
      // この観点に割り当てるステップ数を決定
      for (let i = 0; i < stepsPerViewpoint && globalStepIndex < executedSteps.length; i++) {
        mapping[globalStepIndex] = {
          functionKey,
          functionIndex,
          viewpointIndex: currentViewpointIndex,
          stepInViewpoint: i,
          viewpoint,
          functionName
        };
        globalStepIndex++;
      }
      
      currentViewpointIndex++;
      stepInViewpoint = 0;
    });
  });
  
  console.log(`📊 ステップマッピング完了: ${Object.keys(mapping).length}/${executedSteps.length} ステップをマッピング`);
  return mapping;
}

function addUnmappedSteps(reportData, resultSteps, userStoryId, userStory, testUrl, executionTime) {
  if (!resultSteps || !Array.isArray(resultSteps)) return;
  
  resultSteps.forEach((step, index) => {
    const isAlreadyMapped = reportData.some(data => 
      data.testSteps.includes(step.label || '') ||
      data.testSteps.includes(step.action || '')
    );
    
    if (!isAlreadyMapped && step.action) {
      // 追加ステップID: {ユーザーストーリーID}.X.{観点番号}-{テストケース番号}
      const viewpointId = Math.floor(index / 3) + 1; // 3ステップごとに新しい観点
      const testCaseId = (index % 3) + 1; // 各観点内でのテストケース番号
      const uniqueTestCaseId = `${userStoryId}.X.${viewpointId}-${testCaseId}`;
      
      reportData.push({
        executionTime,
        id: uniqueTestCaseId,
        userStory,
        function: 'その他機能',
        viewpoint: step.label || `追加実行ステップ${viewpointId}`,
        testSteps: formatTestSteps(step),
        executionResult: step.status === 'success' ? 'success' : 'failed',
        errorDetail: step.error || '',
        url: testUrl
      });
    }
  });
}

function formatTestSteps(step) {
  if (!step) return '';
  
  const parts = [];
  if (step.action) {
    switch(step.action.toLowerCase()) {
      case 'load':
      case 'goto':
        parts.push(`load: ${step.target || step.value || ''}`);
        break;
      case 'click':
        parts.push(`クリック: ${step.target || ''}`);
        break;
      case 'fill':
        parts.push(`入力: ${step.target || ''} = "${step.value || ''}"`);
        break;
      case 'select':
        parts.push(`選択: ${step.target || ''} = "${step.value || ''}"`);
        break;
      case 'wait':
      case 'waitforselector':
        parts.push(`waitForSelector: ${step.target || step.value || ''}`);
        break;
      case 'waitforurl':
        parts.push(`waitForURL: ${step.target || step.value || ''}`);
        break;
      case 'verify':
      case 'assert':
      case 'assertvisible':
        parts.push(`assertVisible: ${step.target || ''}`);
        break;
      default:
        parts.push(`${step.action}: ${step.target || ''}`);
    }
  }
  
  if (step.label && !parts.join('').includes(step.label)) {
    parts.unshift(step.label);
  }
  
  return parts.join(' → ') || '実行内容不明';
}

function generateTraceableCSVReport(reportData) {
  // 🔧 重複除去：同じテストケースIDの最新結果のみを保持
  const deduplicatedData = deduplicateReportData(reportData);
  console.log(`📊 レポート重複除去: ${reportData.length}件 → ${deduplicatedData.length}件（重複${reportData.length - deduplicatedData.length}件除去）`);
  
  // 修正ルートかどうかを判定（reportDataの最初の要素から判定）
  const isFixedRoute = deduplicatedData.length > 0 && deduplicatedData[0].isFixedRoute;
  const resultHeader = isFixedRoute ? '再）実行結果' : '実行結果';
  
  // CSVヘッダー（階層的トレーサビリティ対応）
  const headers = [
    '実行日時',
    'ID', 
    'ユーザーストーリー',
    '機能',
    '観点',
    'テスト手順',
    resultHeader,
    'エラー詳細',
    'URL',
    '実行種別',
    // 🚀 フェーズ3: 包括的テスト対応フィールド
    'テスト複雑度',
    'テストフェーズ',
    '要素タイプ',
    '要素名',
    'バリデーション数',
    'トレーサビリティレベル'
  ];
  
  /**
   * CSV用の文字列をエスケープ
   * @param {string} str - エスケープする文字列
   * @returns {string} - エスケープされた文字列
   */
  function escapeCSVField(str) {
    if (str == null) return '""';
    
    const stringValue = String(str);
    
    // 改行文字、カンマ、ダブルクォートが含まれている場合はエスケープが必要
    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n') || stringValue.includes('\r')) {
      // ダブルクォートを2つのダブルクォートに置換してからクォートで囲む
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    
    return stringValue;
  }
  
  // CSVデータ行を作成
  const csvRows = [headers.join(',')];
  
  deduplicatedData.forEach(data => {
    const executionType = data.isFixedRoute ? '再実行' : '初回実行';
    const row = [
      escapeCSVField(data.executionTime),
      escapeCSVField(data.id),
      escapeCSVField(data.userStory),
      escapeCSVField(data.function || ''),
      escapeCSVField(data.viewpoint),
      escapeCSVField(data.testSteps),
      escapeCSVField(data.executionResult),
      escapeCSVField(data.errorDetail),
      escapeCSVField(data.url || ''),
      escapeCSVField(executionType),
      // 🚀 フェーズ3: 包括的テスト対応フィールド
      escapeCSVField(data.testComplexity),
      escapeCSVField(data.testPhase),
      escapeCSVField(data.elementType),
      escapeCSVField(data.elementName),
      escapeCSVField(data.validationCount),
      escapeCSVField(data.traceabilityLevel)
    ];
    csvRows.push(row.join(','));
  });
  
  console.log(`📊 CSV生成完了: ${reportData.length}行のデータ`);
  console.log(`📋 ヘッダー: ${headers.join(', ')}`);
  
  return csvRows.join('\n');
}

/**
 * 分類別バッチ処理結果のレポートを生成
 */
function generateCategoryBatchReport(batchResult, executionResult, userStoryInfo = null) {
  const executionTime = new Date().toISOString();
  
  // スクリーンショット解決システムを初期化
  const screenshotPathManager = new ScreenshotPathManager();
  const screenshotResolver = new ScreenshotResolver(screenshotPathManager);
  
  // ユーザーストーリー情報の取得
  let userStory, userStoryId;
  if (userStoryInfo && userStoryInfo.currentId && userStoryInfo.content) {
    userStory = userStoryInfo.content.replace(/[\r\n]+/g, ' ').trim();
    userStoryId = userStoryInfo.currentId;
    console.log(`🔗 分類別バッチレポート: ユーザーストーリーID ${userStoryId}`);
  } else {
    userStory = 'テスト自動実行（分類別一括処理）';
    userStoryId = 1;
    console.log(`⚠️ 分類別バッチレポート: デフォルトユーザーストーリーID ${userStoryId}`);
  }

  // URL取得
  let testUrl = '';
  if (batchResult.categories && batchResult.categories.length > 0) {
    const firstCategory = batchResult.categories[0];
    if (firstCategory.routes && firstCategory.routes.length > 0) {
      const firstRoute = firstCategory.routes[0];
      if (firstRoute.steps && Array.isArray(firstRoute.steps)) {
        const loadStep = firstRoute.steps.find(step => 
          step.action === 'load' || step.action === 'goto'
        );
        if (loadStep) {
          testUrl = loadStep.target || loadStep.value || '';
        }
      }
    }
  }

  /**
   * CSV用の文字列をエスケープ（分類別バッチ版）
   */
  function escapeCSVField(str) {
    if (str == null) return '""';
    
    const stringValue = String(str);
    
    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n') || stringValue.includes('\r')) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    
    return stringValue;
  }

  // 修正ルートかどうかを判定
  const isFixedRoute = executionResult?.is_fixed_route || false;
  const resultHeader = isFixedRoute ? '再）実行結果' : '実行結果';
  const executionType = isFixedRoute ? '再実行' : '初回実行';
  
  const headers = ['実行日時', 'ID', 'ユーザーストーリー', '機能', '観点', 'テスト手順', resultHeader, 'エラー詳細', 'URL', '実行種別',
    // 🚀 フェーズ3: 包括的テスト対応フィールド
    'テスト複雑度',
    'テストフェーズ',
    '要素タイプ',
    '要素名',
    'バリデーション数',
    'トレーサビリティレベル'
  ];
  const csvRows = [headers.join(',')];
  
  let totalRoutes = 0;
  let successfulRoutes = 0;

  // 各分類ごとにレポート行を生成
  batchResult.categories.forEach((category, categoryIndex) => {
    const categoryLetter = String.fromCharCode(65 + categoryIndex); // A, B, C...
    
    if (category.routes && category.routes.length > 0) {
      category.routes.forEach((route, routeIndex) => {
        totalRoutes++;
        
        // テスト手順の整形
        const testSteps = route.steps ? route.steps.map(step => {
          return `${step.action}: ${step.target || ''}${step.value ? ` (${step.value})` : ''}`;
        }).join(' → ') : 'テストルート実行';
        
        // 実行結果の判定（実際の実行結果があれば使用、なければルート生成成功として扱う）
        const executionSuccess = route.feasibility_score >= 0.7;
        if (executionSuccess) successfulRoutes++;
        
        // ID: {userStoryId}.{categoryLetter}.{routeIndex+1}
        const uniqueTestCaseId = `${userStoryId}.${categoryLetter}.${routeIndex + 1}`;
        
        const row = [
          escapeCSVField(executionTime),
          escapeCSVField(uniqueTestCaseId),
          escapeCSVField(userStory),
          escapeCSVField(category.category || '未分類'),
          escapeCSVField(`${category.category}系テスト${routeIndex + 1}`),
          escapeCSVField(testSteps),
          escapeCSVField(executionSuccess ? 'success' : 'low_feasibility'),
          escapeCSVField(executionSuccess ? '' : `実行可能性スコア: ${route.feasibility_score?.toFixed(2) || 'N/A'}`),
          escapeCSVField(testUrl || ''),
          escapeCSVField(executionType),
          // �� フェーズ3: 包括的テスト対応フィールド
          escapeCSVField(`${category.category}系テスト${routeIndex + 1}`),
          escapeCSVField(`${category.category}系テスト${routeIndex + 1}`),
          escapeCSVField(category.category || '未分類'),
          escapeCSVField(category.category || '未分類'),
          escapeCSVField(category.category || '未分類'),
          escapeCSVField(category.category || '未分類')
        ];
        csvRows.push(row.join(','));
      });
    } else {
      // ルートが生成されなかった分類
      const uniqueTestCaseId = `${userStoryId}.${categoryLetter}.0`;
      
      const row = [
        escapeCSVField(executionTime),
        escapeCSVField(uniqueTestCaseId),
        escapeCSVField(userStory),
        escapeCSVField(category.category || '未分類'),
        escapeCSVField(`${category.category}系テスト（未生成）`),
        escapeCSVField('テストルート生成不可'),
        escapeCSVField('not_generated'),
        escapeCSVField(category.error || '実行可能なテストケースが見つかりませんでした'),
        escapeCSVField(testUrl || ''),
        escapeCSVField(executionType),
        // 🚀 フェーズ3: 包括的テスト対応フィールド
        escapeCSVField(`${category.category}系テスト（未生成）`),
        escapeCSVField(`${category.category}系テスト（未生成）`),
        escapeCSVField(category.category || '未分類'),
        escapeCSVField(category.category || '未分類'),
        escapeCSVField(category.category || '未分類'),
        escapeCSVField(category.category || '未分類')
      ];
      csvRows.push(row.join(','));
    }
  });

  console.log(`📊 分類別バッチレポート生成完了: ${batchResult.categories.length}分類, ${totalRoutes}ルート（成功${successfulRoutes}件）`);
  
  return csvRows.join('\n');
}

/**
 * テストカバレッジを算出する（重複除去版）
 * @param {Object} testPointsData - テスト観点データ
 * @param {Object} testCasesData - テストケースデータ（分母として使用）
 * @param {Object} routeData - ルートデータ
 * @param {Object} resultData - 実行結果データ
 * @returns {Object} - カバレッジ情報
 */
async function calculateTestCoverage(testPointsData, testCasesData, routeData, resultData) {
  // 実行結果データの検証
  if (!resultData || !Array.isArray(resultData)) {
    console.log('⚠️ 実行結果データが不完全です');
    return {
      total_test_cases: 0,
      successful_test_cases: 0,
      total_steps: 0,
      successful_steps: 0,
      coverage_percentage: 0,
      failed_steps_details: []
    };
  }

  // 🔧 重複ルート除去：同じroute_idの最新結果のみを使用
  const uniqueResults = deduplicateTestResults(resultData);
  console.log(`📊 重複除去: ${resultData.length}件 → ${uniqueResults.length}件（重複${resultData.length - uniqueResults.length}件除去）`);

  // 全実行結果から成功・失敗を集計
  let totalSteps = 0;
  let successfulSteps = 0;
  let totalTestCases = 0;
  let successfulTestCases = 0;
  let failedStepsDetails = [];
  let executedRoutes = 0;
  let successfulRoutes = 0;

  uniqueResults.forEach(result => {
    executedRoutes++;

    if (result.steps && Array.isArray(result.steps)) {
      totalSteps += result.steps.length;
      const successSteps = result.steps.filter(step => step.status === 'success');
      const failedSteps = result.steps.filter(step => step.status === 'failed');
      
      successfulSteps += successSteps.length;
      
      // ルート成功判定：柔軟な成功率ベース（90%以上成功なら成功とみなす）
      const stepSuccessRate = successSteps.length / (successSteps.length + failedSteps.length);
      const isRouteSuccessful = stepSuccessRate >= 0.9 || (failedSteps.length === 0 && successSteps.length > 0);
      if (isRouteSuccessful) {
        successfulRoutes++;
      }

      // 失敗ステップの詳細情報を収集
      failedSteps.forEach(step => {
        const stepDetail = {
          label: step.label,
          action: step.action,
          target: step.target,
          value: step.value,
          error: step.error,
          error_category: classifyErrorType(step.error),
          fix_suggestions: generateFixSuggestions(step),
          skip_reason: step.skip_reason,
          route_id: result.route_id,
          timestamp: result.timestamp,
          is_retest: result.is_fixed_route || false
        };
        failedStepsDetails.push(stepDetail);
      });
    }
    
    // テストケース数の計算（重複除去後）
    if (result.total_steps) {
      totalTestCases += result.total_steps;
    }
    if (result.success_count) {
      successfulTestCases += result.success_count;
    }
  });

  // 🔧 失敗ステップの重複除去（同じステップの最新結果のみ保持）
  const uniqueFailedSteps = deduplicateFailedSteps(failedStepsDetails);
  console.log(`🔄 失敗ステップ重複除去: ${failedStepsDetails.length}件 → ${uniqueFailedSteps.length}件`);

  // カバレッジ情報を計算
  const coverage = {
    total_test_cases: totalTestCases,
    successful_test_cases: successfulTestCases,
    total_steps: totalSteps,
    successful_steps: successfulSteps,
    coverage_percentage: totalTestCases > 0 ? (successfulTestCases / totalTestCases) * 100 : 0,
    step_success_rate: totalSteps > 0 ? (successfulSteps / totalSteps) * 100 : 0,
    route_success_rate: executedRoutes > 0 ? (successfulRoutes / executedRoutes) * 100 : 0,
    executed_routes: executedRoutes,
    successful_routes: successfulRoutes,
    failed_routes: executedRoutes - successfulRoutes,
    deduplication_info: {
      original_results: resultData.length,
      unique_results: uniqueResults.length,
      duplicates_removed: resultData.length - uniqueResults.length,
      failed_steps_original: failedStepsDetails.length,
      failed_steps_unique: uniqueFailedSteps.length,
      failed_steps_duplicates_removed: failedStepsDetails.length - uniqueFailedSteps.length
    },
    failed_steps_details: uniqueFailedSteps
  };

  console.log(`📈 カバレッジ計算完了:`);
  console.log(`   - テストケース成功率: ${coverage.coverage_percentage.toFixed(1)}%`);
  console.log(`   - ステップ成功率: ${coverage.step_success_rate.toFixed(1)}%`);
  console.log(`   - ルート成功率: ${coverage.route_success_rate.toFixed(1)}%`);

  return coverage;
}

/**
 * レポートデータの重複除去
 * @param {Array} reportData - レポートデータ配列
 * @returns {Array} - 重複除去されたレポートデータ配列
 */
function deduplicateReportData(reportData) {
  const testCaseMap = new Map();
  
  reportData.forEach(data => {
    const testCaseId = data.id || 'unknown';
    const timestamp = new Date(data.executionTime || 0).getTime();
    
    // 同じIDがある場合は、より新しいタイムスタンプのものを使用
    if (!testCaseMap.has(testCaseId) || testCaseMap.get(testCaseId).timestamp < timestamp) {
      testCaseMap.set(testCaseId, {
        ...data,
        timestamp: timestamp
      });
    }
  });
  
  // Map から配列に変換し、元の形式に戻す
  return Array.from(testCaseMap.values()).map(d => ({
    ...d,
    executionTime: new Date(d.timestamp).toISOString() // タイムスタンプを元の形式に戻す
  }));
}

/**
 * テスト結果の重複除去
 * @param {Array} resultData - 実行結果配列
 * @returns {Array} - 重複除去された結果配列
 */
function deduplicateTestResults(resultData) {
  const routeMap = new Map();
  
  resultData.forEach(result => {
    const routeId = result.route_id || 'unknown';
    const timestamp = new Date(result.timestamp || 0).getTime();
    
    // 同じroute_idがある場合は、より新しいタイムスタンプのものを使用
    if (!routeMap.has(routeId) || routeMap.get(routeId).timestamp < timestamp) {
      routeMap.set(routeId, {
        ...result,
        timestamp: timestamp
      });
    }
  });
  
  // Map から配列に変換
  const uniqueResults = Array.from(routeMap.values());
  
  // デバッグ情報
  if (resultData.length !== uniqueResults.length) {
    console.log(`🔄 重複除去詳細:`);
    const removedCount = resultData.length - uniqueResults.length;
    console.log(`   - 除去された重複結果: ${removedCount}件`);
    
    // 重複していたroute_idを表示
    const routeIds = resultData.map(r => r.route_id || 'unknown');
    const duplicateIds = routeIds.filter((id, index) => routeIds.indexOf(id) !== index);
    if (duplicateIds.length > 0) {
      console.log(`   - 重複していたroute_id: ${[...new Set(duplicateIds)].join(', ')}`);
    }
  }
  
  return uniqueResults.map(r => ({
    ...r,
    timestamp: new Date(r.timestamp).toISOString() // タイムスタンプを元の形式に戻す
  }));
}

/**
 * 失敗ステップの重複除去
 * @param {Array} failedStepsDetails - 失敗ステップ詳細配列
 * @returns {Array} - 重複除去された失敗ステップ配列
 */
function deduplicateFailedSteps(failedStepsDetails) {
  const stepMap = new Map();
  
  failedStepsDetails.forEach(step => {
    // ステップの一意キーを作成（label + action + target + value + error）
    const stepKey = `${step.label || ''}|${step.action || ''}|${step.target || ''}|${step.value || ''}|${step.error || ''}`;
    const timestamp = new Date(step.timestamp || 0).getTime();
    
    // 同じステップがある場合は、より新しいタイムスタンプのものを使用
    if (!stepMap.has(stepKey) || stepMap.get(stepKey).timestamp < timestamp) {
      stepMap.set(stepKey, {
        ...step,
        timestamp: timestamp
      });
    }
  });
  
  // Map から配列に変換
  const uniqueSteps = Array.from(stepMap.values());
  
  // デバッグ情報
  if (failedStepsDetails.length !== uniqueSteps.length) {
    const removedCount = failedStepsDetails.length - uniqueSteps.length;
    console.log(`   - 除去された重複失敗ステップ: ${removedCount}件`);
    
    // 重複していたステップを表示
    const stepLabels = failedStepsDetails.map(s => s.label || 'unknown');
    const duplicateLabels = stepLabels.filter((label, index) => stepLabels.indexOf(label) !== index);
    if (duplicateLabels.length > 0) {
      console.log(`   - 重複していたステップ: ${[...new Set(duplicateLabels)].join(', ')}`);
    }
  }
  
  return uniqueSteps.map(s => ({
    ...s,
    timestamp: new Date(s.timestamp).toISOString() // タイムスタンプを元の形式に戻す
  }));
}

/**
 * エラータイプを分類
 */
function classifyErrorType(error) {
  if (!error) return 'unknown';
  
  if (error.includes('element is not visible')) {
    return 'visibility_issue';
  } else if (error.includes('element is not enabled') || error.includes('disabled')) {
    return 'element_disabled';
  } else if (error.includes('Timeout') || error.includes('timeout')) {
    return 'timeout_error';
  } else if (error.includes('not found') || error.includes('locator resolved to')) {
    return 'element_not_found';
  } else if (error.includes('checkbox') && error.includes('fill')) {
    return 'checkbox_fill_error';
  } else if (error.includes('Cannot type text into input[type=number]')) {
    return 'validation_error';
  } else {
    return 'unknown_error';
  }
}

/**
 * 修正提案を生成
 */
function generateFixSuggestions(step) {
  const suggestions = [];
  const errorType = classifyErrorType(step.error);

  switch (errorType) {
    case 'visibility_issue':
      suggestions.push({
        message: '要素が非表示になっている可能性があります。ページの状態を確認し、要素が表示されるまで待機する処理を追加してください。',
        confidence: 0.8,
        type: 'wait_for_visible'
      });
      break;

    case 'element_disabled':
      suggestions.push({
        message: '要素が無効化されています。他の操作を先に実行して要素を有効化する必要があります。',
        confidence: 0.9,
        type: 'enable_element'
      });
      break;

    case 'timeout_error':
      suggestions.push({
        message: 'タイムアウトが発生しました。要素のセレクタを確認するか、待機時間を延長してください。',
        confidence: 0.7,
        type: 'increase_timeout'
      });
      break;

    case 'element_not_found':
      suggestions.push({
        message: '要素が見つかりません。セレクタを確認し、代替のセレクタを試してください。',
        confidence: 0.8,
        type: 'update_selector'
      });
      if (step.target.includes('[name="')) {
        const nameValue = step.target.match(/\[name="([^"]+)"\]/)?.[1];
        if (nameValue) {
          suggestions.push({
            message: `ID属性での検索を試す`,
            confidence: 0.6,
            type: 'alternative_selector',
            new_target: `#${nameValue}`
          });
        }
      }
      break;

    case 'checkbox_fill_error':
      suggestions.push({
        message: 'チェックボックスにfillアクションではなく、clickアクションを使用してください。',
        confidence: 0.95,
        type: 'change_action',
        new_action: 'click'
      });
      break;

    case 'validation_error':
      suggestions.push({
        message: 'これは期待されたバリデーションエラーです。テストが正しく動作していることを示しています。',
        confidence: 0.9,
        type: 'expected_validation'
      });
      break;

    default:
      suggestions.push({
        message: 'エラーの詳細を確認し、要素の状態やページの構造を再度チェックしてください。',
        confidence: 0.3,
        type: 'manual_investigation'
      });
  }

  return suggestions;
}

/**
 * 品質スコアを算出（新カバレッジ指標対応版）
 * @param {Object} coverage - カバレッジデータ
 * @returns {number} - 品質スコア（0-100）
 */
function calculateQualityScore(coverage) {
  const weights = {
    generation: 0.2,     // テスト観点 → テストケース生成効率
    automation: 0.3,     // テストケース → 自動化率
    feasibility: 0.3,    // 自動化 → 実行可能性
    success: 0.2         // 実行 → 成功率
  };

  const generationRate = coverage.source_analysis?.generation_efficiency || 0;
  const automationRate = coverage.automation_analysis?.automation_rate || 0;
  const feasibilityRate = coverage.automation_analysis?.feasibility_rate || 0;
  const successRate = coverage.execution_analysis?.execution_success_rate || 0;

  const qualityScore = 
    (generationRate * weights.generation) +
    (automationRate * weights.automation) +
    (feasibilityRate * weights.feasibility) +
    (successRate * weights.success);

  return Math.round(qualityScore * 100) / 100;
}

/**
 * カバレッジデータをCSV形式で出力（人間対応項目を含む詳細版）
 * @param {Object} coverage - カバレッジデータ
 * @param {string} outputPath - 出力パス
 */
function generateCoverageCSV(coverage, outputPath) {
  const csvRows = [
    ['カテゴリ', 'メトリクス', '値', '割合(%)', '備考'],
    
    // ソース分析
    ['ソース分析', 'テスト観点総数', coverage.source_analysis?.total_test_points || 0, '', 'AI入力'],
    ['ソース分析', '生成テストケース数', coverage.source_analysis?.total_generated_test_cases || 0, '', '真の分母'],
    ['ソース分析', 'テストケース生成効率', '', coverage.source_analysis?.generation_efficiency?.toFixed(1) || '0.0', 'AI観点→ケース変換'],
    
    // 自動化分析  
    ['自動化分析', '自動化ルート数', coverage.automation_analysis?.automated_routes || 0, '', 'Playwright生成'],
    ['自動化分析', '高実行可能性ルート数', coverage.automation_analysis?.feasible_routes || 0, '', 'スコア≥0.7'],
    ['自動化分析', '低実行可能性ルート数', coverage.automation_analysis?.low_feasibility_routes || 0, '', 'スコア0.3-0.7'],
    ['自動化分析', '未自動化テストケース数', coverage.automation_analysis?.unautomated_test_cases || 0, '', '自動化不可'],
    ['自動化分析', '自動化率', '', coverage.automation_analysis?.automation_rate?.toFixed(1) || '0.0', '自動化/全ケース'],
    
    // 実行分析
    ['実行分析', '実行成功ルート数', coverage.execution_analysis?.successful_routes || 0, '', '自動実行成功'],
    ['実行分析', '実行失敗ルート数', coverage.execution_analysis?.failed_routes || 0, '', '自動実行失敗'],
    ['実行分析', '実行成功率', '', coverage.execution_analysis?.execution_success_rate?.toFixed(1) || '0.0', '成功/実行'],
    
    // 人間対応必要項目
    ['人間対応', '未自動化ケース', coverage.human_action_required?.unautomated_test_cases || 0, '', 'AI生成不可'],
    ['人間対応', '低実行可能性ルート', coverage.human_action_required?.low_feasibility_routes || 0, '', '要手動確認'],
    ['人間対応', '失敗ルート', coverage.human_action_required?.failed_automation_routes || 0, '', '要手動再実行'],
    ['人間対応', '人間対応総数', coverage.human_action_required?.total_human_action_needed || 0, '', '手動テスト推奨'],
    
    // 総合カバレッジ（ステップ単位）
    ['総合カバレッジ', '全ステップ数', coverage.overall_coverage?.total_steps || 0, '', '分母（実際の実行単位）'],
    ['総合カバレッジ', '成功ステップ数', coverage.overall_coverage?.successful_steps || 0, '', '分子（実際の成功数）'],
    ['総合カバレッジ', 'テストカバレッジ率', '', coverage.overall_coverage?.success_coverage?.toFixed(1) || '0.0', '成功ステップ/(実行済み+未自動化ステップ)'],
    ['総合カバレッジ', '残課題ステップ数', coverage.overall_coverage?.remaining_steps || 0, '', '失敗ステップ数'],
    ['総合カバレッジ', '残課題テスト数', coverage.overall_coverage?.remaining_test_cases || 0, '', '未自動化ケース'],
    ['総合カバレッジ', 'カバレッジギャップ', '', coverage.overall_coverage?.coverage_gap?.toFixed(1) || '0.0', '未カバー率'],
    ['総合カバレッジ', '品質スコア', '', coverage.overall_coverage?.quality_score?.toFixed(1) || '0.0', '総合品質']
  ];

  const csv = csvRows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
  fs.writeFileSync(outputPath, csv, 'utf8');
  
  console.log(`📊 テストカバレッジレポート生成完了: ${outputPath}`);
  console.log(`📊 カバレッジ率: ${coverage.overall_coverage?.success_coverage?.toFixed(1) || '0.0'}% (${coverage.overall_coverage?.successful_test_cases || 0}/${coverage.overall_coverage?.total_test_cases || 0}テストケース - QA観点)`);
  console.log(`📊 人間対応必要: ${coverage.human_action_required?.total_human_action_needed || 0}件`);
}

/**
 * カバレッジレポートをCSV形式で生成
 * @param {Object} coverage - カバレッジデータ
 * @param {Object} userStoryInfo - ユーザーストーリー情報
 * @returns {string} - CSV形式のカバレッジレポート
 */
function generateCoverageReport(coverage, userStoryInfo = null) {
  const userStory = userStoryInfo ? userStoryInfo.content : 'テストシナリオ実行';
  const userStoryId = userStoryInfo ? userStoryInfo.currentId : 1;
  const executionTime = coverage.timestamp;

  // CSVヘッダー
  const headers = [
    '実行日時',
    'ユーザーストーリーID',
    'ユーザーストーリー',
    '指標',
    '分類',
    '値',
    '単位',
    '詳細'
  ];

  const csvRows = [headers.join(',')];

  // エスケープ関数
  function escapeCSVField(str) {
    if (str == null) return '""';
    const stringValue = String(str);
    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    return stringValue;
  }

  // データ行を追加する関数
  function addCoverageRow(metric, category, value, unit, detail = '') {
    const row = [
      escapeCSVField(executionTime),
      escapeCSVField(userStoryId),
      escapeCSVField(userStory),
      escapeCSVField(metric),
      escapeCSVField(category),
      escapeCSVField(value),
      escapeCSVField(unit),
      escapeCSVField(detail)
    ];
    csvRows.push(row.join(','));
  }

  // 1. 総合カバレッジ
  const overall = coverage.overall_coverage;
  addCoverageRow('総合カバレッジ', '実行カバレッジ', overall.execution_coverage?.toFixed(1) || 0, '%', 
    `実行済み ${overall.executed_routes}/${overall.total_feasible_routes} ルート`);
  addCoverageRow('総合カバレッジ', '成功カバレッジ', overall.success_coverage?.toFixed(1) || 0, '%',
    `成功 ${overall.successful_routes}/${overall.total_feasible_routes} ルート`);
  addCoverageRow('総合カバレッジ', '未到達ルート', overall.unreached_routes || 0, '件',
    '実行可能だが未実行のルート数');
  addCoverageRow('総合カバレッジ', '品質スコア', overall.quality_score || 0, '点',
    '変換率・実行率・成功率の総合評価');

  // 2. ソース分析（テスト観点 → テストケース）
  const source = coverage.source_analysis;
  if (source.test_points !== undefined) {
    addCoverageRow('変換効率', 'テスト観点数', source.test_points, '件', '初期テスト観点');
    addCoverageRow('変換効率', 'テストケース数', source.generated_test_cases, '件', '生成されたテストケース');
    addCoverageRow('変換効率', '変換率', source.conversion_rate?.toFixed(1) || 0, '%', 
      'テスト観点からテストケースへの変換効率');
  }

  // 3. ルート分析（テストケース → 実行可能ルート）
  const route = coverage.route_analysis;
  if (route.generated_routes !== undefined) {
    addCoverageRow('実行可能性', 'ルート生成数', route.generated_routes, '件', '生成されたPlaywrightルート');
    addCoverageRow('実行可能性', '実行可能ルート', route.feasible_routes, '件', '実行可能性スコア0.7以上');
    addCoverageRow('実行可能性', '実行可能率', route.feasibility_rate?.toFixed(1) || 0, '%',
      '生成ルートの実行可能性');
  }

  // 4. 実行分析
  const execution = coverage.execution_analysis;
  if (execution.executed_routes !== undefined) {
    addCoverageRow('実行結果', '実行ルート数', execution.executed_routes, '件', '実際に実行されたルート');
    addCoverageRow('実行結果', '成功ルート数', execution.successful_routes, '件', '正常完了したルート');
    addCoverageRow('実行結果', 'ルート成功率', execution.route_success_rate?.toFixed(1) || 0, '%',
      '実行ルートの成功率');
    addCoverageRow('実行結果', '総ステップ数', execution.total_steps, '件', '実行されたテストステップ総数');
    addCoverageRow('実行結果', 'ステップ成功率', execution.step_success_rate?.toFixed(1) || 0, '%',
      '個別ステップの成功率');
  }

  // 5. 分類別詳細（実行分析）
  if (execution.category_breakdown) {
    Object.keys(execution.category_breakdown).forEach(category => {
      const categoryData = execution.category_breakdown[category];
      addCoverageRow('分類別実行', category, categoryData.success_rate?.toFixed(1) || 0, '%',
        `成功 ${categoryData.successful_routes}/${categoryData.executed_routes} ルート`);
    });
  }

  return csvRows.join('\n');
}

/**
 * バッチ実行結果専用のテストレポートを生成
 * @param {Object} batchData - バッチ実行結果データ
 * @param {Object} userStoryInfo - ユーザーストーリー情報
 * @returns {string} - CSVレポート
 */
async function generateBatchTestReport(batchData, userStoryInfo = null) {
  console.log('📊 バッチ実行結果専用レポートを生成中...');
  
  const executionTime = new Date().toISOString();
  
  // ユーザーストーリー情報の取得
  let userStory, userStoryId;
  if (userStoryInfo && userStoryInfo.currentId && userStoryInfo.content) {
    userStory = userStoryInfo.content.replace(/[\r\n]+/g, ' ').trim();
    userStoryId = userStoryInfo.currentId;
    console.log(`🔗 バッチレポート: ユーザーストーリーID ${userStoryId}`);
  } else {
    userStory = 'バッチ自動実行テスト';
    userStoryId = 1;
    console.log(`⚠️ バッチレポート: デフォルトユーザーストーリーID ${userStoryId}`);
  }

  // URL取得（最初のルートから）
  let testUrl = '';
  if (batchData.results && batchData.results.length > 0) {
    const firstResult = batchData.results[0];
    if (firstResult.step_results && Array.isArray(firstResult.step_results)) {
      const loadStep = firstResult.step_results.find(step => 
        step.action === 'load' || step.action === 'goto'
      );
      if (loadStep) {
        // ステップからURLを抽出（多くの場合targetフィールドに含まれる）
        testUrl = loadStep.target || loadStep.value || '';
      }
    }
  }

  /**
   * CSV用の文字列をエスケープ（バッチ版）
   */
  function escapeCSVField(str) {
    if (str == null) return '""';
    
    const stringValue = String(str);
    
    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n') || stringValue.includes('\r')) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    
    return stringValue;
  }

  // CSVヘッダー
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
    'バッチID',
    'カテゴリ',
    '成功率(%)',
    'ステップ数',
    'アサーション数'
  ];
  
  const csvRows = [headers.join(',')];
  
  let totalSteps = 0;
  let successfulSteps = 0;
  let totalAssertions = 0;
  let successfulAssertions = 0;

  // 各結果ごとにレポート行を生成
  batchData.results.forEach((result, resultIndex) => {
    const categoryLetter = String.fromCharCode(65 + Math.floor(resultIndex / 10)); // A, B, C...
    const routeNumber = (resultIndex % 10) + 1;
    
    // テスト手順の整形
    const testSteps = result.step_results ? result.step_results
      .filter(step => step.action !== 'waitForTimeout') // 待機ステップは除外
      .map(step => {
        if (step.action === 'load') {
          return 'ページアクセス';
        } else if (step.action === 'fill') {
          return `入力: ${step.label || 'フィールド'}`;
        } else if (step.action === 'click') {
          return `クリック: ${step.label || 'ボタン'}`;
        } else if (step.action === 'check') {
          return `チェック: ${step.label || 'チェックボックス'}`;
        } else if (step.action.startsWith('assert')) {
          return `確認: ${step.label || '結果検証'}`;
        } else {
          return `${step.action}: ${step.label || ''}`;
        }
      }).join(' → ') : 'テストルート実行';
    
    // ステップ統計の計算
    const stepCount = result.step_results ? result.step_results.length : 0;
    const successCount = result.step_results ? result.step_results.filter(step => step.status === 'success').length : 0;
    const assertionCount = result.assertion_results ? result.assertion_results.length : 0;
    const assertionSuccessCount = result.assertion_results ? result.assertion_results.filter(assertion => assertion.status === 'success').length : 0;
    
    totalSteps += stepCount;
    successfulSteps += successCount;
    totalAssertions += assertionCount;
    successfulAssertions += assertionSuccessCount;
    
    // 実行結果の判定
    let executionResult = result.status || 'unknown';
    let errorDetail = '';
    
    if (result.status === 'success') {
      executionResult = 'success';
    } else if (result.status === 'partial') {
      executionResult = 'partial_success';
      const failedSteps = result.step_results ? result.step_results.filter(step => step.status === 'failed') : [];
      if (failedSteps.length > 0) {
        errorDetail = `部分実行: ${failedSteps.length}件のステップが失敗`;
      }
    } else if (result.status === 'error') {
      executionResult = 'failed';
      errorDetail = result.error || 'テスト実行エラー';
    }
    
    // ID: {userStoryId}.{categoryLetter}.{routeNumber}
    const uniqueTestCaseId = `${userStoryId}.${categoryLetter}.${routeNumber}`;
    
    const row = [
      escapeCSVField(executionTime),
      escapeCSVField(uniqueTestCaseId),
      escapeCSVField(userStory),
      escapeCSVField(result.category || '未分類'),
      escapeCSVField(`${result.category || '未分類'}系テスト${routeNumber}`),
      escapeCSVField(testSteps),
      escapeCSVField(executionResult),
      escapeCSVField(errorDetail),
      escapeCSVField(testUrl),
      escapeCSVField('バッチ自動実行'),
      escapeCSVField(batchData.batch_id),
      escapeCSVField(result.category || '未分類'),
      escapeCSVField(result.success_rate ? result.success_rate.toString() : '0'),
      escapeCSVField(stepCount.toString()),
      escapeCSVField(assertionCount.toString())
    ];
    csvRows.push(row.join(','));
  });

  console.log(`📊 バッチレポート生成完了:`);
  console.log(`   - 総ルート数: ${batchData.results.length}件`);
  console.log(`   - 総ステップ数: ${totalSteps}件 (成功: ${successfulSteps}件)`);
  console.log(`   - 総アサーション数: ${totalAssertions}件 (成功: ${successfulAssertions}件)`);
  console.log(`   - 全体成功率: ${totalSteps > 0 ? ((successfulSteps / totalSteps) * 100).toFixed(1) : 0}%`);
  
  return csvRows.join('\n');
}

async function generateTestReport(testPointFormat, testPoints, route, result, userStoryInfo = null) {
  console.log('📊 テストレポートを生成中...');
  
  // 分類別バッチ処理結果の場合
  if (route && route.processing_mode === 'category_batch') {
    console.log('📂 分類別バッチ処理結果のレポートを生成します');
    return generateCategoryBatchReport(route, result, userStoryInfo);
  }
  
  // 単一分類またはレガシー処理結果の場合
  if (testPoints && Array.isArray(testPoints) && testPoints.length > 0) {
    console.log(`📋 ${testPoints.length}件の観点を使用してトレーサブルレポートを生成中...`);
    
    const reportData = createTraceableTestReport(testPoints, route, result, userStoryInfo);
    
    if (reportData.length > 0) {
      return generateTraceableCSVReport(reportData);
    } else {
      console.log('⚠️ 有効なレポートデータが生成されませんでした。フォールバックレポートを生成します。');
      return generateFallbackReport(route, result, userStoryInfo);
    }
  } else {
    console.log('⚠️ 有効なテスト観点データがありません。フォールバックレポートを生成します。');
    return generateFallbackReport(route, result, userStoryInfo);
  }
}

function generateFallbackReport(route, result, userStoryInfo = null) {
  console.log('🔄 フォールバックレポートを生成中...');
  
  const executionTime = new Date().toISOString();
  
  // URL取得の優先順位を改善（フォールバック版）
  let testUrl = route.url || result.url || '';
  
  // ルートのステップから最初のload URLを取得
  if (!testUrl && route.steps && Array.isArray(route.steps)) {
    const loadStep = route.steps.find(step => 
      step.action === 'load' || step.action === 'goto'
    );
    if (loadStep) {
      testUrl = loadStep.target || loadStep.value || '';
    }
  }
  
  // 結果のステップから最初のload URLを取得
  if (!testUrl && result.steps && Array.isArray(result.steps)) {
    const loadStep = result.steps.find(step => 
      step.action === 'load' || step.action === 'goto'
    );
    if (loadStep) {
      testUrl = loadStep.target || loadStep.value || '';
    }
  }
  
  console.log(`🔄 フォールバックテストURL: ${testUrl || '未設定'}`);
  
  // config.jsonからのユーザーストーリー情報を優先使用（フォールバックでも完全なトレーサビリティ）
  let userStory, userStoryId;
  if (userStoryInfo && userStoryInfo.currentId && userStoryInfo.content) {
    // スプレッドシート表示対応：改行文字を削除してスペースに置換
    userStory = userStoryInfo.content.replace(/[\r\n]+/g, ' ').trim();
    userStoryId = userStoryInfo.currentId;
    console.log(`🔗 フォールバック時もUIからのトレーサビリティ確保: ユーザーストーリーID ${userStoryId}`);
  } else {
    // フォールバック時も改行文字を削除
    userStory = (route.userStory || route.goal || 'テストシナリオ実行').replace(/[\r\n]+/g, ' ').trim();
    userStoryId = extractUserStoryId(userStory) || 1;
    console.log(`⚠️ フォールバック: 推定ユーザーストーリーID ${userStoryId}`);
  }
  
  /**
   * CSV用の文字列をエスケープ（フォールバック版）
   * @param {string} str - エスケープする文字列
   * @returns {string} - エスケープされた文字列
   */
  function escapeCSVField(str) {
    if (str == null) return '""';
    
    const stringValue = String(str);
    
    // 改行文字、カンマ、ダブルクォートが含まれている場合はエスケープが必要
    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n') || stringValue.includes('\r')) {
      // ダブルクォートを2つのダブルクォートに置換してからクォートで囲む
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    
    return stringValue;
  }

  // 修正ルートかどうかを判定
  const isFixedRoute = result?.is_fixed_route || false;
  const executionType = isFixedRoute ? '再実行' : '初回実行';
  const resultHeader = isFixedRoute ? '再）実行結果' : '実行結果';
  
  const headers = ['実行日時', 'ID', 'ユーザーストーリー', '機能', '観点', 'テスト手順', resultHeader, 'エラー詳細', 'URL', '実行種別',
    // 🚀 フェーズ3: 包括的テスト対応フィールド
    'テスト複雑度',
    'テストフェーズ',
    '要素タイプ',
    '要素名',
    'バリデーション数',
    'トレーサビリティレベル'
  ];
  const csvRows = [headers.join(',')];
  
  if (result.steps && Array.isArray(result.steps)) {
    result.steps.forEach((step, index) => {
      // フォールバック用一意ID: {ユーザーストーリーID}.F.{観点ID}-{テストケースID}
      const viewpointId = Math.floor(index / 3) + 1;
      const testCaseId = (index % 3) + 1;
      const uniqueTestCaseId = `${userStoryId}.F.${viewpointId}-${testCaseId}`;
      
      const row = [
        escapeCSVField(executionTime),
        escapeCSVField(uniqueTestCaseId),
        escapeCSVField(userStory),
        escapeCSVField('汎用機能'),
        escapeCSVField(step.label || `ステップ${viewpointId}`),
        escapeCSVField(formatTestSteps(step)),
        escapeCSVField(step.status === 'success' ? 'success' : 'failed'),
        escapeCSVField(step.error || ''),
        escapeCSVField(testUrl || ''),
        escapeCSVField(executionType),
        // 🚀 フェーズ3: 包括的テスト対応フィールド
        escapeCSVField(''),
        escapeCSVField(''),
        escapeCSVField(''),
        escapeCSVField(''),
        escapeCSVField(''),
        escapeCSVField('')
      ];
      csvRows.push(row.join(','));
    });
  } else {
    // 最低限のデータを生成
    const uniqueTestCaseId = `${userStoryId}.F.1-1`;
    
    const row = [
      escapeCSVField(executionTime),
      escapeCSVField(uniqueTestCaseId),
      escapeCSVField(userStory),
      escapeCSVField('汎用機能'),
      escapeCSVField('テスト実行'),
      escapeCSVField('テストシナリオの実行'),
      escapeCSVField('completed'),
      escapeCSVField(''),
      escapeCSVField(testUrl || ''),
      escapeCSVField(executionType),
      // 🚀 フェーズ3: 包括的テスト対応フィールド
      escapeCSVField(''),
      escapeCSVField(''),
      escapeCSVField(''),
      escapeCSVField(''),
      escapeCSVField(''),
      escapeCSVField('')
    ];
    csvRows.push(row.join(','));
  }
  
  return csvRows.join('\n');
}

async function main() {
  // コマンドライン引数を解析
  const args = process.argv.slice(2).reduce((acc, arg, index, array) => {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      if (value) {
        acc[key] = value;
      } else {
        // 次の引数が値の場合
        const nextArg = array[index + 1];
        if (nextArg && !nextArg.startsWith('--')) {
          acc[key] = nextArg;
        } else {
          acc[key] = true;
        }
      }
    }
    return acc;
  }, {});

  // サンプルデータでのテスト機能
  const testResultsDirForSample = path.join(__dirname, '..', 'test-results');
  const sampleDataPath = path.join(testResultsDirForSample, 'sample_test_data.json');
  
  if (args.goal && typeof args.goal === 'string' && args.goal.includes('テスト') && fs.existsSync(sampleDataPath)) {
    console.log('🧪 サンプルデータでHTMLレポート機能をテスト中...');
    const sampleData = JSON.parse(fs.readFileSync(sampleDataPath, 'utf8'));
    
    const coverage = await calculateTestCoverage(
      null, // testPointsData
      sampleData.testCases,
      sampleData.routes,
      sampleData.results
    );
    
    // サンプル用HTMLレポート生成
    const now = new Date();
    const timestamp = now.toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '');
    const sampleHtmlPath = path.join(testResultsDirForSample, `TestCoverage_Sample_${timestamp}.html`);
    generateCoverageHTML(coverage, sampleHtmlPath);
    
    console.log(`✅ サンプルHTMLレポート生成完了: ${path.basename(sampleHtmlPath)}`);
    console.log(`📊 テストケース詳細: 成功${coverage.detailed_test_cases?.filter(tc => tc.status === 'success').length || 0}件, 失敗${coverage.detailed_test_cases?.filter(tc => tc.status === 'failed').length || 0}件, 未自動化${coverage.detailed_test_cases?.filter(tc => tc.status === 'not_automated').length || 0}件`);
    return;
  }

  // config.jsonからユーザーストーリー情報を読み取り（完全なトレーサビリティ確保）
  let userStoryInfo = null;
  try {
    const configPath = path.join(__dirname, '..', 'config.json');
    const config = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));
    userStoryInfo = config.userStory;
    
    if (userStoryInfo && userStoryInfo.currentId) {
      console.log(`📝 ユーザーストーリーID ${userStoryInfo.currentId} を使用してトレーサブルレポートを生成します`);
      console.log(`📋 内容: ${userStoryInfo.content.substring(0, 80)}...`);
    }
  } catch (error) {
    console.log('⚠️ config.jsonからユーザーストーリー情報を読み取れませんでした:', error.message);
  }

  // 最新のファイルを取得
  const testResultsDir = path.join(__dirname, '..', 'test-results');
  const files = await fs.promises.readdir(testResultsDir);
  
  const resultFiles = files.filter(f => f.startsWith('result_')).sort().reverse();
  const routeFiles = files.filter(f => f.startsWith('route_')).sort().reverse();
  
  // 🆕 バッチ実行結果ファイルも検索対象に追加
  const batchResultFiles = files.filter(f => f.startsWith('batch_result_')).sort().reverse();
  
  // 新しいワークフロー対応：自然言語テストケースを優先的に読み込み
  // 最新のテスト結果に対応する最新のテストケースファイルを使用
  const naturalLanguageFiles = files.filter(f => f.startsWith('naturalLanguageTestCases_')).sort().reverse();
  const testPointFiles = files.filter(f => f.startsWith('testPoints_')).sort().reverse();
  
  console.log(`📊 利用可能なファイル: 結果${resultFiles.length}件, バッチ結果${batchResultFiles.length}件, ルート${routeFiles.length}件, 自然言語${naturalLanguageFiles.length}件, テスト観点${testPointFiles.length}件`);

  // 🆕 優先順位: バッチ結果 > 個別結果
  let hasBatchResults = batchResultFiles.length > 0;
  let hasIndividualResults = resultFiles.length > 0 && routeFiles.length > 0;
  
  if (!hasBatchResults && !hasIndividualResults) {
    console.error('❌ 必要なファイル（結果、ルート）が見つかりません。');
    return;
  }

  // 🆕 バッチ結果ファイルがある場合は優先処理
  if (hasBatchResults) {
    console.log('🚀 バッチ実行結果を検出: バッチ結果専用レポートを生成します');
    
    try {
      const latestBatchFile = batchResultFiles[0];
      const batchResultPath = path.join(testResultsDir, latestBatchFile);
      const batchData = JSON.parse(await fs.promises.readFile(batchResultPath, 'utf-8'));
      
      console.log(`📊 バッチ結果ファイル: ${latestBatchFile}`);
      console.log(`📊 バッチID: ${batchData.batch_id}`);
      console.log(`📊 実行ルート数: ${batchData.total_routes}件`);
      console.log(`📊 成功率: 成功${batchData.successful_routes}件, 部分成功${batchData.partial_routes}件, 失敗${batchData.failed_routes}件`);

      // バッチ結果専用レポート生成
      const batchReport = await generateBatchTestReport(batchData, userStoryInfo);
      
      if (batchReport) {
        const now = new Date();
        const timestamp = now.toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '');
        const fileName = `AutoPlaywright バッチテスト結果 - ${batchData.batch_id}_${timestamp}.csv`;
        const outputPath = path.join(testResultsDir, fileName);
        
        await fs.promises.writeFile(outputPath, batchReport);
        console.log(`✅ バッチテストレポートを生成しました: ${fileName}`);
        console.log(`📁 保存先: ${outputPath}`);
        
        // レポート内容のサマリーを表示
        const lines = batchReport.split('\n');
        const testCaseCount = lines.length - 1; // ヘッダーを除く
        if (testCaseCount > 0) {
          console.log(`📋 生成されたテストケース数: ${testCaseCount}件`);
        }
        
        // カバレッジ情報表示
        console.log(`📊 カテゴリ別結果:`);
        Object.entries(batchData.category_summary).forEach(([category, summary]) => {
          console.log(`   - ${category}: ${summary.successful}/${summary.total} (平均成功率: ${summary.average_success_rate}%)`);
        });
      } else {
        console.error('❌ バッチテストレポートの生成に失敗しました');
      }
      
      // バッチ結果でレポート生成完了
      return;
      
    } catch (error) {
      console.error(`❌ バッチ結果処理中にエラーが発生: ${error.message}`);
      console.log('⚠️ 個別結果ファイルでのレポート生成にフォールバックします');
      // 個別結果処理に続行
    }
  }

  // 🔧 個別結果ファイル処理（フォールバック）
  if (!hasIndividualResults) {
    console.error('❌ 個別結果ファイル（result_*, route_*）も見つかりません。');
    return;
  }

  console.log('📊 個別結果ファイルを使用してレポートを生成します');

  // テストサイクルリセット情報を確認
  const configPath = path.join(__dirname, '..', 'config.json');
  let testCycleResetTime = null;
  
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.userStory?.resetAt && config.userStory?.testCycleReset) {
        testCycleResetTime = new Date(config.userStory.resetAt);
        console.log(`🔄 テストサイクルリセット検出: ${testCycleResetTime.toLocaleString('ja-JP')}`);
      }
    } catch (error) {
      console.log('⚠️ config.json読み込みエラー（無視して続行）:', error.message);
    }
  }

  // 複数のテスト結果を統合して読み込み（リセット後のファイルのみ対象）
  console.log(`📊 複数テスト結果統合モード: ${resultFiles.length}件の結果ファイルを統合`);
  let allResults = [];
  let allRoutes = [];
  
  // リセット後のファイルのみを対象とする
  const filterFilesByResetTime = (files, prefix) => {
    if (!testCycleResetTime) return files;
    
    return files.filter(file => {
      const filePath = path.join(testResultsDir, file);
      try {
        const stat = fs.statSync(filePath);
        return stat.mtime > testCycleResetTime;
      } catch (error) {
        return false;
      }
    });
  };
  
  const validResultFiles = filterFilesByResetTime(resultFiles, 'result_');
  const validRouteFiles = filterFilesByResetTime(routeFiles, 'route_');
  
  if (testCycleResetTime) {
    console.log(`📊 リセット後のファイル: 結果${validResultFiles.length}件, ルート${validRouteFiles.length}件`);
  }
  
  // 最新の5件のテスト結果を読み込み（パフォーマンス考慮）
  const maxResults = Math.min(validResultFiles.length, 5);
  const maxRoutes = Math.min(validRouteFiles.length, 5);
  
  for (let i = 0; i < maxResults; i++) {
    try {
      const result = await readJsonFile(path.join(testResultsDir, validResultFiles[i]));
      if (result) {
        allResults.push({
          ...result,
          filename: validResultFiles[i],
          index: i
        });
      }
    } catch (error) {
      console.log(`⚠️ 結果ファイル読み込みエラー (${validResultFiles[i]}): ${error.message}`);
    }
  }
  
  for (let i = 0; i < maxRoutes; i++) {
    try {
      const route = await readJsonFile(path.join(testResultsDir, validRouteFiles[i]));
      if (route) {
        allRoutes.push({
          ...route,
          filename: validRouteFiles[i],
          index: i
        });
      }
    } catch (error) {
      console.log(`⚠️ ルートファイル読み込みエラー (${validRouteFiles[i]}): ${error.message}`);
    }
  }
  
  console.log(`✅ 統合完了: 結果${allResults.length}件, ルート${allRoutes.length}件`);
  
  // 後方互換性のため、最新の単一結果も保持
  const latestResult = allResults[0] || null;
  const latestRoute = allRoutes[0] || null;
  
  // テスト観点データを優先順位で読み込み
  let testPoints = null;
  let testPointSource = '';
  
  // 1. 自然言語テストケースファイルを優先（最新のテスト結果に関連するファイルを選択）
  let selectedNaturalLanguageFile = naturalLanguageFiles[0];
  
  // 最新の結果ファイルのタイムスタンプに最も近いテストケースファイルを選択
  if (naturalLanguageFiles.length > 1 && allResults.length > 0) {
    const latestResultTime = new Date(allResults[0].timestamp || 0).getTime();
    let bestMatch = naturalLanguageFiles[0];
    let smallestTimeDiff = Infinity;
    
    naturalLanguageFiles.forEach(file => {
      const match = file.match(/(\d{4}-\d{2}-\d{2}T\d{4})/);
      if (match) {
        const fileTime = new Date(match[1].replace('T', ' ').replace(/(\d{2})(\d{2})$/, ':$1:$2')).getTime();
        const timeDiff = Math.abs(latestResultTime - fileTime);
        if (timeDiff < smallestTimeDiff) {
          smallestTimeDiff = timeDiff;
          bestMatch = file;
        }
      }
    });
    selectedNaturalLanguageFile = bestMatch;
  }
  
  if (naturalLanguageFiles.length > 0) {
    console.log(`📊 自然言語テストケースファイルを使用: ${selectedNaturalLanguageFile}`);
    const naturalLanguageData = await readJsonFile(path.join(testResultsDir, selectedNaturalLanguageFile));
    if (naturalLanguageData && naturalLanguageData.testCases) {
      testPoints = naturalLanguageData.testCases.map(testCase => ({
        No: testCase.id || 'N/A',
        description: testCase.original_viewpoint || 'テスト観点',
        viewpoint: testCase.original_viewpoint,
        content: testCase.original_viewpoint,
        category: testCase.category || 'general',
        priority: testCase.priority || 'medium',
        test_scenarios: testCase.test_scenarios || [],
        metadata: testCase.metadata || {}
      }));
      testPointSource = 'naturalLanguageTestCases';
      console.log(`✅ 自然言語テストケースから${testPoints.length}件の観点を読み込みました`);
    }
  }
  
  // 2. フォールバック：従来のテスト観点ファイル
  if (!testPoints && testPointFiles.length > 0) {
    console.log(`📊 フォールバック：テスト観点ファイルを使用: ${testPointFiles[0]}`);
    testPoints = await readJsonFile(path.join(testResultsDir, testPointFiles[0]));
    testPointSource = 'testPoints';
    if (testPoints && Array.isArray(testPoints)) {
      console.log(`✅ テスト観点ファイルから${testPoints.length}件の観点を読み込みました`);
    }
  }
  
  // テストポイント形式ファイル（CSV）の読み込み
  const testPointFormat = await readCsvFile(path.join(__dirname, '..', 'test_point', 'TestPoint_Format.csv'));

  if (!latestResult || !latestRoute) {
    console.error('❌ 必須ファイル（結果、ルート）の読み込みに失敗しました。');
    return;
  }
  
  if (!testPoints) {
    console.log('⚠️ テスト観点データが見つかりません。フォールバックレポートを生成します。');
  } else {
    console.log(`📊 テスト観点ソース: ${testPointSource} (${Array.isArray(testPoints) ? testPoints.length : 0}件)`);
  }

  const report = await generateTestReport(testPointFormat, testPoints, latestRoute, latestResult, userStoryInfo);
  
  // テストカバレッジレポートを生成
  try {
    console.log('📊 テストカバレッジを算出中...');
    
    // テストケースデータを取得
    let testCasesData = null;
    if (naturalLanguageFiles.length > 0) {
      // 分類別ファイルがある場合は統合データを作成
      const indexFile = files.find(f => f.includes('index.json'));
      if (indexFile) {
        const indexData = await readJsonFile(path.join(testResultsDir, indexFile));
        if (indexData && indexData.categories) {
          testCasesData = { categories: {} };
          for (const [category, filePath] of Object.entries(indexData.categories)) {
            try {
              // filePathの形式に応じて適切にファイル名を抽出
              let fileName = '';
              if (typeof filePath === 'string') {
                fileName = path.basename(filePath);
              } else if (typeof filePath === 'object' && filePath.file) {
                fileName = filePath.file;
              } else if (typeof filePath === 'object' && filePath.path) {
                fileName = path.basename(filePath.path);
              } else {
                console.log(`⚠️ 予期しないfilePath形式 (${category}):`, filePath);
                continue;
              }
              
              const categoryData = await readJsonFile(path.join(testResultsDir, fileName));
              if (categoryData && categoryData.testCases) {
                testCasesData.categories[category] = categoryData.testCases;
                console.log(`✅ 分類「${category}」: ${categoryData.testCases.length}件のテストケースを読み込み`);
              }
            } catch (error) {
              console.log(`⚠️ 分類ファイル読み込みエラー (${category}): ${error.message}`);
            }
          }
        }
      } else {
        // 単一自然言語ファイルの場合
        testCasesData = await readJsonFile(path.join(testResultsDir, naturalLanguageFiles[0]));
      }
    }
    
    // カバレッジを算出（複数結果統合版）
    const coverage = await calculateTestCoverage(testPoints, testCasesData, allRoutes, allResults);
    
    // カバレッジCSVファイルを生成
    const now = new Date();
    const timestamp = now.toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '');
    const coverageCsvPath = path.join(testResultsDir, `TestCoverage_${timestamp}.csv`);
    
    generateCoverageCSV(coverage, coverageCsvPath);
    
    // カバレッジデータをJSONでも保存（詳細分析用）
    const coverageJsonPath = path.join(testResultsDir, `TestCoverage_${timestamp}.json`);
    await fs.promises.writeFile(coverageJsonPath, JSON.stringify(coverage, null, 2), 'utf-8');
    console.log(`📊 詳細カバレッジデータ保存: ${path.basename(coverageJsonPath)}`);
    
    // HTMLレポートを生成（メインレポート形式）
    const coverageHtmlPath = path.join(testResultsDir, `TestCoverage_${timestamp}.html`);
    generateCoverageHTML(coverage, coverageHtmlPath);
    
    console.log(`\n🎉 テストカバレッジレポート生成完了！`);
    console.log(`📊 HTMLレポート: ${path.basename(coverageHtmlPath)}`);
    console.log(`📈 カバレッジ率: ${coverage.overall_coverage?.success_coverage?.toFixed(1) || '0.0'}%`);
    console.log(`👥 人間対応必要: ${coverage.human_action_required?.total_human_action_needed || 0}件`);
  } catch (error) {
    console.log(`⚠️ カバレッジレポート生成中にエラーが発生しました: ${error.message}`);
  }
  
  if (report) {
    // 修正ルート実行かどうかで処理を分岐
    const isFixedRoute = latestResult?.is_fixed_route || false;
    let outputPath, fileName;
    
    if (isFixedRoute) {
      // 修正ルート実行時：既存のCSVファイルに追記
      console.log('🔧 修正ルート実行結果を既存CSVファイルに追記します...');
      
      // 元のルートIDから対応するCSVファイルを探す
      const originalRouteId = latestResult.original_route_id || latestRoute.route_id;
      const existingCsvFiles = files.filter(f => f.startsWith('AutoPlaywright テスト結果') && f.endsWith('.csv')).sort().reverse();
      
      let targetCsvFile = null;
      
      // 最新のCSVファイルを使用（同じユーザーストーリーの場合）
      if (existingCsvFiles.length > 0) {
        targetCsvFile = existingCsvFiles[0];
        console.log(`📝 既存CSVファイルを使用: ${targetCsvFile}`);
      }
      
      if (targetCsvFile) {
        outputPath = path.join(testResultsDir, targetCsvFile);
        fileName = targetCsvFile;
        
        // 既存のCSVファイルを読み込み
        let existingContent = '';
        try {
          existingContent = await fs.promises.readFile(outputPath, 'utf-8');
        } catch (error) {
          console.log('⚠️ 既存CSVファイルの読み込みに失敗。新規作成します。');
        }
        
        if (existingContent) {
          // 既存CSVをパースして重複除去処理
          const existingLines = existingContent.split('\n').filter(line => line.trim());
          const headerLine = existingLines[0];
          const existingDataLines = existingLines.slice(1);
          
          // 新しいレポートからヘッダーを除いてデータ行のみ取得
          const reportLines = report.split('\n').filter(line => line.trim());
          const newDataLines = reportLines.slice(1);
          
          // CSVデータを解析して重複除去
          const allDataLines = [...existingDataLines, ...newDataLines];
          const testCaseMap = new Map();
          
          // 各行をパースしてIDで重複除去
          allDataLines.forEach(line => {
            if (!line.trim()) return;
            
            // CSV行をパース（簡易版）
            const columns = line.split(',');
            if (columns.length >= 2) {
              let testCaseId = columns[1]; // ID列
              // ダブルクォートを除去
              testCaseId = testCaseId.replace(/^"|"$/g, '');
              
              const timestamp = columns[0]?.replace(/^"|"$/g, '') || '';
              const currentTime = new Date(timestamp).getTime();
              
              // 同じIDの場合、より新しいタイムスタンプを保持
              if (!testCaseMap.has(testCaseId) || 
                  (testCaseMap.get(testCaseId).timestamp < currentTime)) {
                testCaseMap.set(testCaseId, {
                  line: line,
                  timestamp: currentTime
                });
              }
            }
          });
          
          // 重複除去されたデータでCSVを再構築
          const deduplicatedLines = Array.from(testCaseMap.values()).map(entry => entry.line);
          const finalContent = [headerLine, ...deduplicatedLines].join('\n');
          
          // ファイルを上書き保存
          await fs.promises.writeFile(outputPath, finalContent);
          
          const removedCount = allDataLines.length - deduplicatedLines.length;
          console.log(`✅ 修正ルート結果を統合し重複除去完了: ${fileName}`);
          console.log(`📊 統合前: ${allDataLines.length}件 → 統合後: ${deduplicatedLines.length}件（重複${removedCount}件除去）`);
        } else {
          // ファイルが存在しない場合は新規作成
          await fs.promises.writeFile(outputPath, report);
          console.log(`📊 新規CSVファイルを作成: ${fileName}`);
        }
      } else {
        // 対応するCSVファイルが見つからない場合は新規作成
        const now = new Date();
        const timestamp = now.toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '');
        fileName = `AutoPlaywright テスト結果 - TestResults_${timestamp}_修正.csv`;
        outputPath = path.join(testResultsDir, fileName);
        
        await fs.promises.writeFile(outputPath, report);
        console.log(`📊 修正ルート用新規CSVファイルを作成: ${fileName}`);
      }
    } else {
      // 初回実行時：新規CSVファイル作成
      const now = new Date();
      const timestamp = now.toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '');
      fileName = `AutoPlaywright テスト結果 - TestResults_${timestamp}.csv`;
      outputPath = path.join(testResultsDir, fileName);
      
      await fs.promises.writeFile(outputPath, report);
      console.log(`📊 トレーサブルテストレポートを生成しました: ${fileName}`);
    }
    
    console.log(`📁 保存先: ${outputPath}`);
    
    // レポート内容のサマリーを表示
    const lines = report.split('\n');
    const testCaseCount = lines.length - 1; // ヘッダーを除く
    if (testCaseCount > 0) {
      console.log(`📋 ${isFixedRoute ? '追記された' : '生成された'}テストケース数: ${testCaseCount}件`);
    }
  } else {
    console.error('❌ テストレポートの生成に失敗しました');
  }
}

main().catch(console.error); 

/**
 * 失敗原因を分類する
 */
function categorizeFailureType(step) {
  const error = (step.error || '').toLowerCase();
  const action = (step.action || '').toLowerCase();
  
  // タイムアウトエラー
  if (error.includes('timeout')) {
    return 'timeout_error';
  }
  
  // 要素関連の問題
  if (error.includes('element is not an') || error.includes('not found') || 
      error.includes('not visible') || error.includes('not attached')) {
    return 'element_issue';
  }
  
  // ナビゲーション問題
  if (error.includes('waitforurl') || action.includes('waitforurl') ||
      error.includes('navigation') || error.includes('page')) {
    return 'navigation_issue';
  }
  
  // アサーション失敗
  if (action.includes('assert') || action.includes('visible') ||
      error.includes('assertion') || error.includes('expected')) {
    return 'assertion_failure';
  }
  
  // スクリプトエラー
  if (error.includes('evaluate') || error.includes('script') ||
      error.includes('referenceerror') || error.includes('syntaxerror')) {
    return 'script_error';
  }
  
  return 'unknown_error';
}

/**
 * 失敗タイプの表示名とアイコンを取得
 */
function getFailureTypeInfo(failureType) {
  const typeMap = {
    'timeout_error': { name: 'タイムアウト エラー', icon: '⏰', color: '#ff6b35' },
    'element_issue': { name: '要素 問題', icon: '🎯', color: '#e74c3c' },
    'navigation_issue': { name: 'ナビゲーション 問題', icon: '🧭', color: '#3498db' },
    'assertion_failure': { name: 'アサーション 失敗', icon: '❌', color: '#9b59b6' },
    'script_error': { name: 'スクリプト エラー', icon: '📜', color: '#f39c12' },
    'unknown_error': { name: 'その他のエラー', icon: '❓', color: '#95a5a6' }
  };
  
  return typeMap[failureType] || typeMap['unknown_error'];
}

/**
 * 失敗原因ごとにグループ化
 */
function groupFailuresByType(failedSteps) {
  const groups = {};
  
  failedSteps.forEach(step => {
    const type = categorizeFailureType(step);
    if (!groups[type]) {
      groups[type] = [];
    }
    groups[type].push(step);
  });
  
  return groups;
}

/**
 * HTMLレポートを生成する（Google Sheets代替）
 * @param {Object} coverage - カバレッジデータ
 * @param {string} outputPath - 出力パス
 */
function generateCoverageHTML(coverage, outputPath) {
  // 失敗ステップの詳細を取得
  const failedStepsDetails = coverage.failed_steps_details || [];
  
  // HTMLエスケープ関数
  function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
  
  let failedStepsSection = '';
  
  if (failedStepsDetails.length > 0) {
    console.log('🔍 失敗原因ごとのトグルグループ生成開始');
    
    // 失敗原因ごとにグループ化
    const failureGroups = groupFailuresByType(failedStepsDetails);
    console.log('🔍 失敗グループ:', Object.keys(failureGroups));
    
    // 失敗原因ごとのHTML生成
    const groupsHTML = Object.entries(failureGroups).map(([failureType, steps], groupIndex) => {
      const typeInfo = getFailureTypeInfo(failureType);
      console.log(`🔍 グループ ${groupIndex} (${failureType}): ${steps.length}件`);
      
      const stepsHTML = steps.map((step, index) => `
        <div class="failed-step-card">
          <div class="failed-step-header">
            <span class="step-number">#${index + 1}</span>
            <span class="step-label">${escapeHtml(step.label)}</span>
            <span class="step-status failed">❌ 失敗</span>
          </div>
          <div class="failed-step-content">
            <div class="step-details">
              <p><strong>アクション:</strong> ${escapeHtml(step.action)}</p>
              <p><strong>ターゲット:</strong> <code>${escapeHtml(step.target)}</code></p>
              ${step.value ? `<p><strong>値:</strong> ${escapeHtml(step.value)}</p>` : ''}
            </div>
            <div class="error-details">
              <h4>エラー詳細</h4>
              <div class="error-message">${escapeHtml(step.error)}</div>
              ${step.error_category ? `<p class="error-category"><strong>エラー分類:</strong> ${escapeHtml(step.error_category)}</p>` : ''}
            </div>
            <div class="debug-resources">
              <h4>🔍 デバッグリソース</h4>
              <div class="debug-buttons">
                <div class="debug-group">
                  <button class="debug-btn screenshot-btn" onclick="openScreenshot('${escapeHtml(step.route_id || step.timestamp)}', '${index + 1}')">
                    📸 スクリーンショット表示
                  </button>
                  <button class="debug-btn download-btn" onclick="downloadScreenshot('${escapeHtml(step.route_id || step.timestamp)}', '${index + 1}')">
                    ⬇️ DL
                  </button>
                </div>
                <div class="debug-group">
                  <button class="debug-btn dom-btn" onclick="openDomSnapshot('${escapeHtml(step.route_id || step.timestamp)}', '${index + 1}')">
                    🏗️ DOM状態表示
                  </button>
                  <button class="debug-btn download-btn" onclick="downloadDomSnapshot('${escapeHtml(step.route_id || step.timestamp)}', '${index + 1}')">
                    ⬇️ DL
                  </button>
                </div>
                <div class="debug-group">
                  <button class="debug-btn logs-btn" onclick="showExecutionLogs('${escapeHtml(step.route_id || step.timestamp)}')">
                    📋 実行ログ表示
                  </button>
                  <button class="debug-btn download-btn" onclick="downloadExecutionLogs('${escapeHtml(step.route_id || step.timestamp)}', '${index + 1}')">
                    ⬇️ DL
                  </button>
                </div>
                ${step.error && step.error.includes('not found') ? `
                <div class="debug-group">
                  <button class="debug-btn element-btn" onclick="analyzeElementIssue('${escapeHtml(step.target)}', '${escapeHtml(step.action)}')">
                    🔍 要素分析
                  </button>
                  <button class="debug-btn download-btn" onclick="downloadElementAnalysis('${escapeHtml(step.target)}', '${escapeHtml(step.action)}', '${escapeHtml(step.route_id || step.timestamp)}', '${index + 1}')">
                    ⬇️ DL
                  </button>
                </div>
                ` : ''}
              </div>
            </div>
            
            ${step.fix_suggestions && step.fix_suggestions.length > 0 ? `
            <div class="fix-suggestions">
              <h4>修正提案</h4>
              <ul class="suggestions-list">
                ${step.fix_suggestions.map(suggestion => `
                <li class="suggestion-item">
                  <span class="confidence-badge">${(suggestion.confidence * 100).toFixed(0)}%</span>
                  ${escapeHtml(suggestion.message)}
                  ${suggestion.new_target ? `<br><code>新しいターゲット: ${escapeHtml(suggestion.new_target)}</code>` : ''}
                </li>
                `).join('')}
              </ul>
            </div>
            ` : ''}
            ${step.skip_reason ? `
            <div class="skip-reason">
              <p><strong>スキップ理由:</strong> ${escapeHtml(step.skip_reason)}</p>
            </div>
            ` : ''}
          </div>
        </div>
      `).join('');
      
      // 失敗タイプグループのHTML
      return `
        <div class="failure-group" id="group-${failureType}">
          <div class="group-header" onclick="toggleGroup('${failureType}')">
            <span class="group-icon" style="color: ${typeInfo.color};">${typeInfo.icon}</span>
            <span class="group-title">${typeInfo.name} (${steps.length}件)</span>
            <span class="group-toggle collapsed" id="toggle-${failureType}">▶</span>
          </div>
          <div class="group-content collapsed" id="content-${failureType}">
            ${stepsHTML}
          </div>
        </div>`;
    }).join('');
    
    failedStepsSection = `
      <div class="section">
        <h2>❌ 失敗ステップ詳細</h2>
        <p style="color: #666; margin-bottom: 20px;">
          失敗原因ごとにグループ化されています。グループをクリックして開閉できます。
        </p>
        <div class="failure-groups-container">
          ${groupsHTML}
        </div>
      </div>`;
  }

  const html = `
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AutoPlaywright テストカバレッジレポート</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }
        .header h1 {
            margin: 0;
            font-size: 2.5em;
            font-weight: 300;
        }
        .header p {
            margin: 10px 0 0 0;
            opacity: 0.9;
            font-size: 1.1em;
        }
        .summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            padding: 30px;
            background: #f8f9fa;
        }
        .summary-card {
            background: white;
            padding: 20px;
            border-radius: 8px;
            text-align: center;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .summary-card h3 {
            margin: 0 0 10px 0;
            color: #333;
            font-size: 0.9em;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        .summary-card .value {
            font-size: 2em;
            font-weight: bold;
            margin-bottom: 5px;
        }
        .summary-card .unit {
            color: #666;
            font-size: 0.9em;
        }
        .coverage-rate { color: #28a745; }
        .human-action { color: #dc3545; }
        .automation { color: #007bff; }
        .quality { color: #6f42c1; }
        
        .section {
            padding: 30px;
            border-bottom: 1px solid #eee;
        }
        .section:last-child {
            border-bottom: none;
        }
        .section h2 {
            margin: 0 0 20px 0;
            color: #333;
            font-size: 1.5em;
            font-weight: 500;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
        }
        th, td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }
        th {
            background-color: #f8f9fa;
            font-weight: 600;
            color: #495057;
        }
        tr:hover {
            background-color: #f8f9fa;
        }
        .progress-bar {
            width: 100%;
            height: 20px;
            background-color: #e9ecef;
            border-radius: 10px;
            overflow: hidden;
            margin: 10px 0;
        }
        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #28a745 0%, #20c997 100%);
            transition: width 0.3s ease;
        }
        .footer {
            text-align: center;
            padding: 20px;
            color: #666;
            font-size: 0.9em;
            background: #f8f9fa;
        }
        
        /* 失敗グループ用スタイル */
        .failure-groups-container {
            display: flex;
            flex-direction: column;
            gap: 20px;
        }
        
        .failure-group {
            border: 1px solid #dee2e6;
            border-radius: 8px;
            background: white;
            overflow: hidden;
        }
        
        .group-header {
            display: flex;
            align-items: center;
            padding: 15px 20px;
            background: #f8f9fa;
            border-bottom: 1px solid #dee2e6;
            cursor: pointer;
            transition: background-color 0.2s;
        }
        
        .group-header:hover {
            background: #e9ecef;
        }
        
        .group-icon {
            margin-right: 12px;
            font-size: 1.5em;
        }
        
        .group-title {
            flex: 1;
            font-weight: 600;
            color: #333;
            font-size: 1.1em;
        }
        
        .group-toggle {
            transition: transform 0.3s ease;
            font-size: 1.2em;
            color: #6c757d;
        }
        
        .group-toggle.collapsed {
            transform: rotate(-90deg);
        }
        
        .group-content {
            overflow: hidden;
            transition: max-height 0.3s ease;
            padding: 0;
        }
        
        .group-content:not(.collapsed) {
            max-height: none;
        }
        
        .group-content.collapsed {
            max-height: 0;
        }
        
        /* 失敗ステップ詳細用スタイル */
        .failed-steps-container {
            display: grid;
            gap: 20px;
        }
        .failed-step-card {
            margin: 15px 20px;
            border: 1px solid #dee2e6;
            border-radius: 8px;
            background: white;
            border-left: 4px solid #dc3545;
            overflow: hidden;
        }
        .failed-step-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px 20px;
            background: #f8f9fa;
            border-bottom: 1px solid #dee2e6;
        }
        .step-number {
            background: #dc3545;
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.9em;
            font-weight: bold;
        }
        .step-label {
            flex: 1;
            margin: 0 15px;
            font-weight: 600;
            color: #333;
        }
        .step-status.failed {
            color: #dc3545;
            font-weight: 600;
        }
        .failed-step-content {
            padding: 20px;
        }
        .step-details {
            margin-bottom: 20px;
        }
        .step-details p {
            margin: 8px 0;
            color: #495057;
        }
        .step-details code {
            background: #f8f9fa;
            padding: 2px 6px;
            border-radius: 4px;
            font-family: 'Consolas', 'Monaco', monospace;
            color: #e83e8c;
        }
        .error-details {
            margin-bottom: 20px;
            padding: 15px;
            background: #f8d7da;
            border: 1px solid #f5c6cb;
            border-radius: 6px;
        }
        .error-details h4 {
            margin: 0 0 10px 0;
            color: #721c24;
            font-size: 1.1em;
        }
        .error-message {
            font-family: 'Consolas', 'Monaco', monospace;
            background: white;
            padding: 10px;
            border-radius: 4px;
            color: #721c24;
            white-space: pre-wrap;
            word-break: break-word;
        }
        .error-category {
            margin: 8px 0 0 0;
            font-size: 0.9em;
            color: #721c24;
        }
        .fix-suggestions {
            background: #d1ecf1;
            border: 1px solid #bee5eb;
            border-radius: 6px;
            padding: 15px;
        }
        .fix-suggestions h4 {
            margin: 0 0 10px 0;
            color: #0c5460;
            font-size: 1.1em;
        }
        .suggestions-list {
            list-style: none;
            padding: 0;
            margin: 0;
        }
        .suggestion-item {
            display: flex;
            align-items: flex-start;
            margin-bottom: 10px;
            padding: 8px;
            background: white;
            border-radius: 4px;
        }
        .confidence-badge {
            background: #007bff;
            color: white;
            padding: 2px 6px;
            border-radius: 12px;
            font-size: 0.8em;
            font-weight: bold;
            margin-right: 10px;
            min-width: 40px;
            text-align: center;
        }
        .skip-reason {
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            border-radius: 6px;
            padding: 10px;
            color: #856404;
        }
        
        /* デバッグリソースボタン用スタイル */
        .debug-resources {
            margin-top: 15px;
            padding: 15px;
            background: #f8f9fa;
            border-radius: 6px;
            border: 1px solid #dee2e6;
        }
        
        .debug-resources h4 {
            margin: 0 0 12px 0;
            color: #495057;
            font-size: 1em;
        }
        
        .debug-buttons {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
        }
        
        .debug-group {
            display: flex;
            border: 1px solid #dee2e6;
            border-radius: 6px;
            overflow: hidden;
            background: white;
        }
        
        .debug-btn {
            padding: 8px 12px;
            border: none;
            border-right: 1px solid #dee2e6;
            background: white;
            color: #495057;
            font-size: 0.85em;
            cursor: pointer;
            transition: all 0.2s ease;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }
        
        .debug-btn:last-child {
            border-right: none;
        }
        
        .debug-btn.download-btn {
            padding: 8px 10px;
            font-size: 0.8em;
            min-width: 40px;
            justify-content: center;
            border-left: 1px solid #dee2e6;
            background: #f8f9fa;
        }
        
        .debug-btn:hover {
            background: #e9ecef;
            border-color: #adb5bd;
            transform: translateY(-1px);
        }
        
        .debug-btn.screenshot-btn:hover {
            background: #e3f2fd;
            border-color: #2196f3;
            color: #1976d2;
        }
        
        .debug-btn.dom-btn:hover {
            background: #e8f5e8;
            border-color: #4caf50;
            color: #2e7d32;
        }
        
        .debug-btn.logs-btn:hover {
            background: #fff3e0;
            border-color: #ff9800;
            color: #f57c00;
        }
        
        .debug-btn.element-btn:hover {
            background: #fce4ec;
            border-color: #e91e63;
            color: #c2185b;
        }
        
        .debug-btn.download-btn:hover {
            background: #e9ecef;
            color: #007bff;
            transform: translateY(-1px);
        }
        
        /* スクリーンショットモーダル用スタイル */
        .screenshot-modal {
            display: none;
            position: fixed;
            z-index: 1000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0,0,0,0.8);
        }
        
        .screenshot-modal.show {
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .screenshot-content {
            max-width: 90%;
            max-height: 90%;
            position: relative;
            background: white;
            border-radius: 8px;
            overflow: hidden;
        }
        
        .screenshot-header {
            padding: 15px 20px;
            background: #f8f9fa;
            border-bottom: 1px solid #dee2e6;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .screenshot-title {
            font-weight: 600;
            color: #333;
            margin: 0;
        }
        
        .screenshot-close {
            background: none;
            border: none;
            font-size: 1.5em;
            cursor: pointer;
            color: #6c757d;
            padding: 0;
            width: 30px;
            height: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .screenshot-close:hover {
            color: #dc3545;
        }
        
        .screenshot-image {
            max-width: 100%;
            max-height: 70vh;
            display: block;
        }
        
        .screenshot-info {
            padding: 15px 20px;
            background: #f8f9fa;
            border-top: 1px solid #dee2e6;
            font-size: 0.9em;
            color: #6c757d;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🧪 AutoPlaywright</h1>
            <p>テストカバレッジレポート - ${new Date().toLocaleString('ja-JP')}</p>
        </div>
        
        <div class="summary">
            <div class="summary-card">
                <h3>カバレッジ率</h3>
                <div class="value coverage-rate">${coverage.coverage_percentage.toFixed(1)}</div>
                <div class="unit">%</div>
            </div>
            <div class="summary-card">
                <h3>成功ルート数</h3>
                <div class="value automation">${coverage.successful_routes}</div>
                <div class="unit">/ ${coverage.executed_routes}</div>
            </div>
            <div class="summary-card">
                <h3>総ステップ数</h3>
                <div class="value human-action">${coverage.total_steps}</div>
                <div class="unit">件</div>
            </div>
            <div class="summary-card">
                <h3>ステップ成功率</h3>
                <div class="value quality">${coverage.step_success_rate.toFixed(1)}</div>
                <div class="unit">%</div>
            </div>
        </div>

        ${coverage.deduplication_info && (coverage.deduplication_info.duplicates_removed > 0 || coverage.deduplication_info.failed_steps_duplicates_removed > 0) ? `
        <div class="section">
            <h2>🔄 重複除去情報</h2>
            <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; border-left: 4px solid #28a745;">
                ${coverage.deduplication_info.duplicates_removed > 0 ? `
                <p><strong>ルート重複の除去:</strong> ${coverage.deduplication_info.duplicates_removed}件の重複結果を除去しました</p>
                <p style="color: #666; font-size: 0.9em;">
                    原始結果: ${coverage.deduplication_info.original_results}件 → 
                    ユニーク結果: ${coverage.deduplication_info.unique_results}件
                </p>
                ` : ''}
                ${coverage.deduplication_info.failed_steps_duplicates_removed > 0 ? `
                <p><strong>失敗ステップ重複の除去:</strong> ${coverage.deduplication_info.failed_steps_duplicates_removed}件の重複失敗ステップを除去しました</p>
                <p style="color: #666; font-size: 0.9em;">
                    失敗ステップ原始: ${coverage.deduplication_info.failed_steps_original}件 → 
                    ユニーク失敗ステップ: ${coverage.deduplication_info.failed_steps_unique}件
                </p>
                ` : ''}
                <p style="color: #666; font-size: 0.9em;">
                    ※ 同じ内容の重複ステップから最新のものを採用
                </p>
            </div>
        </div>
        ` : ''}

        <div class="section">
            <h2>📊 総合カバレッジ</h2>
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${coverage.coverage_percentage}%"></div>
            </div>
            <p><strong>${coverage.successful_test_cases}</strong> / <strong>${coverage.total_test_cases}</strong> テストケースが成功</p>
            <p style="color: #666; font-size: 0.9em;">（実行済みテストケースのカバレッジ）</p>
            
            <table>
                <tr>
                    <th>指標</th>
                    <th>値</th>
                    <th>備考</th>
                </tr>
                <tr>
                    <td>全テストケース数</td>
                    <td>${coverage.total_test_cases}件</td>
                    <td>実行されたテストケース総数</td>
                </tr>
                <tr>
                    <td>成功テストケース数</td>
                    <td>${coverage.successful_test_cases}件</td>
                    <td>正常に完了したテストケース</td>
                </tr>
                <tr>
                    <td>失敗テストケース数</td>
                    <td>${coverage.total_test_cases - coverage.successful_test_cases}件</td>
                    <td>エラーが発生したテストケース</td>
                </tr>
                <tr style="background: #f8f9fa;">
                    <td colspan="3"><strong>参考: ステップ単位統計</strong></td>
                </tr>
                <tr>
                    <td>　実行済みステップ数</td>
                    <td>${coverage.total_steps}件</td>
                    <td>自動実行された実際のステップ数</td>
                </tr>
                <tr>
                    <td>　成功ステップ数</td>
                    <td>${coverage.successful_steps}件</td>
                    <td>個別操作レベルでの成功数</td>
                </tr>
            </table>
        </div>

        ${failedStepsSection}

        <div class="footer">
            <p>Generated by AutoPlaywright Test Coverage Analyzer</p>
            <p>データ生成時刻: ${new Date().toISOString()}</p>
        </div>
    </div>
    
    <!-- スクリーンショットモーダル -->
    <div id="screenshotModal" class="screenshot-modal">
        <div class="screenshot-content">
            <div class="screenshot-header">
                <h3 class="screenshot-title" id="screenshotTitle">失敗時のスクリーンショット</h3>
                <button class="screenshot-close" onclick="closeScreenshot()">&times;</button>
            </div>
            <div id="screenshotContainer">
                <!-- スクリーンショット画像がここに表示されます -->
            </div>
            <div class="screenshot-info" id="screenshotInfo">
                スクリーンショットを読み込み中...
            </div>
        </div>
    </div>
    
    <script>
        function toggleGroup(groupType) {
            const content = document.getElementById('content-' + groupType);
            const toggle = document.getElementById('toggle-' + groupType);
            
            if (content.classList.contains('collapsed')) {
                // 開く前に実際のコンテンツ高さを測定
                content.style.maxHeight = 'none';
                const scrollHeight = content.scrollHeight;
                content.style.maxHeight = '0px';
                
                // アニメーション用に一時的に高さを設定
                setTimeout(() => {
                    content.style.maxHeight = scrollHeight + 'px';
                    content.classList.remove('collapsed');
                    toggle.classList.remove('collapsed');
                    toggle.textContent = '▼';
                    
                    // アニメーション完了後に制限を解除
                    setTimeout(() => {
                        content.style.maxHeight = 'none';
                    }, 300);
                }, 10);
            } else {
                // 閉じる前に現在の高さを取得
                const scrollHeight = content.scrollHeight;
                content.style.maxHeight = scrollHeight + 'px';
                
                setTimeout(() => {
                    content.style.maxHeight = '0px';
                    content.classList.add('collapsed');
                    toggle.classList.add('collapsed');
                    toggle.textContent = '▶';
                }, 10);
            }
        }
        
        // 動的スクリーンショットパス生成関数
        function generateDynamicScreenshotPaths(routeId, stepIndex, userStoryId, sessionId) {
            const basePaths = [];
            
            // 新しいファイル構造（優先度高）
            if (userStoryId && sessionId) {
                basePaths.push('test-results/USIS-' + userStoryId + '/screenshots/' + sessionId + '/step_' + stepIndex + '_failure.png');
                basePaths.push('test-results/USIS-' + userStoryId + '/screenshots/' + sessionId + '/step_' + stepIndex + '.png');
            }
            
            // ユーザーストーリーIDのみ判明している場合
            if (userStoryId) {
                basePaths.push('test-results/USIS-' + userStoryId + '/screenshots/' + routeId + '/step_' + stepIndex + '_failure.png');
                basePaths.push('test-results/USIS-' + userStoryId + '/screenshots/' + routeId + '/step_' + stepIndex + '.png');
            }
            
            // 従来構造（後方互換性）
            basePaths.push('test-results/USIS-1/screenshots/' + routeId + '/step_' + stepIndex + '_failure.png');
            basePaths.push('test-results/USIS-1/screenshots/' + routeId + '/step_' + stepIndex + '.png');
            basePaths.push('test-results/screenshot_' + routeId + '_step_' + stepIndex + '.png');
            basePaths.push('test-results/failure_' + routeId + '.png');
            basePaths.push('test-results/screenshots/step_' + stepIndex + '.png');
            basePaths.push('test-results/' + routeId + '/screenshot.png');
            
            return basePaths;
        }
        
                 // スクリーンショット表示機能
         function openScreenshot(routeId, stepIndex, userStoryId, sessionId) {
             const modal = document.getElementById('screenshotModal');
             const title = document.getElementById('screenshotTitle');
             const container = document.getElementById('screenshotContainer');
             const info = document.getElementById('screenshotInfo');
             
             // タイトルを設定
             title.textContent = '失敗時のスクリーンショット - ステップ ' + stepIndex;
             
             // 情報を設定
             info.innerHTML = '<strong>ルートID:</strong> ' + routeId + '<br>' +
                             '<strong>ステップ:</strong> ' + stepIndex + '<br>' +
                             '<strong>キャプチャ時刻:</strong> ' + new Date().toLocaleString();
             
             // スクリーンショットを探す（動的パス生成）
             const possiblePaths = generateDynamicScreenshotPaths(routeId, stepIndex, userStoryId, sessionId);
             
             // まず基本パスで検索を試行
             let imageFound = false;
             let pathsChecked = 0;
             
             function tryLoadImage(path) {
                 const img = new Image();
                 img.onload = function() {
                     if (!imageFound) {
                         imageFound = true;
                         container.innerHTML = '<img src="' + path + '" alt="失敗時スクリーンショット" class="screenshot-image">';
                         info.innerHTML += '<br><strong>ファイルパス:</strong> ' + path;
                     }
                 };
                 img.onerror = function() {
                     console.log('スクリーンショットが見つかりません: ' + path);
                     pathsChecked++;
                     
                     // 全ての基本パスを試し終わったら、動的検索を開始
                     if (pathsChecked === possiblePaths.length && !imageFound) {
                         searchInTimestampDirectories(routeId, stepIndex, container, info);
                     }
                 };
                 img.src = path;
             }
             
             // 基本パスでの検索を開始
             for (const path of possiblePaths) {
                 tryLoadImage(path);
             }
             
             // タイムアウト処理は searchInTimestampDirectories で代替
             // 基本パス検索が完了すれば、自動的に動的検索に移行
             
             modal.classList.add('show');
         }
         
         function closeScreenshot() {
             const modal = document.getElementById('screenshotModal');
             modal.classList.remove('show');
         }
         
         function openDomSnapshot(routeId, stepIndex) {
             const possiblePaths = [
                 'test-results/trace_' + routeId + '.zip',
                 'test-results/' + routeId + '/trace.zip',
                 'test-results/dom_' + routeId + '_step_' + stepIndex + '.html'
             ];
             
             alert('DOM状態を確認してください:\\n\\n' + possiblePaths.join('\\n'));
         }
         
         function showExecutionLogs(routeId) {
             console.log('実行ログを表示: ' + routeId);
             alert('実行ログ機能は準備中です。\\n\\nルートID: ' + routeId + '\\n\\nブラウザの開発者ツールのコンソールでログを確認してください。');
         }
         
         function searchInTimestampDirectories(routeId, stepIndex, container, info) {
             console.log('タイムスタンプディレクトリでの動的検索を開始...');
             
             // 可能性のあるタイムスタンプディレクトリパターン
             const timestampPatterns = [
                 '2025-07-04T07-36-54_uysvac',  // 実際に見つかったディレクトリ
                 '2025-07-04T07-36-22_2zau41'   // もう一つの実際のディレクトリ
             ];
             
             let foundInTimestamp = false;
             let timestampChecked = 0;
             
             for (const timestamp of timestampPatterns) {
                 const timestampPath = 'test-results/USIS-1/screenshots/' + timestamp + '/step_' + stepIndex + '_failure.png';
                 
                 const img = new Image();
                 img.onload = function() {
                     if (!foundInTimestamp) {
                         foundInTimestamp = true;
                         container.innerHTML = '<img src="' + timestampPath + '" alt="失敗時スクリーンショット" class="screenshot-image">';
                         info.innerHTML += '<br><strong>ファイルパス:</strong> ' + timestampPath;
                         info.innerHTML += '<br><strong>検索方法:</strong> タイムスタンプディレクトリから発見';
                     }
                 };
                 img.onerror = function() {
                     timestampChecked++;
                     if (timestampChecked === timestampPatterns.length && !foundInTimestamp) {
                         // 全て失敗した場合のフォールバック
                         showNoScreenshotFound(container, routeId, stepIndex);
                     }
                 };
                 img.src = timestampPath;
             }
         }
         
         function showNoScreenshotFound(container, routeId, stepIndex) {
             const pathsList = [
                 'test-results/USIS-1/screenshots/{timestamp}/step_' + stepIndex + '_failure.png',
                 'test-results/USIS-1/screenshots/' + routeId + '/step_' + stepIndex + '_failure.png',
                 'test-results/screenshot_' + routeId + '_step_' + stepIndex + '.png'
             ].map(function(path) {
                 return '<div style="font-family: monospace; font-size: 0.9em; margin: 5px 0;">' + path + '</div>';
             }).join('');
             
             container.innerHTML = 
                 '<div style="padding: 40px; text-align: center; color: #6c757d;">' +
                     '<div style="font-size: 3em; margin-bottom: 20px;">📷</div>' +
                     '<h4>スクリーンショットが見つかりません</h4>' +
                     '<p>以下の場所を確認してください：</p>' +
                     '<div style="text-align: left; background: #f8f9fa; padding: 15px; border-radius: 4px; margin: 20px 0;">' +
                         pathsList +
                     '</div>' +
                     '<p style="font-size: 0.9em;">Playwrightの<code>screenshot: \\'only-on-failure\\'</code>設定を確認してください。</p>' +
                     '<div style="margin-top: 20px; padding: 10px; background: #e3f2fd; border-radius: 4px;">' +
                         '<strong>💡 ヒント:</strong> test-results/USIS-1/screenshots/ ディレクトリに<br>' +
                         'タイムスタンプ付きフォルダが作成されている可能性があります。' +
                     '</div>' +
                 '</div>';
         }

         function analyzeElementIssue(target, action) {
             const analysisInfo = 
                 '要素の問題を分析しています...\\n\\n' +
                 'ターゲット: ' + target + '\\n' +
                 'アクション: ' + action + '\\n\\n' +
                 '推奨事項:\\n' +
                 '1. ページが完全に読み込まれるまで待機\\n' +
                 '2. 要素が表示されるまで待機\\n' +
                 '3. セレクタの正確性を確認\\n' +
                 '4. 要素のCSS状態を確認';
             
             alert(analysisInfo);
         }
         
         // ダウンロード機能
         function downloadFile(url, filename) {
             const link = document.createElement('a');
             link.href = url;
             link.download = filename;
             link.style.display = 'none';
             document.body.appendChild(link);
             link.click();
             document.body.removeChild(link);
         }
         
         function downloadScreenshot(routeId, stepIndex, userStoryId, sessionId) {
             // 動的パス生成を使用
             const possiblePaths = generateDynamicScreenshotPaths(routeId, stepIndex, userStoryId, sessionId);
             
             // タイムスタンプベースのディレクトリ構造も追加
             possiblePaths.push('test-results/USIS-1/screenshots/2025-07-04T07-36-54_uysvac/step_' + stepIndex + '_failure.png');
             possiblePaths.push('test-results/USIS-1/screenshots/2025-07-04T07-36-22_2zau41/step_' + stepIndex + '_failure.png');
             
             // 最初に見つかったスクリーンショットをダウンロード
             let found = false;
             for (let i = 0; i < possiblePaths.length; i++) {
                 const path = possiblePaths[i];
                 const img = new Image();
                 img.onload = function() {
                     if (!found) {
                         found = true;
                         const filename = 'screenshot_' + routeId + '_step_' + stepIndex + '.png';
                         downloadFile(path, filename);
                         showDownloadStatus('スクリーンショット', filename, true);
                     }
                 };
                 img.onerror = function() {
                     if (i === possiblePaths.length - 1 && !found) {
                         showDownloadStatus('スクリーンショット', '', false);
                     }
                 };
                 img.src = path;
             }
         }
         
         function downloadDomSnapshot(routeId, stepIndex) {
             const possiblePaths = [
                 'test-results/trace_' + routeId + '.zip',
                 'test-results/' + routeId + '/trace.zip',
                 'test-results/dom_' + routeId + '_step_' + stepIndex + '.html',
                 'test-results/' + routeId + '/dom_snapshot.html'
             ];
             
             // 最初に見つかったDOMファイルをダウンロード
             let found = false;
             let checkedCount = 0;
             
             for (let i = 0; i < possiblePaths.length; i++) {
                 const path = possiblePaths[i];
                 const checkElement = document.createElement('img');
                 
                 checkElement.onload = function() {
                     // 画像として読み込めたということは、実際にはファイルではない可能性が高い
                     checkedCount++;
                     if (checkedCount === possiblePaths.length && !found) {
                         // 全てチェック完了したが見つからなかった場合
                         generateFallbackDomReport(routeId, stepIndex);
                     }
                 };
                 
                 checkElement.onerror = function() {
                     // エラーが発生した場合、ファイルが存在する可能性があるのでダウンロードを試行
                     if (!found) {
                         found = true;
                         const extension = path.includes('.zip') ? '.zip' : '.html';
                         const filename = 'dom_snapshot_' + routeId + '_step_' + stepIndex + extension;
                         
                         // ダウンロードを試行
                         const link = document.createElement('a');
                         link.href = path;
                         link.download = filename;
                         link.style.display = 'none';
                         document.body.appendChild(link);
                         link.click();
                         document.body.removeChild(link);
                         
                         showDownloadStatus('DOM状態', filename, true);
                         return;
                     }
                     
                     checkedCount++;
                     if (checkedCount === possiblePaths.length && !found) {
                         generateFallbackDomReport(routeId, stepIndex);
                     }
                 };
                 
                 checkElement.src = path;
             }
         }
         
         function generateFallbackDomReport(routeId, stepIndex) {
             const timestamp = new Date().toISOString();
             const domReportContent = 
                 'AutoPlaywright DOM状態レポート\\n' +
                 '=============================\\n\\n' +
                 'ルートID: ' + routeId + '\\n' +
                 'ステップ: ' + stepIndex + '\\n' +
                 '生成時刻: ' + timestamp + '\\n\\n' +
                 'DOM状態情報:\\n' +
                 '- 実際のDOMスナップショットファイルが見つかりませんでした\\n' +
                 '- このレポートはHTMLレポートから生成されたフォールバック情報です\\n\\n' +
                 '確認すべきファイル:\\n' +
                 '- test-results/trace_' + routeId + '.zip (Playwrightトレースファイル)\\n' +
                 '- test-results/' + routeId + '/trace.zip\\n' +
                 '- test-results/dom_' + routeId + '_step_' + stepIndex + '.html\\n' +
                 '- test-results/' + routeId + '/dom_snapshot.html\\n\\n' +
                 'DOM分析のヒント:\\n' +
                 '1. Playwrightの trace オプションを有効にしてください\\n' +
                 '2. playwright.config.js でトレース設定を確認\\n' +
                 '3. ブラウザの開発者ツールでDOM構造を調査\\n' +
                 '4. セレクタが正しくDOM要素を指しているか確認';
             
             const blob = new Blob([domReportContent], { type: 'text/plain;charset=utf-8' });
             const url = URL.createObjectURL(blob);
             const filename = 'dom_report_' + routeId + '_step_' + stepIndex + '.txt';
             
             downloadFile(url, filename);
             showDownloadStatus('DOM状態レポート', filename, true);
             
             // メモリリークを防ぐためURLを解放
             setTimeout(() => URL.revokeObjectURL(url), 1000);
         }
         
         function downloadExecutionLogs(routeId, stepIndex) {
             const timestamp = new Date().toISOString();
             const logContent = 
                 'AutoPlaywright 実行ログ\\n' +
                 '========================\\n\\n' +
                 'ルートID: ' + routeId + '\\n' +
                 'ステップ: ' + stepIndex + '\\n' +
                 '生成時刻: ' + timestamp + '\\n\\n' +
                 '実行ログ詳細:\\n' +
                 '- このログは現在のHTMLレポートから生成されました\\n' +
                 '- 詳細な実行ログはPlaywrightの実行時に生成されます\\n' +
                 '- test-results/ディレクトリで実際のログファイルを確認してください\\n\\n' +
                 '確認すべきファイル:\\n' +
                 '- test-results/playwright-report/\\n' +
                 '- test-results/logs_' + routeId + '.txt\\n' +
                 '- test-results/' + routeId + '/execution.log';
             
             const blob = new Blob([logContent], { type: 'text/plain;charset=utf-8' });
             const url = URL.createObjectURL(blob);
             const filename = 'execution_logs_' + routeId + '_step_' + stepIndex + '.txt';
             
             downloadFile(url, filename);
             showDownloadStatus('実行ログ', filename, true);
             
             // メモリリークを防ぐためURLを解放
             setTimeout(() => URL.revokeObjectURL(url), 1000);
         }
         
         function downloadElementAnalysis(target, action, routeId, stepIndex) {
             const timestamp = new Date().toISOString();
             const analysisContent = 
                 'AutoPlaywright 要素分析レポート\\n' +
                 '===============================\\n\\n' +
                 'ルートID: ' + routeId + '\\n' +
                 'ステップ: ' + stepIndex + '\\n' +
                 '生成時刻: ' + timestamp + '\\n\\n' +
                 '失敗した要素情報:\\n' +
                 'ターゲット: ' + target + '\\n' +
                 'アクション: ' + action + '\\n\\n' +
                 '分析結果:\\n' +
                 '1. 要素の可視性の問題が考えられます\\n' +
                 '2. セレクタの正確性を確認してください\\n' +
                 '3. ページの読み込み完了を待機する必要があります\\n' +
                 '4. 要素のCSS状態を確認してください\\n\\n' +
                 '推奨対応:\\n' +
                 '- waitForSelector() を使用して要素の出現を待機\\n' +
                 '- セレクタの階層や属性を再確認\\n' +
                 '- ブラウザの開発者ツールで要素を検査\\n' +
                 '- 代替セレクタの検討';
             
             const blob = new Blob([analysisContent], { type: 'text/plain;charset=utf-8' });
             const url = URL.createObjectURL(blob);
             const filename = 'element_analysis_' + routeId + '_step_' + stepIndex + '.txt';
             
             downloadFile(url, filename);
             showDownloadStatus('要素分析', filename, true);
             
             // メモリリークを防ぐためURLを解放
             setTimeout(() => URL.revokeObjectURL(url), 1000);
         }
         
         function showDownloadStatus(type, filename, success) {
             const message = success 
                 ? type + ' をダウンロードしました: ' + filename
                 : type + ' ファイルが見つかりませんでした。test-resultsディレクトリを確認してください。';
             
             // 一時的な通知を表示
             const notification = document.createElement('div');
             notification.style.position = 'fixed';
             notification.style.top = '20px';
             notification.style.right = '20px';
             notification.style.padding = '12px 20px';
             notification.style.borderRadius = '6px';
             notification.style.color = 'white';
             notification.style.fontWeight = 'bold';
             notification.style.zIndex = '10000';
             notification.style.maxWidth = '400px';
             notification.style.wordWrap = 'break-word';
             notification.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
             
             if (success) {
                 notification.style.backgroundColor = '#28a745';
                 notification.innerHTML = '✅ ' + message;
             } else {
                 notification.style.backgroundColor = '#dc3545';
                 notification.innerHTML = '❌ ' + message;
             }
             
             document.body.appendChild(notification);
             
             // 3秒後に通知を削除
             setTimeout(() => {
                 if (notification.parentNode) {
                     notification.parentNode.removeChild(notification);
                 }
             }, 3000);
         }
        
        // ESCキーでモーダルを閉じる
        document.addEventListener('keydown', function(event) {
            if (event.key === 'Escape') {
                closeScreenshot();
            }
        });
        
        // モーダル背景クリックで閉じる
        document.addEventListener('click', function(event) {
            const modal = document.getElementById('screenshotModal');
            if (event.target === modal) {
                closeScreenshot();
            }
        });
        
                 // ページ読み込み時の初期化
         document.addEventListener('DOMContentLoaded', function() {
             console.log('🎯 失敗原因トグルグループ機能が読み込まれました');
             console.log('📊 失敗グループ数:', document.querySelectorAll('.failure-group').length);
             console.log('🔍 デバッグボタン機能が読み込まれました');
             console.log('⬇️ ダウンロード機能が読み込まれました');
            
            // 初期状態ですべてのグループを閉じておく
            document.querySelectorAll('.group-content').forEach(content => {
                content.classList.add('collapsed');
            });
            document.querySelectorAll('.group-toggle').forEach(toggle => {
                toggle.classList.add('collapsed');
                toggle.textContent = '▶';
            });
        });
    </script>
</body>
</html>
  `;

  fs.writeFileSync(outputPath, html);
  console.log(`📊 HTMLカバレッジレポート生成完了: ${path.basename(outputPath)}`);
  console.log(`🌐 ブラウザで開く: file://${outputPath}`);
}

// テストケースのマッピング機能を改善
function mapRouteResultsToTestCases(routes, results, testCases) {
    console.log('🔗 ルート結果をテストケースにマッピング中...');
    
    const mappedTestCases = testCases.map(testCase => {
        // 新しいルートの結果を確認
        const matchingRoute = routes.find(route => {
            // 自然言語ケースIDでのマッピング
            if (route.generated_from_natural_case === testCase.id) {
                return true;
            }
            
            // 観点内容でのマッピング
            if (route.original_viewpoint && testCase.title) {
                const routeKeywords = route.original_viewpoint.toLowerCase().split(/[、。\s]+/);
                const testCaseKeywords = testCase.title.toLowerCase().split(/[、。\s]+/);
                const commonKeywords = routeKeywords.filter(keyword => 
                    testCaseKeywords.some(tcKeyword => tcKeyword.includes(keyword) || keyword.includes(tcKeyword))
                );
                return commonKeywords.length >= 2; // 2つ以上のキーワードが一致
            }
            
            return false;
        });
        
        if (matchingRoute) {
            const routeResult = results.find(result => result.route_id === matchingRoute.route_id);
            if (routeResult) {
                console.log(`✅ マッピング成功: ${testCase.id} -> ${matchingRoute.route_id}`);
                return {
                    ...testCase,
                    status: routeResult.success_rate === 100 ? 'success' : 'failed',
                    execution_time: routeResult.execution_time,
                    source_file: routeResult.result_file,
                    error_message: routeResult.success_rate === 100 ? null : 'ルート実行で失敗'
                };
            }
        }
        
        return testCase;
    });
    
    const successCount = mappedTestCases.filter(tc => tc.status === 'success').length;
    console.log(`📊 マッピング結果: ${successCount}/${mappedTestCases.length} テストケースが成功`);
    
    return mappedTestCases;
}

/**
 * 🚀 フェーズ3: 包括的テスト用のステップマッピング
 */
function createComprehensiveStepMapping(testPoints, steps) {
  const mapping = {};
  
  steps.forEach((step, stepIndex) => {
    if (step.comprehensive_test) {
      // 包括的テストの場合、フェーズ別にマッピング
      const phase = step.phase || 'execution';
      const elementName = step.dom_element_info?.name || step.dom_element_info?.id || 'unknown';
      
      mapping[stepIndex] = {
        functionKey: `comprehensive_${elementName}`,
        functionIndex: 0,
        functionName: `包括的テスト: ${elementName}`,
        viewpointIndex: getPhaseIndex(phase),
        viewpoint: `${phase}フェーズ: ${step.label}`,
        stepInViewpoint: stepIndex,
        mappingType: 'comprehensive'
      };
    } else {
      // 標準テストの場合は従来のマッピング
      mapping[stepIndex] = createStandardStepMapping(testPoints, step, stepIndex);
    }
  });
  
  return mapping;
}

/**
 * フェーズインデックス取得
 */
function getPhaseIndex(phase) {
  const phaseMap = {
    'structure_validation': 0,
    'value_validation': 1,
    'operation_test': 2,
    'dependency_test': 3,
    'valid_input_test': 4,
    'invalid_input_test': 5,
    'execution': 6
  };
  
  return phaseMap[phase] || 6;
}

/**
 * 標準ステップマッピング
 */
function createStandardStepMapping(testPoints, step, stepIndex) {
  // 従来のロジックを流用
  return {
    functionKey: `standard_function`,
    functionIndex: 0,
    functionName: '標準機能テスト',
    viewpointIndex: Math.floor(stepIndex / 3),
    viewpoint: step.label || `ステップ${stepIndex + 1}`,
    stepInViewpoint: stepIndex % 3,
    mappingType: 'standard'
  };
}

/**
 * 包括的テスト対応のステップフォーマット
 */
function formatComprehensiveTestSteps(step, isComprehensive) {
  if (!isComprehensive) {
    return formatTestSteps(step);
  }
  
  // 包括的テストの詳細フォーマット
  let formatted = `[${step.phase || 'execution'}] ${step.label}`;
  
  if (step.action) {
    formatted += ` (${step.action})`;
  }
  
  if (step.description) {
    formatted += `: ${step.description}`;
  }
  
  // バリデーション情報の追加
  if (step.expectedCount !== undefined) {
    formatted += ` [期待値: ${step.expectedCount}]`;
  }
  
  if (step.expectedTexts && step.expectedTexts.length > 0) {
    formatted += ` [期待テキスト: ${step.expectedTexts.join(', ')}]`;
  }
  
  if (step.expectedValues && step.expectedValues.length > 0) {
    formatted += ` [期待値: ${step.expectedValues.join(', ')}]`;
  }
  
  return formatted;
}

/**
 * バリデーション数カウント
 */
function getValidationCount(step) {
  let count = 0;
  
  // アサーション系アクションをカウント
  const validationActions = [
    'assertOptionCount', 'assertOptionTexts', 'assertOptionValues',
    'assertSelectedValue', 'assertEmailValidation', 'assertPhoneValidation',
    'assertNumericValidation', 'assertValidationError', 'assertPlaceholder',
    'assertPattern', 'assertChecked', 'assertUnchecked'
  ];
  
  if (validationActions.includes(step.action)) {
    count++;
  }
  
  // 複数期待値がある場合は追加カウント
  if (step.expectedTexts && step.expectedTexts.length > 1) {
    count += step.expectedTexts.length - 1;
  }
  
  if (step.expectedValues && step.expectedValues.length > 1) {
    count += step.expectedValues.length - 1;
  }
  
  return count;
}

