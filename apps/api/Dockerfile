# Build from the repo root:  docker build -f apps/api/Dockerfile .
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci -w api
COPY apps/api apps/api
RUN npm run build -w api && npm prune --omit=dev -w api
# Free DB-IP Lite city + ASN databases for offline IP enrichment (refreshed on every build).
RUN node apps/api/scripts/fetch-geo.mjs apps/api/geo

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app/apps/api
COPY --from=build /app/node_modules /app/node_modules
# Workspace-local deps (e.g. zod v4, while the web app keeps v3 at the root).
COPY --from=build /app/apps/api/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json ./
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/migrations ./migrations
COPY --from=build /app/apps/api/geo ./geo
USER node
EXPOSE 8080
# Same image runs migrations as a Cloud Run Job: command `node dist/scripts/migrate.js`
CMD ["node", "dist/src/index.js"]
