FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    DISPLAY_PORT=3000 \
    ADMIN_PORT=4000 \
    DB_PATH=/app/data/familyfeud.db

WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules/ ./node_modules/
COPY --from=build /app/dist/ ./dist/
COPY public/ ./public/
COPY questions.template.csv questions.fast-money.template.csv ./

RUN mkdir -p /app/data /app/audio/sfx && chown node:node /app/data

USER node
VOLUME ["/app/data"]
EXPOSE 3000 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "Promise.all([process.env.DISPLAY_PORT, process.env.ADMIN_PORT].map(port => fetch('http://127.0.0.1:' + port + '/health').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); }))).catch(err => { console.error(err); process.exit(1); })"

CMD ["node", "dist/server.js"]
