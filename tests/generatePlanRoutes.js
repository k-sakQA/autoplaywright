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

// ① AI呼び出し用のプロンプト
async function generateTestRoute(screenInfo, testPoints, url, pdfFileInfo = null) {
  const system = `あなたはWebページのE2Eテストシナリオを生成するAIです。

以下のステップで思考してください：
1. 与えられたテスト観点とHTML情報を分析
2. 実際のHTML要素（class、id、href等）を確認
3. 実際のユーザー操作を含む包括的なテストシナリオを考案
4. 最後にJSON形式で出力

必須要件：
- 提供されたHTML内に実際に存在する要素のみを使用すること
- 実在するリンク（href属性を持つa要素）を必ずクリックすること
- 画面遷移があるテストを含めること
- フォーム要素がある場合は入力テストを含めること
- ボタンやリンクの操作後に適切な待機処理を含めること

テストシナリオに含めるべき操作：
- ページ読み込み確認
- 重要な要素の表示確認
- 実在するリンクのクリック（最低1つ以上）
- 画面遷移の確認
- フォーム入力（該当要素がある場合）
- エラーハンドリングのテスト`;
  
  let user = `以下の情報を基に、実際のユーザー操作を含む包括的なE2Eテストシナリオを生成してください。

【画面情報（HTML）】
\`\`\`html
${screenInfo}
\`\`\`

【テスト観点】
\`\`\`json
${JSON.stringify(testPoints, null, 2)}
\`\`\`

必須要件：
1. 上記HTML内のa要素（リンク）を最低1つはクリックすること
2. クリック後のページ遷移を waitForURL で確認すること
3. 遷移先での要素表示確認を含めること
4. フォーム要素がある場合は入力操作を含めること
5. 実際に存在する要素のみを使用すること

例：href="/shops/tokyo/ca-1/shibuya" のようなリンクがある場合、そのリンクをクリックし、遷移を確認するテストを含めてください。`;

  if (pdfFileInfo) {
    user += `\n\n【仕様書】
${createPDFPrompt(pdfFileInfo)}`;
  }

  user += `

必ず以下のJSON形式のみで回答してください（説明は不要）：

\`\`\`json
{
  "route_id": "test_scenario_001",
  "steps": [
    {
      "label": "ページを開く",
      "action": "load",
      "target": "${url}"
    },
    {
      "label": "タイトル確認",
      "action": "assertVisible",
      "target": "h1"
    },
    {
      "label": "フォーム入力",
      "action": "fill",
      "target": "#username",
      "value": "testuser"
    }
  ]
}
\`\`\`

重要：
- 利用可能なアクション：load, click, fill, waitForSelector, assertVisible, assertNotVisible, waitForURL
- value項目にはJavaScriptコード（.repeat()等）を使用せず、直接文字列を書いてください
- 長い文字列の場合は「aaaaaaaaaa...」のように省略して記載してください
- JSON以外の説明やコメントは追加しないでください`;

  const client = new OpenAI(openAIConfig);
  
  const messages = [
    { role: 'system', content: system.trim() },
    { role: 'user',   content: user.trim() }
  ];

  // 特に追加処理は不要（createPDFPromptで既に処理済み）

  const res = await client.chat.completions.create({
    model: openAIConfig.model || 'gpt-4o-mini',
    messages: messages,
    temperature: openAIConfig.temperature || 0.5,
    max_tokens: openAIConfig.max_tokens || 4000,
    top_p: openAIConfig.top_p || 0.9,
  });

  // JSON抽出と解析
  const content = res.choices[0].message.content.trim();
  console.log('🛠️ [Debug] AI Response:', content);
  
  // ```json ブロックまたは単純な { } ブロックを抽出
  let jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
  if (!jsonMatch) {
    // ```json ブロックが見つからない場合は、{ } ブロックを探す
    jsonMatch = content.match(/\{[\s\S]*\}/);
  } else {
    // ```json ブロック内のJSONを使用
    jsonMatch = [null, jsonMatch[1]];
  }
  
  if (!jsonMatch) {
    throw new Error('AI応答からJSONを抽出できませんでした');
  }
  
  try {
    let jsonText = jsonMatch[1] || jsonMatch[0];
    
    // JavaScriptコードが含まれている場合の修正
    jsonText = jsonText.replace(/"a"\.repeat\(\d+\)/g, '"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"');
    
    const routeJson = JSON.parse(jsonText);
    if (!routeJson.route_id || !routeJson.steps || !Array.isArray(routeJson.steps)) {
      throw new Error('JSONの形式が正しくありません');
    }
    return routeJson;
  } catch (parseError) {
    console.error('JSON解析エラー:', parseError);
    console.error('AI応答:', content);
    throw new Error('AI応答のJSON解析に失敗しました');
  }
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
    const routeJson = await generateTestRoute(screenInfo, testPoints, url, pdfFileInfo);
    if (!routeJson) throw new Error('ルート生成に失敗しました');

    // 4. 保存
    const outPath = path.join(resultsDir, `route_${getTimestamp()}.json`);
    fs.writeFileSync(outPath, JSON.stringify(routeJson, null, 2), 'utf-8');
    console.log(`💾 Route JSON saved to ${outPath}`);
    
    console.log('✅ テストシナリオ生成が完了しました');
    process.exit(0);
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
