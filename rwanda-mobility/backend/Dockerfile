# Abasare API image. Build context is the rwanda-mobility/ folder (it needs backend/ and admin-web/):
#   docker build -f backend/Dockerfile -t abasare-api .
# Migrations and idempotent seeding (zones, services, prices, roles) run automatically on start (src/server.ts).
# Stage 1: compile TypeScript to JavaScript (dist/). The server then starts with plain `node`, with no tsx loader at run time.
FROM node:22-slim AS build
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend ./
RUN npm run build

FROM node:22-slim AS base
WORKDIR /app
ENV NODE_ENV=production
# Install exactly what package-lock.json pins (tsx is a runtime dependency: the server is started with it).
COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci --omit=dev && npm cache clean --force
COPY backend ./backend
COPY --from=build /app/backend/dist ./backend/dist
COPY admin-web ./admin-web
# Documents and evidence are written to STORAGE_DIR: mount a persistent volume there (see deploy/docker-compose.yml). The node user must own it.
ENV STORAGE_DIR=/data/storage PORT=8080
RUN mkdir -p /data/storage && chown -R node:node /data
WORKDIR /app/backend
EXPOSE 8080
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# node is PID 1 (no npx wrapper) so SIGTERM from the platform reaches the server and its graceful shutdown (src/server.ts) runs
CMD ["node", "dist/server.js"]
