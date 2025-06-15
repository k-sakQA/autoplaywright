# Dockerfile
FROM node:18-bullseye-slim

# ブラウザ依存ライブラリをインストール
RUN apt-get update && apt-get install -y \
    wget ca-certificates fonts-liberation libnss3 libxss1 libasound2 \
    libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 libgtk-3-0 \
    libxcomposite1 libxdamage1 libxrandr2 libxkbcommon0 libpangocairo-1.0-0 \
    libpci-dev libxcb1 libx11-xcb1

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx playwright install --with-deps
CMD ["npm", "run", "ci-pipeline"]
