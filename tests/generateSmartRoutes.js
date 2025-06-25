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
      
      // 入力要素 - 詳細情報を取得
      document.querySelectorAll('input, textarea, select').forEach((el, index) => {
        if (index < 15) {
          const placeholder = el.placeholder || '';
          const name = el.name || '';
          const id = el.id || '';
          const type = el.type || 'text';
          const disabled = el.disabled;
          const required = el.required;
          const className = el.className || '';
          
          let recommendedSelector = '';
          if (name) {
            recommendedSelector = `[name="${name}"]`;
          } else if (id) {
            recommendedSelector = `#${id}`;
          } else {
            recommendedSelector = `[type="${type}"]`;
          }
          
          info.elements.inputs.push({
            tagName: el.tagName,
            type: type,
            name: name,
            id: id,
            placeholder: placeholder,
            disabled: disabled,
            required: required,
            className: className,
            recommendedSelector: recommendedSelector,
            note: disabled ? '⚠️ この要素は無効化されています' : ''
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
async function generateSmartTestRoute(url, testGoal, pageInfo, testPoints = null, pdfFileInfo = null, userStoryInfo = null) {
  // OpenAI設定を取得
  const config = loadConfig();
  const openAIConfig = getOpenAIConfig(config);
  const openai = new OpenAI(openAIConfig);

  // 失敗制約を取得
  const failureConstraints = getFailureConstraints();
  if (failureConstraints) {
    console.log(`🧠 ${failureConstraints.length}件の失敗パターンを学習済み - 同じ失敗を回避します`);
  }

  // ベースプロンプトを構築
  let prompt = `あなたはPlaywrightテストエキスパートです。以下の情報に基づいて、効果的で実行可能なテストルートJSONを生成してください。

**テスト対象URL**: ${url}
**テスト目標**: ${testGoal}

**現在のページ情報**:
📄 ページタイトル: ${pageInfo.title}

🔢 フォーム入力要素:
${pageInfo.elements.inputs.map(input => 
  `- ${input.tagName} (type="${input.type}") - 推奨セレクタ: ${input.recommendedSelector}${input.note ? ' ' + input.note : ''}${input.placeholder ? ` placeholder="${input.placeholder}"` : ''}`
).join('\n')}

🔘 ボタン要素:
${pageInfo.elements.buttons.map(btn => 
  `- "${btn.text}" - 推奨セレクタ: ${btn.selector}`
).join('\n')}

🔗 リンク要素:
${pageInfo.elements.links.slice(0, 5).map(link => 
  `- "${link.text}" - 推奨セレクタ: ${link.selector}`
).join('\n')}`;

  // テストポイント情報を追加
  if (testPoints && testPoints.testPoints) {
    prompt += `

**参考テストポイント**:
${testPoints.testPoints.map(tp => `- ${tp.description}`).slice(0, 10).join('\n')}`;
  }

  // PDF情報を追加
  if (pdfFileInfo) {
    const pdfPrompt = await createPDFPrompt(pdfFileInfo);
    prompt += `\n\n${pdfPrompt}`;
  }

  // 失敗制約をプロンプトに追加
  if (failureConstraints) {
    prompt = addFailureConstraintsToPrompt(prompt, failureConstraints);
  }

  prompt += `

**JSON出力要件**:
\`\`\`json
{
  "route_id": "smart_test_001",
  "steps": [
    {
      "label": "明確な操作説明",
      "action": "load|click|fill|waitForURL|assertVisible",
      "target": "セレクタまたはURL",
      "value": "入力値（fillの場合）"
    }
  ]
}
\`\`\`

**重要: セレクタの選択ルール**:
1. **必ず上記の「推奨セレクタ」を使用してください**
2. 無効化された要素（⚠️マーク）は操作しないでください
3. name属性がある場合は [name="属性値"] を優先使用
4. テキストベースの場合は text="正確なテキスト" を使用

**注意事項**:
- 確実に存在する要素のみを対象とする
- タイムアウトが発生しやすい操作は避ける
- 実際のページ情報に基づいた現実的なセレクタを使用
- 各ステップは独立して実行可能にする
- 画面遷移後は適切にwaitForURLを含める

実用的で確実に動作するテストルートJSONのみを生成してください。`;

  const client = new OpenAI(openAIConfig);
  
  const messages = [
    { role: 'system', content: 'あなたはPlaywrightテストエキスパートです。与えられた情報を基に、効果的で実行可能なテストルートJSONを生成してください。' },
    { role: 'user', content: prompt }
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
    
    // 動的なrouteIDとユーザーストーリーIDを設定（トレーサビリティ確保）
    const timestamp = getTimestamp();
    routeJson.route_id = `route_${timestamp}`;
    routeJson.user_story_id = userStoryInfo ? userStoryInfo.currentId : null;
    routeJson.generated_at = new Date().toISOString();
    
    return routeJson;
  } catch (parseError) {
    console.error('JSON解析エラー:', parseError);
    console.error('AI応答:', content);
    throw new Error('AI応答のJSON解析に失敗しました');
  }
}

/**
 * 失敗パターンから学習した制約を取得
 */
function getFailureConstraints() {
  try {
    const constraintsPath = path.join(process.cwd(), 'test-results', '.failure-patterns.json');
    if (!fs.existsSync(constraintsPath)) {
      return null;
    }
    
    const patterns = JSON.parse(fs.readFileSync(constraintsPath, 'utf-8'));
    const constraints = [];
    
    for (const [patternKey, pattern] of Object.entries(patterns)) {
      const failedAttempts = pattern.attempts.filter(a => !a.success);
      if (failedAttempts.length > 0) {
        constraints.push({
          target: pattern.target,
          action: pattern.action,
          errorType: pattern.errorType,
          failureCount: failedAttempts.length,
          lastFailure: failedAttempts[failedAttempts.length - 1].timestamp,
          avoidReason: `過去に${failedAttempts.length}回失敗したパターン`
        });
      }
    }
    
    return constraints.length > 0 ? constraints : null;
  } catch (error) {
    console.error('失敗制約取得エラー:', error.message);
    return null;
  }
}

/**
 * AIプロンプトに失敗制約を追加
 */
function addFailureConstraintsToPrompt(basePrompt, constraints) {
  if (!constraints || constraints.length === 0) {
    return basePrompt;
  }
  
  const constraintText = constraints.map(c => 
    `- ❌ 避けるべき: action="${c.action}", target="${c.target}" (理由: ${c.avoidReason})`
  ).join('\n');
  
  return `${basePrompt}

🚨 **重要: 以下の失敗パターンを避けてください**
${constraintText}

これらのセレクタ・アクションは過去に失敗しているため、代替手段を使用してください。
- 同じセレクタでも異なるアクション
- 同じアクションでも異なるセレクタ（より具体的、または代替セレクタ）
- より安全で確実な操作方法

必ず上記の制約を考慮してJSONを生成してください。`;
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
    
    // config.jsonからユーザーストーリー情報を読み取り（トレーサビリティ確保）
    let userStoryInfo = null;
    try {
      if (config.userStory) {
        userStoryInfo = config.userStory;
        console.log(`📝 ユーザーストーリーID ${userStoryInfo.currentId} を使用してrouteを生成します`);
      }
    } catch (error) {
      console.log('⚠️ ユーザーストーリー情報を読み取れませんでした');
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
    const routeJson = await generateSmartTestRoute(url, testGoal, pageInfo, testPoints, pdfFileInfo, userStoryInfo);
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