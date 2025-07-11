import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

// multerの設定（PDFとCSVアップロード用）
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // ファイルタイプに応じて保存先を変更
    let uploadsDir;
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      uploadsDir = path.join(__dirname, 'test_point');
    } else {
      uploadsDir = path.join(__dirname, 'specs');
    }
    
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    // CSVファイルの場合は固定名に変更
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, 'uploaded_TestPoint_Format.csv');
    } else {
      cb(null, file.originalname);
    }
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: function (req, file, cb) {
    // PDFとCSVファイルのみ許可
    if (file.mimetype === 'application/pdf' || 
        file.mimetype === 'text/csv' || 
        file.originalname.endsWith('.csv') ||
        file.originalname.endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('PDFまたはCSVファイルのみアップロード可能です'));
    }
  }
});

// 静的ファイルの提供
app.use(express.static('public'));
app.use(express.static(path.join(__dirname, 'test-results')));
app.use(express.json());

// ルートページでHTMLレポート一覧を表示
app.get('/', (req, res) => {
  try {
    const resultsDir = path.join(__dirname, 'test-results');
    if (!fs.existsSync(resultsDir)) {
      return res.send(`
        <html><body style="font-family:Arial,sans-serif;padding:20px;">
        <h1>🧪 AutoPlaywright</h1>
        <p>テストレポートディレクトリが見つかりません。</p>
        </body></html>
      `);
    }

    const files = fs.readdirSync(resultsDir)
      .filter(f => f.endsWith('.html') && f.startsWith('TestCoverage_'))
      .sort()
      .reverse(); // 新しい順

    const fileList = files.map(file => {
      const stat = fs.statSync(path.join(resultsDir, file));
      const date = stat.mtime.toLocaleString('ja-JP');
      return `<li><a href="/${file}">${file}</a> <span style="color:#666;">(${date})</span></li>`;
    }).join('');

    res.send(`
      <html><body style="font-family:Arial,sans-serif;padding:20px;">
        <h1>🧪 AutoPlaywright</h1>
        <h2>📊 テストカバレッジレポート</h2>
        ${files.length > 0 ? `<ul>${fileList}</ul>` : '<p>レポートファイルが見つかりません。</p>'}
        <p style="margin-top:30px;padding:15px;background:#e3f2fd;border-radius:5px;">
          💡 <strong>API機能付きサーバー</strong><br>
          このサーバーはHTMLレポート表示とAPI機能を統合しています。<br>
          HTMLレポート内の「未自動化ケース用ルート生成」ボタンが使用できます。
        </p>
      </body></html>
    `);
  } catch (error) {
    console.error('ルートページエラー:', error);
    res.status(500).send('サーバーエラー');
  }
});

// config.json読み込みAPI
app.get('/api/config', (req, res) => {
  try {
    const configPath = path.join(__dirname, 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: 'Config読み込みエラー' });
  }
});

// AI設定保存API
app.post('/api/config/ai', (req, res) => {
  try {
    const configPath = path.join(__dirname, 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    
    // AI設定を更新
    config.openai = {
      ...config.openai,
      model: req.body.model,
      temperature: req.body.temperature,
      max_tokens: req.body.max_tokens,
      top_p: req.body.top_p
    };
    
    // config.jsonに保存
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    
    console.log('🤖 AI設定を更新しました:', {
      model: req.body.model,
      temperature: req.body.temperature,
      max_tokens: req.body.max_tokens,
      top_p: req.body.top_p
    });
    
    res.json({ success: true, message: 'AI設定を保存しました' });
  } catch (error) {
    console.error('AI設定保存エラー:', error);
    res.status(500).json({ success: false, error: 'AI設定保存エラー' });
  }
});

// ユーザーストーリー情報取得API
app.get('/api/config/user-story', (req, res) => {
  try {
    const configPath = path.join(__dirname, 'config.json');
    if (!fs.existsSync(configPath)) {
      return res.json({ success: true, userStory: null });
    }
    
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    res.json({
      success: true,
      userStory: config.userStory || null
    });
  } catch (error) {
    console.error('ユーザーストーリー情報取得エラー:', error);
    res.json({
      success: false,
      error: error.message
    });
  }
});

// Google Sheets設定保存API
app.post('/api/config/sheets', (req, res) => {
  try {
    const configPath = path.join(__dirname, 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    
    // Google Sheets設定を更新
    config.googleSheets = {
      shareEmail: req.body.shareEmail,
      driveFolder: req.body.driveFolder,
      spreadsheetTitle: req.body.spreadsheetTitle,
      autoUpload: req.body.autoUpload
    };
    
    // config.jsonに保存
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    
    console.log('📈 Google Sheets設定を更新しました:', {
      shareEmail: req.body.shareEmail,
      driveFolder: req.body.driveFolder || '(未指定)',
      spreadsheetTitle: req.body.spreadsheetTitle,
      autoUpload: req.body.autoUpload
    });
    
    res.json({ success: true, message: 'Google Sheets設定を保存しました' });
  } catch (error) {
    console.error('Google Sheets設定保存エラー:', error);
    res.status(500).json({ success: false, error: 'Google Sheets設定保存エラー' });
  }
});

// ADB接続確認API
app.get('/api/adb-status', async (req, res) => {
  try {
    console.log('🔍 ADB接続状態確認開始');
    
    // adb devicesコマンドを実行
    const adbDevices = spawn('adb', ['devices'], { stdio: 'pipe' });
    let deviceOutput = '';
    
    adbDevices.stdout.on('data', (data) => {
      deviceOutput += data.toString();
    });
    
    adbDevices.on('close', async (code) => {
      if (code !== 0) {
        console.log('❌ ADB接続確認失敗: adbコマンドが見つかりません');
        return res.json({ success: false, error: 'ADBコマンドが見つかりません' });
      }
      
      // デバイス数をカウント
      const deviceLines = deviceOutput.split('\n')
        .filter(line => line.includes('\tdevice'))
        .length;
      
      console.log(`📱 検出されたAndroidデバイス: ${deviceLines}台`);
      
      if (deviceLines === 0) {
        return res.json({ 
          success: false, 
          deviceCount: 0, 
          error: 'Androidデバイスが検出されません' 
        });
      }
      
      // Chrome接続確認
      try {
        const response = await fetch('http://localhost:9222/json/version');
        const chromeInfo = await response.json();
        
        console.log('✅ Chrome接続確認成功');
        res.json({
          success: true,
          deviceCount: deviceLines,
          chromeVersion: chromeInfo['Browser'] || 'Unknown',
          chromeConnected: true
        });
      } catch (error) {
        console.log('⚠️ Chrome接続確認失敗:', error.message);
        res.json({
          success: true,
          deviceCount: deviceLines,
          chromeConnected: false,
          warning: 'ADBポートフォワードが必要です'
        });
      }
    });
    
    adbDevices.on('error', (error) => {
      console.error('❌ ADB接続確認エラー:', error);
      res.json({ success: false, error: 'ADBコマンド実行エラー' });
    });
    
  } catch (error) {
    console.error('❌ ADB接続確認エラー:', error);
    res.json({ success: false, error: error.message });
  }
});

// ADB設定API
app.post('/api/adb-setup', (req, res) => {
  try {
    console.log('🔧 ADBポートフォワード設定開始');
    
    const adbForward = spawn('adb', ['forward', 'tcp:9222', 'localabstract:chrome_devtools_remote'], { stdio: 'pipe' });
    let output = '';
    
    adbForward.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    adbForward.stderr.on('data', (data) => {
      output += data.toString();
    });
    
    adbForward.on('close', (code) => {
      if (code === 0) {
        console.log('✅ ADBポートフォワード設定完了');
        res.json({ success: true, message: 'ADBポートフォワード設定完了' });
      } else {
        console.error('❌ ADBポートフォワード設定失敗:', output);
        res.json({ success: false, error: `ADBポートフォワード設定失敗: ${output}` });
      }
    });
    
    adbForward.on('error', (error) => {
      console.error('❌ ADBポートフォワード設定エラー:', error);
      res.json({ success: false, error: 'ADBコマンド実行エラー' });
    });
    
  } catch (error) {
    console.error('❌ ADBポートフォワード設定エラー:', error);
    res.json({ success: false, error: error.message });
  }
});

// バッチ結果取得API
app.get('/api/batch-result/:batchId', (req, res) => {
  try {
    const { batchId } = req.params;
    console.log(`📊 バッチ結果取得リクエスト: ${batchId}`);
    
    // バッチ結果ファイルのパスを構築
    const batchResultPath = path.join(__dirname, 'test-results', `batch_result_${batchId}.json`);
    
    // ファイルの存在確認
    if (!fs.existsSync(batchResultPath)) {
      console.log(`❌ バッチ結果ファイルが見つかりません: ${batchResultPath}`);
      return res.status(404).json({ 
        success: false, 
        error: `バッチ結果ファイルが見つかりません: batch_result_${batchId}.json` 
      });
    }
    
    // バッチ結果ファイルを読み込み
    const batchData = JSON.parse(fs.readFileSync(batchResultPath, 'utf-8'));
    console.log(`✅ バッチ結果ファイルを正常に読み込み: ${batchId}`);
    
    res.json(batchData);
    
  } catch (error) {
    console.error('❌ バッチ結果取得エラー:', error);
    res.status(500).json({ 
      success: false, 
      error: `バッチ結果取得エラー: ${error.message}` 
    });
  }
});

// CSVファイルダウンロードAPI
app.get('/api/download-csv/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    console.log(`📥 CSVダウンロードリクエスト: ${filename}`);
    
    // ファイル名のサニタイズ（セキュリティ対策）- スペースを保持
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._\-\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF ]/g, '');
    console.log(`🔧 サニタイズ前: "${filename}"`);
    console.log(`🔧 サニタイズ後: "${sanitizedFilename}"`);
    
    // CSVファイルのパスを構築
    const csvFilePath = path.join(__dirname, 'test-results', sanitizedFilename);
    console.log(`🔧 ファイルパス: ${csvFilePath}`);
    
    // test-resultsディレクトリ内の実際のファイル一覧をチェック
    const testResultsDir = path.join(__dirname, 'test-results');
    if (fs.existsSync(testResultsDir)) {
      const files = fs.readdirSync(testResultsDir)
        .filter(f => f.includes('AutoPlaywright') && f.endsWith('.csv'));
      console.log(`🔧 利用可能なCSVファイル一覧:`, files);
      
      // 部分マッチで該当ファイルを探す
      const matchingFile = files.find(f => f.includes(sanitizedFilename.replace(/[.\-\s]/g, '')));
      if (matchingFile) {
        console.log(`🔧 部分マッチで見つかったファイル: ${matchingFile}`);
        const matchedFilePath = path.join(testResultsDir, matchingFile);
        
        // 見つかったファイルでダウンロード処理を実行
        const stats = fs.statSync(matchedFilePath);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(matchingFile)}`);
        res.setHeader('Content-Length', stats.size);
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        
        console.log(`📂 ファイル送信開始: ${matchingFile} (${stats.size} bytes)`);
        
        const fileStream = fs.createReadStream(matchedFilePath);
        fileStream.on('error', (error) => {
          console.error('❌ CSVファイル読み込みエラー:', error);
          if (!res.headersSent) {
            res.status(500).json({ 
              success: false, 
              error: `ファイル読み込みエラー: ${error.message}` 
            });
          }
        });
        
        fileStream.on('end', () => {
          console.log(`✅ CSVファイルダウンロード完了: ${matchingFile} (${stats.size} bytes)`);
        });
        
        fileStream.pipe(res);
        return;
      }
    }
    
    // ファイルの存在確認
    if (!fs.existsSync(csvFilePath)) {
      console.log(`❌ CSVファイルが見つかりません: ${csvFilePath}`);
      return res.status(404).json({ 
        success: false, 
        error: `CSVファイルが見つかりません: ${sanitizedFilename}` 
      });
    }
    
    // ファイルサイズチェック（100MB制限）
    const stats = fs.statSync(csvFilePath);
    if (stats.size > 100 * 1024 * 1024) { // 100MB
      console.log(`❌ CSVファイルが大きすぎます: ${stats.size} bytes`);
      return res.status(413).json({ 
        success: false, 
        error: 'ファイルサイズが大きすぎます（100MB制限）' 
      });
    }
    
    // Chrome対応：適切なヘッダーを設定
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(sanitizedFilename)}`);
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    // CORS対応（必要に応じて）
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    console.log(`📂 ファイル送信開始: ${sanitizedFilename} (${stats.size} bytes)`);
    
    // ファイルストリームを作成してレスポンス
    const fileStream = fs.createReadStream(csvFilePath);
    
    fileStream.on('error', (error) => {
      console.error('❌ CSVファイル読み込みエラー:', error);
      if (!res.headersSent) {
        res.status(500).json({ 
          success: false, 
          error: `ファイル読み込みエラー: ${error.message}` 
        });
      }
    });
    
    fileStream.on('end', () => {
      console.log(`✅ CSVファイルダウンロード完了: ${sanitizedFilename} (${stats.size} bytes)`);
    });
    
    // ストリームをレスポンスにパイプ
    fileStream.pipe(res);
    
  } catch (error) {
    console.error('❌ CSVダウンロードエラー:', error);
    if (!res.headersSent) {
      res.status(500).json({ 
        success: false, 
        error: `CSVダウンロードエラー: ${error.message}` 
      });
    }
  }
});

