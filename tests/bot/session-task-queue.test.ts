import { afterEach, describe, expect, it } from "vitest";
import {
  clearSessionCompletionTasks,
  enqueueSessionCompletionTask,
  getSessionCompletionTask,
} from "../../src/bot/session-task-queue.js";

/**
 * Helper: deferred promise — resolved/rejected externally.
 */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("bot/session-task-queue", () => {
  afterEach(() => {
    clearSessionCompletionTasks();
  });

  it("serializes tasks for the same session", async () => {
    const events: string[] = [];
    const taskA = deferred<void>();

    enqueueSessionCompletionTask("session-1", async () => {
      events.push("A:start");
      await taskA.promise;
      events.push("A:end");
    });

    const taskB = deferred<void>();
    enqueueSessionCompletionTask("session-1", async () => {
      events.push("B:start");
      await taskB.promise;
      events.push("B:end");
    });

    // Yield: A starts but B must NOT start until A finishes.
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["A:start"]);

    taskA.resolve();
    // Wait for A to settle and B to start
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(events).toEqual(["A:start", "A:end", "B:start"]);

    taskB.resolve();
    await new Promise((r) => setImmediate(r));
    expect(events).toEqual(["A:start", "A:end", "B:start", "B:end"]);
  });

  it("runs tasks for different sessions independently", async () => {
    const events: string[] = [];
    const slowSession1 = deferred<void>();

    enqueueSessionCompletionTask("session-1", async () => {
      events.push("S1:start");
      await slowSession1.promise;
      events.push("S1:end");
    });

    enqueueSessionCompletionTask("session-2", async () => {
      events.push("S2:start");
      events.push("S2:end");
    });

    // Session-2 must complete without waiting for session-1
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(events).toContain("S2:start");
    expect(events).toContain("S2:end");
    expect(events).not.toContain("S1:end");

    slowSession1.resolve();
    await new Promise((r) => setImmediate(r));
    expect(events).toContain("S1:end");
  });

  it("continues the chain even when a task throws", async () => {
    const events: string[] = [];

    enqueueSessionCompletionTask("session-1", async () => {
      events.push("A:throwing");
      throw new Error("boom");
    });

    const result = enqueueSessionCompletionTask("session-1", async () => {
      events.push("B:ran");
    });

    await result;
    expect(events).toEqual(["A:throwing", "B:ran"]);
  });

  it("getSessionCompletionTask returns the active promise (and undefined when idle)", async () => {
    expect(getSessionCompletionTask("session-1")).toBeUndefined();

    const blocker = deferred<void>();
    const task = enqueueSessionCompletionTask("session-1", () => blocker.promise);

    // While the task is pending, the queue holds it
    expect(getSessionCompletionTask("session-1")).toBe(task);

    blocker.resolve();
    await task;

    // After settle, the slot is cleared
    expect(getSessionCompletionTask("session-1")).toBeUndefined();
  });

  it("clearSessionCompletionTasks resets the internal state", async () => {
    const blocker = deferred<void>();
    enqueueSessionCompletionTask("session-1", () => blocker.promise);
    expect(getSessionCompletionTask("session-1")).toBeDefined();

    clearSessionCompletionTasks();
    expect(getSessionCompletionTask("session-1")).toBeUndefined();

    // Resolve the original blocker so we don't leave a dangling promise
    blocker.resolve();
  });
});
