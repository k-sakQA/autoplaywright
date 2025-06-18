# AutoPlaywright

Playwrightを使用したE2Eテストを自動生成して実行します。OpenAIのGPTモデルを活用して、テスト観点から自動的にテストシナリオを生成し、実行します。 ※「設定」にてご自身のOpenAI API KEYを設定してください。

## 機能

- テスト観点のCSVテンプレート ```TestPoint_Format.csv``` と、テスト対象のURL、仕様書PDFからテスト観点を自動生成
- テスト観点に基づいたテストシナリオの自動生成
- Playwrightによるテストの自動実行
- テスト結果のJSONファイル出力
- キャッシュ機能によるOpenAI API呼び出しの最適化
- 仕様書PDFからのテスト観点抽出（新機能）

## ファイル配置

### 仕様書PDFの配置
仕様書PDFファイルは `specs/` ディレクトリに配置してください：

```
autoplaywright/
├── specs/
│   └── requirements.pdf      # AIに参照させたい仕様書（PDF形式）
├── test_point/
├── tests/
└── ...
```

### 使用例
```bash
# specs/requirements.pdfを使用する場合
node tests/generateTestPoints.js --spec-pdf ./specs/requirements.pdf

# specs/design.pdfを使用する場合
node tests/generateTestPoints.js --spec-pdf ./specs/design.pdf
```

## 必要条件

- Node.js v24.2.0以上
- OpenAI APIキー
- Docker（オプション）

## セットアップ

### 通常のセットアップ

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

### Dockerを使用する場合

1. リポジトリのクローン:
```sh
git clone https://github.com/k-sakQA/autoplaywright.git
cd autoplaywright
```

2. 環境変数の設定:
```sh
echo "OPENAI_API_KEY=your-api-key" > .env
```

3. Dockerイメージのビルド:
```sh
docker-compose build
```

## 設定

`config.json` でChat-GPTの初期値は以下のようになっています：

```json
{
  "targetUrl": "ここにテスト対象のURLを記載してください",
  "openai": {
    "apiKeyEnv": "OPENAI_API_KEY",
    "model": "gpt-4o-mini",
    "temperature": 0.5,
    "max_tokens": 4000,
    "top_p": 0.9,
    "timeout": 60000,
    "maxRetries": 3
  }
}
```

### OpenAI設定オプション

| 設定項目 | 説明 | デフォルト値 | 範囲 |
|---------|------|-------------|------|
| `apiKeyEnv` | APIキーの環境変数名 | `OPENAI_API_KEY` | - |
| `model` | 使用するモデル | `gpt-4o-mini` | `gpt-4o-mini`, `gpt-4o`, `gpt-4-turbo`等 |
| `temperature` | 創造性（ランダム性） | `0.5` | `0.0` - `2.0` |
| `max_tokens` | 最大トークン数 | `4000` | `1` - `4096` |
| `top_p` | 核サンプリング | `0.9` | `0.0` - `1.0` |
| `timeout` | タイムアウト時間（ミリ秒） | `60000` | - |
| `maxRetries` | 最大リトライ回数 | `3` | - |

## 使用方法

### 通常の実行

#### 1. テスト観点の生成

##### 基本的な使用方法（URLのみ）
```bash
node tests/generateTestPoints.js
```

##### PDF仕様書を指定する場合
```bash
node tests/generateTestPoints.js --spec-pdf ./specs/requirements.pdf
```

##### URLとPDFの両方を指定する場合
```bash
node tests/generateTestPoints.js --url "https://example.com" --spec-pdf ./specs/requirements.pdf
```

##### その他のオプション
```bash
# 出力ディレクトリを指定
node tests/generateTestPoints.js --spec-pdf ./specs/requirements.pdf --output ./custom-output
```

- `test_point/TestPoint_Format.csv` からテスト観点を抽出
- 生成されたテスト観点は `test-results/testPoints_[timestamp].json` に保存

