#!/usr/bin/env node

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * シンプルなWebサーバー（HTMLレポート表示用）
 */
class SimpleWebServer {
  constructor(port = 3000, staticDir = null) {
    this.port = port;
    this.staticDir = staticDir || path.join(__dirname, '../../test-results');
  }

  /**
   * サーバーを開始
   */
  start() {
    const server = http.createServer((req, res) => {
      let filePath = path.join(this.staticDir, req.url === '/' ? '/index.html' : req.url);
      
      // セキュリティ: ディレクトリトラバーサル攻撃を防ぐ
      if (!filePath.startsWith(this.staticDir)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      // 存在チェック
      if (!fs.existsSync(filePath)) {
        // HTMLファイルのリストを表示
        if (req.url === '/' || req.url === '/index.html') {
          this.serveIndex(res);
          return;
        }
        
        res.writeHead(404);
        res.end('File not found');
        return;
      }

      // ファイルの拡張子からContent-Typeを決定
      const ext = path.extname(filePath).toLowerCase();
      const contentTypes = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.csv': 'text/csv',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml'
      };

      const contentType = contentTypes[ext] || 'text/plain';

      // ファイルを読み込んで返す
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(500);
          res.end('Internal Server Error');
          return;
        }

        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
      });
    });

    server.listen(this.port, () => {
      console.log(`🌐 HTMLレポートサーバー開始: http://localhost:${this.port}`);
      console.log(`📁 静的ファイルディレクトリ: ${this.staticDir}`);
      console.log(`⏹️  停止するには Ctrl+C を押してください`);
    });

    return server;
  }

  /**
   * インデックスページを生成（HTMLファイル一覧）
   */
  serveIndex(res) {
    try {
      const files = fs.readdirSync(this.staticDir);
      const htmlFiles = files.filter(file => file.endsWith('.html') && file.startsWith('TestCoverage_'));
      const csvFiles = files.filter(file => file.endsWith('.csv') && (file.startsWith('TestCoverage_') || file.startsWith('AutoPlaywright')));
      
      const indexHtml = `
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AutoPlaywright テストレポート</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            border-radius: 8px;
            padding: 30px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            text-align: center;
            margin-bottom: 30px;
        }
        .section {
            margin-bottom: 30px;
        }
        .section h2 {
            color: #666;
            font-size: 1.2em;
            margin-bottom: 15px;
            padding-bottom: 8px;
            border-bottom: 2px solid #eee;
        }
        .file-list {
            list-style: none;
            padding: 0;
        }
        .file-list li {
            margin-bottom: 10px;
        }
        .file-list a {
            display: block;
            padding: 12px 15px;
            background: #f8f9fa;
            border-radius: 6px;
            text-decoration: none;
            color: #495057;
            transition: all 0.2s ease;
        }
        .file-list a:hover {
            background: #e9ecef;
            transform: translateX(5px);
        }
        .file-date {
            font-size: 0.9em;
            color: #6c757d;
            float: right;
        }
        .no-files {
            text-align: center;
            color: #999;
            font-style: italic;
            padding: 20px;
        }
        .instructions {
            background: #e3f2fd;
            border-left: 4px solid #2196f3;
            padding: 15px;
            margin-top: 30px;
            border-radius: 4px;
        }
        .instructions h3 {
            margin: 0 0 10px 0;
            color: #1976d2;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🧪 AutoPlaywright テストレポート</h1>
        
        <div class="section">
            <h2>📊 カバレッジレポート (HTML)</h2>
            <ul class="file-list">
                ${htmlFiles.length > 0 ? htmlFiles.map(file => {
                  const stats = fs.statSync(path.join(this.staticDir, file));
                  const date = stats.mtime.toLocaleString('ja-JP');
                  return `<li><a href="/${file}">${file} <span class="file-date">${date}</span></a></li>`;
                }).join('') : '<li class="no-files">カバレッジレポートがありません</li>'}
            </ul>
        </div>
        
        <div class="section">
            <h2>📄 CSVファイル</h2>
            <ul class="file-list">
                ${csvFiles.length > 0 ? csvFiles.map(file => {
                  const stats = fs.statSync(path.join(this.staticDir, file));
                  const date = stats.mtime.toLocaleString('ja-JP');
                  return `<li><a href="/${file}" download>${file} <span class="file-date">${date}</span></a></li>`;
                }).join('') : '<li class="no-files">CSVファイルがありません</li>'}
            </ul>
        </div>
        
        <div class="instructions">
            <h3>📝 使用方法</h3>
            <p>• <strong>HTMLレポート</strong>: ブラウザで直接表示される視覚的なレポート</p>
            <p>• <strong>CSVファイル</strong>: Excel等で開けるデータファイル（ダウンロード）</p>
            <p>• このサーバーはローカル開発用です。本番環境では使用しないでください。</p>
        </div>
    </div>
</body>
</html>`;

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(indexHtml);
    } catch (error) {
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  }
}

export default SimpleWebServer;

// CLI実行時
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = process.argv[2] ? parseInt(process.argv[2]) : 3000;
  const server = new SimpleWebServer(port);
  server.start();
} 