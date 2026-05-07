# TTS providers

The bot can synthesize voice replies through four providers. They're
all opt-in (audio replies are off until you `/tts on`), and you can
switch between them at any time without restarting Docker.

| Provider | API key needed? | Free tier | Notes |
|---|---|---|---|
| **edge** | ❌ No | Unlimited (Microsoft public endpoint) | Recommended fallback. ~400 neural voices, 140+ locales. |
| **speechify** | ✅ Yes | 50 000 chars/month | Most natural-sounding voices in English. |
| **openai** | ✅ Yes | No free tier | Use any OpenAI-compatible `/audio/speech` endpoint. |
| **google** | ✅ Yes (service account JSON) | $$$ small free tier | Studio voices are excellent but pricey. |

**TL;DR:** if you don't want to configure anything, run `/tts provider edge`
and `/tts on`. You'll get a free, high-quality voice immediately.

## Setting things from Telegram

The `/tts` command is the source of truth for runtime overrides. Anything
you set with `/tts ...` lives in `settings.json` and survives restarts.

```
/tts                              # show current config + how to change it
/tts on | off                     # toggle audio replies globally
/tts provider edge|speechify|openai|google
/tts voice <id>                   # change voice (use /tts list to see options)
/tts speed 0.5..2.0               # speak faster or slower
/tts list [provider] [locale]     # list available voices, optionally filtered
```

Examples:

```
/tts provider edge
/tts list edge es                 # all Spanish-locale Edge voices
/tts voice es-ES-ElviraNeural
/tts speed 1.15
/tts on
```

The status line shows the source of each setting (`env` from `.env`,
`override` from `/tts`, `default` when neither is set):

```
🎙 TTS settings
Enabled: ✓
Provider: edge (override)
Voice: es-ES-ElviraNeural (override)
Speed: 1.15
```

## Setting things from the assistant

The MCP layer exposes three tools so the assistant can change TTS in
the middle of a conversation without you running commands:

- `tts_get_settings` — read current state, including the source of each field
- `tts_set_settings({ provider?, voice?, speed?, enabled? })` — update any subset
- `tts_list_voices({ provider?, locale?, limit? })` — discover voice IDs

So you can simply ask:

> "switch to a Spanish female voice"

and the assistant calls `tts_list_voices({ provider: "edge", locale: "es" })`,
picks one (e.g. `es-ES-ElviraNeural`), and calls
`tts_set_settings({ voice: "es-ES-ElviraNeural" })`. Persists across restarts.

## Edge TTS specifics

Edge uses Microsoft's public WebSocket endpoint — the same one that
powers Edge browser's "Read Aloud". No account, no API key, no quota
that I'm aware of for personal use.

- Voice IDs follow the format `{locale}-{Name}Neural`, e.g.
  `en-US-AriaNeural`, `es-ES-ElviraNeural`, `de-DE-KatjaNeural`.
- The full catalog is fetched live from Microsoft on first use and
  cached in-process. Use `/tts list edge <locale>` or
  `tts_list_voices({ provider: "edge", locale })` to discover.
- Speed is implemented via SSML `<prosody rate="...">` and clamped to
  ±50% (so 0.5x and 2.0x map to -50%/+50%).

If Microsoft ever changes the endpoint, the `msedge-tts` package
maintainers usually update within a few days. As a fallback, drop down
to a different provider via `/tts provider <name>`.

## Speechify specifics

Speechify's free tier (50 000 chars/month) is generous for personal
use. Get a key at [api.speechify.ai](https://api.speechify.ai).

```
SPEECHIFY_API_KEY=...
```

Voices: `henry`, `matthew`, `kristy`, `stacy`, etc. The catalog is
hard-coded in `src/tts/voices.ts` since Speechify doesn't expose a
free `/voices` API.

## OpenAI-compatible specifics

Any provider speaking the OpenAI `/audio/speech` shape works (OpenAI
proper, OpenRouter, local lmstudio, etc).

```
TTS_API_URL=https://api.openai.com/v1
TTS_API_KEY=sk-...
TTS_MODEL=gpt-4o-mini-tts          # or any model your endpoint supports
```

Voices: `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`. Free-form
voice IDs are accepted (no client-side validation), since some
providers expose extra voices not in the OpenAI list.

## Google Cloud TTS specifics

Highest quality of the bunch (Studio voices are scary good) but the
setup is the most involved. You need a service-account JSON with
Cloud TTS API enabled, mounted into the bot container.

```
GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/gcp-tts.json
```

Voices: `en-US-Studio-O`, `en-US-Studio-Q`, `en-US-Neural2-F`,
`es-ES-Neural2-A`, etc.

## How the resolver decides

When the bot needs to synthesize a reply, it goes through this
resolution order (see `src/tts/config-resolver.ts`):

1. `uiPreferences.tts.provider` (set via `/tts provider` or
   `tts_set_settings`)
2. else `TTS_PROVIDER` from `.env`
3. else `"openai"` (the legacy default)

Voice goes through the same priority:

1. `uiPreferences.tts.voice` (override)
2. `TTS_VOICE` from `.env` *if* it matches the chosen provider
3. else `defaultVoiceFor(provider, BOT_LOCALE)` — locale-aware default

Speed defaults to 1.0× unless overridden.

## Troubleshooting

- **`/tts on` says "not configured"** — your provider has no creds
  available. Either configure them in `.env` or run
  `/tts provider edge` to switch to the no-key fallback first.
- **Voice doesn't change despite `/tts voice X`** — the static
  catalogs (Speechify/Google) reject unknown voice IDs to avoid
  silent failures. Use `/tts list` to see what's valid.
- **Edge fails with WebSocket error** — likely a transient Microsoft
  side issue. Retry; if persistent, `/tts provider speechify` (or
  another configured one) until Microsoft is back.
- **Chinese, Russian, Arabic voices** — Edge has them. Try
  `/tts list edge zh`, `/tts list edge ru`, `/tts list edge ar`.
