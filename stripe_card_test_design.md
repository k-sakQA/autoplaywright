# Stripeテスト用カード情報自動購入テスト 詳細設計書

## 1. 概要

### 1.1 目的
Stripeのテスト用カード情報をCSVファイルから読み込み、Pocket Heroes開発環境での購入プロセスを自動化してテストするPlaywrightスクリプトツールを作成する。

### 1.2 対象システム
- テストサイト: https://development.pocket-heroes.net/packs
- 決済システム: Stripe

### 1.3 テスト範囲
- 57種類のテスト用カード情報での購入フロー
- 購入成功・失敗の判定
- 結果の記録とスクリーンショット保存

## 2. システム構成

### 2.1 ディレクトリ構造
```
/workspace/
├── tests/
│   ├── stripe/
│   │   ├── stripe-card-test.js              # メインテストスクリプト
│   │   ├── card-data-manager.js             # CSV操作管理
│   │   ├── purchase-flow.js                 # 購入フロー実行
│   │   ├── screenshot-manager.js            # スクリーンショット管理
│   │   └── config/
│   │       └── stripe-test-config.js        # 設定ファイル
│   └── data/
│       └── カード一覧.csv                   # テスト用カードデータ
├── test-results/
│   └── stripe/
│       ├── shop_result/                     # スクリーンショット保存フォルダ
│       └── logs/                            # テストログ
└── package.json
```

### 2.2 CSVファイル構造
```csv
No,カード番号,有効期限年月,セキュリティコード,購入前のバモス,購入後のバモス,購入ボタン後のスクショ,エラー詳細
1,4242424242424242,1225,123,,,,,
2,4000000000000002,1225,123,,,,,
...
57,4000000000009995,1225,123,,,,,
```

## 3. 機能設計

### 3.1 メイン処理フロー
1. **初期化処理**
   - CSVファイル読み込み
   - ブラウザ起動（Chrome、5分待機）
   - ログイン状態確認

2. **各カードのテストループ**
   - 現在のバモス数記録
   - 購入フロー実行
   - 結果記録
   - スクリーンショット保存

3. **終了処理**
   - CSV更新保存
   - ブラウザクローズ
   - レポート生成

### 3.2 エラーハンドリング
- 購入失敗時の処理
- タイムアウト処理
- ネットワークエラー処理
- 復旧処理

## 4. 技術仕様

### 4.1 使用技術
- **Playwright**: ブラウザ自動化
- **Node.js**: 実行環境
- **csv-parse/csv-writer**: CSV操作
- **Chrome**: テストブラウザ

### 4.2 設定値
```javascript
const CONFIG = {
  BASE_URL: 'https://development.pocket-heroes.net/packs',
  CSV_PATH: '/Users/kazunori.sakata.ts/Playwright/tests/カード一覧.csv',
  SCREENSHOT_DIR: './test-results/stripe/shop_result',
  WAIT_AFTER_LOGIN: 300000, // 5分
  PURCHASE_TIMEOUT: 30000,   // 30秒
  SCREENSHOT_DELAY: 3000     // 3秒
};
```

### 4.3 セレクター定義
```javascript
const SELECTORS = {
  // 金額表示
  CURRENT_AMOUNT: 'body > div.layout_wrapper__zNuca > div > main > div.page_header__peS8Y > div > div:nth-child(1)',
  
  // ショップボタン
  SHOP_BUTTON: 'body > div.layout_wrapper__zNuca > div > main > div.page_floatingButton__HTn2Y > div > a > div > img',
  
  // バモスx5商品
  BAMOS_PRODUCT: 'body > div.layout_wrapper__zNuca > div > main > section > button:nth-child(1) > div.creditShopProduct_image__G5__E',
  
  // 購入確認ダイアログ
  PURCHASE_CONFIRM: 'body > div.layout_wrapper__zNuca > div > main > section > dialog:nth-child(2) > div > div > div.purchaseConfirmationDialog_buttonArea__A0VVB > button.Button_common__4HBbG.Button_primary__bQ5TF.Button_sizeSm__p4yDR',
  
  // 支払い方法
  NEW_CARD_OPTION: 'body > div.layout_wrapper__zNuca > div > main > section > div > div > section > div.paymentMethodDialog_paymentMethods__GMvcI > button.paymentMethodDialog_paymentMethodOption__pw5xm > label',
  
  // カード情報入力
  CARD_NUMBER: '#card-panel > div > div > form > div > div.p-Grid.p-CardForm > div.p-GridCell.p-GridCell--12.p-GridCell--lg6 > div > div:nth-child(2) > div',
  EXPIRY_DATE: '#card-panel > div > div > form > div > div.p-Grid.p-CardForm > div:nth-child(2) > div > div:nth-child(2) > div > div',
  SECURITY_CODE: '#card-panel > div > div > form > div > div.p-Grid.p-CardForm > div:nth-child(3) > div > div:nth-child(2) > div > div.p-Input',
  
  // 保存チェックボックス
  SAVE_CARD_CHECKBOX: 'body > div.layout_wrapper__zNuca > div > main > section > div > div > section > div.paymentMethodDialog_paymentMethods__GMvcI > button.paymentMethodDialog_paymentMethodOption__pw5xm.paymentMethodDialog_selected__lbW2L > div > div.paymentMethodDialog_futureUsageCheckbox__aenEz > label > input[type=checkbox]',
  
  // 購入確定ボタン
  FINAL_PURCHASE: 'body > div.layout_wrapper__zNuca > div > main > section > div > div > section > div.paymentMethodDialog_fixedButtons__MZW7i > button.Button_common__4HBbG.Button_primary__bQ5TF.Button_sizeSm__p4yDR'
};
```

