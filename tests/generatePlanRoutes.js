// tests/generatePlanRoutes.js
// テスト観点(testPoints)から自動でテストルートJSONを生成し、ファイル出力まで行うスクリプト

import 'dotenv/config';
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import axios from "axios";
import { z } from "zod";
import { OpenAI } from "openai";
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

// config.json をロード
const loadConfig = () => {
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
};

// OpenAI クライアントの設定
const getOpenAIConfig = (config) => {
  const apiKey = process.env[config.openai.apiKeyEnv];
  if (!apiKey) {
    console.error("ERROR: OpenAI API key not set in", config.openai.apiKeyEnv);
    process.exit(1);
  }

  const openAIConfig = {
    apiKey,
    model: config.openai.model,
    temperature: config.openai.temperature,
  };

  // オプション設定を追加
  if (config.openai.max_tokens) openAIConfig.max_tokens = config.openai.max_tokens;
  if (config.openai.top_p) openAIConfig.top_p = config.openai.top_p;
  if (config.openai.timeout) openAIConfig.timeout = config.openai.timeout;
  if (config.openai.maxRetries) openAIConfig.maxRetries = config.openai.maxRetries;

  return openAIConfig;
};

export const config = loadConfig();
export const openAIConfig = getOpenAIConfig(config);

// ① AI呼び出し用のプロンプト＆関数定義
async function generateTestRoute(screenInfo, testPoints, pdfFileInfo = null) {
  const system = `
あなたはWebページの訪問者のハッピーパスに沿ったE2Eテストシナリオを、
Playwright用のステップ配列で生成するAIです。
`;
  
  let user = `
以下のテスト観点に従い、仕様書や画面情報（HTMLスニペット）とテストポイントのリストをもとに、
Playwrightで実行可能なsteps配列を含むJSONを返してください。

【画面情報】
\`\`\`html
${screenInfo}
\`\`\`

【テストポイント】
\`\`\`json
${JSON.stringify(testPoints, null, 2)}
\`\`\``;

  if (pdfFileInfo) {
    user += `\n\n【仕様書】
${createPDFPrompt(pdfFileInfo)}`;
  }

  user += `

=== 出力フォーマット ===
{
  "route_id": "test_reserve_001",
  "steps": [
    {
      "label": "予約ページを開く",
      "action": "load",
      "target": "https://hotel-example-site.takeyaqa.dev/ja/reserve.html?plan-id=0"
    },
    {
      "label": "ローディング表示",
      "action": "waitForSelector",
      "target": "text=Loading..."
    },
    {
      "label": "おすすめプラン確認",
      "action": "assertVisible",
      "target": "text=⭐おすすめプラン⭐"
    },
    …
  ]
}
`;

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  
  const messages = [
    { role: 'system', content: system.trim() },
    { role: 'user',   content: user.trim() }
  ];

  // PDFファイルがある場合は、ファイルIDを追加
  if (pdfFileInfo) {
    messages[1].content += `\n\n添付ファイルID: ${pdfFileInfo.fileId}`;
  }

  const res = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: messages,
    functions: [
      {
        name: 'newTestRoute',
        description: 'Generate E2E test route steps',
        parameters: {
          type: 'object',
          properties: {
            route_id: { type: 'string', description: 'テストシナリオ識別子' },
            steps: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  label:  { type: 'string', description: 'ログ出力用の説明' },
                  action: { type: 'string', description: 'Playwrightアクション名' },
                  target: { type: 'string', description: 'セレクターまたはURL' }
                },
                required: ['label','action','target']
              }
            }
          },
          required: ['route_id','steps']
        }
      }
    ],
    function_call: { name: 'newTestRoute' }
  });

  const fn = res.choices[0].message.function_call;
  return fn ? JSON.parse(fn.arguments) : null;
}

// ② generatePlanRoutes.js の main 部分
(async () => {
  try {
    console.log('🛠️ [Debug] generatePlanRoutes.js start');

    // CLI引数の解析
    const cliOptions = parseCLIArgs();
    validateOptions(cliOptions);
    
    console.log('📋 CLIオプション:', cliOptions);

    // 1. データ取得（URLまたはPDF）
    let url = cliOptions.url || config.targetUrl;
    let screenInfo = '';
    let pdfFileInfo = null;
    let openai = new OpenAI(openAIConfig);
    
    if (cliOptions.specPdf) {
      console.log(`📄 PDF仕様書を処理中: ${cliOptions.specPdf}`);
      pdfFileInfo = await uploadPDFToOpenAI(cliOptions.specPdf, openai);
    }
    
    if (url) {
      console.log(`🛠️ [Debug] Fetching URL: ${url}`);
      const { data: html } = await axios.get(url);
      screenInfo = html.slice(0, 5000).replace(/\r?\n/g, '\\n');
      console.log(`🛠️ [Debug] screenInfo length: ${screenInfo.length}`);
    }

    // 2. テストポイント読み込み（最新ファイル）
    const resultsDir = path.resolve(__dirname, '../test-results');
    const tpFiles = fs.readdirSync(resultsDir)
      .filter(f => f.startsWith('testPoints_') && f.endsWith('.json'))
      .sort();
    if (tpFiles.length === 0) throw new Error('testPoints JSONファイルが見つかりません');
    const latestTP = tpFiles[tpFiles.length - 1];
    const testPoints = JSON.parse(fs.readFileSync(path.join(resultsDir, latestTP), 'utf-8'));
    console.log(`🛠️ [Debug] Loaded testPoints from: ${latestTP}`);

    // 3. AI呼び出し
    const routeJson = await generateTestRoute(screenInfo, testPoints, pdfFileInfo);
    if (!routeJson) throw new Error('ルート生成に失敗しました');

    // 4. 保存
    const outPath = path.join(resultsDir, `route_${getTimestamp()}.json`);
    fs.writeFileSync(outPath, JSON.stringify(routeJson, null, 2), 'utf-8');
    console.log(`💾 Route JSON saved to ${outPath}`);
  } catch (err) {
    console.error('❌ エラーが発生しました:', err);
    process.exit(1);
  }
})();

// ヘルパー: JSTタイムスタンプ（yymmddhhmmss）
function getTimestamp() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  const pad = n => String(n).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${yy}${mm}${dd}${hh}${mi}${ss}`;
}
