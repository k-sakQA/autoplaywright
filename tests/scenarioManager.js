/**
 * AutoPlaywright シナリオ管理システム
 * 複数のテストシナリオを効率的に管理・実行
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse as csvParse, stringify as csvStringify } from 'csv-parse/sync';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class ScenarioManager {
  constructor() {
    this.scenarios = [];
    this.currentScenarioIndex = 0;
    this.resultDir = path.join(__dirname, '..', 'test-results');
  }

  /**
   * CSVファイルからシナリオを読み込み
   */
  async loadScenariosFromCSV(csvPath) {
    try {
      console.log(`📁 シナリオCSV読み込み: ${csvPath}`);
      
      const csvContent = fs.readFileSync(csvPath, 'utf-8');
      const records = csvParse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true
      });

      this.scenarios = records.map((record, index) => ({
        id: record.ID || `auto_${index + 1}`,
        priority: record.優先度 || '中',
        category: record.カテゴリ || '一般',
        name: record.シナリオ名 || `シナリオ${index + 1}`,
        url: record.URL || '',
        userStory: record.ユーザーストーリー || '',
        expectedResult: record.期待結果 || '',
        status: record.実行状況 || '未実行',
        lastExecuted: record.最終実行日時 || null,
        successRate: record.成功率 || null,
        results: []
      }));

      console.log(`✅ ${this.scenarios.length}個のシナリオを読み込みました`);
      return this.scenarios;
    } catch (error) {
      console.error(`❌ シナリオ読み込みエラー: ${error.message}`);
      throw error;
    }
  }

  /**
   * シナリオの実行状況を更新
   */
  updateScenarioStatus(scenarioId, status, results = null) {
    const scenario = this.scenarios.find(s => s.id === scenarioId);
    if (scenario) {
      scenario.status = status;
      scenario.lastExecuted = new Date().toISOString();
      
      if (results) {
        scenario.results.push(results);
        // 成功率計算
        const successCount = scenario.results.filter(r => r.success).length;
        scenario.successRate = Math.round((successCount / scenario.results.length) * 100);
      }
      
      console.log(`📊 シナリオ${scenarioId}の状況更新: ${status}`);
    }
  }

  /**
   * 指定された条件でシナリオをフィルタリング
   */
  getScenariosByFilter(filter = 'all') {
    switch (filter) {
      case 'pending':
        return this.scenarios.filter(s => s.status === '未実行');
      case 'failed':
        return this.scenarios.filter(s => s.status === '失敗');
      case 'high':
        return this.scenarios.filter(s => s.priority === '高');
      case 'selected':
        return this.scenarios.filter(s => s.selected === true);
      default:
        return this.scenarios;
    }
  }

  /**
   * 次に実行するシナリオを取得
   */
  getNextScenario() {
    const pendingScenarios = this.getScenariosByFilter('pending');
    if (pendingScenarios.length > 0) {
      return pendingScenarios[0];
    }
    
    const failedScenarios = this.getScenariosByFilter('failed');
    if (failedScenarios.length > 0) {
      return failedScenarios[0];
    }
    
    return null;
  }

  /**
   * シナリオ実行完了後の選択肢を生成
   */
  generateNextActions(completedScenario) {
    const nextScenario = this.getNextScenario();
    const actions = [];

    // 1. 新しいシナリオ探索
    actions.push({
      id: 'discover',
      label: '🔍 新しいシナリオを探索 (AI発見機能)',
      description: '現在のテスト結果から新しいテストシナリオを自動生成'
    });

    // 2. 次のシナリオ実行
    if (nextScenario) {
      actions.push({
        id: 'next',
        label: `➡️ 次のシナリオ (${nextScenario.id}: ${nextScenario.name}) を実行`,
        description: `${nextScenario.category}カテゴリの${nextScenario.priority}優先度テスト`,
        scenario: nextScenario
      });
    }

    // 3. 結果サマリー
    actions.push({
      id: 'summary',
      label: '📊 結果サマリーを表示',
      description: '全シナリオの実行状況と統計情報を確認'
    });

    // 4. 一時停止
    actions.push({
      id: 'pause',
      label: '⏸️ 一時停止',
      description: 'シナリオ実行を一時停止'
    });

    return actions;
  }

  /**
   * 結果をCSV形式でエクスポート
   */
  async exportResults() {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `scenario_results_${timestamp}.csv`;
      const filepath = path.join(this.resultDir, filename);

      const csvData = this.scenarios.map(scenario => ({
        ID: scenario.id,
        優先度: scenario.priority,
        カテゴリ: scenario.category,
        シナリオ名: scenario.name,
        URL: scenario.url,
        ユーザーストーリー: scenario.userStory,
        期待結果: scenario.expectedResult,
        実行状況: scenario.status,
        最終実行日時: scenario.lastExecuted,
        成功率: scenario.successRate || 0
      }));

      const csvString = csvStringify(csvData, { header: true });
      fs.writeFileSync(filepath, csvString, 'utf-8');

      console.log(`📊 結果エクスポート完了: ${filename}`);
      return filepath;
    } catch (error) {
      console.error(`❌ エクスポートエラー: ${error.message}`);
      throw error;
    }
  }

  /**
   * シナリオ実行統計を取得
   */
  getStatistics() {
    const total = this.scenarios.length;
    const completed = this.scenarios.filter(s => s.status === '成功' || s.status === '失敗').length;
    const success = this.scenarios.filter(s => s.status === '成功').length;
    const failed = this.scenarios.filter(s => s.status === '失敗').length;
    const pending = this.scenarios.filter(s => s.status === '未実行').length;

    return {
      total,
      completed,
      success,
      failed,
      pending,
      successRate: total > 0 ? Math.round((success / total) * 100) : 0,
      completionRate: total > 0 ? Math.round((completed / total) * 100) : 0
    };
  }
}

// CLI実行時の処理
if (import.meta.url === `file://${process.argv[1]}`) {
  const manager = new ScenarioManager();
  
  // 使用例
  if (process.argv[2] === '--load' && process.argv[3]) {
    await manager.loadScenariosFromCSV(process.argv[3]);
    console.log('📋 読み込まれたシナリオ:');
    console.table(manager.scenarios);
  }
}

export default ScenarioManager; 