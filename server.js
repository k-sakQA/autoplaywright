import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

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

// コマンド実行API
app.post('/api/execute', upload.fields([{name: 'pdf', maxCount: 1}, {name: 'csv', maxCount: 1}]), async (req, res) => {
  const { command, url, goal } = req.body;
  const files = req.files || {};
  const pdfFile = files.pdf ? files.pdf[0] : null;
  const csvFile = files.csv ? files.csv[0] : null;
  
  try {
    // コマンドの構築
    let args = [];
    const scriptPath = path.join(__dirname, 'tests', `${command}.js`);
    
    // URLパラメータの追加
    if (url && url.trim()) {
      args.push('--url', url.trim());
    }
    
    // テスト意図パラメータの追加
    if (goal && goal.trim()) {
      args.push('--goal', goal.trim());
    }
    
    // PDFパラメータの追加
    if (pdfFile) {
      args.push('--spec-pdf', pdfFile.path);
    }
    
    // CSVパラメータの追加
    if (csvFile) {
      args.push('--test-csv', csvFile.path);
    }
    
    console.log(`実行コマンド: node ${scriptPath} ${args.join(' ')}`);
    
    // Node.jsプロセスを実行
    const child = spawn('node', [scriptPath, ...args], {
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

// サーバー起動
app.listen(port, () => {
  console.log(`🚀 AutoPlaywright WebUI サーバーが起動しました`);
  console.log(`📱 ブラウザで http://localhost:${port} にアクセスしてください`);
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