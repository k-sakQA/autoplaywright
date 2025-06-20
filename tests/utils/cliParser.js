import { Command } from 'commander';
import path from 'path';
import fs from 'fs';

export function parseCLIArgs() {
  const program = new Command();
  
  program
    .option('-p, --spec-pdf <path>', '仕様書PDFファイルのパス')
    .option('-c, --test-csv <path>', 'テスト観点CSVファイルのパス')
    .option('-u, --url <url>', 'テスト対象のURL')
    .option('-o, --output <path>', '出力ディレクトリのパス')
    .option('-v, --verbose', '詳細なログを出力')
    .parse(process.argv);
  
  const options = program.opts();
  
  // PDFファイルの存在確認
  if (options.specPdf) {
    const pdfPath = path.resolve(options.specPdf);
    if (!fs.existsSync(pdfPath)) {
      console.error(`エラー: PDFファイルが見つかりません: ${pdfPath}`);
      process.exit(1);
    }
    options.specPdf = pdfPath;
  }
  
  // CSVファイルの存在確認
  if (options.testCsv) {
    const csvPath = path.resolve(options.testCsv);
    if (!fs.existsSync(csvPath)) {
      console.error(`エラー: CSVファイルが見つかりません: ${csvPath}`);
      process.exit(1);
    }
    options.testCsv = csvPath;
  }
  
  return options;
}

export function validateOptions(options) {
  const errors = [];
  
  // 少なくともURLまたはPDFのいずれかが必要
  if (!options.url && !options.specPdf) {
    errors.push('URLまたは仕様書PDFのいずれかを指定してください');
  }
  
  // PDFファイルの拡張子確認
  if (options.specPdf && !options.specPdf.toLowerCase().endsWith('.pdf')) {
    errors.push('指定されたファイルはPDFではありません');
  }
  
  // CSVファイルの拡張子確認
  if (options.testCsv && !options.testCsv.toLowerCase().endsWith('.csv')) {
    errors.push('指定されたファイルはCSVではありません');
  }
  
  if (errors.length > 0) {
    console.error('エラー:');
    errors.forEach(error => console.error(`  - ${error}`));
    process.exit(1);
  }
  
  return true;
} 