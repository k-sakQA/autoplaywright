// tests/generateRoutes.js
// OpenAI Functions APIを使い、テストルートJSONを生成するモジュール（Functionsフロー対応版）

import 'dotenv/config';
import { OpenAI } from 'openai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { parseCLIArgs, validateOptions } from './utils/cliParser.js';
import { uploadPDFToOpenAI, createPDFPrompt } from './utils/pdfParser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🛠️ [Debug] OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? `${process.env.OPENAI_API_KEY.slice(0, 5)}...` : 'undefined');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * 次のテストルートJSONを返す
 */
function createCacheKey(screenInfo, testPoints, pdfFileId = '') {
  const data = screenInfo + JSON.stringify(testPoints) + pdfFileId;
  return crypto.createHash('md5').update(data).digest('hex');
}

function getCachedResponse(cacheKey) {
  const cacheDir = path.resolve(__dirname, '../cache');
  const cachePath = path.join(cacheDir, `route_${cacheKey}.json`);
  
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
  const cachePath = path.join(cacheDir, `route_${cacheKey}.json`);
  fs.writeFileSync(cachePath, JSON.stringify(data), 'utf-8');
}

async function generateRoutes({ screenInfo, testPoints, pdfFileInfo = null }) {
  try {
    // キャッシュチェック
    const cacheKey = createCacheKey(screenInfo, testPoints, pdfFileInfo?.fileId || '');
    const cachedData = getCachedResponse(cacheKey);
    
    if (cachedData) {
      console.log('🔄 キャッシュから結果を返します');
      return cachedData;
    }

    // OpenAIのfunction定義を修正
    const functionDefinition = {
      name: 'newTestRoute',
      description: 'テストシナリオをJSONで生成',
      parameters: {
        type: 'object',
        properties: {
          route_id: {
            type: 'string',
            description: 'テストシナリオの一意な識別子'
          },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: {
                  type: 'string',
                  description: 'テストステップの説明'
                },
                action: {
                  type: 'string',
                  enum: ['load', 'click', 'fill', 'waitForURL', 'assertVisible', 'assertNotVisible'],
                  description: 'Playwrightのアクション'
                },
                target: {
                  type: 'string',
                  description: 'セレクターまたはURL'
                },
                expectsNavigation: {
                  type: 'boolean',
                  description: 'クリック後に画面遷移を期待するか'
                },
                timeout: {
                  type: 'number',
                  description: 'タイムアウト時間（ミリ秒）'
                },
                value: {
                  type: 'string',
                  description: '入力値（fillアクション用）'
                }
              },
              required: ['label', 'action', 'target']
            }
          }
        },
        required: ['route_id', 'steps']
      }
    };

    // プロンプト作成
    let userContent = `screenInfo:\n${screenInfo}\ntestPoints:\n${testPoints.join('\n')}`;
    
    if (pdfFileInfo) {
      userContent += `\n\n${createPDFPrompt(pdfFileInfo)}`;
    }

    const messages = [
      { 
        role: 'system', 
        content: `あなたはWebサイトのE2Eテストシナリオを生成するAIです。
特に以下の点に注意してください：
- クリックで画面遷移が発生する場合は、expectsNavigation: true を設定
- 画面遷移を伴うアクションの後は、適切なwaitForURLまたはassertVisibleを設定
- タイムアウトが必要な場合は、明示的にtimeout値を設定（デフォルト5000ms）`
      },
      { 
        role: 'user',   
        content: userContent
      }
    ];

    // PDFファイルがある場合は、ファイルIDを追加
    if (pdfFileInfo) {
      messages[1].content += `\n\n添付ファイルID: ${pdfFileInfo.fileId}`;
    }

    // OpenAIへのリクエスト部分を修正
    const callRes = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: messages,
      functions: [functionDefinition],
      function_call: { name: 'newTestRoute' }
    });
    const fnCall = callRes.choices[0].message.function_call;
    console.log('🛠️ [Debug] function_call:', fnCall);

    // ダミー実行
    const functionResponse = { name: fnCall.name, content: fnCall.arguments };

    // 関数呼び出しメッセージも含め再度AI呼び出し
    const finalRes = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        ...messages,
        callRes.choices[0].message,
        { role: 'function', name: functionResponse.name, content: functionResponse.content }
      ]
    });

    let content = finalRes.choices[0].message.content.trim();
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('関数レスポンスに有効な JSON が含まれていません');
    content = match[0];
    console.log('🛠️ [Debug] final JSON string:', content);

    const route = JSON.parse(content);
    console.log('🛠️ [Debug] Generated route:', route);

    // キャッシュに保存
    saveToCache(cacheKey, route);
    
    return route;
  } catch (err) {
    if (err.code === 'insufficient_quota') {
      console.error('APIクォータ不足です');
      return null;
    }
    console.error('予期せぬエラー:', err);
    return null;
  }
}

export { generateRoutes };
