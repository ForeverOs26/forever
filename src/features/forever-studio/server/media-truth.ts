/**
 * Forever Studio public-media truth boundary.
 *
 * This module is deliberately pure TypeScript/Buffer code: no native addon,
 * subprocess, external service, or unbounded decompression. Only inputs below
 * MAX_MEDIA_SANITIZE_BYTES reach it. JPEG, PNG, and WebP are rewritten at the
 * container level, then the resulting bytes are parsed again before upload.
 */

import { createHash } from "node:crypto";

import type { EmbeddedMediaClaims, MediaDimensions, MediaTruthRecord } from "../studio-types";

export const MEDIA_SANITIZER_VERSION = "forever-media-truth-001/v1";
export const MAX_MEDIA_SANITIZE_BYTES = 24 * 1024 * 1024;

export type SanitizedImageFormat = "jpeg" | "png" | "webp";

export type MediaDerivativeResult =
  | {
      eligible: true;
      bytes: Buffer;
      contentType: "image/jpeg" | "image/png" | "image/webp";
      format: SanitizedImageFormat;
      record: MediaTruthRecord;
    }
  | {
      eligible: false;
      reason:
        | "unsupported_format"
        | "over_limit"
        | "source_changed"
        | "malformed_media"
        | "verification_failed";
      record: MediaTruthRecord;
    };

interface ParsedExif {
  result: "parsed" | "malformed";
  claims: Omit<EmbeddedMediaClaims, "dimensions">;
  sensitive: boolean;
  entryCount: number;
}

interface RewriteResult {
  format: SanitizedImageFormat;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  bytes: Buffer;
  claims: EmbeddedMediaClaims;
  sensitive: boolean;
  metadataPresent: boolean;
}

const EMPTY_CLAIMS: EmbeddedMediaClaims = {
  capture_time: null,
  timezone: null,
  orientation: null,
  dimensions: null,
  device_make: null,
  device_model: null,
  software: null,
  gps: null,
};

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function cleanClaim(value: string | null): string | null {
  if (value == null) return null;
  const cleaned = value.replace(/\0+$/g, "").trim().slice(0, 256);
  return cleaned || null;
}

function mergeClaims(
  base: EmbeddedMediaClaims,
  incoming: Partial<EmbeddedMediaClaims>,
): EmbeddedMediaClaims {
  return {
    capture_time: base.capture_time ?? incoming.capture_time ?? null,
    timezone: base.timezone ?? incoming.timezone ?? null,
    orientation: base.orientation ?? incoming.orientation ?? null,
    dimensions: base.dimensions ?? incoming.dimensions ?? null,
    device_make: base.device_make ?? incoming.device_make ?? null,
    device_model: base.device_model ?? incoming.device_model ?? null,
    software: base.software ?? incoming.software ?? null,
    gps: base.gps ?? incoming.gps ?? null,
  };
}

function unsupportedRecord(
  contentType: string,
  originalSha256: string,
  originalSize: number,
  result: MediaTruthRecord["parser"]["result"],
): MediaTruthRecord {
  return {
    parser: { format: contentType || "unknown", result },
    claims: { ...EMPTY_CLAIMS },
    sensitive_metadata_found: null,
    sanitization_succeeded: false,
    original: { sha256: originalSha256, size: originalSize },
    derivative: null,
    sanitizer_version: MEDIA_SANITIZER_VERSION,
    verification: { result: "not_run", forbidden_metadata: [] },
  };
}

function identifyFormat(
  bytes: Buffer,
): { format: SanitizedImageFormat; contentType: RewriteResult["contentType"] } | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { format: "jpeg", contentType: "image/jpeg" };
  }
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { format: "png", contentType: "image/png" };
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { format: "webp", contentType: "image/webp" };
  }
  return null;
}

