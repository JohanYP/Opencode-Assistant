FROM node:20-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# --- Production image ---
FROM node:20-slim

WORKDIR /app

ENV NODE_ENV=production
ENV RUNTIME_MODE=installed

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy compiled output
COPY --from=builder /app/dist ./dist

# Memory directory (mounted as volume at runtime)
RUN mkdir -p /app/memory/skills /app/memory/backups /app/data

VOLUME ["/app/memory", "/app/data"]

CMD ["node", "dist/index.js"]
