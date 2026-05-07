import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { computeNextCronRunAt } from "./next-run.js";
import type { ScheduledTask, ScheduledTaskModel } from "./types.js";

/**
 * Headless scheduled-task constructor used both by the `/task` Telegram
 * command and by the `task_create` MCP tool.
 *
 * Unlike the original interactive flow, this version does NOT call out
 * to OpenCode to LLM-parse natural-language schedules. Callers must
 * supply either a 5-field cron expression (`schedule.cron`) or an ISO
 * datetime (`schedule.runAt`). The MCP tool exposes both so the model
 * picks the right one based on user intent.
 */

export type BuildTaskType = "task" | "reminder" | "backup";

export interface BuildScheduleCron {
  kind: "cron";
  cron: string;
  /** IANA timezone, e.g. "America/Bogota". Defaults to the system TZ. */
  timezone?: string;
}

export interface BuildScheduleOnce {
  kind: "once";
  /** ISO 8601 datetime in the future. */
  runAt: string;
  timezone?: string;
}

export type BuildSchedule = BuildScheduleCron | BuildScheduleOnce;

export interface BuildTaskInput {
  type: BuildTaskType;
  schedule: BuildSchedule;
  projectId: string;
  projectWorktree: string;
  model: ScheduledTaskModel;
  /** Required for type=task and type=reminder; ignored for type=backup. */
  prompt?: string;
  /** When given, used as a custom human-readable label in `/tasklist`. */
  scheduleSummary?: string;
}

export class TaskBuilderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskBuilderError";
  }
}

const CRON_FIELD_COUNT = 5;
const MIN_CRON_INTERVAL_MIN = 5;

/**
 * Reject cron expressions that would fire more often than once every
 * 5 minutes. The same guardrail used by the `/task` Telegram flow —
 * keeps a runaway cron from exhausting the model budget.
 */
function validateCronFrequency(cron: string): void {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== CRON_FIELD_COUNT) {
    throw new TaskBuilderError(
      `Invalid cron expression "${cron}" (expected 5 fields: minute hour dom month dow).`,
    );
  }
  const minuteField = parts[0];

  // Comma-separated minute lists: each pair must be ≥5 apart, and the
  // wraparound (last → first+60) too.
  if (minuteField.includes(",")) {
    const values = minuteField
      .split(",")
      .map((v) => Number.parseInt(v, 10))
      .filter((v) => Number.isFinite(v))
      .sort((a, b) => a - b);
    if (values.length === 0) return;
    for (let i = 0; i < values.length; i++) {
      const next = i === values.length - 1 ? values[0] + 60 : values[i + 1];
      if (next - values[i] < MIN_CRON_INTERVAL_MIN) {
        throw new TaskBuilderError(
          `Cron schedule fires too often (gap ${next - values[i]} min < ${MIN_CRON_INTERVAL_MIN}). Edit the minute field to space runs.`,
        );
      }
    }
    return;
  }

  // Step expressions like */N or M-N/STEP.
  const stepMatch = minuteField.match(/\/(\d+)$/);
  if (stepMatch) {
    const step = Number.parseInt(stepMatch[1], 10);
    if (Number.isFinite(step) && step < MIN_CRON_INTERVAL_MIN) {
      throw new TaskBuilderError(
        `Cron schedule fires every ${step} min, below the ${MIN_CRON_INTERVAL_MIN}-min minimum.`,
      );
    }
  }
}

function defaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function summarizeSchedule(schedule: BuildSchedule, fallback?: string): string {
  if (fallback && fallback.trim()) return fallback.trim();
  if (schedule.kind === "cron") return `cron: ${schedule.cron}`;
  return `once at ${schedule.runAt}`;
}

export function buildScheduledTask(input: BuildTaskInput): ScheduledTask {
  if (!input.projectId || !input.projectWorktree) {
    throw new TaskBuilderError("projectId and projectWorktree are required");
  }
  if (!input.model.providerID || !input.model.modelID) {
    throw new TaskBuilderError("model.providerID and model.modelID are required");
  }
  if ((input.type === "task" || input.type === "reminder") && !input.prompt?.trim()) {
    throw new TaskBuilderError(`prompt is required for type=${input.type}`);
  }

  const timezone = input.schedule.timezone || defaultTimezone();
  const summary = summarizeSchedule(input.schedule, input.scheduleSummary);

  let nextRunAt: string;
  if (input.schedule.kind === "cron") {
    validateCronFrequency(input.schedule.cron);
    nextRunAt = computeNextCronRunAt(input.schedule.cron, timezone);
  } else {
    const runAtMs = Date.parse(input.schedule.runAt);
    if (Number.isNaN(runAtMs)) {
      throw new TaskBuilderError(
        `Invalid runAt "${input.schedule.runAt}" — must be ISO 8601 (e.g. 2026-05-07T09:00:00).`,
      );
    }
    if (runAtMs <= Date.now()) {
      throw new TaskBuilderError(
        `runAt "${input.schedule.runAt}" is in the past — pick a future datetime.`,
      );
    }
    nextRunAt = new Date(runAtMs).toISOString();
  }

  const baseTask = {
    id: randomUUID(),
    type: input.type,
    projectId: input.projectId,
    projectWorktree: input.projectWorktree,
    model: input.model,
    scheduleText: summary,
    scheduleSummary: summary,
    timezone,
    prompt: input.prompt ?? "",
    createdAt: new Date().toISOString(),
    nextRunAt,
    lastRunAt: null,
    runCount: 0,
    lastStatus: "idle" as const,
    lastError: null,
  };

  if (input.schedule.kind === "cron") {
    return {
      ...baseTask,
      kind: "cron",
      cron: input.schedule.cron,
    };
  }

  return {
    ...baseTask,
    kind: "once",
    runAt: input.schedule.runAt,
  };
}

/**
 * Returns the configured upper bound on number of stored scheduled
 * tasks. Used by callers that need to enforce the limit before
 * inserting a new one.
 */
export function getScheduledTaskLimit(): number {
  return config.bot.taskLimit;
}
