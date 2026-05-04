# Vector memory

Optional. Adds semantic search over the `facts` table so the assistant
can find a fact stored in one wording when you query it with totally
different words — paraphrases, synonyms, even different languages.

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

## Setup A — Ollama on the host (recommended, no API key)

Best for self-hosted setups. Embeddings never leave your machine.
The `docker-compose.yml` already maps `host.docker.internal` to your
host, so the bot inside Docker can reach Ollama out of the box —
**you don't need to edit the compose file**.

### 1. Install Ollama on the host (VPS / your machine)

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

Linux distributions register it as a systemd service automatically.

### 2. Make Ollama listen on all interfaces (so Docker can reach it)

By default Ollama binds to `127.0.0.1`, which is unreachable from
inside containers. Bind it to `0.0.0.0`:

```bash
sudo systemctl edit ollama
```

In the editor that opens, paste:

```ini
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
```

Then reload and restart:

```bash
sudo systemctl daemon-reload
sudo systemctl restart ollama
```

> **Security note:** `0.0.0.0` opens the port on every interface. If
> your VPS is exposed to the internet, block public access:
> `sudo ufw deny 11434/tcp` (or the firewalld equivalent). Docker
> still reaches it locally because containers share the host kernel.

### 3. Pull the embedding model (~270 MB, runs on CPU)

```bash
ollama pull nomic-embed-text
```

### 4. Tell the bot about it

In `.env`:

```env
EMBEDDING_BASE_URL=http://host.docker.internal:11434/v1
EMBEDDING_MODEL=nomic-embed-text
EMBEDDING_API_KEY=
```

### 5. Restart and validate

```bash
docker compose restart bot
docker compose logs bot 2>&1 | grep -i embedding
```

You should see:

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
