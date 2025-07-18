const fs = require('fs').promises;
const path = require('path');

/**
 * Phase 2: 統合レポート生成機能
 * 複数セッションの結果を統合し、視覚的なダッシュボードを生成
 */
class ReportGenerator {
  constructor(outputManager) {
    this.outputManager = outputManager;
    this.directoryManager = outputManager.directoryManager;
    this.fileWriter = outputManager.fileWriter;
  }

  /**
   * 統合HTMLダッシュボードを生成
   * @param {Object} options 生成オプション
   * @returns {Promise<string>} 生成されたレポートファイルパス
   */
  async generateDashboard(options = {}) {
    const {
      includeSessions = 10,
      includeArchived = false,
      theme = 'modern'
    } = options;

    try {
      console.log('📊 統合ダッシュボード生成開始...');
      
      // 1. セッションデータを収集
      const sessionsData = await this._collectSessionsData(includeSessions, includeArchived);
      
      // 2. 統計情報を生成
      const statistics = this._generateStatistics(sessionsData);
      
      // 3. HTMLダッシュボードを生成
      const htmlContent = this._generateDashboardHTML(sessionsData, statistics, theme);
      
      // 4. ダッシュボードファイルを保存
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `dashboard_${timestamp.substring(0, 16)}.html`;
      const reportPath = path.join(this.directoryManager.baseDir, 'reports', fileName);
      
      // FileWriterでダッシュボードファイルを保存（ディレクトリ作成も含む）
      await this.fileWriter.writeText(reportPath, htmlContent, { skipCompression: true });
      
      // ファイルが正常に作成されたか確認
      try {
        await fs.access(reportPath);
        console.log(`📝 ダッシュボードファイル作成確認: ${reportPath}`);
      } catch (error) {
        throw new Error(`Dashboard file was not created: ${reportPath}`);
      }
      
      // 5. 最新ダッシュボードのシンボリックリンクを更新
      const latestPath = path.join(this.directoryManager.baseDir, 'reports', 'latest-dashboard.html');
      try {
        await fs.unlink(latestPath);
      } catch (error) {
        // ファイルが存在しない場合は無視
        console.log(`📝 古いlatest-dashboard.htmlは存在しませんでした`);
      }
      
      try {
        await fs.copyFile(reportPath, latestPath);
        console.log(`🔗 latest-dashboard.html更新完了`);
      } catch (error) {
        console.warn(`⚠️ latest-dashboard.htmlの作成に失敗しましたが、処理を続行します: ${error.message}`);
      }
      
      console.log(`✅ 統合ダッシュボード生成完了: ${fileName}`);
      console.log(`🔗 最新版: ${latestPath}`);
      
      return reportPath;
      
    } catch (error) {
      throw new Error(`Dashboard generation failed: ${error.message}`);
    }
  }

  /**
   * セッション比較レポートを生成
   * @param {string[]} sessionIds 比較対象のセッションID
   * @returns {Promise<string>} 生成されたレポートファイルパス
   */
  async generateComparisonReport(sessionIds) {
    try {
      console.log(`📈 セッション比較レポート生成開始: ${sessionIds.length}件`);
      
      // セッションデータを取得
      const sessions = [];
      for (const sessionId of sessionIds) {
        try {
          const sessionData = await this._loadSessionData(sessionId);
          sessions.push(sessionData);
        } catch (error) {
          console.warn(`⚠️ セッション ${sessionId} の読み込みに失敗: ${error.message}`);
        }
      }
      
      if (sessions.length < 2) {
        throw new Error('比較には最低2つのセッションが必要です');
      }
      
      // 比較分析を実行
      const comparison = this._generateComparison(sessions);
      
      // HTMLレポートを生成
      const htmlContent = this._generateComparisonHTML(comparison);
      
      // レポートを保存
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `comparison_${timestamp.substring(0, 16)}.html`;
      const reportPath = path.join(this.directoryManager.baseDir, 'reports', fileName);
      
      await this.directoryManager.ensureDirectoryExists(path.dirname(reportPath));
      await this.fileWriter.writeText(reportPath, htmlContent);
      
      console.log(`✅ セッション比較レポート生成完了: ${fileName}`);
      
      return reportPath;
      
    } catch (error) {
      throw new Error(`Comparison report generation failed: ${error.message}`);
    }
  }

