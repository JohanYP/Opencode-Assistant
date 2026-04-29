import { beforeEach, afterEach, vi } from "vitest";
import { ensureTestEnvironment } from "./helpers/test-environment.js";
import { resetSingletonState } from "./helpers/reset-singleton-state.js";

ensureTestEnvironment();

beforeEach(() => {
  ensureTestEnvironment();
  return resetSingletonState();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  ensureTestEnvironment();
  return resetSingletonState();
});
