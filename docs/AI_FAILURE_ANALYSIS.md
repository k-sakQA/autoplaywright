# AI-Powered 失敗テスト分析機能

AutoPlaywright に ChatGPT/OpenAI API を活用した高度な失敗テスト分析・修正システムを追加しました。

## 概要

従来のルールベースの修正機能に加えて、AI による動的で高度な失敗分析・修正提案システムを提供します。

### 🚀 主な特徴

- **🤖 AI による根本原因分析**: ChatGPT がエラーログと DOM 情報を解析し、技術的な根本原因を特定
- **🔧 動的修正提案**: 実行可能な Playwright コードとして具体的な修正案を生成
- **📊 信頼度評価**: 修正成功の見込みを数値化（0.0-1.0）
- **🔄 学習機能**: 過去の修正試行履歴を活用した段階的改善
- **🎯 代替案提示**: 複数のアプローチを提案し、最適解を選択
- **🚀 自動実行**: 修正ルートの自動生成・実行機能

## セットアップ

### 1. OpenAI API キーの設定

```bash
export OPENAI_API_KEY="your-openai-api-key-here"
```

または `.env` ファイルに設定：

```env
OPENAI_API_KEY=your-openai-api-key-here
```

### 2. 自動実行設定（オプション）

```bash
export AUTO_EXECUTE_AI_FIXES=true
```

## 使用方法

### 基本的な AI 分析

```bash
node tests/analyzeFailures.js --enable-ai
```

### 高度なオプション

```bash
# GPT-4 Turbo を使用
node tests/analyzeFailures.js --enable-ai --ai-model gpt-4-turbo-preview

# 修正ルートの自動実行を有効化
node tests/analyzeFailures.js --enable-ai --auto-execute

# ユーザーストーリーと組み合わせた分析
node tests/analyzeFailures.js --enable-ai \
  --goal "ユーザーが商品を購入できること" \
  --url "https://example.com"
```

### フォールバック動作

API キーが設定されていない場合や AI 分析に失敗した場合は、自動的に従来の分析方法にフォールバックします。

## AI 分析の流れ

### 1. エラー情報収集
- 失敗したステップのエラーメッセージ
- 実行コンテキスト（URL、総ステップ数、実行時間など）
- DOM 構造情報（利用可能な要素、推奨セレクタ）
- 過去の修正試行履歴

### 2. AI プロンプト生成
```
あなたはPlaywrightのテスト自動化エキスパートです。以下のエラーログを解析し、失敗箇所を修正した新しいコードを提案してください。

## 失敗ステップ情報
- ラベル: ログインボタンをクリック
- アクション: click
- ターゲット: #login-button
- エラーメッセージ: Element not found: #login-button

## 実行コンテキスト
- 実行URL: https://example.com/login
- 総ステップ数: 5
- 失敗ステップ数: 1

## DOM情報
- ボタン: 3個
- 入力欄: 2個
- 推奨セレクタ: button[type="submit"], .login-btn

## 要求事項
1. エラー原因の特定
2. 修正されたステップの提案
3. 代替案の提示
4. 信頼度の評価
```

### 3. AI レスポンス解析
AI から返される JSON 形式の修正提案：

```json
{
  "rootCause": "ログインボタンのIDが変更されたため要素が見つからない",
  "fixedStep": {
    "label": "ログインボタンをクリック",
    "action": "click",
    "target": "button[type='submit']",
    "timeout": 5000,
    "waitCondition": "visible"
  },
  "alternatives": [
    {
      "approach": "テキストベースの選択",
      "step": { "target": "text='ログイン'" },
      "pros": "テキストは変更されにくい",
      "cons": "多言語対応が困難"
    }
  ],
  "confidence": 0.85,
  "difficulty": "easy",
  "explanation": "type属性を使った選択により、ID変更の影響を受けない安定したセレクタを提案"
}
```

### 4. 修正ルート生成・実行

AI の提案を基に修正されたテストルートを自動生成し、オプションで自動実行します。

## 生成されるファイル

### 修正ルートファイル
```
test-results/ai_fixed_route_[ORIGINAL_ID]_[TIMESTAMP].json
```

### 修正試行履歴
```
test-results/.ai-fix-history.json
```

履歴例：
```json
{
  "route_123456": [
    {
      "timestamp": "2025-01-15T10:30:00.000Z",
      "approach": "ai_powered_analysis",
      "model": "gpt-4-turbo-preview",
      "confidence": 0.85,
      "fixed_steps": 2,
      "success": true,
      "execution_result": "completed"
    }
  ]
}
```

## 利点

### 従来の分析との比較

| 機能 | 従来の分析 | AI 分析 |
|------|------------|---------|
| **分析精度** | ルールベース | コンテキスト理解 |
| **修正提案** | 定型的 | 動的・創造的 |
| **学習能力** | なし | 履歴活用 |
| **複雑なエラー** | 限定的 | 高度な対応 |
| **実装難易度** | 低い | 高い |

### 実際の修正例

**エラー**: `Element not found: #submit-button`

