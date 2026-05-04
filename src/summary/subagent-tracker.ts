import type { ToolState } from "@opencode-ai/sdk/v2";
import { normalizeSnapshotValue } from "./aggregator-helpers.js";

export type SubagentStatus = "pending" | "running" | "completed" | "error";

export interface SubagentTokens {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface SubagentInfo {
  cardId: string;
  sessionId: string | null;
  parentSessionId: string;
  agent: string;
  description: string;
  prompt: string;
  command?: string;
  status: SubagentStatus;
  providerID?: string;
  modelID?: string;
  tokens: SubagentTokens;
  cost: number;
  currentTool?: string;
  currentToolInput?: { [key: string]: unknown };
  currentToolTitle?: string;
  terminalMessage?: string;
  updatedAt: number;
}

export interface SubagentState extends SubagentInfo {
  hasSubtaskMetadata: boolean;
  hasTaskToolMetadata: boolean;
  hasSessionTitleMetadata: boolean;
  createdAt: number;
}

export type SubagentCallback = (sessionId: string, subagents: SubagentInfo[]) => void;

interface AssistantMessageInfo {
  sessionID: string;
  providerID?: string;
  modelID?: string;
  agent?: string;
  tokens?: {
    input: number;
    output: number;
    reasoning: number;
    cache?: { read: number; write: number };
  };
  cost?: number;
}

interface StepFinishTokens {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
}

interface TaskToolDetails {
  agent?: string;
  description?: string;
  prompt?: string;
  command?: string;
}

interface SubtaskDetails {
  agent: string;
  description: string;
  prompt: string;
  command?: string;
}

/**
 * Tracks the state of subagent runs (Task tool launches, child sessions,
 * tool/step lifecycle) and emits snapshots to the registered callback.
 *
 * Owns its own subagent-specific maps and reuses the aggregator's
 * `trackedSessionParents` and `pendingChildSessionIdsByParent` by reference
 * so tracking decisions stay consistent without copying state.
 */
export class SubagentTracker {
  private callback: SubagentCallback | null = null;
  private states: Map<string, SubagentState> = new Map();
  private order: string[] = [];
  private cardIdBySessionId: Map<string, string> = new Map();
  private pendingCardIdsByParent: Map<string, string[]> = new Map();
  private fallbackCardIdsByParent: Map<string, string[]> = new Map();
  private lastSnapshot = "";

  constructor(
    private readonly trackedSessionParents: Map<string, string | null>,
    private readonly pendingChildSessionIdsByParent: Map<string, string[]>,
    private readonly getCurrentSessionId: () => string | null,
  ) {}

  setCallback(callback: SubagentCallback | null): void {
    this.callback = callback;
  }

  clear(): void {
    this.states.clear();
    this.order = [];
    this.cardIdBySessionId.clear();
    this.pendingCardIdsByParent.clear();
    this.fallbackCardIdsByParent.clear();
    this.lastSnapshot = "";
  }

  hasState(): boolean {
    return this.order.length > 0;
  }

  attachUnknownSessionToPendingSubagent(sessionId: string): boolean {
    const pendingState = this.findPendingSubagentWithoutSession();
    if (!pendingState) {
      return false;
    }

    this.trackedSessionParents.set(sessionId, pendingState.parentSessionId);
    this.attachSessionToSubagent(pendingState.cardId, sessionId);
    this.removeFromQueue(
      this.pendingChildSessionIdsByParent,
      pendingState.parentSessionId,
      sessionId,
    );
    this.emit();
    return true;
  }

  updateFromTaskTool(parentSessionId: string, input?: { [key: string]: unknown }): void {
    const subagent = this.findNextForTaskTool(parentSessionId);
    if (!subagent || !input) {
      return;
    }

    const description = typeof input.description === "string" ? input.description : undefined;
    const prompt = typeof input.prompt === "string" ? input.prompt : undefined;
    const agent = typeof input.subagent_type === "string" ? input.subagent_type : undefined;
    const command = typeof input.command === "string" ? input.command : undefined;

    if (!description && !prompt && !agent && !command) {
      return;
    }

    this.enrichFromTaskTool(subagent, { agent, description, prompt, command });
    this.emit();
  }

