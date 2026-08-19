import type {
  ChatMessage,
  MemoryState,
  MemoryUpdate,
  SummaryRun,
} from "@microsonya/shared";
import type { SegmentReconstruction } from "@microsonya/discourse";
import type { MessageSink } from "../telegram/ingest.js";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

type LocalMemorySnapshot = {
  version: 1;
  messages: Record<string, ChatMessage>;
  runs: Record<string, SummaryRun>;
  segments: Record<string, SegmentReconstruction>;
  states: Record<string, MemoryState>;
};

const emptySnapshot = (): LocalMemorySnapshot => ({
  version: 1,
  messages: {},
  runs: {},
  segments: {},
  states: {},
});

/** Shared process memory with an optional, atomically replaced JSON snapshot. */
export class LocalMemoryDatabase {
  private snapshot?: LocalMemorySnapshot;
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly filePath?: string) {}

  async read<T>(reader: (snapshot: LocalMemorySnapshot) => T): Promise<T> {
    await this.pending;
    return reader(await this.load());
  }

  async update<T>(writer: (snapshot: LocalMemorySnapshot) => T): Promise<T> {
    let result!: T;
    const operation = this.pending.then(async () => {
      const snapshot = await this.load();
      result = writer(snapshot);
      if (this.filePath) await this.persist(snapshot);
    });
    this.pending = operation.catch(() => undefined);
    await operation;
    return result;
  }

  private async load(): Promise<LocalMemorySnapshot> {
    if (this.snapshot) return this.snapshot;
    if (!this.filePath) return (this.snapshot = emptySnapshot());

    try {
      const parsed = JSON.parse(
        await readFile(this.filePath, "utf8"),
      ) as Partial<LocalMemorySnapshot>;
      if (parsed.version !== 1) {
        throw new Error(
          `Unsupported local memory version: ${String(parsed.version)}`,
        );
      }
      this.snapshot = {
        version: 1,
        messages: parsed.messages ?? {},
        runs: parsed.runs ?? {},
        segments: parsed.segments ?? {},
        states: parsed.states ?? {},
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.snapshot = emptySnapshot();
    }
    return this.snapshot;
  }

  private async persist(snapshot: LocalMemorySnapshot): Promise<void> {
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await mkdir(dirname(this.filePath!), { recursive: true });
    await writeFile(
      temporaryPath,
      `${JSON.stringify(snapshot, null, 2)}\n`,
      "utf8",
    );
    await rename(temporaryPath, this.filePath!);
  }
}

export type SummaryMessagesStore = {
  listByChat(chatId: string): Promise<ChatMessage[]>;
  listAfterByChat(
    chatId: string,
    afterMessageId: number,
    limit: number,
  ): Promise<ChatMessage[]>;
};

export type SummaryRunsStore = {
  findLastRun(chatId: string): Promise<SummaryRun | undefined>;
  saveRun(run: SummaryRun): Promise<void>;
  findCachedReconstruction(
    chatId: string,
    fromMessageId: number,
    toMessageId: number,
    hash: string,
    schemaVersion?: number,
  ): Promise<SegmentReconstruction | undefined>;
  saveReconstruction(
    segment: SegmentReconstruction,
    schemaVersion?: number,
  ): Promise<void>;
};

export type MemoryStateStore = {
  findState(chatId: string): Promise<MemoryState | undefined>;
  saveState(update: MemoryUpdate, expectedVersion: number): Promise<boolean>;
};

export class InMemoryMessagesRepo implements MessageSink, SummaryMessagesStore {
  constructor(private readonly database = new LocalMemoryDatabase()) {}

  async save(message: ChatMessage): Promise<void> {
    await this.database.update((snapshot) => {
      snapshot.messages[messageKey(message.chatId, message.id)] =
        structuredClone(message);
    });
  }

  async listByChat(chatId: string): Promise<ChatMessage[]> {
    return this.database.read((snapshot) =>
      Object.values(snapshot.messages)
        .filter((message) => message.chatId === chatId)
        .sort((left, right) => left.id - right.id)
        .map((message) => structuredClone(message)),
    );
  }

  async listAfterByChat(
    chatId: string,
    afterMessageId: number,
    limit: number,
  ): Promise<ChatMessage[]> {
    return this.database.read((snapshot) =>
      Object.values(snapshot.messages)
        .filter(
          (message) => message.chatId === chatId && message.id > afterMessageId,
        )
        .sort((left, right) => left.id - right.id)
        .slice(0, limit)
        .map((message) => structuredClone(message)),
    );
  }
}

export class InMemorySummariesRepo implements SummaryRunsStore {
  constructor(private readonly database = new LocalMemoryDatabase()) {}

  async findLastRun(chatId: string): Promise<SummaryRun | undefined> {
    return this.database.read((snapshot) => {
      const run = Object.values(snapshot.runs)
        .filter(
          (candidate) =>
            candidate.chatId === chatId && candidate.status === "ok",
        )
        .sort((left, right) => right.createdAt - left.createdAt)
        .at(0);
      return run ? structuredClone(run) : undefined;
    });
  }

  async saveRun(run: SummaryRun): Promise<void> {
    await this.database.update((snapshot) => {
      snapshot.runs[`${run.chatId}:${run.commandMessageId}`] =
        structuredClone(run);
    });
  }

  async findCachedReconstruction(
    chatId: string,
    fromMessageId: number,
    toMessageId: number,
    hash: string,
    schemaVersion = 1,
  ): Promise<SegmentReconstruction | undefined> {
    return this.database.read((snapshot) => {
      const segment =
        snapshot.segments[
          segmentKey(chatId, fromMessageId, toMessageId, hash, schemaVersion)
        ];
      return segment ? structuredClone(segment) : undefined;
    });
  }

  async saveReconstruction(
    segment: SegmentReconstruction,
    schemaVersion = 1,
  ): Promise<void> {
    await this.database.update((snapshot) => {
      snapshot.segments[
        segmentKey(
          segment.chatId,
          segment.fromMessageId,
          segment.toMessageId,
          segment.hash,
          schemaVersion,
        )
      ] = structuredClone(segment);
    });
  }
}

export class InMemoryMemoriesRepo implements MemoryStateStore {
  constructor(private readonly database = new LocalMemoryDatabase()) {}

  async findState(chatId: string): Promise<MemoryState | undefined> {
    return this.database.read((snapshot) => {
      const state = snapshot.states[chatId];
      return state ? structuredClone(state) : undefined;
    });
  }

  async saveState(
    update: MemoryUpdate,
    expectedVersion: number,
  ): Promise<boolean> {
    return this.database.update((snapshot) => {
      const { state } = update;
      const currentVersion = snapshot.states[state.chatId]?.version ?? 0;
      if (
        currentVersion !== expectedVersion ||
        state.version !== expectedVersion + 1
      ) {
        return false;
      }
      snapshot.states[state.chatId] = structuredClone(state);
      return true;
    });
  }
}

function messageKey(chatId: string, messageId: number): string {
  return `${chatId}:${messageId}`;
}

function segmentKey(
  chatId: string,
  fromMessageId: number,
  toMessageId: number,
  hash: string,
  schemaVersion: number,
): string {
  return `${chatId}:${fromMessageId}:${toMessageId}:${hash}:${schemaVersion}`;
}
