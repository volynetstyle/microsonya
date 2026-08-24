# ollama-client

Typed TS client for `/api/generate`, `/api/chat`, `/api/embed`, built directly
off the OpenAPI schemas published at https://docs.ollama.com/api (captured
2026-08-24). No dependencies beyond global `fetch`/`ReadableStream`/`TextDecoder`
(Node ≥18, or any modern browser/worker).

```
types.ts    — request/response/stream-event types, 1:1 with the OpenAPI schema
client.ts   — OllamaClient: generate / chat / embed
index.ts    — public re-exports
```

## Design decisions worth knowing before you use this

**`stream` is required, not defaulted.** The wire protocol defaults `stream` to
`true` when omitted. This client does not replicate that default — `stream` is
a required literal (`true | false`) on every request type, because the return
type (`Promise<Response>` vs `AsyncGenerator<StreamEvent>`) is selected by
TS overload resolution at the call site, and overload resolution needs a
static discriminant. A server-side default can't drive a compile-time choice.
Concretely: `client.generate({ model, prompt })` is a **type error** — you
must write `{ ..., stream: false }` or `{ ..., stream: true }`. If you build
the request object dynamically and `stream` ends up typed as plain `boolean`
rather than a literal, overload resolution fails the same way; narrow it
(`as const`, or a discriminated branch) before calling.

**ndjson parsing is buffered, not per-chunk.** A `ReadableStream` chunk
boundary has no relationship to a line boundary — one chunk can contain half
a JSON object, or three and a half objects. `stream()` accumulates decoded
text in `buffer` and only emits text up to the last `\n` seen so far, carrying
any remainder to the next chunk (and flushing it at end-of-stream in case the
server doesn't terminate the last line). `TextDecoder.decode(chunk, { stream:
true })` is doing real work too: it withholds a trailing partial multi-byte
UTF-8 sequence instead of emitting `U+FFFD` for it, which matters once
generated text contains anything outside ASCII.

**One error type, two failure paths.** Per [api/errors](https://docs.ollama.com/api/errors):
a request can fail before generation starts (non-2xx status, JSON body
`{"error": "..."}`), or mid-stream (status stays `200` because headers were
already flushed, and the failure shows up as an ndjson line containing only
`error`). Both are normalized to `OllamaError` — check `err.status` if you
need to distinguish "never started" (status present, non-2xx) from
"failed partway through" (status `200`).

**`ModelOptions` isn't an exhaustive options list.** The spec marks it
`additionalProperties: true` — Modelfile parameters like `mirostat` or
`repeat_penalty` exist and work, but aren't part of _this_ reference page, so
they aren't hand-typed here (that would be fabricating documentation this
schema doesn't contain). They still pass through via the index signature;
widen the type locally if you want them checked.

**Cancellation is exactly `AbortSignal`.** Every method takes an optional
`{ signal }` as its second argument, passed straight to `fetch`. Aborting
mid-stream causes `reader.read()` to reject, which propagates out of the
generator through your `for await` loop — that's a real throw, not a value,
so wrap iteration in `try/catch` if you're cancelling from the consumer side.

## Usage

```ts
import { OllamaClient } from "./client";

const ollama = new OllamaClient(); // http://localhost:11434/api

// Cloud models: new OllamaClient({
//   baseUrl: 'https://ollama.com/api',
//   apiKey: process.env.OLLAMA_API_KEY,
// });
```

### generate — non-streaming

```ts
const res = await ollama.generate({
  model: "gemma4",
  prompt: "Why is the sky blue?",
  stream: false,
  options: { temperature: 0.8, top_p: 0.9, seed: 42 },
});
console.log(res.response);
```

### generate — streaming

```ts
for await (const chunk of ollama.generate({
  model: "gemma4",
  prompt: "Why is the sky blue?",
  stream: true,
})) {
  process.stdout.write(chunk.response);
  if (chunk.done)
    console.log(`\n[${chunk.done_reason}] eval_count=${chunk.eval_count}`);
}
```

### chat — with tool calling

```ts
const res = await ollama.chat({
  model: "qwen3",
  stream: false,
  messages: [{ role: "user", content: "What is the weather today in Paris?" }],
  tools: [
    {
      type: "function",
      function: {
        name: "get_current_weather",
        description: "Get the current weather for a location",
        parameters: {
          type: "object",
          properties: {
            location: { type: "string", description: "e.g. Paris, France" },
            format: { type: "string", enum: ["celsius", "fahrenheit"] },
          },
          required: ["location", "format"],
        },
      },
    },
  ],
});

for (const call of res.message.tool_calls ?? []) {
  console.log(call.function.name, call.function.arguments);
}
```

### chat — structured outputs

```ts
const res = await ollama.chat({
  model: "gemma4",
  stream: false,
  messages: [{ role: "user", content: "Populations of the US and Canada?" }],
  format: {
    type: "object",
    properties: {
      countries: {
        type: "array",
        items: {
          type: "object",
          properties: {
            country: { type: "string" },
            population: { type: "integer" },
          },
          required: ["country", "population"],
        },
      },
    },
    required: ["countries"],
  },
});
const parsed = JSON.parse(res.message.content);
```

### embed

```ts
const { embeddings } = await ollama.embed({
  model: "embeddinggemma",
  input: ["Why is the sky blue?", "Why is the grass green?"],
  dimensions: 128,
});
// embeddings.length === 2, one vector per input, in order
```

### cancellation

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 5000);

try {
  for await (const chunk of ollama.generate(
    { model: "gemma4", prompt: "...", stream: true },
    { signal: controller.signal },
  )) {
    process.stdout.write(chunk.response);
  }
} catch (err) {
  if (controller.signal.aborted) console.log("\n[cancelled]");
  else throw err;
}
```

## Not covered

This client wraps exactly the three generation/embedding endpoints
(`generate`, `chat`, `embed`), matching the scope you asked for. Model
management endpoints (`tags`, `ps`, `show`, `create`, `copy`, `pull`, `push`,
`delete`) and the OpenAI/Anthropic compatibility layers are separate parts of
the API surface and aren't implemented here.
