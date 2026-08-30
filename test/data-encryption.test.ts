import { describe, expect, it } from "vitest";
import { createDataEncryption } from "../packages/db/src/index.js";

describe("private data encryption", () => {
  it("uses randomized authenticated ciphertext", () => {
    const encryption = createDataEncryption(Buffer.alloc(32, 11));
    const first = encryption.encrypt("private Telegram text");
    const second = encryption.encrypt("private Telegram text");

    expect(first.equals(second)).toBe(false);
    expect(encryption.decrypt(first)).toBe("private Telegram text");
    expect(encryption.decrypt(second)).toBe("private Telegram text");

    const tampered = Buffer.from(first);
    tampered[tampered.length - 1] ^= 1;
    expect(() => encryption.decrypt(tampered)).toThrow();
  });

  it("creates stable domain-separated opaque lookup keys", () => {
    const encryption = createDataEncryption(Buffer.alloc(32, 12));

    expect(encryption.lookup("123", "telegram-chat-id")).toBe(
      encryption.lookup("123", "telegram-chat-id"),
    );
    expect(encryption.lookup("123", "telegram-chat-id")).not.toBe(
      encryption.lookup("123", "telegram-author-id"),
    );
    expect(encryption.lookup("123", "telegram-chat-id")).not.toContain("123");
  });
});
