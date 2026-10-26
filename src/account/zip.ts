import { promisify } from 'node:util';
import { deflateRaw } from 'node:zlib';
import type { Writable } from 'node:stream';
import { crc32 } from '../housekeeping/packages.js';

/**
 * A small, dependency-free ZIP writer for "Download all my data".
 *
 * Format: PKWARE APPNOTE.TXT (https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT)
 * — local file header (§4.3.7), central directory header (§4.3.12),
 * end of central directory record (§4.3.16). Each entry is either
 * stored (method 0) or deflated (method 8, raw DEFLATE, RFC 1951).
 * Names are UTF-8 (general purpose bit 11, §4.4.4).
 *
 * Entries are written one after another straight to the response, so
 * only one entry's bytes are in memory at a time; the central directory
 * (a few dozen bytes per entry) is kept until the end. No ZIP64: the
 * caller checks the total size first (ZIP_LIMIT_BYTES) and refuses an
 * archive that could pass the 4 GiB offsets of the classic format.
 */

const deflate = promisify(deflateRaw);

/** Classic-format limits (APPNOTE §4.4.8 / §4.4.22: 4-byte sizes and
 *  offsets, 2-byte entry count). Kept well inside them. */
export const ZIP_LIMIT_BYTES = 3.5 * 1024 ** 3;
export const ZIP_LIMIT_ENTRIES = 60_000;

/** MS-DOS time/date (APPNOTE §4.4.6), local fields from a Date (UTC). */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getUTCFullYear());
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

interface CentralEntry {
  name: Buffer;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  offset: number;
  time: number;
  date: number;
}

export class ZipWriter {
  private offset = 0;
  private entries: CentralEntry[] = [];
  private names = new Set<string>();

  constructor(private readonly out: Writable) {}

  private async write(chunk: Buffer): Promise<void> {
    this.offset += chunk.length;
    if (!this.out.write(chunk)) {
      await new Promise<void>((resolve, reject) => {
        const onDrain = () => { cleanup(); resolve(); };
        const onClose = () => { cleanup(); reject(new Error('zip output closed')); };
        const cleanup = () => { this.out.off('drain', onDrain); this.out.off('close', onClose); };
        this.out.on('drain', onDrain);
        this.out.on('close', onClose);
      });
    }
  }

  /** A name not used yet in this archive ("a.json" → "a (2).json"). */
  uniqueName(name: string): string {
    if (!this.names.has(name)) return name;
    const dot = name.lastIndexOf('.');
    const stem = dot > name.lastIndexOf('/') ? name.slice(0, dot) : name;
    const ext = dot > name.lastIndexOf('/') ? name.slice(dot) : '';
    for (let i = 2; ; i++) {
      const candidate = `${stem} (${i})${ext}`;
      if (!this.names.has(candidate)) return candidate;
    }
  }

  /** Add one file. `compress` deflates it (worth it for text; already
   *  compressed formats such as EPUB and DOCX are stored as they are). */
  async add(nameIn: string, data: Buffer | string, opts: { compress?: boolean; modified?: Date } = {}): Promise<string> {
    if (this.entries.length >= ZIP_LIMIT_ENTRIES) throw new Error('too many files for one archive');
    const name = this.uniqueName(nameIn);
    this.names.add(name);
    const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    const crc = crc32(bytes); // CRC-32, APPNOTE §4.4.7 (the Housekeeping zip tools' implementation)
    let method = 0;
    let body = bytes;
    if (opts.compress && bytes.length > 64) {
      const packed = await deflate(bytes);
      if (packed.length < bytes.length) {
        method = 8;
        body = packed;
      }
    }
    if (this.offset + body.length > ZIP_LIMIT_BYTES) throw new Error('archive too large for the ZIP format used here');
    const nameBuf = Buffer.from(name, 'utf8');
    const { time, date } = dosDateTime(opts.modified ?? new Date());
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed: 2.0 (deflate)
    header.writeUInt16LE(0x0800, 6); // UTF-8 names
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28);
    this.entries.push({ name: nameBuf, method, crc, compressedSize: body.length, size: bytes.length, offset: this.offset, time, date });
    await this.write(Buffer.concat([header, nameBuf]));
    await this.write(body);
    return name;
  }

  /** Write the central directory and the end record. */
  async finish(): Promise<void> {
    const start = this.offset;
    for (const e of this.entries) {
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0);
      h.writeUInt16LE(20, 4); // made by: 2.0, MS-DOS attributes
      h.writeUInt16LE(20, 6);
      h.writeUInt16LE(0x0800, 8);
      h.writeUInt16LE(e.method, 10);
      h.writeUInt16LE(e.time, 12);
      h.writeUInt16LE(e.date, 14);
      h.writeUInt32LE(e.crc, 16);
      h.writeUInt32LE(e.compressedSize, 20);
      h.writeUInt32LE(e.size, 24);
      h.writeUInt16LE(e.name.length, 28);
      // extra, comment, disk start, internal + external attributes: 0
      h.writeUInt32LE(e.offset, 42);
      await this.write(Buffer.concat([h, e.name]));
    }
    const size = this.offset - start;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(size, 12);
    end.writeUInt32LE(start, 16);
    await this.write(end);
  }
}
