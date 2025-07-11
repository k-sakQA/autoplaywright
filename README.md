# AutoPlaywright

**E2E自動テスト実行** - OpenAI GPTを使用してテストプロセスを自動化します。

自走するテスト自動化システムの概要
- 入力情報
    - 画面URL、観点リスト、テスト内容（自由記述）、仕様書（オプション）
- テスト設計と実装
    - 入力情報から観点生成（★）
    -  → 観点＋テスト内容からテストケース生成（AI）
    -  → DOM解析（ツール）
    -  → 実行可能ケース抽出（AI）
    -  → Playwrightで実行可能な形式に実装（AI）
- 実行（と修正）
    - テスト実行（Playwright）
    -  → 失敗したテストを分析（AI＋ツール）
    -  → 実行可能な形式に実装を修正（AI＋ツール）
    -  → 修正したテストを再実行（Playwright）
    -  → 結果レポートを出力（AI）
- 継続的改善
    - 結果の分析（AI）
    -  → 画面内で実行されていないシナリオを探索（AI）
    -  → 観点生成（★）へ戻りループ


## 一括実行機能で自動化を実現

**1クリックで観点生成からテスト結果まで自動実行されます：**
1. **テスト観点生成** → 2. **テストケース生成** → 3. **Playwright用に変換** → 4. **テスト実行**  
5. **レポート生成** → 6. **失敗分析・修正** → 7. **再トライ** → 8. **新ストーリー発見**

### 🌟 **「🚀 自動で一括実行する」ボタン**
- **プロセスの自動化**: URL入力で7つのステップを自動実行
- **インテリジェント分岐**: 失敗がない場合は分析ステップを自動スキップ
- **完了通知**: 全ステップ完了時にサマリーを表示

---

## 主な機能

### **コア機能**
- **AI自動テスト生成**: GPTモデルを使用してテスト観点とテストシナリオを自動生成
- **PDF仕様書対応**: PDFの仕様書を読み込んでテスト観点を抽出（500字まで）
- **カスタムテスト観点**: プロジェクト固有のテスト観点CSVをアップロード可能
- **WebUI**: ブラウザから簡単操作

### **自動化機能**
- **ワンクリック一括実行**: 7つのステップを連続して自動実行
- **自動失敗分析**: 成功ステップでも将来の失敗を予測修正
- **自動再トライ**: 修正されたテストの自動再実行
- **AIで未到のユーザーストーリーを発見**: 成功したテストから新しいテストシナリオを自動発見

### **レポート・連携機能**
- **トレーサビリティ**: ユーザーストーリーIDによるテストケースのトレース
- **詳細レポート**: 実行結果・エラー内容・修正履歴を可視化

### **カスタマイズ機能**
- **AI設定調整**: WebUIからGPTパラメータを調整可能
- **ID管理**: トレーサビリティIDのリセット・管理機能
- **デバッグモード**: 詳細な実行ログとエラー解析

---

## 必要環境

- **Node.js** v24.2.0以上
- **OpenAI APIキー** （有料）
- **Docker** （オプション）

---

## 初回セットアップ

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

