# 環境変数設定スクリプト

# エラーが発生した場合にスクリプトを停止
$ErrorActionPreference = "Stop"

Write-Host "🔑 環境変数設定スクリプトを開始します..." -ForegroundColor Cyan

# OpenAI APIキーの設定
$apiKey = Read-Host "OpenAI APIキーを入力してください"
[Environment]::SetEnvironmentVariable("OPENAI_API_KEY", $apiKey, "User")

Write-Host "✅ 環境変数の設定が完了しました！" -ForegroundColor Green
Write-Host "設定された環境変数: OPENAI_API_KEY" -ForegroundColor Yellow 