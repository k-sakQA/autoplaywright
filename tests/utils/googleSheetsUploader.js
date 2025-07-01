import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import fs from 'fs';
import path from 'path';

class GoogleSheetsUploader {
  constructor() {
    this.auth = null;
    this.sheets = null;
  }

  /**
   * Google Sheets APIの認証を初期化
   * @param {string} credentialsPath - サービスアカウントのJSONファイルパス
   */
  async initialize(credentialsPath) {
    try {
      // サービスアカウント認証
      this.auth = new GoogleAuth({
        keyFile: credentialsPath,
        scopes: [
          'https://www.googleapis.com/auth/spreadsheets',
          'https://www.googleapis.com/auth/drive',
          'https://www.googleapis.com/auth/drive.file'
        ]
      });

      this.sheets = google.sheets({ version: 'v4', auth: this.auth });
      console.log('Google Sheets API認証完了');
    } catch (error) {
      console.error('Google Sheets API認証エラー:', error.message);
      throw error;
    }
  }

  /**
   * フォルダ内で指定したタイトルのスプレッドシートを検索
   * @param {string} title - 検索するスプレッドシートのタイトル
   * @param {string} folderId - 検索対象フォルダID（オプション）
   * @returns {string|null} - 見つかったスプレッドシートのID、見つからない場合はnull
   */
  async findExistingSpreadsheet(title, folderId = null) {
    try {
      const drive = google.drive({ version: 'v3', auth: this.auth });
      
      // まず完全一致で検索
      let query = `name='${title}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
      
      // フォルダIDが指定されている場合はフォルダ内を検索
      if (folderId) {
        query += ` and '${folderId}' in parents`;
      }
      
      let response = await drive.files.list({
        q: query,
        fields: 'files(id, name, createdTime)',
        orderBy: 'createdTime desc'
      });
      
      if (response.data.files && response.data.files.length > 0) {
        const spreadsheet = response.data.files[0];
        console.log(`既存スプレッドシートを発見（完全一致）: ${spreadsheet.name} (ID: ${spreadsheet.id})`);
        return spreadsheet.id;
      }
      
      // 完全一致で見つからない場合は部分一致で検索
      console.log(`完全一致では見つかりませんでした。部分一致で検索中...`);
      
      // 「AutoPlaywright テスト結果」で始まるスプレッドシートを検索
      const baseTitle = title.split(' - ')[0]; // 「AutoPlaywright テスト結果」部分のみ抽出
      let partialQuery = `name contains '${baseTitle}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
      
      if (folderId) {
        partialQuery += ` and '${folderId}' in parents`;
      }
      
      response = await drive.files.list({
        q: partialQuery,
        fields: 'files(id, name, createdTime)',
        orderBy: 'createdTime desc',
        pageSize: 10 // 最新の10件まで検索
      });
      
      if (response.data.files && response.data.files.length > 0) {
        const spreadsheet = response.data.files[0];
        console.log(`既存スプレッドシートを発見（部分一致）: ${spreadsheet.name} (ID: ${spreadsheet.id})`);
        console.log(`🔄 部分一致で見つかったため、こちらを使用します`);
        return spreadsheet.id;
      }
      
      console.log(`指定されたタイトルのスプレッドシートが見つかりませんでした: ${title}`);
      console.log(`💡 新しいスプレッドシートを作成します`);
      return null;
    } catch (error) {
      console.error('スプレッドシート検索エラー:', error.message);
      return null;
    }
  }

  /**
   * 新しいスプレッドシートを作成
   * @param {string} title - スプレッドシートのタイトル
   * @param {string} shareEmail - 共有するメールアドレス（オプション）
   * @param {string} folderId - 保存先フォルダID（オプション）
   * @returns {string} - 作成されたスプレッドシートのID
   */
  async createSpreadsheet(title, shareEmail = null, folderId = null) {
    try {
      const response = await this.sheets.spreadsheets.create({
        resource: {
          properties: {
            title: title
          }
        }
      });

      const spreadsheetId = response.data.spreadsheetId;
      console.log(`スプレッドシート作成完了: ${title} (ID: ${spreadsheetId})`);

      // 指定されたフォルダに移動
      if (folderId) {
        await this.moveToFolder(spreadsheetId, folderId);
      }

      // 指定されたメールアドレスと共有
      if (shareEmail) {
        await this.shareSpreadsheet(spreadsheetId, shareEmail);
      }

      return spreadsheetId;
    } catch (error) {
      console.error('スプレッドシート作成エラー:', error.message);
      throw error;
    }
  }

