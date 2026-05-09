import { describe, expect, it } from "vitest";
import { isKnownCommand, parseSlashCommand } from "../../../src/whatsapp/commands/router.js";

describe("parseSlashCommand", () => {
  it("returns null for non-slash text", () => {
    expect(parseSlashCommand("hola")).toBeNull();
    expect(parseSlashCommand("")).toBeNull();
    expect(parseSlashCommand("   ")).toBeNull();
  });

  it("parses a bare command", () => {
    expect(parseSlashCommand("/status")).toEqual({ name: "status", args: "" });
  });

  it("parses a command with arguments", () => {
    expect(parseSlashCommand("/sessions 2")).toEqual({ name: "sessions", args: "2" });
  });

  it("normalises the command name to lowercase", () => {
    expect(parseSlashCommand("/Status")).toEqual({ name: "status", args: "" });
  });

  it("trims surrounding whitespace from args", () => {
    expect(parseSlashCommand("/new   foo bar  ")).toEqual({ name: "new", args: "foo bar" });
  });

  it("returns null for /-only text", () => {
    expect(parseSlashCommand("/")).toBeNull();
    expect(parseSlashCommand("/ status")).toBeNull();
  });
});

describe("isKnownCommand", () => {
  it("recognises core commands", () => {
    expect(isKnownCommand("status")).toBe(true);
    expect(isKnownCommand("new")).toBe(true);
    expect(isKnownCommand("sessions")).toBe(true);
    expect(isKnownCommand("abort")).toBe(true);
    expect(isKnownCommand("help")).toBe(true);
  });

  it("recognises common aliases", () => {
    expect(isKnownCommand("cancel")).toBe(true);
    expect(isKnownCommand("stop")).toBe(true);
    expect(isKnownCommand("start")).toBe(true);
  });

  it("rejects unknown commands", () => {
    expect(isKnownCommand("nope")).toBe(false);
  });
});
