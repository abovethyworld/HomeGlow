'use strict';

// Wallpaper Engine package import: turn a dropped workshop zip into a
// board-ready package. The rules this file exists to keep (Oct 2026):
//   - the 160x160 preview is NEVER a background, only a picker thumbnail;
//   - a display asset must be at least 1280px wide or the import is
//     flagged instead of attached;
//   - one drop does everything: unpack, classify, extract the real art,
//     derive the palette, hand back a finished package.
// No new dependencies: zips open with zlib, scene.pkg is a simple
// table format, image payloads inside .tex files are plain JPEG/PNG
// streams, and palettes sample the preview GIF with the decoder below.
// Video work shells out to ffmpeg (a static build rides along in
// utils/bin on the deployed server; WALLPAPER_FFMPEG overrides).

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFile } = require('child_process');

const MIN_DISPLAY_WIDTH = 1280;
const MAX_ZIP_BYTES = 512 * 1024 * 1024;

class ImportError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// ---------------------------------------------------------------- zips
// File-based on purpose: the backend container lives in a 256MB memory
// cgroup, and a workshop zip can be 200MB. Only the directory and the
// small entries are ever buffered; big entries stream to disk.

async function openZip(filePath) {
  const handle = await fs.promises.open(filePath, 'r');
  const { size } = await handle.stat();
  if (size < 22) {
    await handle.close();
    throw new ImportError('BAD_ZIP', 'That file is not a zip.');
  }
  const tailLength = Math.min(size, 22 + 65536);
  const tail = Buffer.alloc(tailLength);
  await handle.read(tail, 0, tailLength, size - tailLength);
  let eocd = -1;
  for (let i = tailLength - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) {
    await handle.close();
    throw new ImportError('BAD_ZIP', 'That file is not a zip.');
  }
  const count = tail.readUInt16LE(eocd + 10);
  const directoryOffset = tail.readUInt32LE(eocd + 16);
  const directoryLength = (size - tailLength + eocd) - directoryOffset;
  const directory = Buffer.alloc(directoryLength);
  await handle.read(directory, 0, directoryLength, directoryOffset);
  const entries = new Map();
  let pos = 0;
  for (let n = 0; n < count; n++) {
    if (pos + 46 > directory.length || directory.readUInt32LE(pos) !== 0x02014b50) break;
    const method = directory.readUInt16LE(pos + 10);
    const compSize = directory.readUInt32LE(pos + 20);
    const size = directory.readUInt32LE(pos + 24);
    const nameLen = directory.readUInt16LE(pos + 28);
    const extraLen = directory.readUInt16LE(pos + 30);
    const commentLen = directory.readUInt16LE(pos + 32);
    const localOffset = directory.readUInt32LE(pos + 42);
    const name = directory.subarray(pos + 46, pos + 46 + nameLen).toString('utf8');
    pos += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    const localHeader = Buffer.alloc(30);
    await handle.read(localHeader, 0, 30, localOffset);
    const dataOffset = localOffset + 30 + localHeader.readUInt16LE(26) + localHeader.readUInt16LE(28);
    entries.set(name, { method, compSize, size, dataOffset });
  }
  if (entries.size === 0) {
    await handle.close();
    throw new ImportError('BAD_ZIP', 'That zip is empty.');
  }
  const readRaw = async (entry) => {
    const raw = Buffer.alloc(entry.compSize);
    await handle.read(raw, 0, entry.compSize, entry.dataOffset);
    return raw;
  };
  return {
    names: () => [...entries.keys()],
    has: (name) => entries.has(name),
    get: (name) => entries.get(name),
    async readEntry(name) {
      const entry = entries.get(name);
      if (!entry) return null;
      const raw = await readRaw(entry);
      try {
        if (entry.method === 0) return raw;
        if (entry.method === 8) return zlib.inflateRawSync(raw);
      } catch { /* fall through */ }
      throw new ImportError('BAD_ZIP', `Could not unpack ${name} from the zip.`);
    },
    async extractEntryToFile(name, destPath) {
      const entry = entries.get(name);
      if (!entry) throw new ImportError('BAD_ZIP', `${name} is not in the zip.`);
      const source = fs.createReadStream(filePath, { start: entry.dataOffset, end: entry.dataOffset + entry.compSize - 1 });
      const sink = fs.createWriteStream(destPath);
      const { pipeline } = require('stream/promises');
      try {
        if (entry.method === 0) await pipeline(source, sink);
        else if (entry.method === 8) await pipeline(source, zlib.createInflateRaw(), sink);
        else throw new Error(`zip method ${entry.method}`);
      } catch (error) {
        if (error instanceof ImportError) throw error;
        throw new ImportError('BAD_ZIP', `Could not unpack ${name} from the zip.`);
      }
      // A short write means the upload itself arrived incomplete;
      // never let a truncated file pass as the real thing.
      const { size: written } = await fs.promises.stat(destPath);
      if (entry.size && written !== entry.size) {
        await fs.promises.rm(destPath, { force: true });
        throw new ImportError('TRUNCATED', `${name} arrived incomplete (${written} of ${entry.size} bytes). Try the upload again.`);
      }
    },
    close: () => handle.close(),
  };
}

