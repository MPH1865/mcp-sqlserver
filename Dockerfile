# syntax=docker/dockerfile:1

# ---- Build stage ----
FROM node:22-slim AS build
WORKDIR /app

# Install all dependencies (including dev) for the TypeScript build
COPY package.json package-lock.json ./
RUN npm ci

# Compile TypeScript -> dist/
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Runtime stage ----
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Default to the Streamable HTTP transport in containers
ENV MCP_TRANSPORT=http
ENV PORT=8000

# Production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Compiled output from the build stage
COPY --from=build /app/dist ./dist

EXPOSE 8000

# Healthcheck hits GET /health (never touches SQL Server)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||8000)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/index.js"]
