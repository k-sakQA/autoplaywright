# AutoPlaywright ファイル配置変更分析レポート

**作成日:** 2025-01-27  
**対象仕様:** autoplaywright_test_output_detailed_specification.md v1.0  

---

## 1. 現在のファイル配置状況

### 1.1 現在生成されているファイル種類

| ファイル種類 | 現在の保存場所 | 命名規則例 |
|---|---|---|
| テストケース（自然言語） | `test-results/` | `naturalLanguageTestCases_2025-07-18T1406_表示.json` |
| バッチ実行結果 | `test-results/` | `batch_result_250719080649232.json` |
| テスト観点ファイル | `test_point/` | `TestPoint_Format.csv` |
| スクリーンショット | `test-results/` (Reporter経由) | 動的生成 |
| DOMスナップショット | `test-results/` (Reporter経由) | 動的生成 |
| トレースファイル | `test-results/` (Reporter経由) | 動的生成 |

### 1.2 現在のディレクトリ構造

```
workspace/
├── test-results/              # 全ての出力が集約されている
│   ├── naturalLanguageTestCases_*.json
│   ├── batch_result_*.json
│   └── その他の実行時生成ファイル
├── test_point/                # テスト観点管理
│   ├── TestPoint_Format.csv
│   └── uploaded_TestPoint_Format.csv
└── その他のソースファイル
```

---

## 2. 新仕様での配置変更

### 2.1 新しいディレクトリ構造での配置

```
test-results/
├── runs/                           # 実行履歴管理
│   ├── {YYYY-MM-DD_HH-mm-ss}/     # 実行日時ディレクトリ
│   │   ├── config/                # テスト実行設定
│   │   │   ├── run-config.json    # 実行時設定情報
│   │   │   └── env-config.json    # 環境設定情報
│   │   ├── artifacts/             # テスト成果物
│   │   │   ├── test-points/       # テスト観点
│   │   │   │   └── test-points_login.json
│   │   │   ├── test-cases/        # テストケース
│   │   │   │   ├── test-case_TC001.md
│   │   │   │   └── naturalLanguageTestCases_*.json ← 移行対象
│   │   │   ├── scripts/           # 生成スクリプト
│   │   │   └── dom-snapshots/     # DOMスナップショット
│   │   ├── results/               # 実行結果
│   │   │   ├── reports/           # レポート類
│   │   │   │   └── batch_result_*.json ← 移行対象
│   │   │   ├── screenshots/       # スクリーンショット
│   │   │   ├── traces/            # トレースファイル
│   │   │   └── logs/              # ログファイル
│   │   └── metadata/              # メタデータ
│   │       ├── summary.json       # 実行サマリ
│   │       └── file-manifest.json # ファイル一覧
├── latest/                        # 最新実行結果（シンボリックリンク）
└── .autoplaywright/               # 設定・キャッシュディレクトリ
    ├── templates/                 # テンプレートファイル
    └── global-config.json         # グローバル設定
```

### 2.2 ファイル種類別の移行先

| 現在のファイル | 移行先ディレクトリ | 新しい命名規則 |
|---|---|---|
| `naturalLanguageTestCases_*.json` | `runs/{session}/artifacts/test-cases/` | `test-case_{case_id}.json` |
| `batch_result_*.json` | `runs/{session}/results/reports/` | `batch-report_{timestamp}.json` |
| `TestPoint_Format.csv` | `runs/{session}/artifacts/test-points/` | `test-points_{scenario_id}.csv` |
| スクリーンショット | `runs/{session}/results/screenshots/` | `screenshot_{test_id}_{timestamp}.png` |
| DOMスナップショット | `runs/{session}/artifacts/dom-snapshots/` | `snapshot_{test_id}_{step}.html` |
| トレースファイル | `runs/{session}/results/traces/` | `trace_{test_id}.zip` |

---

## 3. 影響を受けるコンポーネント

### 3.1 ファイル生成コンポーネント

| ファイル | 影響箇所 | 変更内容 |
|---|---|---|
| `tests/generateTestCases.js` | `this.outputDir` | セッション別ディレクトリに変更 |
| `tests/runScenarios.js` | `batch_result_*.json`保存処理 | `results/reports/`に移動 |
| `tests/utils/autoplaywrightReporter.js` | スクリーンショット・DOM保存 | セッション別ディレクトリ対応 |
| `tests/generateTestPoints.js` | テスト観点ファイル保存 | `artifacts/test-points/`に移動 |

