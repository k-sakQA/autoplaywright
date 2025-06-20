import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import pdf from '@cyber2024/pdf-parse-fixed';

export async function extractPDFText(filePath) {
  try {
    // PDFファイルの存在確認
    if (!fs.existsSync(filePath)) {
      throw new Error(`PDFファイルが見つかりません: ${filePath}`);
    }

    console.log(`📄 PDFファイルからテキスト抽出中: ${path.basename(filePath)}`);
    
    // PDFファイルを読み込み
    const dataBuffer = fs.readFileSync(filePath);
    
    // pdf-parseでテキスト抽出
    const data = await pdf(dataBuffer);
    
    console.log(`✅ テキスト抽出完了: ${data.numpages}ページ, ${data.text.length}文字`);
    
    return {
      text: data.text,
      pages: data.numpages,
      fileName: path.basename(filePath),
      fileSize: fs.statSync(filePath).size
    };
  } catch (error) {
    console.error('PDFテキスト抽出エラー:', error);
    throw new Error(`PDFファイルのテキスト抽出に失敗しました: ${filePath}`);
  }
}

export async function summarizePDFContent(pdfText, openaiClient, maxLength = 500) {
  try {
    if (!pdfText || pdfText.trim().length === 0) {
      return "PDFファイルにテキストが含まれていません。";
    }

    console.log(`📊 PDFテキスト長: ${pdfText.length}文字, 要約基準: ${maxLength}文字`);

    // テキストが短い場合はそのまま返す
    if (pdfText.length <= maxLength) {
      console.log(`📝 テキストが短いため要約をスキップします`);
      return pdfText.trim();
    }

    console.log(`📝 PDFテキストを要約中... (${pdfText.length}文字 → ${maxLength}文字以内)`);
    
    const response = await openaiClient.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `あなたは仕様書の要約専門AIです。以下の要件で要約してください：
- 重要な機能要件、制約、ルールを抽出
- テスト観点に関連する仕様を優先
- ${maxLength}文字以内で簡潔に
- 箇条書き形式で整理`
        },
        {
          role: 'user',
          content: `以下のPDF仕様書を要約してください：\n\n${pdfText}`
        }
      ],
      temperature: 0.3,
      max_tokens: Math.floor(maxLength / 2) // 要約後の文字数を調整
    });

    const summary = response.choices[0].message.content.trim();
    console.log(`✅ PDF要約完了: ${summary.length}文字`);
    
    return summary;
  } catch (error) {
    console.error('PDF要約エラー:', error);
    return `PDFの要約に失敗しました。ファイル名: ${pdfText.substring(0, 100)}...`;
  }
}

export async function uploadPDFToOpenAI(filePath, openaiClient) {
  try {
    // 新しい方法: テキスト抽出 + 要約
    const pdfData = await extractPDFText(filePath);
    const summary = await summarizePDFContent(pdfData.text, openaiClient);
    
    return {
      fileId: null, // ファイルアップロードは使用しない
      fileName: pdfData.fileName,
      fileSize: pdfData.fileSize,
      pages: pdfData.pages,
      text: pdfData.text,
      summary: summary
    };
  } catch (error) {
    console.error('PDF処理エラー:', error);
    throw new Error(`PDFファイルの処理に失敗しました: ${filePath}`);
  }
}

export function createPDFPrompt(fileInfo) {
  if (fileInfo.summary) {
    const prompt = `【仕様書要約】(${fileInfo.fileName}, ${fileInfo.pages}ページ)\n${fileInfo.summary}`;
    console.log(`📄 PDF要約をプロンプトに追加: ${fileInfo.summary.length}文字`);
    return prompt;
  }
  return `【仕様書】${fileInfo.fileName} (${fileInfo.pages}ページ) - 内容を参照してテスト観点を生成してください。`;
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