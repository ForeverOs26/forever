/** Synthetic-only media fixtures. Every value is fake and deterministic. */

import { deflateSync } from "node:zlib";

interface IfdEntry {
  tag: number;
  type: number;
  count: number;
  value: Buffer | number;
}

function ascii(value: string): Buffer {
  return Buffer.from(`${value}\0`, "ascii");
}

function rational(values: Array<[number, number]>): Buffer {
  const out = Buffer.alloc(values.length * 8);
  values.forEach(([numerator, denominator], index) => {
    out.writeUInt32LE(numerator, index * 8);
    out.writeUInt32LE(denominator, index * 8 + 4);
  });
  return out;
}

/** Fake EXIF with orientation, capture/timezone, device/editor, and fake GPS. */
export function syntheticExif(orientation = 6): Buffer {
  const ifd0: IfdEntry[] = [
    { tag: 0x010f, type: 2, count: ascii("FixtureCam Inc").length, value: ascii("FixtureCam Inc") },
    {
      tag: 0x0110,
      type: 2,
      count: ascii("FixturePhone 9000").length,
      value: ascii("FixturePhone 9000"),
    },
    { tag: 0x0112, type: 3, count: 1, value: orientation },
    {
      tag: 0x0131,
      type: 2,
      count: ascii("FixtureEditor 1.0").length,
      value: ascii("FixtureEditor 1.0"),
    },
    { tag: 0x8769, type: 4, count: 1, value: 0 },
    { tag: 0x8825, type: 4, count: 1, value: 0 },
  ];
  const exifIfd: IfdEntry[] = [
    {
      tag: 0x9003,
      type: 2,
      count: ascii("2026:01:02 03:04:05").length,
      value: ascii("2026:01:02 03:04:05"),
    },
    { tag: 0x9011, type: 2, count: ascii("+07:00").length, value: ascii("+07:00") },
  ];
  const gpsIfd: IfdEntry[] = [
    { tag: 1, type: 2, count: 2, value: ascii("N") },
    {
      tag: 2,
      type: 5,
      count: 3,
      value: rational([
        [12, 1],
        [34, 1],
        [56, 1],
      ]),
    },
    { tag: 3, type: 2, count: 2, value: ascii("E") },
    {
      tag: 4,
      type: 5,
      count: 3,
      value: rational([
        [98, 1],
        [45, 1],
        [54, 1],
      ]),
    },
    { tag: 5, type: 1, count: 1, value: Buffer.from([0]) },
    { tag: 6, type: 5, count: 1, value: rational([[123, 1]]) },
  ];
  const ifdSize = (entries: IfdEntry[]) => 2 + entries.length * 12 + 4;
  const ifd0Offset = 8;
  const exifOffset = ifd0Offset + ifdSize(ifd0);
  const gpsOffset = exifOffset + ifdSize(exifIfd);
  ifd0.find((entry) => entry.tag === 0x8769)!.value = exifOffset;
  ifd0.find((entry) => entry.tag === 0x8825)!.value = gpsOffset;
  const all = [
    { offset: ifd0Offset, entries: ifd0 },
    { offset: exifOffset, entries: exifIfd },
    { offset: gpsOffset, entries: gpsIfd },
  ];
  let dataOffset = gpsOffset + ifdSize(gpsIfd);
  const external = all.flatMap(({ entries }) =>
    entries.flatMap((entry) =>
      Buffer.isBuffer(entry.value) && entry.value.length > 4 ? [entry.value] : [],
    ),
  );
  const tiff = Buffer.alloc(dataOffset + external.reduce((sum, value) => sum + value.length, 0));
  tiff.write("II", 0, 2, "ascii");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(ifd0Offset, 4);
  for (const { offset, entries } of all) {
    tiff.writeUInt16LE(entries.length, offset);
    entries.forEach((entry, index) => {
      const at = offset + 2 + index * 12;
      tiff.writeUInt16LE(entry.tag, at);
      tiff.writeUInt16LE(entry.type, at + 2);
      tiff.writeUInt32LE(entry.count, at + 4);
      if (typeof entry.value === "number") {
        if (entry.type === 3) tiff.writeUInt16LE(entry.value, at + 8);
        else tiff.writeUInt32LE(entry.value, at + 8);
      } else if (entry.value.length <= 4) {
        entry.value.copy(tiff, at + 8);
      } else {
        tiff.writeUInt32LE(dataOffset, at + 8);
        entry.value.copy(tiff, dataOffset);
        dataOffset += entry.value.length;
      }
    });
  }
  return Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
}

