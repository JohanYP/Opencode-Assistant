# Vector memory

Optional. Adds semantic search over the `facts` table so the assistant
can recall a fact like "I prefer light blue" when asked "what colour do
I like?" — even though the wording doesn't overlap.

When disabled (the default), `fact_search` falls back to plain `LIKE`
substring matching. Everything else works the same.

## How it works

1. Each fact is stored in SQLite as today, plus a 1536-byte (or 768-byte,
   depending on model) `embedding BLOB` column populated by an
   external embedding provider over the OpenAI-compatible
   `/v1/embeddings` endpoint.
2. When the assistant calls the MCP tool `fact_search`, the bot embeds
   the query, fetches the top-N candidates from SQLite, scores them with
   cosine similarity in JS, and returns the best matches.
3. There's no ANN index. Brute-force re-ranking over a few hundred rows
   is sub-50 ms, which is plenty for a personal assistant. The design
   follows [`RightNow-AI/openfang`](https://github.com/RightNow-AI/openfang)
   exactly — same BLOB format, same algorithm.
4. New facts written via `fact_add` get embedded in the background
   (fire-and-forget). If the provider is down, the fact is still saved;
   re-embed it later with `/memory_reembed`.

## Setup A — Ollama (local, no API key)

Best for self-hosted setups. Embeddings never leave your machine.

```bash
# 1. Install Ollama (https://ollama.com)
curl -fsSL https://ollama.com/install.sh | sh

# 2. Pull a small embedding model (~270 MB, runs on CPU)
ollama pull nomic-embed-text

# 3. Make sure Ollama is reachable from inside the bot container.
#    On Linux Docker hosts, `host.docker.internal` works since Docker 20.10
#    when the compose file has `extra_hosts: ["host.docker.internal:host-gateway"]`
#    (already configured in our docker-compose.yml).
ollama serve   # listens on :11434 by default
```

Then in `.env`:

```env
EMBEDDING_BASE_URL=http://host.docker.internal:11434/v1
EMBEDDING_MODEL=nomic-embed-text
EMBEDDING_API_KEY=
```

Restart the bot:

```bash
docker compose restart bot
```

In the bot logs you should see:

```
[Memory/Embedding] Driver enabled (model=nomic-embed-text, base=http://host.docker.internal:11434/v1, dims≈768)
```

Then run `/memory_reembed` in Telegram to backfill any facts that
existed before you turned this on.

## Setup B — OpenAI / cloud provider

Best when you already pay for an API key and want the lowest latency.

```env
EMBEDDING_BASE_URL=https://api.openai.com/v1
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_API_KEY=sk-...
```

`text-embedding-3-small` is 1536-dim and costs roughly **$0.0001 per fact
embedded** ($0.02 per million tokens). For a typical user that's a
fraction of a cent per day.

The same env layout works with Groq, Together, Fireworks, Mistral, vLLM,
and LM Studio — they all expose `/v1/embeddings`.

## When to run `/memory_reembed`

After:

- **Turning vector memory on for the first time** — backfills every fact
  that existed before.
- **Switching `EMBEDDING_MODEL`** — vectors from the previous model live
  in a different number space and are silently ignored. The command
  re-embeds them under the new model.
- **A long provider outage** — facts added while the provider was down
  are saved without a vector; this catches them up.

The command is a no-op when there's nothing pending, so it's safe to run
anytime.

## Troubleshooting

### `fact_search` still says `mode: "like"` after enabling

- Check the bot logs for `[Memory/Embedding] Driver enabled`. If it's
  missing, `EMBEDDING_BASE_URL` is empty or whitespace.
- Ensure the bot container can reach the URL:
  `docker compose exec bot wget -qO- $EMBEDDING_BASE_URL/embeddings`
  (you'll get a method-not-allowed 405 when reachable, which is fine —
  it means the connection works).

### `/memory_reembed` reports failures

- Logs include the underlying HTTP status. 401 = bad API key; 429 = rate
  limited (back off and retry); connection refused = provider down.
- Failed batches don't roll back successful ones; rerun the command to
  pick up where it left off.

### Privacy warning in logs

If `EMBEDDING_BASE_URL` is anything other than localhost or
`host.docker.internal`, the bot logs:

```
[Memory/Embedding] Driver configured to send text to external API at ...
```

That's correct — every fact you embed (and every search query) is sent
to that endpoint as plain text. Use Ollama if you want everything to
stay on the box.