  updateFromAssistantMessage(info: AssistantMessageInfo): void {
    const subagent = this.getOrCreateForSession(info.sessionID);
    if (info.agent) {
      subagent.agent = info.agent;
    }
    if (info.providerID) {
      subagent.providerID = info.providerID;
    }
    if (info.modelID) {
      subagent.modelID = info.modelID;
    }
    if (info.tokens) {
      subagent.tokens = {
        input: info.tokens.input,
        output: info.tokens.output,
        reasoning: info.tokens.reasoning,
        cacheRead: info.tokens.cache?.read || 0,
        cacheWrite: info.tokens.cache?.write || 0,
      };
    }
    if (typeof info.cost === "number") {
      subagent.cost = info.cost;
    }
    subagent.updatedAt = Date.now();
    this.emit();
  }

  updateToolState(
    sessionId: string,
    state: ToolState,
    tool: string,
    input?: { [key: string]: unknown },
    title?: string,
  ): void {
    const subagent = this.getOrCreateForSession(sessionId);
    const status = "status" in state ? state.status : undefined;

    if (status === "running") {
      subagent.status = "running";
      subagent.terminalMessage = undefined;
    }

    if (status === "pending" && subagent.status === "pending") {
      subagent.status = "pending";
      subagent.terminalMessage = undefined;
    }

    subagent.currentTool = tool;
    subagent.currentToolInput = input ? { ...input } : undefined;
    subagent.currentToolTitle = title;
    subagent.updatedAt = Date.now();
    this.emit();
  }

  updateStepStart(sessionId: string, snapshot?: string): void {
    const subagent = this.getOrCreateForSession(sessionId);
    subagent.status = "running";
    subagent.terminalMessage = undefined;
    subagent.currentTool = undefined;
    subagent.currentToolInput = undefined;
    subagent.currentToolTitle = snapshot?.trim() || subagent.currentToolTitle;
    subagent.updatedAt = Date.now();
    this.emit();
  }

  updateStepFinish(
    sessionId: string,
    tokens: StepFinishTokens,
    cost: number,
    snapshot?: string,
  ): void {
    const subagent = this.getOrCreateForSession(sessionId);
    subagent.status = "running";
    subagent.terminalMessage = undefined;
    subagent.tokens = {
      input: tokens.input,
      output: tokens.output,
      reasoning: tokens.reasoning,
      cacheRead: tokens.cache.read,
      cacheWrite: tokens.cache.write,
    };
    subagent.cost += cost;
    if (snapshot?.trim()) {
      subagent.currentToolTitle = snapshot.trim();
    }
    subagent.updatedAt = Date.now();
    this.emit();
  }

  setTerminalStatus(
    sessionId: string,
    status: Extract<SubagentStatus, "completed" | "error">,
    terminalMessage?: string,
  ): void {
    const cardId = this.cardIdBySessionId.get(sessionId);
    if (!cardId) {
      return;
    }

    const subagent = this.states.get(cardId);
    if (!subagent) {
      return;
    }

    subagent.status = status;
    subagent.currentTool = undefined;
    subagent.currentToolInput = undefined;
    subagent.currentToolTitle = undefined;
    subagent.terminalMessage = terminalMessage?.trim() || undefined;
    subagent.updatedAt = Date.now();
    this.emit();
  }

