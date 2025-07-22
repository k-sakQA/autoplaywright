# AutoPlaywright ディレクトリ構造・ファイル管理バグ修正 詳細設計書

**作成日:** 2025-01-27  
**作成者:** Claude AI Assistant  
**対象システム:** AutoPlaywright テスト自動化プラットフォーム  
**バージョン:** v2.0  

---

## 1. 不具合概要

### 1.1 現象
- **HTMLレポートでスクリーンショットが表示されない**
- テスト観点→テストケース→Playwrightスクリプト→テスト結果のトレーサビリティが欠損
- ファイルがバラバラな場所に保存されて管理不能

### 1.2 根本原因分析

#### 問題1: ディレクトリ構造の不整合
```bash
# 現状の混在パターン
test-results/
├── screenshot_xxx.png          # runScenarios.jsが直接保存
├── result_xxx.json            # 各モジュールが個別保存
├── route_xxx.json
├── USIS-1/                    # USISDirectoryManager使用時
│   └── screenshots/
└── common/                    # 別のOutputManager使用時
    └── screenshots/
```

#### 問題2: 複数のファイル管理システムが並存
1. **USISDirectoryManager** (tests/utils/usisDirectoryManager.js)
2. **OutputManager** (src/output-manager/output-manager.cjs)  
3. **AutoPlaywrightReporter** (tests/utils/autoplaywrightReporter.js)
4. **各テストスクリプトの個別保存処理**

#### 問題3: HTMLレポートのパス解決失敗
```javascript
// generateTestReport.js:2976-2982の問題箇所
const possiblePaths = [
    'test-results/USIS-1/screenshots/' + routeId + '/step_' + stepIndex + '_failure.png',
    'test-results/USIS-1/screenshots/' + routeId + '/step_' + stepIndex + '.png',
    'test-results/screenshot_' + routeId + '_step_' + stepIndex + '.png',
    // 実際のファイルパスと一致しない複数のパターンを試行
];
```

---

## 2. 修正設計

### 2.1 統一ディレクトリ構造の設計

#### 2.1.1 最終的な標準ディレクトリ構造
```bash
test-results/
├── sessions/                           # セッション別管理
│   └── {sessionId}/                   # 例: 2025-01-27_14-30-45_abc123
│       ├── metadata/
│       │   ├── session-info.json     # セッション情報
│       │   ├── test-points.json      # テスト観点
│       │   └── manifest.json         # ファイル管理マニフェスト
│       ├── test-artifacts/            # テスト成果物
│       │   ├── test-cases/           # 自然言語テストケース
│       │   │   └── {testCaseId}.json
│       │   ├── scripts/              # Playwrightスクリプト
│       │   │   └── {testCaseId}.spec.js
│       │   └── routes/               # ルートファイル
│       │       └── route_{routeId}.json
│       ├── execution-results/         # 実行結果
│       │   ├── results/              # 結果JSON
│       │   │   └── result_{testCaseId}.json
│       │   ├── screenshots/          # スクリーンショット
│       │   │   └── {testCaseId}/
│       │   │       ├── step_1.png
│       │   │       ├── step_2_failure.png
│       │   │       └── final_result.png
│       │   ├── dom-snapshots/        # DOM状態
│       │   │   └── {testCaseId}/
│       │   ├── traces/              # Playwrightトレース
│       │   │   └── {testCaseId}_trace.zip
│       │   └── logs/                # 実行ログ
│       │       └── {testCaseId}.log
│       └── reports/                  # レポート類
│           ├── enhanced-report.html  # 拡張HTMLレポート
│           ├── summary.json         # サマリレポート
│           └── ai-analysis.json     # AI分析結果
├── global/                           # グローバル設定・共通ファイル
│   ├── config/
│   ├── templates/
│   └── archive/                     # 古いファイルのアーカイブ
└── latest/                          # 最新セッションへのシンボリックリンク
```

#### 2.1.2 ファイル命名規約
```javascript
// セッションID生成規則
const sessionId = `${timestamp}_${userStoryId}_${randomSuffix}`;
// 例: 2025-01-27_14-30-45_USIS-123_abc123

// ファイル命名規約
const testCaseId = `TC_${userStoryId}_${sequenceNumber}`;
// 例: TC_USIS-123_001

// スクリーンショット命名
const screenshotName = `step_${stepIndex}${failureFlag ? '_failure' : ''}.png`;
// 例: step_3_failure.png
```

