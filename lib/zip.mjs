/**
 * lib/zip.mjs — baca/tulis ZIP tanpa dependensi (zlib bawaan Node).
 * Paket FASIH-SM = ZIP berisi data.json (response FormGear).
 */
import zlib from "node:zlib";
import crypto from "node:crypto";

export function md5hex(buf) {
  return crypto.createHash("md5").update(buf).digest("hex");
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Baca ZIP → [{ name, data:Buffer, method }] */
export function readZip(buf) {
  // 1. cari End Of Central Directory (EOCD) dari belakang
  const minEOCD = Math.max(0, buf.length - 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= minEOCD; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("EOCD ZIP tidak ditemukan (bukan file zip?)");
  const count = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);

  const entries = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`Central directory rusak di entri ${n}`);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");

    // local header
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`Local header rusak: ${name}`);
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const comp = buf.subarray(dataStart, dataStart + compSize);
    let data;
    if (method === 0) data = Buffer.from(comp);
    else if (method === 8) data = zlib.inflateRawSync(comp);
    else throw new Error(`Metode kompresi ${method} tidak didukung (${name})`);

    entries.push({ name, data, method });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Tulis ZIP dari [{ name, data:Buffer }] → Buffer (deflate) */
export function writeZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
    const crc = crc32(data);
    const nameBuf = Buffer.from(e.name, "utf8");
    let method = 8, comp = zlib.deflateRawSync(data, { level: 6 });
    if (comp.length >= data.length) { method = 0; comp = data; }

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0, 6);           // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 10);          // time+date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, comp);
    central.push({ nameBuf, method, crc, compSize: comp.length, size: data.length, offset });
    offset += 30 + nameBuf.length + comp.length;
  }

  const cdStart = offset;
  for (const c of central) {
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);   // version made by
    cd.writeUInt16LE(20, 6);   // version needed
    cd.writeUInt16LE(0, 8);    // flags
    cd.writeUInt16LE(c.method, 10);
    cd.writeUInt32LE(0, 12);   // time+date
    cd.writeUInt32LE(c.crc, 16);
    cd.writeUInt32LE(c.compSize, 20);
    cd.writeUInt32LE(c.size, 24);
    cd.writeUInt16LE(c.nameBuf.length, 28);
    cd.writeUInt32LE(0, 30);   // extra len
    cd.writeUInt32LE(0, 32);   // comment len
    cd.writeUInt16LE(0, 36);   // disk
    cd.writeUInt16LE(0, 38);   // internal attrs
    cd.writeUInt32LE(0, 40);   // external attrs
    cd.writeUInt32LE(c.offset, 42);
    chunks.push(cd, c.nameBuf);
    offset += 46 + c.nameBuf.length;
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(offset - cdStart, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);
  chunks.push(eocd);
  return Buffer.concat(chunks);
}

export function bufToBase64(buf) {
  return buf.toString("base64");
}

export function base64ToBuf(b64) {
  return Buffer.from(b64, "base64");
}