// Buffer convenience wrapper (tests, small zips).
async function readZip(buffer) {
  const tmp = path.join(require('os').tmpdir(), `zip-read-${process.pid}-${Date.now()}.zip`);
  await fs.promises.writeFile(tmp, buffer);
  try {
    const zip = await openZip(tmp);
    const files = new Map();
    for (const name of zip.names()) files.set(name, await zip.readEntry(name));
    await zip.close();
    return files;
  } finally {
    await fs.promises.rm(tmp, { force: true });
  }
}

// ------------------------------------------------------- scene.pkg

function readPkg(buffer) {
  let pos = 0;
  const readInt = () => { const v = buffer.readInt32LE(pos); pos += 4; return v; };
  const versionLen = readInt();
  const version = buffer.subarray(pos, pos + versionLen).toString('ascii');
  pos += versionLen;
  if (!version.startsWith('PKGV')) throw new ImportError('BAD_PKG', 'scene.pkg has an unknown format.');
  const count = readInt();
  const entries = [];
  for (let i = 0; i < count; i++) {
    const nameLen = readInt();
    const name = buffer.subarray(pos, pos + nameLen).toString('utf8');
    pos += nameLen;
    const offset = readInt();
    const length = readInt();
    entries.push({ name, offset, length });
  }
  const base = pos;
  const files = new Map();
  for (const entry of entries) {
    files.set(entry.name, buffer.subarray(base + entry.offset, base + entry.offset + entry.length));
  }
  return files;
}

// ------------------------------------------------- images in .tex

function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let pos = 2;
  while (pos + 9 < buf.length) {
    if (buf[pos] !== 0xff) return null;
    const marker = buf[pos + 1];
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return { width: buf.readUInt16BE(pos + 7), height: buf.readUInt16BE(pos + 5) };
    }
    const len = buf.readUInt16BE(pos + 2);
    if (len < 2) return null;
    pos += 2 + len;
  }
  return null;
}

