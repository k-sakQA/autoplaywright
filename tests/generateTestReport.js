import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function readJsonFile(filePath) {
  try {
    const content = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error);
    return null;
  }
}

async function readCsvFile(filePath) {
  try {
    const content = await fs.promises.readFile(filePath, 'utf8');
    return content;
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error);
    return null;
  }
}

function simplifyTestData(testPoints, route, result) {
  // テスト観点の簡略化
  const simplifiedTestPoints = testPoints.map(point => ({
    id: point.id,
    description: point.description
  }));

  // ルートの簡略化
  const simplifiedRoute = route.steps.map(step => ({
    label: step.label,
    action: step.action,
    target: step.target,
    value: step.value
  }));

  // 結果の簡略化
  const simplifiedResult = result.steps.map(step => ({
    label: step.label,
    action: step.action,
    target: step.target,
    status: step.status,
    error: step.error
  }));

  return {
    testPoints: simplifiedTestPoints,
    route: simplifiedRoute,
    result: simplifiedResult
  };
}

async function generateTestReport(testPointFormat, testPoints, route, result) {
  const simplifiedData = simplifyTestData(testPoints, route, result);
  
  const prompt = `テスト実行結果を分析し、どのようなテストケースが実行されたのか、CSV形式で出力してください。
フォーマット: No,観点,手順,結果

テスト観点:
${JSON.stringify(simplifiedData.testPoints)}

実行手順:
${JSON.stringify(simplifiedData.route)}

実行結果:
${JSON.stringify(simplifiedData.result)}

CSV形式のみで出力してください。`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "テスト実行結果を分析し、CSV形式でテストケースを出力してください。"
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 1.0,
      max_tokens: 1500
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error('Error generating test report:', error);
    return null;
  }
}

async function main() {
  // 最新のファイルを取得
  const testResultsDir = path.join(__dirname, '..', 'test-results');
  const files = await fs.promises.readdir(testResultsDir);
  
  const resultFiles = files.filter(f => f.startsWith('result_')).sort().reverse();
  const routeFiles = files.filter(f => f.startsWith('route_')).sort().reverse();
  const testPointFiles = files.filter(f => f.startsWith('testPoints_')).sort().reverse();

  if (resultFiles.length === 0 || routeFiles.length === 0 || testPointFiles.length === 0) {
    console.error('必要なファイルが見つかりません。');
    return;
  }

  const latestResult = await readJsonFile(path.join(testResultsDir, resultFiles[0]));
  const latestRoute = await readJsonFile(path.join(testResultsDir, routeFiles[0]));
  const latestTestPoints = await readJsonFile(path.join(testResultsDir, testPointFiles[0]));
  const testPointFormat = await readCsvFile(path.join(__dirname, '..', 'test_point', 'TestPoint_Format.csv'));

  if (!latestResult || !latestRoute || !latestTestPoints || !testPointFormat) {
    console.error('ファイルの読み込みに失敗しました。');
    return;
  }

  const report = await generateTestReport(testPointFormat, latestTestPoints, latestRoute, latestResult);
  
  if (report) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 14);
    const outputPath = path.join(testResultsDir, `test_report_${timestamp}.csv`);
    await fs.promises.writeFile(outputPath, report);
    console.log(`テストレポートを生成しました: ${outputPath}`);
  }
}

main().catch(console.error); 