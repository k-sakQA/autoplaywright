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

重要：汎用的で成功率の高いテスト設計
- 実在する要素のみを使用すること
- 推測ベースのセレクタは避け、高い成功率を重視すること
- 異なるサイトでも適用可能な汎用的なアプローチを取ること

汎用的なセレクタ戦略：

【高成功率セレクタの優先順位】
1. HTML標準要素: h1, h2, h3, p, div, span, a, button, input, form
2. 一般的なtype属性: [type="text"], [type="email"], [type="submit"], [type="button"]
3. 汎用的なクラス名パターン: .btn, .button, .link, .nav, .menu, .content, .container
4. 役割ベースのaria属性: [role="button"], [role="navigation"], [role="main"]
5. 複数候補セレクタ: "button, .btn, [type='submit'], [role='button']"

【特定サイト依存の回避】
- 具体的なID名は使用しない（#specific-id は NG）
- サイト固有のクラス名は避ける（.fansta-specific は NG）
- URLパス名やサービス名を含むセレクタは使用しない

【実用的なテストパターン】
1. ページ読み込み確認
2. 基本要素の存在確認（見出し、コンテンツエリア）
3. 汎用的なナビゲーション操作
4. 一般的なフォーム要素の確認
5. 標準的なボタン・リンクの操作

必須要件：
- 提供されたHTML内に実際に存在する要素のみを使用すること
- 存在しない要素への操作は含めないこと
- 複数の候補セレクタをカンマ区切りで提供すること
- 各ステップは独立して実行可能であること

画面遷移の考慮事項：
- 初期ページ: 提供されたHTMLの要素のみ使用可能
- 遷移後のページ: 最も一般的で汎用的なセレクタのみ使用
- 具体的な要素IDやクラス名は遷移後ページでは推測しない`;
  
  let user = `以下の情報を基に、実際のユーザー操作を含む包括的なE2Eテストシナリオを生成してください。

【ページ構造解析結果】
\`\`\`json
${screenInfo}
\`\`\`

重要: 上記のページ構造解析結果に含まれる要素のみを使用してください。
- headings: 実際に存在する見出し要素とそのセレクタ
- links: 実際に存在するリンク要素とそのhref、セレクタ
- forms: 実際に存在するフォーム要素
- buttons: 実際に存在するボタン要素とそのtype、セレクタ
- inputs: 実際に存在する入力要素とそのtype、セレクタ

存在しない要素は絶対に使用しないでください。

【テスト観点】
\`\`\`json
${JSON.stringify(testPoints, null, 2)}
\`\`\`

画面遷移を考慮したテスト設計ルール：

【初期ページでの操作】（提供されたHTML内の要素のみ）
1. ページ読み込み確認
2. 初期ページの要素表示確認（実際に存在するセレクタのみ）
3. 実在するリンクのクリック（href属性を持つa要素）
4. 画面遷移の確認（waitForURL）

【遷移後ページでの操作】（一般的なセレクタのみ）
5. 遷移後ページの基本要素確認（h1, h2, main, .content等）
6. 汎用的なフォーム要素確認（form, input, button等）
7. 一般的なナビゲーション要素（.nav, .menu, .header等）

重要：画面遷移後は具体的なID/クラス名を推測しないこと
- OK: "h1", "form", "button[type='submit']", ".btn"
- NG: "#reservation-form", ".shop-name", "#booking-button"

遷移後ページで使用可能な安全なセレクタ例：
- タイトル: "h1", "h2", ".page-title", ".title"
- フォーム: "form", "input[type='email']", "input[type='text']"
- ボタン: "button", ".btn", "input[type='submit']"
- リンク: "a", ".link"
- コンテンツ: "main", ".content", ".container"`;

  if (pdfFileInfo) {
    user += `\n\n【仕様書】
${createPDFPrompt(pdfFileInfo)}`;
  }

  user += `

段階的なテスト例（実際の要素のみ使用）：

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
      "label": "ページタイトル確認",
      "action": "assertVisible",
      "target": "h1, h2, h3"
    },
    {
      "label": "基本コンテンツ確認",
      "action": "assertVisible",
      "target": "main, .content, .container, body"
    },
    {
      "label": "ナビゲーション確認",
      "action": "assertVisible",
      "target": "nav, .nav, .navigation, .menu"
    }
  ]
}
\`\`\`

実際に存在する要素の例：
- 見出し: ${screenInfo.includes('"headings"') ? 'headings配列の要素を使用' : 'h1, h2, h3から選択'}
- リンク: ${screenInfo.includes('"links"') ? 'links配列のselectorを使用' : 'a要素のみ'}
- フォーム: ${screenInfo.includes('"forms"') ? 'forms配列の要素を使用' : 'フォーム要素なし'}
- ボタン: ${screenInfo.includes('"buttons"') ? 'buttons配列のselectorを使用' : '汎用button要素'}

必ず上記の形式に従って、段階的なテストシナリオを生成してください：

重要：
- 利用可能なアクション：load, click, fill, waitForSelector, assertVisible, assertNotVisible, waitForURL
- value項目にはJavaScriptコード（.repeat()等）を使用せず、直接文字列を書いてください
- 長い文字列の場合は「aaaaaaaaaa...」のように省略して記載してください
- JSON内にコメント（//や/* */）は絶対に含めないでください
- 純粋なJSONのみを出力してください`;

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
  console.log('🛠️ [Debug] AI Response length:', content.length);
  
  // ```json ブロックまたは単純な { } ブロックを抽出
  let jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
  if (!jsonMatch) {
    // ```json ブロックが見つからない場合は、{ } ブロックを探す
    jsonMatch = content.match(/\{[\s\S]*\}/);
    console.log('🛠️ [Debug] Using fallback regex match');
  } else {
    // ```json ブロック内のJSONを使用
    jsonMatch = [null, jsonMatch[1]];
    console.log('🛠️ [Debug] Found JSON block, length:', jsonMatch[1].length);
  }
  
  if (!jsonMatch) {
    throw new Error('AI応答からJSONを抽出できませんでした');
  }
  
  try {
    let jsonText = jsonMatch[1] || jsonMatch[0];
    
    console.log('🛠️ [Debug] Original JSON length:', jsonText.length);
    
    // 最小限の安全なクリーニングのみ実行
    // 1. 末尾のカンマのみ除去（コメント除去は行わない）
    jsonText = jsonText.replace(/,(\s*[}\]])/g, '$1');
    
    console.log('🛠️ [Debug] Attempting JSON parse...');
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

