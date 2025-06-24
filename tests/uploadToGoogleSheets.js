#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import GoogleSheetsUploader from './utils/googleSheetsUploader.js';
import { program } from 'commander';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CLI設定
program
  .name('upload-to-google-sheets')
  .description('テスト結果をGoogle Sheetsにアップロード')
  .option('-c, --credentials <path>', 'Google Sheets API認証ファイルのパス', './credentials.json')
  .option('-s, --spreadsheet-id <id>', 'アップロード先のスプレッドシートID')
  .option('-f, --csv-file <path>', 'アップロードするCSVファイルのパス')
  .option('-t, --title <title>', '新しいスプレッドシートのタイトル', 'AutoPlaywright テスト結果')
  .option('-e, --share-email <email>', 'スプレッドシートを共有するメールアドレス')
  .option('-d, --drive-folder <folderId>', 'Google DriveのフォルダID')
  .option('-a, --append', '既存データに追記する', false)
  .option('-v, --verbose', '詳細ログを表示', false)
  .parse();

const options = program.opts();

/**
 * 最新のテスト結果CSVファイルを取得
 * @returns {string|null} - CSVファイルのパス
 */
function getLatestTestResultCSV() {
  const testResultsDir = path.join(__dirname, '../test-results');
  
  if (!fs.existsSync(testResultsDir)) {
    console.log('test-resultsディレクトリが見つかりません');
    return null;
  }

  const csvFiles = fs.readdirSync(testResultsDir)
    .filter(file => file.startsWith('test_report_') && file.endsWith('.csv'))
    .map(file => ({
      name: file,
      path: path.join(testResultsDir, file),
      stats: fs.statSync(path.join(testResultsDir, file))
    }))
    .sort((a, b) => b.stats.mtime - a.stats.mtime);

  if (csvFiles.length === 0) {
    console.log('テスト結果CSVファイルが見つかりません');
    return null;
  }

  return csvFiles[0].path;
}

/**
 * テスト結果を構造化データに変換
 * @param {string} csvFilePath - CSVファイルのパス
 * @returns {Object} - 構造化されたテスト結果
 */
function parseTestResultCSV(csvFilePath) {
  try {
    const csvContent = fs.readFileSync(csvFilePath, 'utf8');
    const lines = csvContent.trim().split('\n');
    
    if (lines.length < 2) {
      return { routes: [] };
    }

    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const routes = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const route = {};
      
      headers.forEach((header, index) => {
        route[header] = values[index] || '';
      });
      
      routes.push(route);
    }

    return {
      executionTime: new Date().toISOString(),
      totalTests: routes.length,
      routes: routes
    };
  } catch (error) {
    console.error('CSV解析エラー:', error.message);
    return { routes: [] };
  }
}

/**
 * メイン処理
 */
async function main() {
  try {
    console.log('🚀 Google Sheets アップロード開始');
    
    // 認証ファイルの確認
    if (!fs.existsSync(options.credentials)) {
      console.error(`❌ 認証ファイルが見つかりません: ${options.credentials}`);
      console.log('📋 Google Sheets API設定手順:');
      console.log('1. Google Cloud Consoleでプロジェクトを作成');
      console.log('2. Google Sheets APIを有効化');
      console.log('3. サービスアカウントを作成してJSONキーをダウンロード');
      console.log('4. ダウンロードしたJSONファイルを credentials.json として保存');
      process.exit(1);
    }

    // Google Sheets APIを初期化
    const uploader = new GoogleSheetsUploader();
    await uploader.initialize(options.credentials);

    // テスト結果を解析
    let csvFilePath = options.csvFile;
    if (!csvFilePath) {
      console.log('📁 最新のテスト結果CSVを検索中...');
      csvFilePath = getLatestTestResultCSV();
      
      if (!csvFilePath) {
        console.error('❌ テスト結果CSVファイルが見つかりません');
        console.log('💡 テストを実行してからアップロードしてください');
        process.exit(1);
      }
    }

    console.log(`📄 CSVファイル: ${csvFilePath}`);
    const testResults = parseTestResultCSV(csvFilePath);
    console.log(`📊 テスト結果: ${testResults.routes.length}件`);

    // スプレッドシートIDの取得または既存スプレッドシートの検索
    let spreadsheetId = options.spreadsheetId;
    if (!spreadsheetId) {
      console.log('📊 スプレッドシートを検索または作成中...');
      spreadsheetId = await uploader.uploadTestResultsToExistingOrNew(
        testResults,
        options.title,
        options.shareEmail,
        options.driveFolder
      );
    } else {
      // 指定されたスプレッドシートIDを使用
      console.log('📊 指定されたスプレッドシートを使用中...');
      const timestamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '');
      const sheetName = `TestResults_${timestamp}`;
      
      await uploader.createSheet(spreadsheetId, sheetName);
      await uploader.uploadTestResults(testResults, spreadsheetId, sheetName);
    }

    if (options.verbose) {
      console.log('📋 テスト結果詳細:');
      testResults.routes.forEach((route, index) => {
        console.log(`  ${index + 1}. ${route.testCase || route.id || 'Unknown'}`);
      });
    }

    // アップロード処理は既に上記で実行済み
    console.log('✅ アップロード完了');

    // スプレッドシートのURLを表示
    const spreadsheetUrl = uploader.getSpreadsheetUrl(spreadsheetId);
    console.log(`🔗 スプレッドシートURL: ${spreadsheetUrl}`);
    
    console.log('🎉 処理完了！');

  } catch (error) {
    console.error('❌ エラーが発生しました:', error.message);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// スクリプトが直接実行された場合のみmain()を呼び出す
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
} 