// 最新バッチ結果取得API
app.get('/api/get-latest-batch-result', (req, res) => {
  try {
    console.log('📊 最新バッチ結果取得リクエスト');
    
    const testResultsDir = path.join(__dirname, 'test-results');
    if (!fs.existsSync(testResultsDir)) {
      return res.json({
        success: false,
        error: 'test-resultsディレクトリが見つかりません'
      });
    }
    
    // batch_result_*.jsonファイルを検索
    const files = fs.readdirSync(testResultsDir)
      .filter(f => f.startsWith('batch_result_') && f.endsWith('.json'))
      .sort()
      .reverse(); // 新しい順
    
    if (files.length === 0) {
      return res.json({
        success: false,
        error: 'バッチ結果ファイルが見つかりません'
      });
    }
    
    const latestFile = files[0];
    const filePath = path.join(testResultsDir, latestFile);
    
    console.log(`📊 最新バッチ結果ファイル: ${latestFile}`);
    
    // ファイルを読み込み
    const batchData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    
    res.json({
      success: true,
      batchResult: batchData,
      filename: latestFile
    });
    
  } catch (error) {
    console.error('❌ 最新バッチ結果取得エラー:', error);
    res.status(500).json({
      success: false,
      error: `最新バッチ結果取得エラー: ${error.message}`
    });
  }
});

// Google Sheets接続テストAPI
app.post('/api/sheets/test', (req, res) => {
  const { shareEmail, driveFolder } = req.body;
  
  try {
    // Google Sheetsアップロードスクリプトを実行
    let args = ['tests/uploadToGoogleSheets.js', '--verbose'];
    
    if (shareEmail) {
      args.push('--share-email', shareEmail);
    }
    
    if (driveFolder) {
      args.push('--drive-folder', driveFolder);
    }
    
    // テスト用のタイトル
    args.push('--title', 'AutoPlaywright 接続テスト');
    
    console.log(`Google Sheets接続テスト実行: node ${args.join(' ')}`);
    
    const child = spawn('node', args, {
      cwd: __dirname,
      env: { ...process.env }
    });
    
    let output = '';
    let errorOutput = '';
    
    child.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      console.log('SHEETS TEST STDOUT:', text);
    });
    
    child.stderr.on('data', (data) => {
      const text = data.toString();
      errorOutput += text;
      console.error('SHEETS TEST STDERR:', text);
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        // スプレッドシートURLを出力から抽出
        const urlMatch = output.match(/🔗 スプレッドシートURL: (https:\/\/docs\.google\.com\/spreadsheets\/d\/[^\/]+\/edit)/);
        const spreadsheetUrl = urlMatch ? urlMatch[1] : null;
        
        res.json({
          success: true,
          message: 'Google Sheets接続テスト成功',
          output: output.trim(),
          spreadsheetUrl: spreadsheetUrl
        });
      } else {
        res.json({
          success: false,
          error: errorOutput || `接続テストがエラーコード${code}で終了しました`,
          output: output.trim()
        });
      }
    });
    
    child.on('error', (error) => {
      console.error('Google Sheets接続テストエラー:', error);
      res.json({
        success: false,
        error: `接続テストエラー: ${error.message}`
      });
    });
    
  } catch (error) {
    console.error('Google Sheets接続テストAPI実行エラー:', error);
    res.json({
      success: false,
      error: error.message
    });
  }
});

