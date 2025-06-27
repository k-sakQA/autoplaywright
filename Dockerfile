# ───────────────────────────────────────────
# Dockerfile
# ───────────────────────────────────────────

# Node.jsの公式イメージを使用（最新LTS版）
FROM node:22-slim

# 作業ディレクトリを設定
WORKDIR /app

# 必要なファイルをコピー
COPY package*.json ./
COPY config.json ./
COPY playwright.config.js ./
COPY server.js ./
COPY public/ ./public/
COPY tests/ ./tests/
COPY test_point/ ./test_point/
COPY specs/ ./specs/

# Google Cloud認証ファイル（オプション）
COPY airy-cycle-451111-s0-32fbfd2f1e9f.json* ./

# 依存パッケージのインストール
RUN npm install

# Playwrightの依存関係をインストール
RUN npx playwright install --with-deps

# 環境変数の設定
ENV NODE_ENV=production

# 必要なディレクトリを作成
RUN mkdir -p test-results cache

# ポートを公開
EXPOSE 3000

# コンテナ起動時のコマンド（WebUIサーバーを起動）
CMD ["node", "server.js"]
