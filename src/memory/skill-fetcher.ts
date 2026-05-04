import http from "node:http";
import https from "node:https";

const DOWNLOAD_TIMEOUT_MS = 15_000;

/**
 * Downloads the body of `url` as UTF-8 text. Used by the skill install
 * and skill update flows. Kept dependency-free and side-effect-free so
 * it can be reused by a future scheduled-task auto-update worker
 * without dragging the bot's grammY context along.
 */
export function downloadUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    const req = client.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode ?? "unknown"} from ${url}`));
        res.resume();
        return;
      }

      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      res.on("error", reject);
    });

    req.on("error", reject);
    req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
      req.destroy(new Error(`Request timeout after ${DOWNLOAD_TIMEOUT_MS}ms: ${url}`));
    });
  });
}

/**
 * GitHub blob URLs (`https://github.com/<owner>/<repo>/blob/<ref>/<path>`)
 * are HTML pages, not raw text. Convert them to the raw form so the
 * downloader gets the actual SKILL.md content. Returns the input
 * unchanged when it is not a GitHub blob URL.
 */
export function toRawGitHubUrl(url: string): string {
  if (!url.includes("github.com") || !url.includes("/blob/")) {
    return url;
  }
  return url
    .replace("https://github.com/", "https://raw.githubusercontent.com/")
    .replace("/blob/", "/");
}