// JSONコマンド実行API（修正ルート実行用）
app.post('/api/execute-json', express.json(), async (req, res) => {
  const { command, routeId } = req.body;
  
  try {
    console.log('📋 JSON API リクエスト受信:', { command, routeId });
    
    // コマンドの実行
    let args = [];
    
    switch (command) {
        case 'runFixedRoute':
            args = ['tests/runScenarios.js'];
            if (routeId) args.push('--route-file', `${routeId}.json`);
            break;
            
        default:
            console.log(`🚨 [DEBUG-1] 未知のコマンドです - API: /api/execute-json, Command: "${command}", Body:`, JSON.stringify(req.body, null, 2));
            return res.status(400).json({ success: false, error: '未知のコマンドです' });
    }
    
    console.log(`実行コマンド: node ${args.join(' ')}`);
    
    // Node.jsプロセスを実行
    const child = spawn('node', args, {
      cwd: __dirname,
      env: { ...process.env }
    });
    
    let output = '';
    let errorOutput = '';
    
    child.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      console.log('STDOUT:', text);
    });
    
    child.stderr.on('data', (data) => {
      const text = data.toString();
      errorOutput += text;
      console.error('STDERR:', text);
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        let finalOutput = output.trim();
        let htmlReportUrl = null;
        let htmlReportFile = null;
        
        // テストレポート生成後、HTMLレポートURLを出力から抽出
        if (command === 'generateTestReport') {
          try {
            // 出力からHTMLファイル名を抽出
            const htmlFileMatch = finalOutput.match(/HTMLレポート: (TestCoverage_.*?\.html)/);
            if (htmlFileMatch) {
              htmlReportFile = htmlFileMatch[1];
              htmlReportUrl = `http://localhost:3001/${htmlReportFile}`;
              console.log('🛠️ [Debug] Found HTML report from output:', htmlReportFile);
            } else {
              console.log('🛠️ [Debug] No HTML report found in output');
              console.log('🛠️ [Debug] Output sample:', finalOutput.substring(0, 500));
            }
          } catch (error) {
            console.error('HTMLレポート抽出エラー:', error);
          }
        }
        
        res.json({
          success: true,
          output: finalOutput,
          command: command,
          htmlReportUrl: htmlReportUrl,
          htmlReportFile: htmlReportFile
        });
      } else {
        res.json({
          success: false,
          error: errorOutput || `コマンドがエラーコード${code}で終了しました`,
          output: output.trim()
        });
      }
    });
    
    child.on('error', (error) => {
      console.error('プロセス実行エラー:', error);
      res.json({
        success: false,
        error: `プロセス実行エラー: ${error.message}`
      });
    });
    
  } catch (error) {
    console.error('JSON API実行エラー:', error);
    res.json({
      success: false,
      error: error.message
    });
  }
});

