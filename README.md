# AutoPlaywright

Playwrightを使用したE2Eテストを自動生成して実行します。OpenAIのGPTモデルを活用して、テスト観点から自動的にテストシナリオを生成し、実行します。 ※「設定」にてご自身のOpenAI API KEYを設定してください。

## 機能

- テスト観点のCSVテンプレート ```TestPoint_Format.csv``` と、テスト対象のURL、仕様書PDFからテスト観点を自動生成
- テスト観点に基づいたテストシナリオの自動生成
- Playwrightによるテストの自動実行
- テスト結果のJSONファイル出力
- キャッシュ機能によるOpenAI API呼び出しの最適化
- 仕様書PDFからの詳細なテストケース生成（新機能）

## 必要条件

- Node.js v24.2.0以上
- OpenAI APIキー

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

#### 基本的な使用方法（URLのみ）
```bash
node tests/generateTestPoints.js
```

#### PDF仕様書を指定する場合
```bash
node tests/generateTestPoints.js --spec-pdf ./specs/requirements.pdf
```

#### URLとPDFの両方を指定する場合
```bash
node tests/generateTestPoints.js --url "https://example.com" --spec-pdf ./specs/requirements.pdf
```

#### その他のオプション
```bash
# 詳細ログを出力
node tests/generateTestPoints.js --spec-pdf ./specs/requirements.pdf --verbose

# 出力ディレクトリを指定
node tests/generateTestPoints.js --spec-pdf ./specs/requirements.pdf --output ./custom-output
```

- `test_point/TestPoint_Format.csv` からテスト観点を抽出
- 生成されたテスト観点は `test-results/testPoints_[timestamp].json` に保存

### 2. テストシナリオの生成

#### 基本的な使用方法（URLのみ）
```bash
node tests/generatePlanRoutes.js
```

#### PDF仕様書を指定する場合
```bash
node tests/generatePlanRoutes.js --spec-pdf ./specs/requirements.pdf
```

#### URLとPDFの両方を指定する場合
```bash
node tests/generatePlanRoutes.js --url "https://example.com" --spec-pdf ./specs/requirements.pdf
```

- テスト観点からテストシナリオを生成
- 生成されたシナリオは `test-results/route_[timestamp].json` に保存

### 3. テストの実行

```bash
node tests/runRoutes.js
```

- 生成されたテストシナリオを実行
- 実行結果は `test-results/result_[timestamp].json` に保存
- ターミナルにも実行ログを表示

### 4. テスト結果をケース形式で保存

```bash
node tests/generateTestReport.js
```

- テスト実行結果を分析し、CSV形式のテストケースを生成
- 生成されたテストケースは `test-results/test_report_[timestamp].csv` に保存

## CLIオプション

### 共通オプション
- `-p, --spec-pdf <path>`: 仕様書PDFファイルのパス
- `-u, --url <url>`: テスト対象のURL（config.jsonの設定を上書き）
- `-o, --output <path>`: 出力ディレクトリのパス
- `-v, --verbose`: 詳細なログを出力

### 使用例
```bash
# PDF仕様書のみを使用
node tests/generateTestPoints.js --spec-pdf ./specs/requirements.pdf

# URLのみを使用（config.jsonの設定を上書き）
node tests/generateTestPoints.js --url "https://example.com"

# PDFとURLの両方を使用
node tests/generateTestPoints.js --spec-pdf ./specs/requirements.pdf --url "https://example.com" --verbose

# 特殊文字を含むURLの場合（引用符で囲む）
node tests/generateTestPoints.js --url "https://example.com/path?param=value" --spec-pdf ./specs/requirements.pdf
```

## PDF仕様書の活用

### 対応ファイル形式
- PDFファイル（.pdf）

### 活用方法
1. **仕様書のみ**: PDFファイルからテスト観点を抽出
2. **URL + 仕様書**: 画面情報と仕様書の両方を考慮したテストケース生成
3. **詳細なテスト**: 仕様書の要件を反映した包括的なテストシナリオ

### メリット
- 仕様書の要件を反映したテストケース生成
- 実装と仕様の整合性確認
- より詳細で正確なテストシナリオ

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