function readExif(exifBytes: Buffer): ParsedExif {
  const empty: ParsedExif = {
    result: "malformed",
    claims: {
      capture_time: null,
      timezone: null,
      orientation: null,
      device_make: null,
      device_model: null,
      software: null,
      gps: null,
    },
    sensitive: true,
    entryCount: 0,
  };
  const tiff =
    exifBytes.length >= 6 && exifBytes.subarray(0, 6).toString("latin1") === "Exif\0\0"
      ? exifBytes.subarray(6)
      : exifBytes;
  if (tiff.length < 8) return empty;
  const byteOrder = tiff.subarray(0, 2).toString("ascii");
  if (byteOrder !== "II" && byteOrder !== "MM") return empty;
  const little = byteOrder === "II";
  const u16 = (offset: number): number => {
    if (offset < 0 || offset + 2 > tiff.length) throw new Error("exif_oob");
    return little ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset);
  };
  const u32 = (offset: number): number => {
    if (offset < 0 || offset + 4 > tiff.length) throw new Error("exif_oob");
    return little ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset);
  };
  const typeSize = (type: number): number => {
    if (type === 1 || type === 2 || type === 7) return 1;
    if (type === 3) return 2;
    if (type === 4 || type === 9) return 4;
    if (type === 5 || type === 10) return 8;
    return 0;
  };
  const bytesFor = (entryOffset: number, type: number, count: number): Buffer => {
    const size = typeSize(type) * count;
    if (!size || size > 65536) throw new Error("exif_value_invalid");
    const valueOffset = size <= 4 ? entryOffset + 8 : u32(entryOffset + 8);
    if (valueOffset < 0 || valueOffset + size > tiff.length) throw new Error("exif_oob");
    return tiff.subarray(valueOffset, valueOffset + size);
  };
  const ascii = (entryOffset: number, type: number, count: number): string | null => {
    if (type !== 2) return null;
    return cleanClaim(bytesFor(entryOffset, type, count).toString("utf8"));
  };
  const short = (entryOffset: number, type: number, count: number): number | null => {
    if (type !== 3 || count < 1) return null;
    return little ? tiff.readUInt16LE(entryOffset + 8) : tiff.readUInt16BE(entryOffset + 8);
  };
  const long = (entryOffset: number, type: number, count: number): number | null => {
    if (type !== 4 || count < 1) return null;
    return u32(entryOffset + 8);
  };
  const rationals = (entryOffset: number, type: number, count: number): number[] => {
    if ((type !== 5 && type !== 10) || count < 1 || count > 4) return [];
    const data = bytesFor(entryOffset, type, count);
    const values: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const offset = index * 8;
      const numerator = little ? data.readUInt32LE(offset) : data.readUInt32BE(offset);
      const denominator = little ? data.readUInt32LE(offset + 4) : data.readUInt32BE(offset + 4);
      values.push(denominator === 0 ? Number.NaN : numerator / denominator);
    }
    return values;
  };

  const claims = { ...empty.claims };
  let sensitive = false;
  let entryCount = 0;
  let exifIfd: number | null = null;
  let gpsIfd: number | null = null;
  const gps: {
    latRef?: string;
    lat?: number[];
    lonRef?: string;
    lon?: number[];
    altitudeRef?: number;
    altitude?: number;
  } = {};
  const visited = new Set<number>();

  const parseIfd = (offset: number, kind: "root" | "exif" | "gps"): void => {
    if (visited.has(offset)) return;
    visited.add(offset);
    const count = u16(offset);
    if (count > 512 || offset + 2 + count * 12 + 4 > tiff.length) throw new Error("exif_ifd");
    for (let index = 0; index < count; index += 1) {
      const entry = offset + 2 + index * 12;
      const tag = u16(entry);
      const type = u16(entry + 2);
      const valueCount = u32(entry + 4);
      entryCount += 1;
      if (kind === "root") {
        if (tag === 0x0112) {
          const value = short(entry, type, valueCount);
          if (value != null && value >= 1 && value <= 8) claims.orientation = value;
          else throw new Error("exif_orientation");
        } else if (tag === 0x010f) {
          claims.device_make = ascii(entry, type, valueCount);
          sensitive = sensitive || claims.device_make != null;
        } else if (tag === 0x0110) {
          claims.device_model = ascii(entry, type, valueCount);
          sensitive = sensitive || claims.device_model != null;
        } else if (tag === 0x0131) {
          claims.software = ascii(entry, type, valueCount);
          sensitive = sensitive || claims.software != null;
        } else if (tag === 0x8769) {
          exifIfd = long(entry, type, valueCount);
        } else if (tag === 0x8825) {
          gpsIfd = long(entry, type, valueCount);
          sensitive = true;
        } else if (![0x011a, 0x011b, 0x0128].includes(tag)) {
          sensitive = true;
        }
      } else if (kind === "exif") {
        if (tag === 0x9003) {
          claims.capture_time = ascii(entry, type, valueCount);
          sensitive = sensitive || claims.capture_time != null;
        } else if (tag === 0x9011) {
          claims.timezone = ascii(entry, type, valueCount);
          sensitive = sensitive || claims.timezone != null;
        } else {
          sensitive = true;
        }
      } else {
        sensitive = true;
        if (tag === 1) gps.latRef = ascii(entry, type, valueCount) ?? undefined;
        if (tag === 2) gps.lat = rationals(entry, type, valueCount);
        if (tag === 3) gps.lonRef = ascii(entry, type, valueCount) ?? undefined;
        if (tag === 4) gps.lon = rationals(entry, type, valueCount);
        if (tag === 5) {
          const value = bytesFor(entry, type, valueCount);
          gps.altitudeRef = value[0];
        }
        if (tag === 6) gps.altitude = rationals(entry, type, valueCount)[0];
      }
    }
  };

  try {
    if (u16(2) !== 42) return empty;
    const root = u32(4);
    parseIfd(root, "root");
    if (exifIfd != null) parseIfd(exifIfd, "exif");
    if (gpsIfd != null) parseIfd(gpsIfd, "gps");
    const decimal = (parts: number[] | undefined, ref: string | undefined): number | null => {
      if (!parts || parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return null;
      const value = parts[0] + parts[1] / 60 + parts[2] / 3600;
      return ref === "S" || ref === "W" ? -value : value;
    };
    const latitude = decimal(gps.lat, gps.latRef);
    const longitude = decimal(gps.lon, gps.lonRef);
    if (latitude != null && longitude != null) {
      claims.gps = {
        latitude,
        longitude,
        altitude:
          gps.altitude == null || !Number.isFinite(gps.altitude)
            ? null
            : (gps.altitudeRef === 1 ? -1 : 1) * gps.altitude,
      };
    }
    return { result: "parsed", claims, sensitive, entryCount };
  } catch {
    return empty;
  }
}