function jpegSegment(marker: number, payload: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head[0] = 0xff;
  head[1] = marker;
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

export function syntheticJpeg(withPrivateMetadata = false, orientation = 1, salt = 0): Buffer {
  const app0 = Buffer.concat([
    Buffer.from("JFIF\0", "latin1"),
    Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0]),
  ]);
  const sof = Buffer.from([8, 0, 3, 0, 2, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]);
  const sos = Buffer.from([3, 1, 0, 2, 0, 3, 0, 0, 63, 0]);
  const metadata = withPrivateMetadata
    ? [
        jpegSegment(0xe1, syntheticExif(orientation)),
        jpegSegment(
          0xe1,
          Buffer.from(
            "http://ns.adobe.com/xap/1.0/\0<fake author='Fixture Person' path='C:\\FixtureOwner\\private\\phone.jpg'/>",
            "utf8",
          ),
        ),
        jpegSegment(0xed, Buffer.from("Fixture IPTC author", "utf8")),
        jpegSegment(0xfe, Buffer.from("fixture@example.invalid +1-555-0100", "utf8")),
      ]
    : [];
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xe0, app0),
    ...metadata,
    jpegSegment(0xc0, sof),
    jpegSegment(0xda, sos),
    Buffer.from([salt % 200, 0xff, 0xd9]),
  ]);
}

/** Unique fake payload carried only by the synthetic JFIF thumbnail. */
export const JFIF_THUMBNAIL_SECRET = Buffer.from("JFIF-SECRET!", "ascii");

export function syntheticJpegWithJfifThumbnail(orientation = 1): Buffer {
  const base = syntheticJpeg(orientation !== 1, orientation);
  const thumbnailJfif = Buffer.concat([
    Buffer.from("JFIF\0", "latin1"),
    Buffer.from([1, 1, 0, 0, 1, 0, 1, 2, 2]),
    JFIF_THUMBNAIL_SECRET,
  ]);
  // SOI + original APP0 occupies bytes 0..19; replace only that APP0.
  return Buffer.concat([base.subarray(0, 2), jpegSegment(0xe0, thumbnailJfif), base.subarray(20)]);
}

let crcTable: Uint32Array | null = null;
function crc32(bytes: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBytes.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return out;
}

export function syntheticPng(withPrivateMetadata = false, orientation = 1, salt = 0): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(3, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((1 + 2 * 4) * 3);
  raw[raw.length - 1] = salt % 256;
  const metadata = withPrivateMetadata
    ? [
        pngChunk("eXIf", syntheticExif(orientation).subarray(6)),
        pngChunk("tEXt", Buffer.from("Author\0Fixture Person", "utf8")),
        pngChunk("tEXt", Buffer.from("PrivatePath\0C:\\FixtureOwner\\private\\phone.png", "utf8")),
        pngChunk("tEXt", Buffer.from("Software\0FixtureEditor 1.0", "utf8")),
      ]
    : [];
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    ...metadata,
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function webpChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(8 + data.length + (data.length % 2));
  out.write(type, 0, 4, "ascii");
  out.writeUInt32LE(data.length, 4);
  data.copy(out, 8);
  return out;
}

export function syntheticWebp(withPrivateMetadata = false, orientation = 1, salt = 0): Buffer {
  const vp8x = Buffer.alloc(10);
  vp8x[0] = withPrivateMetadata ? 0x0c : 0;
  vp8x.writeUIntLE(1, 4, 3);
  vp8x.writeUIntLE(2, 7, 3);
  const vp8l = Buffer.alloc(5);
  vp8l[0] = 0x2f;
  vp8l.writeUInt32LE(1 | (2 << 14), 1);
  const chunks = [webpChunk("VP8X", vp8x), webpChunk("VP8L", vp8l)];
  if (salt) chunks.push(webpChunk("JUNK", Buffer.from([salt % 256])));
  if (withPrivateMetadata) {
    chunks.push(webpChunk("EXIF", syntheticExif(orientation)));
    chunks.push(
      webpChunk(
        "XMP ",
        Buffer.from(
          "<fake author='Fixture Person' path='C:\\FixtureOwner\\private\\phone.webp'/>",
          "utf8",
        ),
      ),
    );
  }
  const body = Buffer.concat([Buffer.from("WEBP", "ascii"), ...chunks]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, 4, "ascii");
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

export const FIXTURE_PRIVATE_MARKERS = [
  "FixtureCam Inc",
  "FixturePhone 9000",
  "FixtureEditor 1.0",
  "FixtureOwner",
  "fixture@example.invalid",
  "+1-555-0100",
] as const;
