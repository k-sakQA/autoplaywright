// tests/generateSmartRoutes.js
// 動的DOM取得とAI分析を組み合わせたスマートテストシナリオ生成

import 'dotenv/config';
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { chromium } from 'playwright';
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

// 動的DOM情報を取得する関数
async function extractDynamicPageInfo(url) {
  console.log(`🔍 動的DOM取得開始: ${url}`);
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    // ページを読み込み
    await page.goto(url, { waitUntil: 'networkidle' });
    console.log('✅ ページ読み込み完了');
    
    // DOM情報を取得
    const pageInfo = await page.evaluate(() => {
      // 基本情報
      const info = {
        title: document.title,
        url: window.location.href,
        elements: {
          headings: [],
          links: [],
          buttons: [],
          inputs: [],
          images: [],
          navigation: []
        }
      };
      
      // 見出し要素
      document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((el, index) => {
        if (el.textContent.trim() && index < 10) {
          info.elements.headings.push({
            tag: el.tagName.toLowerCase(),
            text: el.textContent.trim(),
            selector: `${el.tagName.toLowerCase()}:has-text("${el.textContent.trim()}")`,
            fallbackSelector: el.tagName.toLowerCase()
          });
        }
      });
      
      // リンク要素
      document.querySelectorAll('a[href]').forEach((el, index) => {
        if (el.textContent.trim() && index < 15) {
          info.elements.links.push({
            text: el.textContent.trim(),
            href: el.href,
            selector: `text="${el.textContent.trim()}"`,
            fallbackSelector: `a[href*="${el.href.split('/').pop()}"]`
          });
        }
      });
      
      // ボタン要素
      document.querySelectorAll('button, input[type="button"], input[type="submit"]').forEach((el, index) => {
        if (index < 10) {
          const text = el.textContent?.trim() || el.value || el.getAttribute('aria-label') || '';
          if (text) {
            info.elements.buttons.push({
              text: text,
              type: el.type || 'button',
              selector: `text="${text}"`,
              fallbackSelector: el.type ? `[type="${el.type}"]` : 'button'
            });
          }
        }
      });
      
      // 入力要素
      document.querySelectorAll('input, textarea, select').forEach((el, index) => {
        if (index < 10) {
          const placeholder = el.placeholder || '';
          const name = el.name || '';
          const type = el.type || 'text';
          
          info.elements.inputs.push({
            type: type,
            name: name,
            placeholder: placeholder,
            selector: name ? `[name="${name}"]` : `[type="${type}"]`,
            fallbackSelector: `input, textarea, select`
          });
        }
      });
      
      // 画像要素
      document.querySelectorAll('img[alt], img[src*="logo"]').forEach((el, index) => {
        if (index < 5) {
          const alt = el.alt || '';
          const src = el.src || '';
          
          info.elements.images.push({
            alt: alt,
            src: src.split('/').pop(),
            selector: alt ? `img[alt*="${alt}"]` : `img[src*="${src.split('/').pop()}"]`,
            fallbackSelector: 'img'
          });
        }
      });
      
      return info;
    });
    
    console.log(`📊 DOM情報取得完了: 見出し${pageInfo.elements.headings.length}個, リンク${pageInfo.elements.links.length}個, ボタン${pageInfo.elements.buttons.length}個`);
    
    return pageInfo;
    
  } finally {
    await browser.close();
  }
}

