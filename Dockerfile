# ───────────────────────────────────────────
# Dockerfile (プロジェクト直下に上書き)
# ───────────────────────────────────────────

# Playwright公式“noble”イメージをベースに
# ブラウザ本体＆依存ライブラリが最初からプリインストール
FROM mcr.microsoft.com/playwright:v1-noble  
# :contentReference[oaicite:0]{index=0}

WORKDIR /app

# 依存定義だけ先コピー (キャッシュ効かせる)
COPY package*.json ./
RUN npm ci

# 残りのソースをコピー
COPY . .

# デフォルトでCIパイプラインを実行
CMD ["npm", "run", "ci-pipeline"]
