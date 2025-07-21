#!/usr/bin/env node

/**
 * AutoPlaywright 拡張テストレポート機能デモスクリプト
 * 
 * このスクリプトは、新しい拡張レポート機能の動作確認と
 * デモンストレーションを行います。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// デモ用テストデータ生成
function generateDemoTestData() {
  console.log('🎭 デモ用テストデータを生成中...');
  
  // デモ用ルートデータ
  const demoRoute = {
    url: "https://demo-hotel-booking.example.com",
    userStory: "ホテル予約システムのテスト - 宿泊日選択から予約完了まで",
    steps: [
      {
        action: "load",
        target: "https://demo-hotel-booking.example.com",
        label: "ホテル予約サイトにアクセス"
      },
      {
        action: "fill",
        target: "#checkin-date",
        value: "2025-02-01",
        label: "チェックイン日を入力"
      },
      {
        action: "fill",
        target: "#checkout-date", 
        value: "2025-02-03",
        label: "チェックアウト日を入力"
      },
      {
        action: "select",
        target: "#guests",
        value: "2",
        label: "宿泊人数を選択"
      },
      {
        action: "click",
        target: "#search-button",
        label: "検索ボタンをクリック"
      },
      {
        action: "click",
        target: ".hotel-card:first-child .book-button",
        label: "最初のホテルを選択"
      },
      {
        action: "fill",
        target: "#guest-name",
        value: "田中太郎",
        label: "宿泊者名を入力"
      },
      {
        action: "fill",
        target: "#guest-email",
        value: "tanaka@example.com",
        label: "メールアドレスを入力"
      },
      {
        action: "click",
        target: "#confirm-booking",
        label: "予約確定ボタンをクリック"
      }
    ],
    analysis_context: {
      target_url: "https://demo-hotel-booking.example.com",
      user_story: "ホテル予約システムのテスト",
      category: "予約機能テスト"
    }
  };
  
  // デモ用結果データ（一部失敗を含む）
  const demoResult = {
    url: "https://demo-hotel-booking.example.com",
    timestamp: new Date().toISOString(),
    duration: 45000,
    steps: [
      {
        action: "load",
        target: "https://demo-hotel-booking.example.com",
        label: "ホテル予約サイトにアクセス",
        status: "success",
        duration: 2100,
        screenshot: "screenshot_001.png"
      },
      {
        action: "fill",
        target: "#checkin-date",
        value: "2025-02-01",
        label: "チェックイン日を入力",
        status: "success",
        duration: 350,
        screenshot: "screenshot_002.png"
      },
      {
        action: "fill", 
        target: "#checkout-date",
        value: "2025-02-03",
        label: "チェックアウト日を入力",
        status: "success",
        duration: 280,
        screenshot: "screenshot_003.png"
      },
      {
        action: "select",
        target: "#guests",
        value: "2", 
        label: "宿泊人数を選択",
        status: "failed",
        duration: 5200,
        error: "Element not found: #guests",
        screenshot: "screenshot_004.png"
      },
      {
        action: "click",
        target: "#search-button",
        label: "検索ボタンをクリック",
        status: "success",
        duration: 1800,
        screenshot: "screenshot_005.png"
      },
      {
        action: "click",
        target: ".hotel-card:first-child .book-button",
        label: "最初のホテルを選択",
        status: "failed",
        duration: 8000,
        error: "Timeout: Element not visible within 5000ms",
        screenshot: "screenshot_006.png"
      },
      {
        action: "fill",
        target: "#guest-name",
        value: "田中太郎",
        label: "宿泊者名を入力",
        status: "success",
        duration: 420,
        screenshot: "screenshot_007.png"
      },
      {
        action: "fill",
        target: "#guest-email", 
        value: "tanaka@example.com",
        label: "メールアドレスを入力",
        status: "success",
        duration: 380,
        screenshot: "screenshot_008.png"
      },
      {
        action: "click",
        target: "#confirm-booking",
        label: "予約確定ボタンをクリック",
        status: "failed",
        duration: 3200,
        error: "Button disabled - validation error",
        screenshot: "screenshot_009.png"
      }
    ],
    summary: {
      totalSteps: 9,
      successfulSteps: 5,
      failedSteps: 3,
      skippedSteps: 1,
      successRate: 55.6
    }
  };
  
  // デモ用テスト観点データ
  const demoTestPoints = [
    {
      id: "TP001",
      category: "機能テスト",
      subCategory: "表示（UI）",
      detailCategory: "レイアウト/文言",
      testPerspective: "ホテル検索画面のレイアウトは適切に表示されるか？",
      businessScenario: "ホテル予約プロセス",
      priority: "high",
      expectedAction: "load"
    },
    {
      id: "TP002", 
      category: "機能テスト",
      subCategory: "入力",
      detailCategory: "データ入力",
      testPerspective: "チェックイン・チェックアウト日の入力は正常に動作するか？",
      businessScenario: "ホテル予約プロセス",
      priority: "high",
      expectedAction: "fill"
    },
    {
      id: "TP003",
      category: "機能テスト",
      subCategory: "選択",
      detailCategory: "ドロップダウン",
      testPerspective: "宿泊人数の選択は正常に動作するか？",
      businessScenario: "ホテル予約プロセス", 
      priority: "medium",
      expectedAction: "select"
    },
    {
      id: "TP004",
      category: "機能テスト",
      subCategory: "操作",
      detailCategory: "ボタン",
      testPerspective: "検索ボタンは正常に動作するか？",
      businessScenario: "ホテル予約プロセス",
      priority: "high", 
      expectedAction: "click"
    },
    {
      id: "TP005",
      category: "機能テスト",
      subCategory: "バリデーション",
      detailCategory: "入力検証",
      testPerspective: "入力値のバリデーションは適切に動作するか？",
      businessScenario: "ホテル予約プロセス",
      priority: "medium",
      expectedAction: "fill"
    }
  ];
  
  return {
    route: demoRoute,
    result: demoResult,
    testPoints: demoTestPoints,
    userStoryInfo: {
      currentId: 101,
      content: "ホテル予約システムのE2Eテスト - 一般ユーザーがホテルを検索し、選択から予約完了までの一連の流れをテストする"
    }
  };
}

// デモデータのファイル保存
async function saveDemoData(demoData) {
  const testResultsDir = path.join(process.cwd(), 'test-results');
  
  // ディレクトリ作成
  if (!fs.existsSync(testResultsDir)) {
    fs.mkdirSync(testResultsDir, { recursive: true });
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  
  // ファイル保存
  const files = {
    route: `demo_route_${timestamp}.json`,
    result: `demo_result_${timestamp}.json`, 
    testPoints: `demo_testPoints_${timestamp}.json`
  };
  
  await fs.promises.writeFile(
    path.join(testResultsDir, files.route),
    JSON.stringify(demoData.route, null, 2)
  );
  
  await fs.promises.writeFile(
    path.join(testResultsDir, files.result),
    JSON.stringify(demoData.result, null, 2)
  );
  
  await fs.promises.writeFile(
    path.join(testResultsDir, files.testPoints),
    JSON.stringify(demoData.testPoints, null, 2)
  );
  
  // config.jsonにユーザーストーリー情報を設定
  const configPath = path.join(process.cwd(), 'config.json');
  let config = {};
  
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(await fs.promises.readFile(configPath, 'utf8'));
    } catch (error) {
      console.warn('⚠️ config.json読み込みエラー:', error.message);
    }
  }
  
  config.userStory = demoData.userStoryInfo;
  
  await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2));
  
  console.log('✅ デモデータ保存完了:');
  console.log(`  📁 ルートファイル: ${files.route}`);
  console.log(`  📁 結果ファイル: ${files.result}`);
  console.log(`  📁 テスト観点: ${files.testPoints}`);
  
  return files;
}

// デモテスト観点CSVファイル作成
async function createDemoTestPointCSV(testPoints) {
  const csvContent = [
    'ID,大分類,中分類,小分類,テスト観点,ビジネスシナリオ,優先度,期待アクション',
    ...testPoints.map(tp => 
      `${tp.id},${tp.category},${tp.subCategory},${tp.detailCategory},"${tp.testPerspective}",${tp.businessScenario},${tp.priority},${tp.expectedAction}`
    )
  ].join('\n');
  
  const testPointDir = path.join(process.cwd(), 'test_point');
  if (!fs.existsSync(testPointDir)) {
    fs.mkdirSync(testPointDir, { recursive: true });
  }
  
  const csvPath = path.join(testPointDir, 'TestPoint_Format.csv');
  await fs.promises.writeFile(csvPath, csvContent, 'utf8');
  
  console.log(`✅ デモCSVファイル作成: test_point/TestPoint_Format.csv`);
}

// 拡張レポート実行
async function runEnhancedReportDemo(files) {
  console.log('\n🚀 拡張テストレポート実行...');
  
  try {
    const { spawn } = await import('child_process');
    
    return new Promise((resolve, reject) => {
      const childProcess = spawn('node', [
        'tests/generateEnhancedTestReport.js',
        '--route', files.route,
        '--result', files.result
      ], {
        cwd: process.cwd(),
        stdio: 'inherit'
      });
      
      childProcess.on('close', (code) => {
        if (code === 0) {
          resolve(code);
        } else {
          reject(new Error(`プロセスが終了コード ${code} で終了しました`));
        }
      });
      
      childProcess.on('error', (error) => {
        reject(error);
      });
    });
    
  } catch (error) {
    console.error('❌ 拡張レポート実行エラー:', error.message);
    throw error;
  }
}

// メイン実行
async function main() {
  console.log('🎪 AutoPlaywright 拡張テストレポート機能デモ');
  console.log('=' .repeat(60));
  
  try {
    // 1. デモデータ生成
    console.log('\n📊 Step 1: デモデータ生成');
    const demoData = generateDemoTestData();
    
    // 2. ファイル保存
    console.log('\n💾 Step 2: デモファイル保存');
    const files = await saveDemoData(demoData);
    
    // 3. テスト観点CSV作成
    console.log('\n📝 Step 3: テスト観点CSV作成');
    await createDemoTestPointCSV(demoData.testPoints);
    
    // 4. 拡張レポート実行
    console.log('\n🚀 Step 4: 拡張レポート生成');
    await runEnhancedReportDemo(files);
    
    console.log('\n🎉 デモ完了！');
    console.log('=' .repeat(60));
    console.log('\n📋 生成されたファイルを確認してください:');
    console.log('  📊 CSV: AutoPlaywright 拡張テスト結果 - Enhanced_*.csv');
    console.log('  🎨 HTML: AutoPlaywright_Enhanced_Report_*.html');
    console.log('  📈 メタデータ: enhanced_report_metadata_*.json');
    
    console.log('\n🌐 HTMLレポートをブラウザで開いて、新機能を確認してください！');
    
  } catch (error) {
    console.error('\n❌ デモ実行エラー:', error);
    console.error('スタックトレース:', error.stack);
    process.exit(1);
  }
}

// デモ実行
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { generateDemoTestData, saveDemoData, createDemoTestPointCSV }; 