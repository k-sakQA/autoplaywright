import { ScreenshotPathManager } from './screenshotPathManager.js';

/**
 * レポート表示用スクリーンショット解決
 */
export class ScreenshotResolver {
  constructor(pathManager = null) {
    this.pathManager = pathManager || new ScreenshotPathManager();
  }
  
  /**
   * レポート用スクリーンショットパスを解決
   */
  async resolveForReport(testResults) {
    const resolvedSteps = [];
    
    for (const step of testResults.steps || []) {
      const resolvedStep = { ...step };
      
      if (step.status === 'failed' && (step.stepId || step.stepIndex)) {
        // 失敗ステップのスクリーンショットを探索
        const stepIndex = step.stepIndex || (step.stepId ? step.stepId.replace('step_', '') : '0');
        const routeId = step.routeId || testResults.routeId || 'unknown';
        const userStoryId = step.userStoryId || testResults.userStoryId;
        
        const paths = await this.pathManager.findScreenshotPathsImproved(
          routeId,
          stepIndex,
          userStoryId
        );
        
        if (paths.length > 0) {
          resolvedStep.screenshot = {
            webPath: paths[0].replace(/\\/g, '/'),
            alternativePaths: paths.slice(1),
            resolved: true,
            resolvedAt: new Date().toISOString(),
            metadata: {
              routeId,
              stepIndex,
              userStoryId,
              searchCount: paths.length
            }
          };
        } else {
          resolvedStep.screenshot = {
            webPath: null,
            resolved: false,
            searchedPaths: this.pathManager.generateSearchPaths(
              routeId,
              stepIndex,
              userStoryId
            ),
            metadata: {
              routeId,
              stepIndex,
              userStoryId,
              searchAttempted: new Date().toISOString()
            }
          };
        }
      }
      
      resolvedSteps.push(resolvedStep);
    }
    
    return { ...testResults, steps: resolvedSteps };
  }
  
  /**
   * 単一ステップのスクリーンショットパスを解決
   */
  async resolveStepScreenshot(step, routeId, userStoryId = null) {
    if (!step || step.status !== 'failed') {
      return null;
    }
    
    const stepIndex = step.stepIndex || (step.stepId ? step.stepId.replace('step_', '') : '0');
    
    const paths = await this.pathManager.findScreenshotPathsImproved(
      routeId,
      stepIndex,
      userStoryId
    );
    
    if (paths.length > 0) {
      return {
        webPath: paths[0].replace(/\\/g, '/'),
        alternativePaths: paths.slice(1),
        resolved: true
      };
    }
    
    return {
      webPath: null,
      resolved: false,
      searchedPaths: this.pathManager.generateSearchPaths(routeId, stepIndex, userStoryId)
    };
  }
  
  /**
   * 既存のスクリーンショット情報を解決
   */
  resolveExistingScreenshot(screenshotInfo) {
    if (!screenshotInfo) return null;
    
    // 新形式（オブジェクト）の場合
    if (typeof screenshotInfo === 'object' && screenshotInfo.webPath) {
      return screenshotInfo.webPath;
    }
    
    if (typeof screenshotInfo === 'object' && screenshotInfo.relativePath) {
      return screenshotInfo.relativePath.replace(/\\/g, '/');
    }
    
    // 従来形式（文字列）の場合
    if (typeof screenshotInfo === 'string') {
      return screenshotInfo.replace(/\\/g, '/');
    }
    
    return null;
  }
  
  /**
   * バッチ処理でレポート内のすべてのスクリーンショットを解決
   */
  async resolveAllScreenshots(testResults) {
    const resolvedResults = await this.resolveForReport(testResults);
    
    // 統計情報を追加
    const stats = this.generateResolutionStats(resolvedResults);
    
    return {
      ...resolvedResults,
      screenshotResolution: {
        stats,
        resolvedAt: new Date().toISOString(),
        resolverVersion: '1.0.0'
      }
    };
  }
  
  /**
   * スクリーンショット解決統計情報を生成
   */
  generateResolutionStats(testResults) {
    const steps = testResults.steps || [];
    const totalSteps = steps.length;
    const failedSteps = steps.filter(step => step.status === 'failed').length;
    const resolvedScreenshots = steps.filter(step => 
      step.screenshot && step.screenshot.resolved
    ).length;
    const unresolvedScreenshots = steps.filter(step => 
      step.screenshot && !step.screenshot.resolved
    ).length;
    
    return {
      totalSteps,
      failedSteps,
      resolvedScreenshots,
      unresolvedScreenshots,
      resolutionRate: failedSteps > 0 ? (resolvedScreenshots / failedSteps * 100).toFixed(1) : '0'
    };
  }
} 