// tests/generateTestPoints.js
// テンプレCSV（test_point/TestPoint_Format.csv）から「テスト観点」列を抽出し、
// URL画面から「考慮すべき仕様の具体例」をAIで抽出して保存するスクリプト

import 'dotenv/config';
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import axios from "axios";
import OpenAI from "openai";
import { parse } from "csv-parse/sync";

import { z } from "zod";
import { parseCLIArgs, validateOptions } from './utils/cliParser.js';
import { uploadPDFToOpenAI, createPDFPrompt } from './utils/pdfParser.js';

// configのスキーマ定義
const ConfigSchema = z.object({
  openai: z.object({
    apiKeyEnv: z.string(),
    model: z.string(),
    temperature: z.number().min(0).max(2),
    max_tokens: z.number().optional(),
    top_p: z.number().min(0).max(1).optional(),
    timeout: z.number().optional(),
    maxRetries: z.number().optional(),
  }),
  targetUrl: z.string().url(),
});

// OpenAI設定を取得する関数
function createOpenAIConfig(configData) {
  const apiKey = process.env[configData.openai.apiKeyEnv];
  if (!apiKey) {
    console.error("ERROR: OpenAI API key not set in", configData.openai.apiKeyEnv);
    process.exit(1);
  }

  const config = {
    apiKey,
    model: configData.openai.model,
    temperature: configData.openai.temperature,
  };

  // オプション設定を追加
  if (configData.openai.max_tokens) config.max_tokens = configData.openai.max_tokens;
  if (configData.openai.top_p) config.top_p = configData.openai.top_p;
  if (configData.openai.timeout) config.timeout = configData.openai.timeout;
  if (configData.openai.maxRetries) config.maxRetries = configData.openai.maxRetries;

  return config;
}

// 設定をロードする関数
function loadAndValidateConfig() {
  try {
    const configPath = path.resolve(__dirname, "../config.json");
    const rawConfig = fs.readFileSync(configPath, "utf-8");
    const parsedConfig = JSON.parse(rawConfig);
    return ConfigSchema.parse(parsedConfig);
  } catch (error) {
    if (error instanceof Error) {
      console.error("Failed to load config:", error.message);
    }
    process.exit(1);
  }
}

// メイン処理
const loadedConfig = loadAndValidateConfig();
const aiConfig = createOpenAIConfig(loadedConfig);

// エクスポート
export { loadedConfig as config, aiConfig as openAIConfig };

