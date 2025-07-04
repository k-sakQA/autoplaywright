#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import USISDirectoryManager from './utils/usisDirectoryManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * USISディレクトリ管理 CLIツール
 * Usage:
 *   node tests/manageDirectories.js migrate         # レガシーファイル移行
 *   node tests/manageDirectories.js report          # 使用状況レポート
 *   node tests/manageDirectories.js cleanup         # クリーンアップ
 *   node tests/manageDirectories.js init [USIS]     # 構造初期化
 */

class DirectoryManagerCLI {
  constructor() {
    this.manager = new USISDirectoryManager({
      baseDir: path.join(process.cwd(), 'test-results'),
      enableLegacyMigration: true,
      dryRun: false
    });
  }

  /**
   * コマンドラインツールのメイン処理
   */
  async run() {
    const args = process.argv.slice(2);
    const command = args[0];

    console.log('🏗️ AutoPlaywright USIS ディレクトリマネージャー');
    console.log('='.repeat(60));

    switch (command) {
      case 'migrate':
        await this.handleMigrate(args.slice(1));
        break;
      case 'report':
        await this.handleReport(args.slice(1));
        break;
      case 'cleanup':
        await this.handleCleanup(args.slice(1));
        break;
      case 'init':
        await this.handleInit(args.slice(1));
        break;
      case 'demo':
        await this.handleDemo(args.slice(1));
        break;
      case 'help':
      case '--help':
      case '-h':
        this.showHelp();
        break;
      default:
        console.error(`❌ 不明なコマンド: ${command || '(未指定)'}`);
        this.showHelp();
        process.exit(1);
    }
  }

  /**
   * レガシーファイル移行処理
   */
  async handleMigrate(args) {
    const options = this.parseOptions(args, {
      'dry-run': false,
      'force': false,
      'backup': true
    });

    console.log('\n🔄 レガシーファイル移行を開始...');
    
    if (options['dry-run']) {
      console.log('🔍 ドライランモード: 実際のファイル移動は行いません');
      this.manager.dryRun = true;
    }

    if (options.backup) {
      await this.createBackup();
    }

    try {
      await this.manager.migrateLegacyFiles();
      console.log('\n✅ レガシーファイル移行が完了しました！');
      
      // 移行後の使用状況を表示
      console.log('\n📊 移行後の状況:');
      this.manager.generateUsageReport();
      
    } catch (error) {
      console.error('\n❌ 移行処理中にエラーが発生しました:', error.message);
      process.exit(1);
    }
  }

  /**
   * 使用状況レポート生成
   */
  async handleReport(args) {
    const options = this.parseOptions(args, {
      'detailed': false,
      'export': null
    });

    console.log('\n📊 ディレクトリ使用状況分析中...');
    
    const usage = this.manager.generateUsageReport();
    
    if (options.detailed) {
      console.log('\n📋 詳細情報:');
      this.showDetailedReport(usage);
    }

    if (options.export) {
      const reportPath = await this.exportReport(usage, options.export);
      console.log(`\n💾 レポートをエクスポートしました: ${reportPath}`);
    }

    // 改善提案を表示
    this.showOptimizationSuggestions(usage);
  }

  /**
   * クリーンアップ処理
   */
  async handleCleanup(args) {
    const options = this.parseOptions(args, {
      'empty-dirs': true,
      'old-files': true,
      'days': 30,
      'dry-run': false
    });

    console.log('\n🧹 ディレクトリクリーンアップを開始...');
    
    if (options['dry-run']) {
      console.log('🔍 ドライランモード: 実際のファイル削除は行いません');
      this.manager.dryRun = true;
    }

    const cleanupOptions = {
      removeEmptyDirectories: options['empty-dirs'],
      archiveOldFiles: options['old-files'],
      daysThreshold: parseInt(options.days)
    };

    try {
      await this.manager.cleanup(cleanupOptions);
      console.log('\n✅ クリーンアップが完了しました！');
    } catch (error) {
      console.error('\n❌ クリーンアップ中にエラーが発生しました:', error.message);
      process.exit(1);
    }
  }

  /**
   * ディレクトリ構造初期化
   */
  async handleInit(args) {
    const userStoryId = args[0] ? parseInt(args[0]) : null;
    
    if (userStoryId) {
      console.log(`\n🏗️ USIS-${userStoryId} ディレクトリ構造を初期化...`);
    } else {
      console.log('\n🏗️ 基本ディレクトリ構造を初期化...');
    }

    try {
      this.manager.initializeStructure(userStoryId);
      console.log('\n✅ ディレクトリ構造の初期化が完了しました！');
      
      // 初期化後の構造を表示
      this.manager.generateUsageReport();
      
    } catch (error) {
      console.error('\n❌ 初期化中にエラーが発生しました:', error.message);
      process.exit(1);
    }
  }