### 3.2 ファイル読み込みコンポーネント

| ファイル | 影響箇所 | 変更内容 |
|---|---|---|
| `server.js` | バッチ結果ファイル検索 | 新しいパス構造に対応 |
| `tests/analyzeFailures.js` | `batch_result_*.json`読み込み | セッション管理対応 |
| `tests/generateScenariosForUnautomated.js` | `naturalLanguageTestCases_*.json`検索 | 新しいパス構造に対応 |
| `tests/discoverNewStories.js` | バッチ結果ファイル読み込み | セッション管理対応 |
| `tests/discoverNewScenarios.js` | バッチ結果ファイル読み込み | セッション管理対応 |

---

## 4. 移行計画

### 4.1 段階的移行アプローチ

#### Phase 1: 新機能追加（既存機能を維持）
- OutputManager クラスの実装
- 新しいディレクトリ構造での並行出力
- 既存のファイル検索ロジックを維持

#### Phase 2: 段階的移行
- 新しいファイル出力に順次切り替え
- レガシーファイルの読み込み対応を維持
- 移行ツールの提供

#### Phase 3: 完全移行
- レガシーファイル検索ロジックの削除
- 既存ファイルのアーカイブ化

### 4.2 後方互換性の確保

```typescript
// 既存ファイル検索の例
class LegacyFileResolver {
  findBatchResults() {
    // 1. 新しいパス構造から検索
    const newFiles = this.searchInSessionDirectories();
    
    // 2. レガシーパスから検索（後方互換性）
    const legacyFiles = this.searchInLegacyPath();
    
    return [...newFiles, ...legacyFiles];
  }
}
```

---

## 5. 実装上の注意点

### 5.1 ファイル命名規則の変更

| 現在 | 新仕様 | 理由 |
|---|---|---|
| `naturalLanguageTestCases_2025-07-18T1406_表示.json` | `test-case_TC001.json` | より構造化された命名 |
| `batch_result_250719080649232.json` | `batch-report_20250127143045.json` | 明確な用途の表現 |

### 5.2 セッション管理の導入

- 各実行がセッションIDで管理される
- セッションIDはタイムスタンプベース：`YYYY-MM-DD_HH-mm-ss`
- `latest`シンボリックリンクで最新セッションへのアクセスを提供

### 5.3 既存コードへの影響

1. **ファイルパス解決の変更**
   - ハードコードされたパスを動的解決に変更
   - セッションコンテキストの追加

2. **ファイル検索ロジックの更新**
   - glob パターンの更新
   - セッション別検索の実装

3. **設定ファイルの拡張**
   - 新しい出力設定の追加
   - 移行設定オプションの提供

---

## 6. 移行のメリット

### 6.1 運用面の改善
- **履歴管理**: 実行結果の履歴を自動管理
- **ファイル整理**: 用途別にファイルが整理される
- **容量管理**: 古いセッションの自動アーカイブ

### 6.2 開発面の改善
- **デバッグ**: セッション単位でのトラブルシューティング
- **テスト**: セッション別のテスト実行が可能
- **CI/CD**: 構造化された出力での自動化が容易

### 6.3 ユーザビリティの向上
- **直感的**: ファイルの用途が明確
- **検索性**: 構造化されたディレクトリでの効率的な検索
- **レポート**: セッション別の詳細レポート生成

---

## 7. 推奨実装順序

1. **OutputManager基盤実装** (1週間)
   - 基本クラス構造
   - ディレクトリ作成機能
   
2. **既存コンポーネント統合** (2週間)
   - generateTestCases.js の更新
   - runScenarios.js の更新
   - autoplaywrightReporter.js の更新

3. **ファイル検索機能更新** (1週間)
   - server.js の更新
   - 各種分析ツールの更新

4. **移行ツール実装** (1週間)
   - 既存ファイルの新構造への移行
   - 検証機能

5. **テスト・ドキュメント** (1週間)
   - 単体・統合テスト
   - ユーザーガイド作成

---

**結論:** 新しいディレクトリ構造により、ファイルの種類は変わりませんが、配置場所が大幅に整理され、セッション管理による履歴追跡が可能になります。既存の `naturalLanguageTestCases_*.json` や `batch_result_*.json` ファイルは、それぞれ適切なセッション別ディレクトリに配置され、用途に応じて `artifacts/test-cases/` や `results/reports/` に分類されます。