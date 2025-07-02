import fs from 'fs';
import path from 'path';

class QuickDuplicateChecker {
  constructor() {
    this.testResultsDir = path.join(process.cwd(), 'test-results');
  }

  /**
   * 重複ファイルの検出と削除
   */
  async checkAndCleanDuplicates() {
    console.log('🧹 重複ファイルの検出・整理を開始します...');
    
    const files = fs.readdirSync(this.testResultsDir);
    const routeFiles = files.filter(f => f.startsWith('fixed_route_') || f.startsWith('ai_generated_route_'));
    
    console.log(`📊 検査対象ファイル: ${routeFiles.length}件`);
    
    const duplicateGroups = this.groupDuplicateFiles(routeFiles);
    const cleanupResults = this.cleanupDuplicates(duplicateGroups);
    
    console.log(`\n🎉 重複整理完了:`);
    console.log(`   - 重複グループ: ${Object.keys(duplicateGroups).length}個`);
    console.log(`   - 削除ファイル: ${cleanupResults.deletedCount}件`);
    console.log(`   - 保持ファイル: ${cleanupResults.keptCount}件`);
    
    return cleanupResults;
  }

  /**
   * 重複ファイルのグループ化
   */
  groupDuplicateFiles(routeFiles) {
    const groups = {};
    
    routeFiles.forEach(filename => {
      const routeId = this.extractRouteId(filename);
      if (!groups[routeId]) {
        groups[routeId] = [];
      }
      groups[routeId].push(filename);
    });
    
    // 重複がないグループを除外
    Object.keys(groups).forEach(routeId => {
      if (groups[routeId].length <= 1) {
        delete groups[routeId];
      }
    });
    
    return groups;
  }

  /**
   * ファイル名からroute_idを抽出
   */
  extractRouteId(filename) {
    // fixed_route_quick_fix_1751447934383_2025-07-02T09-18-54-383Z.json
    // -> quick_fix_1751447934383
    if (filename.startsWith('fixed_route_')) {
      const parts = filename.replace('fixed_route_', '').split('_2025-')[0];
      return parts;
    }
    
    // ai_generated_route_2025-07-02T09-16-42-788Z.json
    // -> ai_generated_route
    if (filename.startsWith('ai_generated_route_')) {
      return 'ai_generated_route';
    }
    
    return filename;
  }

  /**
   * 重複ファイルの整理
   */
  cleanupDuplicates(duplicateGroups) {
    let deletedCount = 0;
    let keptCount = 0;
    
    Object.keys(duplicateGroups).forEach(routeId => {
      const files = duplicateGroups[routeId];
      console.log(`\n🔍 重複グループ「${routeId}」: ${files.length}件`);
      
      // 最新ファイルを特定（タイムスタンプ順）
      const sortedFiles = files.sort((a, b) => {
        const timeA = this.extractTimestamp(a);
        const timeB = this.extractTimestamp(b);
        return timeB.localeCompare(timeA); // 降順（最新が先頭）
      });
      
      const latestFile = sortedFiles[0];
      const duplicates = sortedFiles.slice(1);
      
      console.log(`   ✅ 保持: ${latestFile}`);
      keptCount++;
      
      // 古いファイルを削除
      duplicates.forEach(file => {
        const filePath = path.join(this.testResultsDir, file);
        try {
          fs.unlinkSync(filePath);
          console.log(`   🗑️  削除: ${file}`);
          deletedCount++;
        } catch (error) {
          console.log(`   ❌ 削除失敗: ${file} - ${error.message}`);
        }
      });
    });
    
    return { deletedCount, keptCount };
  }

  /**
   * ファイル名からタイムスタンプを抽出
   */
  extractTimestamp(filename) {
    // 2025-07-02T09-18-54-383Z の部分を抽出
    const timestampMatch = filename.match(/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)/);
    return timestampMatch ? timestampMatch[1] : '';
  }

  /**
   * 実質的重複の事前チェック
   */
  async preCheckForDuplicates(proposedRoute) {
    console.log('🔍 事前重複チェックを実行中...');
    
    const existingFiles = fs.readdirSync(this.testResultsDir)
      .filter(f => f.startsWith('fixed_route_') && f.endsWith('.json'));
    
    if (existingFiles.length === 0) {
      return { shouldProceed: true, reason: '既存ファイルなし' };
    }
    
    // 最新の5ファイルと比較
    const recentFiles = existingFiles
      .sort((a, b) => this.extractTimestamp(b).localeCompare(this.extractTimestamp(a)))
      .slice(0, 5);
    
    for (const file of recentFiles) {
      const filePath = path.join(this.testResultsDir, file);
      try {
        const existingRoute = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const similarity = this.calculateSimpleSimilarity(proposedRoute, existingRoute);
        
        if (similarity > 0.90) {
          return {
            shouldProceed: false,
            reason: `高類似度(${(similarity * 100).toFixed(1)}%)を既存ファイル「${file}」と検出`,
            existingFile: file,
            similarity
          };
        }
      } catch (error) {
        console.log(`⚠️  ファイル読み込みエラー: ${file}`);
      }
    }
    
    return { shouldProceed: true, reason: '新規性あり' };
  }

  /**
   * シンプルな類似度計算
   */
  calculateSimpleSimilarity(route1, route2) {
    const steps1 = route1.steps || [];
    const steps2 = route2.steps || [];
    
    if (steps1.length === 0 && steps2.length === 0) return 1.0;
    if (steps1.length === 0 || steps2.length === 0) return 0.0;
    
    const maxLength = Math.max(steps1.length, steps2.length);
    let matches = 0;
    
    for (let i = 0; i < Math.min(steps1.length, steps2.length); i++) {
      const step1 = steps1[i];
      const step2 = steps2[i];
      
      let stepScore = 0;
      if (step1.action === step2.action) stepScore += 0.4;
      if (step1.target === step2.target) stepScore += 0.4;
      if ((step1.value || '') === (step2.value || '')) stepScore += 0.2;
      
      matches += stepScore;
    }
    
    return matches / maxLength;
  }

  /**
   * 実行推奨案の生成
   */
  generateRecommendations(cleanupResults) {
    const recommendations = [];
    
    if (cleanupResults.deletedCount > 0) {
      recommendations.push({
        type: 'success',
        message: `✅ ${cleanupResults.deletedCount}件の重複ファイルを整理完了`
      });
    }
    
    recommendations.push({
      type: 'suggestion',
      message: `💡 今後は修正ルート生成前に重複チェックを実行してください`,
      command: 'node tests/quickDuplicateChecker.js --pre-check'
    });
    
    if (cleanupResults.keptCount > 10) {
      recommendations.push({
        type: 'warning',
        message: `⚠️  保持ファイル数(${cleanupResults.keptCount})が多いため、定期的な整理を推奨`
      });
    }
    
    return recommendations;
  }
}

// CLI実行
async function main() {
  const checker = new QuickDuplicateChecker();
  
  const args = process.argv.slice(2);
  if (args.includes('--pre-check')) {
    console.log('🔍 事前重複チェックモード');
    // 実際のルートデータが必要な場合のサンプル
    return;
  }
  
  try {
    const results = await checker.checkAndCleanDuplicates();
    const recommendations = checker.generateRecommendations(results);
    
    console.log('\n📋 推奨事項:');
    recommendations.forEach(rec => {
      console.log(`${rec.message}`);
      if (rec.command) {
        console.log(`   コマンド: ${rec.command}`);
      }
    });
    
  } catch (error) {
    console.error('❌ エラーが発生しました:', error.message);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export default QuickDuplicateChecker; 