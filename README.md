# AutoPlaywright

Playwrightを使用したE2Eテストを自動生成して実行するツールです。OpenAIのGPTモデルを活用して、テスト観点から自動的にテストシナリオを生成し、実行します。

## 🚀 主な機能

- 🤖 **AI自動テスト生成**: GPTモデルを使用してテスト観点とシナリオを自動生成
- 📄 **PDF仕様書対応**: PDF仕様書を読み込んでテスト観点を抽出
- 📋 **カスタムテスト観点**: プロジェクト固有のテスト観点CSVをアップロード可能
- 🌐 **WebUI**: ブラウザから簡単操作（推奨）
- ⚡ **ワンクリック実行**: テスト生成から実行まで自動化
- 📊 **詳細なレポート**: テスト結果の可視化とファイルダウンロード
- 📈 **Google Sheets連携**: テスト結果を自動でスプレッドシートにアップロード
- 🎛️ **AI設定調整**: WebUIからGPTパラメータを調整可能

---

## 📋 必要環境

- **Node.js** v24.2.0以上
- **OpenAI APIキー** （有料）
- **Docker** （オプション）

---

## ⚡ 初回セットアップ

### 1. プロジェクトの取得
```bash
git clone https://github.com/k-sakQA/autoplaywright.git
cd autoplaywright
```

### 2. 依存パッケージのインストール
```bash
npm install
```

### 3. 環境変数の設定（重要）

#### Windows の場合：
```bash
copy .env.example .env
```

#### Mac/Linux の場合：
```bash
cp .env.example .env
```

#### .envファイルを編集：
作成された `.env` ファイルを開いて、OpenAI APIキーを設定してください：

```env
OPENAI_API_KEY=sk-ここにあなたのOpenAI_APIキーを入力
```

