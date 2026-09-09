import { describe, expect, it } from "vitest";
import { EditableMessageTransport, type TelegramApi } from "../src/index.js";

class FakeTelegramApi implements TelegramApi {
  readonly calls: Array<{
    method: string;
    body: Readonly<Record<string, unknown>>;
  }> = [];

  async call(
    method: string,
    body: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    this.calls.push({ method, body });
    return method === "sendMessage"
      ? { ok: true, result: { message_id: 42 } }
      : { ok: true, result: true };
  }
}

function transport(api = new FakeTelegramApi(), messageThreadId?: number) {
  return {
    api,
    target: new EditableMessageTransport(api, {
      chatId: "-100123",
      commandMessageId: 123,
      ...(messageThreadId === undefined ? {} : { messageThreadId }),
    }),
  };
}

describe("EditableMessageTransport", () => {
  it("begins with typing in the target topic", async () => {
    const { api, target } = transport(undefined, 777);
    await target.begin();
    expect(api.calls).toEqual([
      {
        method: "sendChatAction",
        body: { chat_id: "-100123", action: "typing", message_thread_id: 777 },
      },
    ]);
  });

  it("sends the first snapshot and edits later snapshots", async () => {
    const { api, target } = transport();
    expect(target.finalMessageId).toBeUndefined();
    await target.update("first");
    await target.commit("final");
    expect(api.calls).toEqual([
      {
        method: "sendMessage",
        body: {
          chat_id: "-100123",
          text: "first",
          reply_parameters: { message_id: 123 },
        },
      },
      {
        method: "editMessageText",
        body: { chat_id: "-100123", message_id: 42, text: "final" },
      },
    ]);
    expect(target.finalMessageId).toBe(42);
  });

  it("uses the topic only when sending, not when editing", async () => {
    const { api, target } = transport(undefined, 777);
    await target.update("first");
    await target.commit("final");
    expect(api.calls[0]!.body).toMatchObject({ message_thread_id: 777 });
    expect(api.calls[1]!.body).not.toHaveProperty("message_thread_id");
  });

  it("commits by sending when there was no update", async () => {
    const { api, target } = transport();
    await target.commit("final");
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({
      method: "sendMessage",
      body: { text: "final", reply_parameters: { message_id: 123 } },
    });
    expect(target.finalMessageId).toBe(42);
  });

  it("can send a standalone demo without a reply target", async () => {
    const api = new FakeTelegramApi();
    const target = new EditableMessageTransport(api, {
      chatId: "-5360089872",
    });

    await target.commit("demo");

    expect(api.calls).toEqual([
      {
        method: "sendMessage",
        body: { chat_id: "-5360089872", text: "demo" },
      },
    ]);
  });

  it("sends failure before the first snapshot", async () => {
    const { api, target } = transport();
    await target.fail();
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({
      method: "sendMessage",
      body: { text: "Не вдалося завершити підсумок." },
    });
  });

  it("edits failure after the first snapshot", async () => {
    const { api, target } = transport();
    await target.update("partial");
    await target.fail();
    expect(api.calls.at(-1)).toEqual({
      method: "editMessageText",
      body: {
        chat_id: "-100123",
        message_id: 42,
        text: "Не вдалося завершити підсумок.",
      },
    });
  });
});
