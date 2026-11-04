const lengthBytes = 4;

/** Joins byte strings, each after its length as a 32-bit big-endian integer. */
export function lengthPrefixed(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + lengthBytes + part.length, 0);
  const joined = new Uint8Array(total);
  const view = new DataView(joined.buffer);
  let offset = 0;
  for (const part of parts) {
    view.setUint32(offset, part.length);
    joined.set(part, offset + lengthBytes);
    offset += lengthBytes + part.length;
  }
  return joined;
}

/** Splits what `lengthPrefixed` joined into exactly `count` parts, or returns undefined. */
export function splitLengthPrefixed(
  bytes: Uint8Array,
  count: number,
): Uint8Array<ArrayBuffer>[] | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    if (offset + lengthBytes > bytes.length) return undefined;
    const length = view.getUint32(offset);
    const start = offset + lengthBytes;
    if (start + length > bytes.length) return undefined;
    parts.push(bytes.slice(start, start + length));
    offset = start + length;
  }
  return parts.length === count ? parts : undefined;
}

export const utf8 = {
  encode: (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text),
  decode: (bytes: Uint8Array): string => new TextDecoder('utf-8', { fatal: true }).decode(bytes),
};
