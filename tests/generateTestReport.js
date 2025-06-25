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
          url: testUrl
        });
      } else {
        // 観点にマッピングできなかった場合は追加ステップとして扱う
        const viewpointId = Math.floor(stepIndex / 5) + 1; // 5ステップごとに新しい観点
        const testCaseId = (stepIndex % 5) + 1;
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
          url: testUrl
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
  const description = testPoint.description || testPoint.viewpoint || testPoint.content || '';
  
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
    'General': 'H'
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
    'General': '基本機能'
  };
  
  return functionNameMap[functionKey] || '汎用機能';
}

function findRelatedSteps(testPoint, steps, fallbackIndex) {
  if (!steps || !Array.isArray(steps)) return [];
  
  const description = testPoint.description || testPoint.viewpoint || testPoint.content || '';
  
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
  
  const description = testPoint.description || testPoint.viewpoint || testPoint.content || '';
  
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
      const viewpoint = testPoint.description || testPoint.viewpoint || testPoint.content || `テスト観点${viewpointIndex + 1}`;
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
  // CSVヘッダー（階層的トレーサビリティ対応）
  const headers = [
    '実行日時',
    'ID', 
    'ユーザーストーリー',
    '機能',
    '観点',
    'テスト手順',
    '実行結果',
    'エラー詳細',
    'URL'
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
    const row = [
      escapeCSVField(data.executionTime),
      escapeCSVField(data.id),
      escapeCSVField(data.userStory),
      escapeCSVField(data.function || ''),
      escapeCSVField(data.viewpoint),
      escapeCSVField(data.testSteps),
      escapeCSVField(data.executionResult),
      escapeCSVField(data.errorDetail),
      escapeCSVField(data.url || '')
    ];
    csvRows.push(row.join(','));
  });
  
  console.log(`📊 CSV生成完了: ${reportData.length}行のデータ`);
  console.log(`📋 ヘッダー: ${headers.join(', ')}`);
  
  return csvRows.join('\n');
}

async function generateTestReport(testPointFormat, testPoints, route, result, userStoryInfo = null) {
  console.log('📊 トレーサブルなテストレポートを生成中...');
  
  try {
    // 新しいトレーサブルレポート形式を生成（config.jsonのユーザーストーリー情報を使用）
    const reportData = createTraceableTestReport(testPoints, route, result, userStoryInfo);
    
    if (reportData.length === 0) {
      console.log('⚠️ レポートデータが生成されませんでした');
      return generateFallbackReport(route, result, userStoryInfo);
    }
    
    const csvReport = generateTraceableCSVReport(reportData);
    
    console.log(`✅ ${reportData.length}件のテストケースを含むレポートを生成しました`);
    console.log('📋 IDトレーサビリティ: 観点生成 → シナリオ → 実行の追跡可能');
    
    return csvReport;
  } catch (error) {
    console.error('❌ トレーサブルレポート生成エラー:', error);
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

  const headers = ['実行日時', 'ID', 'ユーザーストーリー', '機能', '観点', 'テスト手順', '実行結果', 'エラー詳細', 'URL'];
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
        escapeCSVField(testUrl || '')
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
      escapeCSVField(testUrl || '')
    ];
    csvRows.push(row.join(','));
  }
  
  return csvRows.join('\n');
}

async function main() {
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
  const testPointFiles = files.filter(f => f.startsWith('testPoints_')).sort().reverse();

  if (resultFiles.length === 0 || routeFiles.length === 0 || testPointFiles.length === 0) {
    console.error('必要なファイルが見つかりません。');
    return;
  }

  const latestResult = await readJsonFile(path.join(testResultsDir, resultFiles[0]));
  const latestRoute = await readJsonFile(path.join(testResultsDir, routeFiles[0]));
  const latestTestPoints = await readJsonFile(path.join(testResultsDir, testPointFiles[0]));
  const testPointFormat = await readCsvFile(path.join(__dirname, '..', 'test_point', 'TestPoint_Format.csv'));

  if (!latestResult || !latestRoute || !latestTestPoints || !testPointFormat) {
    console.error('ファイルの読み込みに失敗しました。');
    return;
  }

  const report = await generateTestReport(testPointFormat, latestTestPoints, latestRoute, latestResult, userStoryInfo);
  
  if (report) {
    // 統一されたファイル名形式: AutoPlaywright テスト結果 - TestResults_YYYY-MM-DD_HHMM.csv
    const now = new Date();
    const timestamp = now.toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '');
    const fileName = `AutoPlaywright テスト結果 - TestResults_${timestamp}.csv`;
    const outputPath = path.join(testResultsDir, fileName);
    
    await fs.promises.writeFile(outputPath, report);
    console.log(`📊 トレーサブルテストレポートを生成しました: ${fileName}`);
    console.log(`📁 保存先: ${outputPath}`);
    
    // レポート内容のサマリーを表示
    const lines = report.split('\n');
    const testCaseCount = lines.length - 1; // ヘッダーを除く
    if (testCaseCount > 0) {
      console.log(`📋 生成されたテストケース数: ${testCaseCount}件`);
    }
  } else {
    console.error('❌ テストレポートの生成に失敗しました');
  }
}

main().catch(console.error); 