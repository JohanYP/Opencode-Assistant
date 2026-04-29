import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getRuntimeMode, resolveRuntimeMode, setRuntimeMode } from "../../src/runtime/mode.js";

describe("runtime/mode", () => {
  beforeEach(() => {
    delete process.env.OPENCODE_TELEGRAM_RUNTIME_MODE;
  });

  afterEach(() => {
    delete process.env.OPENCODE_TELEGRAM_RUNTIME_MODE;
  });

  it("uses default mode when no override is provided", () => {
    const result = resolveRuntimeMode({ defaultMode: "sources", argv: [] });

    expect(result).toEqual({ mode: "sources" });
  });

  it("resolves installed mode from argv", () => {
    const result = resolveRuntimeMode({
      defaultMode: "sources",
      argv: ["--mode", "installed"],
    });

    expect(result).toEqual({ mode: "installed" });
  });

  it("resolves sources mode from argv", () => {
    const result = resolveRuntimeMode({
      defaultMode: "installed",
      argv: ["--mode", "sources"],
    });

    expect(result).toEqual({ mode: "sources" });
  });

  it("treats unknown mode as invalid", () => {
    const result = resolveRuntimeMode({
      defaultMode: "installed",
      argv: ["--mode=invalid"],
    });

    expect(result.mode).toBe("installed");
    expect(result.error).toContain("Invalid value for --mode");
  });

  it("returns validation error for invalid mode", () => {
    const result = resolveRuntimeMode({
      defaultMode: "sources",
      argv: ["--mode", "qa"],
    });

    expect(result.mode).toBe("sources");
    expect(result.error).toContain("Invalid value for --mode");
  });

  it("prefers explicit mode over argv", () => {
    const result = resolveRuntimeMode({
      defaultMode: "sources",
      explicitMode: "installed",
      argv: ["--mode", "sources"],
    });

    expect(result).toEqual({ mode: "installed" });
  });

  it("stores and returns current runtime mode", () => {
    setRuntimeMode("installed");
    expect(getRuntimeMode()).toBe("installed");

    setRuntimeMode("sources");
    expect(getRuntimeMode()).toBe("sources");
  });
});
