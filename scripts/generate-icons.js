/* One-shot icon generator — no dependencies. Writes PNGs into public/icons/. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function makePng(size, pixelFn) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const off = rowStart + 1 + x * 4;
      const [r, g, b, a] = pixelFn(x, y, size);
      raw[off] = r;
      raw[off + 1] = g;
      raw[off + 2] = b;
      raw[off + 3] = a;
    }
  }
  const idatData = zlib.deflateSync(raw);

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// Colors
const BG = [0x2D, 0x0A, 0x14, 0xFF];
const RED = [0xFF, 0x6B, 0x6B];
const PINK = [0xF4, 0x72, 0xB6];
const WHITE = [0xFD, 0xE7, 0xEE, 0xFF];

function mix(c1, c2, t) {
  return [
    Math.round(c1[0] + (c2[0] - c1[0]) * t),
    Math.round(c1[1] + (c2[1] - c1[1]) * t),
    Math.round(c1[2] + (c2[2] - c1[2]) * t),
    255
  ];
}

function withinHebrewAleph(x, y, size, padding) {
  // Approximate Hebrew "aleph" shape using diagonal strokes + vertical leg.
  // Bounding box inside the icon (after padding).
  const inset = padding;
  const left = inset;
  const right = size - inset;
  const top = inset;
  const bottom = size - inset;
  if (x < left || x > right || y < top || y > bottom) return false;

  const w = right - left;
  const h = bottom - top;
  const px = x - left;
  const py = y - top;
  const stroke = Math.max(2, Math.round(size * 0.09));

  // Main diagonal from top-right to bottom-left
  const d1 = Math.abs(py - (h - px * (h / w)));
  // Upper short diagonal (top-left to mid)
  const d2 = Math.abs((py - h * 0.15) + (px - w * 0.15) * 0.6);
  const inUpper = (px < w * 0.55 && py < h * 0.55);
  // Lower vertical leg on right
  const inLeg = (px > w * 0.78 && py > h * 0.45 && Math.abs(px - w * 0.85) < stroke * 0.6);

  return d1 < stroke || (inUpper && d2 < stroke * 0.9) || inLeg;
}

function iconPixel(roundedCorner, maskable) {
  return (x, y, size) => {
    const cx = size / 2;
    const cy = size / 2;

    // Rounded corner mask (skip for maskable — fills full bleed)
    if (roundedCorner && !maskable) {
      const r = size * 0.22;
      const dx = Math.max(0, Math.abs(x - cx) - (cx - r));
      const dy = Math.max(0, Math.abs(y - cy) - (cy - r));
      if (dx * dx + dy * dy > r * r) return [0, 0, 0, 0];
    }

    // Background — radial-ish gradient from center
    const dxc = (x - cx) / cx;
    const dyc = (y - cy) / cy;
    const dist = Math.sqrt(dxc * dxc + dyc * dyc);
    const bgT = Math.min(1, dist * 0.5);
    const bg = [
      Math.round(BG[0] * (1 - bgT * 0.2)),
      Math.round(BG[1] * (1 - bgT * 0.2)),
      Math.round(BG[2] * (1 - bgT * 0.2)),
      255
    ];

    // Padding for the aleph (more padding when maskable so safe zone is respected)
    const padding = maskable ? size * 0.22 : size * 0.18;

    if (withinHebrewAleph(x, y, size, padding)) {
      // Gradient red→pink across X
      const t = (x - padding) / (size - padding * 2);
      return mix(RED, PINK, Math.max(0, Math.min(1, t)));
    }
    return bg;
  };
}

const outDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const variants = [
  { name: 'icon-192.png',           size: 192, rounded: true,  maskable: false },
  { name: 'icon-512.png',           size: 512, rounded: true,  maskable: false },
  { name: 'icon-maskable-192.png',  size: 192, rounded: false, maskable: true  },
  { name: 'icon-maskable-512.png',  size: 512, rounded: false, maskable: true  },
  { name: 'apple-touch-icon.png',   size: 180, rounded: false, maskable: false }
];

for (const v of variants) {
  const buf = makePng(v.size, iconPixel(v.rounded, v.maskable));
  fs.writeFileSync(path.join(outDir, v.name), buf);
  console.log('wrote', v.name, buf.length, 'bytes');
}
