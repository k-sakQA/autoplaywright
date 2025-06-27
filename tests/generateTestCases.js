#!/usr/bin/env node

/**
 * テスト観点を自然言語のテストケースに変換する中間処理ファイル
 * generateTestPoints.js の出力JSONを受け取り、理解しやすい自然言語テストケースを生成
 * 後続のgenerateSmartRoutes.jsでDOM解析と組み合わせてPlaywright実装に変換される
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class NaturalLanguageTestCaseGenerator {
  constructor() {
    this.outputDir = path.join(__dirname, '../test-results');
  }

  /**
   * テスト観点JSONファイルを読み込み
   * @param {string} testPointsFile - テスト観点JSONファイルパス
   * @returns {Array} テスト観点配列
   */
  loadTestPoints(testPointsFile) {
    try {
      const filePath = path.isAbsolute(testPointsFile) 
        ? testPointsFile 
        : path.join(__dirname, testPointsFile);
      
      console.log(`📊 テスト観点JSONファイルを読み込み中: ${filePath}`);
      
      if (!fs.existsSync(filePath)) {
        throw new Error(`テスト観点ファイルが見つかりません: ${filePath}`);
      }

      const data = fs.readFileSync(filePath, 'utf8');
      
      console.log('📄 JSON形式として読み込み中...');
      const parsedData = JSON.parse(data);
      const testPoints = Array.isArray(parsedData) ? parsedData : [parsedData];
      
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
  generateNaturalLanguageTestCase(viewpoint, category, index) {
    const testCaseId = `NL_TC_${Date.now()}_${index.toString().padStart(3, '0')}`;
    
    // 基本的なテストケース構造
    const testCase = {
      id: testCaseId,
      original_viewpoint: viewpoint,
      category: category,
      priority: this.determinePriority(viewpoint),
      test_scenarios: [],
      expected_results: [],
      test_data: [],
      preconditions: [],
      metadata: {
        generated_at: new Date().toISOString(),
        source: 'generateTestCases.js',
        version: '2.0.0',
        type: 'natural_language'
      }
    };

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
   * 表示確認系自然言語テストケース
   */
  generateDisplayTestCase(baseCase, viewpoint) {
    baseCase.test_scenarios = [
      "対象ページにアクセスする",
      "ページが完全に読み込まれるまで待機する",
      "各UI要素が正しく配置されていることを確認する",
      "文字が正しく表示され、文字化けや文字切れがないことを確認する",
      "レイアウトが崩れていないことを確認する"
    ];

    baseCase.expected_results = [
      "ページが正常に表示される",
      "すべてのUI要素が意図された位置に配置されている",
      "テキストが読みやすく表示されている",
      "レスポンシブデザインが適切に機能している"
    ];

    baseCase.preconditions = [
      "対象ページのURLが有効である",
      "ブラウザが正常に動作している"
    ];

    return baseCase;
  }

  /**
   * 入力検証系自然言語テストケース
   */
  generateInputValidationTestCase(baseCase, viewpoint) {
    baseCase.test_scenarios = [
      "対象ページにアクセスする",
      "入力フィールドを特定する",
      "有効な値を入力して正常動作を確認する",
      "無効な値（空文字、特殊文字、長すぎる文字列等）を入力する",
      "バリデーションメッセージが適切に表示されることを確認する",
      "フォーム送信時の動作を確認する"
    ];

    baseCase.expected_results = [
      "有効な値は正常に受け入れられる",
      "無効な値に対して適切なエラーメッセージが表示される",
      "必須項目が未入力の場合、送信が阻止される",
      "入力値の制限が正しく機能している"
    ];

    baseCase.test_data = [
      { type: "valid", description: "正常な入力値" },
      { type: "invalid_empty", description: "空文字" },
      { type: "invalid_special", description: "特殊文字" },
      { type: "invalid_length", description: "文字数制限超過" }
    ];

    baseCase.preconditions = [
      "フォームページにアクセス可能である",
      "入力フィールドが表示されている"
    ];

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
   * テストケース群を生成
   * @param {Array} testPoints - テスト観点配列
   * @returns {Array} 生成された自然言語テストケース配列
   */
  generateNaturalLanguageTestCases(testPoints) {
    console.log('🔄 自然言語テストケース生成を開始...');
    
    const testCases = [];
    
    testPoints.forEach((point, index) => {
      const viewpoint = point['考慮すべき仕様の具体例'] || point.description || `テスト観点${index + 1}`;
      const category = this.categorizeViewpoint(viewpoint);
      
      console.log(`📝 ${index + 1}. カテゴリ: ${category}, 観点: ${viewpoint.substring(0, 50)}...`);
      
      const testCase = this.generateNaturalLanguageTestCase(viewpoint, category, index + 1);
      testCases.push(testCase);
    });
    
    console.log(`✅ ${testCases.length}件の自然言語テストケースを生成しました`);
    return testCases;
  }

  /**
   * テストケースを保存
   * @param {Array} testCases - テストケース配列
   * @param {string} outputFileName - 出力ファイル名
   * @returns {string} 保存されたファイルパス
   */
  saveNaturalLanguageTestCases(testCases, outputFileName = null) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
    const fileName = outputFileName || `naturalLanguageTestCases_${timestamp}.json`;
    const filePath = path.join(this.outputDir, fileName);
    
    const outputData = {
      metadata: {
        generated_at: new Date().toISOString(),
        total_test_cases: testCases.length,
        categories: this.getCategorySummary(testCases),
        generator_version: '2.0.0',
        type: 'natural_language_test_cases',
        description: 'DOM解析前の自然言語テストケース。generateSmartRoutes.jsで実装形式に変換される。'
      },
      testCases: testCases
    };
    
    fs.writeFileSync(filePath, JSON.stringify(outputData, null, 2), 'utf8');
    
    console.log(`💾 自然言語テストケースを保存しました: ${filePath}`);
    console.log(`📊 生成統計:`);
    console.log(`   - 総テストケース数: ${testCases.length}`);
    
    Object.entries(outputData.metadata.categories).forEach(([category, count]) => {
      console.log(`   - ${category}: ${count}件`);
    });
    
    return filePath;
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
   * @param {string} outputFile - 出力ファイル名（オプション）
   */
  async run(testPointsFile, outputFile = null) {
    try {
      console.log('🚀 自然言語テストケース生成を開始します...');
      console.log(`📊 入力ファイル: ${testPointsFile}`);
      
      // 1. テスト観点を読み込み
      const testPoints = this.loadTestPoints(testPointsFile);
      
      // 2. 自然言語テストケースを生成
      const testCases = this.generateNaturalLanguageTestCases(testPoints);
      
      // 3. テストケースを保存
      const savedFilePath = this.saveNaturalLanguageTestCases(testCases, outputFile);
      
      console.log('✅ 自然言語テストケース生成が完了しました！');
      console.log('🔄 次のステップ: generateSmartRoutes.js でDOM解析とPlaywright実装に変換');
      return savedFilePath;
      
    } catch (error) {
      console.error('❌ 自然言語テストケース生成に失敗:', error.message);
      throw error;
    }
  }
}

// CLI実行時の処理
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
🔧 使用方法:
  node generateTestCases.js <testPointsJsonFile> [outputFile]
  
📋 例:
  node generateTestCases.js testPoints_250626114042.json
  node generateTestCases.js testPoints_250626114042.json myNaturalTestCases.json
  
📊 機能:
  - generateTestPoints.jsで生成されたテスト観点JSONから自然言語テストケースを生成
  - 理解しやすい日本語でテストシナリオを記述
  - DOM解析やPlaywright実装は含まない（generateSmartRoutes.jsで実装）
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
  
  const generator = new NaturalLanguageTestCaseGenerator();
  const testPointsFile = args[0];
  const outputFile = args[1] || null;
  
  generator.run(testPointsFile, outputFile)
    .then(filePath => {
      console.log(`🎉 自然言語テストケース生成完了: ${filePath}`);
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ 処理失敗:', error.message);
      process.exit(1);
    });
}

export default NaturalLanguageTestCaseGenerator; 