/** Minimal, deterministic EXIF payload containing only the rendering orientation claim. */
function minimalOrientationExif(orientation: number): Buffer {
  const tiff = Buffer.alloc(26);
  tiff.write("II", 0, "ascii");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x0112, 10);
  tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(orientation, 18);
  tiff.writeUInt32LE(0, 22);
  return Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
}

function exifIsMinimalOrientation(exif: Buffer): boolean {
  const parsed = readExif(exif);
  return (
    parsed.result === "parsed" &&
    parsed.entryCount === 1 &&
    parsed.claims.orientation != null &&
    !parsed.sensitive &&
    parsed.claims.capture_time == null &&
    parsed.claims.device_make == null &&
    parsed.claims.device_model == null &&
    parsed.claims.software == null &&
    parsed.claims.gps == null
  );
}

interface JpegSegment {
  marker: number;
  bytes: Buffer;
  payload: Buffer;
}

function parseJpeg(
  bytes: Buffer,
): { segments: JpegSegment[]; scan: Buffer; dimensions: MediaDimensions } | null {
  if (bytes.length < 8 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const segments: JpegSegment[] = [];
  let dimensions: MediaDimensions | null = null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9) return null;
    if (marker === 0xda) {
      if (offset + 2 > bytes.length) return null;
      const length = bytes.readUInt16BE(offset);
      const start = offset - 2;
      const scanStart = offset + length;
      if (length < 2 || scanStart > bytes.length) return null;
      let end = -1;
      for (let index = scanStart; index + 1 < bytes.length; index += 1) {
        if (bytes[index] !== 0xff) continue;
        const next = bytes[index + 1];
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
          index += 1;
          continue;
        }
        if (next === 0xd9) {
          end = index + 2;
          break;
        }
      }
      if (end < 0 || !dimensions) return null;
      return { segments, scan: Buffer.from(bytes.subarray(start, end)), dimensions };
    }
    if (offset + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(offset);
    const start = offset - 2;
    const end = offset + length;
    if (length < 2 || end > bytes.length) return null;
    const payload = bytes.subarray(offset + 2, end);
    const segmentBytes = bytes.subarray(start, end);
    segments.push({ marker, bytes: Buffer.from(segmentBytes), payload: Buffer.from(payload) });
    if (
      [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
        marker,
      ) &&
      payload.length >= 5
    ) {
      const height = payload.readUInt16BE(1);
      const width = payload.readUInt16BE(3);
      if (width > 0 && height > 0) dimensions = { width, height };
    }
    offset = end;
  }
  return null;
}

