# CAT 100: one container serving the API and the built web app.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --workspace server && npm cache clean --force
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/migrations server/migrations
COPY --from=build /app/web/dist web/dist
RUN mkdir -p /app/server/uploads && chown node:node /app/server/uploads
WORKDIR /app/server
ENV WEB_DIST=/app/web/dist UPLOAD_DIR=/app/server/uploads PORT=4000
USER node
EXPOSE 4000
# Applies migrations, seeds an empty database, creates the admin from SEED_ADMIN_* if missing, then serves.
CMD ["sh", "-c", "node dist/seed/run.js --if-empty && exec node dist/index.js"]