// スマートテストルート生成
async function generateSmartTestRoute(url, testGoal, pageInfo, testPoints = null, pdfFileInfo = null) {
  const system = `あなたはWebページのE2Eテストシナリオを生成する専門AIです。

重要原則：
- 実際にページに存在する要素のみを使用する
- ユーザーの意図を正確に理解し、それに沿ったテストを生成する
- 動的に取得されたDOM情報を最大限活用する
- 高い成功率を重視する

提供される情報：
1. ページの動的DOM情報（実際に存在する要素）
2. ユーザーのテスト意図・目標
3. テスト観点（オプション）

セレクタ選択方針：
- :has-text("テキスト") を最優先（要素内テキストの柔軟な検索）
- 次に属性ベースセレクタ
- 最後にタグベースセレクタ
- 複数候補をカンマ区切りで提供

テキスト検証の重要原則：
- 入力値と一致する値で検証する（入力と同じ形式を使用）
- 例：入力「2025/07/25」→ 検証「2025/07/25」
- 例：入力「2」→ 検証「2」（単位なし）
- :has-text()により部分一致で柔軟に検索可能`;

  let user = `以下の情報を基に、ユーザーの意図に沿った精密なE2Eテストシナリオを生成してください。

【ユーザーのテスト意図】
${testGoal}

【ページ動的DOM情報】
\`\`\`json
${JSON.stringify(pageInfo, null, 2)}
\`\`\`

【重要】上記DOM情報に含まれる要素のみを使用してください。存在しない要素は絶対に使用しないでください。

利用可能なアクション：
- load: ページ読み込み
- click: 要素クリック  
- fill: 入力
- assertVisible: 要素表示確認
- assertNotVisible: 要素非表示確認
- waitForSelector: 要素待機
- waitForURL: URL遷移待機

セレクタ優先順位：
1. :has-text("実際のテキスト") (DOM情報のtextから選択)
2. 属性セレクタ [name="name"], [type="type"]
3. 複数候補 "selector1, selector2, selector3"

重要：テキスト検証では入力値と完全に一致する値を使用すること

出力形式：
\`\`\`json
{
  "route_id": "smart_test_001",
  "steps": [
    {
      "label": "ステップ説明",
      "action": "アクション",
      "target": "セレクタ",
      "value": "入力値（オプション）"
    }
  ]
}
\`\`\``;

  if (testPoints) {
    user += `\n\n【テスト観点】
\`\`\`json
${JSON.stringify(testPoints, null, 2)}
\`\`\``;
  }

  if (pdfFileInfo) {
    user += `\n\n【仕様書】
${createPDFPrompt(pdfFileInfo)}`;
  }

  const client = new OpenAI(openAIConfig);
  
  const messages = [
    { role: 'system', content: system.trim() },
    { role: 'user', content: user.trim() }
  ];

  const res = await client.chat.completions.create({
    model: openAIConfig.model || 'gpt-4o-mini',
    messages: messages,
    temperature: openAIConfig.temperature || 0.3, // より確実性を重視
    max_tokens: openAIConfig.max_tokens || 4000,
    top_p: openAIConfig.top_p || 0.9,
  });

  // JSON抽出と解析
  const content = res.choices[0].message.content.trim();
  console.log('🛠️ [Debug] AI Response length:', content.length);
  
  // ```json ブロックまたは単純な { } ブロックを抽出
  let jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
  if (!jsonMatch) {
    jsonMatch = content.match(/\{[\s\S]*\}/);
  } else {
    jsonMatch = [null, jsonMatch[1]];
  }
  
  if (!jsonMatch) {
    throw new Error('AI応答からJSONを抽出できませんでした');
  }
  
  try {
    let jsonText = jsonMatch[1] || jsonMatch[0];
    
    // 最小限の安全なクリーニング
    jsonText = jsonText.replace(/,(\s*[}\]])/g, '$1');
    
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

// メイン処理
(async () => {
  try {
    console.log('🚀 スマートテストシナリオ生成開始');

    // CLI引数の解析
    const cliOptions = parseCLIArgs();
    validateOptions(cliOptions);
    
    console.log('📋 CLIオプション:', cliOptions);

    // 必須パラメータの確認
    let url = cliOptions.url || config.targetUrl;
    let testGoal = cliOptions.goal || "基本的な機能テスト";
    
    if (!url) {
      throw new Error('テスト対象URLが指定されていません');
    }

    // PDF処理
    let pdfFileInfo = null;
    let openai = new OpenAI(openAIConfig);
    
    if (cliOptions.specPdf) {
      console.log(`📄 PDF仕様書を処理中: ${cliOptions.specPdf}`);
      pdfFileInfo = await uploadPDFToOpenAI(cliOptions.specPdf, openai);
    }

    // 1. 動的DOM情報取得
    const pageInfo = await extractDynamicPageInfo(url);

    // 2. テストポイント読み込み（最新ファイル、オプション）
    let testPoints = null;
    const resultsDir = path.resolve(__dirname, '../test-results');
    const tpFiles = fs.readdirSync(resultsDir)
      .filter(f => f.startsWith('testPoints_') && f.endsWith('.json'))
      .sort();
    
    if (tpFiles.length > 0) {
      const latestTP = tpFiles[tpFiles.length - 1];
      testPoints = JSON.parse(fs.readFileSync(path.join(resultsDir, latestTP), 'utf-8'));
      console.log(`🛠️ [Debug] Loaded testPoints from: ${latestTP}`);
    }

    // 3. スマートAI呼び出し
    console.log('🤖 AI分析開始...');
    const routeJson = await generateSmartTestRoute(url, testGoal, pageInfo, testPoints, pdfFileInfo);
    if (!routeJson) throw new Error('ルート生成に失敗しました');

    // 4. 保存
    const outPath = path.join(resultsDir, `route_${getTimestamp()}.json`);
    fs.writeFileSync(outPath, JSON.stringify(routeJson, null, 2), 'utf-8');
    console.log(`💾 Smart Route JSON saved to ${outPath}`);
    
    console.log('✅ スマートテストシナリオ生成が完了しました');
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