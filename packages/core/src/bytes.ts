/**
 * Copies a range into a plain Uint8Array. `Buffer.prototype.slice` returns a view of the caller's
 * memory rather than a copy, so `bytes.slice()` must not be relied on to detach from the input.
 */
export const copyBytes = (bytes: Uint8Array, start = 0, end = bytes.length): Uint8Array =>
  Uint8Array.prototype.slice.call(bytes, start, end);