  /**
   * スプレッドシートを指定したフォルダに移動
   * @param {string} spreadsheetId - スプレッドシートID
   * @param {string} folderId - 移動先フォルダID
   */
  async moveToFolder(spreadsheetId, folderId) {
    try {
      const drive = google.drive({ version: 'v3', auth: this.auth });
      
      // 現在の親フォルダを取得
      const file = await drive.files.get({
        fileId: spreadsheetId,
        fields: 'parents'
      });
      
      const previousParents = file.data.parents ? file.data.parents.join(',') : '';
      
      // 指定されたフォルダに移動
      await drive.files.update({
        fileId: spreadsheetId,
        addParents: folderId,
        removeParents: previousParents,
        fields: 'id, parents'
      });

      console.log(`スプレッドシートを指定フォルダに移動完了: ${folderId}`);
    } catch (error) {
      console.error('フォルダ移動エラー:', error.message);
      // フォルダ移動に失敗してもエラーにはしない
    }
  }

  /**
   * スプレッドシートを指定したメールアドレスと共有
   * @param {string} spreadsheetId - スプレッドシートID
   * @param {string} email - 共有するメールアドレス
   * @param {string} role - 権限（writer, reader等）
   */
  async shareSpreadsheet(spreadsheetId, email, role = 'writer') {
    try {
      const drive = google.drive({ version: 'v3', auth: this.auth });
      
      await drive.permissions.create({
        fileId: spreadsheetId,
        resource: {
          role: role,
          type: 'user',
          emailAddress: email
        }
      });

      console.log(`スプレッドシート共有完了: ${email} (権限: ${role})`);
    } catch (error) {
      console.error('スプレッドシート共有エラー:', error.message);
      // 共有に失敗してもエラーにはしない（手動で共有可能）
    }
  }

  /**
   * CSVファイルをスプレッドシートにアップロード
   * @param {string} csvFilePath - CSVファイルのパス
   * @param {string} spreadsheetId - アップロード先のスプレッドシートID
   * @param {string} sheetName - シート名（デフォルト: 'Sheet1'）
   * @param {boolean} appendMode - 追記モード（デフォルト: false）
   */
  async uploadCSV(csvFilePath, spreadsheetId, sheetName = 'Sheet1', appendMode = false) {
    try {
      // CSVファイルを読み込み
      const csvContent = fs.readFileSync(csvFilePath, 'utf8');
      const rows = this.parseCSV(csvContent);

      if (rows.length === 0) {
        console.log('CSVファイルが空です');
        return;
      }

      // デバッグ情報：CSVの構造をチェック
      console.log(`🛠️ [Debug] CSV構造チェック:`);
      console.log(`  総行数: ${rows.length}`);
      if (rows.length > 0) {
        console.log(`  ヘッダー列数: ${rows[0].length}`);
        console.log(`  ヘッダー: [${rows[0].join(', ')}]`);
        
        if (rows.length > 1) {
          console.log(`  データ行1列数: ${rows[1].length}`);
          
          // 列数の不一致をチェック
          if (rows[0].length !== rows[1].length) {
            console.log(`⚠️ 警告: ヘッダーとデータの列数が不一致です`);
            console.log(`    ヘッダー: ${rows[0].length}列, データ: ${rows[1].length}列`);
          }
        }
      }

      // アップロード範囲を決定
      let range;
      if (appendMode) {
        // 既存データの末尾に追記
        const existingData = await this.getSheetData(spreadsheetId, sheetName);
        const nextRow = existingData.length + 1;
        range = `${sheetName}!A${nextRow}`;
      } else {
        // 新規データとして上書き
        range = `${sheetName}!A1`;
      }

      // データをアップロード
      await this.sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'RAW',
        resource: {
          values: rows
        }
      });

