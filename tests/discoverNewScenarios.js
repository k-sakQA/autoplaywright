#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import OpenAI from 'openai';

/**
 * テスト結果から新しいユーザーシナリオを発見・生成
 */
class ScenarioDiscoverer {
  constructor() {
    this.browser = null;
    this.page = null;
    this.openai = null;
    this.config = this.loadConfig();
  }

  loadConfig() {
    const configPath = path.join(process.cwd(), 'config.json');
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }

  async init() {
    this.browser = await chromium.launch({ headless: false });
    this.page = await this.browser.newPage();
    
    // OpenAI初期化
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  /**
   * 最新のテスト結果を取得
   */
  getLatestTestResult() {
    const testResultsDir = path.join(process.cwd(), 'test-results');
    
    if (!fs.existsSync(testResultsDir)) {
      throw new Error(`テスト結果ディレクトリが見つかりません: ${testResultsDir}`);
    }
    
    // バッチ結果ファイルを検索
    const batchFiles = fs.readdirSync(testResultsDir)
      .filter(file => file.startsWith('batch_result_') && file.endsWith('.json'))
      .sort()
      .reverse();

    if (batchFiles.length === 0) {
      throw new Error('バッチ結果ファイル（batch_result_*.json）が見つかりません');
    }

    // 最新のバッチ結果ファイルを使用
    const latestFile = batchFiles[0];
    const filePath = path.join(testResultsDir, latestFile);
    const batchResult = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    
    console.log(`📊 バッチ結果ファイルを検出: ${latestFile}`);
    
    // バッチ結果を正規化
    return this.normalizeBatchResult(batchResult);
  }

  /**
   * バッチ結果を標準形式に正規化
   */
  normalizeBatchResult(batchResult) {
    const normalizedResult = {
      test_id: batchResult.batch_id,
      executed_at: batchResult.executed_at,
      total_execution_time: batchResult.total_execution_time,
      total_steps: 0,
      success_count: 0,
      failed_count: 0,
      steps: []
    };

    // 各ルートの結果をマージ
    if (batchResult.results && Array.isArray(batchResult.results)) {
      batchResult.results.forEach((route, routeIndex) => {
        if (route.step_results && Array.isArray(route.step_results)) {
          route.step_results.forEach((step, stepIndex) => {
            const normalizedStep = {
              id: `${route.route_id || routeIndex}_${stepIndex}`,
              label: step.label || `ステップ ${stepIndex + 1}`,
              action: step.action || 'unknown',
              target: step.target || null,
              value: step.value || null,
              status: step.status,
              execution_time: step.execution_time || 0,
              error: step.error || null,
              route_id: route.route_id,
              category: route.category || 'unknown',
              test_case_id: route.test_case_id
            };
            
            normalizedResult.steps.push(normalizedStep);
            normalizedResult.total_steps++;
            
            if (step.status === 'success') {
              normalizedResult.success_count++;
            } else if (step.status === 'failed') {
              normalizedResult.failed_count++;
            }
          });
        }
      });
    }

    console.log(`📊 バッチ結果正規化完了: 総ステップ数: ${normalizedResult.total_steps}, 成功: ${normalizedResult.success_count}, 失敗: ${normalizedResult.failed_count}`);
    
    return normalizedResult;
  }

  /**
   * 成功したテストパスを分析
   */
  analyzeSuccessfulPaths(testResult) {
    const successfulSteps = testResult.steps.filter(step => step.status === 'success');
    
    // 画面遷移を検出
    const navigationSteps = successfulSteps.filter(step => 
      step.action === 'waitForURL' || step.action === 'load'
    );

    // 入力可能フィールドを検出
    const inputSteps = successfulSteps.filter(step => 
      step.action === 'fill' || step.action === 'click'
    );

    // 検証ステップを検出
    const assertionSteps = successfulSteps.filter(step => 
      step.action === 'assertVisible' || step.action === 'assertText'
    );

    return {
      navigationSteps,
      inputSteps,
      assertionSteps,
      totalSuccessful: successfulSteps.length
    };
  }

  /**
   * ページ構造を解析して新しいテストパスを発見
   */
  async discoverNewPaths(url) {
    try {
      await this.page.goto(url);
      await this.page.waitForTimeout(3000);

      // ページ内の要素を解析
      const pageAnalysis = await this.page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href]')).map(a => ({
          href: a.href,
          text: a.textContent.trim(),
          visible: a.offsetParent !== null
        })).filter(link => link.visible && link.text);

        const forms = Array.from(document.querySelectorAll('form')).map(form => ({
          action: form.action,
          method: form.method,
          inputs: Array.from(form.querySelectorAll('input, select, textarea')).map(input => ({
            name: input.name,
            type: input.type,
            placeholder: input.placeholder,
            required: input.required,
            visible: input.offsetParent !== null
          })).filter(input => input.visible)
        }));

        const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"]')).map(btn => ({
          text: btn.textContent.trim() || btn.value,
          type: btn.type,
          visible: btn.offsetParent !== null
        })).filter(btn => btn.visible && btn.text);

        const headings = Array.from(document.querySelectorAll('h1, h2, h3')).map(h => ({
          level: h.tagName,
          text: h.textContent.trim()
        })).filter(h => h.text);

        return {
          title: document.title,
          url: window.location.href,
          links,
          forms,
          buttons,
          headings
        };
      });

      return pageAnalysis;
    } catch (error) {
      console.error(`ページ解析エラー: ${error.message}`);
      return null;
    }
  }

  /**
   * AIを使って新しいユーザーシナリオを生成
   */
  async generateNewUserScenarios(testResult, pageAnalysis, currentUserScenario) {
    const prompt = `
あなたは経験豊富なQAエンジニアです。以下の情報を基に、新しいユーザーシナリオとテストシナリオを提案してください。

## 現在のユーザーシナリオ
${currentUserScenario}

## テスト対象URL
${this.config.targetUrl}

## テスト実行結果
- 総ステップ数: ${testResult.total_steps}
- 成功数: ${testResult.success_count}
- 失敗数: ${testResult.failed_count}

## 成功したテストステップ
${testResult.steps.filter(s => s.status === 'success').map(s => `- ${s.label} (${s.action}: ${s.target})`).join('\n')}

## 失敗したテストステップ
${testResult.steps.filter(s => s.status === 'failed').map(s => `- ${s.label}: ${s.error}`).join('\n')}

## ページ構造分析
- ページタイトル: ${pageAnalysis?.title}
- 利用可能なリンク: ${pageAnalysis?.links.map(l => l.text).join(', ')}
- フォーム要素: ${pageAnalysis?.forms.map(f => f.inputs.map(i => i.name).join(', ')).join(' | ')}
- ボタン: ${pageAnalysis?.buttons.map(b => b.text).join(', ')}

## 要求
以下の形式で3つの新しいユーザーシナリオを提案してください：

1. **エラーケーステスト**: 失敗したテストから派生する境界値・異常系テスト
2. **代替フローテスト**: 成功したパスから派生する別のユーザー行動パターン
3. **統合テスト**: 発見されたページ要素を使った新しい機能テスト

各ストーリーは以下の形式で：
---
**ストーリー**: [ユーザーシナリオ]
**シナリオ**: [テストシナリオ説明]
**観点**: [主要なテスト観点]
**推奨URL**: ${this.config.targetUrl}
**優先度**: [高/中/低]
---
`;

    try {
      const response = await this.openai.chat.completions.create({
        model: this.config.openai.model,
        messages: [
          {
            role: "system",
            content: "あなたは経験豊富なQAエンジニアです。テスト結果を分析して新しいユーザーシナリオを提案します。"
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: this.config.openai.temperature,
        max_tokens: this.config.openai.max_tokens,
      });

      return response.choices[0].message.content;
    } catch (error) {
      console.error('AI生成エラー:', error.message);
      return null;
    }
  }

  /**
   * 新しいユーザーシナリオを構造化
   */
  parseGeneratedScenarios(aiResponse) {
    const scenarios = [];
    const scenarioBlocks = aiResponse.split('---').filter(block => block.trim());

    scenarioBlocks.forEach(block => {
      const lines = block.split('\n').filter(line => line.trim());
      const scenario = {};

      lines.forEach(line => {
        const match = line.match(/\*\*(.+?)\*\*:\s*(.+)/);
        if (match) {
          const key = match[1].toLowerCase().replace(/\s+/g, '_');
          scenario[key] = match[2].trim();
        }
      });

      if (scenario.ストーリー || scenario.story) {
        // 推奨URLがプレースホルダーの場合、実際のURLに置き換え
        let recommendedUrl = scenario.推奨url || scenario.recommended_url;
        if (!recommendedUrl || recommendedUrl.includes('[') || recommendedUrl.includes('テスト対象URL')) {
          recommendedUrl = this.config.targetUrl;
        }

        scenarios.push({
          story: scenario.ストーリー || scenario.story,
          route: scenario.ルート || scenario.route,
          priority: scenario.優先度 || scenario.priority || '中',
          testPoints: scenario.テスト観点 || scenario.test_points,
          recommendedUrl: recommendedUrl,
          generatedAt: new Date().toISOString()
        });
      }
    });

    return scenarios;
  }

  /**
   * 発見された新しいシナリオを保存
   */
  saveDiscoveredScenarios(scenarios, testResult) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `discovered_scenarios_${timestamp}.json`;
    const filepath = path.join(process.cwd(), 'test-results', filename);

    const discoveryReport = {
      timestamp: new Date().toISOString(),
      basedOnTestResult: testResult.test_id,
      originalUserScenario: this.config.userScenario?.content || 'Unknown',
      discoveredScenarios: scenarios,
      summary: {
        totalScenariosGenerated: scenarios.length,
        highPriorityScenarios: scenarios.filter(s => s.priority === '高').length,
        mediumPriorityScenarios: scenarios.filter(s => s.priority === '中').length,
        lowPriorityScenarios: scenarios.filter(s => s.priority === '低').length
      }
    };

    fs.writeFileSync(filepath, JSON.stringify(discoveryReport, null, 2));
    return filepath;
  }

  /**
   * インタラクティブな選択UI
   */
  async promptUserForScenarioSelection(scenarios) {
    console.log('\n📋 発見された新しいユーザーシナリオ:');
    scenarios.forEach((scenario, index) => {
      console.log(`\n${index + 1}. [${scenario.priority}] ${scenario.story}`);
      console.log(`   ルート: ${scenario.route}`);
      console.log(`   テスト観点: ${scenario.testPoints}`);
      if (scenario.recommendedUrl) {
        console.log(`   推奨URL: ${scenario.recommendedUrl}`);
      }
    });

    console.log('\n🤖 次のアクションを選択してください:');
    console.log('1. 高優先度のシナリオを自動実行');
    console.log('2. 特定のシナリオを選択して実行');
    console.log('3. 新しいURLの入力を求める');
    console.log('4. 保存のみ（後で手動実行）');

    // 実際の実装では readline-sync等を使用
    return {
      action: 'save_only', // デフォルトは保存のみ
      selectedScenarioIndex: -1
    };
  }

  /**
   * メイン発見処理
   */
  async discover() {
    try {
      console.log('🔍 新しいユーザーシナリオの発見を開始します...');

      // 最新のテスト結果を取得
      const testResult = this.getLatestTestResult();
      console.log(`📊 ベースとなるテスト結果: ${testResult.test_id}`);

      // 成功したパスを分析
      const pathAnalysis = this.analyzeSuccessfulPaths(testResult);
      console.log(`✅ 成功したステップ: ${pathAnalysis.totalSuccessful}/${testResult.total_steps}`);

      await this.init();

      // ページ構造を解析
      const pageAnalysis = await this.discoverNewPaths(this.config.targetUrl);
      console.log(`🔍 ページ解析完了: ${pageAnalysis?.links.length}個のリンク, ${pageAnalysis?.forms.length}個のフォーム`);

      // AIで新しいユーザーシナリオを生成
      console.log('🤖 AIによる新しいユーザーシナリオ生成中...');
      const aiResponse = await this.generateNewUserScenarios(
        testResult,
        pageAnalysis,
        this.config.userScenario?.content || 'Unknown'
      );

      if (!aiResponse) {
        throw new Error('AIによるシナリオ生成に失敗しました');
      }

      // 生成されたシナリオを構造化
      const discoveredScenarios = this.parseGeneratedScenarios(aiResponse);
      console.log(`📝 ${discoveredScenarios.length}個の新しいユーザーシナリオを発見しました`);

      // シナリオを保存
      const savedFilePath = this.saveDiscoveredScenarios(discoveredScenarios, testResult);
      console.log(`💾 発見されたシナリオを保存しました: ${savedFilePath}`);

      // ユーザーに選択を促す
      const userChoice = await this.promptUserForScenarioSelection(discoveredScenarios);

      console.log('\n🎉 シナリオ発見処理が完了しました！');
      console.log(`📁 詳細は以下のファイルを確認してください: ${savedFilePath}`);

      // 次のステップの提案
      console.log('\n🚀 次のステップ:');
      console.log('1. 発見されたシナリオを確認してUIで新しいテストを実行');
      console.log('2. 推奨URLがある場合は、そのURLでテストを実行');
      console.log('3. 高優先度のシナリオから順番にテスト実行');

      return {
        discoveredScenarios,
        savedFilePath,
        userChoice
      };

    } catch (error) {
      console.error('❌ シナリオ発見エラー:', error.message);
      throw error;
    } finally {
      await this.close();
    }
  }
}

// CLI実行
if (import.meta.url === `file://${process.argv[1]}`) {
  const discoverer = new ScenarioDiscoverer();
  
  discoverer.discover()
    .then((result) => {
      console.log('✅ シナリオ発見が完了しました');
      console.log(`📊 発見されたシナリオ数: ${result.discoveredScenarios.length}`);
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ シナリオ発見エラー:', error);
      process.exit(1);
    });
}

export { ScenarioDiscoverer }; 