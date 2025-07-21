import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { createObjectCsvStringifier } from 'csv-writer';
import { parse } from 'csv-parse/sync';

/**
 * テスト観点と機能の自動マッピングを行うクラス
 * 要件: 観点-機能マッピング
 */
export class TestPointFunctionMapper {
  constructor(config = {}) {
    this.mappingMatrix = new Map();
    this.functionCatalog = new Map();
    this.config = {
      aiAssisted: true,
      confidenceThreshold: 0.7,
      ...config
    };
    
    // OpenAI設定（既存の設定を使用）
    this.openai = null;
    this.initializeAI();
  }
  
  /**
   * AI機能の初期化
   */
  async initializeAI() {
    try {
      const configPath = path.join(process.cwd(), 'config.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config.openaiApiKey) {
          this.openai = new OpenAI({
            apiKey: config.openaiApiKey
          });
          console.log('✅ OpenAI API初期化完了');
        }
      }
    } catch (error) {
      console.warn('⚠️ OpenAI API初期化失敗:', error.message);
    }
  }
  
  /**
   * CSV形式のテスト観点データを読み込み、機能との関連付けを行う
   * @param {string} csvPath テスト観点CSVファイルパス
   * @param {Array} functionDefinitions 機能定義配列
   */
  async loadTestPointMappings(csvPath, functionDefinitions = []) {
    try {
      console.log('📊 テスト観点マッピング開始...');
      
      const testPoints = await this.parseTestPointCSV(csvPath);
      const functions = this.prepareFunctionDefinitions(functionDefinitions);
      
      console.log(`✅ テスト観点: ${testPoints.length}件`);
      console.log(`✅ 機能定義: ${functions.length}件`);
      
      // AI支援による自動マッピング
      for (const testPoint of testPoints) {
        const relatedFunctions = await this.suggestRelatedFunctions(testPoint, functions);
        
        this.mappingMatrix.set(testPoint.id, {
          ...testPoint,
          relatedFunctions,
          mappingConfidence: this.calculateMappingConfidence(testPoint, relatedFunctions),
          lastUpdated: new Date().toISOString()
        });
      }
      
      console.log(`🎯 マッピング完了: ${this.mappingMatrix.size}件`);
      return this.mappingMatrix;
      
    } catch (error) {
      console.error('❌ テスト観点マッピングエラー:', error);
      throw error;
    }
  }
  
  /**
   * CSV形式のテスト観点データを解析
   * @param {string} csvPath CSVファイルパス
   * @returns {Array} 解析されたテスト観点配列
   */
  async parseTestPointCSV(csvPath) {
    try {
      if (!fs.existsSync(csvPath)) {
        console.warn('⚠️ テスト観点CSVファイルが見つかりません:', csvPath);
        return [];
      }
      
      const csvContent = fs.readFileSync(csvPath, 'utf8');
      const records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        encoding: 'utf8'
      });
      
      return records.map((record, index) => ({
        id: record['ID'] || record['テスト観点ID'] || `TP${String(index + 1).padStart(3, '0')}`,
        category: record['大分類'] || record['Category'] || '',
        subCategory: record['中分類'] || record['SubCategory'] || '',
        detailCategory: record['小分類'] || record['DetailCategory'] || '',
        testPerspective: record['テスト観点'] || record['TestPerspective'] || '',
        businessScenario: record['ビジネスシナリオ'] || record['BusinessScenario'] || '',
        priority: this.normalizePriority(record['優先度'] || record['Priority'] || 'medium'),
        expectedAction: record['期待アクション'] || record['ExpectedAction'] || ''
      }));
      
    } catch (error) {
      console.error('❌ CSV解析エラー:', error);
      return [];
    }
  }
  
  /**
   * 機能定義データを準備
   * @param {Array} functionDefinitions 機能定義配列
   * @returns {Array} 標準化された機能定義
   */
  prepareFunctionDefinitions(functionDefinitions) {
    // ルートからの機能検出結果を使用
    if (Array.isArray(functionDefinitions)) {
      return functionDefinitions.map(func => ({
        name: func.name || func,
        description: func.description || `${func}機能`,
        category: func.category || 'general'
      }));
    }
    
    // デフォルト機能セット
    return [
      { name: '宿泊日選択', description: '宿泊日の選択機能', category: 'input' },
      { name: '宿泊数入力', description: '宿泊数の入力機能', category: 'input' },
      { name: '追加プラン選択', description: '追加プランの選択機能', category: 'selection' },
      { name: '画面表示', description: '画面レイアウトとUI表示', category: 'display' },
      { name: 'フォーム操作', description: 'フォーム入力と操作', category: 'form' },
      { name: 'ナビゲーション', description: 'ページ間の移動', category: 'navigation' }
    ];
  }
  
  /**
   * AIを使用してテスト観点と機能の関連性を分析
   * @param {Object} testPoint テスト観点オブジェクト
   * @param {Array} functions 機能配列
   * @returns {Array} 関連機能配列
   */
  async suggestRelatedFunctions(testPoint, functions) {
    if (!this.openai || !this.config.aiAssisted) {
      console.log('🔄 AI無効のため、キーワードベースマッピング使用');
      return this.keywordBasedMapping(testPoint, functions);
    }
    
    const prompt = `
テスト観点分析タスク:

## テスト観点情報
- ID: ${testPoint.id}
- カテゴリ: ${testPoint.category} > ${testPoint.subCategory} > ${testPoint.detailCategory}
- テスト観点: ${testPoint.testPerspective}
- ビジネスシナリオ: ${testPoint.businessScenario}

## 利用可能な機能一覧
${functions.map(f => `- ${f.name}: ${f.description} (カテゴリ: ${f.category})`).join('\n')}

## 分析要求
このテスト観点に関連する機能を分析し、関連度の高い順に選択してください。
関連機能は最大5個まで、関連度0.5以上のもののみ選択してください。

## 回答形式
JSON配列のみで回答してください:
["機能名1", "機能名2", "機能名3"]

## 判断基準
- テスト観点の内容と機能の目的が一致するか
- ビジネスシナリオでの関連性
- 実際のテスト実行で検証される機能か
    `;
    
    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4-turbo-preview',
        messages: [
          {
            role: 'system',
            content: 'あなたはテスト設計の専門家です。テスト観点と機能の関連性を正確に分析してください。'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 500
      });
      
      const content = response.choices[0].message.content.trim();
      const relatedFunctions = JSON.parse(content);
      
      // 有効な機能名のみフィルタリング
      const validFunctions = relatedFunctions.filter(funcName => 
        functions.some(f => f.name === funcName)
      );
      
      console.log(`🤖 AI分析完了 - ${testPoint.id}: ${validFunctions.length}件の関連機能`);
      return validFunctions;
      
    } catch (error) {
      console.warn(`⚠️ AI分析失敗 (${testPoint.id}):`, error.message);
      return this.keywordBasedMapping(testPoint, functions);
    }
  }
  
  /**
   * キーワードベースのマッピング（AIフォールバック）
   * @param {Object} testPoint テスト観点
   * @param {Array} functions 機能配列
   * @returns {Array} 関連機能配列
   */
  keywordBasedMapping(testPoint, functions) {
    const keywords = [
      testPoint.testPerspective,
      testPoint.category,
      testPoint.subCategory,
      testPoint.detailCategory
    ].join(' ').toLowerCase();
    
    const mappingRules = {
      '表示': ['画面表示', 'レイアウト確認'],
      '入力': ['フォーム操作', 'データ入力'],
      '選択': ['選択機能', 'オプション設定'],
      'ui': ['画面表示', 'ユーザーインターフェース'],
      'form': ['フォーム操作', 'データ入力'],
      'navigation': ['ナビゲーション', 'ページ移動']
    };
    
    const relatedFunctions = [];
    
    for (const [keyword, funcs] of Object.entries(mappingRules)) {
      if (keywords.includes(keyword)) {
        funcs.forEach(funcName => {
          const matchingFunc = functions.find(f => 
            f.name.includes(funcName) || f.description.includes(funcName)
          );
          if (matchingFunc && !relatedFunctions.includes(matchingFunc.name)) {
            relatedFunctions.push(matchingFunc.name);
          }
        });
      }
    }
    
    // キーワードマッチがない場合は汎用機能を追加
    if (relatedFunctions.length === 0) {
      relatedFunctions.push('画面表示');
    }
    
    return relatedFunctions.slice(0, 3); // 最大3件
  }
  
  /**
   * マッピング信頼度を計算
   * @param {Object} testPoint テスト観点
   * @param {Array} relatedFunctions 関連機能
   * @returns {number} 信頼度 (0-1)
   */
  calculateMappingConfidence(testPoint, relatedFunctions) {
    let confidence = 0.5; // ベース信頼度
    
    // AI分析が使用された場合
    if (this.openai && this.config.aiAssisted) {
      confidence += 0.3;
    }
    
    // 関連機能数による調整
    if (relatedFunctions.length > 0) {
      confidence += Math.min(relatedFunctions.length * 0.1, 0.2);
    }
    
    // テスト観点の詳細度による調整
    if (testPoint.testPerspective && testPoint.testPerspective.length > 10) {
      confidence += 0.1;
    }
    
    return Math.min(confidence, 1.0);
  }
  
  /**
   * 優先度の標準化
   * @param {string} priority 優先度文字列
   * @returns {string} 標準化された優先度
   */
  normalizePriority(priority) {
    const p = priority.toLowerCase();
    if (p.includes('high') || p.includes('高')) return 'high';
    if (p.includes('low') || p.includes('低')) return 'low';
    return 'medium';
  }
  
  /**
   * マッピングマトリックスを取得
   * @returns {Map} マッピングマトリックス
   */
  getMappingMatrix() {
    return this.mappingMatrix;
  }
  
  /**
   * 特定のテスト観点の関連機能を取得
   * @param {string} testPointId テスト観点ID
   * @returns {Array} 関連機能配列
   */
  getRelatedFunctions(testPointId) {
    const mapping = this.mappingMatrix.get(testPointId);
    return mapping ? mapping.relatedFunctions : [];
  }
  
  /**
   * マッピング結果をCSVで出力
   * @param {string} outputPath 出力パス
   */
  async exportMappingToCSV(outputPath) {
    try {
      const csvData = Array.from(this.mappingMatrix.values()).map(mapping => ({
        'テスト観点ID': mapping.id,
        '大分類': mapping.category,
        '中分類': mapping.subCategory,
        '小分類': mapping.detailCategory,
        'テスト観点': mapping.testPerspective,
        '関連機能': mapping.relatedFunctions.join(', '),
        '信頼度': mapping.mappingConfidence.toFixed(2),
        '更新日時': mapping.lastUpdated
      }));
      
      const csvStringifier = createObjectCsvStringifier({
        header: Object.keys(csvData[0] || {}).map(key => ({ id: key, title: key }))
      });
      
      const csvContent = csvStringifier.getHeaderString() + csvStringifier.stringifyRecords(csvData);
      fs.writeFileSync(outputPath, csvContent, 'utf8');
      
      console.log(`✅ マッピング結果をCSV出力: ${outputPath}`);
      
    } catch (error) {
      console.error('❌ CSV出力エラー:', error);
    }
  }
  
  /**
   * 統計情報を取得
   * @returns {Object} 統計情報オブジェクト
   */
  getStatistics() {
    const mappings = Array.from(this.mappingMatrix.values());
    
    return {
      totalTestPoints: mappings.length,
      totalMappings: mappings.reduce((sum, m) => sum + m.relatedFunctions.length, 0),
      averageConfidence: mappings.reduce((sum, m) => sum + m.mappingConfidence, 0) / mappings.length,
      categoryDistribution: this.getCategoryDistribution(mappings),
      functionUsage: this.getFunctionUsage(mappings)
    };
  }
  
  /**
   * カテゴリ分布を取得
   * @param {Array} mappings マッピング配列
   * @returns {Object} カテゴリ分布
   */
  getCategoryDistribution(mappings) {
    const distribution = {};
    mappings.forEach(mapping => {
      const category = mapping.category;
      distribution[category] = (distribution[category] || 0) + 1;
    });
    return distribution;
  }
  
  /**
   * 機能使用頻度を取得
   * @param {Array} mappings マッピング配列
   * @returns {Object} 機能使用頻度
   */
  getFunctionUsage(mappings) {
    const usage = {};
    mappings.forEach(mapping => {
      mapping.relatedFunctions.forEach(func => {
        usage[func] = (usage[func] || 0) + 1;
      });
    });
    return usage;
  }
} 