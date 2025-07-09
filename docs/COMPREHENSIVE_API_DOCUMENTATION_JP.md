# AutoPlaywright 完全API・コンポーネントドキュメント

## 📖 概要

AutoPlaywrightは、OpenAI GPTの力を活用してE2Eテストを完全自動化する革命的なプラットフォームです。PDF仕様書からテスト実行・レポート作成まで、すべてのプロセスを自動化します。

## 🚀 クイックスタート

### 基本セットアップ
```bash
# 1. 依存関係インストール
npm install

# 2. 環境変数設定
echo "OPENAI_API_KEY=sk-your-api-key" > .env

# 3. WebUIサーバー起動
npm run webui

# 4. ブラウザでアクセス
open http://localhost:3000
```

### ワンクリック実行
WebUIの「🚀 自動で一括実行する」ボタンで、以下の7ステップが自動実行されます：
1. 📋 テスト観点生成
2. 🧠 テストケース生成  
3. 🎭 Playwright変換
4. ▶️ テスト実行
5. 📊 レポート生成
6. 🔧 失敗分析・修正
7. 🔍 新ストーリー発見

## 🌐 Web Server API (server.js)

### サーバー基本情報
- **ポート**: 3000
- **ベースURL**: `http://localhost:3000`
- **フレームワーク**: Express.js

### 主要APIエンドポイント

#### 🔧 設定管理API

##### GET `/api/config`
アプリケーション設定を取得

**レスポンス例**:
```json
{
  "targetUrl": "https://hotel-example-site.takeyaqa.dev/",
  "openai": {
    "model": "gpt-4o-mini",
    "temperature": 0.5,
    "max_tokens": 4000,
    "top_p": 0.9
  },
  "googleSheets": {
    "shareEmail": "user@example.com",
    "autoUpload": true
  }
}
```

##### POST `/api/config/ai`
AI設定を更新・保存

**リクエスト例**:
```json
{
  "model": "gpt-4o-mini",
  "temperature": 0.7,
  "max_tokens": 6000,
  "top_p": 0.9
}
```

**JavaScript使用例**:
```javascript
const updateAIConfig = async (config) => {
  const response = await fetch('/api/config/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config)
  });
  return response.json();
};
```

##### POST `/api/config/sheets`
Google Sheets連携設定

**リクエスト例**:
```json
{
  "shareEmail": "user@example.com",
  "driveFolder": "TestResults",
  "spreadsheetTitle": "AutoPlaywright Results",
  "autoUpload": true
}
```

#### 🧪 テスト実行API

##### POST `/api/execute`
メインのテスト実行API（FormData対応）

**パラメータ**:
- `command` (string): 実行コマンド種別
- `url` (string): テスト対象URL
- `goal` (string): ユーザーストーリー
- `pdf` (file): PDF仕様書ファイル
- `csv` (file): テスト観点CSVファイル

**サポートコマンド**:
- `generateTestPoints`: テスト観点生成
- `generateTestCases`: テストケース生成
- `generateSmartRoutes`: Playwright変換
- `runRoutes`: テスト実行
- `generateTestReport`: レポート生成
- `analyzeFailures`: 失敗分析
- `discoverNewStories`: 新ストーリー発見

**JavaScript使用例**:
```javascript
const executeTest = async (command, url, goal, files) => {
  const formData = new FormData();
  formData.append('command', command);
  formData.append('url', url);
  formData.append('goal', goal);
  
  if (files.pdf) formData.append('pdf', files.pdf);
  if (files.csv) formData.append('csv', files.csv);

  const response = await fetch('/api/execute', {
    method: 'POST',
    body: formData
  });
  return response.json();
};

// 使用例
const result = await executeTest(
  'generateTestPoints',
  'https://hotel-example-site.takeyaqa.dev/',
  'ホテル予約機能のテスト',
  { pdf: pdfFile, csv: csvFile }
);
```

##### POST `/api/execute-json`
JSON形式でのコマンド実行（内部API）

**リクエスト例**:
```json
{
  "command": "runFixedRoute",
  "routeId": "route_241205123456",
  "params": ["--keep-session", "--android-device"]
}
```

##### POST `/api/execute-playwright`
Playwright形式での複数ルート実行

**リクエスト例**:
```json
{
  "routeFiles": ["route_001.json", "route_002.json"],
  "generateCode": true
}
```

#### 📊 結果管理API

##### GET `/api/results`
テスト結果ファイル一覧を取得

**レスポンス例**:
```json
{
  "files": [
    {
      "name": "testResults_241205123456.json",
      "size": 15420,
      "modified": "2024-12-05T12:34:56.789Z"
    },
    {
      "name": "TestCoverage_241205123456.html",
      "size": 245680,
      "modified": "2024-12-05T12:35:30.123Z"
    }
  ]
}
```

##### GET `/api/results/:filename`
特定の結果ファイルをダウンロード

**使用例**:
```javascript
const downloadResult = (filename) => {
  window.open(`/api/results/${filename}`, '_blank');
};
```

#### 📱 デバイス・連携API

##### GET `/api/adb-status`
Android ADB接続状態確認

