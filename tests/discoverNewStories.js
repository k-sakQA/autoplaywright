#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import OpenAI from 'openai';

/**
 * テスト結果から新しいユーザーストーリーを発見・生成
 */
class StoryDiscoverer {
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
    const files = fs.readdirSync(testResultsDir)
      .filter(file => file.startsWith('result_') && file.endsWith('.json'))
      .sort()
      .reverse();

    if (files.length === 0) {
      throw new Error('テスト結果ファイルが見つかりません');
    }

    const latestFile = files[0];
    const filePath = path.join(testResultsDir, latestFile);
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
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
   * AIを使って新しいユーザーストーリーを生成
   */
  async generateNewUserStories(testResult, pageAnalysis, currentUserStory) {
    const prompt = `
あなたは経験豊富なQAエンジニアです。以下の情報を基に、新しいユーザーストーリーとテストシナリオを提案してください。

## 現在のユーザーストーリー
${currentUserStory}

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
以下の形式で3つの新しいユーザーストーリーを提案してください：

1. **エラーケーステスト**: 失敗したテストから派生する境界値・異常系テスト
2. **代替フローテスト**: 成功したパスから派生する別のユーザー行動パターン
3. **統合テスト**: 発見されたページ要素を使った新しい機能テスト

各ストーリーは以下の形式で：
---
**ストーリー**: [ユーザーストーリー]
**シナリオ**: [テストシナリオ説明]
**観点**: [主要なテスト観点]
**推奨URL**: [テスト対象URL]
**優先度**: [高/中/低]
---
`;

    try {
      const response = await this.openai.chat.completions.create({
        model: this.config.openai.model,
        messages: [
          {
            role: "system",
            content: "あなたは経験豊富なQAエンジニアです。テスト結果を分析して新しいユーザーストーリーを提案します。"
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
   * 新しいユーザーストーリーを構造化
   */
  parseGeneratedStories(aiResponse) {
    const stories = [];
    const storyBlocks = aiResponse.split('---').filter(block => block.trim());

    storyBlocks.forEach(block => {
      const lines = block.split('\n').filter(line => line.trim());
      const story = {};

      lines.forEach(line => {
        const match = line.match(/\*\*(.+?)\*\*:\s*(.+)/);
        if (match) {
          const key = match[1].toLowerCase().replace(/\s+/g, '_');
          story[key] = match[2].trim();
        }
      });

      if (story.ストーリー || story.story) {
        stories.push({
          story: story.ストーリー || story.story,
          route: story.ルート || story.route,
          priority: story.優先度 || story.priority || '中',
          testPoints: story.テスト観点 || story.test_points,
          recommendedUrl: story.推奨url || story.recommended_url,
          generatedAt: new Date().toISOString()
        });
      }
    });

    return stories;
  }

  /**
   * 発見された新しいストーリーを保存
   */
  saveDiscoveredStories(stories, testResult) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `discovered_stories_${timestamp}.json`;
    const filepath = path.join(process.cwd(), 'test-results', filename);

    const discoveryReport = {
      timestamp: new Date().toISOString(),
      basedOnTestResult: testResult.route_id,
      originalUserStory: this.config.userStory?.content || 'Unknown',
      discoveredStories: stories,
      summary: {
        totalStoriesGenerated: stories.length,
        highPriorityStories: stories.filter(s => s.priority === '高').length,
        mediumPriorityStories: stories.filter(s => s.priority === '中').length,
        lowPriorityStories: stories.filter(s => s.priority === '低').length
      }
    };

    fs.writeFileSync(filepath, JSON.stringify(discoveryReport, null, 2));
    return filepath;
  }

  /**
   * インタラクティブな選択UI
   */
  async promptUserForStorySelection(stories) {
    console.log('\n📋 発見された新しいユーザーストーリー:');
    stories.forEach((story, index) => {
      console.log(`\n${index + 1}. [${story.priority}] ${story.story}`);
      console.log(`   ルート: ${story.route}`);
      console.log(`   テスト観点: ${story.testPoints}`);
      if (story.recommendedUrl) {
        console.log(`   推奨URL: ${story.recommendedUrl}`);
      }
    });

    console.log('\n🤖 次のアクションを選択してください:');
    console.log('1. 高優先度のストーリーを自動実行');
    console.log('2. 特定のストーリーを選択して実行');
    console.log('3. 新しいURLの入力を求める');
    console.log('4. 保存のみ（後で手動実行）');

    // 実際の実装では readline-sync等を使用
    return {
      action: 'save_only', // デフォルトは保存のみ
      selectedStoryIndex: -1
    };
  }

  /**
   * メイン発見処理
   */
  async discover() {
    try {
      console.log('🔍 新しいユーザーストーリーの発見を開始します...');

      // 最新のテスト結果を取得
      const testResult = this.getLatestTestResult();
      console.log(`📊 ベースとなるテスト結果: ${testResult.route_id}`);

      // 成功したパスを分析
      const pathAnalysis = this.analyzeSuccessfulPaths(testResult);
      console.log(`✅ 成功したステップ: ${pathAnalysis.totalSuccessful}/${testResult.total_steps}`);

      await this.init();

      // ページ構造を解析
      const pageAnalysis = await this.discoverNewPaths(this.config.targetUrl);
      console.log(`🔍 ページ解析完了: ${pageAnalysis?.links.length}個のリンク, ${pageAnalysis?.forms.length}個のフォーム`);

      // AIで新しいユーザーストーリーを生成
      console.log('🤖 AIによる新しいユーザーストーリー生成中...');
      const aiResponse = await this.generateNewUserStories(
        testResult,
        pageAnalysis,
        this.config.userStory?.content || 'Unknown'
      );

      if (!aiResponse) {
        throw new Error('AIによるストーリー生成に失敗しました');
      }

      // 生成されたストーリーを構造化
      const discoveredStories = this.parseGeneratedStories(aiResponse);
      console.log(`📝 ${discoveredStories.length}個の新しいユーザーストーリーを発見しました`);

      // ストーリーを保存
      const savedFilePath = this.saveDiscoveredStories(discoveredStories, testResult);
      console.log(`💾 発見されたストーリーを保存しました: ${savedFilePath}`);

      // ユーザーに選択を促す
      const userChoice = await this.promptUserForStorySelection(discoveredStories);

      console.log('\n🎉 ストーリー発見処理が完了しました！');
      console.log(`📁 詳細は以下のファイルを確認してください: ${savedFilePath}`);

      // 次のステップの提案
      console.log('\n🚀 次のステップ:');
      console.log('1. 発見されたストーリーを確認してUIで新しいテストを実行');
      console.log('2. 推奨URLがある場合は、そのURLでテストを実行');
      console.log('3. 高優先度のストーリーから順番にテスト実行');

      return {
        discoveredStories,
        savedFilePath,
        userChoice
      };

    } catch (error) {
      console.error('❌ ストーリー発見エラー:', error.message);
      throw error;
    } finally {
      await this.close();
    }
  }
}

// CLI実行
if (import.meta.url === `file://${process.argv[1]}`) {
  const discoverer = new StoryDiscoverer();
  
  discoverer.discover()
    .then((result) => {
      console.log('✅ ストーリー発見が完了しました');
      console.log(`📊 発見されたストーリー数: ${result.discoveredStories.length}`);
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ ストーリー発見エラー:', error);
      process.exit(1);
    });
}

export { StoryDiscoverer }; 