// コマンド実行API（従来のFormData用）
app.post('/api/execute', upload.fields([{name: 'pdf', maxCount: 1}, {name: 'csv', maxCount: 1}]), async (req, res) => {
  const { command, url, goal, routeId, executionEnvironment, domAnalysisSource } = req.body;
  const files = req.files || {};
  const pdfFile = files.pdf ? files.pdf[0] : null;
  const csvFile = files.csv ? files.csv[0] : null;
  
  console.log('🌐 [DEBUG] FormData API リクエスト受信:', { command, url: url ? '(設定済み)' : '(未設定)', goal: goal ? '(設定済み)' : '(未設定)', routeId, executionEnvironment, domAnalysisSource });
  
  // 環境設定を表示
  console.log('🌐 実行環境設定:', {
    executionEnvironment: executionEnvironment || 'pc',
    domAnalysisSource: domAnalysisSource || 'pc'
  });
  
  try {
    // 設定ファイルにユーザーストーリー情報を保存（トレーサビリティのため）
    if (url || goal) {
      const configPath = path.join(__dirname, 'config.json');
      let config = {};
      
      try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      } catch (error) {
        console.log('設定ファイルを新規作成します');
      }
      
      // URL更新
      if (url && url.trim()) {
        config.targetUrl = url.trim();
      }
      
      // ユーザーストーリー情報の保存（トレーサビリティ確保のため）
      if (goal && goal.trim()) {
        if (!config.userStory) {
          config.userStory = {};
        }
        
        // 新しいユーザーストーリーの場合、IDを採番
        const currentStory = goal.trim();
        if (config.userStory.content !== currentStory) {
          // ユーザーストーリーが変更された場合、新しいIDを採番
          const newId = config.userStory.currentId ? config.userStory.currentId + 1 : 1;
          
          config.userStory = {
            currentId: newId,
            content: currentStory,
            timestamp: new Date().toISOString(),
            history: config.userStory.history || []
          };
          
          // 履歴に追加（最新10件まで保持）
          if (config.userStory.history.length >= 10) {
            config.userStory.history.shift();
          }
          config.userStory.history.push({
            id: newId,
            content: currentStory,
            timestamp: new Date().toISOString()
          });
          
          console.log(`📝 ユーザーストーリーID ${newId} を採番しました: ${currentStory.substring(0, 50)}...`);
        }
      }
      
      // 設定ファイルを保存
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    }
    // コマンドの実行
    let commandName = command;
    let args = [];
    
    console.log(`🔍 [DEBUG] 受信したコマンド名: "${commandName}" (type: ${typeof commandName})`);
    console.log(`🔍 [DEBUG] リクエストボディ全体:`, JSON.stringify(req.body, null, 2));
    
    // 🔧 コマンド名のサニタイズ
    if (commandName) {
        commandName = commandName.toString().trim();
        console.log(`🔍 [DEBUG] サニタイズ後: "${commandName}"`);
    }
    
    // 🔧 よくある問題の自動修正
    if (!commandName || commandName === '' || commandName === 'undefined') {
        console.log(`🚨 [DEBUG] 空のコマンド名を受信しました`);
        return res.status(400).json({ success: false, error: 'コマンド名が指定されていません' });
    }
    
    // 🔧 コマンド名の正規化（よくある間違いを修正）
    const commandMapping = {
        'generateSmartRoutes': 'generateSmartScenarios',  // 旧名称→新名称
        'generateRoutes': 'generateSmartScenarios',       // 旧名称→新名称
        'runRoutes': 'runScenarios',                      // 旧名称→新名称
        'Playwright用に変換': 'generateSmartScenarios',    // 日本語名→コマンド名
        'テスト実行': 'runScenarios',                      // 日本語名→コマンド名
        'テスト観点生成': 'generateTestPoints',             // 日本語名→コマンド名
        'テストケース生成': 'generateTestCases',            // 日本語名→コマンド名
        'レポート生成': 'generateTestReport'               // 日本語名→コマンド名
    };
    
    if (commandMapping[commandName]) {
        console.log(`🔄 [DEBUG] コマンド名を変換: "${commandName}" → "${commandMapping[commandName]}"`);
        commandName = commandMapping[commandName];
    }

    switch (commandName) {
        case 'generateTestPoints':
            args = ['tests/generateTestPoints.js'];
            if (url) args.push('--url', url);
            if (goal) args.push('--goal', goal);
            if (pdfFile) args.push('--spec-pdf', pdfFile.path);
            break;

        case 'generateTestCases':
            args = ['tests/generateTestCases.js'];
            // 最新のtestPoints_*.jsonファイルを自動で探す
            const testResultsDir = path.join(__dirname, 'test-results');
            try {
                const files = fs.readdirSync(testResultsDir);
                const testPointsFiles = files
                    .filter(f => f.startsWith('testPoints_') && f.endsWith('.json'))
                    .sort()
                    .reverse();
                if (testPointsFiles.length > 0) {
                    const latestTestPoints = testPointsFiles[0]; // ファイル名のみ
                    args.push('--test-points', latestTestPoints);
                    console.log(`📊 最新のテスト観点ファイルを使用: ${testPointsFiles[0]}`);
                } else {
                    return res.status(400).json({ success: false, error: 'テスト観点ファイルが見つかりません。先にテスト観点生成を実行してください。' });
                }
            } catch (error) {
                console.warn('⚠️ テスト観点ファイルの自動検索に失敗:', error.message);
                return res.status(400).json({ success: false, error: 'テスト観点ファイルの検索に失敗しました。' });
            }
            
            // URL、ユーザーストーリー、PDFファイル情報を追加
            if (url) args.push('--url', url);
            if (goal) args.push('--goal', goal);
            if (pdfFile) args.push('--spec-pdf', pdfFile.path);
            break;

        case 'generateSmartRoutes':
            args = ['tests/generateSmartScenarios.js'];
            if (url) args.push('--url', url);
            if (goal) args.push('--goal', goal);
            if (pdfFile) args.push('--spec-pdf', pdfFile.path);
            if (csvFile) args.push('--test-csv', csvFile.path);
            
            // 自然言語テストケースファイルが存在する場合は自動使用（詳細版を優先してtest_dataを確保）
            const testResultsDir2 = path.join(__dirname, 'test-results');
            try {
                const files = fs.readdirSync(testResultsDir2);
                
                // 🎯 詳細版（カテゴリ別）を最優先で検索（test_dataが含まれているため）
                let naturalTestCasesFiles = files
                    .filter(f => f.startsWith('naturalLanguageTestCases_') && (f.includes('_入力.json') || f.includes('_表示.json') || f.includes('_操作.json')))
                    .sort()
                    .reverse();
                
                // 詳細版が見つからない場合はindex版を検索
                if (naturalTestCasesFiles.length === 0) {
                    naturalTestCasesFiles = files
                        .filter(f => f.startsWith('naturalLanguageTestCases_') && f.includes('_index.json'))
                        .sort()
                        .reverse();
                }
                
                // それでも見つからない場合は軽量版を検索
                if (naturalTestCasesFiles.length === 0) {
                    naturalTestCasesFiles = files
                        .filter(f => f.startsWith('naturalLanguageTestCases_') && f.includes('_compact.json'))
                        .sort()
                        .reverse();
                }
                
                if (naturalTestCasesFiles.length > 0) {
                    const latestNaturalTestCases = path.join(testResultsDir2, naturalTestCasesFiles[0]);
                    args.push('--natural-test-cases', latestNaturalTestCases);
                    console.log(`🧠 最新の自然言語テストケースファイルを使用: ${naturalTestCasesFiles[0]} (test_data含有版を優先)`);
                }
            } catch (error) {
                console.warn('⚠️ 自然言語テストケースファイルの自動検索に失敗:', error.message);
            }
            break;
        case 'generateSmartScenarios':
            args = ['tests/generateSmartScenarios.js'];
            if (url) args.push('--url', url);
            if (goal) args.push('--goal', goal);
            if (pdfFile) args.push('--spec-pdf', pdfFile.path);
            if (csvFile) args.push('--test-csv', csvFile.path);
            
            // 自然言語テストケースファイルが存在する場合は自動使用（詳細版を優先してtest_dataを確保）
            const testResultsDir3 = path.join(__dirname, 'test-results');
            try {
                const files = fs.readdirSync(testResultsDir3);
                
                // 🎯 詳細版（カテゴリ別）を最優先で検索（test_dataが含まれているため）
                let naturalTestCasesFiles = files
                    .filter(f => f.startsWith('naturalLanguageTestCases_') && (f.includes('_入力.json') || f.includes('_表示.json') || f.includes('_操作.json')))
                    .sort()
                    .reverse();
                
                // 詳細版が見つからない場合はindex版を検索
                if (naturalTestCasesFiles.length === 0) {
                    naturalTestCasesFiles = files
                        .filter(f => f.startsWith('naturalLanguageTestCases_') && f.includes('_index.json'))
                        .sort()
                        .reverse();
                }
                
                // それでも見つからない場合は軽量版を検索
                if (naturalTestCasesFiles.length === 0) {
                    naturalTestCasesFiles = files
                        .filter(f => f.startsWith('naturalLanguageTestCases_') && f.includes('_compact.json'))
                        .sort()
                        .reverse();
                }
                
                if (naturalTestCasesFiles.length > 0) {
                    const latestNaturalTestCases = path.join(testResultsDir3, naturalTestCasesFiles[0]);
                    args.push('--natural-test-cases', latestNaturalTestCases);
                    console.log(`🧠 最新の自然言語テストケースファイルを使用: ${naturalTestCasesFiles[0]} (test_data含有版を優先)`);
                }
            } catch (error) {
                console.warn('⚠️ 自然言語テストケースファイルの自動検索に失敗:', error.message);
            }
            break;
            
        case 'generateSmartScenariosAll':
            args = ['tests/generateSmartScenarios.js'];
            if (url) args.push('--url', url);
            if (goal) args.push('--goal', goal);
            if (pdfFile) args.push('--spec-pdf', pdfFile.path);
            if (csvFile) args.push('--test-csv', csvFile.path);
            
            // インデックスファイルを自動検索して全カテゴリ一括生成
            const testResultsDir4 = path.join(__dirname, 'test-results');
            try {
                const files = fs.readdirSync(testResultsDir4);
                
                // 🎯 インデックスファイルを最優先で検索（全カテゴリ一括生成用）
                let indexFiles = files
                    .filter(f => f.startsWith('naturalLanguageTestCases_') && f.includes('_index.json'))
                    .sort()
                    .reverse();
                
                if (indexFiles.length > 0) {
                    const latestIndexFile = path.join(testResultsDir4, indexFiles[0]);
                    args.push('--natural-test-cases', latestIndexFile);
                    console.log(`🚀 全カテゴリ一括生成: インデックスファイルを使用: ${indexFiles[0]}`);
                } else {
                    console.warn('⚠️ インデックスファイルが見つかりません。先にテストケース生成を実行してください。');
                }
            } catch (error) {
                console.warn('⚠️ インデックスファイルの自動検索に失敗:', error.message);
            }
            break;

        case 'runRoutes':
            args = ['tests/runScenarios.js'];
            break;
        case 'runScenarios':
            args = ['tests/runScenarios.js'];
            break;
        case 'runRoutesJson':
            args = ['tests/runScenarios.js'];
            break;
            
        case 'runBatchSequential':
            args = ['tests/runScenarios.js'];
            
            // 最新のバッチメタデータファイルを自動検索
            const testResultsDir5 = path.join(__dirname, 'test-results');
            try {
                const files = fs.readdirSync(testResultsDir5);
                
                // バッチメタデータファイルを検索
                let batchMetadataFiles = files
                    .filter(f => f.startsWith('batch_metadata_') && f.endsWith('.json'))
                    .sort()
                    .reverse();
                
                if (batchMetadataFiles.length > 0) {
                    const latestBatchMetadata = path.join(testResultsDir5, batchMetadataFiles[0]);
                    args.push('--batch-metadata', latestBatchMetadata);
                    console.log(`🚀 バッチ順次実行: メタデータファイルを使用: ${batchMetadataFiles[0]}`);
                } else {
                    console.warn('⚠️ バッチメタデータファイルが見つかりません。先に「全カテゴリ一括変換」を実行してください。');
                }
            } catch (error) {
                console.warn('⚠️ バッチメタデータファイルの自動検索に失敗:', error.message);
            }
            break;

        case 'generateTestReport':
            args = ['tests/generateTestReport.js'];
            if (url) args.push('--url', url);
            if (goal) args.push('--goal', goal);
            if (pdfFile) args.push('--spec-pdf', pdfFile.path);
            if (csvFile) args.push('--test-csv', csvFile.path);
            break;

        case 'analyzeFailures':
            args = ['tests/analyzeFailures.js'];
            if (url) args.push('--url', url);
            if (goal) args.push('--goal', goal);
            if (pdfFile) args.push('--spec-pdf', pdfFile.path);
            if (csvFile) args.push('--test-csv', csvFile.path);
            
            // AI修正オプションの処理
            const enableAIFix = req.body.enableAIFix === 'true';
            if (enableAIFix) {
                args.push('--enable-ai');
                console.log('🤖 AI修正モードが有効化されました');
            } else {
                console.log('🔧 ルールベース修正モードで実行します（コスト削減・安定性重視）');
            }
            
            // 手動セレクタ設定の処理
            if (req.body.manualSelectors) {
                try {
                    const manualSelectors = JSON.parse(req.body.manualSelectors);
                    args.push('--manual-selectors', JSON.stringify(manualSelectors));
                    console.log('🎯 手動セレクタ設定が有効化されました:', Object.keys(manualSelectors).length, 'カテゴリ');
                } catch (error) {
                    console.error('⚠️ 手動セレクタ設定の解析エラー:', error.message);
                }
            }
            break;

        case 'discoverNewStories':
            args = ['tests/discoverNewStories.js'];
            if (url) args.push('--url', url);
            break;

        case 'runFixedRoute':
            args = ['tests/runScenarios.js'];
            if (routeId) args.push('--route-file', `${routeId}.json`);
            break;

        default:
            console.log(`🚨 [DEBUG-2] 未知のコマンドです - API: /api/execute, Command: "${commandName}", Body:`, JSON.stringify(req.body, null, 2));
            return res.status(400).json({ success: false, error: '未知のコマンドです' });
    }
    
    console.log(`実行コマンド: node ${args.join(' ')}`);
    
    // Node.jsプロセスを実行
    const child = spawn('node', args, {
      cwd: __dirname,
      env: { ...process.env }
    });
    
    let output = '';
    let errorOutput = '';
    
    child.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      console.log('STDOUT:', text);
    });
    
    child.stderr.on('data', (data) => {
      const text = data.toString();
      errorOutput += text;
      console.error('STDERR:', text);
    });
    
    child.on('close', async (code) => {
      if (code === 0) {
        let finalOutput = output.trim();
        
        // テストレポート生成後、HTMLレポートを優先表示
        console.log('🛠️ [Debug] Command check:', command, 'equals generateTestReport?', command === 'generateTestReport');
        if (command === 'generateTestReport') {
          try {
            // ファイルシステムから最新のHTMLレポートを検索
            const testResultsDir = path.join(__dirname, 'test-results');
            console.log('🛠️ [Debug] Test results dir:', testResultsDir);
            console.log('🛠️ [Debug] Directory exists:', fs.existsSync(testResultsDir));
            if (fs.existsSync(testResultsDir)) {
              const files = fs.readdirSync(testResultsDir);
              console.log('🛠️ [Debug] All files:', files.length);
              const htmlReports = files.filter(f => f.startsWith('TestCoverage_') && f.endsWith('.html'))
                                      .map(f => {
                                        const filePath = path.join(testResultsDir, f);
                                        const stats = fs.statSync(filePath);
                                        return { name: f, mtime: stats.mtime };
                                      })
                                      .sort((a, b) => b.mtime - a.mtime); // 最新のファイルを先頭に
              
              console.log('🛠️ [Debug] HTML reports found:', htmlReports.length);
              if (htmlReports.length > 0) {
                console.log('🛠️ [Debug] Latest HTML report:', htmlReports[0].name);
                const latestHtmlReport = htmlReports[0].name;
                const htmlReportUrl = `http://localhost:3001/${latestHtmlReport}`;
                
                finalOutput += `\n\n📊 HTMLテストレポートが生成されました！`;
                finalOutput += `\n🔗 レポートURL: ${htmlReportUrl}`;
                finalOutput += `\n📁 ファイル: ${latestHtmlReport}`;
                finalOutput += `\n\n💡 簡易Webサーバーでレポートを確認:`;
                finalOutput += `\n   node tests/utils/simpleWebServer.js 3001`;
                
                console.log('🛠️ [Debug] Sending response with HTML URL:', htmlReportUrl);
                res.json({
                  success: true,
                  output: finalOutput,
                  command: command,
                  htmlReportUrl: htmlReportUrl,
                  htmlReportFile: latestHtmlReport,
                  debug: {
                    testResultsDir: testResultsDir,
                    filesCount: files.length,
                    htmlReportsCount: htmlReports.length,
                    latestFile: latestHtmlReport
                  }
                });
                return;
              } else {
                console.log('🛠️ [Debug] No HTML reports found');
                finalOutput += `\n\n⚠️ HTMLレポートが見つかりませんでした`;
              }
            }
            
          } catch (configError) {
            console.error('設定読み込みエラー:', configError);
            finalOutput += `\n\n⚠️ 設定読み込みエラー: ${configError.message}`;
          }
        }
        
        res.json({
          success: true,
          output: finalOutput,
          command: command,
          commandName: command,
          debugInfo: `Command: ${command}, CommandName: ${command}, Match: ${command === 'generateTestReport'}`
        });
      } else {
        res.json({
          success: false,
          error: errorOutput || `コマンドがエラーコード${code}で終了しました`,
          output: output.trim()
        });
      }
    });
    
    child.on('error', (error) => {
      console.error('プロセス実行エラー:', error);
      res.json({
        success: false,
        error: `プロセス実行エラー: ${error.message}`
      });
    });
    
  } catch (error) {
    console.error('API実行エラー:', error);
    res.json({
      success: false,
      error: error.message
    });
  }
});

