FROM node:22-slim AS base
WORKDIR /app
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev && npm i tsx typescript --no-save
COPY backend ./backend
COPY admin-web ./admin-web
ENV NODE_ENV=production
WORKDIR /app/backend
EXPOSE 8080
USER node
CMD ["npx", "tsx", "src/server.ts"]