  registerSubtaskPart(
    parentSessionId: string,
    partId: string,
    agent: string,
    description: string,
    prompt: string,
    command?: string,
  ): void {
    const fallbackCardId = this.dequeue(this.fallbackCardIdsByParent, parentSessionId);
    if (fallbackCardId) {
      const fallbackState = this.states.get(fallbackCardId);
      if (fallbackState) {
        this.enrichFromSubtask(fallbackState, { agent, description, prompt, command });
        this.emit();
        return;
      }
    }

    const state = this.createState(parentSessionId, null, `subtask-${parentSessionId}-${partId}`);
    this.enrichFromSubtask(state, { agent, description, prompt, command });

    const pendingChildSessionId = this.dequeue(
      this.pendingChildSessionIdsByParent,
      parentSessionId,
    );
    if (pendingChildSessionId) {
      this.attachSessionToSubagent(state.cardId, pendingChildSessionId);
    } else {
      this.getQueue(this.pendingCardIdsByParent, parentSessionId).push(state.cardId);
    }

    this.emit();
  }

  trackChildSession(sessionId: string, parentSessionId: string): void {
    this.trackedSessionParents.set(sessionId, parentSessionId);

    const pendingCardId = this.dequeue(this.pendingCardIdsByParent, parentSessionId);
    if (pendingCardId) {
      this.attachSessionToSubagent(pendingCardId, sessionId);
      this.emit();
      return;
    }

    this.getQueue(this.pendingChildSessionIdsByParent, parentSessionId).push(sessionId);
  }

  handleChildSessionInfo(info: { id: string; parentID?: string; title?: string }): void {
    if (!info.parentID) {
      return;
    }

    const subagent = this.getOrCreateForSession(info.id);
    this.enrichFromSessionTitle(subagent, info.title);
    this.emit();
  }

  private emit(): void {
    const currentSessionId = this.getCurrentSessionId();
    if (!currentSessionId || !this.callback || this.order.length === 0) {
      return;
    }

    const subagents = this.order
      .map((cardId) => this.states.get(cardId))
      .filter((state): state is SubagentState => Boolean(state))
      .map((state) => ({
        cardId: state.cardId,
        sessionId: state.sessionId,
        parentSessionId: state.parentSessionId,
        agent: state.agent,
        description: state.description,
        prompt: state.prompt,
        command: state.command,
        status: state.status,
        providerID: state.providerID,
        modelID: state.modelID,
        tokens: { ...state.tokens },
        cost: state.cost,
        currentTool: state.currentTool,
        currentToolInput: state.currentToolInput ? { ...state.currentToolInput } : undefined,
        currentToolTitle: state.currentToolTitle,
        terminalMessage: state.terminalMessage,
        updatedAt: state.updatedAt,
      }));

    const snapshot = JSON.stringify(
      subagents.map((subagent) => ({
        cardId: subagent.cardId,
        sessionId: subagent.sessionId,
        parentSessionId: subagent.parentSessionId,
        agent: subagent.agent,
        description: subagent.description,
        prompt: subagent.prompt,
        command: subagent.command,
        status: subagent.status,
        providerID: subagent.providerID,
        modelID: subagent.modelID,
        tokens: subagent.tokens,
        cost: subagent.cost,
        currentTool: subagent.currentTool,
        currentToolInput: normalizeSnapshotValue(subagent.currentToolInput),
        currentToolTitle: subagent.currentToolTitle,
        terminalMessage: subagent.terminalMessage,
      })),
    );

    if (snapshot === this.lastSnapshot) {
      return;
    }

    this.lastSnapshot = snapshot;
    this.callback(currentSessionId, subagents);
  }

  private createState(
    parentSessionId: string,
    sessionId: string | null,
    cardId: string = `subagent-${parentSessionId}-${Date.now()}-${this.order.length}`,
  ): SubagentState {
    const state: SubagentState = {
      cardId,
      sessionId,
      parentSessionId,
      agent: "",
      description: "",
      prompt: "",
      status: "pending",
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
      cost: 0,
      terminalMessage: undefined,
      updatedAt: Date.now(),
      hasSubtaskMetadata: false,
      hasTaskToolMetadata: false,
      hasSessionTitleMetadata: false,
      createdAt: Date.now(),
    };

    this.states.set(cardId, state);
    this.order.push(cardId);
    if (sessionId) {
      this.cardIdBySessionId.set(sessionId, cardId);
    }
    return state;
  }

