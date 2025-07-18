/**
 * AutoPlaywright Output Manager 型定義
 * 設計書のTypeScript型定義をJavaScriptのJSDocで実装
 */

/**
 * @typedef {Object} OutputConfig
 * @property {string} baseDir - ベースディレクトリパス
 * @property {boolean} enableArchiving - アーカイブ機能有効化
 * @property {number} maxRetentionDays - 最大保持日数
 * @property {boolean} compressionEnabled - 圧縮機能有効化
 * @property {FormatConfig} formats - ファイル形式設定
 */

/**
 * @typedef {Object} FormatConfig
 * @property {'html'|'json'|'markdown'|'all'} reports - レポート形式
 * @property {'png'|'jpg'} screenshots - スクリーンショット形式
 * @property {boolean} traces - トレースファイル有効化
 */

/**
 * @typedef {Object} TestSession
 * @property {string} sessionId - セッションID
 * @property {Date} startTime - 開始時刻
 * @property {SessionConfig} config - セッション設定
 * @property {string} basePath - ベースパス
 * @property {'running'|'completed'|'failed'|'archived'} status - ステータス
 */

/**
 * @typedef {Object} SessionConfig
 * @property {string} sessionId - セッションID
 * @property {Date} startTime - 開始時刻
 * @property {TestTarget} testTarget - テスト対象
 * @property {OutputSettings} outputSettings - 出力設定
 * @property {PlaywrightConfig} playwrightConfig - Playwright設定
 */

/**
 * @typedef {Object} TestTarget
 * @property {string} url - 対象URL
 * @property {string[]} scenarios - シナリオリスト
 * @property {string[]} browsers - ブラウザリスト
 */

/**
 * @typedef {Object} OutputSettings
 * @property {boolean} enableArtifacts - 成果物出力有効化
 * @property {boolean} enableResults - 結果出力有効化
 * @property {boolean} compressionEnabled - 圧縮有効化
 */

/**
 * @typedef {Object} PlaywrightConfig
 * @property {boolean} headless - ヘッドレスモード
 * @property {number} timeout - タイムアウト時間
 * @property {number} retries - リトライ回数
 */

/**
 * @typedef {Object} TestPoint
 * @property {string} id - ID
 * @property {string} category - カテゴリ
 * @property {string} description - 説明
 * @property {'high'|'medium'|'low'} priority - 優先度
 * @property {boolean} automatable - 自動化可能性
 */

/**
 * @typedef {Object} TestCase
 * @property {string} id - ID
 * @property {string} title - タイトル
 * @property {string} description - 説明
 * @property {TestStep[]} steps - テストステップ
 * @property {string[]} expectedResults - 期待結果
 * @property {string[]} testPointIds - テスト観点ID
 */

/**
 * @typedef {Object} TestStep
 * @property {string} action - アクション
 * @property {string} target - 対象要素
 * @property {string} [value] - 入力値
 * @property {string} description - 説明
 */

/**
 * @typedef {Object} PlaywrightScript
 * @property {string} id - ID
 * @property {string} testCaseId - テストケースID
 * @property {string} filename - ファイル名
 * @property {string} content - コンテンツ
 * @property {'typescript'|'javascript'} language - 言語
 */

/**
 * @typedef {Object} DOMSnapshot
 * @property {string} testId - テストID
 * @property {number} stepNumber - ステップ番号
 * @property {string} url - URL
 * @property {string} html - HTML内容
 * @property {Buffer} [screenshot] - スクリーンショット
 * @property {Date} timestamp - タイムスタンプ
 */

/**
 * @typedef {Object} TestResult
 * @property {string} testId - テストID
 * @property {'passed'|'failed'|'skipped'|'timeout'} status - ステータス
 * @property {number} duration - 実行時間
 * @property {Date} startTime - 開始時刻
 * @property {Date} endTime - 終了時刻
 * @property {TestError} [error] - エラー情報
 * @property {ScreenshotReference[]} screenshots - スクリーンショット参照
 * @property {string} [traceFile] - トレースファイル
 * @property {LogEntry[]} logs - ログエントリ
 */

/**
 * @typedef {Object} TestError
 * @property {string} message - エラーメッセージ
 * @property {string} [stack] - スタックトレース
 * @property {string} type - エラータイプ
 */

/**
 * @typedef {Object} ScreenshotReference
 * @property {string} path - ファイルパス
 * @property {ScreenshotMetadata} metadata - メタデータ
 */

/**
 * @typedef {Object} ScreenshotMetadata
 * @property {string} testId - テストID
 * @property {string} stepName - ステップ名
 * @property {Date} timestamp - タイムスタンプ
 * @property {{width: number, height: number}} viewport - ビューポート
 * @property {string} url - URL
 * @property {'step'|'failure'|'assertion'} type - タイプ
 */

/**
 * @typedef {Object} LogEntry
 * @property {Date} timestamp - タイムスタンプ
 * @property {'info'|'warn'|'error'|'debug'} level - ログレベル
 * @property {string} message - メッセージ
 * @property {Object} [context] - コンテキスト
 */

/**
 * @typedef {Object} TestReport
 * @property {string} sessionId - セッションID
 * @property {TestSummary} summary - サマリ
 * @property {TestResult[]} results - 結果
 * @property {Date} generatedAt - 生成日時
 * @property {FileManifest} fileManifest - ファイル一覧
 */

/**
 * @typedef {Object} TestSummary
 * @property {number} totalTests - 総テスト数
 * @property {number} passedTests - 成功テスト数
 * @property {number} failedTests - 失敗テスト数
 * @property {number} skippedTests - スキップテスト数
 * @property {number} totalDuration - 総実行時間
 * @property {number} successRate - 成功率
 */

/**
 * @typedef {Object} FileManifest
 * @property {string} sessionId - セッションID
 * @property {Date} generatedAt - 生成日時
 * @property {FileEntry[]} artifacts - 成果物
 * @property {FileEntry[]} results - 結果
 * @property {FileEntry[]} reports - レポート
 */

/**
 * @typedef {Object} FileEntry
 * @property {string} path - ファイルパス
 * @property {string} type - ファイルタイプ
 * @property {number} size - ファイルサイズ
 * @property {Date} createdAt - 作成日時
 * @property {string} [description] - 説明
 */

/**
 * @typedef {Object} SessionSummary
 * @property {string} sessionId - セッションID
 * @property {Date} startTime - 開始時刻
 * @property {Date} endTime - 終了時刻
 * @property {number} duration - 実行時間
 * @property {TestSummary} testSummary - テストサマリ
 * @property {FileManifest} fileManifest - ファイル一覧
 */

/**
 * @typedef {Object} DirectoryStructure
 * @property {string} artifacts - 成果物ディレクトリ
 * @property {string} results - 結果ディレクトリ
 * @property {string} reports - レポートディレクトリ
 * @property {string} screenshots - スクリーンショットディレクトリ
 * @property {string} traces - トレースディレクトリ
 * @property {string} logs - ログディレクトリ
 */

/**
 * @typedef {'test-points'|'test-cases'|'scripts'|'dom-snapshots'} ArtifactType
 */

/**
 * @typedef {'reports'|'screenshots'|'traces'|'logs'} ResultType
 */

// エクスポート（JSDocの型定義を他のファイルで使用可能にする）
export {} 