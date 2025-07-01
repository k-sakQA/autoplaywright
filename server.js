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
app.use(express.json());

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
            args = ['tests/runRoutes.js'];
            if (routeId) args.push('--route-file', `${routeId}.json`);
            break;
            
        default:
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
        res.json({
          success: true,
          output: output.trim(),
          command: command
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
  const { command, url, goal, routeId } = req.body;
  const files = req.files || {};
  const pdfFile = files.pdf ? files.pdf[0] : null;
  const csvFile = files.csv ? files.csv[0] : null;
  
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
            args = ['tests/generateSmartRoutes.js'];
            if (url) args.push('--url', url);
            if (goal) args.push('--goal', goal);
            if (pdfFile) args.push('--spec-pdf', pdfFile.path);
            if (csvFile) args.push('--test-csv', csvFile.path);
            
            // 自然言語テストケースファイルが存在する場合は自動使用（軽量版を優先）
            const testResultsDir2 = path.join(__dirname, 'test-results');
            try {
                const files = fs.readdirSync(testResultsDir2);
                
                // 軽量版を優先的に検索
                let naturalTestCasesFiles = files
                    .filter(f => f.startsWith('naturalLanguageTestCases_') && f.includes('_compact.json'))
                    .sort()
                    .reverse();
                
                // 軽量版が見つからない場合は従来のファイルを検索
                if (naturalTestCasesFiles.length === 0) {
                    naturalTestCasesFiles = files
                        .filter(f => f.startsWith('naturalLanguageTestCases_') && f.endsWith('.json') && !f.includes('_full.json'))
                        .sort()
                        .reverse();
                }
                
                if (naturalTestCasesFiles.length > 0) {
                    const latestNaturalTestCases = path.join(testResultsDir2, naturalTestCasesFiles[0]);
                    args.push('--natural-test-cases', latestNaturalTestCases);
                    console.log(`🧠 最新の自然言語テストケースファイルを使用: ${naturalTestCasesFiles[0]}`);
                }
            } catch (error) {
                console.warn('⚠️ 自然言語テストケースファイルの自動検索に失敗:', error.message);
            }
            break;

        case 'runRoutes':
            args = ['tests/runRoutes.js'];
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
            break;

        case 'discoverNewStories':
            args = ['tests/discoverNewStories.js'];
            if (url) args.push('--url', url);
            break;

        case 'runFixedRoute':
            args = ['tests/runRoutes.js'];
            if (routeId) args.push('--route-file', `${routeId}.json`);
            break;

        default:
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
        
        // テストレポート生成後、Google Sheets自動アップロードを確認
        if (commandName === 'generateTestReport') {
          try {
            const configPath = path.join(__dirname, 'config.json');
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            
            // Google Sheets自動アップロード設定が有効な場合
            if (config.googleSheets && config.googleSheets.autoUpload) {
              console.log('📈 Google Sheets自動アップロードを開始します...');
              
              // Google Sheetsアップロードスクリプトを実行
              let uploadArgs = ['tests/uploadToGoogleSheets.js', '--verbose'];
              
              if (config.googleSheets.shareEmail) {
                uploadArgs.push('--share-email', config.googleSheets.shareEmail);
              }
              
              if (config.googleSheets.driveFolder) {
                uploadArgs.push('--drive-folder', config.googleSheets.driveFolder);
              }
              
              if (config.googleSheets.spreadsheetTitle) {
                uploadArgs.push('--title', config.googleSheets.spreadsheetTitle);
              }
              
              console.log(`Google Sheets自動アップロード実行: node ${uploadArgs.join(' ')}`);
              
              const uploadChild = spawn('node', uploadArgs, {
                cwd: __dirname,
                env: { ...process.env }
              });
              
              let uploadOutput = '';
              let uploadError = '';
              
              uploadChild.stdout.on('data', (data) => {
                const text = data.toString();
                uploadOutput += text;
                console.log('SHEETS AUTO UPLOAD STDOUT:', text);
              });
              
              uploadChild.stderr.on('data', (data) => {
                const text = data.toString();
                uploadError += text;
                console.error('SHEETS AUTO UPLOAD STDERR:', text);
              });
              
              uploadChild.on('close', (uploadCode) => {
                if (uploadCode === 0) {
                  // スプレッドシートURLを出力から抽出
                  const urlMatch = uploadOutput.match(/🔗 スプレッドシートURL: (https:\/\/docs\.google\.com\/spreadsheets\/d\/[^\/]+\/edit)/);
                  const spreadsheetUrl = urlMatch ? urlMatch[1] : null;
                  
                  finalOutput += '\n\n📈 Google Sheets自動アップロード完了\n' + uploadOutput.trim();
                  
                  res.json({
                    success: true,
                    output: finalOutput,
                    command: command,
                    spreadsheetUrl: spreadsheetUrl
                  });
                } else {
                  finalOutput += '\n\n❌ Google Sheets自動アップロード失敗\n' + (uploadError || uploadOutput);
                  
                  res.json({
                    success: true,
                    output: finalOutput,
                    command: command,
                    uploadError: uploadError || `アップロードがエラーコード${uploadCode}で終了しました`
                  });
                }
              });
              
              uploadChild.on('error', (uploadErr) => {
                console.error('Google Sheets自動アップロードエラー:', uploadErr);
                finalOutput += '\n\n❌ Google Sheets自動アップロードエラー\n' + uploadErr.message;
                
                res.json({
                  success: true,
                  output: finalOutput,
                  command: command,
                  uploadError: uploadErr.message
                });
              });
              
              return; // 非同期処理のため、ここでreturn
            }
          } catch (configError) {
            console.error('Google Sheets設定読み込みエラー:', configError);
            finalOutput += '\n\n⚠️ Google Sheets設定読み込みエラー: ' + configError.message;
          }
        }
        
        res.json({
          success: true,
          output: finalOutput,
          command: command
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

// ユーザーストーリーIDリセットAPI
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