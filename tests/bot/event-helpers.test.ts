import { describe, expect, it } from "vitest";
import {
  type EventStreamItem,
  getEventSessionId,
  getToolStreamKey,
  prepareDocumentCaption,
  shouldMarkAttachedBusyFromEvent,
} from "../../src/bot/event-helpers.js";

describe("bot/event-helpers", () => {
  describe("prepareDocumentCaption", () => {
    it("returns empty string for whitespace-only input", () => {
      expect(prepareDocumentCaption("")).toBe("");
      expect(prepareDocumentCaption("   ")).toBe("");
      expect(prepareDocumentCaption("\n\t  ")).toBe("");
    });

    it("trims and returns short captions unchanged", () => {
      expect(prepareDocumentCaption("  hello world  ")).toBe("hello world");
    });

    it("preserves captions exactly at the Telegram caption limit (1024 chars)", () => {
      const exactLimit = "a".repeat(1024);
      expect(prepareDocumentCaption(exactLimit)).toBe(exactLimit);
    });

    it("truncates captions over 1024 chars and appends an ellipsis", () => {
      const longCaption = "a".repeat(2000);
      const result = prepareDocumentCaption(longCaption);
      expect(result.length).toBe(1024);
      expect(result.endsWith("...")).toBe(true);
      expect(result.slice(0, 1021)).toBe("a".repeat(1021));
    });
  });

  describe("getToolStreamKey", () => {
    it("returns 'todo' only for the todowrite tool", () => {
      expect(getToolStreamKey("todowrite")).toBe("todo");
    });

    it("returns 'default' for any other tool", () => {
      expect(getToolStreamKey("bash")).toBe("default");
      expect(getToolStreamKey("write")).toBe("default");
      expect(getToolStreamKey("edit")).toBe("default");
      expect(getToolStreamKey("read")).toBe("default");
      expect(getToolStreamKey("")).toBe("default");
    });
  });

  describe("getEventSessionId", () => {
    it("reads sessionID from properties.sessionID", () => {
      const event: EventStreamItem = {
        type: "session.idle",
        properties: { sessionID: "S1" },
      };
      expect(getEventSessionId(event)).toBe("S1");
    });

    it("falls back to properties.info.sessionID", () => {
      const event: EventStreamItem = {
        type: "message.updated",
        properties: { info: { sessionID: "S2" } },
      };
      expect(getEventSessionId(event)).toBe("S2");
    });

    it("falls back to properties.part.sessionID", () => {
      const event: EventStreamItem = {
        type: "message.part.updated",
        properties: { part: { sessionID: "S3" } },
      };
      expect(getEventSessionId(event)).toBe("S3");
    });

    it("prefers top-level sessionID over nested locations", () => {
      const event: EventStreamItem = {
        type: "message.part.updated",
        properties: {
          sessionID: "TOP",
          info: { sessionID: "INFO" },
          part: { sessionID: "PART" },
        },
      };
      expect(getEventSessionId(event)).toBe("TOP");
    });

    it("returns null when no sessionID is present anywhere", () => {
      const event: EventStreamItem = {
        type: "unknown",
        properties: {},
      };
      expect(getEventSessionId(event)).toBeNull();
    });
  });

  describe("shouldMarkAttachedBusyFromEvent", () => {
    it("returns true for session.status with status.type === 'busy'", () => {
      expect(
        shouldMarkAttachedBusyFromEvent({
          type: "session.status",
          properties: { status: { type: "busy" } },
        }),
      ).toBe(true);
    });

    it("returns false for session.status with non-busy status types", () => {
      expect(
        shouldMarkAttachedBusyFromEvent({
          type: "session.status",
          properties: { status: { type: "retry" } },
        }),
      ).toBe(false);

      expect(
        shouldMarkAttachedBusyFromEvent({
          type: "session.status",
          properties: { status: { type: "idle" } },
        }),
      ).toBe(false);

      expect(
        shouldMarkAttachedBusyFromEvent({
          type: "session.status",
          properties: {},
        }),
      ).toBe(false);
    });

    it("returns true for an in-flight assistant message.updated (no completed timestamp)", () => {
      expect(
        shouldMarkAttachedBusyFromEvent({
          type: "message.updated",
          properties: {
            info: { role: "assistant", time: { completed: 0 } },
          },
        }),
      ).toBe(true);
    });

    it("returns false for a completed assistant message.updated", () => {
      expect(
        shouldMarkAttachedBusyFromEvent({
          type: "message.updated",
          properties: {
            info: { role: "assistant", time: { completed: 12345 } },
          },
        }),
      ).toBe(false);
    });

    it("returns false for user role on message.updated", () => {
      expect(
        shouldMarkAttachedBusyFromEvent({
          type: "message.updated",
          properties: {
            info: { role: "user", time: {} },
          },
        }),
      ).toBe(false);
    });

    it("returns true for message.part.updated, message.part.delta, question.asked, permission.asked", () => {
      const types = [
        "message.part.updated",
        "message.part.delta",
        "question.asked",
        "permission.asked",
      ];
      for (const type of types) {
        expect(
          shouldMarkAttachedBusyFromEvent({ type, properties: {} }),
        ).toBe(true);
      }
    });

    it("returns false for any unrelated event type", () => {
      expect(
        shouldMarkAttachedBusyFromEvent({ type: "session.idle", properties: {} }),
      ).toBe(false);
      expect(
        shouldMarkAttachedBusyFromEvent({ type: "session.error", properties: {} }),
      ).toBe(false);
      expect(
        shouldMarkAttachedBusyFromEvent({ type: "session.created", properties: {} }),
      ).toBe(false);
      expect(
        shouldMarkAttachedBusyFromEvent({ type: "permission.replied", properties: {} }),
      ).toBe(false);
    });
  });
});
