import { Command } from 'commander';
import path from 'path';
import fs from 'fs';

export function parseCLIArgs() {
  const program = new Command();
  
  program
    .option('-p, --spec-pdf <path>', '仕様書PDFファイルのパス')
    .option('-c, --test-csv <path>', 'テスト観点CSVファイルのパス')
    .option('-u, --url <url>', 'テスト対象のURL')
    .option('-g, --goal <text>', 'テストの目的・意図')
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

/**
 * 簡単なコマンドライン引数解析
 */
export function parseArguments(args, schema) {
  const result = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg.startsWith('--')) {
      const key = arg.substring(2);
      const config = schema[key];
      
      if (config) {
        if (config.type === 'string' && i + 1 < args.length) {
          result[key] = args[i + 1];
          i++; // 次の引数をスキップ
        } else if (config.type === 'boolean') {
          result[key] = true;
        }
      }
    } else if (arg.startsWith('-')) {
      // エイリアスの処理
      const shortKey = arg.substring(1);
      for (const [longKey, config] of Object.entries(schema)) {
        if (config.alias === shortKey) {
          if (config.type === 'string' && i + 1 < args.length) {
            result[longKey] = args[i + 1];
            i++; // 次の引数をスキップ
          } else if (config.type === 'boolean') {
            result[longKey] = true;
          }
          break;
        }
      }
    }
  }
  
  return result;
} 