# AutoPlaywright スクリーンショット表示不具合修正 詳細設計書

## 1. 不具合概要

### 1.1 現象
- 失敗テストのスクリーンショットがHTMLレポートから閲覧できない
- レポート上でスクリーンショット表示エリアに「Element not found: #guests」などのエラーが表示される
- 画像ファイル自体は生成されているが、レポートからアクセスできない状態

### 1.2 影響範囲
- AutoPlaywright拡張レポート（AutoPlaywright_Enhanced_Report_*.html）
- 失敗時のデバッグ効率低下
- テスト結果の検証作業への影響

## 2. 原因分析

### 2.1 スクリーンショットファイルパスの不整合

#### 2.1.1 現在のスクリーンショット保存先
- **実際の保存先**: `test-results/USIS-{userStoryId}/screenshots/{sessionId}/{stepId}_failure.png`
- **レポートでの参照先**: 複数の相対パスパターンで探索

#### 2.1.2 パス探索ロジックの問題
**ファイル**: `tests/generateTestReport.js` (Line 2976-2982)
```javascript
const possiblePaths = [
    'test-results/USIS-1/screenshots/' + routeId + '/step_' + stepIndex + '_failure.png',
    'test-results/USIS-1/screenshots/' + routeId + '/step_' + stepIndex + '.png',
    'test-results/screenshot_' + routeId + '_step_' + stepIndex + '.png',
    'test-results/screenshots/step_' + stepIndex + '.png',
    'test-results/' + routeId + '/screenshot.png'
];
```

**問題点**:
1. `routeId` と実際の `sessionId` の不一致
2. USIS番号がハードコードされている (USIS-1)
3. 新しいファイル構造に対応していない

### 2.2 レポート生成時のパス情報不足

#### 2.2.1 スクリーンショットパス情報の伝達不足
**ファイル**: `tests/utils/enhancedReportGenerator.js` (Line 440)
```javascript
<img src="${step.screenshot}" alt="ステップスクリーンショット" class="step-screenshot" onclick="openImageModal('${step.screenshot}')">
```

**問題点**:
- `step.screenshot` が正しく設定されていない
- 保存時のパス情報がレポート生成時に伝達されていない

### 2.3 複数レポート生成システム間の連携不足
- `autoplaywrightReporter.js` でのスクリーンショット保存
- `enhancedReportGenerator.js` でのレポート生成
- `testReportIntegrator.js` での統合処理

間でのパス情報の受け渡しが不完全

## 3. 修正設計

### 3.1 修正方針
1. **統一されたパス管理システムの構築**
2. **レポート生成時の正確なパス情報伝達**
3. **動的パス解決機能の改善**
4. **バックアップ探索ロジックの強化**

### 3.2 修正対象ファイル

#### 3.2.1 `tests/utils/autoplaywrightReporter.js`
**修正内容**: スクリーンショット保存時のパス情報をメタデータとして記録

```javascript
// 修正前（Line 372-381）
saveScreenshot(screenshot, stepId) {
  const usisDir = this.getUSISDirectory();
  const screenshotsDir = path.join(usisDir, 'screenshots', this.sessionId);
  this.ensureDirectory(screenshotsDir);
  
  const filename = `${stepId}_failure.png`;
  const filepath = path.join(screenshotsDir, filename);
  
  fs.writeFileSync(filepath, screenshot);
  console.log(`📸 スクリーンショット保存: ${filepath}`);
  return filepath;
}

// 修正後
saveScreenshot(screenshot, stepId) {
  const usisDir = this.getUSISDirectory();
  const screenshotsDir = path.join(usisDir, 'screenshots', this.sessionId);
  this.ensureDirectory(screenshotsDir);
  
  const filename = `${stepId}_failure.png`;
  const filepath = path.join(screenshotsDir, filename);
  
  // 絶対パスと相対パスの両方を記録
  const absolutePath = path.resolve(filepath);
  const relativePath = path.relative(process.cwd(), filepath);
  
  fs.writeFileSync(filepath, screenshot);
  console.log(`📸 スクリーンショット保存: ${filepath}`);
  
  return {
    absolutePath,
    relativePath,
    filename,
    sessionId: this.sessionId,
    userStoryId: this.currentUserStoryId,
    stepId
  };
}
```

#### 3.2.2 `tests/utils/enhancedReportGenerator.js`
**修正内容**: スクリーンショットパスの正確な処理