### 2.2 トレーサビリティマッピング設計

#### 2.2.1 マニフェストファイル構造
```typescript
interface TestSessionManifest {
  sessionId: string;
  userStoryId: string;
  timestamp: string;
  
  // トレーサビリティマッピング
  traceabilityMap: {
    [testPointId: string]: {
      testPoint: TestPoint;
      generatedTestCases: {
        [testCaseId: string]: {
          testCase: TestCase;
          generatedScript: string;            // スクリプトファイルパス
          executionResults: {
            [executionId: string]: {
              resultFile: string;             // 結果JSONファイルパス
              screenshots: string[];          // スクリーンショットファイルパス配列
              domSnapshots: string[];
              traces: string[];
              logs: string[];
              status: 'success' | 'failure' | 'error';
            };
          };
        };
      };
    };
  };
  
  // ファイルレジストリ
  fileRegistry: {
    [filePath: string]: {
      type: 'test-point' | 'test-case' | 'script' | 'result' | 'screenshot' | 'dom-snapshot' | 'trace' | 'log' | 'report';
      relatedIds: string[];  // 関連するID配列
      checksum: string;
      size: number;
      createdAt: string;
    };
  };
}
```

### 2.3 統一ファイル管理システムの設計

#### 2.3.1 UnifiedOutputManagerクラス
```typescript
class UnifiedOutputManager {
  private sessionId: string;
  private basePath: string;
  private manifest: TestSessionManifest;
  
  // セッション管理
  async createSession(userStoryId: string): Promise<string>;
  async getSession(sessionId: string): Promise<TestSessionManifest>;
  
  // ファイル操作
  async saveTestPoint(testPointId: string, data: TestPoint): Promise<string>;
  async saveTestCase(testCaseId: string, testPointId: string, data: TestCase): Promise<string>;
  async saveScript(testCaseId: string, scriptContent: string): Promise<string>;
  async saveExecutionResult(testCaseId: string, executionId: string, result: any): Promise<string>;
  async saveScreenshot(testCaseId: string, stepIndex: number, imageData: Buffer, isFailure: boolean): Promise<string>;
  
  // パス解決
  resolveScreenshotPath(testCaseId: string, stepIndex: number, isFailure: boolean): string;
  resolveResultPath(testCaseId: string, executionId: string): string;
  
  // トレーサビリティ
  getTraceabilityChain(testCaseId: string): TraceabilityChain;
  updateTraceabilityMap(testPointId: string, testCaseId: string, scriptPath: string): void;
}
```

---

## 3. 実装計画

### 3.1 Phase 1: 統一ファイル管理システム実装
**目標:** 単一のファイル管理システムに統合

#### 3.1.1 UnifiedOutputManager実装
- `src/unified-output-manager/`ディレクトリ作成
- 新しい統一ファイル管理クラス実装
- 既存の3つのシステムのAPIを統合

#### 3.1.2 マニフェスト管理機能
- セッション毎のマニフェストファイル生成
- トレーサビリティマッピング機能
- ファイルレジストリ管理

### 3.2 Phase 2: 既存システムの段階的移行
**目標:** 既存のファイル管理システムをUnifiedOutputManagerに統合

#### 3.2.1 runScenarios.js修正
```javascript
// 修正前
const screenshotPath = `test-results/screenshot_${Date.now()}.png`;
await this.page.screenshot({ path: screenshotPath, fullPage: step.target === 'full-page' });

// 修正後
const screenshotPath = await this.unifiedOutputManager.saveScreenshot(
  this.currentTestCaseId, 
  this.currentStepIndex, 
  await this.page.screenshot(), 
  this.isFailureStep
);
```

#### 3.2.2 generateTestReport.js修正
```javascript
// 修正前: 複数パスでの推測検索
const possiblePaths = [
  'test-results/USIS-1/screenshots/' + routeId + '/step_' + stepIndex + '_failure.png',
  // 他の推測パス
];

// 修正後: マニフェストベースの確実なパス解決
const screenshotPath = this.unifiedOutputManager.resolveScreenshotPath(testCaseId, stepIndex, true);
```