function jpegSegment(marker: number, payload: Buffer): Buffer {
  if (payload.length + 2 > 0xffff) throw new Error("jpeg_segment_too_large");
  const header = Buffer.alloc(4);
  header[0] = 0xff;
  header[1] = marker;
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

function rewriteJpeg(bytes: Buffer): RewriteResult | null {
  const parsed = parseJpeg(bytes);
  if (!parsed) return null;
  let claims: EmbeddedMediaClaims = { ...EMPTY_CLAIMS, dimensions: parsed.dimensions };
  let sensitive = false;
  let metadataPresent = false;
  const retained: Buffer[] = [];
  for (const segment of parsed.segments) {
    if (segment.marker === 0xe1) {
      metadataPresent = true;
      if (segment.payload.subarray(0, 6).toString("latin1") === "Exif\0\0") {
        const exif = readExif(segment.payload);
        if (exif.result === "malformed") return null;
        claims = mergeClaims(claims, exif.claims);
        sensitive = sensitive || exif.sensitive;
      } else {
        sensitive = true;
      }
      continue;
    }
    if (segment.marker === 0xed || segment.marker === 0xfe) {
      metadataPresent = true;
      sensitive = true;
      continue;
    }
    if (segment.marker >= 0xe0 && segment.marker <= 0xef) {
      const safeApp0 =
        segment.marker === 0xe0 &&
        segment.payload.length >= 14 &&
        segment.payload.subarray(0, 5).toString("latin1") === "JFIF\0" &&
        segment.payload.length === 14 + 3 * segment.payload[12] * segment.payload[13];
      // ICC profiles can themselves contain device/author/private descriptive
      // tags. Without a profile-tag rewriter, preserve color by failing closed.
      if (
        segment.marker === 0xe2 &&
        segment.payload.length >= 12 &&
        segment.payload.subarray(0, 12).toString("latin1") === "ICC_PROFILE\0"
      ) {
        return null;
      }
      const safeAdobe =
        segment.marker === 0xee &&
        segment.payload.length === 12 &&
        segment.payload.subarray(0, 5).toString("latin1") === "Adobe";
      if (safeApp0 || safeAdobe) retained.push(segment.bytes);
      else {
        metadataPresent = true;
        sensitive = true;
      }
      continue;
    }
    retained.push(segment.bytes);
  }
  const orientation = claims.orientation;
  if (orientation != null && orientation !== 1) {
    retained.unshift(jpegSegment(0xe1, minimalOrientationExif(orientation)));
  }
  const derivative = Buffer.concat([Buffer.from([0xff, 0xd8]), ...retained, parsed.scan]);
  return {
    format: "jpeg",
    contentType: "image/jpeg",
    bytes: derivative,
    claims,
    sensitive,
    metadataPresent,
  };
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

interface PngChunk {
  type: string;
  data: Buffer;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  typeBytes.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return result;
}

function parsePng(bytes: Buffer): { chunks: PngChunk[]; dimensions: MediaDimensions } | null {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(signature)) return null;
  const chunks: PngChunk[] = [];
  let offset = 8;
  let dimensions: MediaDimensions | null = null;
  let sawIdat = false;
  let sawIend = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (length > MAX_MEDIA_SANITIZE_BYTES || end > bytes.length) return null;
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString("ascii");
    if (!/^[A-Za-z]{4}$/.test(type)) return null;
    const data = Buffer.from(bytes.subarray(offset + 8, offset + 8 + length));
    const expected = bytes.readUInt32BE(offset + 8 + length);
    if (crc32(Buffer.concat([typeBytes, data])) !== expected) return null;
    if (!chunks.length && type !== "IHDR") return null;
    if (type === "IHDR") {
      if (chunks.length || length !== 13) return null;
      const width = data.readUInt32BE(0);
      const height = data.readUInt32BE(4);
      if (!width || !height) return null;
      dimensions = { width, height };
    }
    if (type === "IDAT") sawIdat = true;
    chunks.push({ type, data });
    offset = end;
    if (type === "IEND") {
      sawIend = true;
      break;
    }
  }
  if (!dimensions || !sawIdat || !sawIend || offset !== bytes.length) return null;
  return { chunks, dimensions };
}

