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
import crypto from "crypto";
import { z } from "zod";
import { parseCLIArgs, validateOptions } from './utils/cliParser.js';
import { uploadPDFToOpenAI, createPDFPrompt } from './utils/pdfParser.js';

// configのスキーマ定義
const ConfigSchema = z.object({
  openai: z.object({
    apiKeyEnv: z.string(),
    model: z.string(),
    temperature: z.number().min(0).max(2),
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

  return {
    apiKey,
    model: configData.openai.model,
    temperature: configData.openai.temperature,
  };
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

// キャッシュ関連の関数を追加
function createCacheKey(url, userLines, pdfFileId = '') {
  const data = url + JSON.stringify(userLines) + pdfFileId;
  return crypto.createHash('md5').update(data).digest('hex');
}

function getCachedResponse(cacheKey) {
  const cacheDir = path.resolve(__dirname, '../cache');
  const cachePath = path.join(cacheDir, `${cacheKey}.json`);
  
  if (fs.existsSync(cachePath)) {
    console.log('🎯 キャッシュヒット！');
    return JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
  }
  return null;
}

function saveToCache(cacheKey, data) {
  const cacheDir = path.resolve(__dirname, '../cache');
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir);
  }
  const cachePath = path.join(cacheDir, `${cacheKey}.json`);
  fs.writeFileSync(cachePath, JSON.stringify(data), 'utf-8');
}

(async () => {
  try {
    // CLI引数の解析
    const cliOptions = parseCLIArgs();
    validateOptions(cliOptions);
    
    console.log('📋 CLIオプション:', cliOptions);

    // 1. CSV 読み込み & パース
    const csvPath = path.resolve(__dirname, '../test_point/TestPoint_Format.csv');
    console.log(`🛠️ [Debug] Loading template from: ${csvPath}`);
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
      htmlSnippet = html.slice(0, 2000);
    }

    // 3. プロンプト作成
    const system = 'あなたはWebページのテスト観点ごとに「考慮すべき仕様の具体例」を抽出するAIです。';
    const userLines = records.map(r => `${r['No']}. ${r['テスト観点']}`);
    
    let user = `以下のテスト観点テンプレートに従い、「考慮すべき仕様の具体例」をJSON配列で返してください。\n\n` +
               userLines.join('\n');
    
    if (url) {
      user += `\n\n対象URL: ${url}`;
      user += `\n\nHTMLスニペット:\n${htmlSnippet}`;
    }
    
    if (pdfFileInfo) {
      user += `\n\n${createPDFPrompt(pdfFileInfo)}`;
    }

    // キャッシュチェック
    const cacheKey = createCacheKey(url, userLines, pdfFileInfo?.fileId || '');
    const cachedData = getCachedResponse(cacheKey);
    
    let points;
    if (cachedData) {
      points = cachedData;
    } else {
      // 4. AI 呼び出し
      console.log('🛠️ [Debug] Calling OpenAI Functions API...');
      
      const messages = [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ];

      // PDFファイルがある場合は、ファイルIDを追加
      if (pdfFileInfo) {
        messages[1].content += `\n\n添付ファイルID: ${pdfFileInfo.fileId}`;
      }

      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: messages,
        functions: [
          {
            name: 'newTestPoints',
            description: 'テスト観点ごとの具体例を返す',
            parameters: {
              type: 'object',
              properties: {
                testPoints: {
                  type: 'array',
                  items: { type: 'string' }
                }
              },
              required: ['testPoints']
            }
          }
        ],
        function_call: { name: 'newTestPoints' }
      });

      // 5. JSON パース
      const fnCall = res.choices[0].message.function_call;
      if (!fnCall || !fnCall.arguments) throw new Error('関数レスポンスにargumentsがありません');
      const args = JSON.parse(fnCall.arguments);
      points = args.testPoints;
      
      // キャッシュに保存
      saveToCache(cacheKey, points);
    }
    console.log(`🛠️ [Debug] testPoints count: ${points.length}`);

    // 6. 保存
    const outDir = path.resolve(__dirname, '../test-results');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
    const outPath = path.join(outDir, `testPoints_${getTimestamp()}.json`);
    fs.writeFileSync(outPath, JSON.stringify(points, null, 2), 'utf-8');
    console.log(`💾 Test points saved: ${outPath}`);

  } catch (err) {
    console.error('❌ エラーが発生しました:', err);
  }
})();
