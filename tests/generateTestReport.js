import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import dotenv from 'dotenv';

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
  } else {
    // フォールバック時も改行文字を削除
    userStory = (route.userStory || route.goal || 'テストシナリオ実行').replace(/[\r\n]+/g, ' ').trim();
    userStoryId = extractUserStoryId(userStory) || 1;
    console.log(`⚠️ フォールバック: 推定ユーザーストーリーID ${userStoryId}`);
  }
  
  const reportData = [];
  
  // 重複問題解決：実行されたステップベースでレポートを生成
  if (result.steps && Array.isArray(result.steps) && result.steps.length > 0) {
    console.log(`📊 実行されたステップ数: ${result.steps.length}件`);
    
    // 実行されたステップをテスト観点にマッピング
    const stepToViewpointMapping = createStepToViewpointMapping(testPoints, result.steps);
    
    result.steps.forEach((step, stepIndex) => {
      const mapping = stepToViewpointMapping[stepIndex];
      
      if (mapping) {
        // 観点にマッピングできた場合
        const functionId = getFunctionId(mapping.functionKey, mapping.functionIndex);
        const traceableId = `${userStoryId}.${functionId}.${mapping.viewpointIndex + 1}`;
        const uniqueTestCaseId = `${traceableId}-${mapping.stepInViewpoint + 1}`;
        
        reportData.push({
          executionTime,
          id: uniqueTestCaseId,
          userStory,
          function: mapping.functionName,
          viewpoint: mapping.viewpoint,
          testSteps: formatTestSteps(step),
          executionResult: step.status === 'success' ? 'success' : 'failed',
          errorDetail: step.error || '',
          url: testUrl,
          isFixedRoute: isFixedRoute
        });
      } else {
        // 観点にマッピングできなかった場合は追加ステップとして扱う
        const viewpointId = Math.floor(stepIndex / 5) + 1; // 5ステップごとに新しい観点
        const testCaseId = (index % 5) + 1;
        const uniqueTestCaseId = `${userStoryId}.X.${viewpointId}-${testCaseId}`;
        
        reportData.push({
          executionTime,
          id: uniqueTestCaseId,
          userStory,
          function: 'その他機能',
          viewpoint: `追加実行ステップ${viewpointId}`,
          testSteps: formatTestSteps(step),
          executionResult: step.status === 'success' ? 'success' : 'failed',
          errorDetail: step.error || '',
          url: testUrl,
          isFixedRoute: isFixedRoute
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
  // 修正ルートかどうかを判定（reportDataの最初の要素から判定）
  const isFixedRoute = reportData.length > 0 && reportData[0].isFixedRoute;
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
    '実行種別'
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
  
  reportData.forEach(data => {
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
      escapeCSVField(executionType)
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
  
  const headers = ['実行日時', 'ID', 'ユーザーストーリー', '機能', '観点', 'テスト手順', resultHeader, 'エラー詳細', 'URL', '実行種別'];
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
          escapeCSVField(executionType)
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
        escapeCSVField(executionType)
      ];
      csvRows.push(row.join(','));
    }
  });

  console.log(`📊 分類別バッチレポート生成完了: ${batchResult.categories.length}分類, ${totalRoutes}ルート（成功${successfulRoutes}件）`);
  
  return csvRows.join('\n');
}

/**
 * テストカバレッジを算出する（分母：全テストケース、分子：実行済み成功テスト）
 * @param {Object} testPointsData - テスト観点データ
 * @param {Object} testCasesData - テストケースデータ（分母として使用）
 * @param {Object} routeData - ルートデータ
 * @param {Object} resultData - 実行結果データ
 * @returns {Object} - カバレッジ情報
 */
async function calculateTestCoverage(testPointsData, testCasesData, routeData, resultData) {
  const coverage = {
    timestamp: new Date().toISOString(),
    source_analysis: {},
    automation_analysis: {},
    execution_analysis: {},
    human_action_required: {},
    overall_coverage: {},
    detailed_test_cases: []
  };

  // 1. ソース分析（テスト観点 → テストケース生成状況）
  if (testPointsData && testCasesData) {
    const testPointsCount = Array.isArray(testPointsData) ? testPointsData.length : 0;
    
    // 全テストケース数を正確に計算（これが真の分母）
    let totalTestCases = 0;
    let categoryCoverage = {};
    
    if (testCasesData.categories) {
      // 分類別データの場合
      Object.keys(testCasesData.categories).forEach(category => {
        const categoryData = testCasesData.categories[category];
        const categoryCount = Array.isArray(categoryData) ? categoryData.length : 0;
        totalTestCases += categoryCount;
        categoryCoverage[category] = {
          test_cases: categoryCount,
          generation_rate: testPointsCount > 0 ? (categoryCount / testPointsCount * 100) : 0
        };
      });
    } else if (Array.isArray(testCasesData)) {
      // 配列形式の場合
      totalTestCases = testCasesData.length;
    }

    coverage.source_analysis = {
      total_test_points: testPointsCount,
      total_generated_test_cases: totalTestCases,
      generation_efficiency: testPointsCount > 0 ? (totalTestCases / testPointsCount * 100) : 0,
      category_breakdown: categoryCoverage,
      note: 'AI生成によるテストケース変換効率'
    };
  }

  // 2. 自動化分析（AIとPlaywrightの到達範囲） - 複数ルート対応
  if (testCasesData && routeData) {
    let totalTestCases = coverage.source_analysis.total_generated_test_cases || 0;
    let automatedRoutes = 0;
    let feasibleRoutes = 0;
    let lowFeasibilityRoutes = 0;
    let unautomatedTestCases = 0;
    let automationByCategory = {};

    if (Array.isArray(routeData)) {
      // 複数ルートの場合
      console.log(`📊 複数ルート統合: ${routeData.length}件のルートを分析中...`);
      
      const routeSet = new Set(); // 重複除去
      routeData.forEach(route => {
        if (route.route_id && !routeSet.has(route.route_id)) {
          routeSet.add(route.route_id);
          automatedRoutes++;
          
          const score = route.feasibility_score || 1;
          if (score >= 0.7) {
            feasibleRoutes++;
          } else if (score >= 0.3) {
            lowFeasibilityRoutes++;
          }
        }
      });
      
      unautomatedTestCases = Math.max(0, totalTestCases - automatedRoutes);
      console.log(`📊 ルート分析結果: 自動化${automatedRoutes}件, 実行可能${feasibleRoutes}件, 低実行可能性${lowFeasibilityRoutes}件`);
      
    } else if (routeData.categories) {
      // 分類バッチの場合
      routeData.categories.forEach(category => {
        const categoryRoutes = category.routes ? category.routes.length : 0;
        const feasibleCategoryRoutes = category.routes ? 
          category.routes.filter(route => (route.feasibility_score || 0) >= 0.7).length : 0;
        const lowFeasibilityCategoryRoutes = category.routes ? 
          category.routes.filter(route => {
            const score = route.feasibility_score || 0;
            return score >= 0.3 && score < 0.7;
          }).length : 0;
        
        // この分類のテストケース総数
        const categoryTestCases = coverage.source_analysis.category_breakdown?.[category.category]?.test_cases || 0;
        const categoryUnautomated = Math.max(0, categoryTestCases - categoryRoutes);
        
        automatedRoutes += categoryRoutes;
        feasibleRoutes += feasibleCategoryRoutes;
        lowFeasibilityRoutes += lowFeasibilityCategoryRoutes;
        unautomatedTestCases += categoryUnautomated;
        
        automationByCategory[category.category] = {
          total_test_cases: categoryTestCases,
          automated_routes: categoryRoutes,
          feasible_routes: feasibleCategoryRoutes,
          low_feasibility_routes: lowFeasibilityCategoryRoutes,
          unautomated_cases: categoryUnautomated,
          automation_rate: categoryTestCases > 0 ? (categoryRoutes / categoryTestCases * 100) : 0,
          feasibility_rate: categoryRoutes > 0 ? (feasibleCategoryRoutes / categoryRoutes * 100) : 0
        };
      });
    } else if (routeData.steps) {
      // 単一ルートの場合
      automatedRoutes = 1;
      const score = routeData.feasibility_score || 1;
      if (score >= 0.7) {
        feasibleRoutes = 1;
      } else if (score >= 0.3) {
        lowFeasibilityRoutes = 1;
      }
      unautomatedTestCases = Math.max(0, totalTestCases - 1);
    }

    coverage.automation_analysis = {
      total_test_cases: totalTestCases,
      automated_routes: automatedRoutes,
      feasible_routes: feasibleRoutes,
      low_feasibility_routes: lowFeasibilityRoutes,
      unautomated_test_cases: unautomatedTestCases,
      automation_rate: totalTestCases > 0 ? (automatedRoutes / totalTestCases * 100) : 0,
      feasibility_rate: automatedRoutes > 0 ? (feasibleRoutes / automatedRoutes * 100) : 0,
      category_breakdown: automationByCategory,
      note: 'Playwright自動化の到達範囲'
    };
  }

  // 3. 実行分析（自動実行の成功状況） - 複数結果統合対応
  if (resultData && routeData) {
    let executedRoutes = 0;
    let successfulRoutes = 0;
    let failedRoutes = 0;
    let totalSteps = 0;
    let successfulSteps = 0;
    let executionByCategory = {};
    let routeResults = new Map(); // ルートIDごとの最高結果を記録

    // 複数結果統合の場合
    if (Array.isArray(resultData)) {
      console.log(`📊 複数実行結果統合: ${resultData.length}件の結果を統合中...`);
      
      // 各結果を処理
      resultData.forEach((result, index) => {
        if (result.steps) {
          const routeId = result.route_id;
          const successRate = result.success_count / (result.success_count + result.failed_count);
          const isSuccess = result.failed_count === 0 || successRate >= 0.8;
          
          // ルートごとの最高結果を保持（一度でも成功すればカウント）
          if (!routeResults.has(routeId) || (isSuccess && !routeResults.get(routeId).success)) {
            routeResults.set(routeId, {
              success: isSuccess,
              successRate: successRate,
              totalSteps: result.total_steps || result.steps.length,
              successfulSteps: result.success_count || result.steps.filter(step => step.status === 'success').length,
              filename: result.filename || `result_${index}`
            });
          }
          
          console.log(`📊 結果${index + 1}: ${routeId} - 成功率${(successRate*100).toFixed(1)}% (${isSuccess ? '成功' : '失敗'})`);
        }
      });
      
      // 統合統計を計算
      executedRoutes = routeResults.size;
      for (const [routeId, result] of routeResults) {
        if (result.success) {
          successfulRoutes++;
        } else {
          failedRoutes++;
        }
        totalSteps += result.totalSteps;
        successfulSteps += result.successfulSteps;
      }
      
      console.log(`📊 統合結果: ユニークルート${executedRoutes}件, 成功${successfulRoutes}件, 失敗${failedRoutes}件`);
      
    } else {
      // 単一結果の場合（従来ロジック）
      console.log('📊 単一実行結果から統計を算出中...');
      
      if (resultData.categories) {
        // 分類バッチ実行の場合
        resultData.categories.forEach(category => {
          const categoryExecution = {
            executed_routes: category.executed_count || 0,
            successful_routes: category.success_count || 0,
            failed_routes: category.failed_count || 0,
            execution_rate: category.executed_count > 0 ? 
              (category.success_count / category.executed_count * 100) : 0
          };

          executedRoutes += category.executed_count || 0;
          successfulRoutes += category.success_count || 0;
          failedRoutes += category.failed_count || 0;
          
          // ステップレベルの統計
          if (category.routes) {
            category.routes.forEach(route => {
              if (route.steps) {
                totalSteps += route.steps.length;
                successfulSteps += route.steps.filter(step => step.status === 'success').length;
              }
            });
          }
          
          executionByCategory[category.category] = categoryExecution;
        });
      } else if (resultData.steps) {
        // 単一実行の場合 - 部分成功も評価
        executedRoutes = 1;
        const successRate = resultData.success_count / (resultData.success_count + resultData.failed_count);
        
        // 80%以上成功は成功ルートとしてカウント
        if (resultData.failed_count === 0 || successRate >= 0.8) {
          successfulRoutes = 1;
          failedRoutes = 0;
        } else {
          successfulRoutes = 0;
          failedRoutes = 1;
        }
        
        totalSteps = resultData.total_steps || resultData.steps.length;
        successfulSteps = resultData.success_count || resultData.steps.filter(step => step.status === 'success').length;
        
        console.log(`📊 単一実行結果: 成功ステップ${successfulSteps}/${totalSteps}, 成功率${(successRate*100).toFixed(1)}%, ルート${successfulRoutes ? '成功' : '失敗'}`);
      }
    }
    
    console.log(`📊 実行結果分析完了: 実行${executedRoutes}件, 成功${successfulRoutes}件, 失敗${failedRoutes}件`);

    coverage.execution_analysis = {
      executed_routes: executedRoutes,
      successful_routes: successfulRoutes,
      failed_routes: failedRoutes,
      execution_success_rate: executedRoutes > 0 ? (successfulRoutes / executedRoutes * 100) : 0,
      total_steps: totalSteps,
      successful_steps: successfulSteps,
      step_success_rate: totalSteps > 0 ? (successfulSteps / totalSteps * 100) : 0,
      category_breakdown: executionByCategory,
      note: '実際の自動実行結果'
    };
  }

  // 4. 人間対応必要項目の特定
  const totalTestCases = coverage.source_analysis.total_generated_test_cases || 0;
  const automatedRoutes = coverage.automation_analysis.automated_routes || 0;
  const feasibleRoutes = coverage.automation_analysis.feasible_routes || 0;
  const lowFeasibilityRoutes = coverage.automation_analysis.low_feasibility_routes || 0;
  const unautomatedTestCases = coverage.automation_analysis.unautomated_test_cases || 0;
  const successfulRoutes = coverage.execution_analysis.successful_routes || 0;
  const failedRoutes = coverage.execution_analysis.failed_routes || 0;
  
  // 人間対応が必要な項目を明確化
  coverage.human_action_required = {
    unautomated_test_cases: unautomatedTestCases,
    low_feasibility_routes: lowFeasibilityRoutes,
    failed_automation_routes: failedRoutes,
    total_human_action_needed: unautomatedTestCases + lowFeasibilityRoutes + failedRoutes,
    manual_test_recommendations: [
      ...(unautomatedTestCases > 0 ? [`${unautomatedTestCases}件の未自動化テストケース（AIがPlaywrightルート生成できず）`] : []),
      ...(lowFeasibilityRoutes > 0 ? [`${lowFeasibilityRoutes}件の低実行可能性ルート（実行可能性スコア0.3-0.7未満）`] : []),
      ...(failedRoutes > 0 ? [`${failedRoutes}件の自動実行失敗ルート（手動再確認推奨）`] : [])
    ],
    note: 'AI・Playwrightでカバーできず、人間による手動テストが必要な項目'
  };

  // 5. 詳細テストケース情報の構築
  if (testCasesData && routeData) {
    const detailedTestCases = [];
    
    // テストケースデータの処理
    let allTestCases = [];
    if (testCasesData.categories) {
      // 分類別データの場合
      Object.keys(testCasesData.categories).forEach(category => {
        const categoryData = testCasesData.categories[category];
        if (Array.isArray(categoryData)) {
          categoryData.forEach(testCase => {
            allTestCases.push({...testCase, category: category});
          });
        }
      });
    } else if (Array.isArray(testCasesData)) {
      allTestCases = testCasesData;
    }
    
    // 各テストケースの詳細情報を構築
    console.log(`📊 テストケース詳細構築中: ${allTestCases.length}件のテストケース`);
    
    allTestCases.forEach((testCase, index) => {
      // 対応するルートを検索（複数ルート対応）
      let relatedRoute = null;
      
      if (Array.isArray(routeData)) {
        // 複数ルートの場合
        routeData.forEach(route => {
          // より柔軟なマッピング条件
          if (route.generated_from_natural_case === testCase.id ||
              route.route_id?.includes(testCase.id) ||
              route.original_viewpoint === testCase.original_viewpoint ||
              (route.original_viewpoint && testCase.original_viewpoint && 
               route.original_viewpoint.includes(testCase.original_viewpoint.substring(0, 30))) ||
              (route.original_viewpoint && testCase.title && 
               testCase.title.includes(route.original_viewpoint.substring(0, 30)))) {
            relatedRoute = route;
          }
        });
      } else if (routeData.categories) {
        // 分類バッチの場合
        routeData.categories.forEach(category => {
          if (category.routes) {
            const found = category.routes.find(route => 
              route.id === testCase.id || 
              route.scenario?.includes(testCase.scenario || testCase.title) ||
              (testCase.steps && route.steps && route.steps.some(step => testCase.steps.includes(step)))
            );
            if (found) relatedRoute = found;
          }
        });
      } else if (routeData.steps) {
        // 単一ルートの場合、最初のテストケースのみが対応する
        relatedRoute = index === 0 ? routeData : null;
      }
      
      // 対応する実行結果を検索（複数結果統合対応）
      let relatedResult = null;
      let bestSuccessRate = -1;
      
      if (Array.isArray(resultData)) {
        // 複数結果統合の場合 - 最も良い結果を選択
        resultData.forEach(result => {
          if (result.route_id === relatedRoute?.route_id) {
            const successRate = result.success_count / (result.success_count + result.failed_count);
            if (successRate > bestSuccessRate) {
              relatedResult = result;
              bestSuccessRate = successRate;
              console.log(`✅ マッピング成功: テストケース${testCase.id} → ルート${relatedRoute.route_id} → 結果${result.route_id} (成功率${(successRate*100).toFixed(1)}%)`);
            }
          }
        });
      } else if (resultData && resultData.categories) {
        // 分類バッチの場合
        resultData.categories.forEach(category => {
          if (category.routes) {
            const found = category.routes.find(result => 
              result.id === testCase.id ||
              result.route_id === relatedRoute?.id ||
              result.scenario?.includes(testCase.scenario || testCase.title)
            );
            if (found) relatedResult = found;
          }
        });
      } else if (resultData && resultData.steps && relatedRoute) {
        // 単一実行の場合、ルートがある場合のみ実行結果を適用
        relatedResult = resultData;
      }
      
      // ステータス判定（より正確な判定）
      let status = 'not_automated';  // デフォルトは未自動化
      let errorMessage = null;
      let executionTime = null;
      
              if (relatedRoute) {
          // ルートが生成されている場合
          if (relatedResult) {
            // 実行結果がある場合 - 部分成功も評価
            const successRate = relatedResult.success_count / (relatedResult.success_count + relatedResult.failed_count);
            if (relatedResult.failed_count === 0) {
              status = 'success'; // 完全成功
            } else if (successRate >= 0.8) {
              status = 'success'; // 80%以上成功は成功扱い
            } else {
              status = 'failed'; // 失敗扱い
            }
            errorMessage = relatedResult.error || relatedResult.error_message;
            executionTime = relatedResult.execution_time || relatedResult.duration;
          } else {
            // ルートはあるが実行結果がない場合
            status = 'failed';
            errorMessage = '実行結果が見つかりません';
          }
        } else {
          // ルートが生成されていない場合は未自動化
          status = 'not_automated';
          errorMessage = 'AIがPlaywrightルートを生成できませんでした';
        }
      
      detailedTestCases.push({
        id: testCase.id || `TC${index + 1}`,
        title: testCase.scenario || testCase.title || testCase.story || `テストケース ${index + 1}`,
        description: testCase.steps || testCase.description || testCase.expected_result || testCase.detail || '詳細情報なし',
        category: testCase.category || '未分類',
        status: status,
        feasibility_score: relatedRoute?.feasibility_score || testCase.feasibility_score,
        error_message: errorMessage,
        execution_time: executionTime,
        source_file: testCase.source_file || 'unknown'
      });
    });
    
    // ステータス統計をログ出力
    const statusCounts = detailedTestCases.reduce((acc, tc) => {
      acc[tc.status] = (acc[tc.status] || 0) + 1;
      return acc;
    }, {});
    console.log(`📊 テストケースステータス統計:`, statusCounts);
    
    coverage.detailed_test_cases = detailedTestCases;
  }

  // 6. 総合カバレッジ算出（QA観点：機能×観点ベース）
  const totalSteps = coverage.execution_analysis?.total_steps || 0;
  const successfulSteps = coverage.execution_analysis?.successful_steps || 0;
  
  // QA観点での正しいカバレッジ計算：機能×観点=テストケース単位
  const totalTestCasesForCoverage = coverage.detailed_test_cases?.length || totalTestCases;
  const successfulTestCases = coverage.detailed_test_cases?.filter(tc => tc.status === 'success').length || 0;
  
  // ステップ単位は参考情報として保持
  const avgStepsPerTestCase = totalSteps > 0 && automatedRoutes > 0 ? Math.round(totalSteps / automatedRoutes) : 5;
  const unautomatedSteps = unautomatedTestCases * avgStepsPerTestCase;
  const totalStepsIncludingUnautomated = totalSteps + unautomatedSteps;
  
  coverage.overall_coverage = {
    // 基本統計（テストケース単位）
    total_test_cases: totalTestCasesForCoverage,
    automated_routes: automatedRoutes,
    feasible_routes: feasibleRoutes,
    executed_routes: feasibleRoutes, // 実行可能なものは全て実行される前提
    successful_routes: successfulRoutes,
    successful_test_cases: successfulTestCases,
    
    // ステップ単位統計（参考情報）
    total_steps: totalSteps,
    successful_steps: successfulSteps,
    unautomated_test_cases: unautomatedTestCases,
    unautomated_estimated_steps: unautomatedSteps,
    total_steps_including_unautomated: totalStepsIncludingUnautomated,
    
    // カバレッジ率（QA観点：機能×観点=テストケース単位）
    automation_coverage: totalTestCasesForCoverage > 0 ? (automatedRoutes / totalTestCasesForCoverage * 100) : 0,
    feasibility_coverage: totalTestCasesForCoverage > 0 ? (feasibleRoutes / totalTestCasesForCoverage * 100) : 0,
    success_coverage: totalTestCasesForCoverage > 0 ? (successfulTestCases / totalTestCasesForCoverage * 100) : 0, // ★QA観点の正しいカバレッジ
    
    // 残課題（テストケース単位）
    remaining_steps: totalStepsIncludingUnautomated - successfulSteps, // 参考情報
    remaining_test_cases: totalTestCasesForCoverage - successfulTestCases, // QA観点の残課題
    coverage_gap: totalTestCasesForCoverage > 0 ? ((totalTestCasesForCoverage - successfulTestCases) / totalTestCasesForCoverage * 100) : 0, // ★QA観点
    
    // 品質指標
    quality_score: calculateQualityScore(coverage),
    
    note: 'QA観点カバレッジ：成功テストケース数/全テストケース数 (機能×観点ベース)'
  };

  return coverage;
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
  
  const headers = ['実行日時', 'ID', 'ユーザーストーリー', '機能', '観点', 'テスト手順', resultHeader, 'エラー詳細', 'URL', '実行種別'];
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
        escapeCSVField(executionType)
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
      escapeCSVField(executionType)
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
  
  // 新しいワークフロー対応：自然言語テストケースを優先的に読み込み
  // 最新のテスト結果に対応する最新のテストケースファイルを使用
  const naturalLanguageFiles = files.filter(f => f.startsWith('naturalLanguageTestCases_')).sort().reverse();
  const testPointFiles = files.filter(f => f.startsWith('testPoints_')).sort().reverse();
  
  console.log(`📊 利用可能なファイル: 結果${resultFiles.length}件, ルート${routeFiles.length}件, 自然言語${naturalLanguageFiles.length}件, テスト観点${testPointFiles.length}件`);

  if (resultFiles.length === 0 || routeFiles.length === 0) {
    console.error('❌ 必要なファイル（結果、ルート）が見つかりません。');
    return;
  }

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
        
        // 新しいレポートからヘッダーを除いてデータ行のみ取得
        const reportLines = report.split('\n');
        const dataRows = reportLines.slice(1); // ヘッダーを除く
        
        if (existingContent) {
          // 既存ファイルに追記
          const appendContent = '\n' + dataRows.join('\n');
          await fs.promises.appendFile(outputPath, appendContent);
          console.log(`✅ 修正ルート結果を既存CSVに追記完了: ${fileName}`);
          console.log(`📋 追記されたテストケース数: ${dataRows.length}件`);
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
 * HTMLレポートを生成する（Google Sheets代替）
 * @param {Object} coverage - カバレッジデータ
 * @param {string} outputPath - 出力パス
 */
function generateCoverageHTML(coverage, outputPath) {
  const timestamp = new Date().toLocaleString('ja-JP');
  
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
        .recommendations {
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            border-radius: 8px;
            padding: 20px;
            margin-top: 20px;
        }
        .recommendations h3 {
            color: #856404;
            margin: 0 0 15px 0;
        }
        .recommendations ul {
            margin: 0;
            padding-left: 20px;
        }
        .recommendations li {
            margin-bottom: 8px;
            color: #856404;
        }
        .footer {
            text-align: center;
            padding: 20px;
            color: #666;
            font-size: 0.9em;
            background: #f8f9fa;
        }
        
        /* テストケース詳細用スタイル */
        .test-case-filters {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
            flex-wrap: wrap;
        }
        .filter-btn {
            padding: 8px 16px;
            border: 2px solid #dee2e6;
            background: white;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.9em;
            transition: all 0.2s ease;
        }
        .filter-btn:hover {
            background: #f8f9fa;
        }
        .filter-btn.active {
            background: #007bff;
            color: white;
            border-color: #007bff;
        }
        .test-cases-container {
            display: grid;
            gap: 15px;
        }
        .test-case-card {
            border: 1px solid #dee2e6;
            border-radius: 8px;
            background: white;
            overflow: hidden;
            transition: all 0.2s ease;
        }
        .test-case-card:hover {
            box-shadow: 0 4px 8px rgba(0,0,0,0.1);
        }
        .test-case-card.success {
            border-left: 4px solid #28a745;
        }
        .test-case-card.failed {
            border-left: 4px solid #dc3545;
        }
        .test-case-card.not_automated {
            border-left: 4px solid #ffc107;
        }
        .test-case-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 16px;
            background: #f8f9fa;
            border-bottom: 1px solid #dee2e6;
        }
        .test-case-id {
            font-weight: bold;
            color: #495057;
        }
        .test-case-status {
            font-size: 0.9em;
            font-weight: 600;
        }
        .status-success { color: #28a745; }
        .status-failed { color: #dc3545; }
        .status-not_automated { color: #fd7e14; }
        .test-case-content {
            padding: 16px;
        }
        .test-case-content h4 {
            margin: 0 0 10px 0;
            color: #333;
            font-size: 1.1em;
            word-wrap: break-word;
            white-space: normal;
        }

        .test-case-description {
            color: #666;
            margin-bottom: 10px;
            line-height: 1.5;
        }
        .test-case-category,
        .test-case-feasibility,
        .test-case-time {
            margin: 5px 0;
            font-size: 0.9em;
            color: #666;
        }
        .test-case-error {
            margin: 10px 0;
            padding: 8px;
            background: #f8d7da;
            border: 1px solid #f5c6cb;
            border-radius: 4px;
            color: #721c24;
            font-size: 0.9em;
        }
        .no-test-cases {
            text-align: center;
            padding: 40px;
            color: #666;
            background: #f8f9fa;
            border-radius: 8px;
        }
        .hidden {
            display: none !important;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🧪 AutoPlaywright</h1>
            <p>テストカバレッジレポート - ${timestamp}</p>
        </div>
        
        <div class="summary">
            <div class="summary-card">
                <h3>カバレッジ率</h3>
                <div class="value coverage-rate">${coverage.overall_coverage?.success_coverage?.toFixed(1) || '0.0'}</div>
                <div class="unit">%</div>
            </div>
            <div class="summary-card">
                <h3>人間対応必要</h3>
                <div class="value human-action">${coverage.human_action_required?.total_human_action_needed || 0}</div>
                <div class="unit">件</div>
            </div>
            <div class="summary-card">
                <h3>自動化率</h3>
                <div class="value automation">${coverage.automation_analysis?.automation_rate?.toFixed(1) || '0.0'}</div>
                <div class="unit">%</div>
            </div>
            <div class="summary-card">
                <h3>品質スコア</h3>
                <div class="value quality">${coverage.overall_coverage?.quality_score?.toFixed(1) || '0.0'}</div>
                <div class="unit">点</div>
            </div>
        </div>

        <div class="section">
            <h2>📊 総合カバレッジ</h2>
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${coverage.overall_coverage?.success_coverage || 0}%"></div>
            </div>
            <p><strong>${coverage.overall_coverage?.successful_test_cases || 0}</strong> / <strong>${coverage.overall_coverage?.total_test_cases || 0}</strong> テストケースが成功</p>
            <p style="color: #666; font-size: 0.9em;">（機能×観点ベースのQA観点カバレッジ）</p>
            
            <table>
                <tr>
                    <th>指標</th>
                    <th>値</th>
                    <th>備考</th>
                </tr>
                <tr>
                    <td>全テストケース数</td>
                    <td>${coverage.overall_coverage?.total_test_cases || 0}件</td>
                    <td>分母（機能×観点の総数）</td>
                </tr>
                <tr>
                    <td>成功テストケース数</td>
                    <td>${coverage.overall_coverage?.successful_test_cases || 0}件</td>
                    <td>分子（成功した機能×観点）</td>
                </tr>
                <tr>
                    <td>未自動化テストケース数</td>
                    <td>${coverage.overall_coverage?.unautomated_test_cases || 0}件</td>
                    <td>Playwright未対応のテストケース</td>
                </tr>
                <tr>
                    <td>残課題テストケース数</td>
                    <td>${coverage.overall_coverage?.remaining_test_cases || 0}件</td>
                    <td>失敗 + 未自動化の合計</td>
                </tr>
                <tr style="background: #f8f9fa;">
                    <td colspan="3"><strong>参考: ステップ単位統計</strong></td>
                </tr>
                <tr>
                    <td>　実行済みステップ数</td>
                    <td>${coverage.overall_coverage?.total_steps || 0}件</td>
                    <td>自動実行された実際のステップ数</td>
                </tr>
                <tr>
                    <td>　成功ステップ数</td>
                    <td>${coverage.overall_coverage?.successful_steps || 0}件</td>
                    <td>個別操作レベルでの成功数</td>
                </tr>
            </table>
        </div>

        <div class="section">
            <h2>🤖 自動化分析</h2>
            <table>
                <tr>
                    <th>分類</th>
                    <th>値</th>
                    <th>備考</th>
                </tr>
                <tr>
                    <td>自動化ルート数</td>
                    <td>${coverage.automation_analysis?.automated_routes || 0}件</td>
                    <td>Playwright実装生成済み</td>
                </tr>
                <tr>
                    <td>高実行可能性ルート</td>
                    <td>${coverage.automation_analysis?.feasible_routes || 0}件</td>
                    <td>実行可能性スコア ≥ 0.7</td>
                </tr>
                <tr>
                    <td>低実行可能性ルート</td>
                    <td>${coverage.automation_analysis?.low_feasibility_routes || 0}件</td>
                    <td>実行可能性スコア 0.3-0.7</td>
                </tr>
                <tr>
                    <td>未自動化テストケース</td>
                    <td>${coverage.automation_analysis?.unautomated_test_cases || 0}件</td>
                    <td>AI生成不可</td>
                </tr>
            </table>
        </div>

        <div class="section">
            <h2>🔍 実行結果分析</h2>
            <table>
                <tr>
                    <th>結果</th>
                    <th>件数</th>
                    <th>備考</th>
                </tr>
                <tr>
                    <td>成功ステップ数</td>
                    <td>${coverage.execution_analysis?.successful_steps || 0}件</td>
                    <td>個別ステップが正常完了</td>
                </tr>
                <tr>
                    <td>失敗ステップ数</td>
                    <td>${(coverage.execution_analysis?.total_steps || 0) - (coverage.execution_analysis?.successful_steps || 0)}件</td>
                    <td>個別ステップでエラー発生</td>
                </tr>
                <tr>
                    <td>ステップ成功率</td>
                    <td>${coverage.execution_analysis?.step_success_rate?.toFixed(1) || '0.0'}%</td>
                    <td>成功ステップ/全ステップ</td>
                </tr>
                <tr>
                    <td>ルート成功率</td>
                    <td>${coverage.execution_analysis?.execution_success_rate?.toFixed(1) || '0.0'}%</td>
                    <td>成功ルート/実行ルート</td>
                </tr>
            </table>
        </div>

        <div class="section">
            <h2>📋 全テストケース詳細</h2>
            <p>「成功/全ケース」の分母となるすべてのテストケースの詳細内容です。</p>
            
            ${coverage.detailed_test_cases && coverage.detailed_test_cases.length > 0 ? `
            <div class="test-case-filters">
                <button onclick="filterTestCases('all')" class="filter-btn active" id="filter-all">すべて (${coverage.detailed_test_cases.length})</button>
                <button onclick="filterTestCases('success')" class="filter-btn" id="filter-success">成功 (${coverage.detailed_test_cases.filter(tc => tc.status === 'success').length})</button>
                <button onclick="filterTestCases('failed')" class="filter-btn" id="filter-failed">失敗 (${coverage.detailed_test_cases.filter(tc => tc.status === 'failed').length})</button>
                <button onclick="filterTestCases('not_automated')" class="filter-btn" id="filter-not_automated">未自動化 (${coverage.detailed_test_cases?.filter(tc => tc.status === 'not_automated').length || 0})</button>
            </div>
            
            <div class="test-cases-container">
                ${coverage.detailed_test_cases.map((testCase, index) => `
                <div class="test-case-card ${testCase.status}" data-status="${testCase.status}">
                    <div class="test-case-header">
                        <span class="test-case-id">#${testCase.id || index + 1}</span>
                        <span class="test-case-status status-${testCase.status}">${testCase.status === 'success' ? '✅ 成功' : testCase.status === 'failed' ? '❌ 失敗' : '⚠️ 未自動化'}</span>
                    </div>
                    <div class="test-case-content">
                        <h4>${testCase.original_viewpoint || testCase.title || testCase.scenario || 'テストケース'}</h4>
                        <p class="test-case-description">${testCase.description || testCase.steps || '詳細なし'}</p>
                        ${testCase.category ? `<p class="test-case-category"><strong>分類:</strong> ${testCase.category}</p>` : ''}
                        ${testCase.feasibility_score ? `<p class="test-case-feasibility"><strong>実行可能性:</strong> ${(testCase.feasibility_score * 100).toFixed(1)}%</p>` : ''}
                        ${testCase.error_message ? `<p class="test-case-error"><strong>エラー:</strong> ${testCase.error_message}</p>` : ''}
                        ${testCase.execution_time ? `<p class="test-case-time"><strong>実行時間:</strong> ${testCase.execution_time}ms</p>` : ''}
                    </div>
                </div>
                `).join('')}
            </div>
            ` : `
            <div class="no-test-cases">
                <p>詳細なテストケース情報が利用できません。</p>
                <p>テストケースデータを生成してからレポートを再実行してください。</p>
            </div>
            `}
        </div>

        ${coverage.human_action_required?.manual_test_recommendations?.length > 0 ? `
        <div class="section">
            <div class="recommendations">
                <h3>🙋‍♂️ 人間対応が必要な項目</h3>
                <ul>
                    ${coverage.human_action_required.manual_test_recommendations.map(rec => `<li>${rec}</li>`).join('')}
                </ul>
                <p><strong>推奨アクション:</strong> これらの項目は手動テストまたはテスト設計の見直しが推奨されます。</p>
                
                ${(coverage.overall_coverage?.unautomated_test_cases || 0) > 0 ? `
                <div style="margin-top: 20px; padding: 15px; background: #e7f3ff; border: 1px solid #b3d9ff; border-radius: 8px;">
                    <h4 style="margin: 0 0 10px 0; color: #0066cc;">🚀 未自動化ケースの改善提案</h4>
                    <p style="margin: 0 0 15px 0; color: #0066cc;">未自動化の${coverage.overall_coverage?.unautomated_test_cases || 0}件のテストケース（機能×観点）から、Playwrightルートを生成してカバレッジを向上させませんか？</p>
                    <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                        <button onclick="generateRoutesForUnautomated()" style="padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold;">
                            ⚡ 未自動化ケース用ルート生成
                        </button>
                        <button onclick="refreshReport()" style="padding: 10px 20px; background: #28a745; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold;">
                            🔄 レポート更新
                        </button>
                    </div>
                </div>
                ` : ''}
            </div>
        </div>
        ` : ''}

        <div class="footer">
            <p>Generated by AutoPlaywright Test Coverage Analyzer</p>
            <p>データ生成時刻: ${coverage.timestamp}</p>
        </div>
    </div>
    
    <script>
        // テストケースフィルタリング機能
        function filterTestCases(status) {
            const cards = document.querySelectorAll('.test-case-card');
            const buttons = document.querySelectorAll('.filter-btn');
            
            // すべてのボタンのactiveクラスを削除
            buttons.forEach(btn => btn.classList.remove('active'));
            // クリックされたボタンにactiveクラスを追加
            document.getElementById('filter-' + status).classList.add('active');
            
            // カードの表示/非表示を切り替え
            cards.forEach(card => {
                if (status === 'all' || card.dataset.status === status) {
                    card.classList.remove('hidden');
                } else {
                    card.classList.add('hidden');
                }
            });
        }
        
        // 未自動化ケース用ルート生成
        async function generateRoutesForUnautomated() {
            const button = event.target;
            const originalText = button.textContent;
            button.textContent = '⏳ 生成中...';
            button.disabled = true;
            
            try {
                // 未自動化テストケースの一覧を取得
                const unautomatedCases = Array.from(document.querySelectorAll('.test-case-card.not_automated'));
                
                if (unautomatedCases.length === 0) {
                    alert('未自動化のテストケースが見つかりません。');
                    return;
                }
                
                // サーバーAPIを呼び出して未自動化ケース用のルートを生成
                const response = await fetch('/api/generate-routes-unautomated', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        action: 'generateRoutesForUnautomated',
                        unautomatedCount: unautomatedCases.length
                    })
                });
                
                if (response.ok) {
                    const result = await response.json();
                    if (result.success) {
                        alert(\`✅ 未自動化ケース用ルート生成完了！\\n生成件数: \${result.generatedCount || unautomatedCases.length}件\\n\\n「🔄 レポート更新」ボタンでカバレッジを確認してください。\`);
                    } else {
                        throw new Error(result.error || 'ルート生成に失敗しました');
                    }
                } else {
                    const errorResult = await response.json().catch(() => ({}));
                    throw new Error(errorResult.error || 'ルート生成に失敗しました');
                }
                
            } catch (error) {
                console.error('未自動化ケース用ルート生成エラー:', error);
                alert('❌ ルート生成に失敗しました。\\n\\nコンソールで詳細エラーを確認し、手動でgenerateSmartRoutes.jsを実行してください。');
            } finally {
                button.textContent = originalText;
                button.disabled = false;
            }
        }
        
        // レポート更新機能
        async function refreshReport() {
            const button = event.target;
            const originalText = button.textContent;
            button.textContent = '⏳ 更新中...';
            button.disabled = true;
            
            try {
                // サーバーAPIを呼び出してレポート再生成
                const response = await fetch('/api/refresh-report', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        action: 'refreshReport'
                    })
                });
                
                if (response.ok) {
                    const result = await response.json();
                    if (result.success) {
                        if (result.htmlReportUrl) {
                            alert('✅ レポート更新完了！\\n新しいレポートが生成されました。');
                            // 新しいレポートを開く
                            window.open(result.htmlReportUrl, '_blank');
                        } else {
                            alert('✅ レポート更新完了！\\nページをリロードします。');
                            // 現在のページをリロード
                            window.location.reload();
                        }
                    } else {
                        throw new Error(result.error || 'レポート更新に失敗しました');
                    }
                } else {
                    const errorResult = await response.json().catch(() => ({}));
                    throw new Error(errorResult.error || 'レポート更新に失敗しました');
                }
                
            } catch (error) {
                console.error('レポート更新エラー:', error);
                alert('❌ レポート更新に失敗しました。\\n\\n手動でgenerateTestReport.jsを実行してください。');
            } finally {
                button.textContent = originalText;
                button.disabled = false;
            }
        }
        
        // ページ読み込み時の初期化
        document.addEventListener('DOMContentLoaded', function() {
            console.log('AutoPlaywright テストカバレッジレポート読み込み完了');
            
            // カバレッジの詳細説明を追加
            const coverageInfo = document.querySelector('.progress-bar').parentElement;
            if (coverageInfo) {
                const detailText = document.createElement('div');
                detailText.style.cssText = 'margin-top: 10px; padding: 10px; background: #f8f9fa; border-radius: 5px; font-size: 0.9em; color: #666;';
                detailText.innerHTML = \`
                    <strong>💡 カバレッジ計算について:</strong><br>
                    • 分子: 実際に成功したステップ数<br>
                    • 分母: 実行済みステップ数 + 未自動化テストケースの推定ステップ数<br>
                    • 未自動化テストケースからPlaywrightルートを生成することで、カバレッジを向上できます
                \`;
                coverageInfo.appendChild(detailText);
            }
        });
    </script>
</body>
</html>`;

  fs.writeFileSync(outputPath, html, 'utf8');
  console.log(`�� HTMLカバレッジレポート生成完了: ${outputPath}`);
  console.log(`🌐 ブラウザで開く: file://${path.resolve(outputPath)}`);
}

