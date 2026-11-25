// Builds __tests__/fixtures/age-stream.json from the age test vectors in C2SP/CCTV.
//
//   git clone https://github.com/C2SP/CCTV && node scripts/age-stream-vectors.mjs CCTV/age/testdata
//
// Only the `stream_*` vectors are used, and only the parts the STREAM tests need: the expected
// outcome, the payload hash, the file key, and the bytes that follow the age header (the 16-byte
// nonce and the chunks). The age header itself (recipient stanzas, header MAC) is dropped because
// dcrypt has its own header; the payload layer is the part that is shared with age.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const source = process.argv[2];
const commit = process.argv[3] ?? 'unknown';
if (!source) {
  console.error('usage: node scripts/age-stream-vectors.mjs <CCTV/age/testdata> [commit]');
  process.exit(1);
}

const indexOf = (bytes, needle, from = 0) => bytes.indexOf(Buffer.from(needle), from);

const vectors = readdirSync(source)
  .filter((name) => name.startsWith('stream_'))
  .sort()
  .map((name) => {
    const raw = readFileSync(join(source, name));
    const split = indexOf(raw, '\n\n');
    const fields = {};
    for (const line of raw.subarray(0, split).toString('utf8').split('\n')) {
      const colon = line.indexOf(': ');
      fields[line.slice(0, colon)] = line.slice(colon + 2);
    }
    let file = raw.subarray(split + 2);
    if (fields.compressed === 'zlib') file = inflateSync(file);
    // The age header ends with the line "--- <mac>"; the payload starts after its newline.
    const mac = indexOf(file, '\n--- ');
    const end = file.indexOf(0x0a, mac + 1);
    const body = file.subarray(end + 1);
    return {
      name,
      expect: fields.expect,
      ...(fields.comment ? { comment: fields.comment } : {}),
      payloadSha256: fields.payload,
      fileKey: fields['file key'],
      body: deflateSync(body, { level: 9 }).toString('base64'),
    };
  });

const out = join(dirname(fileURLToPath(import.meta.url)), '..', '__tests__', 'fixtures', 'age-stream.json');
writeFileSync(
  out,
  JSON.stringify(
    {
      source: `https://github.com/C2SP/CCTV/tree/${commit}/age/testdata`,
      license: '0BSD OR CC0-1.0 OR Unlicense (Copyright (c) 2022 The age Authors)',
      encoding: 'body = base64(zlib(nonce || chunks)); fileKey and payloadSha256 are hex',
      vectors,
    },
    null,
    1
  ) + '\n'
);
console.log(`${vectors.length} vectors -> ${out}`);