// 結果ファイル一覧API
app.get('/api/results', (req, res) => {
  try {
    const resultsDir = path.join(__dirname, 'test-results');
    if (!fs.existsSync(resultsDir)) {
      return res.json({ files: [] });
    }
    
    const files = fs.readdirSync(resultsDir)
      .filter(file => file.endsWith('.json') || file.endsWith('.csv'))
      .map(file => {
        const filePath = path.join(resultsDir, file);
        const stats = fs.statSync(filePath);
        return {
          name: file,
          size: stats.size,
          modified: stats.mtime.toISOString()
        };
      })
      .sort((a, b) => new Date(b.modified) - new Date(a.modified));
    
    res.json({ files });
  } catch (error) {
    res.status(500).json({ error: 'ファイル一覧取得エラー' });
  }
});

// 結果ファイルダウンロードAPI
app.get('/api/results/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, 'test-results', filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'ファイルが見つかりません' });
    }
    
    res.download(filePath);
  } catch (error) {
    res.status(500).json({ error: 'ファイルダウンロードエラー' });
  }
});

// パターンによるファイル一覧取得API
app.get('/api/list-files', (req, res) => {
  try {
    const pattern = req.query.pattern;
    const resultsDir = path.join(__dirname, 'test-results');
    
    if (!fs.existsSync(resultsDir)) {
      return res.json({ success: true, files: [] });
    }
    
    const files = fs.readdirSync(resultsDir);
    let filteredFiles = files;
    
    // パターンマッチング
    if (pattern) {
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      filteredFiles = files.filter(file => regex.test(file));
    }
    
    // 日付順でソート（新しい順）
    filteredFiles.sort((a, b) => {
      const aPath = path.join(resultsDir, a);
      const bPath = path.join(resultsDir, b);
      const aStats = fs.statSync(aPath);
      const bStats = fs.statSync(bPath);
      return bStats.mtime - aStats.mtime;
    });
    
    res.json({ success: true, files: filteredFiles });
  } catch (error) {
    console.error('ファイル一覧取得エラー:', error);
    res.json({ success: false, error: 'ファイル一覧取得エラー' });
  }
});

// ファイル内容取得API
app.get('/api/get-file', (req, res) => {
  try {
    const filePath = req.query.path;
    const fullPath = path.join(__dirname, 'test-results', filePath);
    
    if (!fs.existsSync(fullPath)) {
      return res.json({ success: false, error: 'ファイルが見つかりません' });
    }
    
    const content = fs.readFileSync(fullPath, 'utf-8');
    res.json({ success: true, content: content });
  } catch (error) {
    console.error('ファイル取得エラー:', error);
    res.json({ success: false, error: 'ファイル取得エラー' });
  }
});

// ユーザーストーリー設定取得API
app.get('/api/config/user-story', (req, res) => {
  try {
    const configPath = path.join(__dirname, 'config.json');
    
    if (!fs.existsSync(configPath)) {
      return res.json({ 
        success: true, 
        userStory: { currentId: null } 
      });
    }
    
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    res.json({ 
      success: true, 
      userStory: config.userStory || { currentId: null } 
    });
  } catch (error) {
    console.error('ユーザーストーリー設定取得エラー:', error);
    res.json({ success: false, error: 'ユーザーストーリー設定取得エラー' });
  }
});

// ユーザーストーリーIDリセットAPI (後方互換性維持)
app.post('/api/config/user-story/reset', (req, res) => {
  try {
    const configPath = path.join(__dirname, 'config.json');
    let config = {};
    
    // 既存の設定を読み込み
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
    
    // ユーザーストーリー設定をリセット
    config.userStory = {
      currentId: null,
      resetAt: new Date().toISOString()
    };
    
    // 設定を保存
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    
    res.json({ 
      success: true, 
      message: 'トレーサビリティIDをリセットしました',
      userStory: config.userStory
    });
    
    console.log('🔄 トレーサビリティIDをリセットしました');
  } catch (error) {
    console.error('ユーザーストーリーIDリセットエラー:', error);
    res.json({ success: false, error: 'ユーザーストーリーIDリセットエラー' });
  }
});

