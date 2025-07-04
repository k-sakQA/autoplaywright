const fs = require('fs');
const path = require('path');

// テスト用の失敗データ
const testFailedSteps = [
  {
    label: "原因失敗ステップ",
    action: "fill",
    target: "[name='test']",
    value: "test value",
    error: "Element not found",
    error_category: "element_issue",
    route_id: "test_route_1",
    timestamp: "2025-07-04T05:00:00"
  },
  {
    label: "連鎖失敗ステップ1", 
    action: "click",
    target: "[name='submit']",
    error: "Cannot click - previous step failed",
    error_category: "assertion_failure",
    route_id: "test_route_1",
    timestamp: "2025-07-04T05:01:00"
  },
  {
    label: "連鎖失敗ステップ2",
    action: "waitForURL", 
    target: "/success",
    error: "URL not reached",
    error_category: "navigation_issue",
    route_id: "test_route_1", 
    timestamp: "2025-07-04T05:02:00"
  }
];

// generateTestReport.jsから必要な関数をインポート
function analyzeFailureChains(failedSteps) {
  const chains = [];
  const processed = new Set();
  
  for (let i = 0; i < failedSteps.length; i++) {
    if (processed.has(i)) continue;
    
    const rootFailure = failedSteps[i];
    const cascadedFailures = [];
    
    // この失敗が他の失敗の原因となっているかをチェック
    for (let j = i + 1; j < failedSteps.length; j++) {
      if (processed.has(j)) continue;
      
      const laterFailure = failedSteps[j];
      if (isPotentiallyCascaded(rootFailure, laterFailure)) {
        cascadedFailures.push(laterFailure);
        processed.add(j);
      }
    }
    
    chains.push({
      rootFailure,
      cascadedFailures,
      impact: cascadedFailures.length > 0 ? 'cascading' : 'direct'
    });
    
    processed.add(i);
  }
  
  return chains;
}

function categorizeFailureType(step) {
  const error = step.error?.toLowerCase() || '';
  
  if (error.includes('not found') || error.includes('not visible') || 
      error.includes('not attached') || error.includes('not an')) {
    return 'element_issue';
  }
  
  if (error.includes('timeout') || error.includes('navigation') || 
      error.includes('url') || error.includes('page')) {
    return 'navigation_issue';
  }
  
  if (error.includes('expected') || error.includes('assertion') || 
      error.includes('should') || error.includes('to be')) {
    return 'assertion_failure';
  }
  
  return 'unknown_error';
}

function isPotentiallyCascaded(rootFailure, laterFailure) {
  const rootType = categorizeFailureType(rootFailure);
  const laterType = categorizeFailureType(laterFailure);
  
  // ナビゲーション失敗 → アサーション失敗
  if (rootType === 'navigation_issue' && laterType === 'assertion_failure') {
    return true;
  }
  
  // 要素問題 → アサーション失敗
  if (rootType === 'element_issue' && laterType === 'assertion_failure') {
    return true;
  }
  
  // 同じルートで時系列順に発生した失敗
  if (rootFailure.route_id === laterFailure.route_id) {
    const rootTime = new Date(rootFailure.timestamp);
    const laterTime = new Date(laterFailure.timestamp);
    return laterTime > rootTime;
  }
  
  return false;
}

function renderFailureStep(step, index, type) {
  const stepNumber = type === 'root' ? '🚨' : `└ ${index}`;
  return `
            <div class="failed-step-card ${type}">
                <div class="failed-step-header">
                    <span class="step-number">${stepNumber}</span>
                    <span class="step-label">${step.label}</span>
                    <span class="step-status failed">❌ 失敗</span>
                </div>
                <div class="failed-step-content">
                    <div class="step-details">
                        <p><strong>アクション:</strong> ${step.action}</p>
                        <p><strong>ターゲット:</strong> <code>${step.target}</code></p>
                        ${step.value ? `<p><strong>値:</strong> ${step.value}</p>` : ''}
                    </div>
                    <div class="error-details">
                        <h4>エラー詳細</h4>
                        <div class="error-message">${step.error}</div>
                        <p class="error-category"><strong>エラー分類:</strong> ${categorizeFailureType(step)}</p>
                    </div>
                </div>
            </div>`;
}

// テスト実行
console.log('🧪 連鎖失敗テスト開始');
console.log('📊 テストデータ:', testFailedSteps.length, '件の失敗ステップ');

// 1. 連鎖分析テスト
console.log('\n1️⃣ 連鎖分析テスト');
const failureChains = analyzeFailureChains(testFailedSteps);
console.log('📊 検出された連鎖数:', failureChains.length);

failureChains.forEach((chain, index) => {
  console.log(`🔗 連鎖 ${index}:`);
  console.log(`  - 影響: ${chain.impact}`);
  console.log(`  - 原因失敗: ${chain.rootFailure.label}`);
  console.log(`  - 連鎖失敗数: ${chain.cascadedFailures.length}`);
  if (chain.cascadedFailures.length > 0) {
    chain.cascadedFailures.forEach((cascaded, i) => {
      console.log(`    ${i + 1}. ${cascaded.label}`);
    });
  }
});

