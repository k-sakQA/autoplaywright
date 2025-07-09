#!/usr/bin/env node

/**
 * テスト観点を自然言語のテストケースに変換する中間処理ファイル
 * generateTestPoints.js の出力JSONを受け取り、理解しやすい自然言語テストケースを生成
 * 後続のgenerateSmartScenarios.jsでDOM解析と組み合わせてPlaywright実装に変換される
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class NaturalLanguageTestCaseGenerator {
  constructor() {
    this.outputDir = path.join(__dirname, '../test-results');
    this.config = null;
    this.openai = null;
    this.userStory = null;
    this.targetUrl = null;
    this.pdfSpecContent = null;
    // DOM解析結果を事前読み込み
    this.domInfo = null;
  }

  /**
   * 設定情報を読み込む
   */
  loadConfig() {
    try {
      const configPath = path.join(__dirname, '../config.json');
      if (fs.existsSync(configPath)) {
        this.config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        console.log('📋 設定ファイルを読み込みました');
        
        // OpenAI設定
        const apiKey = process.env[this.config.openai.apiKeyEnv];
        if (apiKey) {
          this.openai = new OpenAI({
            apiKey,
            timeout: this.config.openai.timeout || 60000,
            maxRetries: this.config.openai.maxRetries || 3
          });
          console.log('🤖 OpenAI APIクライアントを初期化しました');
        } else {
          console.warn('⚠️ OpenAI APIキーが設定されていません');
        }
      }
    } catch (error) {
      console.warn('⚠️ 設定ファイルの読み込みに失敗:', error.message);
    }
  }

  /**
   * AIを使って観点から具体的なテストケースを生成
   * @param {string} viewpoint - テスト観点
   * @param {string} category - カテゴリ
   * @param {Object} baseCase - 基本テストケース構造
   * @returns {Object} AI生成されたテストケース
   */
  async generateTestCaseWithAI(viewpoint, category, baseCase) {
    if (!this.openai) {
      console.log('⚠️ OpenAI APIが利用できません。フォールバックします。');
      return null;
    }

    try {
      console.log(`🤖 AI生成中: ${category} - ${viewpoint.substring(0, 50)}...`);
      
      const systemPrompt = `あなたはE2Eテストの専門家です。与えられたテスト観点から、具体的で実行可能な自然言語テストケースを生成してください。

重要: ユーザーストーリーで指定された具体的なデータを必ず使用してください。勝手にデータを変更しないでください。

以下の形式でJSONを返してください：
{
  "test_scenarios": ["具体的なテスト手順1", "具体的なテスト手順2", ...],
  "expected_results": ["期待する結果1", "期待する結果2", ...],
  "test_data": [{"type": "データ種別", "value": "テストデータ", "description": "説明"}, ...],
  "preconditions": ["前提条件1", "前提条件2", ...]
}`;

      // ユーザーストーリーから具体的なテストデータを抽出
      const extractedTestData = this.extractTestDataFromUserStory();
      
      const userPrompt = `テスト観点: ${viewpoint}
カテゴリ: ${category}
対象URL: ${this.targetUrl || '未指定'}

【重要】ユーザーストーリー:
${this.userStory || '未指定'}

【必須】以下の具体的なデータを必ず使用してください:
${extractedTestData}

仕様書: ${this.pdfSpecContent || '未指定'}

この観点に基づいて、具体的で実行可能なテストケースを生成してください。
特に以下に注意してください：
- ユーザーストーリーで指定された具体的なデータ（日付、氏名、メール等）を必ず使用する
- 勝手にデータを変更したり、サンプルデータで置き換えたりしない
- 実際の操作手順を具体的に記述する
- 検証すべき結果を明確に示す
- 必要なテストデータを提案する
- 前提条件を明確にする`;

      const response = await this.openai.chat.completions.create({
        model: this.config.openai.model || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: this.config.openai.temperature || 0.3,
        max_tokens: this.config.openai.max_tokens || 2000,
        top_p: this.config.openai.top_p || 0.9
      });

      const content = response.choices[0].message.content.trim();
      
      // JSON部分を抽出
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn('⚠️ AI応答からJSONを抽出できませんでした');
        return null;
      }

      const aiResult = JSON.parse(jsonMatch[0]);
      
      // AIの結果をbaseCaseにマージ
      baseCase.test_scenarios = aiResult.test_scenarios || [];
      baseCase.expected_results = aiResult.expected_results || [];
      baseCase.test_data = aiResult.test_data || [];
      baseCase.preconditions = aiResult.preconditions || [];
      
      // AI生成フラグを追加
      baseCase.metadata.ai_generated = true;
      baseCase.metadata.ai_model = this.config.openai.model;
      
      console.log(`✅ AI生成完了: ${baseCase.test_scenarios.length}シナリオ, ${baseCase.expected_results.length}期待結果`);
      
      return baseCase;

    } catch (error) {
      console.error(`❌ AI生成エラー (${category}):`, error.message);
      return null;
    }
  }

  /**
   * ユーザーストーリーから具体的なテストデータを抽出
   * @returns {string} 抽出されたテストデータの文字列
   */
  extractTestDataFromUserStory() {
    if (!this.userStory) {
      return '具体的なテストデータが指定されていません。';
    }

    const testDataPatterns = [
      { pattern: /宿泊日[：:]\s*([^\s\r\n]+)/g, label: '宿泊日' },
      { pattern: /宿泊数[：:]\s*([^\s\r\n]+)/g, label: '宿泊数' },
      { pattern: /人数[：:]\s*([^\s\r\n]+)/g, label: '人数' },
      { pattern: /氏名[：:]\s*[「"]([^」"]+)[」"]/g, label: '氏名' },
      { pattern: /メールアドレス[：:]\s*([^\s\r\n]+)/g, label: 'メールアドレス' },
      { pattern: /確認のご連絡[：:]\s*[「"]([^」"]+)[」"]/g, label: '確認のご連絡' },
      { pattern: /追加プラン[：:]\s*[「"]([^」"]+)[」"]/g, label: '追加プラン' },
      { pattern: /ご要望[・･]ご連絡事項等[：:]\s*[「"]([^」"]+)[」"]/g, label: 'ご要望・ご連絡事項' }
    ];

    const extractedData = [];
    
    testDataPatterns.forEach(({ pattern, label }) => {
      let match;
      while ((match = pattern.exec(this.userStory)) !== null) {
        extractedData.push(`${label}: ${match[1]}`);
      }
    });

    if (extractedData.length === 0) {
      return `ユーザーストーリー全文を参照: ${this.userStory}`;
    }

    return extractedData.join('\n');
  }

  /**
   * PDFファイルの内容を読み込む
   * @param {string} pdfFilePath - PDFファイルのパス
   */
  async loadPdfContent(pdfFilePath) {
    try {
      if (!pdfFilePath || !fs.existsSync(pdfFilePath)) {
        return null;
      }

      console.log(`📄 PDFファイルを読み込み中: ${pdfFilePath}`);
      
      // PDFパーサーを使用（必要に応じて実装）
      // 簡易版として、ファイルの存在確認のみ
      this.pdfSpecContent = `仕様書PDF: ${path.basename(pdfFilePath)}`;
      console.log('✅ PDF情報を設定しました');
      
      return this.pdfSpecContent;
    } catch (error) {
      console.warn('⚠️ PDFファイルの読み込みに失敗:', error.message);
      return null;
    }
  }

  /**
   * テスト観点JSONファイルを読み込み
   * @param {string} testPointsFile - テスト観点JSONファイルパス
   * @returns {Array} テスト観点配列
   */
  loadTestPoints(testPointsFile) {
    try {
      let filePath;
      
      if (path.isAbsolute(testPointsFile)) {
        filePath = testPointsFile;
      } else {
        // 相対パスの場合、複数の場所を検索
        const possiblePaths = [
          path.join(__dirname, testPointsFile),
          path.join(__dirname, '../test-results', testPointsFile),
          path.join(process.cwd(), testPointsFile),
          path.join(process.cwd(), 'test-results', testPointsFile)
        ];
        
        filePath = possiblePaths.find(p => fs.existsSync(p));
        
        if (!filePath) {
          throw new Error(`テスト観点ファイルが見つかりません。以下の場所を確認しました:\n${possiblePaths.join('\n')}`);
        }
      }
      
      console.log(`📊 テスト観点JSONファイルを読み込み中: ${filePath}`);
      
      if (!fs.existsSync(filePath)) {
        throw new Error(`テスト観点ファイルが見つかりません: ${filePath}`);
      }

      const data = fs.readFileSync(filePath, 'utf8');
      
      console.log('📄 JSON形式として読み込み中...');
      const parsedData = JSON.parse(data);
      
      // ✨ 新しいJSON構造対応: { metadata: {...}, points: [...] }
      let testPoints;
      if (parsedData.points && Array.isArray(parsedData.points)) {
        console.log('🔍 新しいJSON構造を検出: { metadata, points }');
        testPoints = parsedData.points;
      } else if (Array.isArray(parsedData)) {
        console.log('🔍 レガシーJSON構造を検出: [...]');
        testPoints = parsedData;
      } else {
        console.log('🔍 単一オブジェクト構造を検出: {...}');
        testPoints = [parsedData];
      }
      
      // 空の観点や不完全な観点をフィルター
      const validTestPoints = testPoints.filter(point => {
        const viewpoint = point['考慮すべき仕様の具体例'] || point.description || '';
        return viewpoint && viewpoint.length > 3;
      });
      
      console.log(`✅ ${validTestPoints.length}件のテスト観点を読み込みました`);
      
      // デバッグ: 最初の数件の内容を表示
      if (validTestPoints.length > 0) {
        console.log('📋 読み込み内容サンプル:');
        validTestPoints.slice(0, 3).forEach((point, index) => {
          const viewpoint = point['考慮すべき仕様の具体例'] || point.description || '';
          console.log(`   ${point.No || index + 1}. ${viewpoint.substring(0, 50)}...`);
        });
      }
      
      return validTestPoints;
    } catch (error) {
      console.error('❌ テスト観点ファイルの読み込みに失敗:', error.message);
      throw error;
    }
  }

  /**
   * 観点の種類を分析して分類
   * @param {string} viewpoint - テスト観点の説明
   * @returns {string} 観点カテゴリ
   */
  categorizeViewpoint(viewpoint) {
    const text = viewpoint.toLowerCase();
    
    if (text.includes('表示') || text.includes('配置') || text.includes('文字化け') || text.includes('文字切れ')) {
      return 'display';
    } else if (text.includes('入力') || text.includes('必須') || text.includes('未入力')) {
      return 'input_validation';
    } else if (text.includes('エラー') || text.includes('メッセージ')) {
      return 'error_handling';
    } else if (text.includes('遷移') || text.includes('画面') || text.includes('ページ')) {
      return 'navigation';
    } else if (text.includes('選択') || text.includes('プルダウン') || text.includes('ボタン')) {
      return 'interaction';
    } else if (text.includes('確認') || text.includes('反映') || text.includes('値')) {
      return 'data_verification';
    } else if (text.includes('文字種') || text.includes('仕様外') || text.includes('動作')) {
      return 'edge_case';
    } else if (text.includes('ブラウザ') || text.includes('os') || text.includes('互換')) {
      return 'compatibility';
    } else if (text.includes('ログ') || text.includes('運用') || text.includes('連携')) {
      return 'operations';
    }
    
    return 'general';
  }

  /**
   * 優先度を決定
   */
  determinePriority(viewpoint) {
    const highPriorityKeywords = ['必須', 'エラー', '入力', '確認', '表示'];
    const mediumPriorityKeywords = ['選択', '遷移', '反映'];
    
    const text = viewpoint.toLowerCase();
    
    if (highPriorityKeywords.some(keyword => text.includes(keyword))) {
      return 'high';
    } else if (mediumPriorityKeywords.some(keyword => text.includes(keyword))) {
      return 'medium';
    }
    
    return 'low';
  }

  /**
   * 観点から自然言語テストケースを生成
   * @param {string} viewpoint - テスト観点
   * @param {string} category - カテゴリ
   * @param {number} index - インデックス
   * @returns {Object} 自然言語テストケース
   */
  async generateNaturalLanguageTestCase(viewpoint, category, index) {
    const testCaseId = `NL_TC_${Date.now()}_${index.toString().padStart(3, '0')}`;
    
    // 基本的なテストケース構造
    const testCase = {
      id: testCaseId,
      title: this.generateTestCaseTitle(viewpoint, category),
      original_viewpoint: viewpoint,
      category: category,
      priority: this.determinePriority(viewpoint),
      test_scenarios: [],
      expected_results: [],
      test_data: [],
      preconditions: [],
      context: {
        target_url: this.targetUrl,
        user_story: this.userStory,
        pdf_spec: this.pdfSpecContent
      },
      metadata: {
        generated_at: new Date().toISOString(),
        source: 'generateTestCases.js',
        version: '2.2.0',
        type: 'natural_language'
      }
    };

    // 🤖 AI生成を最優先で試行
    if (this.openai) {
      const aiResult = await this.generateTestCaseWithAI(viewpoint, category, testCase);
      if (aiResult && aiResult.test_scenarios.length > 0) {
        return aiResult;
      }
    }

    // フォールバック: 従来のテンプレート生成
    console.log(`⚠️ AIが利用できないため、テンプレート生成を使用: ${category}`);
    
    // カテゴリ別に自然言語テストケースを生成
    switch (category) {
      case 'display':
        return this.generateDisplayTestCase(testCase, viewpoint);
      case 'input_validation':
        return this.generateInputValidationTestCase(testCase, viewpoint);
      case 'error_handling':
        return this.generateErrorHandlingTestCase(testCase, viewpoint);
      case 'navigation':
        return this.generateNavigationTestCase(testCase, viewpoint);
      case 'interaction':
        return this.generateInteractionTestCase(testCase, viewpoint);
      case 'data_verification':
        return this.generateDataVerificationTestCase(testCase, viewpoint);
      case 'edge_case':
        return this.generateEdgeCaseTestCase(testCase, viewpoint);
      case 'compatibility':
        return this.generateCompatibilityTestCase(testCase, viewpoint);
      case 'operations':
        return this.generateOperationsTestCase(testCase, viewpoint);
      default:
        return this.generateGeneralTestCase(testCase, viewpoint);
    }
  }

  /**
   * テストケースのタイトルを生成
   * @param {string} viewpoint - テスト観点
   * @param {string} category - カテゴリ
   * @returns {string} テストケースタイトル
   */
  generateTestCaseTitle(viewpoint, category) {
    const categoryNames = {
      'display': '表示確認',
      'input_validation': '入力検証',
      'error_handling': 'エラーハンドリング',
      'navigation': '画面遷移',
      'interaction': 'UI操作',
      'data_verification': 'データ確認',
      'edge_case': '境界値テスト',
      'compatibility': '互換性',
      'operations': '運用確認',
      'general': '一般機能'
    };
    
    const categoryName = categoryNames[category] || '機能確認';
    // 省略処理を削除：完全なviewpointを使用
    
    return `${categoryName}: ${viewpoint}`;
  }

  /**
   * 表示確認系自然言語テストケース（DOM解析結果対応）
   */
  generateDisplayTestCase(baseCase, viewpoint) {
    const targetUrl = this.targetUrl || "対象ページ";
    const userStoryContext = this.userStory ? `（${this.userStory.substring(0, 50)}...の文脈で）` : "";
    
    // DOM解析結果を活用して具体的なテストケースを生成
    const specificElements = [];
    if (this.domInfo) {
      // 入力フィールドの具体的な確認項目
      if (this.domInfo.inputs.length > 0) {
        this.domInfo.inputs.forEach(input => {
          if (input.placeholder) {
            specificElements.push(`入力欄「${input.placeholder}」が正しく表示されている`);
          } else if (input.name) {
            specificElements.push(`${input.name}入力欄が正しく配置されている`);
          }
        });
      }
      
      // ボタンの具体的な確認項目
      if (this.domInfo.buttons.length > 0) {
        this.domInfo.buttons.forEach(btn => {
          if (btn.text) {
            specificElements.push(`「${btn.text}」ボタンが正しく表示されている`);
          }
        });
      }
      
      // リンクの具体的な確認項目
      if (this.domInfo.links.length > 0) {
        this.domInfo.links.slice(0, 3).forEach(link => { // 主要なリンクのみ
          if (link.text) {
            specificElements.push(`「${link.text}」リンクが正しく表示されている`);
          }
        });
      }
    }
    
    baseCase.test_scenarios = [
      `${targetUrl}にアクセスする`,
      "ページが完全に読み込まれるまで待機する",
      `各UI要素が正しく配置されていることを確認する${userStoryContext}`,
      ...specificElements.map(element => `${element}ことを確認する`),
      "文字が正しく表示され、文字化けや文字切れがないことを確認する",
      "レイアウトが崩れていないことを確認する"
    ];

    baseCase.expected_results = [
      "ページが正常に表示される",
      "すべてのUI要素が意図された位置に配置されている",
      "テキストが読みやすく表示されている",
      "レスポンシブデザインが適切に機能している",
      ...specificElements
    ];

    baseCase.preconditions = [
      this.targetUrl ? `${this.targetUrl}が有効である` : "対象ページのURLが有効である",
      "ブラウザが正常に動作している",
      this.userStory ? "ユーザーストーリーで想定されたアクセス権限がある" : "適切なアクセス権限がある"
    ];

    // DOM解析結果を保存（Playwright実装生成時に活用）
    if (this.domInfo) {
      baseCase.dom_context = {
        available_inputs: this.domInfo.inputs.length,
        available_buttons: this.domInfo.buttons.length,
        available_links: this.domInfo.links.length,
        specific_elements: specificElements,
        high_feasibility: true
      };
    }

    // PDF仕様書情報がある場合は追加情報を含める
    if (this.pdfSpecContent) {
      baseCase.test_scenarios.push("仕様書に記載された表示要件と照合する");
      baseCase.expected_results.push("仕様書の表示要件を満たしている");
    }

    return baseCase;
  }

  /**
   * 入力検証系自然言語テストケース（DOM解析結果対応）
   */
  generateInputValidationTestCase(baseCase, viewpoint) {
    const targetUrl = this.targetUrl || "対象ページ";
    const userStoryContext = this.userStory ? `（${this.userStory.substring(0, 50)}...に関連する）` : "";
    
    // DOM解析結果から具体的な入力フィールドとテストデータを生成
    const specificFields = [];
    const concreteTestData = [];
    
    if (this.domInfo && this.domInfo.inputs.length > 0) {
      this.domInfo.inputs.forEach(input => {
        const fieldInfo = {
          selector: input.selector,
          name: input.name,
          type: input.type,
          required: input.required,
          placeholder: input.placeholder
        };
        
        specificFields.push(fieldInfo);
        
        // 入力タイプに応じたテストデータを生成
        if (input.type === 'email') {
          concreteTestData.push(
            { field: input.name, type: "invalid", value: "invalid-email", description: "無効なメール形式" },
            { field: input.name, type: "valid", value: "test@example.com", description: "有効なメール形式" }
          );
        } else if (input.type === 'date') {
          concreteTestData.push(
            { field: input.name, type: "valid", value: "2024/12/31", description: "有効な日付" },
            { field: input.name, type: "invalid", value: "invalid-date", description: "無効な日付形式" }
          );
        } else if (input.type === 'number') {
          concreteTestData.push(
            { field: input.name, type: "valid", value: "5", description: "有効な数値" },
            { field: input.name, type: "invalid", value: "abc", description: "無効な数値（文字列）" }
          );
        } else {
          concreteTestData.push(
            { field: input.name, type: "empty", value: "", description: "空の入力値" },
            { field: input.name, type: "valid", value: "テストデータ", description: "有効な入力値" }
          );
        }
      });
    }
    
    // 具体的な操作手順を生成
    const scenarios = [`${targetUrl}にアクセスする`];
    
    if (specificFields.length > 0) {
      scenarios.push(`入力フィールドを特定する${userStoryContext}`);
      
      // 必須フィールドの空値テスト
      const requiredFields = specificFields.filter(f => f.required);
      if (requiredFields.length > 0) {
        scenarios.push(`必須フィールド（${requiredFields.map(f => f.name || f.placeholder).join('、')}）を空のまま送信操作を実行する`);
      }
      
      // 各フィールドの個別テスト
      specificFields.forEach(field => {
        if (field.selector && field.type) {
          scenarios.push(`${field.placeholder || field.name}フィールド（${field.selector}）に${field.type}形式のデータを入力テストする`);
        }
      });
    } else {
      scenarios.push(`入力フィールドを特定する${userStoryContext}`);
    }
    
    scenarios.push(
      "有効な値を入力して正常動作を確認する",
      "無効な値（空文字、特殊文字、長すぎる文字列等）を入力する",
      "バリデーションメッセージが適切に表示されることを確認する",
      "フォーム送信時の動作を確認する"
    );
    
    baseCase.test_scenarios = scenarios;

    baseCase.expected_results = [
      "有効な値は正常に受け入れられる",
      "無効な値に対して適切なエラーメッセージが表示される",
      "必須項目が未入力の場合、送信が阻止される",
      "入力値の制限が正しく機能している"
    ];

    // DOM解析結果に基づく具体的なテストデータ
    baseCase.test_data = concreteTestData.length > 0 ? concreteTestData : [
      { type: "valid", description: "正常な入力値", context: this.userStory ? "ユーザーストーリーに基づく実用的な値" : null },
      { type: "invalid_empty", description: "空文字" },
      { type: "invalid_special", description: "特殊文字" },
      { type: "invalid_length", description: "文字数制限超過" }
    ];

    baseCase.preconditions = [
      this.targetUrl ? `${this.targetUrl}のフォームページにアクセス可能である` : "フォームページにアクセス可能である",
      "入力フィールドが表示されている",
      this.userStory ? "ユーザーストーリーで想定された入力権限がある" : "適切な入力権限がある"
    ];

    // DOM解析結果を保存（Playwright実装生成時に活用）
    if (this.domInfo) {
      baseCase.dom_context = {
        available_inputs: this.domInfo.inputs.length,
        specific_inputs: specificFields,
        concrete_test_data: concreteTestData,
        high_feasibility: specificFields.length > 0 && this.domInfo.buttons.length > 0
      };
    }

    // PDF仕様書情報がある場合は追加情報を含める
    if (this.pdfSpecContent) {
      baseCase.test_scenarios.push("仕様書に記載された入力制限と照合する");
      baseCase.expected_results.push("仕様書の入力要件を満たしている");
    }

    return baseCase;
  }

  /**
   * エラーハンドリング系自然言語テストケース
   */
  generateErrorHandlingTestCase(baseCase, viewpoint) {
    baseCase.test_scenarios = [
      "対象ページにアクセスする",
      "エラーが発生する条件を意図的に作り出す",
      "エラーメッセージが適切に表示されることを確認する",
      "エラーID や詳細情報が含まれていることを確認する",
      "ユーザーが次のアクションを取れる状態であることを確認する"
    ];

    baseCase.expected_results = [
      "分かりやすいエラーメッセージが表示される",
      "エラーIDが表示される（該当する場合）",
      "ユーザーが問題を解決するための指示が提供される",
      "システムが安定した状態を保っている"
    ];

    baseCase.preconditions = [
      "エラー発生条件を再現できる環境である"
    ];

    return baseCase;
  }

  /**
   * ナビゲーション系自然言語テストケース
   */
  generateNavigationTestCase(baseCase, viewpoint) {
    baseCase.test_scenarios = [
      "開始ページにアクセスする",
      "ナビゲーション要素（リンク、ボタン等）をクリックする",
      "意図されたページに遷移することを確認する",
      "遷移先ページが正しく表示されることを確認する",
      "ブラウザの戻るボタンで元のページに戻れることを確認する"
    ];

    baseCase.expected_results = [
      "クリックした要素に対応する正しいページに遷移する",
      "遷移先ページが完全に読み込まれる",
      "URLが適切に変更される",
      "ページの戻り機能が正常に動作する"
    ];

    baseCase.preconditions = [
      "開始ページが正常に表示されている",
      "ナビゲーション要素が機能している"
    ];

    return baseCase;
  }

  /**
   * インタラクション系自然言語テストケース
   */
  generateInteractionTestCase(baseCase, viewpoint) {
    baseCase.test_scenarios = [
      "対象ページにアクセスする",
      "インタラクティブ要素（ボタン、プルダウン、チェックボックス等）を操作する",
      "操作に対する即座の反応があることを確認する",
      "操作結果が正しく反映されることを確認する",
      "複数の操作を組み合わせた場合の動作を確認する"
    ];

    baseCase.expected_results = [
      "操作に対して適切な反応がある",
      "選択した内容が正しく反映される",
      "依存関係のある要素が連動して変化する",
      "操作後の状態が維持される"
    ];

    baseCase.preconditions = [
      "インタラクティブ要素が表示されている",
      "要素が操作可能な状態である"
    ];

    return baseCase;
  }

  /**
   * データ検証系自然言語テストケース
   */
  generateDataVerificationTestCase(baseCase, viewpoint) {
    baseCase.test_scenarios = [
      "対象ページにアクセスする",
      "テストデータを入力する",
      "データの送信または保存操作を実行する",
      "入力したデータが正しく保持されていることを確認する",
      "データが他の画面や処理で正しく使用されることを確認する"
    ];

    baseCase.expected_results = [
      "入力データが失われることなく保持される",
      "データが正しい形式で表示される",
      "関連する計算や処理が正確に実行される",
      "データの整合性が保たれている"
    ];

    baseCase.test_data = [
      { type: "typical", description: "一般的なデータパターン" },
      { type: "boundary", description: "境界値データ" },
      { type: "special", description: "特殊文字を含むデータ" }
    ];

    baseCase.preconditions = [
      "データ入力が可能な状態である",
      "保存・送信機能が有効である"
    ];

    return baseCase;
  }

  /**
   * エッジケース系自然言語テストケース
   */
  generateEdgeCaseTestCase(baseCase, viewpoint) {
    baseCase.test_scenarios = [
      "対象ページにアクセスする",
      "通常とは異なる操作パターンを実行する",
      "境界値や極端な値を使用する",
      "システムが安定して動作することを確認する",
      "予期しない動作が発生しないことを確認する"
    ];

    baseCase.expected_results = [
      "システムがクラッシュしない",
      "適切なエラーハンドリングが機能する",
      "データの破損が発生しない",
      "ユーザビリティが保たれている"
    ];

    baseCase.test_data = [
      { type: "extreme", description: "極端な値" },
      { type: "unusual", description: "通常使用されない文字種" },
      { type: "boundary", description: "システム制限の境界値" }
    ];

    baseCase.preconditions = [
      "システムが正常に動作している",
      "テスト環境でエッジケースを安全に実行できる"
    ];

    return baseCase;
  }

  /**
   * 互換性テスト系自然言語テストケース
   */
  generateCompatibilityTestCase(baseCase, viewpoint) {
    baseCase.test_scenarios = [
      "指定されたブラウザ/OS環境でページにアクセスする",
      "基本的な機能が正常に動作することを確認する",
      "レイアウトが適切に表示されることを確認する",
      "環境固有の問題が発生しないことを確認する"
    ];

    baseCase.expected_results = [
      "すべての対象環境で一貫した動作をする",
      "レイアウトが崩れない",
      "機能の動作に差がない",
      "環境固有のエラーが発生しない"
    ];

    baseCase.preconditions = [
      "複数のブラウザ/OS環境でテスト可能である",
      "各環境が正常に動作している"
    ];

    return baseCase;
  }

  /**
   * 運用系自然言語テストケース
   */
  generateOperationsTestCase(baseCase, viewpoint) {
    baseCase.test_scenarios = [
      "対象機能を実行する",
      "ログが適切に出力されることを確認する",
      "外部システムとの連携が正常に動作することを確認する",
      "運用監視の観点で必要な情報が取得できることを確認する"
    ];

    baseCase.expected_results = [
      "必要なログが出力される",
      "外部システムとの連携が成功する",
      "エラー時の情報が適切に記録される",
      "運用監視に必要なデータが取得できる"
    ];

    baseCase.preconditions = [
      "ログ出力機能が有効である",
      "外部システムとの接続が確立されている"
    ];

    return baseCase;
  }

  /**
   * 汎用自然言語テストケース
   */
  generateGeneralTestCase(baseCase, viewpoint) {
    baseCase.test_scenarios = [
      "対象ページにアクセスする",
      "基本的な機能が動作することを確認する",
      "ユーザーの期待する動作が実現されることを確認する"
    ];

    baseCase.expected_results = [
      "基本機能が正常に動作する",
      "ユーザーの目的が達成できる",
      "明らかな問題が発生しない"
    ];

    baseCase.preconditions = [
      "システムが正常に動作している"
    ];

    return baseCase;
  }

  /**
   * テストケース群を生成（分類別に分割対応）
   * @param {Array} testPoints - テスト観点配列
   * @returns {Object} 分類別のテストケース群
   */
  async generateNaturalLanguageTestCases(testPoints) {
    console.log('🔄 自然言語テストケース生成を開始...');
    
    const testCasesByCategory = {};
    const allTestCases = [];
    
    // 🤖 AI生成のため順次処理（並列だとAPI制限に引っかかる）
    for (let index = 0; index < testPoints.length; index++) {
      const point = testPoints[index];
      const viewpoint = point['考慮すべき仕様の具体例'] || point.description || `テスト観点${index + 1}`;
      const originalCategory = this.categorizeViewpoint(viewpoint);
      
      // 中分類があれば使用、なければ自動分類
      const middleCategory = point['中分類'] || this.mapCategoryToMiddle(originalCategory);
      const finalCategory = this.normalizeMiddleCategory(middleCategory);
      
      console.log(`📝 ${index + 1}/${testPoints.length} 中分類: ${middleCategory} → ${finalCategory}, 観点: ${viewpoint.substring(0, 50)}...`);
      
      const testCase = await this.generateNaturalLanguageTestCase(viewpoint, originalCategory, index + 1);
      testCase.middle_category = finalCategory;
      testCase.original_middle_category = middleCategory;
      
      // 分類別に分ける
      if (!testCasesByCategory[finalCategory]) {
        testCasesByCategory[finalCategory] = [];
      }
      testCasesByCategory[finalCategory].push(testCase);
      allTestCases.push(testCase);
      
      // API制限対応: 1秒待機
      if (this.openai && index < testPoints.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    const categoryCount = Object.keys(testCasesByCategory).length;
    const totalCases = allTestCases.length;
    
    console.log(`✅ ${totalCases}件のテストケースを${categoryCount}カテゴリに分類しました`);
    
    // カテゴリ別件数表示
    Object.entries(testCasesByCategory).forEach(([category, cases]) => {
      console.log(`   📂 ${category}: ${cases.length}件`);
    });
    
    // AI生成統計を表示
    const aiGeneratedCount = allTestCases.filter(tc => tc.metadata.ai_generated).length;
    if (aiGeneratedCount > 0) {
      console.log(`🤖 AI生成: ${aiGeneratedCount}件, テンプレート生成: ${totalCases - aiGeneratedCount}件`);
    }
    
    return {
      byCategory: testCasesByCategory,
      all: allTestCases
    };
  }

  /**
   * 自動分類から中分類へのマッピング
   */
  mapCategoryToMiddle(category) {
    const mapping = {
      'display': '表示（UI）',
      'input_validation': '入力',
      'navigation': '画面遷移',
      'interaction': '操作',
      'data_verification': 'データ確認',
      'error_handling': 'エラーハンドリング',
      'edge_case': '境界値',
      'compatibility': '互換性',
      'operations': '運用性',
      'general': '一般機能'
    };
    return mapping[category] || '一般機能';
  }

  /**
   * 中分類の正規化
   */
  normalizeMiddleCategory(middleCategory) {
    const normalizeMap = {
      '表示（UI）': '表示',
      '表示': '表示',
      'レイアウト/文言': '表示',
      '入力': '入力',
      '未入力': '入力',
      '状態遷移': '状態遷移',
      '経時変化': '状態遷移',
      '画面遷移': '画面遷移',
      '変更・反映・設定保持': '設定保持',
      '初期値': '設定保持',
      'キャンセル': '設定保持',
      '排他処理': '排他処理',
      '禁則': '排他処理',
      '互換性': '互換性',
      'OS': '互換性',
      'ブラウザ': '互換性',
      '運用性': '運用性',
      '障害アラート': '運用性',
      'エラーハンドリング': '運用性',
      '相互運用性': '連携',
      '連携システム': '連携'
    };
    
    return normalizeMap[middleCategory] || middleCategory || '一般機能';
  }

  /**
   * テストケースを保存（分類別分割対応）
   * @param {Object} testCasesData - { byCategory: {...}, all: [...] }
   * @param {string} outputFileName - 出力ファイル名
   * @returns {Array} 保存されたファイルパス配列
   */
  saveNaturalLanguageTestCases(testCasesData, outputFileName = null) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
    const baseFileName = outputFileName ? outputFileName.replace('.json', '') : `naturalLanguageTestCases_${timestamp}`;
    
    // 共通メタデータ
    const commonMetadata = {
      generated_at: new Date().toISOString(),
      generator_version: '2.2.0',
      type: 'natural_language_test_cases',
      context: {
        target_url: this.targetUrl,
        user_story: this.userStory ? this.userStory.substring(0, 200) + (this.userStory.length > 200 ? '...' : '') : null,
        pdf_spec: this.pdfSpecContent
      }
    };

    const savedFiles = [];
    const fileSizes = {};

    // 1. 分類別ファイルを保存
    console.log(`💾 分類別テストケースファイルを生成中...`);
    
    Object.entries(testCasesData.byCategory).forEach(([category, testCases]) => {
      const categoryFileName = `${baseFileName}_${category}.json`;
      const categoryFilePath = path.join(this.outputDir, categoryFileName);
      
      const categoryData = {
        metadata: {
          ...commonMetadata,
          category: category,
          total_test_cases: testCases.length,
          description: `${category}に関する自然言語テストケース（詳細版）。具体的で実行可能なテストシナリオを含む。`,
          version_type: 'category_detailed'
        },
        testCases: testCases
      };
      
      fs.writeFileSync(categoryFilePath, JSON.stringify(categoryData, null, 2), 'utf8');
      const fileSize = fs.statSync(categoryFilePath).size;
      fileSizes[category] = fileSize;
      savedFiles.push(categoryFilePath);
      
      console.log(`   📂 ${category}: ${categoryFileName} (${(fileSize/1024).toFixed(1)}KB, ${testCases.length}件)`);
    });

    // 2. 統合インデックスファイルを保存（軽量版）
    const indexFileName = `${baseFileName}_index.json`;
    const indexFilePath = path.join(this.outputDir, indexFileName);
    
    const categoryIndex = Object.entries(testCasesData.byCategory).map(([category, testCases]) => ({
      category: category,
      file: `${baseFileName}_${category}.json`,
      count: testCases.length,
      size_kb: Math.round(fileSizes[category] / 1024 * 10) / 10,
      sample_titles: testCases.slice(0, 3).map(tc => tc.title)
    }));

    const indexData = {
      metadata: {
        ...commonMetadata,
        total_categories: Object.keys(testCasesData.byCategory).length,
        total_test_cases: testCasesData.all.length,
        description: '分類別テストケースファイルのインデックス。generateSmartScenarios.jsでの一括処理に使用。',
        version_type: 'category_index'
      },
      categories: categoryIndex,
      execution_order: Object.keys(testCasesData.byCategory), // 実行順序の推奨
      files: savedFiles.map(fp => path.basename(fp))
    };

    fs.writeFileSync(indexFilePath, JSON.stringify(indexData, null, 2), 'utf8');
    const indexSize = fs.statSync(indexFilePath).size;
    savedFiles.push(indexFilePath);

    // 3. レガシー互換用統合ファイル（軽量版）
    const compactFileName = `${baseFileName}_compact.json`;
    const compactFilePath = path.join(this.outputDir, compactFileName);
    
    const compactTestCases = testCasesData.all.map(testCase => ({
      id: testCase.id,
      title: testCase.title,
      category: testCase.category,
      middle_category: testCase.middle_category,
      priority: testCase.priority,
      scenarios: testCase.test_scenarios.slice(0, 3), // 最初の3つのみ
      expected: testCase.expected_results.slice(0, 2), // 最初の2つのみ
      original_viewpoint: testCase.original_viewpoint.substring(0, 100) + (testCase.original_viewpoint.length > 100 ? '...' : '')
    }));

    const compactData = {
      metadata: {
        ...commonMetadata,
        total_test_cases: compactTestCases.length,
        categories: this.getCategorySummary(testCasesData.all),
        description: '全カテゴリ統合の軽量版テストケース。レガシー互換性のため。',
        version_type: 'legacy_compact'
      },
      testCases: compactTestCases
    };

    fs.writeFileSync(compactFilePath, JSON.stringify(compactData, null, 2), 'utf8');
    const compactSize = fs.statSync(compactFilePath).size;
    savedFiles.push(compactFilePath);

    // 結果サマリー表示
    console.log(`\n📊 ファイル生成完了:`);
    console.log(`   📋 インデックス: ${path.basename(indexFilePath)} (${(indexSize/1024).toFixed(1)}KB)`);
    console.log(`   📦 統合軽量版: ${path.basename(compactFilePath)} (${(compactSize/1024).toFixed(1)}KB)`);
    console.log(`   📂 分類別詳細: ${Object.keys(testCasesData.byCategory).length}ファイル`);
    
    const totalDetailedSize = Object.values(fileSizes).reduce((sum, size) => sum + size, 0);
    console.log(`   💽 総サイズ: ${(totalDetailedSize/1024).toFixed(1)}KB（分類別詳細）`);

    // サンプルテストケースを表示
    console.log(`\n📝 生成されたカテゴリ別テストケース例:`);
    Object.entries(testCasesData.byCategory).slice(0, 3).forEach(([category, cases]) => {
      const sampleCase = cases[0];
      if (sampleCase) {
        console.log(`\n📂 ${category}:`);
        console.log(`   - ${sampleCase.title}`);
        console.log(`   - シナリオ例: ${sampleCase.test_scenarios[0] || 'N/A'}`);
      }
    });

    console.log(`\n💡 推奨使用方法:`);
    console.log(`   🚀 一括処理: インデックスファイル (${path.basename(indexFilePath)})`);
    console.log(`   📂 分類別実行: 各カテゴリファイル`);
    console.log(`   🔄 レガシー互換: 統合軽量版 (${path.basename(compactFilePath)})`);
    
    return {
      indexFile: indexFilePath,
      categoryFiles: savedFiles.filter(f => f.includes('_') && !f.includes('_index.json') && !f.includes('_compact.json')),
      compactFile: compactFilePath,
      allFiles: savedFiles
    };
  }

  /**
   * カテゴリ別統計を取得
   */
  getCategorySummary(testCases) {
    const summary = {};
    testCases.forEach(testCase => {
      const category = testCase.category;
      summary[category] = (summary[category] || 0) + 1;
    });
    return summary;
  }

  /**
   * メイン処理実行
   * @param {string} testPointsFile - テスト観点ファイルパス
   * @param {Object} options - オプション設定
   */
  async run(testPointsFile, options = {}) {
    try {
      console.log('🚀 自然言語テストケース生成を開始します...');
      console.log(`📊 入力ファイル: ${testPointsFile}`);
      
      // 1. 設定情報を読み込み
      this.loadConfig();
      
      // 2. オプション情報の設定
      this.targetUrl = options.url || (this.config && this.config.targetUrl) || null;
      this.userStory = options.goal || (this.config && this.config.userStory && this.config.userStory.content) || null;
      
      // 3. PDFファイル情報を読み込み
      if (options.pdfFile) {
        await this.loadPdfContent(options.pdfFile);
      }
      
      // 4. 🔍 DOM解析を事前実行（NEW!）
      if (this.targetUrl) {
        console.log('🔍 DOM解析を事前実行してより具体的なテストケースを生成します...');
        await this.loadDomAnalysis(this.targetUrl);
      }
      
      // 5. コンテキスト情報の表示
      if (this.targetUrl) {
        console.log(`🎯 対象URL: ${this.targetUrl}`);
      }
      if (this.userStory) {
        console.log(`📖 ユーザーストーリー: ${this.userStory.substring(0, 100)}${this.userStory.length > 100 ? '...' : ''}`);
      }
      if (this.pdfSpecContent) {
        console.log(`📄 仕様書: ${this.pdfSpecContent}`);
      }
      if (this.domInfo) {
        console.log(`🔍 DOM解析結果: 入力${this.domInfo.inputs.length}個, ボタン${this.domInfo.buttons.length}個を反映`);
      }
      
      // 6. テスト観点を読み込み
      const testPoints = this.loadTestPoints(testPointsFile);
      
      // 7. 自然言語テストケースを生成（分類別・DOM解析結果を活用）
      const testCasesData = await this.generateNaturalLanguageTestCases(testPoints);
      
      // 8. テストケースを保存（分類別分割）
      const savedFiles = this.saveNaturalLanguageTestCases(testCasesData, options.outputFile);
      
      console.log('✅ 自然言語テストケース生成が完了しました！');
      console.log('🔄 次のステップ: generateSmartScenarios.js で具体的なPlaywright実装を生成');
      console.log(`📋 メインファイル: ${path.basename(savedFiles.indexFile)}`);
      
      // DOM解析結果の効果をレポート
      if (this.domInfo) {
        console.log('📊 DOM解析効果:');
        console.log(`   - より具体的なセレクタ指定が可能`);
        console.log(`   - 実行可能性スコア向上が期待される`);
        console.log(`   - ${this.domInfo.inputs.length}個の入力フィールドを詳細分析済み`);
      }
      
      return savedFiles;
      
    } catch (error) {
      console.error('❌ 自然言語テストケース生成に失敗:', error.message);
      throw error;
    }
  }

  /**
   * DOM解析結果を事前読み込み
   * @param {string} url - 対象URL
   */
  async loadDomAnalysis(url = null) {
    if (!url && !this.targetUrl) {
      console.log('⚠️ URL指定なし - DOM解析をスキップします');
      return null;
    }

    const targetUrl = url || this.targetUrl;
    console.log(`🔍 DOM解析を事前実行: ${targetUrl}`);

    try {
      const { chromium } = await import('playwright');
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      
      await page.goto(targetUrl);
      await page.waitForTimeout(3000); // ページ読み込み待機

      // DOM情報を取得
      const domInfo = await page.evaluate(() => {
        const elements = {
          inputs: [],
          buttons: [],
          links: [],
          headings: [],
          forms: [],
          selects: []
        };

        // 入力フィールド解析
        document.querySelectorAll('input, textarea, select').forEach(input => {
          const elementInfo = {
            tagName: input.tagName.toLowerCase(),
            type: input.type || 'text',
            name: input.name,
            id: input.id,
            placeholder: input.placeholder,
            required: input.required,
            disabled: input.disabled,
            value: input.value,
            selector: input.id ? `#${input.id}` : input.name ? `[name="${input.name}"]` : null
          };

          if (input.tagName.toLowerCase() === 'select') {
            elementInfo.options = Array.from(input.options).map(opt => ({
              value: opt.value,
              text: opt.text
            }));
            elements.selects.push(elementInfo);
          } else {
            elements.inputs.push(elementInfo);
          }
        });

        // ボタン解析
        document.querySelectorAll('button, input[type="submit"], input[type="button"]').forEach(btn => {
          elements.buttons.push({
            tagName: btn.tagName.toLowerCase(),
            type: btn.type,
            text: btn.textContent?.trim() || btn.value,
            id: btn.id,
            className: btn.className,
            disabled: btn.disabled,
            selector: btn.id ? `#${btn.id}` : `text="${btn.textContent?.trim() || btn.value}"`
          });
        });

        // リンク解析
        document.querySelectorAll('a[href]').forEach(link => {
          elements.links.push({
            href: link.href,
            text: link.textContent?.trim(),
            id: link.id,
            selector: link.id ? `#${link.id}` : `text="${link.textContent?.trim()}"`
          });
        });

        // 見出し解析
        document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(heading => {
          elements.headings.push({
            tagName: heading.tagName.toLowerCase(),
            text: heading.textContent?.trim(),
            id: heading.id
          });
        });

        // フォーム解析
        document.querySelectorAll('form').forEach(form => {
          elements.forms.push({
            id: form.id,
            action: form.action,
            method: form.method,
            inputCount: form.querySelectorAll('input, textarea, select').length
          });
        });

        return elements;
      });

      await browser.close();

      this.domInfo = domInfo;
      console.log(`✅ DOM解析完了: 入力${domInfo.inputs.length}個, ボタン${domInfo.buttons.length}個, リンク${domInfo.links.length}個`);
      
      return domInfo;

    } catch (error) {
      console.error(`❌ DOM解析エラー: ${error.message}`);
      return null;
    }
  }
}

// CLI実行時の処理
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  
  // CLI引数解析
  const parseCliArgs = (args) => {
    const options = {};
    const nonOptionArgs = [];
    
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--url' && i + 1 < args.length) {
        options.url = args[++i];
      } else if (args[i] === '--goal' && i + 1 < args.length) {
        options.goal = args[++i];
      } else if (args[i] === '--spec-pdf' && i + 1 < args.length) {
        options.pdfFile = args[++i];
      } else if (args[i] === '--output' && i + 1 < args.length) {
        options.outputFile = args[++i];
      } else if (!args[i].startsWith('--')) {
        nonOptionArgs.push(args[i]);
      }
    }
    
    return { options, nonOptionArgs };
  };
  
  if (args.length === 0) {
    console.log(`
🔧 使用方法:
  node generateTestCases.js <testPointsJsonFile> [オプション]
  
📋 例:
  node generateTestCases.js testPoints_250626114042.json
  node generateTestCases.js testPoints_250626114042.json --output myTestCases.json
  node generateTestCases.js testPoints_250626114042.json --url https://example.com --goal "ユーザーストーリー"
  
📊 オプション:
  --url <URL>          対象サイトのURL
  --goal <text>        ユーザーストーリー
  --spec-pdf <path>    仕様書PDFファイルパス
  --output <filename>  出力ファイル名
  
📝 機能:
  - generateTestPoints.jsで生成されたテスト観点JSONから自然言語テストケースを生成
  - URL、ユーザーストーリー、PDF仕様書を活用してより具体的なテストケースを作成
  - 理解しやすい日本語でテストシナリオを記述
  - DOM解析やPlaywright実装は含まない（generateSmartScenarios.jsで実装）
  - カテゴリ分類とトレーサビリティを提供
  
📝 入力形式:
  generateTestPoints.jsで生成されるJSON形式のみ対応:
  [
    {
      "No": "1",
      "考慮すべき仕様の具体例": "具体的なテスト内容..."
    }
  ]
    `);
    process.exit(1);
  }
  
  const { options, nonOptionArgs } = parseCliArgs(args);
  const testPointsFile = nonOptionArgs[0];
  
  if (!testPointsFile) {
    console.error('❌ テスト観点JSONファイルを指定してください');
    process.exit(1);
  }
  
  const generator = new NaturalLanguageTestCaseGenerator();
  
  generator.run(testPointsFile, options)
    .then(savedFiles => {
      console.log(`🎉 分類別自然言語テストケース生成完了！`);
      console.log(`📋 インデックスファイル: ${savedFiles.indexFile}`);
      console.log(`📂 分類別ファイル数: ${savedFiles.categoryFiles.length}`);
      console.log(`📦 レガシー互換ファイル: ${savedFiles.compactFile}`);
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ 処理失敗:', error.message);
      process.exit(1);
    });
}

export default NaturalLanguageTestCaseGenerator;

// 複雑なテストケース生成時のトレーサビリティ強化
function generateComplexTestWithTraceability(testCase, userStoryInfo) {
  const complexTestMetadata = {
    // 基本トレーサビリティ
    original_viewpoint: testCase.original_viewpoint,
    generated_from_natural_case: testCase.id,
    user_story_id: userStoryInfo ? userStoryInfo.currentId : null,
    
    // 複雑テスト固有のトレーサビリティ
    test_structure: {
      type: 'complex_validation', // detailed, comprehensive, complex_validation
      phases: [], // setup, execution, validation, cleanup
      assertions: [], // 各検証ポイント
      dependencies: [] // 依存要素
    },
    
    // 観点の細分化
    viewpoint_breakdown: {
      primary_concern: extractPrimaryConcern(testCase.original_viewpoint),
      validation_aspects: extractValidationAspects(testCase.original_viewpoint),
      edge_cases: extractEdgeCases(testCase.original_viewpoint)
    },
    
    // 逆引き用インデックス
    trace_mapping: {
      step_to_viewpoint: {},  // ステップ番号 → 観点マッピング
      assertion_to_concern: {}, // アサーション → 検証観点マッピング
      element_to_purpose: {}  // 要素 → 目的マッピング
    }
  };
  
  return complexTestMetadata;
}

// 観点から主要関心事を抽出
function extractPrimaryConcern(viewpoint) {
  const concerns = {
    'select要素': 'プルダウン選択操作',
    'input要素': 'テキスト入力操作', 
    'button要素': 'ボタン押下操作',
    'form送信': 'フォーム処理',
    '画面遷移': 'ナビゲーション',
    'バリデーション': '入力検証'
  };
  
  for (const [keyword, concern] of Object.entries(concerns)) {
    if (viewpoint.includes(keyword)) {
      return concern;
    }
  }
  return '汎用操作';
}

// 検証観点を抽出
function extractValidationAspects(viewpoint) {
  const aspects = [];
  
  if (viewpoint.includes('選択')) aspects.push('選択可能性');
  if (viewpoint.includes('入力')) aspects.push('入力可能性');
  if (viewpoint.includes('表示')) aspects.push('表示確認');
  if (viewpoint.includes('エラー')) aspects.push('エラーハンドリング');
  if (viewpoint.includes('遷移')) aspects.push('画面遷移');
  if (viewpoint.includes('値')) aspects.push('値の正確性');
  
  return aspects.length > 0 ? aspects : ['基本動作確認'];
}