FROM node:22-bookworm-slim AS build
ENV PUPPETEER_SKIP_DOWNLOAD=true CI=true
RUN npm install --global pnpm@12.15.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

FROM node:22-bookworm-slim
ENV NODE_ENV=production PUPPETEER_SKIP_DOWNLOAD=true CHROME_PATH=/usr/bin/chromium \
    SESSION_PATH=/app/data/sessions PUBLICATION_RECEIPTS_PATH=/app/data/publication-receipts QR_IN_TERMINAL=false
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium dumb-init ca-certificates fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN mkdir -p /app/data /app/.wwebjs_cache && chown -R node:node /app/data /app/.wwebjs_cache
USER node
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