// 2. HTML生成テスト
console.log('\n2️⃣ HTML生成テスト');
const chainHTML = failureChains.map((chain, chainIndex) => {
  console.log(`\n🔄 連鎖 ${chainIndex} HTML生成中...`);
  
  let rootStepHTML = '';
  let cascadedStepsHTML = '';
  
  try {
    rootStepHTML = renderFailureStep(chain.rootFailure, 0, 'root');
    console.log(`✅ rootStepHTML生成成功 (${rootStepHTML.length}文字)`);
  } catch (error) {
    console.error(`❌ rootStepHTML生成エラー:`, error);
    return '';
  }
  
  try {
    cascadedStepsHTML = chain.cascadedFailures.map((cascadedStep, index) => {
      const stepHTML = renderFailureStep(cascadedStep, index + 1, 'cascaded');
      console.log(`✅ cascadedStep ${index} HTML生成成功 (${stepHTML.length}文字)`);
      return stepHTML;
    }).join('');
    console.log(`📊 cascadedStepsHTML合計長さ: ${cascadedStepsHTML.length}文字`);
  } catch (error) {
    console.error(`❌ cascadedStepsHTML生成エラー:`, error);
    cascadedStepsHTML = '';
  }
  
  const chainHTML = `
        <div class="failure-chain ${chain.impact === 'cascading' ? 'has-cascade' : 'single-failure'}">
            <div class="chain-header-simple">
                <span class="chain-icon">${chain.impact === 'cascading' ? '🔗' : '⚠️'}</span>
                <span class="chain-title">
                    ${chain.impact === 'cascading' ? 
                      `原因失敗 → ${chain.cascadedFailures.length}件の連鎖失敗` : 
                      '単独失敗'}
                </span>
            </div>
            <div class="chain-content-always-visible">
                <div style="background: #ffeb3b; padding: 10px; margin: 10px 0; border-radius: 5px;">
                    <strong>🧪 テスト:</strong> 連鎖 ${chainIndex} - rootHTML=${rootStepHTML.length}文字, cascadedHTML=${cascadedStepsHTML.length}文字
                </div>
                ${rootStepHTML}
                ${chain.impact === 'cascading' ? `<div style="background: #2196f3; color: white; padding: 10px; margin: 10px 0; border-radius: 5px;"><strong>🔍 連鎖失敗 ${chain.cascadedFailures.length}件が以下に表示されます</strong></div>` : ''}
                ${cascadedStepsHTML}
                ${chain.impact === 'cascading' ? `<div style="background: #4caf50; color: white; padding: 10px; margin: 10px 0; border-radius: 5px;"><strong>✅ 連鎖失敗表示完了</strong></div>` : ''}
            </div>
        </div>`;
  
  console.log(`📊 連鎖 ${chainIndex} 最終HTML長さ: ${chainHTML.length}文字`);
  return chainHTML;
}).join('');

console.log(`\n📊 全体HTML長さ: ${chainHTML.length}文字`);

// 3. テスト用HTMLファイル生成
console.log('\n3️⃣ テスト用HTMLファイル生成');
const testHTML = `
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>連鎖失敗テスト</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .failure-chain { margin: 20px 0; border: 2px solid #000; background: white; border-radius: 8px; }
        .chain-header-simple { padding: 15px; background: #2196f3; color: white; font-weight: bold; }
        .chain-content-always-visible { padding: 15px; }
        .failed-step-card { margin: 10px 0; border: 1px solid #ddd; border-radius: 5px; background: white; }
        .failed-step-card.root { border-left: 4px solid #f44336; }
        .failed-step-card.cascaded { border-left: 4px solid #ff9800; }
        .failed-step-header { padding: 10px; background: #f8f9fa; display: flex; justify-content: space-between; align-items: center; }
        .failed-step-content { padding: 15px; }
        .step-details { margin-bottom: 10px; }
        .error-details { margin-top: 10px; padding: 10px; background: #ffebee; border-radius: 4px; }
        .error-message { font-family: monospace; background: #fff; padding: 5px; border-radius: 3px; }
    </style>
</head>
<body>
    <h1>🧪 連鎖失敗テスト</h1>
    <p><strong>目的:</strong> 連鎖失敗のHTMLが正しく生成されるかを確認</p>
    
    <div class="section">
        <h2>❌ 失敗ステップ詳細（テスト版）</h2>
        <div class="failure-chains-container">
            ${chainHTML}
        </div>
    </div>
    
    <div style="margin-top: 30px; padding: 20px; background: #e8f5e8; border-radius: 8px;">
        <h3>✅ テスト結果確認ポイント</h3>
        <ul>
            <li>🟡 黄色いテストボックスが表示されている</li>
            <li>🔵 青い「連鎖失敗が以下に表示されます」ボックスが表示されている</li>
            <li>🟢 緑色の「連鎖失敗表示完了」ボックスが表示されている</li>
            <li>📋 連鎖失敗のステップカード（オレンジの左ボーダー）が表示されている</li>
        </ul>
    </div>
</body>
</html>
`;

const testOutputPath = path.join(__dirname, 'test-results', 'test_failure_chains_debug.html');
fs.writeFileSync(testOutputPath, testHTML);
console.log(`✅ テスト用HTMLファイル生成完了: ${testOutputPath}`);

console.log('\n🎯 テスト完了! ブラウザで以下のファイルを開いてください:');
console.log(`file://${testOutputPath}`); 