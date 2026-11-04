const utf8 = new TextEncoder();

/** Strings joined with 4-byte big-endian length prefixes, so no two lists encode alike. */
export function lengthPrefixed(parts: readonly string[]): Uint8Array<ArrayBuffer> {
  const encoded = parts.map((part) => utf8.encode(part));
  const bytes = new Uint8Array(encoded.reduce((size, part) => size + 4 + part.length, 0));
  const view = new DataView(bytes.buffer);
  let offset = 0;
  for (const part of encoded) {
    view.setUint32(offset, part.length);
    bytes.set(part, offset + 4);
    offset += 4 + part.length;
  }
  return bytes;
}
