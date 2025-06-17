# AutoPlaywright

Playwrightを使用した自動テスト生成・実行ツールです。OpenAIのGPTモデルを活用して、テスト観点から自動的にテストシナリオを生成し、実行します。

## 機能

- テスト観点から自動的にテストシナリオを生成
- 生成されたシナリオの自動実行
- テスト結果の詳細なログ出力と保存
- 失敗したテストケースの明確な表示

## 必要条件

- Node.js v24.2.0以上
- OpenAI APIキー

## インストール

```bash
# リポジトリのクローン
git clone [repository-url]
cd autoplaywright

# 依存パッケージのインストール
npm install

# 環境変数の設定
# Windows
copy .env.example .env

# Mac
cp .env.example .env

# .envファイルを編集して、OPENAI_API_KEYを設定
```

## 設定

`config.json` で以下の設定を行います：

```json
{
  "targetUrl": "ここにテスト対象のURLを記載してください",
  "openai": {
    "apiKeyEnv": "OPENAI_API_KEY",
    "model": "gpt-4o-mini",
    "temperature": 0.5
  }
}
```

## 使用方法

### 1. テスト観点の生成

```bash
# Windows
node tests/generateTestPoints.js

# Mac
node tests/generateTestPoints.js
```

- `test_point/TestPoint_Format.csv` からテスト観点を抽出
- 生成されたテスト観点は `test-results/testPoints_[timestamp].json` に保存

### 2. テストルートの生成

```bash
# Windows
node tests/generatePlanRoutes.js

# Mac
node tests/generatePlanRoutes.js
```

- テスト観点からテストシナリオを生成
- 生成されたルートは `test-results/route_[timestamp].json` に保存

### 3. テストの実行

```bash
# Windows
node tests/runRoutes.js

# Mac
node tests/runRoutes.js
```

- 生成されたテストシナリオを実行
- 実行結果は `test-results/result_[timestamp].json` に保存
- ターミナルに詳細な実行ログを表示

## サポートされているアクション

- `goto`/`load`: ページ遷移
- `waitForSelector`: 要素の待機
- `assertVisible`: 要素の表示確認
- `assertNotVisible`: 要素の非表示確認
- `click`: クリック操作
- `fill`: フォーム入力
- `waitForURL`: URL遷移の確認