// JSTタイムスタンプ取得 (yyMMDDHHmmss 形式)
function getTimestamp() {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${String(d.getFullYear()).slice(-2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}



(async () => {
  try {
    // CLI引数の解析
    const cliOptions = parseCLIArgs();
    validateOptions(cliOptions);
    
    console.log('📋 CLIオプション:', cliOptions);

    // 1. CSV 読み込み & パース
    let csvPath;
    if (cliOptions.testCsv) {
      csvPath = cliOptions.testCsv;
      console.log(`🛠️ [Debug] Using uploaded CSV: ${csvPath}`);
    } else {
      csvPath = path.resolve(__dirname, '../test_point/TestPoint_Format.csv');
      console.log(`🛠️ [Debug] Using default CSV: ${csvPath}`);
    }
    
    const csvRaw = fs.readFileSync(csvPath, 'utf-8');
    const records = parse(csvRaw, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
    console.log(`🛠️ [Debug] Loaded template points: ${records.length}`);

    // 2. データ取得（URLまたはPDF）
    let url = cliOptions.url || loadedConfig.targetUrl;
    let htmlSnippet = '';
    let pdfFileInfo = null;
    let openai = new OpenAI(aiConfig);
    
    if (cliOptions.specPdf) {
      console.log(`📄 PDF仕様書を処理中: ${cliOptions.specPdf}`);
      pdfFileInfo = await uploadPDFToOpenAI(cliOptions.specPdf, openai);
    }
    
    if (url) {
    console.log(`🛠️ [Debug] Fetching URL: ${url}`);
    const { data: html } = await axios.get(url);
      htmlSnippet = html.slice(0, 5000);
    }

    // 3. プロンプト作成
    const system = `あなたはWebページのテスト観点ごとに、与えられた仕様や画面情報から「考慮すべき仕様の具体例」を抽出するAIです。

以下のステップで回答してください：
1. まず与えられたテスト観点を理解し、仕様書やHTMLから関連する情報を抽出
2. 各観点に対して具体的で実行可能なテスト内容を考案
3. 最後に結果をJSON配列で出力

出力形式：
JSON配列で返してください。各要素は以下の構造のオブジェクトです：
{
  "No": "観点番号",
  "考慮すべき仕様の具体例": "具体的なテスト内容"
}

例:
[
  {
    "No": "1",
    "考慮すべき仕様の具体例": "ユーザー名は必須入力項目で、空の場合はエラーメッセージを表示すること"
  },
  {
    "No": "5",
    "考慮すべき仕様の具体例": "パスワードは8文字以上で、条件を満たさない場合は赤色でエラー表示すること"
  }
]`;

    const userLines = records.map(r => `${r['No']}. ${r['テスト観点']}`);
    
    let user = `以下のテスト観点について、仕様書や画面情報を参考に具体的なテスト内容を抽出してください。

【テスト観点リスト】
${userLines.join('\n')}`;
    
    if (url) {
      user += `\n\n【対象URL】
${url}

【HTMLスニペット】
${htmlSnippet}`;
    }
    
    if (pdfFileInfo) {
      user += `\n\n【仕様書】
${createPDFPrompt(pdfFileInfo)}`;
    }

    // goalパラメータをプロンプトに追加
    if (cliOptions.goal) {
      user += `\n\n【ユーザーストーリー・目標】
${cliOptions.goal}`;
    }

    user += `\n\n考慮すべき仕様のない観点は省略してください。
テスト観点の「No」を必ず含めて、以下の形式でJSON配列として返してください：

[
  {
    "No": "観点番号",
    "考慮すべき仕様の具体例": "具体的な仕様内容"
  }
]`;

    // 4. AI 呼び出し（毎回新しい観点を生成）
    console.log('🛠️ [Debug] Calling OpenAI Functions API...');
    
    const messages = [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ];

    // 特に追加処理は不要（createPDFPromptで既に処理済み）

    const res = await openai.chat.completions.create({
      model: aiConfig.model || 'gpt-4o-mini',
      messages: messages,
      temperature: aiConfig.temperature || 0.5,
      max_tokens: aiConfig.max_tokens || 4000,
      top_p: aiConfig.top_p || 0.9,
    });

    // 5. JSON パース
    const content = res.choices[0].message.content.trim();
    console.log('🛠️ [Debug] AI Response:', content);
    
    // JSON配列部分を抽出
    const jsonMatch = content.match(/\[([\s\S]*?)\]/);
    if (!jsonMatch) {
      throw new Error('AI応答からJSON配列を抽出できませんでした');
    }
    
    let points;
    try {
      let jsonText = jsonMatch[0];
      
      // 最小限の安全なクリーニングのみ実行
      // 1. 末尾のカンマのみ除去（コメント除去は行わない）
      jsonText = jsonText.replace(/,(\s*[}\]])/g, '$1');
      
      points = JSON.parse(jsonText);
      if (!Array.isArray(points)) {
        throw new Error('返された値が配列ではありません');
      }
      
      // 各要素が正しい構造を持っているか確認
      for (let i = 0; i < points.length; i++) {
        const point = points[i];
        if (!point.No || !point['考慮すべき仕様の具体例']) {
          console.warn(`要素 ${i} の構造が不正です:`, point);
        }
      }
      
      console.log(`🛠️ [Debug] 抽出されたテスト観点数: ${points.length}`);
    } catch (parseError) {
      console.error('JSON解析エラー:', parseError);
      console.error('AI応答:', content);
      throw new Error('AI応答のJSON解析に失敗しました');
    }
    console.log(`🛠️ [Debug] testPoints count: ${points.length}`);

    // 6. 保存
    const outDir = path.resolve(__dirname, '../test-results');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
    const outPath = path.join(outDir, `testPoints_${getTimestamp()}.json`);
    fs.writeFileSync(outPath, JSON.stringify(points, null, 2), 'utf-8');
    console.log(`💾 Test points saved: ${outPath}`);

    console.log('✅ テスト観点生成が完了しました');
    process.exit(0);
  } catch (err) {
    console.error('❌ エラーが発生しました:', err);
    process.exit(1);
  }
})();