### 3.3 Phase 3: HTMLレポート機能の修正
**目標:** スクリーンショット表示問題の根本解決

#### 3.3.1 レポート生成時のパス埋め込み
- マニフェストファイルからスクリーンショットパスを正確に取得
- HTMLレポートに相対パスで埋め込み
- Base64エンコーディングオプションの追加（HTMLファイル単体での可搬性向上）

#### 3.3.2 トレーサビリティ表示機能
- テスト観点→テストケース→スクリプト→結果の連鎖表示
- インタラクティブなドリルダウン機能
- 各段階でのファイルリンク機能

### 3.4 Phase 4: レガシーファイル移行機能
**目標:** 既存の散らばったファイルを新構造に移行

#### 3.4.1 自動移行スクリプト
```bash
node scripts/migrate-legacy-files.js --session-id MIGRATION_2025-01-27 --dry-run
```

#### 3.4.2 移行マッピング機能
- 既存ファイルからメタデータ抽出
- 適切なディレクトリへの分類・配置
- 移行レポート生成

---

## 4. 実装ファイル一覧

### 4.1 新規作成ファイル
```
src/unified-output-manager/
├── index.js                    # エントリポイント
├── unified-output-manager.js   # メインクラス
├── session-manager.js          # セッション管理
├── manifest-manager.js         # マニフェスト管理
├── path-resolver.js           # パス解決
├── traceability-mapper.js     # トレーサビリティ管理
└── legacy-migrator.js         # レガシーファイル移行

scripts/
├── migrate-legacy-files.js    # 移行スクリプト
└── validate-file-structure.js # 構造検証スクリプト
```

### 4.2 修正対象ファイル
```
tests/runScenarios.js          # スクリーンショット保存処理
tests/generateTestReport.js    # HTMLレポート生成処理
tests/generateEnhancedTestReport.js  # 拡張レポート機能
tests/utils/enhancedReportGenerator.js  # レポート生成機能
```

---

## 5. テスト計画

### 5.1 単体テスト
- UnifiedOutputManager各機能のテスト
- パス解決機能のテスト
- マニフェスト管理機能のテスト

### 5.2 統合テスト
- 全ワークフロー（テスト観点生成→実行→レポート生成）のテスト
- HTMLレポートでのスクリーンショット表示テスト
- トレーサビリティ機能のテスト

### 5.3 移行テスト
- レガシーファイルの移行テスト
- 既存機能との互換性テスト

---

## 6. リスク分析と対策

### 6.1 実装リスク
**リスク:** 既存機能への影響  
**対策:** 段階的移行とバックワード互換性の維持

**リスク:** パフォーマンス劣化  
**対策:** ファイルI/O最適化とキャッシュ機能

### 6.2 運用リスク
**リスク:** ディスク容量不足  
**対策:** 自動アーカイブ機能とクリーンアップ機能

**リスク:** ファイルロック競合  
**対策:** 排他制御とリトライ機能

---

## 7. 完了基準

### 7.1 機能要件
- [ ] HTMLレポートでスクリーンショットが正常表示される
- [ ] テスト観点からテスト結果までの完全なトレーサビリティが確保される
- [ ] 統一されたディレクトリ構造でファイルが管理される
- [ ] 既存の機能が引き続き動作する

### 7.2 非機能要件
- [ ] ファイル保存・読み込み処理が5秒以内に完了する
- [ ] 1000ファイル以上でも正常に動作する
- [ ] メモリ使用量が128MB以下に抑えられる

---

## 8. 実装スケジュール

| Phase | 内容 | 期間 | 依存関係 |
|-------|------|------|----------|
| Phase 1 | 統一ファイル管理システム実装 | 2-3日 | なし |
| Phase 2 | 既存システム移行 | 3-4日 | Phase 1完了 |
| Phase 3 | HTMLレポート修正 | 2-3日 | Phase 2完了 |
| Phase 4 | レガシー移行機能 | 1-2日 | Phase 3完了 |
| テスト・検証 | 全体テスト | 1-2日 | 全Phase完了 |

**総期間:** 約9-14日

---

この設計書に基づいて、段階的にバグ修正を実装することで、ファイル管理の混乱を解決し、HTMLレポートでのスクリーンショット表示問題とトレーサビリティ問題を根本的に解決できます。