  /**
   * デモ実行
   */
  async handleDemo(args) {
    console.log('\n🎬 USIS ディレクトリ管理デモを開始...');
    console.log('このデモでは、サンプルファイルを作成してディレクトリ管理機能を実演します。\n');

    // サンプルデータ作成
    await this.createSampleData();
    
    // 移行前の状況表示
    console.log('📋 移行前の状況:');
    this.manager.generateUsageReport();
    
    // 移行実行
    console.log('\n🔄 サンプルファイルの移行を実行...');
    await this.manager.migrateLegacyFiles();
    
    // 移行後の状況表示
    console.log('\n📋 移行後の状況:');
    this.manager.generateUsageReport();
    
    console.log('\n🎉 デモが完了しました！');
    console.log('実際のファイルに影響を与えないよう、デモファイルは作成されていません。');
  }

  /**
   * バックアップ作成
   */
  async createBackup() {
    const backupDir = path.join(process.cwd(), 'test-results-backup');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupPath = path.join(backupDir, `backup_${timestamp}`);

    console.log(`💾 バックアップ作成中: ${backupPath}`);
    
    try {
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      // test-resultsディレクトリの内容をコピー
      const sourceDir = path.join(process.cwd(), 'test-results');
      if (fs.existsSync(sourceDir)) {
        await this.copyDirectory(sourceDir, backupPath);
        console.log(`✅ バックアップ完了: ${backupPath}`);
      } else {
        console.log('⚠️ test-resultsディレクトリが存在しないため、バックアップをスキップします');
      }
    } catch (error) {
      console.error('❌ バックアップ作成エラー:', error.message);
      throw error;
    }
  }

