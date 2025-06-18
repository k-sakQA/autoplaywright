import { Command } from 'commander';
import path from 'path';
import fs from 'fs';

export function parseCLIArgs() {
  const program = new Command();
  
  program
    .option('-p, --spec-pdf <path>', '仕様書PDFファイルのパス')
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
  
  if (errors.length > 0) {
    console.error('エラー:');
    errors.forEach(error => console.error(`  - ${error}`));
    process.exit(1);
  }
  
  return true;
} 