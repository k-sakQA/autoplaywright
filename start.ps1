# AutoPlaywright起動スクリプト

# エラーが発生した場合にスクリプトを停止
$ErrorActionPreference = "Stop"

Write-Host "🚀 AutoPlaywright起動スクリプトを開始します..." -ForegroundColor Cyan

# 1. 最新のコードをプル
Write-Host "📥 最新のコードをプルしています..." -ForegroundColor Yellow
git pull

# 2. 環境変数の設定
Write-Host "🔑 環境変数を設定しています..." -ForegroundColor Yellow
if (-not $env:OPENAI_API_KEY) {
    Write-Host "⚠️ OPENAI_API_KEYが設定されていません。" -ForegroundColor Red
    Write-Host "環境変数を設定してください：" -ForegroundColor Yellow
    Write-Host "例: `$env:OPENAI_API_KEY='your-api-key'" -ForegroundColor Yellow
    exit 1
}

# 3. Dockerコンテナの起動
Write-Host "🐳 Dockerコンテナを起動しています..." -ForegroundColor Yellow
docker-compose up --build

Write-Host "✅ 起動完了！" -ForegroundColor Green 