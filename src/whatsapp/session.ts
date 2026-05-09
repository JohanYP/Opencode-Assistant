import fs from "node:fs/promises";
import path from "node:path";
import qrcode from "qrcode-terminal";
import pino from "pino";
import {
  default as makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  DisconnectReason,
  type WASocket,
  type ConnectionState,
} from "@whiskeysockets/baileys";
import type { Boom } from "@hapi/boom";

import { config } from "../config.js";
import { logger } from "../utils/logger.js";

// Baileys logs are noisy and not aligned with the rest of the bot. Pipe them
// through a silent pino so internal Baileys events don't pollute our logs.
const baileysLogger = pino({ level: "silent" });

export interface BaileysSession {
  // Returns the current live socket. The reference changes on reconnect —
  // do NOT cache it. Bind handlers via `onOpen` instead.
  getSocket(): WASocket;
  // Resolves once the first successful connection happens (the QR has been
  // scanned and Baileys reports state "open").
  whenConnected: Promise<void>;
  close: () => Promise<void>;
}

export interface SessionOptions {
  authDir: string;
  // Render a fresh QR string. Override in tests; default prints to stdout.
  onQr?: (qr: string) => void;
  // Fires after every successful (re)connection. Bind `messages.upsert` and
  // any other event handlers here — they need to be re-bound to the fresh
  // socket whenever Baileys reconnects.
  onOpen?: (socket: WASocket) => void;
  onConnected?: (info: { jid: string }) => void;
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

function defaultRenderQr(qr: string): void {
  qrcode.generate(qr, { small: true });
  logger.info("[WhatsApp] Scan the QR above with WhatsApp -> Linked Devices.");
}

export async function openBaileysSession(options: SessionOptions): Promise<BaileysSession> {
  const authDir = path.resolve(options.authDir);
  await ensureDir(authDir);

  const renderQr = options.onQr ?? defaultRenderQr;

  let currentSocket: WASocket | null = null;
  let stopRequested = false;
  let firstConnectResolve: (() => void) | null = null;
  let firstConnectReject: ((err: Error) => void) | null = null;
  const whenConnected = new Promise<void>((resolve, reject) => {
    firstConnectResolve = resolve;
    firstConnectReject = reject;
  });

  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  // Fetch the latest WhatsApp Web protocol version once at startup. The
  // server rejects (HTTP 405) clients that send an outdated version tuple,
  // and Baileys' bundled default lags behind real WhatsApp by weeks. We
  // fall back to the bundled version only if the lookup fails (offline /
  // GitHub down) so the bot still tries — better an attempt than a hang.
  let waVersion: [number, number, number] | undefined;
  try {
    const fetched = await fetchLatestBaileysVersion();
    waVersion = fetched.version;
    logger.info(
      `[WhatsApp] Using WA Web protocol version ${waVersion.join(".")}` +
        (fetched.isLatest ? "" : " (server may have rolled out a newer one)"),
    );
  } catch (err) {
    logger.warn(
      "[WhatsApp] Could not fetch latest WA Web version, using bundled default",
      err,
    );
  }

  // Track repeated 405s so we don't reconnect-spam the server. After a few
  // attempts in a row, back off a lot more (and log a clearer hint to the
  // user that they likely need to update Baileys).
  let consecutiveFailures = 0;

  const connect = async (): Promise<void> => {
    const sock = makeWASocket({
      auth: state,
      logger: baileysLogger,
      printQRInTerminal: false,
      // Use the canonical browser tuple Baileys ships with — custom strings
      // like ["Opencode-Assistant", "Chrome", "1.0"] are flagged by some
      // versions of the WA backend and contribute to the 405 rejection.
      browser: Browsers.ubuntu("Chrome"),
      version: waVersion,
      generateHighQualityLinkPreview: false,
    });

    currentSocket = sock;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update: Partial<ConnectionState>) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        renderQr(qr);
      }

      if (connection === "open") {
        const jid = sock.user?.id ?? "unknown";
        logger.info(`[WhatsApp] Connected as ${jid}`);
        consecutiveFailures = 0;
        options.onOpen?.(sock);
        options.onConnected?.({ jid });
        if (firstConnectResolve) {
          firstConnectResolve();
          firstConnectResolve = null;
          firstConnectReject = null;
        }
        return;
      }

      if (connection === "close") {
        const reason = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
        const isLoggedOut = reason === DisconnectReason.loggedOut;

        if (isLoggedOut) {
          logger.warn(
            "[WhatsApp] Session was logged out (linked device removed). " +
              `Wiping ${authDir} — next start will require a new QR scan.`,
          );
          fs.rm(authDir, { recursive: true, force: true }).catch((err) => {
            logger.warn("[WhatsApp] Failed to wipe authDir after logout", err);
          });
          if (firstConnectReject) {
            firstConnectReject(new Error("WhatsApp session logged out"));
            firstConnectResolve = null;
            firstConnectReject = null;
          }
          return;
        }

        if (stopRequested) {
          logger.info("[WhatsApp] Connection closed (stop requested).");
          return;
        }

        consecutiveFailures += 1;
        // 405 is a hard "your client is not acceptable" — usually means the
        // bundled WA Web protocol version is stale. We already pulled the
        // latest version above, so a persistent 405 means even GitHub's
        // tracked version is behind: tell the user to bump Baileys.
        if (reason === 405 && consecutiveFailures >= 3) {
          logger.error(
            "[WhatsApp] Repeated HTTP 405 from WhatsApp — your installed " +
              "@whiskeysockets/baileys is too old for the current WA Web " +
              "protocol. Run `npm install @whiskeysockets/baileys@latest` " +
              "in the bot container, then `docker compose up -d --build bot`.",
          );
        }

        // Cap exponential backoff at 30s to avoid hammering on transient
        // network issues but still recover quickly when WA is back.
        const backoffMs = Math.min(2000 * 2 ** Math.min(consecutiveFailures - 1, 4), 30_000);
        logger.warn(
          `[WhatsApp] Connection closed (reason=${reason ?? "unknown"}, attempt=${consecutiveFailures}), reconnecting in ${backoffMs}ms...`,
        );
        setTimeout(() => {
          if (!stopRequested) {
            void connect().catch((err) => {
              logger.error("[WhatsApp] Reconnect failed", err);
            });
          }
        }, backoffMs);
      }
    });
  };

  await connect();

  return {
    getSocket: () => {
      if (!currentSocket) {
        throw new Error("WhatsApp socket is not initialized");
      }
      return currentSocket;
    },
    whenConnected,
    close: async () => {
      stopRequested = true;
      try {
        currentSocket?.end(undefined);
      } catch (err) {
        logger.warn("[WhatsApp] Error while closing socket", err);
      }
    },
  };
}

export function getConfiguredAuthDir(): string {
  return config.whatsapp.authDir;
}
