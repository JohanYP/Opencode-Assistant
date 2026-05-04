import type { ToolStreamKey } from "./streaming/tool-call-streamer.js";

const TELEGRAM_DOCUMENT_CAPTION_MAX_LENGTH = 1024;

export type EventStreamItem = {
  type: string;
  properties: Record<string, unknown>;
};

export function prepareDocumentCaption(caption: string): string {
  const normalizedCaption = caption.trim();
  if (!normalizedCaption) {
    return "";
  }

  if (normalizedCaption.length <= TELEGRAM_DOCUMENT_CAPTION_MAX_LENGTH) {
    return normalizedCaption;
  }

  return `${normalizedCaption.slice(0, TELEGRAM_DOCUMENT_CAPTION_MAX_LENGTH - 3)}...`;
}

export function getToolStreamKey(tool: string): ToolStreamKey {
  if (tool === "todowrite") {
    return "todo";
  }

  return "default";
}

export function getEventSessionId(event: EventStreamItem): string | null {
  const properties = event.properties as {
    sessionID?: string;
    info?: { sessionID?: string };
    part?: { sessionID?: string };
  };

  return properties.sessionID || properties.info?.sessionID || properties.part?.sessionID || null;
}

export function shouldMarkAttachedBusyFromEvent(event: EventStreamItem): boolean {
  switch (event.type) {
    case "session.status":
      return (event.properties as { status?: { type?: string } }).status?.type === "busy";
    case "message.updated": {
      const info = (event.properties as { info?: { role?: string; time?: { completed?: number } } })
        .info;
      return info?.role === "assistant" && !info.time?.completed;
    }
    case "message.part.updated":
    case "message.part.delta":
    case "question.asked":
    case "permission.asked":
      return true;
    default:
      return false;
  }
}