function pngTextClaim(chunk: PngChunk): Partial<EmbeddedMediaClaims> {
  if (chunk.type !== "tEXt") return {};
  const zero = chunk.data.indexOf(0);
  if (zero <= 0) return {};
  const key = chunk.data.subarray(0, zero).toString("latin1").toLowerCase();
  const value = cleanClaim(chunk.data.subarray(zero + 1).toString("utf8"));
  if (!value) return {};
  if (key === "software") return { software: value };
  if (key === "make") return { device_make: value };
  if (key === "model") return { device_model: value };
  if (key === "creation time" || key === "date:create") return { capture_time: value };
  return {};
}

const PNG_RENDER_ALLOWLIST = new Set([
  "IHDR",
  "PLTE",
  "IDAT",
  "IEND",
  "sRGB",
  "gAMA",
  "cHRM",

  "pHYs",
  "tRNS",

  "acTL",
  "fcTL",
  "fdAT",
]);

function rewritePng(bytes: Buffer): RewriteResult | null {
  const parsed = parsePng(bytes);
  if (!parsed) return null;
  let claims: EmbeddedMediaClaims = { ...EMPTY_CLAIMS, dimensions: parsed.dimensions };
  let sensitive = false;
  let metadataPresent = false;
  const retained: PngChunk[] = [];
  for (const chunk of parsed.chunks) {
    if (chunk.type === "eXIf") {
      metadataPresent = true;
      const exif = readExif(chunk.data);
      if (exif.result === "malformed") return null;
      claims = mergeClaims(claims, exif.claims);
      sensitive = sensitive || exif.sensitive;
      continue;
    }
    if (["tEXt", "zTXt", "iTXt", "tIME"].includes(chunk.type)) {
      metadataPresent = true;
      sensitive = true;
      claims = mergeClaims(claims, pngTextClaim(chunk));
      continue;
    }
    if (chunk.type === "iCCP") return null;
    const validRenderingLength =
      (chunk.type !== "sRGB" || chunk.data.length === 1) &&
      (chunk.type !== "gAMA" || chunk.data.length === 4) &&
      (chunk.type !== "cHRM" || chunk.data.length === 32) &&
      (chunk.type !== "pHYs" || chunk.data.length === 9) &&
      (chunk.type !== "PLTE" ||
        (chunk.data.length >= 3 && chunk.data.length <= 768 && chunk.data.length % 3 === 0)) &&
      (chunk.type !== "tRNS" || chunk.data.length <= 256) &&
      (chunk.type !== "acTL" || chunk.data.length === 8) &&
      (chunk.type !== "fcTL" || chunk.data.length === 26) &&
      (chunk.type !== "fdAT" || chunk.data.length >= 4);
    if (!validRenderingLength) return null;
    if (PNG_RENDER_ALLOWLIST.has(chunk.type)) {
      retained.push(chunk);
    } else if (chunk.type[0] === chunk.type[0].toUpperCase()) {
      // An unknown critical chunk cannot be removed or rendered safely.
      return null;
    } else {
      metadataPresent = true;
      sensitive = true;
    }
  }
  const orientation = claims.orientation;
  const output: Buffer[] = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
  let orientationWritten = false;
  for (const chunk of retained) {
    if (!orientationWritten && chunk.type === "IDAT" && orientation != null && orientation !== 1) {
      output.push(pngChunk("eXIf", minimalOrientationExif(orientation).subarray(6)));
      orientationWritten = true;
    }
    output.push(pngChunk(chunk.type, chunk.data));
  }
  return {
    format: "png",
    contentType: "image/png",
    bytes: Buffer.concat(output),
    claims,
    sensitive,
    metadataPresent,
  };
}

