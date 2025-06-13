// tests/generateTestPoints.js
// テンプレCSV（test_point/TestPoint_Format.csv）から「テスト観点」列を抽出し、
// URL画面から「考慮すべき仕様の具体例」をAIで抽出して保存するスクリプト

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { OpenAI } = require('openai');
const { parse } = require('csv-parse/sync');
const crypto = require('crypto');

// JSTタイムスタンプ取得 (yyMMDDHHmmss 形式)
function getTimestamp() {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${String(d.getFullYear()).slice(-2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// キャッシュ関連の関数を追加
function createCacheKey(url, userLines) {
  const data = url + JSON.stringify(userLines);
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

    // 2. HTML 取得
    const url = 'https://hotel-example-site.takeyaqa.dev/ja/plans.html';
    console.log(`🛠️ [Debug] Fetching URL: ${url}`);
    const { data: html } = await axios.get(url);
    const snippet = html.slice(0, 2000);

    // 3. プロンプト作成
    const system = 'あなたはWebページのテスト観点ごとに「考慮すべき仕様の具体例」を抽出するAIです。';
    const userLines = records.map(r => `${r['No']}. ${r['テスト観点']}`);
    const user = `以下のテスト観点テンプレートに従い、${url} の画面HTML（一部）を参照して「考慮すべき仕様の具体例」をJSON配列で返してください。\n\n` +
                 userLines.join('\n') +
                 `\n\nHTMLスニペット:\n${snippet}`;

    // キャッシュチェック
    const cacheKey = createCacheKey(url, userLines);
    const cachedData = getCachedResponse(cacheKey);
    
    let points;
    if (cachedData) {
      points = cachedData;
    } else {
      // 4. AI 呼び出し
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      console.log('🛠️ [Debug] Calling OpenAI Functions API...');
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
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
