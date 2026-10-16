// אייקוני PWA — נוצרים מקומית, אפס תלות (PNG גולמי דרך zlib). node scripts/make-icons.js
const zlib = require('zlib');
const fs = require('fs');

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, px) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px[y].copy(raw, y * (size * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const BG = [10, 79, 92], ACCENT = [14, 122, 138], WHITE = [255, 255, 255];

function render(size, { maskable }) {
  const rows = [];
  const c = size / 2;
  const drumR = size * (maskable ? 0.30 : 0.35);
  const innerR = drumR * 0.66;
  const corner = maskable ? 0 : size * 0.22; // פינות מעוגלות ל-any; maskable מלא
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(size * 4);
    for (let x = 0; x < size; x++) {
      let col = BG;
      const inCorner = (cx, cy) => { const dx = x - cx, dy = y - cy; return dx * dx + dy * dy > corner * corner; };
      if (corner && ((x < corner && y < corner && inCorner(corner, corner)) ||
          (x >= size - corner && y < corner && inCorner(size - corner, corner)) ||
          (x < corner && y >= size - corner && inCorner(corner, size - corner)) ||
          (x >= size - corner && y >= size - corner && inCorner(size - corner, size - corner)))) {
        row.writeUInt8(0, x * 4 + 3); // שקוף
        continue;
      }
      const dx = x - c, dy = y - c, d2 = dx * dx + dy * dy;
      if (d2 <= drumR * drumR) col = WHITE;
      if (d2 <= innerR * innerR) col = ACCENT;
      // ידית דלת
      const hx = c + innerR * 0.72, hy = c - innerR * 0.72, hr = size * 0.028;
      if ((x - hx) ** 2 + (y - hy) ** 2 <= hr * hr) col = WHITE;
      // בועות קטנות
      for (const [bx, by, br] of [[0.30, 0.24, 0.035], [0.38, 0.18, 0.025]]) {
        const bxc = size * bx, byc = size * by, brc = size * br;
        if ((x - bxc) ** 2 + (y - byc) ** 2 <= brc * brc) col = WHITE;
      }
      row[x * 4] = col[0]; row[x * 4 + 1] = col[1]; row[x * 4 + 2] = col[2]; row[x * 4 + 3] = 255;
    }
    rows.push(row);
  }
  return png(size, rows);
}

fs.writeFileSync('public/icon-192.png', render(192, { maskable: false }));
fs.writeFileSync('public/icon-512.png', render(512, { maskable: false }));
fs.writeFileSync('public/icon-maskable-512.png', render(512, { maskable: true }));
console.log('icons written');