interface WebpChunk {
  type: string;
  data: Buffer;
}

function webpChunk(type: string, data: Buffer): Buffer {
  const pad = data.length % 2;
  const output = Buffer.alloc(8 + data.length + pad);
  output.write(type, 0, 4, "ascii");
  output.writeUInt32LE(data.length, 4);
  data.copy(output, 8);
  return output;
}

function webpDimensions(chunks: WebpChunk[]): MediaDimensions | null {
  const vp8x = chunks.find((chunk) => chunk.type === "VP8X");
  if (vp8x && vp8x.data.length === 10) {
    const width = 1 + vp8x.data.readUIntLE(4, 3);
    const height = 1 + vp8x.data.readUIntLE(7, 3);
    return { width, height };
  }
  const vp8l = chunks.find((chunk) => chunk.type === "VP8L");
  if (vp8l && vp8l.data.length >= 5 && vp8l.data[0] === 0x2f) {
    const bits = vp8l.data.readUInt32LE(1);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  const vp8 = chunks.find((chunk) => chunk.type === "VP8 ");
  if (
    vp8 &&
    vp8.data.length >= 10 &&
    vp8.data[3] === 0x9d &&
    vp8.data[4] === 0x01 &&
    vp8.data[5] === 0x2a
  ) {
    return {
      width: vp8.data.readUInt16LE(6) & 0x3fff,
      height: vp8.data.readUInt16LE(8) & 0x3fff,
    };
  }
  return null;
}

function parseWebp(bytes: Buffer): { chunks: WebpChunk[]; dimensions: MediaDimensions } | null {
  if (
    bytes.length < 20 ||
    bytes.subarray(0, 4).toString("ascii") !== "RIFF" ||
    bytes.subarray(8, 12).toString("ascii") !== "WEBP" ||
    bytes.readUInt32LE(4) + 8 !== bytes.length
  ) {
    return null;
  }
  const chunks: WebpChunk[] = [];
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = bytes.subarray(offset, offset + 4).toString("ascii");
    const length = bytes.readUInt32LE(offset + 4);
    const end = offset + 8 + length;
    if (length > MAX_MEDIA_SANITIZE_BYTES || end > bytes.length) return null;
    chunks.push({ type, data: Buffer.from(bytes.subarray(offset + 8, end)) });
    offset = end + (length % 2);
  }
  if (offset !== bytes.length) return null;
  const dimensions = webpDimensions(chunks);
  if (!dimensions || !chunks.some((chunk) => chunk.type === "VP8 " || chunk.type === "VP8L")) {
    return null;
  }
  return { chunks, dimensions };
}

const WEBP_RENDER_ALLOWLIST = new Set(["VP8X", "ALPH", "ANIM", "ANMF", "VP8 ", "VP8L"]);

