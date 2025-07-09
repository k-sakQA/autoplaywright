/**
 * 簡易HTMLレポーター（runRoutes.js互換）
 */
export class HtmlReporter {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.routeId = null;
    this.testName = null;
    this.userStoryInfo = null;
    this.steps = [];
  }

  setRouteId(routeId) {
    this.routeId = routeId;
  }

  setTestName(testName) {
    this.testName = testName;
  }

  setUserStoryInfo(id, name) {
    this.userStoryInfo = { id, name };
  }

  startTest(testName) {
    this.testName = testName;
    console.log(`📊 テスト開始: ${testName}`);
  }

  addStep(stepData) {
    this.steps.push(stepData);
    console.log(`📝 ステップ記録: ${stepData.action} - ${stepData.success ? '成功' : '失敗'}`);
  }

  addFailedStep(stepData) {
    this.steps.push({
      ...stepData,
      success: false
    });
    console.log(`❌ 失敗ステップ記録: ${stepData.action}`);
  }

  finishTest() {
    console.log(`🎯 テスト完了: ${this.testName} (${this.steps.length}ステップ)`);
  }
} 