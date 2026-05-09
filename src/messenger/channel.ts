// Canonical name of a messaging channel. The bot may run on either or both
// of these surfaces; cross-cutting concerns (memory injection, session
// tracking, reminder targets, logging) discriminate behavior using this
// type rather than passing untyped strings.

export type Channel = "telegram" | "whatsapp";

export const CHANNELS: ReadonlyArray<Channel> = ["telegram", "whatsapp"] as const;

export function isChannel(value: unknown): value is Channel {
  return value === "telegram" || value === "whatsapp";
}