**レスポンス例**:
```json
{
  "success": true,
  "deviceCount": 1,
  "chromeConnected": true,
  "chromeVersion": "Chrome/120.0.6099.129"
}
```

##### POST `/api/adb-setup`
ADBポートフォワード設定

**レスポンス例**:
```json
{
  "success": true,
  "message": "ADBポートフォワード設定完了"
}
```

## 🧪 コアテスト生成モジュール

### 1. generateTestPoints.js
**目的**: PDF仕様書・URLから具体的なテスト観点を生成

#### 主要関数

```javascript
// 設定ロード・検証
function loadAndValidateConfig()

// OpenAI設定作成
function createOpenAIConfig(configData)

// JSTタイムスタンプ生成 (yyMMDDHHmmss)
function getTimestamp()
```

#### CLI使用例
```bash
# 基本使用
node tests/generateTestPoints.js \
  --url "https://hotel-example-site.takeyaqa.dev/" \
  --goal "ホテル予約機能のテスト"

# PDF仕様書付き
node tests/generateTestPoints.js \
  --url "https://example.com" \
  --goal "ログイン機能のテスト" \
  --spec-pdf "./specs/requirements.pdf"

# カスタムCSV使用
node tests/generateTestPoints.js \
  --url "https://example.com" \
  --test-csv "./custom/test_points.csv"
```

#### 入力ファイル形式

**TestPoint_Format.csv例**:
```csv
No,テスト観点
1,画面表示確認
2,必須項目入力検証
3,エラーメッセージ表示
4,画面遷移確認
5,データ保存確認
```

#### 出力ファイル形式
```json
{
  "metadata": {
    "csvFile": "TestPoint_Format.csv",
    "csvPath": "/path/to/csv",
    "timestamp": "241205123456",
    "pointsCount": 15,
    "url": "https://example.com",
    "goal": "ホテル予約機能のテスト"
  },
  "points": [
    {
      "No": "1",
      "考慮すべき仕様の具体例": "ユーザー名フィールドは必須入力項目で、空の場合はエラーメッセージ「ユーザー名を入力してください」を表示する"
    },
    {
      "No": "2", 
      "考慮すべき仕様の具体例": "パスワードは8文字以上で、条件を満たさない場合は赤色でエラー表示する"
    }
  ]
}
```

### 2. generateTestCases.js
**目的**: テスト観点を自然言語テストケースに変換

#### 主要クラス

```javascript
class NaturalLanguageTestCaseGenerator {
  constructor() {
    this.outputDir = path.join(__dirname, '../test-results');
    this.config = null;
    this.userStory = null;
    this.targetUrl = null;
  }

  // 設定情報読み込み
  loadConfig()

  // テスト観点JSONファイル読み込み  
  loadTestPoints(testPointsFile)

  // 観点の種類を分析して分類
  categorizeViewpoint(viewpoint)

  // 優先度決定
  determinePriority(viewpoint)

  // 自然言語テストケース生成
  generateNaturalLanguageTestCase(viewpoint, category, index)
}
```

#### 観点カテゴリ分類
- `display`: 表示確認系
- `input_validation`: 入力検証系
- `error_handling`: エラーハンドリング系
- `navigation`: 画面遷移系
- `interaction`: UI操作系
- `data_verification`: データ確認系
- `edge_case`: 境界値テスト系
- `compatibility`: 互換性系
- `operations`: 運用確認系

#### カテゴリ別生成メソッド

```javascript
// 表示確認系テストケース生成
generateDisplayTestCase(baseCase, viewpoint) {
  const scenarios = [
    `${targetUrl}にアクセスする`,
    "ページが完全に読み込まれるまで待機する",
    "各UI要素が正しく配置されていることを確認する",
    "文字が正しく表示され、文字化けや文字切れがないことを確認する"
  ];
  
  const expectedResults = [
    "ページが正常に表示される",
    "すべてのUI要素が意図された位置に配置されている",
    "テキストが読みやすく表示されている"
  ];
  
  return { ...baseCase, test_scenarios: scenarios, expected_results: expectedResults };
}

// 入力検証系テストケース生成
generateInputValidationTestCase(baseCase, viewpoint) {
  const scenarios = [
    "対象ページにアクセスする",
    "入力フィールドを特定する",
    "有効な値を入力して正常動作を確認する",
    "無効な値（空文字、特殊文字、長すぎる文字列等）を入力する",
    "バリデーションメッセージが適切に表示されることを確認する"
  ];
  
  return { ...baseCase, test_scenarios: scenarios };
}
```

#### CLI使用例
```bash
# 基本使用
node tests/generateTestCases.js \
  --test-points "testPoints_241205123456.json"

# URL・目標指定
node tests/generateTestCases.js \
  --test-points "testPoints_241205123456.json" \
  --url "https://example.com" \
  --goal "ログイン機能の包括的テスト"
```

