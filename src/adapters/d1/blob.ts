// D1 binds/returns BLOB columns as ArrayBuffer, while the crypto adapter
// (and plaintext UTF-8 encoding) works in Uint8Array. These helpers keep
// that conversion in one place.
export function toBlob(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

export function fromBlob(value: ArrayBuffer | null): Uint8Array | null {
  return value === null ? null : new Uint8Array(value);
}