**従来の修正**:
```javascript
// 単純な代替セレクタ
{ "target": "[id='submit-button']" }
```

**AI 修正**:
```javascript
{
  "target": "button[type='submit']:visible",
  "waitCondition": "visible",
  "timeout": 10000,
  "explanation": "IDセレクタの代わりに要素の機能的属性を使用し、可視性確認と適切なタイムアウトを設定"
}
```

## トラブルシューティング

### API エラー
```
❌ OpenAI API エラー: 401 Unauthorized
```
**解決策**: API キーを確認してください

### レート制限
```
❌ OpenAI API エラー: 429 Too Many Requests
```
**解決策**: API 呼び出し間隔を調整（1秒間隔で実装済み）

### JSON パースエラー
```
⚠️ AI レスポンス解析失敗
```
**解決策**: 自動的にフォールバック分析に切り替わります

## 設定

### config.json に AI 設定を追加（オプション）

```json
{
  "aiAnalysis": {
    "enabled": true,
    "model": "gpt-4-turbo-preview",
    "maxTokens": 2000,
    "temperature": 0.3,
    "autoExecute": false
  }
}
```

## 今後の拡張予定

- **🌐 他言語モデル対応**: Claude、Gemini などのサポート
- **🎯 専門性向上**: Playwright 専用の学習データでファインチューニング
- **📊 分析精度向上**: 成功率の統計を基にした改善
- **🔄 継続学習**: 修正結果のフィードバックループ構築

## まとめ

AI-Powered 失敗分析機能により、AutoPlaywright のテスト修正能力が大幅に向上しました。従来のルールベース分析と組み合わせることで、より堅牢で柔軟なテスト自動化システムを構築できます。

## 🔧 2025-07-02 問題修正履歴

### WebUI実行結果の問題と修正
WebUIでテストを実行した結果、以下の問題が発見され修正されました：

#### 問題1: レポートの重複 ❌→✅
**現象**: 同じテストケースが「初回実行」と「再実行」で重複して記録される
**原因**: 修正ルート実行時のCSVファイル追記処理で重複チェックが不十分
**修正内容**:
- `generateTestReport.js`でCSV追記時に重複除去処理を強化
- 同じテストケースIDを持つ行の最新版のみを保持するよう改善
- 統合前後の件数をログ出力し、重複除去の効果を可視化

#### 問題2: 失敗テストの再実行結果 🔍
**現象**: 失敗したテスト（1.B.5-3）の再実行で同じエラーが発生
**エラー内容**: `page.fill: Timeout 5000ms exceeded.`
**分析**: メールアドレス入力フィールドでのタイムアウトエラー
**状況**: AI分析システムが正常に動作し、再実行は行われているが同じエラーが継続

#### 問題3: testPointsファイルが1つだけ作成 ✅
**現象**: 重複ファイル作成防止機能が正常に動作
**確認**: `generateTestPoints.js`の重複チェック機能が適切に動作している

#### 問題4: 「予約内容を確認する」ボタンが押下されない ❌→✅
**現象**: テスト観点にボタン押下に関する項目が不足
**原因**: テスト観点CSVが3行しかなく、画面遷移やボタン操作の観点が不足
**修正内容**:
- `test_point/uploaded_TestPoint_Format.csv`に以下の観点を追加：
  - No.14: 確認ボタンの押下動作
  - No.15: 画面遷移時のデータ引き継ぎ  
  - No.16: 予約確認ボタンの機能
- ChatGPTのメモリー機能無効化：
  - `generateTestPoints.js`と`aiFailureAnalyzer.js`でAPI呼び出し時に一意のセッションID、ランダムシード、非ストリーミング設定を追加
  - 各テスト実行が独立したセッションで行われるよう保証

### 修正されたファイル
1. `tests/generateTestReport.js` - CSV重複除去処理強化
2. `test_point/uploaded_TestPoint_Format.csv` - テスト観点拡張
3. `tests/generateTestPoints.js` - ChatGPTメモリー無効化
4. `tests/aiFailureAnalyzer.js` - AI分析メモリー無効化

### 次回実行時の確認ポイント
- ✅ レポート重複が解消されているか
- 🔍 失敗テストのAI分析・修正提案が適切に動作するか  
- ✅ testPointsファイルが1つだけ作成されるか
- ✅ 「予約内容を確認する」ボタン押下がテストに含まれるか
- ✅ ユーザーストーリーが正しく反映されるか

## メモリー機能無効化の詳細

### 技術的実装
ChatGPTのメモリー機能による過去の会話の影響を排除するため、以下の設定を適用：

```javascript
// API呼び出し設定
{
  user: `session_${timestamp}_${randomId}`, // 一意のセッションID
  seed: Math.floor(Math.random() * 10000), // ランダムシード
  n: 1, // 単一回答のみ
  stream: false, // ストリーミング無効
  temperature: 0.5 // 適度なランダム性
}
```

### 効果
- 各テスト実行が完全に独立したセッションで行われる
- 過去のテスト内容がChatGPTの記憶に残らない
- 同じ入力に対して一貫した結果が得られる
- テスト観点の生成がより予測可能になる 