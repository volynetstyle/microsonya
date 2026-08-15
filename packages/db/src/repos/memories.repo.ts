import { and, asc, eq, lte } from "drizzle-orm";
import type { AppliedMemoryOp, MemoryState } from "@microsonya/shared";
import type { MicrosonyaDb } from "../client.js";
import { memoryOperations, memoryStates } from "../schema.js";

type MemoryStateRow = typeof memoryStates.$inferSelect;
type MemoryOperationRow = typeof memoryOperations.$inferSelect;

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

    const operationRows = await this.db
      .select()
      .from(memoryOperations)
      .where(
        and(
          eq(memoryOperations.chatId, chatId),
          lte(memoryOperations.stateVersion, stateRow.version),
        ),
      )
      .orderBy(asc(memoryOperations.stateVersion), asc(memoryOperations.id));

    return mapMemoryState(stateRow, operationRows);
  }

  async saveState(
    state: MemoryState,
    expectedVersion: number,
  ): Promise<boolean> {
    assertTransitionShape(state, expectedVersion);

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

      const newOperations = state.operations.filter(
        (operation) => operation.stateVersion === state.version,
      );

      if (newOperations.length > 0) {
        await tx.insert(memoryOperations).values(
          newOperations.map((operation) => ({
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

function mapMemoryState(
  state: MemoryStateRow,
  operations: MemoryOperationRow[],
): MemoryState {
  return {
    chatId: state.chatId,
    version: state.version,
    processedThroughMessageId: state.processedThroughMessageId,
    nextMemorySequence: state.nextMemorySequence,
    nextOperationSequence: state.nextOperationSequence,
    items: state.items,
    operations: operations.map(mapMemoryOperation),
  };
}

function mapMemoryOperation(row: MemoryOperationRow): AppliedMemoryOp {
  return {
    id: row.id,
    itemId: row.itemId,
    createdItemId: row.createdItemId ?? undefined,
    op: row.op,
    chatId: row.chatId,
    fromMessageId: row.fromMessageId,
    toMessageId: row.toMessageId,
    inputHash: row.inputHash,
    model: row.model,
    promptVersion: row.promptVersion,
    stateVersion: row.stateVersion,
    createdAt: row.createdAt,
  };
}

function assertTransitionShape(
  state: MemoryState,
  expectedVersion: number,
): void {
  if (state.version !== expectedVersion + 1) {
    throw new Error(
      `Memory state version ${state.version} must follow expected version ${expectedVersion}`,
    );
  }

  for (const operation of state.operations) {
    if (operation.chatId !== state.chatId) {
      throw new Error(
        `Memory operation ${operation.id} belongs to another chat`,
      );
    }
    if (operation.stateVersion > state.version) {
      throw new Error(
        `Memory operation ${operation.id} is newer than materialized state`,
      );
    }
  }
}
