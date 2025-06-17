# AutoPlaywright

Playwrightを使用したE2Eテストを自動生成します。OpenAIのGPTモデルを活用して、テスト観点から自動的にテストシナリオを生成し、実行します。 ※「設定」にてご自身のOpenAI API KEYを設定してください。

## 機能

- テスト観点のCSVテンプレート ```TestPoint_Format.csv``` からテスト観点を自動生成
- テスト観点に基づいたテストシナリオの自動生成
- Playwrightによるテストの自動実行
- テスト結果のJSONファイル出力
- キャッシュ機能によるOpenAI API呼び出しの最適化

## 必要要件

- Node.js v24.2.0以上
- OpenAI API キー
- Docker (オプション)

## セットアップ

1. リポジトリのクローン:
```sh
git clone https://github.com/k-sakQA/autoplaywright.git
cd autoplaywright
```

2. 依存パッケージのインストール:
```sh
npm install
```

3. 環境変数の設定:
```sh
# Windows
copy .env.example .env

# Mac
cp .env.example .env

# .envファイルにOPENAI_API_KEYを設定
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
node tests/generateTestPoints.js
```

- `test_point/TestPoint_Format.csv` からテスト観点を抽出
- 生成されたテスト観点は `test-results/testPoints_[timestamp].json` に保存

### 2. テストシナリオの生成

```bash
node tests/generatePlanRoutes.js
```

- テスト観点からテストシナリオを生成
- 生成されたシナリオは `test-results/route_[timestamp].json` に保存

### 3. テストの実行

```bash
node tests/runRoutes.js
```

- 生成されたテストを実行
- 実行結果は `test-results/result_[timestamp].json` に保存
- ターミナルにも実行ログを表示

### 4. テスト結果をケース形式で保存

```bash
node tests/generateTestReport.js
```

- テスト実行結果を分析し、CSV形式のテストケースを生成
- 生成されたテストケースは `test-results/test_report_[timestamp].csv` に保存

## Docker での実行

```bash
# テスト観点の生成
docker-compose run --rm autoplaywright node tests/generateTestPoints.js

# テストルートの生成
docker-compose run --rm autoplaywright node tests/generatePlanRoutes.js

# テストの実行
docker-compose run --rm autoplaywright node tests/runRoutes.js

# テストレポートの生成
docker-compose run --rm autoplaywright node tests/generateTestReport.js
```

## サポートされているPlaywrightのアクション

- `goto`/`load`: ページ遷移
- `waitForSelector`: 要素の待機
- `assertVisible`: 要素の表示確認
- `assertNotVisible`: 要素の非表示確認
- `click`: クリック操作
- `fill`: フォーム入力
- `waitForURL`: URL遷移の確認

## ファイル構造

- `test_point/` - テストポイントのCSVテンプレート
- `tests/` - テスト関連スクリプト
- `test-results/` - テスト結果の出力ディレクトリ
- `cache/` - APIレスポンスのキャッシュ

## ライセンス

このプロジェクトは以下のライセンスの下で公開されています：

### MIT License

Copyright (c) 2025 k-sakQA

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
