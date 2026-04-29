# Concept

This document defines the current product concept and boundaries for OpenCode Telegram Bot.

## Vision

OpenCode Telegram Bot is designed as a **single OpenCode CLI window in Telegram**.

The goal is to provide a simple, reliable, mobile-friendly way to run and monitor OpenCode workflows from Telegram while keeping behavior predictable.

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

You can try fork of this project which supports topics and parallel execution: https://github.com/shanekunz/opencode-telegram-group-topics-bot

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

- Keep the bot stable and behavior predictable in daily use
- Expand functionality within the current concept boundaries
- Improve test coverage and maintainability for safe iteration
- Evolve the architecture without changing the core interaction model

## Change Policy

If a proposal changes this concept (for example, making group threads a primary mode), open an issue/discussion first and wait for maintainer alignment before implementation.

## Revisit Conditions

This concept can be revisited later after major stability, test, and architecture milestones are completed.