// HTMLを構造化された情報に変換する関数
function analyzeHTMLStructure(html) {
  // 基本的なHTML要素を抽出
  const analysis = {
    title: (html.match(/<title[^>]*>(.*?)<\/title>/i) || [])[1] || '',
    headings: [],
    links: [],
    forms: [],
    buttons: [],
    inputs: [],
    navigation: []
  };
  
  // 見出し要素を抽出
  const headingMatches = html.match(/<(h[1-6])[^>]*>(.*?)<\/\1>/gi) || [];
  analysis.headings = headingMatches.map(match => {
    const tagMatch = match.match(/<(h[1-6])[^>]*>(.*?)<\/\1>/i);
    return {
      tag: tagMatch[1],
      text: tagMatch[2].replace(/<[^>]*>/g, '').trim(),
      selector: tagMatch[1]
    };
  });
  
  // リンク要素を抽出
  const linkMatches = html.match(/<a[^>]*href=[^>]*>(.*?)<\/a>/gi) || [];
  analysis.links = linkMatches.slice(0, 10).map(match => {
    const hrefMatch = match.match(/href=["']([^"']*)["']/i);
    const textMatch = match.match(/<a[^>]*>(.*?)<\/a>/i);
    return {
      href: hrefMatch ? hrefMatch[1] : '',
      text: textMatch ? textMatch[1].replace(/<[^>]*>/g, '').trim() : '',
      selector: hrefMatch && hrefMatch[1].includes('http') ? `a[href="${hrefMatch[1]}"]` : `a[href*="${(hrefMatch ? hrefMatch[1] : '').split('/').pop()}"]`
    };
  });
  
  // フォーム要素を抽出
  const formMatches = html.match(/<form[^>]*>/gi) || [];
  analysis.forms = formMatches.map((match, i) => ({
    selector: 'form',
    index: i,
    action: (match.match(/action=["']([^"']*)["']/i) || [])[1] || ''
  }));
  
  // ボタン要素を抽出
  const buttonMatches = html.match(/<(button|input[^>]*type=["'](?:button|submit)["'])[^>]*>(.*?)<\/button>|<input[^>]*type=["'](?:button|submit)["'][^>]*>/gi) || [];
  analysis.buttons = buttonMatches.slice(0, 5).map(match => {
    const typeMatch = match.match(/type=["']([^"']*)["']/i);
    const textMatch = match.match(/>(.*?)<\/button>/i) || match.match(/value=["']([^"']*)["']/i);
    return {
      type: typeMatch ? typeMatch[1] : 'button',
      text: textMatch ? textMatch[1].replace(/<[^>]*>/g, '').trim() : '',
      selector: typeMatch ? `[type="${typeMatch[1]}"]` : 'button'
    };
  });
  
  // 入力要素を抽出
  const inputMatches = html.match(/<input[^>]*>/gi) || [];
  analysis.inputs = inputMatches.slice(0, 10).map(match => {
    const typeMatch = match.match(/type=["']([^"']*)["']/i);
    const nameMatch = match.match(/name=["']([^"']*)["']/i);
    const placeholderMatch = match.match(/placeholder=["']([^"']*)["']/i);
    return {
      type: typeMatch ? typeMatch[1] : 'text',
      name: nameMatch ? nameMatch[1] : '',
      placeholder: placeholderMatch ? placeholderMatch[1] : '',
      selector: typeMatch ? `input[type="${typeMatch[1]}"]` : 'input'
    };
  });
  
  return analysis;
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
      const htmlAnalysis = analyzeHTMLStructure(html);
      screenInfo = JSON.stringify(htmlAnalysis, null, 2);
      console.log(`🛠️ [Debug] HTML analysis:`, htmlAnalysis);
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