```javascript
// 修正前（Line 227-231）
if (step.screenshot) {
  evidence.push({
    type: 'screenshot',
    path: step.screenshot,
    description: 'ステップ実行時のスクリーンショット'
  });
}

// 修正後
if (step.screenshot) {
  // screenshotがオブジェクトの場合は相対パスを使用
  const screenshotPath = typeof step.screenshot === 'object' 
    ? step.screenshot.relativePath 
    : step.screenshot;
    
  evidence.push({
    type: 'screenshot',
    path: screenshotPath,
    absolutePath: typeof step.screenshot === 'object' ? step.screenshot.absolutePath : null,
    description: 'ステップ実行時のスクリーンショット',
    metadata: typeof step.screenshot === 'object' ? step.screenshot : null
  });
}
```

#### 3.2.3 `tests/generateTestReport.js`
**修正内容**: 動的パス解決ロジックの改善

```javascript
// 修正前（Line 2976-2982）の possiblePaths を以下に置き換え

function generateDynamicScreenshotPaths(routeId, stepIndex, userStoryId, sessionId) {
  const basePaths = [];
  
  // 新しいファイル構造（優先度高）
  if (userStoryId && sessionId) {
    basePaths.push(`test-results/USIS-${userStoryId}/screenshots/${sessionId}/step_${stepIndex}_failure.png`);
    basePaths.push(`test-results/USIS-${userStoryId}/screenshots/${sessionId}/step_${stepIndex}.png`);
  }
  
  // ユーザーストーリーIDのみ判明している場合
  if (userStoryId) {
    basePaths.push(`test-results/USIS-${userStoryId}/screenshots/${routeId}/step_${stepIndex}_failure.png`);
    basePaths.push(`test-results/USIS-${userStoryId}/screenshots/${routeId}/step_${stepIndex}.png`);
  }
  
  // 従来構造（後方互換性）
  basePaths.push(`test-results/USIS-1/screenshots/${routeId}/step_${stepIndex}_failure.png`);
  basePaths.push(`test-results/screenshot_${routeId}_step_${stepIndex}.png`);
  basePaths.push(`test-results/screenshots/step_${stepIndex}.png`);
  basePaths.push(`test-results/${routeId}/screenshot.png`);
  
  return basePaths;
}
```

#### 3.2.4 `tests/utils/testReportIntegrator.js`
**修正内容**: スクリーンショットメタデータの伝達

```javascript
// enhanceTestResults メソッド内で正確なパス情報を設定
enhanceTestResults(testResults) {
  const steps = testResults.steps || [];
  
  return steps.map((step, index) => {
    // ... 既存のコード ...
    
    return {
      ...step,
      stepId: step.id || `step_${index + 1}`,
      stepName: step.label || step.action || `ステップ ${index + 1}`,
      assertions: enhancedAssertions,
      statusSummary: {
        totalAssertions: enhancedAssertions.length,
        successfulAssertions: enhancedAssertions.filter(a => a.status === 'success').length,
        failedAssertions: enhancedAssertions.filter(a => a.status === 'failed').length
      },
      executionTime: step.duration || step.executionTime || 0,
      // スクリーンショットパス情報の正確な設定
      screenshot: this.resolveScreenshotPath(step.screenshot, step.stepId),
      domSnapshot: step.domSnapshot || null
    };
  });
}

// 新メソッド: スクリーンショットパス解決
resolveScreenshotPath(screenshotInfo, stepId) {
  if (!screenshotInfo) return null;
  
  // 新形式（オブジェクト）の場合
  if (typeof screenshotInfo === 'object' && screenshotInfo.relativePath) {
    return screenshotInfo.relativePath;
  }
  
  // 従来形式（文字列）の場合
  if (typeof screenshotInfo === 'string') {
    return screenshotInfo;
  }
  
  return null;
}
```

### 3.3 新機能追加

#### 3.3.1 スクリーンショットメタデータ管理クラス
**ファイル**: `tests/utils/screenshotPathManager.js` (新規作成)