// テスト履歴リセットAPI（累積カバレッジリセット）
app.post('/api/reset-test-history', (req, res) => {
  try {
    const configPath = path.join(__dirname, 'config.json');
    const resultsDir = path.join(__dirname, 'test-results');
    
    let deletedResults = 0;
    let deletedRoutes = 0;
    let deletedReports = 0;
    
    // test-resultsディレクトリのテスト履歴ファイルを削除
    if (fs.existsSync(resultsDir)) {
      const files = fs.readdirSync(resultsDir);
      
      files.forEach(file => {
        const filePath = path.join(resultsDir, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isFile()) {
          // リセット対象のファイルを判定
          if (file.startsWith('result_') && file.endsWith('.json')) {
            fs.unlinkSync(filePath);
            deletedResults++;
          } else if (file.startsWith('route_') && file.endsWith('.json')) {
            fs.unlinkSync(filePath);
            deletedRoutes++;
          } else if (file.startsWith('fixed_route_') && file.endsWith('.json')) {
            fs.unlinkSync(filePath);
            deletedRoutes++;
          } else if (file.startsWith('TestCoverage_') && (file.endsWith('.html') || file.endsWith('.csv') || file.endsWith('.json'))) {
            fs.unlinkSync(filePath);
            deletedReports++;
          } else if (file.startsWith('AutoPlaywright テスト結果') && file.endsWith('.csv')) {
            fs.unlinkSync(filePath);
            deletedReports++;
          }
        }
      });
    }
    
    // config.jsonのユーザーストーリー設定もリセット
    let config = {};
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
    
    config.userStory = {
      currentId: null,
      resetAt: new Date().toISOString(),
      testCycleReset: true
    };
    
    // .last-run.jsonもリセット（最後の実行情報）
    const lastRunPath = path.join(resultsDir, '.last-run.json');
    if (fs.existsSync(lastRunPath)) {
      fs.unlinkSync(lastRunPath);
    }
    
    // 設定を保存
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    
    res.json({ 
      success: true, 
      message: 'テスト履歴をリセットしました',
      deletedResults: deletedResults,
      deletedRoutes: deletedRoutes,
      deletedReports: deletedReports,
      resetAt: config.userStory.resetAt
    });
    
    console.log(`🔄 テスト履歴リセット完了: 結果${deletedResults}件, ルート${deletedRoutes}件, レポート${deletedReports}件`);
  } catch (error) {
    console.error('テスト履歴リセットエラー:', error);
    res.json({ success: false, error: 'テスト履歴リセットエラー' });
  }
});

// 修正ルートチェックAPI
app.get('/api/check-fixed-routes', (req, res) => {
  try {
    const resultsDir = path.join(__dirname, 'test-results');
    
    if (!fs.existsSync(resultsDir)) {
      return res.json({ success: true, hasFixedRoutes: false });
    }
    
    const files = fs.readdirSync(resultsDir);
    const fixedRouteFiles = files.filter(file => file.startsWith('fixed_route_'));
    
    if (fixedRouteFiles.length === 0) {
      return res.json({ success: true, hasFixedRoutes: false });
    }
    
    // 最新の修正ルートファイルを取得
    fixedRouteFiles.sort((a, b) => {
      const aPath = path.join(resultsDir, a);
      const bPath = path.join(resultsDir, b);
      const aStats = fs.statSync(aPath);
      const bStats = fs.statSync(bPath);
      return bStats.mtime - aStats.mtime;
    });
    
    const latestFile = fixedRouteFiles[0];
    const routeId = latestFile.replace('.json', '');
    
    res.json({ 
      success: true, 
      hasFixedRoutes: true,
      latestFixedRoute: routeId,
      totalFixedRoutes: fixedRouteFiles.length
    });
    
  } catch (error) {
    console.error('修正ルートチェックエラー:', error);
    res.json({ success: false, error: '修正ルートチェックエラー' });
  }
});