function rewriteWebp(bytes: Buffer): RewriteResult | null {
  const parsed = parseWebp(bytes);
  if (!parsed) return null;
  let claims: EmbeddedMediaClaims = { ...EMPTY_CLAIMS, dimensions: parsed.dimensions };
  let sensitive = false;
  let metadataPresent = false;
  const retained: WebpChunk[] = [];
  for (const chunk of parsed.chunks) {
    if (chunk.type === "EXIF") {
      metadataPresent = true;
      const exif = readExif(chunk.data);
      if (exif.result === "malformed") return null;
      claims = mergeClaims(claims, exif.claims);
      sensitive = sensitive || exif.sensitive;
      continue;
    }
    if (chunk.type === "XMP ") {
      metadataPresent = true;
      sensitive = true;
      continue;
    }
    if (chunk.type === "ICCP") return null;
    if (WEBP_RENDER_ALLOWLIST.has(chunk.type)) retained.push(chunk);
    else {
      metadataPresent = true;
      sensitive = true;
    }
  }
  const orientation = claims.orientation;
  let vp8x = retained.find((chunk) => chunk.type === "VP8X");
  if (vp8x) {
    if (vp8x.data.length !== 10) return null;
    vp8x = { type: "VP8X", data: Buffer.from(vp8x.data) };
    vp8x.data[0] &= ~0x0c;
    if (orientation != null && orientation !== 1) vp8x.data[0] |= 0x08;
    const index = retained.findIndex((chunk) => chunk.type === "VP8X");
    retained[index] = vp8x;
  } else if (orientation != null && orientation !== 1) {
    const data = Buffer.alloc(10);
    data[0] = 0x08;
    data.writeUIntLE(parsed.dimensions.width - 1, 4, 3);
    data.writeUIntLE(parsed.dimensions.height - 1, 7, 3);
    retained.unshift({ type: "VP8X", data });
  }
  if (orientation != null && orientation !== 1) {
    retained.push({ type: "EXIF", data: minimalOrientationExif(orientation) });
  }
  const body = Buffer.concat([
    Buffer.from("WEBP", "ascii"),
    ...retained.map((c) => webpChunk(c.type, c.data)),
  ]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, 4, "ascii");
  header.writeUInt32LE(body.length, 4);
  return {
    format: "webp",
    contentType: "image/webp",
    bytes: Buffer.concat([header, body]),
    claims,
    sensitive,
    metadataPresent,
  };
}

function rewrite(bytes: Buffer, format: SanitizedImageFormat): RewriteResult | null {
  if (format === "jpeg") return rewriteJpeg(bytes);
  if (format === "png") return rewritePng(bytes);
  return rewriteWebp(bytes);
}

export function verifyPublicDerivative(
  bytes: Buffer,
  format: SanitizedImageFormat,
  expected: { dimensions: MediaDimensions | null; orientation: number | null },
): { ok: boolean; forbidden: string[] } {
  const forbidden: string[] = [];
  if (identifyFormat(bytes)?.format !== format) forbidden.push("magic_mismatch");
  if (format === "jpeg") {
    const parsed = parseJpeg(bytes);
    if (!parsed) forbidden.push("malformed_jpeg");
    else {
      for (const segment of parsed.segments) {
        if (segment.marker === 0xe1 && !exifIsMinimalOrientation(segment.payload)) {
          forbidden.push("jpeg_exif");
        }
        if (segment.marker === 0xed) forbidden.push("jpeg_iptc");
        if (segment.marker === 0xfe) forbidden.push("jpeg_comment");
        if (
          segment.marker >= 0xe0 &&
          segment.marker <= 0xef &&
          !(
            (segment.marker === 0xe0 &&
              segment.payload.subarray(0, 5).toString("latin1") === "JFIF\0") ||
            (segment.marker === 0xe1 && exifIsMinimalOrientation(segment.payload)) ||
            (segment.marker === 0xee &&
              segment.payload.subarray(0, 5).toString("latin1") === "Adobe")
          )
        ) {
          forbidden.push("jpeg_app_metadata");
        }
      }
      if (
        expected.dimensions &&
        (parsed.dimensions.width !== expected.dimensions.width ||
          parsed.dimensions.height !== expected.dimensions.height)
      ) {
        forbidden.push("dimensions_changed");
      }
    }
  } else if (format === "png") {
    const parsed = parsePng(bytes);
    if (!parsed) forbidden.push("malformed_png");
    else {
      for (const chunk of parsed.chunks) {
        if (["tEXt", "zTXt", "iTXt", "tIME"].includes(chunk.type)) {
          forbidden.push(`png_${chunk.type}`);
        }
        if (chunk.type === "eXIf" && !exifIsMinimalOrientation(chunk.data)) {
          forbidden.push("png_exif");
        }
        if (!PNG_RENDER_ALLOWLIST.has(chunk.type) && chunk.type !== "eXIf") {
          forbidden.push("png_unknown_metadata");
        }
      }
      if (
        expected.dimensions &&
        (parsed.dimensions.width !== expected.dimensions.width ||
          parsed.dimensions.height !== expected.dimensions.height)
      ) {
        forbidden.push("dimensions_changed");
      }
    }
  } else {
    const parsed = parseWebp(bytes);
    if (!parsed) forbidden.push("malformed_webp");
    else {
      for (const chunk of parsed.chunks) {
        if (chunk.type === "XMP ") forbidden.push("webp_xmp");
        if (chunk.type === "EXIF" && !exifIsMinimalOrientation(chunk.data)) {
          forbidden.push("webp_exif");
        }
        if (!WEBP_RENDER_ALLOWLIST.has(chunk.type) && chunk.type !== "EXIF") {
          forbidden.push("webp_unknown_metadata");
        }
      }
      if (
        expected.dimensions &&
        (parsed.dimensions.width !== expected.dimensions.width ||
          parsed.dimensions.height !== expected.dimensions.height)
      ) {
        forbidden.push("dimensions_changed");
      }
    }
  }
  const orientationExpected =
    expected.orientation != null && expected.orientation !== 1 ? expected.orientation : null;
  const rewritten = rewrite(bytes, format);
  if (!rewritten) forbidden.push("sanitizer_reparse_failed");
  const orientationObserved =
    rewritten?.claims.orientation != null && rewritten.claims.orientation !== 1
      ? rewritten.claims.orientation
      : null;
  if (orientationExpected !== orientationObserved) forbidden.push("orientation_changed");
  return { ok: forbidden.length === 0, forbidden: [...new Set(forbidden)] };
}

