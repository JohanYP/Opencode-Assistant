# --- Builder stage ---
# Install build tools so native modules (e.g. better-sqlite3) compile their
# bindings during npm install. Then build the TypeScript output.
FROM node:20-slim AS builder

# Native module build deps. python3 + build-essential cover node-gyp's needs
# for better-sqlite3 and similar packages.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       python3 build-essential \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
# Run install with scripts ENABLED here so prebuild-install / node-gyp can
# place the native .node binding. devDependencies are needed to compile TS.
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# Prune devDependencies in place. The native bindings of production
# dependencies (better-sqlite3/build/Release/better_sqlite3.node) are kept.
RUN npm prune --omit=dev

# --- Production image ---
# No build tools here. We only carry across the already-compiled artifacts:
# dist/ and the pruned node_modules/. No npm install runs at this stage,
# so no postinstall scripts of any package can execute on the runtime
# image — equivalent security posture to the previous --ignore-scripts.
FROM node:20-slim

# ffmpeg is needed at runtime to transcode TTS output (MP3 from the
# providers) into OGG/Opus for WhatsApp voice notes (push-to-talk).
# Telegram accepts the MP3 directly, but WhatsApp's voice-note format
# requires OPUS — without this binary the bot falls back to sending
# audio as a music-player attachment instead of a real voice note.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV RUNTIME_MODE=installed

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package*.json ./

# Memory directory (mounted as volume at runtime)
RUN mkdir -p /app/memory/skills /app/memory/backups /app/data

VOLUME ["/app/memory", "/app/data"]

CMD ["node", "dist/index.js"]