  private enrichFromSubtask(state: SubagentState, details: SubtaskDetails): void {
    state.agent = details.agent || state.agent;
    state.description = details.description || details.prompt || state.description;
    state.prompt = details.prompt;
    state.command = details.command;
    state.hasSubtaskMetadata = true;
    state.updatedAt = Date.now();
  }

  private enrichFromTaskTool(state: SubagentState, details: TaskToolDetails): void {
    const nextDescription = details.description?.trim() || details.prompt?.trim();
    if (details.agent?.trim()) {
      state.agent = details.agent.trim();
    }
    if (nextDescription) {
      state.description = nextDescription;
    }
    if (details.prompt?.trim()) {
      state.prompt = details.prompt.trim();
    }
    if (details.command?.trim()) {
      state.command = details.command.trim();
    }
    state.hasTaskToolMetadata = true;
    state.updatedAt = Date.now();
  }

  private enrichFromSessionTitle(state: SubagentState, title?: string): void {
    const trimmedTitle = title?.trim();
    if (!trimmedTitle) {
      return;
    }

    const match = trimmedTitle.match(/^(.*?)(?:\s+\(@([^\s)]+)\s+subagent\))?$/i);
    const rawDescription = match?.[1]?.trim() || trimmedTitle;
    const rawAgent = match?.[2]?.trim();

    if (rawDescription) {
      state.description = rawDescription;
    }

    if (rawAgent) {
      state.agent = rawAgent.replace(/^@/, "");
    }

    state.hasSessionTitleMetadata = true;
    state.updatedAt = Date.now();
  }

  private attachSessionToSubagent(cardId: string, sessionId: string): void {
    const state = this.states.get(cardId);
    if (!state) {
      return;
    }

    state.sessionId = sessionId;
    state.updatedAt = Date.now();
    this.cardIdBySessionId.set(sessionId, cardId);
    this.removeFromQueue(this.pendingCardIdsByParent, state.parentSessionId, cardId);
  }

  private findPendingSubagentWithoutSession(): SubagentState | null {
    for (const cardId of this.order) {
      const state = this.states.get(cardId);
      if (state && !state.sessionId) {
        return state;
      }
    }

    return null;
  }

  private findNextForTaskTool(parentSessionId: string): SubagentState | null {
    for (const cardId of this.order) {
      const state = this.states.get(cardId);
      if (state && state.parentSessionId === parentSessionId && !state.hasTaskToolMetadata) {
        return state;
      }
    }

    return null;
  }

  private getOrCreateForSession(sessionId: string): SubagentState {
    const existingCardId = this.cardIdBySessionId.get(sessionId);
    if (existingCardId) {
      return this.states.get(existingCardId)!;
    }

    const parentSessionId =
      this.trackedSessionParents.get(sessionId) ?? this.getCurrentSessionId() ?? sessionId;
    this.removeFromQueue(this.pendingChildSessionIdsByParent, parentSessionId, sessionId);
    const state = this.createState(parentSessionId, sessionId);
    this.getQueue(this.fallbackCardIdsByParent, parentSessionId).push(state.cardId);
    return state;
  }

  private getQueue(map: Map<string, string[]>, parentSessionId: string): string[] {
    const existing = map.get(parentSessionId);
    if (existing) {
      return existing;
    }

    const queue: string[] = [];
    map.set(parentSessionId, queue);
    return queue;
  }

  private dequeue(map: Map<string, string[]>, parentSessionId: string): string | undefined {
    const queue = map.get(parentSessionId);
    if (!queue || queue.length === 0) {
      return undefined;
    }

    const value = queue.shift();
    if (queue.length === 0) {
      map.delete(parentSessionId);
    }

    return value;
  }

  private removeFromQueue(
    map: Map<string, string[]>,
    parentSessionId: string,
    value: string,
  ): void {
    const queue = map.get(parentSessionId);
    if (!queue) {
      return;
    }

    const index = queue.indexOf(value);
    if (index >= 0) {
      queue.splice(index, 1);
    }

    if (queue.length === 0) {
      map.delete(parentSessionId);
    }
  }
}
