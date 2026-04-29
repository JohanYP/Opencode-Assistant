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

# ffmpeg is required to convert TTS MP3 output to OGG/Opus for Telegram
# voice notes (sendVoice). Without it, the bot falls back to sendAudio.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy compiled output
COPY --from=builder /app/dist ./dist

# Memory directory (mounted as volume at runtime)
RUN mkdir -p /app/memory/skills /app/memory/backups /app/data

VOLUME ["/app/memory", "/app/data"]

CMD ["node", "dist/index.js"]
