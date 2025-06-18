import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';

export async function uploadPDFToOpenAI(filePath, openaiClient) {
  try {
    // PDFファイルの存在確認
    if (!fs.existsSync(filePath)) {
      throw new Error(`PDFファイルが見つかりません: ${filePath}`);
    }

    // ファイルの基本情報を取得
    const stats = fs.statSync(filePath);
    const fileSize = stats.size;
    
    console.log(`📄 PDFファイルをOpenAIにアップロード中: ${path.basename(filePath)}`);
    console.log(`📄 ファイルサイズ: ${(fileSize / 1024).toFixed(2)} KB`);

    // OpenAI APIにファイルをアップロード
    const file = await openaiClient.files.create({
      file: fs.createReadStream(filePath),
      purpose: 'assistants'
    });

    console.log(`✅ PDFファイルのアップロード完了: ${file.id}`);
    
    return {
      fileId: file.id,
      fileName: path.basename(filePath),
      fileSize: fileSize
    };
  } catch (error) {
    console.error('PDFアップロードエラー:', error);
    throw new Error(`PDFファイルのアップロードに失敗しました: ${filePath}`);
  }
}

export function createPDFPrompt(fileInfo) {
  return `以下のPDFファイル（${fileInfo.fileName}）の内容を参照して、テスト観点を生成してください。`;
}

export async function parsePDF(filePath) {
  try {
    // PDFファイルの存在確認
    if (!fs.existsSync(filePath)) {
      throw new Error(`PDFファイルが見つかりません: ${filePath}`);
    }

    // ファイルの基本情報を取得
    const stats = fs.statSync(filePath);
    const fileSize = stats.size;
    
    // PDFファイルのヘッダーを確認（簡易的な検証）
    const buffer = fs.readFileSync(filePath);
    const header = buffer.toString('ascii', 0, 8);
    
    if (!header.startsWith('%PDF')) {
      throw new Error('有効なPDFファイルではありません');
    }

    console.log(`📄 PDFファイル検証完了: ${path.basename(filePath)}`);
    console.log(`📄 ファイルサイズ: ${(fileSize / 1024).toFixed(2)} KB`);
    
    return {
      text: `[PDFファイル: ${path.basename(filePath)}] このファイルは仕様書として認識されました。実際のテキスト抽出機能は現在開発中です。`,
      pages: '不明',
      info: {
        title: path.basename(filePath),
        author: '不明',
        subject: '仕様書'
      },
      fileSize: fileSize
    };
  } catch (error) {
    console.error('PDF解析エラー:', error);
    throw new Error(`PDFファイルの解析に失敗しました: ${filePath}`);
  }
}

export function extractSpecificationContent(pdfData) {
  // PDFの内容から仕様書として重要な部分を抽出
  const text = pdfData.text;
  
  return {
    content: text,
    summary: text.substring(0, 500) + '...',
    pages: pdfData.pages
  };
} 