import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { messageSchema, type EvalMessage } from "./types.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repositoryRoot = path.resolve(packageRoot, "..", "..");
const defaultCollector = path.join(
  repositoryRoot,
  "apps",
  "telegram",
  "collector",
  "data",
  "telegram-collector.jsonl",
);

const selectionSchema = z.array(
  z
    .object({
      name: z.string().regex(/^[a-z0-9-]+$/),
      ranges: z
        .array(
          z.tuple([z.number().int().positive(), z.number().int().positive()]),
        )
        .min(1),
    })
    .strict(),
);

type CollectorRecord = {
  collectedAt?: string;
  message?: {
    id?: number;
    dateIso?: string;
    kind?: string;
    replyToId?: number;
  };
  chat?: { id?: string };
  author?: { id?: string };
  text?: { value?: string };
};

const collectorPath = path.resolve(process.argv[2] ?? defaultCollector);
const selections = selectionSchema.parse(
  JSON.parse(
    await readFile(path.join(packageRoot, "collector-cases.json"), "utf8"),
  ),
);
const selectedIds = new Set(
  selections.flatMap((selection) =>
    selection.ranges.flatMap(([from, to]) =>
      Array.from({ length: to - from + 1 }, (_, offset) => from + offset),
    ),
  ),
);
const records = new Map<number, CollectorRecord>();

const lines = readline.createInterface({
  input: createReadStream(collectorPath, { encoding: "utf8" }),
  crlfDelay: Infinity,
});
for await (const line of lines) {
  const record = JSON.parse(line) as CollectorRecord;
  const id = record.message?.id;
  if (id !== undefined && selectedIds.has(id)) records.set(id, record);
}

for (const selection of selections) {
  const sourceIds = selection.ranges.flatMap(([from, to]) =>
    Array.from({ length: to - from + 1 }, (_, offset) => from + offset),
  );
  const missing = sourceIds.filter((id) => !records.has(id));
  if (missing.length > 0) {
    throw new Error(
      `${selection.name}: collector is missing IDs ${missing.join(", ")}`,
    );
  }

  const aliases = new Map<string, string>();
  const localIdBySource = new Map(
    sourceIds.map((sourceId, index) => [sourceId, index + 1]),
  );
  const externalReplyTargets: Record<string, number> = {};
  const messages = sourceIds.map((sourceId, index): EvalMessage => {
    const record = records.get(sourceId)!;
    const sourceAuthor = record.author?.id;
    const dateIso = record.message?.dateIso;
    if (!sourceAuthor || !dateIso) {
      throw new Error(
        `${selection.name}: source #${sourceId} has incomplete metadata`,
      );
    }
    if (!aliases.has(sourceAuthor)) {
      aliases.set(sourceAuthor, `P${aliases.size + 1}`);
    }

    const message: EvalMessage = {
      id: index + 1,
      user: aliases.get(sourceAuthor)!,
      time: dateIso,
    };
    const text = record.text?.value?.trim();
    if (text) message.text = text;
    if (record.message?.kind && record.message.kind !== "text") {
      message.media = record.message.kind;
    }
    if (!message.text && !message.media) message.media = "unknown";

    const replyTo = record.message?.replyToId;
    if (replyTo !== undefined) {
      const localReplyTo = localIdBySource.get(replyTo);
      if (localReplyTo !== undefined) message.replyTo = localReplyTo;
      else externalReplyTargets[String(message.id)] = replyTo;
    }
    return messageSchema.parse(message);
  });

  const caseRoot = path.join(packageRoot, "cases", selection.name);
  await mkdir(caseRoot, { recursive: true });
  await writeJson(path.join(caseRoot, "messages.json"), messages);
  await writeJson(path.join(caseRoot, "provenance.json"), {
    source: path.relative(repositoryRoot, collectorPath).replaceAll("\\", "/"),
    selection: selection.ranges,
    sourceMessageIds: sourceIds,
    sourceChatHash: hash(records.get(sourceIds[0]!)?.chat?.id ?? ""),
    externalReplyTargets,
  });
  console.log(
    `${selection.name}: ${messages.length} messages, ${aliases.size} participants`,
  );
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
