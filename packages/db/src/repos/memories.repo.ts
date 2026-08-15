import { and, eq } from "drizzle-orm";
import type { MemoryState, MemoryUpdate } from "@microsonya/shared";
import type { MicrosonyaDb } from "../client.js";
import { memoryOperations, memoryStates } from "../schema.js";

type MemoryStateRow = typeof memoryStates.$inferSelect;

export class MemoriesRepo {
  constructor(private readonly db: MicrosonyaDb) {}

  async findState(chatId: string): Promise<MemoryState | undefined> {
    const stateRow = (
      await this.db
        .select()
        .from(memoryStates)
        .where(eq(memoryStates.chatId, chatId))
        .limit(1)
    ).at(0);

    if (!stateRow) return undefined;

    return mapMemoryState(stateRow);
  }

  async saveState(
    update: MemoryUpdate,
    expectedVersion: number,
  ): Promise<boolean> {
    const { state, operations } = update;
    assertTransitionShape(update, expectedVersion);

    return this.db.transaction(async (tx) => {
      const values = {
        chatId: state.chatId,
        version: state.version,
        processedThroughMessageId: state.processedThroughMessageId,
        nextMemorySequence: state.nextMemorySequence,
        nextOperationSequence: state.nextOperationSequence,
        items: state.items,
        updatedAt: Date.now(),
      };

      const saved =
        expectedVersion === 0
          ? await tx
              .insert(memoryStates)
              .values(values)
              .onConflictDoUpdate({
                target: memoryStates.chatId,
                set: values,
                where: eq(memoryStates.version, expectedVersion),
              })
              .returning({ chatId: memoryStates.chatId })
          : await tx
              .update(memoryStates)
              .set(values)
              .where(
                and(
                  eq(memoryStates.chatId, state.chatId),
                  eq(memoryStates.version, expectedVersion),
                ),
              )
              .returning({ chatId: memoryStates.chatId });

      if (saved.length === 0) return false;

      if (operations.length > 0) {
        await tx.insert(memoryOperations).values(
          operations.map((operation) => ({
            chatId: operation.chatId,
            id: operation.id,
            itemId: operation.itemId,
            createdItemId: operation.createdItemId,
            op: operation.op,
            fromMessageId: operation.fromMessageId,
            toMessageId: operation.toMessageId,
            inputHash: operation.inputHash,
            model: operation.model,
            promptVersion: operation.promptVersion,
            stateVersion: operation.stateVersion,
            createdAt: operation.createdAt,
          })),
        );
      }

      return true;
    });
  }
}

function mapMemoryState(state: MemoryStateRow): MemoryState {
  return {
    chatId: state.chatId,
    version: state.version,
    processedThroughMessageId: state.processedThroughMessageId,
    nextMemorySequence: state.nextMemorySequence,
    nextOperationSequence: state.nextOperationSequence,
    items: state.items,
  };
}

function assertTransitionShape(
  update: MemoryUpdate,
  expectedVersion: number,
): void {
  const { state, operations } = update;
  if (state.version !== expectedVersion + 1) {
    throw new Error(
      `Memory state version ${state.version} must follow expected version ${expectedVersion}`,
    );
  }

  for (const operation of operations) {
    if (operation.chatId !== state.chatId) {
      throw new Error(
        `Memory operation ${operation.id} belongs to another chat`,
      );
    }
    if (operation.stateVersion !== state.version) {
      throw new Error(
        `Memory operation ${operation.id} has an invalid state version`,
      );
    }
  }
}