      console.log(`✅ CSVアップロード完了: ${path.basename(csvFilePath)} → ${spreadsheetId}`);
      console.log(`📊 範囲: ${range}, 行数: ${rows.length}`);

    } catch (error) {
      console.error('❌ CSVアップロードエラー:', error.message);
      throw error;
    }
  }

  /**
   * トレーサブルCSVファイルを直接スプレッドシートにアップロード
   * @param {string} csvFilePath - CSVファイルのパス
   * @param {string} title - スプレッドシートのタイトル
   * @param {string} shareEmail - 共有するメールアドレス（オプション）
   * @param {string} folderId - 保存先フォルダID（オプション）
   * @returns {string} - 使用されたスプレッドシートのID
   */
  async uploadTraceableCSV(csvFilePath, title, shareEmail = null, folderId = null) {
    try {
      // 既存スプレッドシートを検索
      let spreadsheetId = await this.findExistingSpreadsheet(title, folderId);
      
      if (spreadsheetId) {
        console.log(`📊 既存スプレッドシートを使用: ${title}`);
        
        // 既存スプレッドシートに新しいシートを追加
        const timestamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '');
        const sheetName = `TestResults_${timestamp}`;
        
        await this.createSheet(spreadsheetId, sheetName);
        await this.uploadCSV(csvFilePath, spreadsheetId, sheetName);
        
        console.log(`📊 既存スプレッドシートに新しいシートを追加: ${sheetName}`);
      } else {
        console.log(`📊 新しいスプレッドシートを作成: ${title}`);
        
        // 新しいスプレッドシートを作成
        spreadsheetId = await this.createSpreadsheet(title, shareEmail, folderId);
        
        // 最初のシートにCSVをアップロード
        const timestamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '');
        const sheetName = `TestResults_${timestamp}`;
        
        await this.createSheet(spreadsheetId, sheetName);
        await this.uploadCSV(csvFilePath, spreadsheetId, sheetName);
      }
      
      return spreadsheetId;
    } catch (error) {
      console.error('トレーサブルCSVアップロードエラー:', error.message);
      throw error;
    }
  }

  /**
   * 既存スプレッドシートにテスト結果をアップロード（新しいシート作成）
   * @param {Object} testResults - テスト結果データ
   * @param {string} spreadsheetId - アップロード先のスプレッドシートID
   * @param {string} title - スプレッドシートのタイトル
   * @param {string} shareEmail - 共有するメールアドレス（オプション）
   * @param {string} folderId - 保存先フォルダID（オプション）
   * @returns {string} - 使用されたスプレッドシートのID
   */
  async uploadTestResultsToExistingOrNew(testResults, title, shareEmail = null, folderId = null) {
    try {
      // 既存スプレッドシートを検索
      let spreadsheetId = await this.findExistingSpreadsheet(title, folderId);
      
      if (spreadsheetId) {
        console.log(`📊 既存スプレッドシートを使用: ${title}`);
        
        // 既存スプレッドシートに新しいシートを追加
        const timestamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '');
        const sheetName = `TestResults_${timestamp}`;
        
        await this.createSheet(spreadsheetId, sheetName);
        await this.uploadTestResults(testResults, spreadsheetId, sheetName);
        
        console.log(`📊 既存スプレッドシートに新しいシートを追加: ${sheetName}`);
      } else {
        console.log(`📊 新しいスプレッドシートを作成: ${title}`);
        
        // 新しいスプレッドシートを作成
        spreadsheetId = await this.createSpreadsheet(title, shareEmail, folderId);
        
        // デフォルトシートにテスト結果をアップロード
        const timestamp = new Date().toISOString().slice(0, 10);
        const sheetName = `TestResults_${timestamp}`;
        
        await this.createSheet(spreadsheetId, sheetName);
        await this.uploadTestResults(testResults, spreadsheetId, sheetName);
      }
      
      return spreadsheetId;
    } catch (error) {
      console.error('テスト結果アップロードエラー:', error.message);
      throw error;
    }
  }

  /**
   * テスト結果データを構造化してアップロード
   * @param {Object} testResults - テスト結果データ
   * @param {string} spreadsheetId - アップロード先のスプレッドシートID
   * @param {string} sheetName - シート名（デフォルト: 'TestResults'）
   */
  async uploadTestResults(testResults, spreadsheetId, sheetName = 'TestResults') {
    try {
      // ヘッダー行を作成（階層的トレーサビリティ対応）
      const headers = [
        '実行日時',
        'ID',
        'ユーザーストーリー',
        '機能',
        '観点',
        'テスト手順',
        '実行結果',
        'エラー詳細',
        'URL'
      ];

      // データ行を作成
      const rows = [headers];
      
      if (testResults.routes) {
        testResults.routes.forEach(route => {
          rows.push([
            new Date().toISOString(),
            route.id || '',
            route.userStory || '',
            route.steps ? route.steps.join(' → ') : '',
            route.result || '',
            route.error || '',
            route.executionTime || '',
            route.coverage ? route.coverage.join(', ') : '',
            route.url || ''
          ]);
        });
      }

      // データをアップロード
      await this.sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A1`,
        valueInputOption: 'RAW',
        resource: {
          values: rows
        }
      });

      console.log(`テスト結果アップロード完了: ${sheetName}`);
      return sheetName;

    } catch (error) {
      console.error('テスト結果アップロードエラー:', error.message);
      throw error;
    }
  }

  /**
   * 新しいシートを作成
   * @param {string} spreadsheetId - スプレッドシートID
   * @param {string} sheetName - 作成するシート名
   */
  async createSheet(spreadsheetId, sheetName) {
    try {
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [{
            addSheet: {
              properties: {
                title: sheetName
              }
            }
          }]
        }
      });

      console.log(`シート作成完了: ${sheetName}`);
    } catch (error) {
      if (error.message.includes('already exists')) {
        console.log(`シートは既に存在します: ${sheetName}`);
      } else {
        throw error;
      }
    }
  }

  /**
   * シートからデータを取得
   * @param {string} spreadsheetId - スプレッドシートID
   * @param {string} sheetName - シート名
   * @returns {Array} - シートのデータ
   */
  async getSheetData(spreadsheetId, sheetName) {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!A:Z`
      });

      return response.data.values || [];
    } catch (error) {
      console.error('シートデータ取得エラー:', error.message);
      return [];
    }
  }

  /**
   * CSVコンテンツをパース（改良版：引用符内のカンマを正しく処理）
   * @param {string} csvContent - CSVの文字列
   * @returns {Array} - パースされた2次元配列
   */
  parseCSV(csvContent) {
    const lines = csvContent.trim().split('\n');
    
    /**
     * 1行をパースする（引用符内のカンマを正しく処理）
     * @param {string} line - パースする行
     * @returns {Array} - パースされた列の配列
     */
    function parseCSVLine(line) {
      const result = [];
      let current = '';
      let inQuotes = false;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim().replace(/^"|"$/g, ''));
          current = '';
        } else {
          current += char;
        }
      }
      
      result.push(current.trim().replace(/^"|"$/g, ''));
      return result;
    }
    
    return lines.map(line => parseCSVLine(line));
  }

  /**
   * 修正ルート実行結果を既存のシートに追加
   * @param {string} spreadsheetId - スプレッドシートID
   * @param {string} sheetName - シート名
   * @param {Array} testResults - テスト結果配列
   * @param {string} columnTitle - 追加する列のタイトル（例: "再）実行結果"）
   */
  async addFixedRouteResults(spreadsheetId, sheetName, testResults, columnTitle = '再）実行結果') {
    try {
      // 既存データを取得
      const existingData = await this.getSheetData(spreadsheetId, sheetName);
      if (existingData.length === 0) {
        console.log('既存データが見つかりません');
        return;
      }

      // ヘッダー行を取得（空の要素を除去して正確な列数を取得）
      const headers = existingData[0].filter(header => header && header.trim() !== '');
      
      console.log(`🛠️ [Debug] ヘッダー情報:`);
      console.log(`  既存ヘッダー数: ${headers.length}`);
      console.log(`  ヘッダー内容: [${headers.join(', ')}]`);
      
      // 新しい列の位置を決定（既存の有効な列の右端）
      const newColumnIndex = headers.length;
      const newColumnLetter = this.columnIndexToLetter(newColumnIndex);
      
      console.log(`  新しい列位置: ${newColumnIndex} (${newColumnLetter})`);
      
      // ヘッダーに新しい列名を追加
      const headerRange = `${sheetName}!${newColumnLetter}1`;
      await this.sheets.spreadsheets.values.update({
        spreadsheetId,
        range: headerRange,
        valueInputOption: 'RAW',
        resource: {
          values: [[columnTitle]]
        }
      });

      console.log(`✅ 新しい列を追加: ${columnTitle} (列${newColumnLetter})`);

      // テスト結果をIDに基づいてマッピング
      const resultMap = {};
      testResults.forEach(result => {
        // テストケースIDまたはラベルをキーとして使用
        const key = result.label || result.testCaseId || result.id;
        if (key) {
          resultMap[key] = result.status || result.result || '不明';
        }
      });

      // 既存データの各行に対して結果を追加
      const updates = [];
      for (let i = 1; i < existingData.length; i++) { // ヘッダー行をスキップ
        const row = existingData[i];
        const rowIndex = i + 1;
        
        // データ行の構造チェックとデバッグ情報
        if (i === 1) {
          console.log(`🛠️ [Debug] データ行の構造確認:`);
          console.log(`  データ行列数: ${row.length}`);
          console.log(`  ヘッダー数: ${headers.length}`);
          console.log(`  行[0] (実行日時): "${row[0] || '空'}"`);
          console.log(`  行[1] (ID): "${row[1] || '空'}"`);
          console.log(`  行[2] (ユーザーストーリー): "${(row[2] || '空').substring(0, 50)}${row[2] && row[2].length > 50 ? '...' : ''}"`);
          console.log(`  行[3] (機能): "${row[3] || '空'}"`);
          console.log(`  行[4] (観点): "${row[4] || '空'}"`);
          console.log(`  行[5] (テスト手順): "${(row[5] || '空').substring(0, 50)}${row[5] && row[5].length > 50 ? '...' : ''}"`);
          
          // 列数不一致の警告
          if (row.length !== headers.length) {
            console.log(`⚠️ 警告: データ行とヘッダーの列数が不一致です`);
            console.log(`    ヘッダー: ${headers.length}列, データ行: ${row.length}列`);
          }
        }
        
        // より正確な列マッピング：
        // 0: 実行日時, 1: ID, 2: ユーザーストーリー, 3: 機能, 4: 観点, 5: テスト手順, 6: 実行結果, 7: エラー詳細, 8: URL
        
        // IDベースでマッチング（最も確実）
        let testCaseKey = row[1] || '';  // ID列
        let result = resultMap[testCaseKey];
        
        // IDでマッチしない場合は観点でマッチング
        if (!result && row[4]) {
          testCaseKey = row[4];  // 観点列
          result = resultMap[testCaseKey] || this.findMatchingResult(testCaseKey, testResults);
        }
        
        // それでもマッチしない場合はテスト手順でマッチング
        if (!result && row[5]) {
          testCaseKey = row[5];  // テスト手順列
          result = this.findMatchingResult(testCaseKey, testResults);
        }
        
        // 最終的にマッチしない場合は未実行とする
        if (!result) {
          result = '未実行';
        }
        
        updates.push({
          range: `${sheetName}!${newColumnLetter}${rowIndex}`,
          values: [[result]]
        });
      }

      // バッチで更新
      if (updates.length > 0) {
        await this.sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          resource: {
            valueInputOption: 'RAW',
            data: updates
          }
        });

        console.log(`${updates.length}件の修正ルート実行結果を追加完了`);
      }

    } catch (error) {
      console.error('修正ルート実行結果追加エラー:', error.message);
      throw error;
    }
  }

  /**
   * テストケース名に基づいて一致する結果を検索
   * @param {string} testCaseName - テストケース名
   * @param {Array} testResults - テスト結果配列
   * @returns {string} - マッチした結果のステータス
   */
  findMatchingResult(testCaseName, testResults) {
    if (!testCaseName || testCaseName.trim() === '') {
      return '未実行';
    }
    
    for (const result of testResults) {
      const label = result.label || '';
      
      // より厳密なマッチング条件を追加
      if (label === testCaseName || 
          label.includes(testCaseName) || 
          testCaseName.includes(label)) {
        
        // ステータスを分かりやすい形式に変換
        switch (result.status) {
          case 'success':
            return 'success';
          case 'failed':
            return 'failed';
          case 'skipped':
            return 'skipped';
          default:
            return result.status || '不明';
        }
      }
    }
    return '未実行';
  }

  /**
   * 列インデックスを列文字に変換（0=A, 1=B, ..., 25=Z, 26=AA）
   * @param {number} index - 列インデックス（0始まり）
   * @returns {string} - 列文字
   */
  columnIndexToLetter(index) {
    let result = '';
    while (index >= 0) {
      result = String.fromCharCode((index % 26) + 65) + result;
      index = Math.floor(index / 26) - 1;
    }
    return result;
  }

  /**
   * スプレッドシートのURLを生成
   * @param {string} spreadsheetId - スプレッドシートID
   * @returns {string} - スプレッドシートのURL
   */
  getSpreadsheetUrl(spreadsheetId) {
    return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  }
}

export default GoogleSheetsUploader; 