#### 出力ファイル形式
```json
{
  "metadata": {
    "generated_at": "2024-12-05T12:34:56.789Z",
    "total_test_cases": 25,
    "version_type": "category_detailed",
    "categories": {
      "input_validation": 8,
      "display": 5,
      "navigation": 4,
      "interaction": 8
    }
  },
  "testCases": [
    {
      "id": "NL_TC_1733456789_001",
      "title": "入力検証: ユーザー名フィールドのバリデーション",
      "original_viewpoint": "ユーザー名フィールドは必須入力項目",
      "category": "input_validation",
      "priority": "high",
      "test_scenarios": [
        "ログインページにアクセスする",
        "ユーザー名フィールドに空文字を入力する", 
        "ログインボタンをクリックする",
        "エラーメッセージが表示されることを確認する"
      ],
      "expected_results": [
        "必須項目エラーが表示される",
        "送信が阻止される"
      ],
      "test_data": [
        { "type": "empty", "value": "", "description": "空の入力値" },
        { "type": "valid", "value": "testuser", "description": "有効な入力値" }
      ],
      "context": {
        "target_url": "https://example.com",
        "user_story": "ログイン機能のテスト"
      }
    }
  ]
}
```

### 3. generateSmartRoutes.js
**目的**: 自然言語テストケースをPlaywright実装に変換

#### 主要機能関数

```javascript
// 動的DOM情報取得
async function extractDynamicPageInfo(url) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto(url, { waitUntil: 'networkidle' });
  
  const pageInfo = await page.evaluate(() => {
    const info = {
      title: document.title,
      url: window.location.href,
      elements: {
        headings: [],   // h1-h6要素
        links: [],      // aタグ
        buttons: [],    // button, input[type="submit"]
        inputs: [],     // input, textarea, select
        images: []      // img要素
      }
    };
    
    // 各要素を詳細に解析してセレクタ情報付きで収集
    document.querySelectorAll('button, input[type="button"], input[type="submit"]')
      .forEach((el, index) => {
        const text = el.textContent?.trim() || el.value || '';
        if (text && index < 10) {
          info.elements.buttons.push({
            text: text,
            type: el.type || 'button',
            id: el.id || '',
            selector: text ? `text="${text}"` : `[type="${el.type}"]`,
            robustSelector: el.id ? `#${el.id}` : `button:has-text("${text}")`
          });
        }
      });
    
    return info;
  });
  
  await browser.close();
  return pageInfo;
}

// 自然言語テストケース読み込み
function loadNaturalLanguageTestCases(naturalTestCasesFile)

// 実行可能性分析
function analyzeTestCaseFeasibility(domInfo, testCases)

// Playwright実装変換
function convertToPlaywrightImplementation(testCase, domInfo, targetUrl)
```

#### 高度なクラス

```javascript
class DOMBasedTestGenerator {
  constructor(domInfo) {
    this.domInfo = domInfo;
    this.elementActionMap = this.buildElementActionMap();
  }

  // 要素アクション対応表構築
  buildElementActionMap() {
    const actionMap = {
      inputs: [],
      buttons: [],
      links: [],
      selects: []
    };
    
    this.domInfo.elements.inputs.forEach(input => {
      actionMap.inputs.push({
        element: input,
        actions: this.getAvailableActions(input),
        priority: this.getElementPriority(input)
      });
    });
    
    return actionMap;
  }

  // 最適なアクション順序生成
  generateOptimalActionSequence(element, testComplexity = 'validation') {
    const elementType = this.determineElementType(element);
    const actions = this.getOptimalActions(elementType, testComplexity);
    return this.buildDetailedActionSteps(element, actions, elementType);
  }

  // 堅牢なセレクタ生成
  generateRobustSelector(element) {
    const selectors = [];
    
    if (element.id) selectors.push(`#${element.id}`);
    if (element.name) selectors.push(`[name="${element.name}"]`);
    if (element.placeholder) selectors.push(`[placeholder="${element.placeholder}"]`);
    if (element.type) selectors.push(`[type="${element.type}"]`);
    
    return selectors[0] || 'input';
  }
}

class ComprehensiveTestGenerator extends DOMBasedTestGenerator {
  constructor(domInfo, userStoryInfo = null) {
    super(domInfo);
    this.userStoryInfo = userStoryInfo;
  }