// Find the biggest complete JPEG or PNG stream inside a .tex and return
// it with its dimensions. The .tex container wraps plain image data.
function carveImage(tex) {
  const candidates = [];
  for (let i = 0; i + 1 < tex.length; i++) {
    if (tex[i] === 0xff && tex[i + 1] === 0xd8 && tex[i + 2] === 0xff) {
      const end = tex.indexOf(Buffer.from([0xff, 0xd9]), i);
      if (end > i) candidates.push({ kind: 'jpg', buf: tex.subarray(i, end + 2) });
    }
    if (tex[i] === 0x89 && tex[i + 1] === 0x50 && tex[i + 2] === 0x4e && tex[i + 3] === 0x47) {
      const endMark = tex.indexOf(Buffer.from('IEND\xaeB\x60\x82', 'binary'), i);
      if (endMark > i) candidates.push({ kind: 'png', buf: tex.subarray(i, endMark + 8) });
    }
    if (candidates.length > 4) break;
  }
  let best = null;
  for (const candidate of candidates) {
    const size = candidate.kind === 'jpg' ? jpegSize(candidate.buf) : pngSize(candidate.buf);
    if (!size) continue;
    if (!best || size.width * size.height > best.width * best.height) {
      best = { ...candidate, ...size };
    }
  }
  return best;
}

// ------------------------------------------------------- GIF decode
// Just enough GIF89a to sample frames for a palette: LZW decompression
// with each frame composited over the running canvas. Preview GIFs are
// full-frame sequences, and several start from black or transparent,
// so callers sample a middle frame rather than the first.

function decodeGifFrames(buf, maxFrames = 60) {
  let pos = 6; // signature
  const screenW = buf.readUInt16LE(pos);
  const screenH = buf.readUInt16LE(pos + 2);
  const packed = buf[pos + 4];
  pos += 7;
  let gct = null;
  if (packed & 0x80) {
    const size = 3 * (1 << ((packed & 0x07) + 1));
    gct = buf.subarray(pos, pos + size);
    pos += size;
  }
  const canvas = new Uint8Array(screenW * screenH * 4);
  const frames = [];
  let transparentIndex = -1;
  while (pos < buf.length && frames.length < maxFrames) {
    const tag = buf[pos];
    if (tag === 0x21) { // extension
      const label = buf[pos + 1];
      if (label === 0xf9) {
        const blockSize = buf[pos + 2];
        const fields = buf[pos + 3];
        transparentIndex = (fields & 0x01) ? buf[pos + 5] : -1;
        pos += 3 + blockSize + 1;
      } else {
        pos += 2;
        while (pos < buf.length && buf[pos] !== 0) pos += buf[pos] + 1;
        pos += 1;
      }
    } else if (tag === 0x2c) { // image descriptor
      const left = buf.readUInt16LE(pos + 1);
      const top = buf.readUInt16LE(pos + 3);
      const w = buf.readUInt16LE(pos + 5);
      const h = buf.readUInt16LE(pos + 7);
      const imagePacked = buf[pos + 9];
      pos += 10;
      let palette = gct;
      if (imagePacked & 0x80) {
        const size = 3 * (1 << ((imagePacked & 0x07) + 1));
        palette = buf.subarray(pos, pos + size);
        pos += size;
      }
      const minCodeSize = buf[pos];
      pos += 1;
      const compressed = [];
      while (pos < buf.length && buf[pos] !== 0) {
        compressed.push(buf.subarray(pos + 1, pos + 1 + buf[pos]));
        pos += buf[pos] + 1;
      }
      pos += 1; // the zero byte that ends the data sub-blocks
      const indices = lzwDecode(Buffer.concat(compressed), minCodeSize, w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const index = indices[y * w + x];
          if (index === transparentIndex || index === undefined) continue;
          const target = ((top + y) * screenW + (left + x)) * 4;
          canvas[target] = palette[index * 3];
          canvas[target + 1] = palette[index * 3 + 1];
          canvas[target + 2] = palette[index * 3 + 2];
          canvas[target + 3] = 255;
        }
      }
      frames.push({ width: screenW, height: screenH, rgba: new Uint8Array(canvas) });
      transparentIndex = -1;
    } else {
      break;
    }
  }
  if (frames.length === 0) throw new ImportError('BAD_PREVIEW', 'The preview would not decode.');
  return frames;
}

function decodeGifFirstFrame(buf) {
  return decodeGifFrames(buf, 1)[0];
}