#### 2. テストシナリオの生成

##### 基本的な使用方法（URLのみ）
```bash
node tests/generatePlanRoutes.js
```

##### PDF仕様書を指定する場合
```bash
node tests/generatePlanRoutes.js --spec-pdf ./specs/requirements.pdf
```

##### URLとPDFの両方を指定する場合
```bash
node tests/generatePlanRoutes.js --url "https://example.com" --spec-pdf ./specs/requirements.pdf
```

- テスト観点からテストシナリオを生成
- 生成されたシナリオは `test-results/route_[timestamp].json` に保存

#### 3. テストの実行

```bash
node tests/runRoutes.js
```

- 生成されたテストシナリオを実行
- 実行結果は `test-results/result_[timestamp].json` に保存
- ターミナルにも実行ログを表示

#### 4. テスト結果をケース形式で保存

```bash
node tests/generateTestReport.js
```

- テスト実行結果を分析し、CSV形式のテストケースを生成
- 生成されたテストケースは `test-results/test_report_[timestamp].csv` に保存

### Dockerを使用する場合

```bash
# テスト観点の生成（PDF仕様書付き）
docker-compose run --rm autoplaywright node tests/generateTestPoints.js --spec-pdf ./specs/requirements.pdf

# テストルートの生成（PDF仕様書付き）
docker-compose run --rm autoplaywright node tests/generatePlanRoutes.js --spec-pdf ./specs/requirements.pdf

# テストの実行
docker-compose run --rm autoplaywright node tests/runRoutes.js

# テストレポートの生成
docker-compose run --rm autoplaywright node tests/generateTestReport.js
```

## CLIオプション

### 共通オプション
- `-p, --spec-pdf <path>`: 仕様書PDFファイルのパス
- `-u, --url <url>`: テスト対象のURL（config.jsonの設定を上書き）
- `-o, --output <path>`: 出力ディレクトリのパス
- `-v, --verbose`: 詳細なログを出力（現在は実装されていません）

### 使用例
```bash
# PDF仕様書のみを使用
node tests/generateTestPoints.js --spec-pdf ./specs/requirements.pdf

# URLのみを使用
node tests/generateTestPoints.js --url "https://example.com"

# PDFとURLの両方を使用
node tests/generateTestPoints.js --spec-pdf ./specs/requirements.pdf --url "https://example.com"

# 特殊文字を含むURLの場合（引用符で囲む）
node tests/generateTestPoints.js --url "https://example.com/path?param=value" --spec-pdf ./specs/requirements.pdf
```

## PDF仕様書の活用

### 対応ファイル形式
- PDFファイル（.pdf）

### ファイル配置
仕様書PDFファイルは `specs/` ディレクトリに配置してください。複数の仕様書を配置することも可能です：

```
specs/
└── api_spec.pdf         # AIに参照させたい仕様書（PDF形式）
```

### 活用方法
1. **仕様書のみ**: PDFファイルからテスト観点を抽出
2. **URL + 仕様書**: テスト対象の画面情報と仕様書の両方を考慮したテストケース生成して実行まで行う場合

#### テスト生成の流れ
1. **テスト観点の生成**: 観点リストのCSVと仕様書から、テスト観点を抽出
2. **テストシナリオの生成**: 生成されたテスト観点を参照して、Playwrightで実行可能なテストシナリオを作成
3. **テストの実行**: 生成されたシナリオをPlaywrightで実行（ **観点とシナリオの生成時にURLを付与してください** ）


## サポートされているPlaywrightのアクション

- `goto`/`load`: ページ遷移
- `waitForSelector`: 要素の待機
- `assertVisible`: 要素の表示確認
- `assertNotVisible`: 要素の非表示確認
- `click`: クリック操作
- `fill`: フォーム入力
- `waitForURL`: URL遷移の確認

## ファイル構造

- `specs/` - 仕様書PDFファイルの配置ディレクトリ
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
