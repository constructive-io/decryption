import { CorruptEnvelopeError, FileHeader, tryParseFileHeader } from '@decryption/core';

import { ByteReader } from './bytes';

/** Reads exactly the header off the front of `reader`; the payload stays in the stream. */
export const readFileHeader = async (reader: ByteReader): Promise<FileHeader> => {
  for (;;) {
    const header = tryParseFileHeader(reader.buffered);
    if (header) {
      reader.skip(header.length);
      return header;
    }
    if (!(await reader.more())) {
      throw new CorruptEnvelopeError('envelope is truncated: the header is incomplete');
    }
  }
};