  /**
   * ディレクトリコピー（再帰的）
   */
  async copyDirectory(src, dest) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });
    
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      
      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /**
   * 詳細レポート表示
   */
  showDetailedReport(usage) {
    console.log('\n📁 ファイル配布詳細:');
    
    Object.entries(usage.byUSIS).forEach(([userStoryId, stats]) => {
      console.log(`\n  📂 USIS-${userStoryId}:`);
      Object.entries(stats.subdirectories).forEach(([subdir, substats]) => {
        if (substats.files > 0) {
          console.log(`    📄 ${subdir}: ${substats.files}ファイル (${this.manager.formatFileSize(substats.size)})`);
        }
      });
    });

    if (usage.common.files > 0) {
      console.log(`\n  🔧 共通ファイル: ${usage.common.files}ファイル (${this.manager.formatFileSize(usage.common.size)})`);
    }
  }

  /**
   * 最適化提案を表示
   */
  showOptimizationSuggestions(usage) {
    console.log('\n💡 最適化提案:');
    
    const totalUSIS = Object.keys(usage.byUSIS).length;
    const totalFiles = usage.totalFiles;
    
    if (totalUSIS === 0) {
      console.log('  ⚠️ USIS構造が設定されていません。`migrate`コマンドで移行を実行してください。');
    } else if (totalUSIS > 10) {
      console.log('  📦 多数のUSISディレクトリが存在します。古いものをアーカイブすることを検討してください。');
    }
    
    if (totalFiles > 100) {
      console.log('  🧹 大量のファイルが存在します。`cleanup`コマンドでクリーンアップを実行してください。');
    }
    
    // ファイル分布の分析
    const averageFilesPerUSIS = totalUSIS > 0 ? totalFiles / totalUSIS : 0;
    if (averageFilesPerUSIS > 20) {
      console.log('  📊 USIS当たりのファイル数が多めです。定期的なアーカイブを検討してください。');
    }
  }

  /**
   * レポートエクスポート
   */
  async exportReport(usage, format) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `directory_usage_${timestamp}.${format}`;
    const filepath = path.join(process.cwd(), 'test-results', filename);

    try {
      if (format === 'json') {
        fs.writeFileSync(filepath, JSON.stringify(usage, null, 2), 'utf-8');
      } else if (format === 'csv') {
        const csvContent = this.generateCSVReport(usage);
        fs.writeFileSync(filepath, csvContent, 'utf-8');
      } else {
        throw new Error(`サポートされていないフォーマット: ${format}`);
      }
      
      return filepath;
    } catch (error) {
      console.error('レポートエクスポートエラー:', error.message);
      throw error;
    }
  }

  /**
   * CSVレポート生成
   */
  generateCSVReport(usage) {
    const rows = [
      ['Type', 'USIS', 'Subdirectory', 'Files', 'Size_Bytes', 'Size_Formatted']
    ];

    // USIS別データ
    Object.entries(usage.byUSIS).forEach(([userStoryId, stats]) => {
      Object.entries(stats.subdirectories).forEach(([subdir, substats]) => {
        rows.push([
          'USIS',
          userStoryId,
          subdir,
          substats.files,
          substats.size,
          this.manager.formatFileSize(substats.size)
        ]);
      });
    });

    // 共通データ
    rows.push([
      'Common',
      '-',
      'all',
      usage.common.files,
      usage.common.size,
      this.manager.formatFileSize(usage.common.size)
    ]);

    return rows.map(row => row.join(',')).join('\n');
  }

  /**
   * サンプルデータ作成（デモ用）
   */
  async createSampleData() {
    console.log('📝 サンプルデータを生成中...');
    
    const sampleFiles = [
      {
        name: 'result_sample_001.json',
        content: JSON.stringify({
          userStoryId: 1,
          timestamp: new Date().toISOString(),
          success: true,
          steps: []
        }, null, 2)
      },
      {
        name: 'route_sample_001.json',
        content: JSON.stringify({
          userStoryId: 2,
          route_id: 'sample_001',
          steps: []
        }, null, 2)
      },
      {
        name: 'naturalLanguageTestCases_sample.json',
        content: JSON.stringify({
          userStoryId: 1,
          testCases: []
        }, null, 2)
      }
    ];

    // メモリ内でのシミュレーション（実際のファイル作成はしない）
    console.log(`   ✅ ${sampleFiles.length}個のサンプルファイルを準備しました`);
    console.log('   📁 サンプルファイル:');
    sampleFiles.forEach(file => {
      console.log(`      - ${file.name}`);
    });
  }

  /**
   * オプション解析
   */
  parseOptions(args, defaults = {}) {
    const options = { ...defaults };
    
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      
      if (arg.startsWith('--')) {
        const key = arg.substring(2);
        const nextArg = args[i + 1];
        
        if (nextArg && !nextArg.startsWith('--')) {
          options[key] = nextArg;
          i++; // 次の引数をスキップ
        } else {
          options[key] = true;
        }
      }
    }
    
    return options;
  }

  /**
   * ヘルプ表示
   */
  showHelp() {
    console.log(`
🏗️ AutoPlaywright USIS ディレクトリマネージャー

USAGE:
  node tests/manageDirectories.js <command> [options]

COMMANDS:
  migrate    レガシーファイルをUSIS別ディレクトリに移行
  report     ディレクトリ使用状況のレポートを生成
  cleanup    古いファイルと空ディレクトリのクリーンアップ
  init       ディレクトリ構造を初期化 [USIS ID]
  demo       サンプルデータでデモを実行
  help       このヘルプを表示

MIGRATE OPTIONS:
  --dry-run     実際のファイル移動を行わずシミュレーション
  --force       警告を無視して強制実行
  --backup      移行前にバックアップを作成 (デフォルト: true)

REPORT OPTIONS:
  --detailed    詳細情報を表示
  --export json レポートをJSONファイルに出力
  --export csv  レポートをCSVファイルに出力

CLEANUP OPTIONS:
  --empty-dirs  空ディレクトリを削除 (デフォルト: true)
  --old-files   古いファイルをアーカイブ (デフォルト: true)
  --days N      アーカイブ対象の日数 (デフォルト: 30)
  --dry-run     実際の削除を行わずシミュレーション

EXAMPLES:
  # レガシーファイルを移行（ドライラン）
  node tests/manageDirectories.js migrate --dry-run

  # 使用状況レポートを詳細表示＆JSON出力
  node tests/manageDirectories.js report --detailed --export json

  # 30日以上古いファイルをクリーンアップ
  node tests/manageDirectories.js cleanup --days 30

  # USIS-5 の構造を初期化
  node tests/manageDirectories.js init 5

  # デモ実行
  node tests/manageDirectories.js demo
`);
  }
}

// メイン実行
if (import.meta.url === `file://${process.argv[1]}`) {
  const cli = new DirectoryManagerCLI();
  cli.run().catch(error => {
    console.error('\n❌ 予期しないエラーが発生しました:', error.message);
    process.exit(1);
  });
} 