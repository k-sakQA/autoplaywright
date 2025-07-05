# 📱 Android実機でのPlaywright実行セットアップガイド

## 🎯 概要

このガイドでは、Android実機でPlaywrightテストを実行するための設定方法を説明します。実際のスマートフォンでテストすることで、より正確な動作確認が可能になります。

## 📋 必要な環境

### ハードウェア要件
- Android 5.0 (API level 21) 以上のAndroid端末
- USB-A to USB-C または USB-A to Micro-USB ケーブル
- 開発用PC（Windows、Mac、Linux）

### ソフトウェア要件
- Android Debug Bridge (ADB)
- Chrome for Android 87以降
- Playwright (実験的Androidサポート)

## 🔧 セットアップ手順

### 1. Android端末の開発者オプション有効化

1. **設定アプリ**を開く
2. **デバイス情報**または**端末情報**を選択
3. **ソフトウェア情報**を選択
4. **ビルド番号**を7回連続でタップ
5. 「開発者になりました！」メッセージが表示されることを確認

### 2. USBデバッグの有効化

1. **設定** > **開発者向けオプション**を開く
2. **USBデバッグ**をオンにする
3. 確認ダイアログで**OK**をタップ

### 3. Chrome for Androidの設定

1. Chrome for Androidを開く
2. アドレスバーに`chrome://flags`と入力
3. **Enable command line on non-rooted devices**を検索
4. **Enabled**に設定
5. Chromeを再起動

### 4. PC側のADB設定

#### Windows
```bash
# Android SDK Platform Toolsをインストール
# https://developer.android.com/studio/releases/platform-tools

# 環境変数にADBのパスを追加
# C:\Users\[ユーザー名]\AppData\Local\Android\Sdk\platform-tools
```

#### Mac
```bash
# Homebrewでインストール
brew install android-platform-tools

# または手動でダウンロード
# https://developer.android.com/studio/releases/platform-tools
```

#### Linux
```bash
# Ubuntuの場合
sudo apt install android-tools-adb

# または手動でダウンロード
# https://developer.android.com/studio/releases/platform-tools
```

### 5. 端末接続の確認

1. USB ケーブルで端末をPCに接続
2. 端末に「USBデバッグを許可しますか？」ダイアログが表示されたら**OK**をタップ
3. **このコンピューターからの接続を常に許可する**にチェック

```bash
# 接続確認
adb devices

# 出力例:
# List of devices attached
# ABC123DEF456    device
```

## 🚀 AutoPlaywrightでの実行

### 基本的な実行

```bash
# Android実機でテスト実行
node tests/runRoutes.js --url "https://example.com" --android-device

# 特定のデバイスを指定
node tests/runRoutes.js --url "https://example.com" --android-device --android-serial=ABC123DEF456
```

### 利用可能なオプション

| オプション | 説明 | 例 |
|-----------|------|-----|
| `--android-device` | Android実機モードを有効化 | `--android-device` |
| `--android-serial=<serial>` | 特定のデバイスを指定 | `--android-serial=ABC123DEF456` |
| `--user-story-id=<id>` | ユーザーストーリーIDを指定 | `--user-story-id=1` |

### 実行例

```bash
# スポーツバー検索のテスト
node tests/runRoutes.js --url "https://fansta.jp/shops" --android-device --user-story-id=1

# 複数デバイスがある場合
adb devices  # デバイス一覧を確認
node tests/runRoutes.js --url "https://fansta.jp/shops" --android-device --android-serial=YOUR_DEVICE_SERIAL
```

## 🔍 トラブルシューティング

### よくある問題と解決方法

#### 1. デバイスが認識されない
```bash
# 解決方法
adb kill-server
adb start-server
adb devices
```

#### 2. 「unauthorized」と表示される
- 端末でUSBデバッグの許可ダイアログを確認
- 端末の画面ロックを解除
- USBケーブルを抜き差し

#### 3. Chrome起動エラー
```bash
# Chrome for Androidを強制停止
adb shell am force-stop com.android.chrome

# 再度テスト実行
node tests/runRoutes.js --android-device
```

#### 4. 接続が不安定
- 高品質なUSBケーブルを使用
- USBハブを使わず直接接続
- 端末の「スリープしない」設定を有効化

### デバッグ用コマンド

```bash
# デバイス情報の確認
adb shell getprop ro.product.model
adb shell getprop ro.build.version.release

# スクリーンショットの取得
adb exec-out screencap -p > screenshot.png

# ログの確認
adb logcat | grep -i chrome
```

## 📊 実機テストの利点

### 1. **正確な動作確認**
- 実際のタッチ操作
- 本物のネットワーク環境
- 実機のパフォーマンス

### 2. **レスポンシブデザインの検証**
- 実際の画面サイズ
- デバイス固有のUI
- タッチ領域の正確性

### 3. **パフォーマンステスト**
- 実際の処理速度
- メモリ使用量
- バッテリー消費

## 🎯 ベストプラクティス

### 1. **テスト前の準備**
- 端末の充電を十分に行う
- 不要なアプリを終了
- 安定したネットワーク環境

### 2. **テスト中の注意点**
- 端末の画面を常にオンにする
- 他のアプリからの通知を無効化
- テスト中は端末を操作しない

### 3. **結果の分析**
- スクリーンショットの確認
- ログの詳細分析
- 実機固有の問題の特定

## 🔄 Wi-Fi接続での実行（上級者向け）

### 1. 初期USB接続設定
```bash
# USB接続でTCP/IPモードに切り替え
adb tcpip 5555
```

### 2. Wi-Fi接続
```bash
# 端末のIPアドレスを確認（設定 > Wi-Fi > 詳細）
adb connect 192.168.1.100:5555

# 接続確認
adb devices
```

### 3. USBケーブルを抜いてテスト実行
```bash
node tests/runRoutes.js --android-device --url "https://example.com"
```

## 📝 参考資料

- [Playwright Android Documentation](https://playwright.dev/docs/api/class-android)
- [Android Debug Bridge (ADB)](https://developer.android.com/studio/command-line/adb)
- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)

---

## 🆘 サポート

問題が発生した場合は、以下の情報を含めてIssueを作成してください：

1. 使用している端末の機種とAndroidバージョン
2. PCのOS
3. エラーメッセージの全文
4. `adb devices`の出力結果
5. 実行したコマンド 