**OpenAI APIキーの取得方法**: [OpenAI Platform](https://platform.openai.com/api-keys) でアカウント作成後、APIキーを生成してください

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

## WebUI使用方法

### 1. サーバー起動

⚠️ **重要**: ブラウザでアクセスする**前に**必ずサーバーを起動してください

```bash
npm run webui
```

以下のメッセージが表示されるまで待つ：
```
AutoPlaywright WebUI サーバーが起動しました
ローカルアクセス: http://localhost:3000
```

### サーバー停止方法
```bash
Ctrl + C  # Mac/Linux/Windows共通
```

### 2. アクセス方法

ブラウザで以下のURLにアクセス：
```
http://localhost:3000
```

---

## **ワンクリック一括実行**

### 🌟 **「🚀 自動で一括実行する」ボタン**
**最も簡単な使い方**: 基本設定だけ入力して、このボタンを押すだけ！

#### **実行前の準備**
1. **テスト対象URL**: 必須項目
2. **ユーザーストーリー**: テストしたい内容を記述
3. **PDF・CSV**: 必要に応じてアップロード

#### **自動で実行される7つのステップ**
```
テスト観点生成
   ↓
テストケース生成
   ↓
Playwright用に変換
   ↓
テスト実行
   ↓
レポート生成
   ↓
失敗分析・修正 (テストの失敗時のみ)
   ↓  
再トライ実行 (修正ありの時のみ)
   ↓
新ストーリー発見
```

---

## **個別のステップ実行**

必要に応じて、各ステップを個別に実行することも可能です：

### **基本設定セクション**
1. **テスト対象URL**: テストしたいWebサイトのURLを入力
2. **ユーザーストーリー**: 具体的なテスト手順や確認したい内容
3. **🔗 トレーサビリティID**: 自動採番、リセット可能
4. **テスト観点CSV**: テスト観点をカスタムしてCSV形式で登録できます（列の変更はできません）
5. **仕様書PDF**: PDF仕様書をアップロード

### 🧪 **テスト実行タブ**
- **📋 テスト観点生成**: PDF仕様書からテスト観点を生成
- **🧠 テストケース生成**: テスト観点から具体的なテストケースを生成
- **🎭 Playwright用に変換**: テストケースから実行可能なPlaywrightテストコードに変換
- **▶️ テスト実行**: Playwrightテスト実行
- **📊 レポート生成**: 結果をCSV・HTML形式で出力

### **自動改善・学習機能タブ**
- **失敗したテストの分析と修正**: 失敗原因を特定し修正案を生成
- **失敗したテストの再トライ**: 修正されたテストを自動実行

### **新しいストーリータブ**
- **新ストーリー発見**: 成功テストから新しいテストシナリオを発見
- **Playwright用に変換**: 発見されたストーリーを実行可能コードに変換
- **発見済みストーリー選択**: 過去に発見されたストーリーを選択実行

### **AI設定セクション**
- **モデル選択**: GPT-4o Mini（推奨）、GPT-4o等
- **創造性調整**: 決定的（0.0）〜創造的（1.0）
- **トークン数**: 応答の詳細度を調整
- **設定保存**: .envファイルに永続化

---

## **テスト結果の確認**
- **リアルタイムログ**: 実行状況をブラウザで確認
- **結果サマリー**: 成功/失敗数、エラーメッセージを表示
- **ファイルダウンロード**: JSON/CSV結果ファイルをダウンロード

### **トラブルシューティング**

**「このサイトにアクセスできません」**
- サーバーが起動していません → `npm run webui` を実行

**「EADDRINUSE: address already in use」**
- ポート3000が使用中です：
```bash
pkill -f "node server.js"  # 既存プロセス停止
npm run webui              # 再起動
```

**サーバーの停止方法**
- 通常停止: `Ctrl + C` (起動したターミナルで)
- 強制停止: `pkill -f "node server.js"` (別ターミナルから)

**「API Key Error」**
- `.env` ファイルのOPENAI_API_KEYを確認してくださ


---

## 🐳 Docker使用方法（オプション）

### セットアップ
```bash
# 環境変数設定
echo "OPENAI_API_KEY=your-api-key" > .env

# イメージビルド
docker-compose build
```

### WebUI起動（推奨）
```bash
# WebUIサーバーを起動
docker-compose up

# ブラウザで http://localhost:3000 にアクセス
```

### コマンドライン実行例
```bash
# テスト観点生成
docker-compose run --rm autoplaywright node tests/generateTestPoints.js --spec-pdf ./specs/requirements.pdf

# テスト実行
docker-compose run --rm autoplaywright node tests/runScenarios.js
```

### Docker環境での注意点
- **config.json**: 設定変更が永続化されます
- **test-results**: テスト結果がホストに保存されます

---

## ファイル構造

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

## AI設定詳細

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

## 使用の流れ

1. **初回セットアップ** → 環境構築とAPIキー設定
2. **WebUI起動** → `npm run webui`でサーバー開始
3. **基本設定** → URL・PDF設定
4. **テスト生成・実行** → ワンクリックで自動化
5. **結果確認** → ブラウザで結果表示・ダウンロード

---

## 📊 プロジェクトステータス

#### **技術仕様**
- **フロントエンド**: HTML5 + CSS3 + Vanilla JavaScript
- **バックエンド**: Node.js + Express（ESモジュール）
- **テスト実行**: Playwright + OpenAI GPT-4o
- **レポート**: CSV + HTML
- **修正成功率**: 58.8% → 70.6% への向上実績

---

## 今後の展望

### **ロードマップ**
- **ダッシュボード**: リアルタイムテスト品質可視化
- **エンタープライズ**: 認証・権限管理・監査ログ
- **AI修正精度向上**: さらなる修正パターンの学習・適用

### **コントリビューション歓迎**
- **Issue報告**: バグ発見
- **Pull Request**: 新機能開発や改善提案
- **ドキュメント**: README改善や使用例追加
- **テストケース**: 新しいテストシナリオの提案

---

## **このプロジェクトの特徴**

### **従来の課題を解決**
```
❌ 従来: 手動テスト設計とテスト実装 → 手動実行 → 手動分析 → 手動修正
✅ AutoPlaywright: URL入力 → ワンクリック → 自動完了 → テスト再生成 → カバレッジの向上 をスピーディに実施
```

### **実現した機能**
1. **AI駆動テスト生成**: PDF仕様書から自動でテストケース生成
2. **自己修復テスト**: 失敗時の自動分析・修正・再実行
3. **プロアクティブ修正**: 成功ステップでも将来の失敗を予測修正
4. **自己進化テスト**: 成功テストから新しいシナリオを自動発見
5. **Web UI**: ブラウザベースの直感的なテスト実行・管理
6. **自動化レポート**: HTML・CSVによる継続的品質可視化

### **達成した価値**
- **時間短縮**: デプロイ後すぐにハッピーパスのE2Eチェック結果の報告ができる
- **品質向上**: AI分析によるテストカバレッジの向上
- **生産性向上**: チェックはこのツールに任せて、QAエンジニアはバグ探しに集中
- **継続的改善**: テスト実行データの自動蓄積・分析
- **修正成功率**: 58.8% → 70.6% への向上（実証済み）

---

## 🙏 **謝辞**

このプロジェクトの完成は、以下の素晴らしいテクノロジーとコミュニティの支援なくして実現できませんでした：

- **OpenAI**: GPTモデルによるAI分析エンジン
- **Microsoft Playwright**: ブラウザ自動化フレームワーク
- **オープンソースコミュニティ**: 多くのライブラリとツールの提供
- **テスト自動化の学習用練習サイト**: https://hotel-example-site.takeyaqa.dev/

---

## ライセンス

MIT License - 詳細は [LICENSE](./LICENSE) ファイルを参照

Copyright (c) 2025 Sakata Kazunori

### 開発者
- **Original Author**: [k-sakQA](https://github.com/k-sakQA)
- **AI Assistant**: Claude (Anthropic) - 開発パートナー

### **コンタクト**
- **GitHub Issues**: バグ報告・機能提案
- **Discussions**: 使用方法の質問・アイデア共有

---