// 未自動化ケース用ルート生成API
app.post('/api/generate-routes-unautomated', express.json(), async (req, res) => {
  console.log('📋 未自動化ケース用ルート生成リクエストを受信');
  
  try {
    const { unautomatedCount } = req.body;
    console.log(`🎯 未自動化ケース数: ${unautomatedCount}件`);
    
    // 最新の自然言語テストケースファイルを探す
    const resultsDir = path.join(__dirname, 'test-results');
    const naturalLanguageFiles = fs.readdirSync(resultsDir)
      .filter(f => f.startsWith('naturalLanguageTestCases_') && f.endsWith('.json'))
      .sort()
      .reverse();
    
    if (naturalLanguageFiles.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'テストケースファイルが見つかりません'
      });
    }
    
    const latestTestCaseFile = naturalLanguageFiles[0];
    console.log(`📊 使用するテストケースファイル: ${latestTestCaseFile}`);
    
    // generateScenariosForUnautomated.jsを実行
    const routesForUnautomatedPath = path.join(__dirname, 'tests', 'generateScenariosForUnautomated.js');
    
    console.log(`⚡ 未自動化ケース用シナリオ生成を実行: ${routesForUnautomatedPath}`);
    
    const child = spawn('node', [routesForUnautomatedPath], {
      stdio: 'pipe',
      env: { ...process.env, NODE_ENV: 'production' }
    });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log(`[ルート生成] ${data.toString().trim()}`);
    });
    
    child.stderr.on('data', (data) => {
      stderr += data.toString();
      console.error(`[ルート生成エラー] ${data.toString().trim()}`);
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        console.log('✅ 未自動化ケース用ルート生成完了');
        
        // 生成されたルート数を抽出
        const generatedCountMatch = stdout.match(/(\d+)件のルートを生成/);
        const generatedCount = generatedCountMatch ? parseInt(generatedCountMatch[1]) : unautomatedCount;
        
        res.json({
          success: true,
          message: '未自動化ケース用ルート生成完了',
          generatedCount: generatedCount,
          stdout: stdout.substring(0, 1000) // 最初の1000文字のみ
        });
      } else {
        console.error(`❌ 未自動化ケース用ルート生成失敗 (exit code: ${code})`);
        res.status(500).json({
          success: false,
          error: 'ルート生成プロセスが失敗しました',
          stderr: stderr.substring(0, 1000),
          stdout: stdout.substring(0, 1000)
        });
      }
    });
    
  } catch (error) {
    console.error('❌ 未自動化ケース用ルート生成エラー:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// レポート更新API
app.post('/api/refresh-report', express.json(), async (req, res) => {
  console.log('📋 レポート更新リクエストを受信');
  
  try {
    // generateTestReport.jsを実行
    const reportPath = path.join(__dirname, 'tests', 'generateTestReport.js');
    const command = `node ${reportPath}`;
    
    console.log(`🔄 レポート更新を実行: ${command}`);
    
    const child = spawn('node', [reportPath], {
      stdio: 'pipe',
      env: { ...process.env, NODE_ENV: 'production' }
    });
    
    let stdout = '';
    let stderr = '';
    let htmlReportUrl = null;
    
    child.stdout.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      console.log(`[レポート更新] ${output.trim()}`);
      
      // HTMLレポートURLを抽出
      const htmlMatch = output.match(/HTMLレポート: (TestCoverage_.*?\.html)/);
      if (htmlMatch) {
        const htmlReportFile = htmlMatch[1];
        htmlReportUrl = `http://localhost:3000/${htmlReportFile}`;
        console.log(`📊 HTMLレポートURL抽出: ${htmlReportUrl}`);
      }
    });
    
    child.stderr.on('data', (data) => {
      stderr += data.toString();
      console.error(`[レポート更新エラー] ${data.toString().trim()}`);
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        console.log('✅ レポート更新完了');
        res.json({
          success: true,
          message: 'レポート更新完了',
          htmlReportUrl: htmlReportUrl,
          stdout: stdout.substring(0, 1000)
        });
      } else {
        console.error(`❌ レポート更新失敗 (exit code: ${code})`);
        res.status(500).json({
          success: false,
          error: 'レポート更新プロセスが失敗しました',
          stderr: stderr.substring(0, 1000),
          stdout: stdout.substring(0, 1000)
        });
      }
    });
    
  } catch (error) {
    console.error('❌ レポート更新エラー:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// IPアドレス取得関数
function getLocalIPAddress() {
  const networkInterfaces = os.networkInterfaces();
  
  for (const name of Object.keys(networkInterfaces)) {
    for (const net of networkInterfaces[name]) {
      // IPv4でローカルネットワークアドレス (プライベートIP) を取得
      if (net.family === 'IPv4' && !net.internal) {
        if (net.address.startsWith('192.168.') || 
            net.address.startsWith('10.') || 
            net.address.startsWith('172.')) {
          return net.address;
        }
      }
    }
  }
  return '127.0.0.1'; // フォールバック
}

// セキュリティ設定
const ALLOW_EXTERNAL_ACCESS = process.env.ALLOW_EXTERNAL_ACCESS === 'true';
const HOST = ALLOW_EXTERNAL_ACCESS ? '0.0.0.0' : 'localhost';
const LOCAL_IP = getLocalIPAddress();

// 外部アクセス許可時の警告
if (ALLOW_EXTERNAL_ACCESS) {
  console.log('⚠️  警告: 外部アクセスが有効になっています');
  console.log('⚠️  この設定は開発環境でのみ使用してください');
  console.log('⚠️  本番環境では適切な認証とファイアウォールを設定してください');
}

// サーバー起動
app.listen(port, HOST, () => {
  console.log(`🚀 AutoPlaywright WebUI サーバーが起動しました`);
  console.log(`📱 ローカルアクセス: http://localhost:${port}`);
  
  if (ALLOW_EXTERNAL_ACCESS) {
    console.log(`📱 外部アクセス: http://${LOCAL_IP}:${port}`);
    console.log(`🔒 セキュリティ: 外部アクセス許可モード（要注意）`);
    console.log(`📱 同一ネットワーク内のデバイスからアクセス可能`);
  } else {
    console.log(`🔒 セキュリティ: ローカルのみアクセス許可`);
    console.log(`📱 スマートフォンからアクセスする場合は: ALLOW_EXTERNAL_ACCESS=true node server.js`);
    console.log(`📱 その場合のアクセスURL: http://${LOCAL_IP}:${port}`);
  }
  console.log(`📁 作業ディレクトリ: ${__dirname}`);
});

// グレースフルシャットダウン
process.on('SIGINT', () => {
  console.log('\n🛑 サーバーを停止しています...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 サーバーを停止しています...');
  process.exit(0);
});

// HTMLレポート生成API
app.post('/api/generate-html-report', (req, res) => {
  try {
    const { batchId, reportType = 'detailed' } = req.body;
    
    console.log(`📊 HTMLレポート生成リクエスト: ${batchId} (${reportType})`);
    
    const testResultsDir = path.join(__dirname, 'test-results');
    
    // バッチ結果ファイルを検索
    const batchFile = `batch_result_${batchId}.json`;
    const batchFilePath = path.join(testResultsDir, batchFile);
    
    if (!fs.existsSync(batchFilePath)) {
      return res.status(404).json({
        success: false,
        error: `バッチ結果ファイルが見つかりません: ${batchFile}`
      });
    }
    
    // バッチ結果を読み込み
    const batchData = JSON.parse(fs.readFileSync(batchFilePath, 'utf-8'));
    
    // HTMLレポートを生成
    const htmlContent = generateDetailedHTMLReport(batchData, reportType);
    
    // HTMLファイルとして保存
    const htmlFileName = `AutoPlaywright_HTMLレポート_${batchId}_${new Date().toISOString().slice(0, 16).replace(/:/g, '-')}.html`;
    const htmlFilePath = path.join(testResultsDir, htmlFileName);
    
    fs.writeFileSync(htmlFilePath, htmlContent, 'utf-8');
    
    console.log(`✅ HTMLレポート生成完了: ${htmlFileName}`);
    
    res.json({
      success: true,
      htmlFileName: htmlFileName,
      htmlFilePath: htmlFilePath,
      reportType: reportType,
      batchId: batchId
    });
    
  } catch (error) {
    console.error('❌ HTMLレポート生成エラー:', error);
    res.status(500).json({
      success: false,
      error: `HTMLレポート生成エラー: ${error.message}`
    });
  }
});

// HTMLファイルダウンロードAPI
app.get('/api/download-html/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const sanitizedFilename = path.basename(filename); // パストラバーサル攻撃を防ぐ
    
    console.log(`📥 HTMLダウンロードリクエスト: ${sanitizedFilename}`);
    
    const testResultsDir = path.join(__dirname, 'test-results');
    const htmlFilePath = path.join(testResultsDir, sanitizedFilename);
    
    // ファイルの存在確認
    if (!fs.existsSync(htmlFilePath)) {
      console.log(`❌ HTMLファイルが見つかりません: ${htmlFilePath}`);
      return res.status(404).json({ 
        success: false, 
        error: `HTMLファイルが見つかりません: ${sanitizedFilename}` 
      });
    }
    
    // ファイルサイズチェック
    const stats = fs.statSync(htmlFilePath);
    
    // HTMLファイル用のヘッダーを設定
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(sanitizedFilename)}`);
    res.setHeader('Content-Length', stats.size);
    
    console.log(`📂 HTMLファイル送信開始: ${sanitizedFilename} (${stats.size} bytes)`);
    
    // ファイルストリームを作成してレスポンス
    const fileStream = fs.createReadStream(htmlFilePath);
    fileStream.pipe(res);
    
    fileStream.on('end', () => {
      console.log(`✅ HTMLファイルダウンロード完了: ${sanitizedFilename}`);
    });
    
  } catch (error) {
    console.error('❌ HTMLダウンロードエラー:', error);
    res.status(500).json({ 
      success: false, 
      error: `HTMLダウンロードエラー: ${error.message}` 
    });
  }
});

// HTMLレポート別タブ表示API
app.get('/api/view-html/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const sanitizedFilename = path.basename(filename);
    
    console.log(`👁️ HTML別タブ表示リクエスト: ${sanitizedFilename}`);
    
    const testResultsDir = path.join(__dirname, 'test-results');
    const htmlFilePath = path.join(testResultsDir, sanitizedFilename);
    
    // ファイルの存在確認
    if (!fs.existsSync(htmlFilePath)) {
      return res.status(404).send('<h1>❌ HTMLファイルが見つかりません</h1>');
    }
    
    // HTMLファイルの内容を読み込んで直接レスポンス
    const htmlContent = fs.readFileSync(htmlFilePath, 'utf-8');
    
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(htmlContent);
    
    console.log(`✅ HTML別タブ表示完了: ${sanitizedFilename}`);
    
  } catch (error) {
    console.error('❌ HTML別タブ表示エラー:', error);
    res.status(500).send(`<h1>❌ HTML表示エラー: ${error.message}</h1>`);
  }
});

// HTMLレポート生成関数
function generateDetailedHTMLReport(batchData, reportType) {
  const currentTime = new Date().toLocaleString('ja-JP');
  
  let html = `
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AutoPlaywright バッチ実行詳細レポート - ${batchData.batch_id}</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 15px;
            padding: 30px;
            box-shadow: 0 15px 35px rgba(0,0,0,0.1);
        }
        .header {
            text-align: center;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 3px solid #007bff;
        }
        .header h1 {
            color: #007bff;
            margin-bottom: 10px;
            font-size: 2.2em;
        }
        .header .subtitle {
            color: #6c757d;
            font-size: 1.1em;
        }
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin: 30px 0;
        }
        .summary-card {
            background: linear-gradient(45deg, #f8f9fa, #e9ecef);
            padding: 20px;
            border-radius: 10px;
            text-align: center;
            border-left: 5px solid #007bff;
        }
        .summary-card h3 {
            margin: 0 0 10px 0;
            color: #495057;
            font-size: 0.9em;
        }
        .summary-card .value {
            font-size: 2em;
            font-weight: bold;
            color: #007bff;
        }
        .test-result {
            margin: 20px 0;
            border: 2px solid #dee2e6;
            border-radius: 10px;
            overflow: hidden;
        }
        .test-header {
            padding: 15px;
            color: white;
            font-weight: bold;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .test-header.success { background: #28a745; }
        .test-header.partial { background: #ffc107; }
        .test-header.failed { background: #dc3545; }
        .test-content {
            padding: 20px;
            background: #f8f9fa;
        }
        .step-list {
            max-height: 400px;
            overflow-y: auto;
            margin: 15px 0;
        }
        .step-item {
            margin: 8px 0;
            padding: 10px;
            border-radius: 5px;
            border-left: 4px solid #dee2e6;
            background: white;
            font-family: 'Courier New', monospace;
            font-size: 0.9em;
        }
        .step-item.success { border-left-color: #28a745; }
        .step-item.failed { border-left-color: #dc3545; background: #fff5f5; }
        .step-item.error { border-left-color: #dc3545; background: #fff5f5; }
        .error-details {
            margin-top: 8px;
            padding: 8px;
            background: #fff;
            border-radius: 3px;
            color: #dc3545;
            font-size: 0.85em;
            border: 1px solid #f5c6cb;
        }
        .assertion-results {
            margin: 15px 0;
            padding: 15px;
            background: white;
            border-radius: 5px;
            border: 1px solid #dee2e6;
        }
        .assertion-item {
            margin: 5px 0;
            padding: 8px;
            border-radius: 3px;
            font-size: 0.9em;
        }
        .assertion-item.success {
            background: #d4edda;
            color: #155724;
            border-left: 3px solid #28a745;
        }
        .assertion-item.failed {
            background: #f8d7da;
            color: #721c24;
            border-left: 3px solid #dc3545;
        }
        .category-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 15px;
            margin: 20px 0;
        }
        .category-card {
            padding: 15px;
            border-radius: 8px;
            text-align: center;
            border: 2px solid #dee2e6;
        }
        .category-card h4 {
            margin: 0 0 10px 0;
            color: #495057;
        }
        .progress-bar {
            width: 100%;
            height: 20px;
            background: #e9ecef;
            border-radius: 10px;
            overflow: hidden;
            margin: 10px 0;
        }
        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #28a745, #20c997);
            transition: width 0.3s ease;
        }
        .footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 2px solid #dee2e6;
            text-align: center;
            color: #6c757d;
        }
        .collapsible {
            cursor: pointer;
            padding: 10px;
            background: #e9ecef;
            border: none;
            text-align: left;
            outline: none;
            font-size: 15px;
            border-radius: 5px;
            margin: 5px 0;
            width: 100%;
        }
        .collapsible:hover {
            background: #dee2e6;
        }
        .collapsible-content {
            display: none;
            padding: 15px;
            background: #f8f9fa;
            border-radius: 0 0 5px 5px;
        }
        @media print {
            body { background: white; }
            .container { box-shadow: none; }
        }
    </style>
    <script>
        function toggleCollapsible(element) {
            const content = element.nextElementSibling;
            if (content.style.display === 'block') {
                content.style.display = 'none';
                element.textContent = element.textContent.replace('▼', '▶');
            } else {
                content.style.display = 'block';
                element.textContent = element.textContent.replace('▶', '▼');
            }
        }
        
        function expandAll() {
            const contents = document.querySelectorAll('.collapsible-content');
            const buttons = document.querySelectorAll('.collapsible');
            contents.forEach(content => content.style.display = 'block');
            buttons.forEach(button => button.textContent = button.textContent.replace('▶', '▼'));
        }
        
        function collapseAll() {
            const contents = document.querySelectorAll('.collapsible-content');
            const buttons = document.querySelectorAll('.collapsible');
            contents.forEach(content => content.style.display = 'none');
            buttons.forEach(button => button.textContent = button.textContent.replace('▼', '▶'));
        }
    </script>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 AutoPlaywright バッチ実行詳細レポート</h1>
            <div class="subtitle">
                バッチID: ${batchData.batch_id} | 生成日時: ${currentTime}
            </div>
        </div>

        <div class="summary-grid">
            <div class="summary-card">
                <h3>📊 総ルート数</h3>
                <div class="value">${batchData.total_routes || batchData.results?.length || 0}</div>
            </div>
            <div class="summary-card">
                <h3>⏱️ 実行時間</h3>
                <div class="value">${Math.round((batchData.total_execution_time || 0) / 1000)}秒</div>
            </div>
            <div class="summary-card">
                <h3>🎯 平均成功率</h3>
                <div class="value">${calculateAverageSuccessRate(batchData)}%</div>
            </div>
            <div class="summary-card">
                <h3>📅 実行日時</h3>
                <div class="value" style="font-size: 1.2em;">${new Date(batchData.executed_at).toLocaleString('ja-JP')}</div>
            </div>
        </div>

        <div style="text-align: center; margin: 20px 0;">
            <button onclick="expandAll()" style="background: #28a745; color: white; border: none; padding: 8px 16px; border-radius: 5px; margin-right: 10px; cursor: pointer;">
                ▼ すべて展開
            </button>
            <button onclick="collapseAll()" style="background: #6c757d; color: white; border: none; padding: 8px 16px; border-radius: 5px; cursor: pointer;">
                ▶ すべて折りたたみ
            </button>
        </div>

        ${generateTestResultsHTML(batchData)}

        <div class="footer">
            <p>📋 このレポートは AutoPlaywright によって自動生成されました</p>
            <p>🔗 プロジェクト: <a href="https://github.com/your-repo/autoplaywright" target="_blank">AutoPlaywright</a></p>
        </div>
    </div>
</body>
</html>
  `;

  return html;
}

// テスト結果HTML生成
function generateTestResultsHTML(batchData) {
  if (!batchData.results || batchData.results.length === 0) {
    return '<div class="test-result"><div class="test-content">テスト結果がありません</div></div>';
  }

  let html = '';

  batchData.results.forEach((result, index) => {
    const statusClass = result.status === 'success' ? 'success' : 
                       result.status === 'partial' ? 'partial' : 'failed';
    const statusIcon = result.status === 'success' ? '✅' : 
                      result.status === 'partial' ? '⚠️' : '❌';

    html += `
      <div class="test-result">
        <div class="test-header ${statusClass}">
          <span>${statusIcon} テスト ${index + 1}: ${result.category} (${result.test_case_id || 'N/A'})</span>
          <span>成功率: ${result.success_rate || 0}% | 実行時間: ${Math.round((result.execution_time || 0) / 1000)}秒</span>
        </div>
        <div class="test-content">
          
          <button class="collapsible" onclick="toggleCollapsible(this)">
            ▶ ステップ実行結果 (${result.step_results?.length || 0}件)
          </button>
          <div class="collapsible-content">
            <div class="step-list">
    `;

    // ステップ結果の表示
    if (result.step_results && result.step_results.length > 0) {
      result.step_results.forEach((step, stepIndex) => {
        const stepStatusClass = step.status === 'success' ? 'success' : 
                               step.status === 'failed' ? 'failed' : 'error';
        const stepIcon = step.status === 'success' ? '✅' : '❌';

        html += `
          <div class="step-item ${stepStatusClass}">
            <strong>${stepIcon} ステップ ${stepIndex + 1}:</strong> ${step.label || 'ラベルなし'} (${step.action || 'unknown'})
        `;

        if (step.status !== 'success' && step.error) {
          html += `
            <div class="error-details">
              <strong>エラー詳細:</strong><br>
              ${step.error.length > 300 ? step.error.substring(0, 300) + '...' : step.error}
            </div>
          `;
        }

        html += '</div>';
      });
    } else {
      html += '<div class="step-item">ステップ結果がありません</div>';
    }

    html += `
            </div>
          </div>

          <button class="collapsible" onclick="toggleCollapsible(this)">
            ▶ アサーション結果 (${result.assertion_results?.length || 0}件)
          </button>
          <div class="collapsible-content">
            <div class="assertion-results">
    `;

    // アサーション結果の表示
    if (result.assertion_results && result.assertion_results.length > 0) {
      result.assertion_results.forEach(assertion => {
        const assertionClass = assertion.status === 'success' ? 'success' : 'failed';
        const assertionIcon = assertion.status === 'success' ? '✅' : '❌';

        html += `
          <div class="assertion-item ${assertionClass}">
            ${assertionIcon} ${assertion.label || 'アサーション'} (${assertion.assertion_type || 'general'})
          </div>
        `;
      });
    } else {
      html += '<div class="assertion-item">アサーション結果がありません</div>';
    }

    html += `
            </div>
          </div>
        </div>
      </div>
    `;
  });

  return html;
}

// 平均成功率計算
function calculateAverageSuccessRate(batchData) {
  if (!batchData.results || batchData.results.length === 0) return 0;
  
  const totalRate = batchData.results.reduce((sum, result) => sum + (result.success_rate || 0), 0);
  return Math.round(totalRate / batchData.results.length);
}

// Google Sheets接続テストAPI