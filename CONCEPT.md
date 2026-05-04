# Concept

This document defines the current product concept and boundaries for Opencode-Assistant.

## Vision

Opencode-Assistant is designed as a **personal AI assistant on Telegram, with a single OpenCode CLI window at its core**.

The goal is to provide a simple, reliable, mobile-friendly way to run and monitor OpenCode workflows from Telegram while keeping behavior predictable.

## Who is this for

Opencode-Assistant targets **power users running their own instance** — typically self-hosters with a server, Raspberry Pi, or always-on laptop, comfortable with Docker and a guided setup wizard but not necessarily developers. The intended adopter wants:

- A personal AI assistant that lives in Telegram (no separate app to maintain).
- Persistent memory across sessions, without paying subscriptions.
- Skills compatible with the broader OpenClaw / Claude-skills ecosystem.
- A single-command install (`docker compose up -d`) and update flow (`git pull && docker compose up -d`).

Each adopter runs their **own** instance for themselves. This is **not** a hosted multi-tenant service, and the bot is **not** designed to serve multiple Telegram users from a single instance. The design optimizes for one person owning their data and their bot end-to-end.

## Core Concept

- Primary mode is private chat (DM) with the bot.
- The bot favors a single active interaction context for reliable flows.
- Telegram UI is used intentionally, including the bottom reply keyboard as a core UX feature.

## Non-Goals (for now)

The following are intentionally out of scope at this stage:

- Group-first usage model
- Parallel multi-session operation across multiple forum topics/threads
- Multi-user access model
- Full forum-thread orchestration as a primary interaction design

## Why This Direction

This direction is intentional and practical:

- It keeps behavior predictable and easier to stabilize.
- It reduces race conditions in interactive flows (questions, permissions, confirmations).
- It preserves the main UX pattern (reply keyboard plus a compact command surface).
- It avoids over-expanding slash commands and fragmented inline-only navigation.

Telegram limits are also a practical constraint for thread-heavy parallel usage:

- About 1 message per second per chat
- About 20 messages per minute in groups
- About 30 messages per second for bulk broadcasts (without paid broadcast)

Source: https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this

## Current Priorities

The project priorities are intentionally long-term and concept-aligned:

- Keep the bot stable and behavior predictable in daily use.
- Make the project distributable for power users: one install path (Docker), simple update flow.
- Move memory, context, skills and scheduled tasks to **SQLite as source of truth**, exposed to OpenCode through a local **MCP server** so memory becomes live across sessions instead of a snapshot at session start.
- Improve and align skills tooling with the OpenClaw / Claude-skills ecosystem (registry, integrity, validation).
- Improve test coverage and maintainability for safe iteration.
- Evolve the architecture without changing the core interaction model.

## Change Policy

If a proposal changes this concept (for example, making group threads a primary mode), open an issue/discussion first and wait for maintainer alignment before implementation.

## Revisit Conditions

This concept can be revisited later after major stability, test, and architecture milestones are completed.