export function createPublicDerivative(input: {
  bytes: Buffer;
  originalSha256: string;
  originalSize: number;
  observedContentType: string;
}): MediaDerivativeResult {
  if (
    input.originalSize > MAX_MEDIA_SANITIZE_BYTES ||
    input.bytes.length > MAX_MEDIA_SANITIZE_BYTES
  ) {
    return {
      eligible: false,
      reason: "over_limit",
      record: unsupportedRecord(
        input.observedContentType,
        input.originalSha256,
        input.originalSize,
        "over_limit",
      ),
    };
  }
  const identified = identifyFormat(input.bytes);
  if (!identified || identified.contentType !== input.observedContentType) {
    return {
      eligible: false,
      reason: "unsupported_format",
      record: unsupportedRecord(
        input.observedContentType,
        input.originalSha256,
        input.originalSize,
        "unsupported",
      ),
    };
  }
  if (input.bytes.length !== input.originalSize || sha256(input.bytes) !== input.originalSha256) {
    const record = unsupportedRecord(
      identified.format,
      input.originalSha256,
      input.originalSize,
      "malformed",
    );
    record.verification.result = "failed";
    record.verification.forbidden_metadata = ["source_changed_after_hash"];
    return { eligible: false, reason: "source_changed", record };
  }
  const rewritten = rewrite(input.bytes, identified.format);
  if (!rewritten || rewritten.bytes.length === 0) {
    const record = unsupportedRecord(
      identified.format,
      input.originalSha256,
      input.originalSize,
      "malformed",
    );
    record.verification.result = "failed";
    record.verification.forbidden_metadata = ["malformed_source"];
    return { eligible: false, reason: "malformed_media", record };
  }
  const verification = verifyPublicDerivative(rewritten.bytes, rewritten.format, {
    dimensions: rewritten.claims.dimensions,
    orientation: rewritten.claims.orientation,
  });
  const record: MediaTruthRecord = {
    parser: {
      format: rewritten.format,
      result: rewritten.metadataPresent ? "parsed" : "metadata_absent",
    },
    claims: rewritten.claims,
    sensitive_metadata_found: rewritten.sensitive,
    sanitization_succeeded: verification.ok,
    original: { sha256: input.originalSha256, size: input.originalSize },
    derivative: verification.ok
      ? {
          sha256: sha256(rewritten.bytes),
          size: rewritten.bytes.length,
          media_class: "image",
          content_type: rewritten.contentType,
        }
      : null,
    sanitizer_version: MEDIA_SANITIZER_VERSION,
    verification: {
      result: verification.ok ? "verified" : "failed",
      forbidden_metadata: verification.forbidden,
    },
  };
  if (!verification.ok) {
    return { eligible: false, reason: "verification_failed", record };
  }
  return {
    eligible: true,
    bytes: rewritten.bytes,
    contentType: rewritten.contentType,
    format: rewritten.format,
    record,
  };
}
