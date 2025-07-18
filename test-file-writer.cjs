#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const FileWriter = require('./src/output-manager/file-writer.cjs');

async function testFileWriter() {
  console.log('🧪 FileWriter テスト開始');

  try {
    const fileWriter = new FileWriter({
      baseDir: 'test-results',
      compressionEnabled: false
    });

    console.log('✅ FileWriter初期化完了');

    const testPath = path.join('test-results', 'reports', 'test-dashboard.html');
    const testContent = `
<!DOCTYPE html>
<html>
<head><title>Test Dashboard</title></head>
<body><h1>Test Dashboard</h1></body>
</html>`;

    console.log(`📝 テストファイル書き込み: ${testPath}`);
    
    const result = await fileWriter.writeText(testPath, testContent);
    console.log(`✅ ファイル書き込み成功: ${result}`);

    // ファイル存在確認
    try {
      await fs.access(testPath);
      console.log(`✅ ファイル存在確認成功: ${testPath}`);
      
      const content = await fs.readFile(testPath, 'utf8');
      console.log(`📄 ファイル内容サイズ: ${content.length}文字`);
    } catch (error) {
      console.error(`❌ ファイル存在確認失敗: ${error.message}`);
    }

  } catch (error) {
    console.error(`❌ テスト失敗: ${error.message}`);
    console.error(error.stack);
  }
}

if (require.main === module) {
  testFileWriter();
} 