function lzwDecode(data, minCodeSize, expected) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let dictionary = [];
  const resetDictionary = () => {
    dictionary = [];
    for (let i = 0; i < clear; i++) dictionary.push([i]);
    dictionary.push(null); // clear
    dictionary.push(null); // eoi
  };
  resetDictionary();
  const out = [];
  let bitPos = 0;
  const readCode = () => {
    let code = 0;
    for (let b = 0; b < codeSize; b++) {
      const byteIndex = (bitPos + b) >> 3;
      if (byteIndex >= data.length) return -1;
      code |= ((data[byteIndex] >> ((bitPos + b) & 7)) & 1) << b;
    }
    bitPos += codeSize;
    return code;
  };
  let previous = null;
  while (out.length < expected) {
    const code = readCode();
    if (code === -1 || code === eoi) break;
    if (code === clear) {
      resetDictionary();
      codeSize = minCodeSize + 1;
      previous = null;
      continue;
    }
    let entry;
    if (dictionary[code]) entry = dictionary[code];
    else if (code === dictionary.length && previous) entry = [...previous, previous[0]];
    else break;
    for (const value of entry) out.push(value);
    if (previous) {
      dictionary.push([...previous, entry[0]]);
      if (dictionary.length === (1 << codeSize) && codeSize < 12) codeSize++;
    }
    previous = entry;
  }
  return out;
}

// --------------------------------------------------------- palette
// The same derivation the board has always used (palette.py): average,
// soft, deep, the scheme color as accent, a vivid secondary, and the
// light/dark interface color sets built from them.

const clamp255 = (n) => Math.max(0, Math.min(255, Math.round(n)));
const hexOf = (rgb) => `#${rgb.map((c) => clamp255(c).toString(16).padStart(2, '0')).join('')}`;
const mix = (rgb, target, t) => rgb.map((a, i) => a + (target[i] - a) * t);
const luminance = (rgb) => (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
const saturation = (rgb) => {
  const [r, g, b] = rgb.map((c) => c / 255);
  const mx = Math.max(r, g, b);
  return mx === 0 ? 0 : (mx - Math.min(r, g, b)) / mx;
};
const hueOf = (rgb) => {
  const [r, g, b] = rgb.map((c) => c / 255);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  if (mx === mn) return 0;
  const d = mx - mn;
  let h;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h /= 6;
  return h < 0 ? h + 1 : h;
};
const hueDistance = (a, b) => {
  const d = Math.abs(hueOf(a) - hueOf(b));
  return Math.min(d, 1 - d);
};

function paletteFromPixels(rgba, schemeColor) {
  const samples = [];
  const step = 4 * Math.max(1, Math.floor(rgba.length / 4 / 4096));
  for (let i = 0; i + 3 < rgba.length; i += step) {
    if (rgba[i + 3] === 0) continue;
    samples.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
  }
  if (samples.length === 0) throw new ImportError('BAD_PREVIEW', 'The preview had no visible pixels.');
  const avg = [0, 1, 2].map((ch) => samples.reduce((sum, px) => sum + px[ch], 0) / samples.length);

  const buckets = new Map();
  for (const px of samples) {
    const key = px.map((c) => c >> 5).join(',');
    const bucket = buckets.get(key) || { count: 0, rgb: [0, 0, 0] };
    bucket.count++;
    bucket.rgb = bucket.rgb.map((v, ch) => v + px[ch]);
    buckets.set(key, bucket);
  }
  const dominants = [...buckets.values()]
    .map((b) => ({ coverage: b.count / samples.length, rgb: b.rgb.map((v) => v / b.count) }))
    .sort((a, b) => b.coverage - a.coverage)
    .slice(0, 10);

  let scheme = null;
  if (typeof schemeColor === 'string') {
    const parts = schemeColor.trim().split(/\s+/).map(Number);
    if (parts.length === 3 && parts.every(Number.isFinite)) scheme = parts.map((n) => n * 255);
  }
  const vivid = [...dominants].sort(
    (a, b) => saturation(b.rgb) * Math.sqrt(b.coverage) - saturation(a.rgb) * Math.sqrt(a.coverage),
  );
  const accent = scheme || vivid[0].rgb;
  let secondary = null;
  for (const d of vivid) {
    if (saturation(d.rgb) < 0.25) continue;
    if (hueDistance(d.rgb, accent) > 0.08) { secondary = d.rgb; break; }
  }
  if (!secondary && vivid.length > 1) secondary = vivid[1].rgb;
  const secondaryRgb = secondary || accent;

  const soft = mix(avg, [255, 255, 255], 0.82);
  const deep = mix(avg, [0, 0, 0], 0.45);
  const readableOnLight = (rgb) => (luminance(rgb) > 0.72 ? mix(rgb, [0, 0, 0], 0.38) : rgb);
  const readableOnDark = (rgb) => (luminance(rgb) < 0.3 ? mix(rgb, [255, 255, 255], 0.42) : rgb);
  const lightAccent = saturation(secondaryRgb) > saturation(accent) ? secondaryRgb : accent;
  const lightSecondary = lightAccent === accent ? secondaryRgb : accent;
  const darkAccentBase = luminance(accent) < 0.15 ? secondaryRgb : accent;

  return {
    average: hexOf(avg),
    soft: hexOf(soft),
    deep: hexOf(deep),
    accent: hexOf(accent),
    secondary: secondary ? hexOf(secondary) : null,
    light: {
      primary: hexOf(soft),
      secondary: hexOf(readableOnLight(lightSecondary)),
      accent: hexOf(readableOnLight(lightAccent)),
    },
    dark: {
      primary: hexOf(deep),
      secondary: hexOf(soft),
      accent: hexOf(readableOnDark(darkAccentBase)),
    },
  };
}

// ---------------------------------------------------------- ffmpeg

function exec(file, args, timeoutMs = 10 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const how = error.signal ? `killed by ${error.signal}` : `exit ${error.code}`;
        reject(new Error(`${file} failed (${how}): ${String(stderr).slice(-400)}`));
      } else resolve({ stdout, stderr });
    });
  });
}

