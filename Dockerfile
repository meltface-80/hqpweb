# hqpweb, a web controller for HQPlayer: one small Node process serving the API and the web app.

# ---- build the web app --------------------------------------------------------
# Static files are the same on every architecture, so build them natively (fast)
# even when the image targets another platform.
FROM --platform=$BUILDPLATFORM node:24-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/fake-hqp/package.json packages/fake-hqp/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
RUN npm run build -w apps/web && \
    node --input-type=module -e "import { buildCommit } from './apps/server/src/commit.ts'; process.stdout.write(buildCommit('.'))" > COMMIT

# ---- runtime: Node runs the TypeScript sources directly (type stripping) ---------
FROM node:24-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4380 \
    CONFIG_DIR=/config \
    STATIC_DIR=/app/web
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/fake-hqp/package.json packages/fake-hqp/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev -w @app/server && npm cache clean --force
COPY packages/protocol/src packages/protocol/src
COPY apps/server/src apps/server/src
COPY --from=build /src/apps/web/dist /app/web
COPY --from=build /src/COMMIT /app/COMMIT
RUN mkdir -p /config && chown node:node /config
USER node
EXPOSE 4380
VOLUME /config
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "apps/server/src/main.ts"]
