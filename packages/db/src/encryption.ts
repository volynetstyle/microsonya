import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

export type DataEncryption = {
  encrypt(plaintext: string): Buffer;
  decrypt(envelope: Buffer): string;
  lookup(value: string, namespace: string): string;
};

/** @deprecated Use DataEncryption. Kept for source compatibility. */
export type LedgerEncryption = DataEncryption;

export function createDataEncryption(key: Buffer): DataEncryption {
  if (key.byteLength !== 32) {
    throw new TypeError("Summary ledger encryption key must be 32 bytes.");
  }

  return {
    encrypt(plaintext: string): Buffer {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, key, iv);
      const ciphertext = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
      ]);
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    },
    decrypt(envelope: Buffer): string {
      if (envelope.byteLength < IV_BYTES + 16) {
        throw new TypeError("Invalid summary ledger ciphertext envelope.");
      }
      const iv = envelope.subarray(0, IV_BYTES);
      const authTag = envelope.subarray(IV_BYTES, IV_BYTES + 16);
      const ciphertext = envelope.subarray(IV_BYTES + 16);
      const decipher = createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8");
    },
    lookup(value: string, namespace: string): string {
      return `h1:${createHmac("sha256", key)
        .update(namespace, "utf8")
        .update("\0", "utf8")
        .update(value, "utf8")
        .digest("hex")}`;
    },
  };
}

export function dataEncryptionFromBase64(value: string): DataEncryption {
  const key = Buffer.from(value, "base64");
  return createDataEncryption(key);
}

/** @deprecated Use createDataEncryption. */
export const createLedgerEncryption = createDataEncryption;

/** @deprecated Use dataEncryptionFromBase64. */
export const ledgerEncryptionFromBase64 = dataEncryptionFromBase64;