  /**
   * トレンドレポートを生成
   * @param {Object} options 生成オプション
   * @returns {Promise<string>} 生成されたレポートファイルパス
   */
  async generateTrendReport(options = {}) {
    const {
      period = 30, // 日数
      metric = 'success_rate' // success_rate, execution_time, step_count
    } = options;

    try {
      console.log(`📊 トレンドレポート生成開始: ${period}日間の${metric}`);
      
      // 期間内のセッションデータを収集
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - period);
      
      const sessionsData = await this._collectSessionsData(1000, false); // 大量取得
      const filteredSessions = sessionsData.filter(session => 
        new Date(session.timestamp) >= cutoffDate
      );
      
      // トレンドデータを生成
      const trendData = this._generateTrendData(filteredSessions, metric);
      
      // HTMLレポートを生成
      const htmlContent = this._generateTrendHTML(trendData, metric, period);
      
      // レポートを保存
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `trend_${metric}_${period}days_${timestamp.substring(0, 16)}.html`;
      const reportPath = path.join(this.directoryManager.baseDir, 'reports', fileName);
      
      await this.directoryManager.ensureDirectoryExists(path.dirname(reportPath));
      await this.fileWriter.writeText(reportPath, htmlContent);
      
      console.log(`✅ トレンドレポート生成完了: ${fileName}`);
      
      return reportPath;
      
    } catch (error) {
      throw new Error(`Trend report generation failed: ${error.message}`);
    }
  }

  // プライベートメソッド

  /**
   * セッションデータを収集
   * @private
   */
  async _collectSessionsData(limit, includeArchived) {
    const sessions = [];
    
    try {
      // runs ディレクトリから最新のセッションを取得
      const runsDir = path.join(this.directoryManager.baseDir, 'runs');
      
      try {
        const sessionDirs = await fs.readdir(runsDir);
        const sortedSessions = sessionDirs
          .filter(dir => /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(dir))
          .sort()
          .reverse()
          .slice(0, limit);

        for (const sessionDir of sortedSessions) {
          try {
            const sessionData = await this._loadSessionData(sessionDir);
            sessions.push(sessionData);
          } catch (error) {
            console.warn(`⚠️ セッション ${sessionDir} の読み込みをスキップ: ${error.message}`);
          }
        }
      } catch (error) {
        console.warn('⚠️ runs ディレクトリが見つかりません');
      }

      // アーカイブからも取得（オプション）
      if (includeArchived) {
        // TODO: アーカイブ機能実装時に追加
      }
      
    } catch (error) {
      console.warn(`⚠️ セッションデータ収集エラー: ${error.message}`);
    }

    return sessions;
  }

  /**
   * セッションデータを読み込み
   * @private
   */
  async _loadSessionData(sessionId) {
    const sessionDir = path.join(this.directoryManager.baseDir, 'runs', sessionId);
    const summaryPath = path.join(sessionDir, 'metadata', 'summary.json');
    
    try {
      const summaryContent = await fs.readFile(summaryPath, 'utf8');
      const summary = JSON.parse(summaryContent);
      
      // 追加情報を収集
      const manifestPath = path.join(sessionDir, 'metadata', 'file-manifest.json');
      let manifest = null;
      try {
        const manifestContent = await fs.readFile(manifestPath, 'utf8');
        manifest = JSON.parse(manifestContent);
      } catch (error) {
        // マニフェストがない場合は無視
      }
      
      return {
        sessionId,
        timestamp: summary.startTime,
        ...summary,
        manifest
      };
      
    } catch (error) {
      throw new Error(`Failed to load session data for ${sessionId}: ${error.message}`);
    }
  }

  /**
   * 統計情報を生成
   * @private
   */
  _generateStatistics(sessionsData) {
    if (sessionsData.length === 0) {
      return {
        totalSessions: 0,
        averageSuccessRate: 0,
        averageExecutionTime: 0,
        totalTestCases: 0,
        recentTrend: 'no_data'
      };
    }

    const totalSessions = sessionsData.length;
    const successRates = sessionsData
      .filter(s => s.testResults && s.testResults.length > 0)
      .map(s => {
        const total = s.testResults.length;
        const passed = s.testResults.filter(r => r.status === 'success').length;
        return total > 0 ? (passed / total) * 100 : 0;
      });

    const executionTimes = sessionsData
      .filter(s => s.endTime && s.startTime)
      .map(s => new Date(s.endTime) - new Date(s.startTime));

    const averageSuccessRate = successRates.length > 0 
      ? successRates.reduce((sum, rate) => sum + rate, 0) / successRates.length 
      : 0;

    const averageExecutionTime = executionTimes.length > 0
      ? executionTimes.reduce((sum, time) => sum + time, 0) / executionTimes.length
      : 0;

    const totalTestCases = sessionsData.reduce((total, session) => 
      total + (session.testResults ? session.testResults.length : 0), 0);

    // 最近のトレンド分析（簡易版）
    let recentTrend = 'stable';
    if (successRates.length >= 3) {
      const recent = successRates.slice(0, 3);
      const older = successRates.slice(3, 6);
      if (older.length > 0) {
        const recentAvg = recent.reduce((sum, rate) => sum + rate, 0) / recent.length;
        const olderAvg = older.reduce((sum, rate) => sum + rate, 0) / older.length;
        
        if (recentAvg > olderAvg + 5) recentTrend = 'improving';
        else if (recentAvg < olderAvg - 5) recentTrend = 'declining';
      }
    }

    return {
      totalSessions,
      averageSuccessRate: Math.round(averageSuccessRate * 10) / 10,
      averageExecutionTime: Math.round(averageExecutionTime / 1000), // 秒単位
      totalTestCases,
      recentTrend,
      successRateDistribution: this._calculateDistribution(successRates),
      lastExecutionTime: sessionsData.length > 0 ? sessionsData[0].timestamp : null
    };
  }

  /**
   * 分布を計算
   * @private
   */
  _calculateDistribution(values) {
    if (values.length === 0) return {};
    
    const ranges = {
      '90-100%': 0,
      '70-89%': 0,
      '50-69%': 0,
      '0-49%': 0
    };

    values.forEach(value => {
      if (value >= 90) ranges['90-100%']++;
      else if (value >= 70) ranges['70-89%']++;
      else if (value >= 50) ranges['50-69%']++;
      else ranges['0-49%']++;
    });

    return ranges;
  }

  /**
   * HTMLダッシュボードを生成
   * @private
   */
  _generateDashboardHTML(sessionsData, statistics, theme) {
    const trendIndicator = {
      improving: '📈 向上中',
      declining: '📉 低下中',
      stable: '📊 安定',
      no_data: '📊 データ不足'
    };

    return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AutoPlaywright 統合ダッシュボード</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        
        .dashboard {
            max-width: 1400px;
            margin: 0 auto;
            background: white;
            border-radius: 15px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        
        .header {
            background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }
        
        .header h1 {
            font-size: 2.5em;
            margin-bottom: 10px;
            font-weight: 700;
        }
        
        .header .subtitle {
            font-size: 1.1em;
            opacity: 0.9;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            padding: 30px;
            background: #f8f9fa;
        }
        
        .stat-card {
            background: white;
            padding: 25px;
            border-radius: 12px;
            text-align: center;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            transition: transform 0.3s ease;
        }
        
        .stat-card:hover {
            transform: translateY(-5px);
        }
        
        .stat-icon {
            font-size: 2.5em;
            margin-bottom: 15px;
        }
        
        .stat-value {
            font-size: 2.2em;
            font-weight: bold;
            color: #2c3e50;
            margin-bottom: 8px;
        }
        
        .stat-label {
            color: #7f8c8d;
            font-size: 1em;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        .sessions-section {
            padding: 30px;
        }
        
        .section-title {
            font-size: 1.8em;
            margin-bottom: 25px;
            color: #2c3e50;
            border-bottom: 3px solid #3498db;
            padding-bottom: 10px;
        }
        
        .sessions-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
            background: white;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        
        .sessions-table th {
            background: #34495e;
            color: white;
            padding: 15px;
            text-align: left;
            font-weight: 600;
        }
        
        .sessions-table td {
            padding: 12px 15px;
            border-bottom: 1px solid #ecf0f1;
        }
        
        .sessions-table tr:nth-child(even) {
            background: #f8f9fa;
        }
        
        .status-badge {
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.85em;
            font-weight: 600;
            text-transform: uppercase;
        }
        
        .status-success {
            background: #d4edda;
            color: #155724;
        }
        
        .status-partial {
            background: #fff3cd;
            color: #856404;
        }
        
        .status-failed {
            background: #f8d7da;
            color: #721c24;
        }
        
        .distribution-chart {
            display: flex;
            gap: 10px;
            margin-top: 15px;
        }
        
        .distribution-bar {
            flex: 1;
            height: 8px;
            border-radius: 4px;
        }
        
        .footer {
            padding: 20px 30px;
            background: #ecf0f1;
            text-align: center;
            color: #7f8c8d;
            font-size: 0.9em;
        }
        
        .trend-improving { color: #27ae60; }
        .trend-declining { color: #e74c3c; }
        .trend-stable { color: #3498db; }
        .trend-no_data { color: #95a5a6; }
        
        @media (max-width: 768px) {
            .stats-grid {
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                padding: 20px;
                gap: 15px;
            }
            
            .header h1 {
                font-size: 2em;
            }
            
            .sessions-table {
                font-size: 0.9em;
            }
        }
    </style>
</head>
<body>
    <div class="dashboard">
        <div class="header">
            <h1>🚀 AutoPlaywright ダッシュボード</h1>
            <div class="subtitle">統合テスト結果分析 - ${new Date().toLocaleDateString('ja-JP')}</div>
        </div>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-icon">📊</div>
                <div class="stat-value">${statistics.totalSessions}</div>
                <div class="stat-label">総セッション数</div>
            </div>
            
            <div class="stat-card">
                <div class="stat-icon">✅</div>
                <div class="stat-value">${statistics.averageSuccessRate}%</div>
                <div class="stat-label">平均成功率</div>
            </div>
            
            <div class="stat-card">
                <div class="stat-icon">⏱️</div>
                <div class="stat-value">${statistics.averageExecutionTime}s</div>
                <div class="stat-label">平均実行時間</div>
            </div>
            
            <div class="stat-card">
                <div class="stat-icon">🧪</div>
                <div class="stat-value">${statistics.totalTestCases}</div>
                <div class="stat-label">総テストケース数</div>
            </div>
            
            <div class="stat-card">
                <div class="stat-icon">📈</div>
                <div class="stat-value trend-${statistics.recentTrend}">${trendIndicator[statistics.recentTrend]}</div>
                <div class="stat-label">最近のトレンド</div>
            </div>
        </div>
        
        <div class="sessions-section">
            <h2 class="section-title">🕐 最近のセッション実行履歴</h2>
            
            <table class="sessions-table">
                <thead>
                    <tr>
                        <th>セッションID</th>
                        <th>実行日時</th>
                        <th>成功率</th>
                        <th>実行時間</th>
                        <th>テスト数</th>
                        <th>ステータス</th>
                    </tr>
                </thead>
                <tbody>
                    ${sessionsData.slice(0, 10).map(session => {
                        const successRate = session.testResults && session.testResults.length > 0
                            ? Math.round((session.testResults.filter(r => r.status === 'success').length / session.testResults.length) * 100)
                            : 0;
                        
                        const executionTime = session.endTime && session.startTime
                            ? Math.round((new Date(session.endTime) - new Date(session.startTime)) / 1000)
                            : 'N/A';
                        
                        const testCount = session.testResults ? session.testResults.length : 0;
                        
                        let statusClass = 'status-partial';
                        let statusText = '部分成功';
                        if (successRate >= 95) {
                            statusClass = 'status-success';
                            statusText = '成功';
                        } else if (successRate < 50) {
                            statusClass = 'status-failed';
                            statusText = '要改善';
                        }
                        
                        return `
                        <tr>
                            <td><code>${session.sessionId}</code></td>
                            <td>${new Date(session.timestamp).toLocaleString('ja-JP')}</td>
                            <td><strong>${successRate}%</strong></td>
                            <td>${executionTime}s</td>
                            <td>${testCount}</td>
                            <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                        </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
        
        <div class="footer">
            <p>📊 AutoPlaywright Phase 2 統合レポート機能 - Generated at ${new Date().toLocaleString('ja-JP')}</p>
            <p>💡 このダッシュボードは自動生成されています。最新の情報については定期的に更新してください。</p>
        </div>
    </div>
</body>
</html>`;
  }

  /**
   * 比較分析を生成
   * @private
   */
  _generateComparison(sessions) {
    // TODO: セッション比較ロジックの実装
    return {
      sessions,
      improvements: [],
      regressions: [],
      summary: '比較分析機能は今後実装予定です'
    };
  }

  /**
   * 比較HTMLを生成
   * @private
   */
  _generateComparisonHTML(comparison) {
    return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <title>セッション比較レポート</title>
</head>
<body>
    <h1>🔄 セッション比較レポート</h1>
    <p>${comparison.summary}</p>
    <!-- 詳細な比較分析は今後実装 -->
</body>
</html>`;
  }

  /**
   * トレンドデータを生成
   * @private
   */
  _generateTrendData(sessions, metric) {
    // TODO: トレンド分析ロジックの実装
    return {
      sessions,
      metric,
      trend: '安定',
      data: []
    };
  }

  /**
   * トレンドHTMLを生成
   * @private
   */
  _generateTrendHTML(trendData, metric, period) {
    return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <title>トレンドレポート</title>
</head>
<body>
    <h1>📈 トレンドレポート (${period}日間)</h1>
    <p>メトリック: ${metric}</p>
    <!-- 詳細なトレンド分析は今後実装 -->
</body>
</html>`;
  }
}

module.exports = ReportGenerator; 