# ───────────────────────────────────────────
# Dockerfile
# ───────────────────────────────────────────

# Node.jsの公式イメージを使用
FROM node:24.2.0

# 作業ディレクトリを設定
WORKDIR /app

# 必要なファイルをコピー
COPY package*.json ./
COPY config.json ./
COPY playwright.config.js ./
COPY tests/ ./tests/
COPY test_point/ ./test_point/

# 依存パッケージのインストール
RUN npm install

# Playwrightの依存関係をインストール
RUN npx playwright install --with-deps

# 環境変数の設定
ENV NODE_ENV=production

# テスト結果を保存するディレクトリを作成
RUN mkdir -p test-results

# コンテナ起動時のコマンド
CMD ["node", "tests/runRoutes.js"]