async function probeVideo(ffmpeg, file) {
  // ffmpeg -i with no output exits non-zero on purpose; its stderr IS
  // the probe result.
  const stderr = await new Promise((resolve) => {
    execFile(ffmpeg, ['-i', file], { timeout: 30000 }, (error, stdout, err) => {
      resolve(String(err || error?.message || ''));
    });
  });
  const dim = /(\d{2,5})x(\d{2,5})/.exec(stderr);
  if (!dim) throw new ImportError('BAD_VIDEO', 'The video in this package would not read.');
  const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(stderr);
  return {
    width: Number(dim[1]),
    height: Number(dim[2]),
    seconds: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0,
  };
}

// ---------------------------------------------------------- import

function slugify(text) {
  return String(text || 'wallpaper').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'wallpaper';
}

async function importWallpaperZip(zipPath, { uploadsDir, ffmpeg }) {
  const zip = await openZip(zipPath);
  try {
    return await importFromOpenZip(zip, { uploadsDir, ffmpeg });
  } catch (error) {
    // A failed import leaves no staging folders behind.
    try {
      const wallpapersDir = path.join(uploadsDir, 'wallpapers');
      for (const name of fs.readdirSync(wallpapersDir)) {
        if (name.startsWith('.import-')) {
          fs.rmSync(path.join(wallpapersDir, name), { recursive: true, force: true });
        }
      }
    } catch { /* staging cleanup is best-effort */ }
    throw error;
  } finally {
    await zip.close();
  }
}