```javascript
/**
 * スクリーンショットパス管理クラス
 */
export class ScreenshotPathManager {
  constructor(options = {}) {
    this.baseDir = options.baseDir || 'test-results';
    this.pathCache = new Map();
  }
  
  /**
   * スクリーンショットパス情報を生成
   */
  generatePathInfo(userStoryId, sessionId, stepId) {
    const usisDir = userStoryId ? `USIS-${userStoryId}` : 'common';
    const filename = `${stepId}_failure.png`;
    const relativePath = path.join(this.baseDir, usisDir, 'screenshots', sessionId, filename);
    const absolutePath = path.resolve(relativePath);
    
    const pathInfo = {
      absolutePath,
      relativePath,
      filename,
      sessionId,
      userStoryId,
      stepId,
      webPath: relativePath.replace(/\\/g, '/'), // Web用のパス
      timestamp: new Date().toISOString()
    };
    
    // キャッシュに保存
    this.pathCache.set(`${sessionId}_${stepId}`, pathInfo);
    
    return pathInfo;
  }
  
  /**
   * 保存されたパス情報を取得
   */
  getPathInfo(sessionId, stepId) {
    return this.pathCache.get(`${sessionId}_${stepId}`);
  }
  
  /**
   * 動的パス探索
   */
  async findScreenshotPaths(routeId, stepIndex, userStoryId = null) {
    const searchPaths = this.generateSearchPaths(routeId, stepIndex, userStoryId);
    const existingPaths = [];
    
    for (const searchPath of searchPaths) {
      try {
        await fs.promises.access(searchPath);
        existingPaths.push(searchPath);
      } catch (error) {
        // ファイルが存在しない場合は無視
      }
    }
    
    return existingPaths;
  }
  
  /**
   * 検索パス一覧を生成
   */
  generateSearchPaths(routeId, stepIndex, userStoryId) {
    const patterns = [];
    
    // 現在の構造
    if (userStoryId) {
      patterns.push(`${this.baseDir}/USIS-${userStoryId}/screenshots/*/step_${stepIndex}_failure.png`);
      patterns.push(`${this.baseDir}/USIS-${userStoryId}/screenshots/${routeId}/step_${stepIndex}_failure.png`);
    }
    
    // 従来構造
    patterns.push(`${this.baseDir}/USIS-1/screenshots/${routeId}/step_${stepIndex}_failure.png`);
    patterns.push(`${this.baseDir}/screenshot_${routeId}_step_${stepIndex}.png`);
    
    return patterns;
  }
}
```

#### 3.3.2 レポート用スクリーンショット解決API
**ファイル**: `tests/utils/screenshotResolver.js` (新規作成)

```javascript
/**
 * レポート表示用スクリーンショット解決
 */
export class ScreenshotResolver {
  constructor(pathManager) {
    this.pathManager = pathManager;
  }
  
  /**
   * レポート用スクリーンショットパスを解決
   */
  async resolveForReport(testResults) {
    const resolvedSteps = [];
    
    for (const step of testResults.steps || []) {
      const resolvedStep = { ...step };
      
      if (step.status === 'failed' && step.stepId) {
        // 失敗ステップのスクリーンショットを探索
        const paths = await this.pathManager.findScreenshotPaths(
          step.routeId || 'unknown',
          step.stepIndex || step.stepId.replace('step_', ''),
          step.userStoryId
        );
        
        if (paths.length > 0) {
          resolvedStep.screenshot = {
            webPath: paths[0].replace(/\\/g, '/'),
            alternativePaths: paths.slice(1),
            resolved: true,
            resolvedAt: new Date().toISOString()
          };
        } else {
          resolvedStep.screenshot = {
            webPath: null,
            resolved: false,
            searchedPaths: this.pathManager.generateSearchPaths(
              step.routeId || 'unknown',
              step.stepIndex || step.stepId.replace('step_', ''),
              step.userStoryId
            )
          };
        }
      }
      
      resolvedSteps.push(resolvedStep);
    }
    
    return { ...testResults, steps: resolvedSteps };
  }
}
```

## 4. 実装手順

### 4.1 Phase 1: 基盤修正
1. `autoplaywrightReporter.js` のスクリーンショット保存処理を修正
2. `ScreenshotPathManager` クラスを実装
3. `ScreenshotResolver` クラスを実装

### 4.2 Phase 2: レポート生成修正
1. `enhancedReportGenerator.js` のパス処理を修正
2. `testReportIntegrator.js` のパス解決処理を追加
3. 新しいパス管理システムの統合

### 4.3 Phase 3: 表示ロジック修正
1. `generateTestReport.js` の動的パス探索を改善
2. フロントエンド JavaScript の修正
3. エラーメッセージの改善

### 4.4 Phase 4: テスト・検証
1. 既存テストケースでの動作確認
2. 新旧ファイル構造での互換性確認
3. パフォーマンス確認

## 5. 期待効果

### 5.1 直接的効果
- スクリーンショットが正常に表示される
- 失敗時のデバッグ効率が向上
- レポートの信頼性が向上

### 5.2 間接的効果
- ファイル管理システムの統一化
- 将来的な拡張に対する柔軟性向上
- メンテナンス性の向上

## 6. リスク評価

### 6.1 低リスク
- パス解決ロジックの改善（既存機能への影響小）
- メタデータ追加（後方互換性維持）

### 6.2 中リスク
- ファイル構造の変更（移行期間が必要）
- 複数レポートシステム間の調整

### 6.3 対策
- 段階的実装とロールバック計画
- 十分なテスト期間の確保
- 既存データとの互換性維持

## 7. 追加考慮事項

### 7.1 パフォーマンス
- ファイル探索処理の最適化
- キャッシュ機能の活用

### 7.2 ユーザビリティ
- エラーメッセージの改善
- 代替表示オプションの提供

### 7.3 メンテナンス性
- ログ出力の充実
- 設定の外部化