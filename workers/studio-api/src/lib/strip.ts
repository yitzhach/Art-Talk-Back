// Studio Wall's worker/strip.ts (D-094), with `!` where this repo's stricter indexing asks (a byte past the end
// reads 0 in bit arithmetic either way, so nothing behaves differently). Its tests moved here as test/strip.test.ts.
// Removes hidden data from JPEG, PNG and WebP files: GPS location, camera and lens, dates, captions, editing history,
// embedded previews. Pixels are never re-encoded. Colour profiles and the rotation flag stay, so an image looks
// exactly the same. A file that doesn't parse cleanly is returned unchanged (as it was stored before this existed).
const u16 = (b: Uint8Array, i: number, le = false) => (le ? b[i]! | (b[i + 1]! << 8) : (b[i]! << 8) | b[i + 1]!);
const u32 = (b: Uint8Array, i: number, le = false) =>
  (le
    ? b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)
    : (b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
const join = (parts: Uint8Array<ArrayBuffer>[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

/** The Exif rotation flag (1–8) in TIFF-format Exif data, or 1 (upright). */
function orientation(t: Uint8Array) {
  if (t.length < 8) return 1;
  const le = ascii(t, 0, 2) === 'II',
    ifd = u32(t, 4, le);
  if (ifd + 2 > t.length) return 1;
  for (let k = 0, n = u16(t, ifd, le); k < n; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > t.length) break;
    if (u16(t, e, le) === 0x0112) {
      const v = u16(t, e + 8, le);
      return v >= 1 && v <= 8 ? v : 1;
    }
  }
  return 1;
}
/** Minimal Exif data holding only the rotation flag: big-endian TIFF header, one IFD entry. */
const rotationOnly = (v: number) => [
  0x4d,
  0x4d,
  0,
  0x2a,
  0,
  0,
  0,
  8,
  0,
  1,
  0x01,
  0x12,
  0,
  3,
  0,
  0,
  0,
  1,
  0,
  v,
  0,
  0,
  0,
  0,
  0,
  0,
];
const CRC = Array.from({length: 256}, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const crc32 = (b: number[]) => {
  let c = ~0;
  for (const x of b) c = CRC[(c ^ x) & 255]! ^ (c >>> 8);
  return ~c >>> 0;
};

// Kept: APP0 (JFIF), APP2 colour profile, APP14 (Adobe colour transform) and every image segment. Dropped: Exif/XMP (APP1,
// except the rotation flag), other APP2 (e.g. MPF), APP3–APP13 and APP15 (IPTC, Photoshop, maker data), comments, and
// anything after the end-of-image marker (extra preview or gain-map images that carry their own Exif).
function jpeg(b: Uint8Array<ArrayBuffer>) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  const out = [b.subarray(0, 2)];
  let i = 2,
    rotated = false;
  while (i + 1 < b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1]!;
    if (m === 0xff) {
      i++;
      continue;
    }
    if (m === 0xd9) {
      out.push(b.subarray(i, i + 2));
      return join(out);
    }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      out.push(b.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (i + 4 > b.length) return null;
    const end = i + 2 + u16(b, i + 2);
    if (end > b.length || end < i + 4) return null;
    const body = b.subarray(i + 4, end);
    if (m === 0xe1) {
      const o = ascii(body, 0, 6) === 'Exif\0\0' ? orientation(body.subarray(6)) : 1;
      if (o !== 1 && !rotated) {
        out.push(new Uint8Array([0xff, 0xe1, 0, 34, 0x45, 0x78, 0x69, 0x66, 0, 0, ...rotationOnly(o)]));
        rotated = true;
      }
    } else if (!(
      m === 0xfe ||
      (m >= 0xe2 && m <= 0xef && m !== 0xee && !(m === 0xe2 && ascii(body, 0, 12) === 'ICC_PROFILE\0'))
    ))
      out.push(b.subarray(i, end));
    i = end;
    if (m === 0xda) {
      // Scan data runs to the next marker that isn't a stuffed 0xFF00 or a restart marker.
      let j = i;
      for (;;) {
        j = b.indexOf(0xff, j);
        if (j < 0 || j + 1 >= b.length) return null;
        const n = b[j + 1]!;
        if (n === 0 || (n >= 0xd0 && n <= 0xd7)) {
          j += 2;
          continue;
        }
        break;
      }
      out.push(b.subarray(i, j));
      i = j;
    }
  }
  return null;
}

// Dropped: text chunks (captions, software, XMP), the time stamp and Exif, except its rotation flag, which browsers honour in PNG.
const PNG_DROP = ['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME'];
function png(b: Uint8Array<ArrayBuffer>) {
  const out = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = u32(b, i),
      type = ascii(b, i + 4, 4),
      end = i + 12 + len;
    if (end > b.length) return null;
    if (type === 'eXIf') {
      const o = orientation(b.subarray(i + 8, i + 8 + len));
      if (o !== 1) {
        const c = [...new TextEncoder().encode('eXIf'), ...rotationOnly(o)],
          sum = crc32(c);
        out.push(new Uint8Array([0, 0, 0, 26, ...c, sum >>> 24, (sum >> 16) & 255, (sum >> 8) & 255, sum & 255]));
      }
    } else if (!PNG_DROP.includes(type)) out.push(b.subarray(i, end));
    i = end;
    if (type === 'IEND') return join(out);
  }
  return null;
}

function webp(b: Uint8Array<ArrayBuffer>) {
  if (b.length < 12) return null;
  const limit = Math.min(b.length, 8 + u32(b, 4, true)),
    chunks: Uint8Array<ArrayBuffer>[] = [];
  let i = 12;
  while (i + 8 <= limit) {
    const type = ascii(b, i, 4),
      len = u32(b, i + 4, true);
    if (i + 8 + len > limit) return null;
    const end = Math.min(i + 8 + len + (len & 1), limit);
    // VP8X flags say which optional chunks exist; clear the EXIF (0x08) and XMP (0x04) bits along with the chunks.
    if (type === 'VP8X') {
      const c = b.slice(i, end);
      c[8] = c[8]! & ~0x0c;
      chunks.push(c);
    } else if (type !== 'EXIF' && type !== 'XMP ') chunks.push(b.subarray(i, end));
    i = end;
  }
  const body = join(chunks),
    out = new Uint8Array(12 + body.length);
  out.set(b.subarray(0, 12));
  new DataView(out.buffer).setUint32(4, 4 + body.length, true);
  out.set(body, 12);
  return out;
}

/** The image without hidden metadata, for a type from sniffImage. Other types (GIF, HEIC) come back unchanged. */
export function stripMetadata(bytes: Uint8Array<ArrayBuffer>, type: string): Uint8Array<ArrayBuffer> {
  try {
    return (
      (type === 'image/jpeg'
        ? jpeg(bytes)
        : type === 'image/png'
          ? png(bytes)
          : type === 'image/webp'
            ? webp(bytes)
            : null) || bytes
    );
  } catch {
    return bytes;
  }
}

/** Recognise real image files by their leading bytes (magic numbers), never by a declared type. */
export function sniffImage(b: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(0, 4) === "GIF8") return "image/gif";
  if (ascii(4, 8) === "ftyp" && ["heic", "heix", "hevc", "heif", "mif1", "msf1"].includes(ascii(8, 12))) return "image/heic";
  return null;
}