async function importFromOpenZip(zip, { uploadsDir, ffmpeg }) {
  const findName = (suffix) => zip.names().find((name) => name.toLowerCase().endsWith(suffix)) || null;
  const projectName = findName('project.json');
  if (!projectName) throw new ImportError('NO_PROJECT', 'No project.json in that zip. Is it a Wallpaper Engine folder?');
  let project;
  try {
    project = JSON.parse((await zip.readEntry(projectName)).toString('utf8').replace(/^﻿/, ''));
  } catch {
    throw new ImportError('NO_PROJECT', 'The project.json in that zip would not parse.');
  }
  const type = String(project.type || '').toLowerCase();
  if (type !== 'video' && type !== 'scene') {
    throw new ImportError('UNSUPPORTED_TYPE', `This importer takes video and scene wallpapers; this one is "${project.type || 'unknown'}".`);
  }
  const title = project.title || 'Untitled wallpaper';
  // The package id: project.json's workshop id when it carries one,
  // else the numeric workshop folder the zip was packed from (raw
  // folder copies often lack the field). Video URLs require a numeric
  // folder, so a video with neither gets a timestamp id; a scene may
  // fall back to its folder slug.
  const parentFolder = projectName.split('/').slice(0, -1).pop() || '';
  let folder = null;
  if (/^\d+$/.test(String(project.workshopid || ''))) folder = String(project.workshopid);
  else if (/^\d+$/.test(parentFolder)) folder = parentFolder;
  else if (type === 'scene' && parentFolder) folder = slugify(parentFolder);
  else folder = `${Date.now()}`;
  // Build in a staging folder and swap into place only on success, so
  // a failed import never disturbs the copy already on the board.
  const finalDir = path.join(uploadsDir, 'wallpapers', folder);
  const dir = path.join(uploadsDir, 'wallpapers', `.import-${folder}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  const urlFor = (file) => `/Uploads/wallpapers/${folder}/${file}`;

  const previewName = findName('preview.gif');
  const previewData = previewName ? await zip.readEntry(previewName) : null;
  const schemeColor = project.general?.properties?.schemecolor?.value || null;

  const pkg = {
    id: folder,
    title,
    type,
    owner: null,
    ownerProfileId: null,
    schemeColor,
  };

  if (previewData) {
    fs.writeFileSync(path.join(dir, 'preview.gif'), previewData);
    pkg.preview = urlFor('preview.gif');
  }

  if (type === 'video') {
    const videoName = String(project.file || '');
    const videoEntryName = (videoName && findName(videoName.toLowerCase())) || findName('.mp4');
    if (!videoEntryName) throw new ImportError('NO_VIDEO', 'The video file named in project.json is not in the zip.');
    const rawPath = path.join(dir, 'video-src.mp4');
    await zip.extractEntryToFile(videoEntryName, rawPath);
    if (!ffmpeg) throw new ImportError('NO_FFMPEG', 'Video imports need ffmpeg on the server, which is not set up yet.');
    const info = await probeVideo(ffmpeg, rawPath);
    if (info.width && info.width < MIN_DISPLAY_WIDTH) {
      fs.rmSync(rawPath, { force: true });
      throw new ImportError('TOO_SMALL', `This video is only ${info.width}px wide. Backgrounds need at least ${MIN_DISPLAY_WIDTH}px, so it was not attached.`);
    }
    const outPath = path.join(dir, 'video.mp4');
    // Oversized videos attach as-is and shrink later, off the request
    // path: a 4K encode does not fit in this container's 256MB memory
    // cgroup (proven twice by the OOM killer). A host-side watcher
    // picks up the queue file written below and swaps in the 1080p
    // version at the same URL.
    fs.renameSync(rawPath, outPath);
    if (info.width > 1920) {
      pkg.needsShrink = true;
      const queueDir = path.join(uploadsDir, 'wallpapers', '.shrink-queue');
      fs.mkdirSync(queueDir, { recursive: true });
      fs.writeFileSync(
        path.join(queueDir, `${folder}.json`),
        JSON.stringify({ folder, file: 'video.mp4', queuedAt: new Date().toISOString() }),
      );
    }
    pkg.video = urlFor('video.mp4');
    if (!pkg.preview) {
      await exec(ffmpeg, ['-y', '-v', 'error', '-ss', '2', '-i', outPath, '-frames:v', '1', path.join(dir, 'preview.jpg')], 60000);
      pkg.preview = urlFor('preview.jpg');
    }
  } else {
    const pkgName = findName('scene.pkg');
    if (!pkgName) throw new ImportError('NO_PKG', 'No scene.pkg in that zip.');
    const pkgFiles = readPkg(await zip.readEntry(pkgName));
    let best = null;
    for (const [name, data] of pkgFiles) {
      if (!name.toLowerCase().endsWith('.tex')) continue;
      const carved = carveImage(data);
      if (carved && (!best || carved.width * carved.height > best.width * best.height)) best = carved;
    }
    if (!best) throw new ImportError('NO_DISPLAY_ART', 'No usable art was found inside this scene.');
    if (best.width < MIN_DISPLAY_WIDTH) {
      throw new ImportError('TOO_SMALL', `This scene's biggest art is only ${best.width}px wide. Backgrounds need at least ${MIN_DISPLAY_WIDTH}px, so it was not attached.`);
    }
    const rawStill = path.join(dir, `still-src.${best.kind}`);
    fs.writeFileSync(rawStill, best.buf);
    if (ffmpeg) {
      const stillPath = path.join(dir, 'still.jpg');
      const scale = best.width > 1920 ? ['-vf', 'scale=1920:-2'] : [];
      await exec(ffmpeg, ['-y', '-v', 'error', '-i', rawStill, ...scale, '-q:v', '3', stillPath], 120000);
      fs.rmSync(rawStill, { force: true });
      pkg.still = urlFor('still.jpg');
    } else {
      const stillName = `still.${best.kind}`;
      fs.renameSync(rawStill, path.join(dir, stillName));
      pkg.still = urlFor(stillName);
    }
  }

  // Palette from the preview's own pixels; a video with no preview
  // falls back to its poster frame, sampled by ffmpeg.
  let palette = null;
  if (previewData) {
    try {
      const frames = decodeGifFrames(previewData);
      const frame = frames[Math.floor(frames.length / 2)];
      palette = paletteFromPixels(frame.rgba, schemeColor);
    } catch { palette = null; }
  }
  if (!palette && ffmpeg && pkg.video) {
    const samplePath = path.join(dir, 'palette-sample.raw');
    await exec(ffmpeg, ['-y', '-v', 'error', '-ss', '2', '-i', path.join(dir, 'video.mp4'), '-vf', 'scale=64:64', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', samplePath], 60000);
    const raw = fs.readFileSync(samplePath);
    fs.rmSync(samplePath, { force: true });
    palette = paletteFromPixels(new Uint8Array(raw), schemeColor);
  }
  if (!palette && ffmpeg && pkg.still) {
    const samplePath = path.join(dir, 'palette-sample.raw');
    await exec(ffmpeg, ['-y', '-v', 'error', '-i', path.join(dir, path.basename(pkg.still)), '-vf', 'scale=64:64', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', samplePath], 60000);
    const raw = fs.readFileSync(samplePath);
    fs.rmSync(samplePath, { force: true });
    palette = paletteFromPixels(new Uint8Array(raw), schemeColor);
  }
  if (!palette) throw new ImportError('NO_PALETTE', 'Could not read colors from this wallpaper.');
  pkg.palette = palette;

  fs.rmSync(finalDir, { recursive: true, force: true });
  fs.renameSync(dir, finalDir);

  return pkg;
}

module.exports = {
  ImportError,
  MIN_DISPLAY_WIDTH,
  openZip,
  readZip,
  readPkg,
  carveImage,
  decodeGifFirstFrame,
  decodeGifFrames,
  paletteFromPixels,
  importWallpaperZip,
};
