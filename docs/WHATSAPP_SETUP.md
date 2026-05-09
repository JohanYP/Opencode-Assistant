# WhatsApp setup (optional second channel)

The bot can connect to WhatsApp as a second channel alongside Telegram, using a **separate dedicated phone number**. Opt-in, disabled by default.

## What works in V1

- ✅ QR-code pairing on first start; session persisted across restarts
- ✅ Whitelist by phone number (single-user)
- ✅ Slash commands: `/status`, `/new`, `/sessions`, `/abort`, `/help`
- ✅ Free-text prompts → OpenCode → assistant reply (chunked across messages for long answers)
- ✅ Voice notes inbound: STT-transcribed and routed as prompts
- ✅ Voice replies outbound: when global `/tts` is on (toggled from Telegram), the bot also sends an MP3 audio after the text reply
- ✅ Numbered-menu reply for `/sessions` (reply with `1`, `2`, ...)
- ✅ Reminders and weekly memory backup notifications fire on **both** channels (Telegram + WhatsApp), driven by a multi-target registry in `cron/reminder.ts`

## Known V1 limitations

- ⚠️ **Permission and question dialogs still live in Telegram.** When a prompt sent from WhatsApp triggers a permission request (bash, edit, webfetch...) or a question, the dialog appears in Telegram. Approve there and the WhatsApp prompt completes. If you don't have a Telegram device handy, the prompt will block until it times out. Mirroring these dialogs to WhatsApp as numbered menus is on the V1.x roadmap (requires SSE fanout + dual state managers).
- ⚠️ **No streaming responses** — WhatsApp users see the final reply only, not intermediate tool-call updates. The bot uses `session.prompt` (sync) instead of `promptAsync` + SSE.
- ⚠️ **Audio output is plain MP3, not push-to-talk** (no waveform UI). PTT requires OPUS encoding which would need ffmpeg in the container; deferred to V1.x.
- ⚠️ **No model/agent/variant pickers, no `/skills`, no `/projects`, no `/task`** from WhatsApp. Use Telegram for those.
- ⚠️ **Concurrent prompts on the same session are rejected** with a "previous task is still running" hint.

## Requirements

- A **dedicated WhatsApp account** (a phone number that will be the bot). Don't link your main personal account — Meta may ban numbers that talk to unofficial clients like Baileys.
- Docker running with this project's compose stack.

## Configuration

In `.env`:

```bash
WHATSAPP_ENABLED=true
WHATSAPP_ALLOWED_NUMBER=34666999999    # country code + number, no +
# WHATSAPP_AUTH_DIR=./data/whatsapp-auth   # default; rarely overridden
```

`WHATSAPP_ALLOWED_NUMBER` accepts either bare digits (`34666999999`) or full Baileys JID (`34666999999@s.whatsapp.net`). The bot normalizes both.

## First start

```bash
docker compose up -d --build
docker compose logs -f bot
```

The first time, you'll see a QR code rendered as ASCII in the logs. Scan it from the phone with your dedicated WhatsApp account:

1. Open WhatsApp → **Settings → Linked Devices → Link a device**
2. Aim the camera at the QR in your terminal
3. Logs show `[WhatsApp] Connected as <jid>`

After that, send `/help` from that account to confirm everything works.

## Subsequent restarts

The session is persisted in the `whatsapp-auth` Docker volume (`/app/data/whatsapp-auth` inside the container). `docker compose restart bot` does NOT require a new QR scan.

## Common issues

**"Session was logged out" in logs**
You removed the linked device from your phone, or Meta invalidated the session. The auth dir is wiped automatically; restart and scan QR again.

**Messages from a different number arrive but get ignored**
Working as intended. Only `WHATSAPP_ALLOWED_NUMBER` is allowed. Check logs for `[WhatsApp] Ignoring message from non-whitelisted JID`.

**The QR doesn't render correctly in my terminal**
Make sure your terminal supports UTF-8 block characters and is wide enough. Try `docker compose logs --no-color bot`. If it still doesn't render, set `WHATSAPP_AUTH_DIR` to a host path and run the bot outside Docker for the first scan.

**A prompt I sent from WhatsApp is hanging**
The model probably hit a permission request or question. Open Telegram on the same account — the inline dialog should be there. Approve/answer it and your WhatsApp prompt will complete.

**Voice notes don't get transcribed**
STT must be configured (`STT_API_URL` and `STT_API_KEY`). See the main `README.md` for STT provider options (Groq Whisper free tier recommended).

**Number got banned**
Inherent risk of Baileys. Use a dedicated number you don't mind losing, avoid spam-like patterns, and don't link the same number to multiple unofficial clients.
