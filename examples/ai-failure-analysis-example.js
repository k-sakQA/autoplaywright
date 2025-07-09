#!/usr/bin/env node

/**
 * AI-Powered 失敗分析の使用例
 * 
 * このスクリプトは、AI を活用した失敗テスト分析機能の使用方法を示します。
 */

import { FailureAnalyzer } from '../tests/analyzeFailures.js';

async function demonstrateAIAnalysis() {
  console.log('🤖 AI-Powered 失敗分析のデモンストレーション');
  console.log('================================================\n');

  // AI 分析のオプション設定
  const options = {
    enableAI: true,  // AI 分析を有効化
    userStory: 'ユーザーがログインフォームに情報を入力し、ログインできること',
    targetUrl: 'https://example.com/login',
    autoExecute: false,  // 手動実行モード
    aiConfig: {
      model: 'gpt-4-turbo-preview',  // 使用する AI モデル
      maxTokens: 2000,
      temperature: 0.3,
      apiKey: process.env.OPENAI_API_KEY
    }
  };

  try {
    // AI 対応失敗分析器を初期化
    const analyzer = new FailureAnalyzer(options);
    
    console.log('⚙️ 設定:');
    console.log(`   AI モデル: ${options.aiConfig.model}`);
    console.log(`   API キー: ${options.aiConfig.apiKey ? '✅ 設定済み' : '❌ 未設定'}`);
    console.log(`   自動実行: ${options.autoExecute ? '有効' : '無効'}`);
    console.log(`   ユーザーストーリー: ${options.userStory}`);
    console.log();

    // 失敗テストの分析実行
    console.log('🔍 失敗テスト分析を開始...');
    const analysisResult = await analyzer.analyze();
    
    if (analysisResult) {
      console.log('\n📊 AI 分析結果:');
      console.log(`   分析済みテスト: ${analysisResult.summary?.total_analyzed || 0}件`);
      console.log(`   AI 駆動分析: ${analysisResult.summary?.ai_powered || 0}件`);
      console.log(`   修正ルート生成: ${analysisResult.summary?.fixed_routes_generated || 0}件`);
    }

  } catch (error) {
    if (error.message.includes('API key')) {
      console.error('❌ OpenAI API キーの設定が必要です');
      console.log('\n💡 設定方法:');
      console.log('   export OPENAI_API_KEY="your-api-key-here"');
      console.log('   または .env ファイルに OPENAI_API_KEY を設定');
    } else if (error.message.includes('テスト結果ファイルが見つかりません')) {
      console.error('❌ 分析対象のテスト結果がありません');
      console.log('\n💡 まず失敗したテストを実行してください:');
      console.log('   node tests/runScenarios.js');
    } else {
      console.error('❌ 分析エラー:', error.message);
    }
  }
}

// シミュレーション用の失敗テスト結果作成
async function createSampleFailedResult() {
  const sampleResult = {
    route_id: 'sample_failed_test',
    targetUrl: 'https://example.com/login',
    timestamp: new Date().toISOString(),
    total_steps: 3,
    failed_count: 1,
    execution_time: 5000,
    steps: [
      {
        label: 'ユーザー名を入力',
        action: 'fill',
        target: '[name="username"]',
        value: 'testuser',
        status: 'success'
      },
      {
        label: 'パスワードを入力',
        action: 'fill',
        target: '[name="password"]',
        value: 'testpass',
        status: 'success'
      },
      {
        label: 'ログインボタンをクリック',
        action: 'click',
        target: '#login-button',
        status: 'failed',
        error: 'Element not found: #login-button'
      }
    ]
  };

  // サンプル結果をファイルに保存
  const fs = await import('fs');
  const path = await import('path');
  
  const testResultsDir = path.join(process.cwd(), 'test-results');
  if (!fs.existsSync(testResultsDir)) {
    fs.mkdirSync(testResultsDir, { recursive: true });
  }
  
  const resultPath = path.join(testResultsDir, 'result_sample_failed_test.json');
  fs.writeFileSync(resultPath, JSON.stringify(sampleResult, null, 2));
  
  console.log(`📝 サンプル失敗テスト結果を作成: ${resultPath}`);
  return sampleResult;
}

// 使用例の実行
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('🚀 AI 失敗分析のサンプル実行\n');
  
  // API キーのチェック
  if (!process.env.OPENAI_API_KEY) {
    console.log('⚠️ OpenAI API キーが設定されていません');
    console.log('   デモ用にサンプルテスト結果を作成します...\n');
    
    // サンプル失敗テスト結果を作成
    await createSampleFailedResult();
    
    console.log('\n💡 実際の AI 分析を実行するには:');
    console.log('   1. OpenAI API キーを設定');
    console.log('   2. 以下のコマンドを実行:');
    console.log('      node tests/analyzeFailures.js --enable-ai');
  } else {
    // 実際の AI 分析を実行
    await demonstrateAIAnalysis();
  }
}

export { demonstrateAIAnalysis }; 