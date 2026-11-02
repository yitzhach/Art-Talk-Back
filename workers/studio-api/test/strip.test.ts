// Ported from Studio Wall's src/strip.test.ts (D-094).
import {describe, it, expect} from 'vitest';
import {stripMetadata} from '../src/lib/strip';
const enc = (s: string) => [...new TextEncoder().encode(s)];
const text = (b: Uint8Array) => String.fromCharCode(...b);
// JPEG segment: marker + big-endian length (which counts itself) + payload.
const seg = (m: number, p: number[]) => [0xff, m, (p.length + 2) >> 8, (p.length + 2) & 255, ...p];
// Exif APP1 payload with the rotation flag and a second (GPS-like) entry pointing at text after the IFD.
const exif = (le: boolean, orientation: number) => {
  const w16 = (v: number) => (le ? [v & 255, v >> 8] : [v >> 8, v & 255]),
    w32 = (v: number) => (le ? [v & 255, (v >> 8) & 255, 0, 0] : [0, 0, (v >> 8) & 255, v & 255]);
  return [
    ...enc('Exif\0\0'),
    ...enc(le ? 'II' : 'MM'),
    ...w16(42),
    ...w32(8),
    ...w16(2),
    ...w16(0x8825),
    ...w16(2),
    ...w32(10),
    ...w32(38),
    ...w16(0x0112),
    ...w16(3),
    ...w32(1),
    ...w16(orientation),
    0,
    0,
    ...w32(0),
    ...enc('GPS-SECRET'),
  ];
};

describe('image metadata stripping', () => {
  const scan = [0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56];
  const photo = (app1: number[]) =>
    new Uint8Array([
      0xff,
      0xd8,
      ...seg(0xe0, enc('JFIF\0\x01\x01')),
      ...seg(0xe1, app1),
      ...seg(0xe1, enc('http://ns.adobe.com/xap/1.0/\0XMP-SECRET')),
      ...seg(0xe2, enc('ICC_PROFILE\0\x01\x01colour')),
      ...seg(0xe2, enc('MPF\0MPF-SECRET')),
      ...seg(0xed, enc('Photoshop 3.0\0IPTC-SECRET')),
      ...seg(0xfe, enc('COMMENT-SECRET')),
      ...seg(0xdb, [0, 1, 2]),
      ...seg(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]),
      ...seg(0xda, [1, 1, 0, 0, 63, 0]),
      ...scan,
      0xff,
      0xd9,
      ...enc('TRAIL-SECRET'),
    ]);
  it('removes Exif, XMP, IPTC, comments and trailing images from a JPEG, keeping colour profile, rotation and image data', () => {
    for (const le of [false, true]) {
      const out = stripMetadata(photo(exif(le, 6)), 'image/jpeg'),
        s = text(out);
      expect(s).not.toMatch(/SECRET/);
      expect(s).toContain('JFIF');
      expect(s).toContain('ICC_PROFILE');
      expect(s.slice(-2)).toBe('\xff\xd9');
      expect(s).toContain(
        text(
          new Uint8Array([
            0xff,
            0xe1,
            0,
            34,
            ...enc('Exif\0\0MM'),
            0,
            0x2a,
            0,
            0,
            0,
            8,
            0,
            1,
            1,
            0x12,
            0,
            3,
            0,
            0,
            0,
            1,
            0,
            6,
          ]),
        ),
      );
      expect(s).toContain(text(new Uint8Array([...seg(0xda, [1, 1, 0, 0, 63, 0]), ...scan, 0xff, 0xd9])));
    }
  });
  it('drops the Exif segment entirely when the image is upright', () => {
    const s = text(stripMetadata(photo(exif(false, 1)), 'image/jpeg'));
    expect(s).not.toContain('Exif');
    expect(s).not.toMatch(/SECRET/);
  });
  it('removes text, Exif and time chunks from a PNG', () => {
    const chunk = (type: string, data: number[]) => [0, 0, 0, data.length, ...enc(type), ...data, 0, 0, 0, 0];
    const out = stripMetadata(
      new Uint8Array([
        0x89,
        ...enc('PNG\r\n\x1a\n'),
        ...chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]),
        ...chunk('tEXt', enc('GPS\0SECRET')),
        ...chunk('iCCP', enc('sRGB\0\0x')),
        ...chunk('eXIf', enc('MM-SECRET')),
        ...chunk('tIME', [7, 234, 10, 21, 0, 0, 0]),
        ...chunk('IDAT', [1, 2, 3]),
        ...chunk('IEND', []),
        ...enc('TRAIL-SECRET'),
      ]),
      'image/png',
    );
    const s = text(out);
    expect(s).not.toMatch(/SECRET|tIME|eXIf/);
    expect(s).toContain('iCCP');
    expect(s).toContain('IDAT');
    expect(s.slice(-8, -4)).toBe('IEND');
  });
  it("keeps only the rotation flag of a PNG's Exif, with a valid checksum", () => {
    const data = exif(true, 6).slice(6),
      out = stripMetadata(
        new Uint8Array([
          0x89,
          ...enc('PNG\r\n\x1a\n'),
          0,
          0,
          0,
          data.length,
          ...enc('eXIf'),
          ...data,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          ...enc('IEND'),
          0xae,
          0x42,
          0x60,
          0x82,
        ]),
        'image/png',
      );
    // CRC-32 of "eXIf" + the 26-byte rotation-only Exif with orientation 6, computed independently (zlib).
    expect(text(out)).toBe(
      text(
        new Uint8Array([
          0x89,
          ...enc('PNG\r\n\x1a\n'),
          0,
          0,
          0,
          26,
          ...enc('eXIfMM'),
          0,
          0x2a,
          0,
          0,
          0,
          8,
          0,
          1,
          1,
          0x12,
          0,
          3,
          0,
          0,
          0,
          1,
          0,
          6,
          0,
          0,
          0,
          0,
          0,
          0,
          214,
          103,
          75,
          105,
          0,
          0,
          0,
          0,
          ...enc('IEND'),
          0xae,
          0x42,
          0x60,
          0x82,
        ]),
      ),
    );
  });
  it('removes EXIF and XMP chunks from a WebP and clears their flags', () => {
    const chunk = (type: string, data: number[]) => [
      ...enc(type),
      data.length,
      0,
      0,
      0,
      ...data,
      ...(data.length & 1 ? [0] : []),
    ];
    const body = [
      ...enc('WEBP'),
      ...chunk('VP8X', [0x2c, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      ...chunk('ICCP', enc('colour')),
      ...chunk('VP8 ', [1, 2, 3]),
      ...chunk('EXIF', enc('GPS-SECRET')),
      ...chunk('XMP ', enc('XMP-SECRET')),
    ];
    const out = stripMetadata(new Uint8Array([...enc('RIFF'), body.length, 0, 0, 0, ...body]), 'image/webp'),
      s = text(out);
    expect(s).not.toMatch(/SECRET|EXIF|XMP/);
    expect(s).toContain('ICCP');
    expect(s).toContain('VP8 ');
    expect(out[20]).toBe(0x20);
    expect(new DataView(out.buffer).getUint32(4, true)).toBe(out.length - 8);
  });
  it('returns files it cannot parse, and other formats, unchanged', () => {
    const cut = photo(exif(false, 6)).slice(0, 40),
      gif = new Uint8Array(enc('GIF89a...'));
    expect(stripMetadata(cut, 'image/jpeg')).toBe(cut);
    expect(stripMetadata(gif, 'image/gif')).toBe(gif);
  });
});
