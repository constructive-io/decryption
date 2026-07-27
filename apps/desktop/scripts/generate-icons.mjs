import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import png2icons from 'png2icons';
import sharp from 'sharp';

const RESOURCES = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources');
const SOURCE = join(RESOURCES, 'icon.svg');
const MASTER_SIZE = 1024;

const master = await sharp(await readFile(SOURCE), { density: 384 })
  .resize(MASTER_SIZE, MASTER_SIZE, { fit: 'contain' })
  .png()
  .toBuffer();

const icns = png2icons.createICNS(master, png2icons.BILINEAR, 0);
const ico = png2icons.createICO(master, png2icons.BILINEAR, 0, true);

await Promise.all([
  writeFile(join(RESOURCES, 'icon.icns'), icns),
  writeFile(join(RESOURCES, 'icon.ico'), ico),
  writeFile(join(RESOURCES, 'icon.png'), master),
]);

console.log('Generated resources/icon.{icns,ico,png} from icon.svg');