  // 包括的テストケース生成
  generateComprehensiveTestCase(element, testFocus = 'complete_validation') {
    const testCase = {
      id: `COMP_TC_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      element: element,
      testFocus: testFocus,
      steps: [],
      validationSteps: [],
      cleanup: []
    };

    switch (element.tagName) {
      case 'INPUT':
        return this.generateInputCompleteValidation(element, testCase);
      case 'SELECT':
        return this.generateSelectCompleteValidation(element, testCase);
      default:
        return this.generateGeneralElementTest(element, testCase);
    }
  }

  // 完全バリデーション手順生成
  generateCompleteValidationSteps(element, testCase) {
    const steps = [];
    
    // 基本入力テスト
    steps.push({
      action: 'fill',
      target: this.generateRobustSelector(element),
      value: this.generateTestValueForElement(element),
      label: `${element.name || element.placeholder}に有効な値を入力`
    });
    
    // 空値テスト
    if (element.required) {
      steps.push({
        action: 'fill',
        target: this.generateRobustSelector(element),
        value: '',
        label: `${element.name || element.placeholder}に空値を入力`
      });
    }
    
    return steps;
  }
}
```

#### CLI使用例
```bash
# 基本使用
node tests/generateSmartRoutes.js \
  --url "https://hotel-example-site.takeyaqa.dev/" \
  --natural-test-cases "naturalLanguageTestCases_241205123456.json"

# 強制AI分析モード
node tests/generateSmartRoutes.js \
  --url "https://example.com" \
  --force-ai-analysis

# PDF仕様書とCSV併用
node tests/generateSmartRoutes.js \
  --url "https://example.com" \
  --spec-pdf "./specs/requirements.pdf" \
  --test-csv "./test_point/custom.csv" \
  --natural-test-cases "naturalLanguageTestCases_241205123456.json"
```

#### 出力ルート形式
```json
{
  "route_id": "route_241205123456_001",
  "testName": "ログイン機能バリデーションテスト",
  "category": "input_validation",
  "priority": "high",
  "feasibilityScore": 0.85,
  "steps": [
    {
      "action": "goto",
      "target": "https://hotel-example-site.takeyaqa.dev/login",
      "label": "ログインページにアクセス",
      "timeout": 30000
    },
    {
      "action": "waitForSelector",
      "target": "[name=\"username\"]",
      "label": "ユーザー名フィールドの表示待機"
    },
    {
      "action": "fill",
      "target": "[name=\"username\"]",
      "value": "",
      "label": "ユーザー名に空文字を入力"
    },
    {
      "action": "click",
      "target": "button[type=\"submit\"]:has-text(\"ログイン\")",
      "label": "ログインボタンをクリック"
    },
    {
      "action": "expect",
      "target": ".error-message, .alert-danger, [role=\"alert\"]",
      "expectType": "toBeVisible",
      "label": "エラーメッセージの表示確認"
    }
  ],
  "metadata": {
    "generated_at": "2024-12-05T12:34:56.789Z",
    "dom_elements_matched": 3,
    "user_story_context": "ログイン機能の包括的テスト"
  }
}
```

### 4. runRoutes.js
**目的**: 生成されたPlaywrightルートを実行

#### 主要クラス

```javascript
class BrowserSessionManager {
  static instance = null;
  static browser = null;
  static page = null;
  static sessionCount = 0;

  // ブラウザインスタンス取得（セッション管理対応）
  static async getBrowserInstance(keepSession = false) {
    if (!keepSession && this.browser && this.browser.isConnected()) {
      console.log('🔄 セッション維持OFF：既存ブラウザを強制終了');
      await this.forceTerminateBrowser();
    }
    
    if (!this.browser || !this.browser.isConnected()) {
      console.log('🚀 新しいブラウザインスタンスを作成');
      this.sessionCount++;
      
      this.browser = await playwright.chromium.launch({
        headless: false,
        args: [
          '--disable-web-security',
          '--no-sandbox',
          '--window-size=1366,768'
        ]
      });
      
      this.page = await this.browser.newPage();
      await this.page.setViewportSize({ width: 1366, height: 768 });
    }
    
    return { browser: this.browser, page: this.page };
  }

  // 強制ブラウザ終了
  static async forceTerminateBrowser() {
    if (this.browser && this.browser.isConnected()) {
      await this.browser.close();
    }
    this.browser = null;
    this.page = null;
  }

  // Android実機ブラウザ初期化
  static async initializeAndroidBrowser() {
    this.isAndroidDevice = true;
    const browser = await playwright.chromium.connectOverCDP({
      endpointURL: 'http://localhost:9222'
    });
    return browser;
  }
}

export class PlaywrightRunner {
  constructor(options = {}) {
    this.keepSession = options.keepSession || 
                       process.argv.includes('--keep-session') || 
                       process.env.PLAYWRIGHT_KEEP_SESSION === 'true';
    this.testTimeout = options.testTimeout || 300000; // 5分
    this.setupGracefulShutdown();
  }

  // 初期化
  async initialize() {
    const { browser, page } = await BrowserSessionManager.getBrowserInstance(this.keepSession);
    this.browser = browser;
    this.page = page;
  }

  // ルート実行
  async executeRoute(routeData) {
    const results = {
      route_id: routeData.route_id,
      testName: routeData.testName,
      steps: [],
      startTime: new Date().toISOString()
    };

    for (let i = 0; i < routeData.steps.length; i++) {
      const step = routeData.steps[i];
      console.log(`🔄 [${i + 1}/${routeData.steps.length}] ${step.label}`);
      
      try {
        const stepResult = await this.executeStep(step, i);
        results.steps.push({
          stepIndex: i,
          action: step.action,
          success: true,
          result: stepResult,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        results.steps.push({
          stepIndex: i,
          action: step.action,
          success: false,
          error: error.message,
          timestamp: new Date().toISOString()
        });
        throw error;
      }
    }

    return results;
  }

  // ステップ実行
  async executeStep(step, stepIndex = 0) {
    const { action, target, value, label, expectType } = step;
    
    switch (action) {
      case 'goto':
        await this.page.goto(target, { waitUntil: 'networkidle' });
        return `ページ移動完了: ${target}`;

      case 'fill':
        await this.page.fill(target, value);
        return `入力完了: ${target} = "${value}"`;

      case 'click':
        await this.page.click(target);
        return `クリック完了: ${target}`;

      case 'waitForSelector':
        await this.page.waitForSelector(target, { timeout: 10000 });
        return `要素表示確認: ${target}`;

      case 'expect':
        const element = await this.page.locator(target);
        switch (expectType) {
          case 'toBeVisible':
            await expect(element).toBeVisible();
            return `表示確認成功: ${target}`;
          case 'toHaveText':
            await expect(element).toHaveText(value);
            return `テキスト確認成功: ${target} = "${value}"`;
          default:
            throw new Error(`未対応の期待値タイプ: ${expectType}`);
        }

      default:
        throw new Error(`未対応のアクション: ${action}`);
    }
  }

  // クリーンアップ
  async cleanup(force = false) {
    if (force || !this.keepSession) {
      await BrowserSessionManager.closeBrowser(force);
    }
  }
}
```

#### CLI使用例
```bash
# 基本実行
node tests/runRoutes.js

# セッション維持モード（複数テスト間でブラウザ状態維持）
node tests/runRoutes.js --keep-session

# Android実機テスト
node tests/runRoutes.js --android-device

# 特定ルートファイル実行
node tests/runRoutes.js --route-file "route_241205123456.json"

# バッチ実行（複数ルート）
node tests/runRoutes.js --batch --route-file "route_001.json" --route-file "route_002.json"

# Playwright形式実行
node tests/runRoutes.js --playwright-format --generate-code

# 環境変数による制御
PLAYWRIGHT_KEEP_SESSION=true node tests/runRoutes.js
PLAYWRIGHT_TEST_TIMEOUT=600000 node tests/runRoutes.js
```

#### 実行結果形式
```json
{
  "route_id": "route_241205123456_001",
  "testName": "ログイン機能バリデーションテスト",
  "startTime": "2024-12-05T12:34:56.789Z",
  "endTime": "2024-12-05T12:35:23.456Z",
  "duration": 26667,
  "success": true,
  "steps": [
    {
      "stepIndex": 0,
      "action": "goto",
      "target": "https://example.com/login",
      "success": true,
      "result": "ページ移動完了: https://example.com/login",
      "timestamp": "2024-12-05T12:34:57.123Z",
      "duration": 2340
    },
    {
      "stepIndex": 1,
      "action": "fill",
      "target": "[name=\"username\"]",
      "value": "",
      "success": true,
      "result": "入力完了: [name=\"username\"] = \"\"",
      "timestamp": "2024-12-05T12:34:58.456Z",
      "duration": 150
    }
  ],
  "summary": {
    "totalSteps": 5,
    "successSteps": 5,
    "failedSteps": 0,
    "successRate": 100
  }
}
```

## 🔧 分析・改善モジュール

### 1. analyzeFailures.js
**目的**: 失敗したテストの原因分析と修正提案

#### 主要機能
- **失敗パターン分析**: エラーメッセージからの原因特定
- **AI修正提案**: OpenAI活用による修正案生成
- **ルールベース修正**: 定型的な修正パターン適用
- **セレクタ最適化**: より堅牢なセレクタ提案

#### CLI使用例
```bash
# 基本失敗分析
node tests/analyzeFailures.js

# AI修正モード有効
node tests/analyzeFailures.js --enable-ai

# 手動セレクタ指定
node tests/analyzeFailures.js \
  --manual-selectors '{"login": "#loginBtn", "username": "#user"}'

# 目標・PDF指定
node tests/analyzeFailures.js \
  --url "https://example.com" \
  --goal "ログイン機能改善" \
  --spec-pdf "./specs/requirements.pdf"
```

### 2. discoverNewStories.js
**目的**: 成功テストから新しいテストシナリオを自動発見

#### 主要機能
- **成功パターン分析**: 正常に動作したテストの解析
- **未カバー領域発見**: テストが実行されていない機能の特定
- **新規ストーリー生成**: AI活用による新しいテストケース提案

#### CLI使用例
```bash
# 基本新ストーリー発見
node tests/discoverNewStories.js --url "https://example.com"

# 詳細分析モード
node tests/discoverNewStories.js \
  --url "https://hotel-example-site.takeyaqa.dev/" \
  --goal "ホテル予約システムの網羅的テスト"
```

### 3. generateTestReport.js
**目的**: 包括的なテストレポート生成

#### 主要機能
- **HTML形式レポート**: ブラウザで閲覧可能な詳細レポート
- **CSV形式出力**: Excel等での分析用データ
- **カバレッジ分析**: テスト網羅度の可視化
- **失敗分析サマリー**: エラー傾向の統計情報

#### レポート内容
1. **テスト実行サマリー**: 成功/失敗数、実行時間
2. **詳細結果**: 各テストケースの実行詳細
3. **失敗分析**: エラー原因とパターン分析
4. **推奨改善案**: 次回実行への提案

#### CLI使用例
```bash
# 基本レポート生成
node tests/generateTestReport.js

# URL・目標指定
node tests/generateTestReport.js \
  --url "https://example.com" \
  --goal "包括的テストレポート"
```

## 🎯 ユーティリティモジュール

### 1. utils/cliParser.js
**CLI引数解析機能**

```javascript
// CLI引数パース
export function parseCLIArgs() {
  const args = process.argv.slice(2);
  const options = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
      options[key] = value;
      if (value !== true) i++;
    }
  }
  
  return options;
}

// オプション検証
export function validateOptions(options) {
  const required = ['url'];
  for (const field of required) {
    if (!options[field]) {
      throw new Error(`必須オプション ${field} が指定されていません`);
    }
  }
}
```

### 2. utils/pdfParser.js
**PDF処理機能**

```javascript
// PDF→OpenAI変換
export async function uploadPDFToOpenAI(pdfPath, openai) {
  const pdfBuffer = fs.readFileSync(pdfPath);
  const file = await openai.files.create({
    file: pdfBuffer,
    purpose: 'assistants'
  });
  
  return {
    fileId: file.id,
    filename: path.basename(pdfPath),
    size: pdfBuffer.length
  };
}

// PDFプロンプト生成
export function createPDFPrompt(pdfFileInfo) {
  return `PDF仕様書ファイル: ${pdfFileInfo.filename} (${pdfFileInfo.size}bytes)
ファイルID: ${pdfFileInfo.fileId}

この仕様書の内容を参考にして、テスト観点の具体例を生成してください。`;
}
```

### 3. htmlReporter.js
**HTMLレポート生成**

```javascript
export class HtmlReporter {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.testResults = [];
    this.startTime = null;
  }

  startTest(testName) {
    this.startTime = new Date();
    this.currentTest = { name: testName, steps: [] };
  }

  addStep(step) {
    this.currentTest.steps.push({
      ...step,
      timestamp: new Date().toISOString()
    });
  }

  generateHtmlReport() {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>AutoPlaywright テストレポート</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .summary { background: #f0f8ff; padding: 15px; border-radius: 8px; }
        .test-case { margin: 20px 0; border: 1px solid #ddd; border-radius: 8px; }
        .success { color: #28a745; }
        .error { color: #dc3545; }
    </style>
</head>
<body>
    <h1>📊 AutoPlaywright テストレポート</h1>
    <div class="summary">
        <h2>実行サマリー</h2>
        <p>実行日時: ${new Date().toLocaleString('ja-JP')}</p>
        <p>総テスト数: ${this.testResults.length}</p>
    </div>
    ${this.generateTestCaseHtml()}
</body>
</html>`;
    
    return html;
  }
}
```

## 🌐 Web UIコンポーネント

### メイン画面構成

#### 1. 基本設定セクション
```html
<div class="section">
    <h2>📋 基本設定</h2>
    <div class="form-group">
        <label for="url">テスト対象URL *</label>
        <input type="url" id="url" placeholder="https://example.com" required>
    </div>
    <div class="form-group">
        <label for="goal">ユーザーストーリー・目標</label>
        <textarea id="goal" placeholder="テストの目的や確認したい内容を記述"></textarea>
    </div>
    <div class="user-story-id" id="userStoryDisplay">
        トレーサビリティID: <span id="currentUserStoryId">1</span>
    </div>
</div>
```

#### 2. ファイルアップロード
```html
<div class="form-group">
    <label for="pdfFile">📄 仕様書PDF（任意）</label>
    <input type="file" id="pdfFile" accept=".pdf">
</div>
<div class="form-group">
    <label for="csvFile">📊 テスト観点CSV（任意）</label>
    <input type="file" id="csvFile" accept=".csv">
</div>
```

#### 3. ワンクリック実行ボタン
```html
<button class="btn-primary manual-guide-btn" onclick="executeAllSteps()">
    🚀 自動で一括実行する
</button>
```

### JavaScript API関数

#### メインAPI呼び出し
```javascript
async function executeCommand(command, additionalData = {}) {
    const formData = new FormData();
    formData.append('command', command);
    formData.append('url', document.getElementById('url').value);
    formData.append('goal', document.getElementById('goal').value);
    
    const pdfFile = document.getElementById('pdfFile').files[0];
    const csvFile = document.getElementById('csvFile').files[0];
    
    if (pdfFile) formData.append('pdf', pdfFile);
    if (csvFile) formData.append('csv', csvFile);
    
    // 追加データを追加
    Object.keys(additionalData).forEach(key => {
        formData.append(key, additionalData[key]);
    });

    try {
        showStatus('実行中...', 'info');
        const response = await fetch('/api/execute', {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        
        if (result.success) {
            showStatus('実行完了', 'success');
            appendLog(result.output || '実行が正常に完了しました');
            
            // HTMLレポートURLがある場合は表示
            if (result.htmlReportUrl) {
                showReportLink(result.htmlReportUrl, result.htmlReportFile);
            }
        } else {
            showStatus('実行エラー', 'error');
            appendLog(`エラー: ${result.error}`, 'error');
        }
        
        return result;
    } catch (error) {
        showStatus('実行エラー', 'error');
        appendLog(`通信エラー: ${error.message}`, 'error');
        throw error;
    }
}
```

#### ワンクリック一括実行
```javascript
async function executeAllSteps() {
    const steps = [
        { command: 'generateTestPoints', name: '📋 テスト観点生成' },
        { command: 'generateTestCases', name: '🧠 テストケース生成' },
        { command: 'generateSmartRoutes', name: '🎭 Playwright変換' },
        { command: 'runRoutes', name: '▶️ テスト実行' },
        { command: 'generateTestReport', name: '📊 レポート生成' },
        { command: 'analyzeFailures', name: '🔧 失敗分析' },
        { command: 'discoverNewStories', name: '🔍 新ストーリー発見' }
    ];
    
    let allResults = [];
    
    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        appendLog(`\n=== ${step.name} ===`);
        
        try {
            const result = await executeCommand(step.command);
            allResults.push(result);
            
            // 失敗分析は失敗がある場合のみ実行
            if (step.command === 'analyzeFailures' && !hasFailures(allResults)) {
                appendLog('失敗がないため、失敗分析をスキップします');
                continue;
            }
            
        } catch (error) {
            appendLog(`${step.name}でエラーが発生しました: ${error.message}`, 'error');
            if (i < 4) { // 必須ステップでエラーの場合は中断
                break;
            }
        }
    }
    
    showCompletionSummary(allResults);
}
```

#### ログ表示・状態管理
```javascript
function appendLog(message, type = 'info') {
    const logArea = document.getElementById('log-area');
    const timestamp = new Date().toLocaleTimeString('ja-JP');
    const icon = type === 'error' ? '❌' : type === 'success' ? '✅' : '📝';
    
    logArea.innerHTML += `[${timestamp}] ${icon} ${message}\n`;
    logArea.scrollTop = logArea.scrollHeight;
}

function showStatus(message, type) {
    const statusElement = document.getElementById('status');
    statusElement.textContent = message;
    statusElement.className = `status ${type}`;
}

function showReportLink(url, filename) {
    const reportLink = document.createElement('div');
    reportLink.innerHTML = `
        <p>📊 <strong>HTMLレポート生成完了!</strong></p>
        <p><a href="${url}" target="_blank">📋 ${filename}</a></p>
    `;
    reportLink.style.cssText = 'background: #d4edda; padding: 10px; border-radius: 5px; margin-top: 10px;';
    
    document.getElementById('status').appendChild(reportLink);
}
```

## 📊 設定・統合機能

### config.json構造
```json
{
  "targetUrl": "https://hotel-example-site.takeyaqa.dev/",
  "openai": {
    "apiKeyEnv": "OPENAI_API_KEY",
    "model": "gpt-4o-mini",
    "temperature": 0.5,
    "max_tokens": 4000,
    "top_p": 0.9,
    "timeout": 30000,
    "maxRetries": 3
  },
  "googleSheets": {
    "shareEmail": "user@example.com",
    "driveFolder": "TestResults",
    "spreadsheetTitle": "AutoPlaywright Results",
    "autoUpload": true
  },
  "userStory": {
    "currentId": 1,
    "content": "ホテル予約機能の包括的テスト",
    "timestamp": "2024-12-05T12:34:56.789Z",
    "history": [
      {
        "id": 1,
        "content": "ホテル予約機能の包括的テスト",
        "timestamp": "2024-12-05T12:34:56.789Z"
      }
    ]
  }
}
```

### 環境変数
```bash
# 必須設定
OPENAI_API_KEY=sk-your-api-key-here

# オプション設定
PLAYWRIGHT_KEEP_SESSION=true        # セッション維持
PLAYWRIGHT_TEST_TIMEOUT=300000      # タイムアウト（ミリ秒）
PLAYWRIGHT_FORCE_CLOSE=true         # 強制終了フラグ

# Google Cloud設定（Sheets連携用）
GOOGLE_APPLICATION_CREDENTIALS=/path/to/credentials.json
```

### Google Sheets連携

#### uploadToGoogleSheets.js
```bash
# 基本アップロード
node tests/uploadToGoogleSheets.js

# 共有設定付き
node tests/uploadToGoogleSheets.js \
  --share-email "user@example.com" \
  --drive-folder "TestResults"

# カスタムタイトル
node tests/uploadToGoogleSheets.js \
  --title "AutoPlaywright Test Results - $(date '+%Y%m%d')"

# 詳細ログ
node tests/uploadToGoogleSheets.js --verbose
```

## 📱 Android実機テスト対応

### ADB設定手順
```bash
# 1. ADBデバイス確認
adb devices

# 2. Chrome DevToolsポートフォワード設定
adb forward tcp:9222 localabstract:chrome_devtools_remote

# 3. Chrome接続確認
curl http://localhost:9222/json/version
```

### API経由での自動設定
```javascript
// ADB状態確認
async function checkAdbStatus() {
    const response = await fetch('/api/adb-status');
    const status = await response.json();
    
    if (status.success) {
        console.log(`Android デバイス: ${status.deviceCount}台検出`);
        console.log(`Chrome接続: ${status.chromeConnected ? '成功' : '失敗'}`);
    }
    
    return status;
}

// ADB設定実行
async function setupAdb() {
    const response = await fetch('/api/adb-setup', { method: 'POST' });
    const result = await response.json();
    
    if (result.success) {
        appendLog('ADBポートフォワード設定完了', 'success');
    } else {
        appendLog(`ADB設定エラー: ${result.error}`, 'error');
    }
    
    return result;
}
```

### Android実機テスト実行
```bash
# Android実機でテスト実行
node tests/runRoutes.js --android-device

# Android + セッション維持
node tests/runRoutes.js --android-device --keep-session

# Android + 特定ルート
node tests/runRoutes.js --android-device --route-file "route_mobile_001.json"
```

## 🔄 Docker対応

### docker-compose.yml利用
```yaml
version: '3.8'
services:
  autoplaywright:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./test-results:/app/test-results
      - ./specs:/app/specs
      - ./test_point:/app/test_point
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - PLAYWRIGHT_KEEP_SESSION=true
```

### 使用例
```bash
# 1. 環境変数設定
echo "OPENAI_API_KEY=sk-your-api-key" > .env

# 2. ビルド・起動
docker-compose build
docker-compose up

# 3. コマンド実行
docker-compose run --rm autoplaywright \
  node tests/generateTestPoints.js \
  --url "https://example.com"

# 4. WebUI使用
open http://localhost:3000
```

## 🎓 使用例・ベストプラクティス

### 1. 基本ワークフロー
```bash
# Step 1: サーバー起動
npm run webui

# Step 2: WebUIアクセス
open http://localhost:3000

# Step 3: 基本設定入力
# - テスト対象URL
# - ユーザーストーリー  
# - PDF/CSV（任意）

# Step 4: ワンクリック実行
# 「🚀 自動で一括実行する」ボタンクリック
```

### 2. CLI完全実行
```bash
# フル機能CLI実行例
node tests/generateTestPoints.js \
  --url "https://hotel-example-site.takeyaqa.dev/" \
  --goal "ホテル予約からチェックインまでの一連フロー" \
  --spec-pdf "./specs/hotel_requirements.pdf"

node tests/generateTestCases.js \
  --test-points "testPoints_241205123456.json" \
  --url "https://hotel-example-site.takeyaqa.dev/"

node tests/generateSmartRoutes.js \
  --url "https://hotel-example-site.takeyaqa.dev/" \
  --natural-test-cases "naturalLanguageTestCases_241205123456.json"

node tests/runRoutes.js --keep-session

node tests/generateTestReport.js
```

### 3. CI/CD統合
```yaml
# GitHub Actions例
name: AutoPlaywright Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm install
      
      - name: Run AutoPlaywright CI Pipeline
        run: npm run ci-pipeline
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
      
      - name: Upload test results
        uses: actions/upload-artifact@v3
        with:
          name: test-results
          path: test-results/
```

### 4. エラー対応ワークフロー
```bash
# 1. 失敗テストの分析
node tests/analyzeFailures.js --enable-ai

# 2. 修正されたテストの再実行
node tests/runRoutes.js --route-file "fixed_route_241205123456.json"

# 3. 成功後の新ストーリー発見
node tests/discoverNewStories.js --url "https://example.com"

# 4. 最終レポート生成
node tests/generateTestReport.js
```

## 🔗 外部連携・拡張

### Google Sheets API連携
- OAuth2認証によるセキュアアクセス
- リアルタイムテスト結果共有
- チーム間でのテスト状況可視化

### Playwright拡張機能
- カスタムリポーター対応
- 追加ブラウザエンジン対応（Firefox、Safari）
- モバイルデバイステスト対応

### OpenAI API最適化
- GPT-4o/GPT-4o-mini適切選択
- 温度・トークン数の詳細調整
- コスト最適化設定

## 📈 パフォーマンス最適化

### メモリ使用量最適化
- ブラウザセッション管理による効率化
- 大容量PDFの分割処理対応
- DOM解析結果のキャッシュ機能

### 実行速度向上
- 並列テスト実行対応
- スマートセレクタによる安定性向上
- 不要なDOM読み込みスキップ

### コスト最適化
- AI呼び出し回数の最小化
- 重複テストケースの自動排除
- 効率的なプロンプト設計

## 🔧 トラブルシューティング

### よくある問題と解決方法

#### 1. ブラウザセッションエラー
```bash
# 解決方法
pkill -f chromium
npm run webui
```

#### 2. OpenAI API制限
```json
{
  "temperature": 0.3,
  "max_tokens": 2000
}
```

#### 3. Android ADBエラー
```bash
adb kill-server
adb start-server
adb forward tcp:9222 localabstract:chrome_devtools_remote
```

#### 4. ポート競合エラー
```bash
# ポート確認
lsof -i :3000

# プロセス終了
pkill -f "node server.js"

# 再起動
npm run webui
```

#### 5. メモリ不足エラー
```bash
# Node.jsメモリ制限拡張
NODE_OPTIONS="--max-old-space-size=4096" npm run webui
```

---

このドキュメントは、AutoPlaywrightの全機能を網羅した完全リファレンスです。実装の詳細や最新情報については、各モジュールのソースコードおよびREADME.mdをご参照ください。