💡 **OpenAI APIキーの取得方法**: [OpenAI Platform](https://platform.openai.com/api-keys) でアカウント作成後、APIキーを生成してください

### 4. 設定ファイルの確認（UI画面からも設定できます）
`config.json` でデフォルトのテスト対象URLを設定できます：

```json
{
  "targetUrl": "https://your-test-site.com",
  "openai": {
    "model": "gpt-4o-mini",
    "temperature": 0.5,
    "max_tokens": 4000
  }
}
```

---

## 🌐 WebUI使用方法（推奨）

### 1. サーバー起動
⚠️ **重要**: ブラウザでアクセスする**前に**必ずサーバーを起動してください

```bash
npm run webui
```

以下のメッセージが表示されるまで待つ：
```
🚀 AutoPlaywright WebUI サーバーが起動しました
📱 ブラウザで http://localhost:3000 にアクセスしてください
```

### 🛑 テストを終えてサーバーを停止する時
サーバーを停止する場合は、起動したターミナルで：
```bash
Ctrl + C  # Mac/Linux/Windows共通
```

### 2. ブラウザでアクセス
```
http://localhost:3000
```

### 3. WebUIの使い方

#### 基本設定セクション
1. **テスト対象URL**: テストしたいWebサイトのURLを入力
2. **テスト対象のユーザーストーリーと主なルート**: 具体的なテスト手順や確認したい内容を記述してください
3. **テスト観点CSV**: カスタムテスト観点を使用する場合はCSVファイルをアップロードします
4. **仕様書PDF**: 必要に応じてPDF仕様書をアップロード

#### テスト実行セクション
1. **📋 テスト観点生成**: PDF仕様書からテスト観点を生成
2. **🧠 スマートシナリオ生成**: 動的DOM取得+AI分析によるPlaywrightシナリオ生成
3. **▶️ テスト実行**: 生成されたシナリオを実行
4. **📊 レポート生成**: テスト結果をCSV形式で出力

#### AI設定セクション（下部）
- **モデル選択**: GPT-4o Mini（推奨）、GPT-4o等
- **創造性調整**: 決定的（0.0）〜創造的（1.0）
- **トークン数**: 応答の詳細度を調整
- **💾 設定保存**: 変更内容を永続化

### 4. テスト結果の確認
- **リアルタイムログ**: 実行状況をブラウザで確認
- **結果サマリー**: 成功/失敗数、エラーメッセージを表示
- **ファイルダウンロード**: JSON/CSV結果ファイルをダウンロード

### 5. トラブルシューティング

**🚫 「このサイトにアクセスできません」**
- サーバーが起動していません → `npm run webui` を実行

**🚫 「EADDRINUSE: address already in use」**
- ポート3000が使用中です：
```bash
pkill -f "node server.js"  # 既存プロセス停止
npm run webui              # 再起動
```

**🔄 サーバーの停止方法**
- 通常停止: `Ctrl + C` (起動したターミナルで)
- 強制停止: `pkill -f "node server.js"` (別ターミナルから)

**🚫 「API Key Error」**
- `.env` ファイルのOPENAI_API_KEYを確認してください

---



## 📈 Google Sheets連携機能

テスト結果を自動でGoogle Spreadsheetsにアップロードできます。

### 1. Google Sheets API設定

#### Google Cloud Console設定
1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成
2. Google Sheets APIを有効化
3. サービスアカウントを作成
4. サービスアカウントキー（JSON）をダウンロード

#### 認証ファイル設置
```bash
# ダウンロードしたJSONファイルを credentials.json として保存
cp ~/Downloads/your-service-account-key.json ./credentials.json
```

### 2. WebUIでのGoogle Sheets設定（推奨）

#### 📈 Google Sheets設定セクション
WebUIの「📈 Google Sheets設定」で以下を設定できます：

- **共有メールアドレス**: 作成されたスプレッドシートを共有するGoogleアカウント
- **保存フォルダID**: Google DriveのフォルダIDを指定すると、そのフォルダに保存されます
- **スプレッドシートタイトル**: 作成されるスプレッドシートの名前
- **自動アップロード**: ✅ チェックすると、レポート生成時に自動でGoogle Sheetsにアップロード

#### 🔗 接続テスト
- **接続テストボタン**: Google Sheets APIの接続確認とテストスプレッドシート作成
- **設定を保存ボタン**: 設定内容を永続化

#### 📊 スプレッドシート履歴管理機能（NEW!）
**重要**: 同じタイトルのスプレッドシートが既に存在する場合、**新しいブックを作成せず、既存スプレッドシートに新しいシートを追加**します。

**動作例**:
1. **初回実行**: 「AutoPlaywright テスト結果」スプレッドシートを新規作成
2. **2回目以降**: 既存の「AutoPlaywright テスト結果」スプレッドシートに `TestResults_2025-06-24_04-39` のような新しいシートを追加

**メリット**:
- 📈 **テスト履歴の一元管理**: 全てのテスト結果が一つのブック内に保存
- 🕒 **時系列での比較**: 各シートで実行日時を確認可能
- 📁 **整理された構造**: フォルダ内でスプレッドシートが増殖しない
- 🚀 **自動化**: UIからの実行で全て自動処理

### 3. Google Driveフォルダ設定（オプション）

Google Driveの特定フォルダにスプレッドシートを保存したい場合：

1. **Google Drive**で保存先フォルダを作成
2. **フォルダのURLを取得**: `https://drive.google.com/drive/folders/1yx5b2egdjrtB4LTIruSatikTcTW7KOSD`
3. **フォルダIDを抽出**: URLの最後の部分 `1yx5b2egdjrtB4LTIruSatikTcTW7KOSD`
4. **WebUIの「保存フォルダID」欄**に入力
5. **🔗 接続テスト**で設定確認

### 4. スプレッドシート構造

#### 📊 ブック・シート構造
```
AutoPlaywright テスト結果（スプレッドシートブック）
├── TestResults_2025-06-24_04-39（実行日時付きシート）
├── TestResults_2025-06-24_10-15（次回実行時のシート）
└── TestResults_2025-06-25_09-30（さらに次回実行時のシート）
```

#### 📋 データ構造
各シートにアップロードされるデータ：

| 列名 | 説明 | 例 |
|-----|------|-----|
| **実行日時** | テスト実行のタイムスタンプ | 2025-06-24T04:39:15.234Z |
| **テストケースID** | 各テストの識別子 | TC001, TC002 |
| **ユーザーストーリー** | テストの目的・背景 | ユーザーがログインできる |
| **テスト手順** | 実行されたステップ | メール入力 → パスワード入力 → ログインボタンクリック |
| **実行結果** | 成功/失敗 | SUCCESS, FAILED |
| **エラー詳細** | 失敗時のエラー情報 | Element not found: #login-btn |
| **実行時間(ms)** | テスト実行にかかった時間 | 1250 |
| **カバレッジ** | テストでカバーした機能 | ログイン機能, バリデーション |
| **URL** | テスト対象のURL | https://example.com/login |

#### 🔄 履歴管理の仕組み
1. **初回**: 新しいスプレッドシートブック作成
2. **2回目以降**: 同じブック内に日時付きの新しいシート追加
3. **自動共有**: 設定されたメールアドレスに共有
4. **フォルダ保存**: 指定されたGoogle Driveフォルダに保存

### 5. 使用の流れ

1. **Google Sheets API設定** → Google Cloud Consoleで認証設定
2. **WebUI設定** → 📈 Google Sheets設定で共有メール・フォルダ設定
3. **接続テスト** → 🔗 接続テストで動作確認
4. **テスト実行** → 通常通りテスト実行
5. **📊 レポート生成** → レポート生成ボタンで自動的にGoogle Sheetsにアップロード ✨

**🎉 完了！** 指定したGoogle Driveフォルダに、テスト履歴が自動的に蓄積されます。

---

## 🐳 Docker使用方法（オプション）

### セットアップ
```bash
# 環境変数設定
echo "OPENAI_API_KEY=your-api-key" > .env

# イメージビルド
docker-compose build
```

### 実行例
```bash
# テスト観点生成
docker-compose run --rm autoplaywright node tests/generateTestPoints.js --spec-pdf ./specs/requirements.pdf

# テスト実行
docker-compose run --rm autoplaywright node tests/runRoutes.js
```

---

## 📁 ファイル構造

```
autoplaywright/
├── specs/                    # PDF仕様書の配置ディレクトリ
│   └── requirements.pdf
├── test_point/              # テスト観点CSVテンプレート
│   ├── TestPoint_Format.csv      # 標準テスト観点
│   └── uploaded_TestPoint_Format.csv  # アップロードされたテスト観点
├── tests/                   # テストスクリプト
├── test-results/           # 生成されたテスト結果
├── public/                 # WebUI静的ファイル
├── server.js               # WebUIサーバー
├── config.json             # 設定ファイル
└── .env                    # 環境変数（要作成）
```

---

## 🔧 AI設定詳細

| 設定項目 | 説明 | 推奨値 | 範囲 |
|---------|------|-------|------|
| `model` | GPTモデル | `gpt-4o-mini` | gpt-4o-mini, gpt-4o等 |
| `temperature` | 創造性 | `0.5` | 0.0-1.0 |
| `max_tokens` | 最大トークン数 | `4000` | 1000-8000 |
| `top_p` | 多様性 | `0.9` | 0.1-1.0 |

**設定の目安：**
- **精度重視**: Temperature 0.3, Top-p 0.8
- **創造性重視**: Temperature 0.7, Top-p 1.0
- **バランス型**: Temperature 0.5, Top-p 0.9（デフォルト）

---

## 🎯 使用の流れ

1. **初回セットアップ** → 環境構築とAPIキー設定
2. **WebUI起動** → `npm run webui`でサーバー開始
3. **基本設定** → URL・PDF設定
4. **テスト生成・実行** → ワンクリックで自動化
5. **結果確認** → ブラウザで結果表示・ダウンロード

---

## 📝 ライセンス

MIT License - 詳細は [LICENSE](./LICENSE) ファイルを参照

### 開発者
- **Original Author**: [k-sakQA](https://github.com/k-sakQA)

---