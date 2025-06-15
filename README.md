# AutoPlaywright

Playwrightを使用したE2Eテストを自動生成します。OpenAI APIを活用し、テスト観点リストに沿って、指定されたHTMLを対象にテスト分析～テスト実装し、テストシナリオの作成から実行までを自動化します。

## 機能

- テスト観点のCSVテンプレート ```TestPoint_Format.csv``` からテスト観点を自動生成
- テスト観点に基づいたテストシナリオの自動生成
- Playwrightによるテストの自動実行
- テスト結果のJSONファイル出力
- キャッシュ機能によるOpenAI API呼び出しの最適化

## 必要要件

- Node.js
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
cp .env.example .env
# .envファイルにOPENAI_API_KEYを設定
```

## 使用方法

1. テストポイントの生成:
```sh
node tests/generateTestPoints.js
```

2. テストシナリオの生成:
```sh
node tests/generatePlanRoutes.js
```

3. テストの実行:
```sh
node tests/runRoutes.js
```

## Docker での実行

```sh
docker compose up
```

## ファイル構造

- `test_point/` - テストポイントのCSVテンプレート
- `tests/` - テスト関連スクリプト
- `test-results/` - テスト結果の出力ディレクトリ
- `cache/` - APIレスポンスのキャッシュ

## ライセンス

[MITライセンス](LICENSE)
