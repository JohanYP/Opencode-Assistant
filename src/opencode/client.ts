import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import { config } from "../config.js";

const getAuth = () => {
  if (!config.opencode.password) {
    return undefined;
  }
  const credentials = `${config.opencode.username}:${config.opencode.password}`;
  return `Basic ${Buffer.from(credentials).toString("base64")}`;
};

export const opencodeClient = createOpencodeClient({
  baseUrl: config.opencode.apiUrl,
  headers: config.opencode.password ? { Authorization: getAuth() } : undefined,
});