## 5. クラス設計

### 5.1 CardDataManager クラス
```javascript
class CardDataManager {
  constructor(csvPath)
  async loadCards()              // CSVファイル読み込み
  async updateCard(index, data)  // カードデータ更新
  async saveCards()              // CSVファイル保存
  getCard(index)                 // 指定インデックスのカード取得
  getTotalCards()                // 総カード数取得
}
```

### 5.2 PurchaseFlow クラス
```javascript
class PurchaseFlow {
  constructor(page, selectors)
  async getCurrentAmount()       // 現在のバモス数取得
  async clickShopButton()        // ショップボタンクリック
  async selectBamosProduct()     // バモス商品選択
  async confirmPurchase()        // 購入確認
  async selectNewCard()          // 新規カード選択
  async fillCardInfo(cardData)   // カード情報入力
  async uncheckSaveCard()        // 保存チェックボックス解除
  async completePurchase()       // 購入完了
  async waitForResult()          // 結果待機
}
```

### 5.3 ScreenshotManager クラス
```javascript
class ScreenshotManager {
  constructor(screenshotDir)
  async takeScreenshot(page, filename)  // スクリーンショット撮影
  generateFilename(cardNo, cardNumber)  // ファイル名生成
  ensureDirectory()                     // ディレクトリ作成
}
```

### 5.4 StripeCardTest クラス（メイン）
```javascript
class StripeCardTest {
  constructor(config)
  async initialize()             // 初期化処理
  async runAllTests()           // 全テスト実行
  async runSingleTest(index)    // 単一テスト実行
  async handleError(error, index)  // エラーハンドリング
  async cleanup()               // 終了処理
  async generateReport()        // レポート生成
}
```

## 6. 実装フェーズ

### Phase 1: 基盤実装
1. プロジェクト構造作成
2. 基本クラス実装
3. CSV操作機能実装

### Phase 2: 購入フロー実装
1. 基本購入フロー実装
2. エラーハンドリング実装
3. スクリーンショット機能実装

### Phase 3: テスト実行・検証
1. 単体テスト実行
2. 全カードテスト実行
3. 結果検証・調整

### Phase 4: 最適化・完成
1. パフォーマンス最適化
2. エラー処理強化
3. レポート機能追加

## 7. エラー対応

### 7.1 想定エラーパターン
1. **ネットワークエラー**: 再試行機能
2. **要素が見つからない**: 待機時間調整
3. **決済エラー**: エラー内容をCSVに記録
4. **タイムアウト**: 次のカードにスキップ

### 7.2 復旧処理
- 各ステップでのエラー発生時、パックス画面に戻る
- 現在のバモス数を記録して次のテストに進む
- エラー詳細をCSVとログに記録

## 8. 実行方法

### 8.1 コマンド実行
```bash
# 全カードテスト実行
npm run stripe:test:all

# 特定範囲のカードテスト
npm run stripe:test:range -- --start=1 --end=10

# 単一カードテスト
npm run stripe:test:single -- --card=5
```

### 8.2 設定ファイル
```javascript
// stripe-test-config.js
export const CONFIG = {
  headless: false,           // ブラウザ表示
  slowMo: 1000,             // 操作間隔
  timeout: 30000,           // デフォルトタイムアウト
  retryAttempts: 2,         // リトライ回数
  screenshotOnFailure: true // 失敗時スクリーンショット
};
```

## 9. 成果物

### 9.1 出力ファイル
- **更新されたCSVファイル**: 全テスト結果が記録
- **スクリーンショット**: shop_resultフォルダに57枚
- **テストレポート**: JSON形式の詳細結果
- **実行ログ**: エラー詳細と実行時間

### 9.2 品質保証
- 各カードでの購入プロセス完了率
- エラー発生時の適切な記録
- データの整合性チェック
- 実行時間の最適化

この設計書に基づいて、次はPlaywrightスクリプトの実装を行います。