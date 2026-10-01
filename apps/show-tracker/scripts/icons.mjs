// One-off: writes the placeholder app icons (a green square with three ledger
// rows). Swap icon-192.png / icon-512.png for real artwork any time; the
// manifest only needs the file names to stay.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};

function png(size) {
  const bg = [0x2f, 0x5d, 0x4f], fg = [0xff, 0xff, 0xff];
  const raw = Buffer.alloc((size * 3 + 1) * size);
  // three bars, inside the 80% "safe zone" so the icon also works masked
  const bars = [0.34, 0.5, 0.66].map((y) => [Math.round(size * (y - 0.04)), Math.round(size * (y + 0.04))]);
  const x0 = Math.round(size * 0.27), x1 = Math.round(size * 0.73);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const on = x >= x0 && x < x1 && bars.some(([a, b]) => y >= a && y < b);
      raw.set(on ? fg : bg, y * (size * 3 + 1) + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  writeFileSync(fileURLToPath(new URL(`../icon-${size}.png`, import.meta.url)), png(size));
}
