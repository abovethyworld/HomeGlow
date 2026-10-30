'use strict';

// Wallpaper packages: the drop-a-zip importer and assignment.
//   POST   /api/wallpapers/import   one zip in, one finished package out
//   POST   /api/wallpapers/assign   { packageId, target } — target is a
//                                   user id, or "default" for the household
//   DELETE /api/wallpapers/:id      remove a package and its files
// The package index lives in the wallpaper-engine plugin's storage
// (that is the plugin's data); assignments for members are its
// profile:<userId> keys. "Default" writes the household appearance,
// the same fields the personalization settings write.

const fs = require('fs');
const path = require('path');
const { importWallpaperZip, ImportError } = require('../services/wallpaperImport');

const PLUGIN_ID = 'wallpaper-engine';
const MAX_IMPORT_BYTES = 512 * 1024 * 1024;

function resolveFfmpeg() {
  if (process.env.WALLPAPER_FFMPEG) return process.env.WALLPAPER_FFMPEG;
  const bundled = path.join(__dirname, '..', 'utils', 'bin', 'ffmpeg');
  try {
    fs.accessSync(bundled, fs.constants.X_OK);
    return bundled;
  } catch {
    return null;
  }
}

function registerWallpaperRoutes(fastify, { db, uploadsDir }) {
  const readPackages = () => {
    const row = db.prepare('SELECT value_json FROM plugin_storage WHERE plugin_id = ? AND key = ?')
      .get(PLUGIN_ID, 'packages');
    if (!row) return [];
    try {
      const parsed = JSON.parse(row.value_json);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const writeStorage = (key, value) => {
    db.prepare(`
      INSERT INTO plugin_storage (plugin_id, key, value_json) VALUES (?, ?, ?)
      ON CONFLICT(plugin_id, key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = CURRENT_TIMESTAMP
    `).run(PLUGIN_ID, key, JSON.stringify(value));
  };
  const backgroundAndColors = (pkg) => {
    let background = null;
    if (pkg.type === 'video' && pkg.video) background = { kind: 'video', src: pkg.video, poster: pkg.preview };
    else if (pkg.animated) background = { kind: 'scene', src: pkg.animated, ...(pkg.still ? { poster: pkg.still } : {}) };
    else if (pkg.still) background = { kind: 'scene', src: pkg.still };
    else if (pkg.preview) background = { kind: 'scene', src: pkg.preview };
    return {
      background,
      colors: pkg.palette?.light || null,
      colorsDark: pkg.palette?.dark || null,
    };
  };

  fastify.post('/api/wallpapers/import', async (request, reply) => {
    const data = await request.file({ limits: { fileSize: MAX_IMPORT_BYTES + 1 } }).catch(() => null);
    if (!data) return reply.code(400).send({ error: 'Expected one zip file.' });
    // Stream to a temp file: the zip can be 200MB and this container
    // has a 256MB memory cap, so it is never buffered whole.
    const tmpPath = path.join(require('os').tmpdir(), `wallpaper-import-${process.pid}-${Date.now()}.zip`);
    try {
      const { pipeline } = require('stream/promises');
      await pipeline(data.file, fs.createWriteStream(tmpPath));
      const { size } = await fs.promises.stat(tmpPath);
      if (size > MAX_IMPORT_BYTES) {
        return reply.code(413).send({ error: 'That zip is over 512MB.' });
      }
    } catch (error) {
      request.log.error(error, 'wallpaper upload failed');
      return reply.code(400).send({ error: 'That upload would not save.' });
    }
    let pkg;
    try {
      pkg = await importWallpaperZip(tmpPath, { uploadsDir, ffmpeg: resolveFfmpeg() });
    } catch (error) {
      if (error instanceof ImportError) return reply.code(422).send({ error: error.message, code: error.code });
      request.log.error(error, 'wallpaper import failed');
      return reply.code(500).send({ error: 'The import failed on the server.' });
    } finally {
      await fs.promises.rm(tmpPath, { force: true });
    }
    // A re-import of the same wallpaper keeps its assignment.
    const existing = readPackages().find((p) => String(p.id) === String(pkg.id));
    if (existing) {
      pkg.owner = existing.owner ?? null;
      pkg.ownerProfileId = existing.ownerProfileId ?? null;
    }
    const packages = readPackages().filter((p) => String(p.id) !== String(pkg.id));
    packages.push(pkg);
    writeStorage('packages', packages);
    return reply.send({ package: pkg, packages });
  });

  fastify.post('/api/wallpapers/assign', async (request, reply) => {
    const { packageId, target } = request.body || {};
    const packages = readPackages();
    const pkg = packages.find((p) => String(p.id) === String(packageId));
    if (!pkg) return reply.code(404).send({ error: 'No such wallpaper.' });
    const { background, colors, colorsDark } = backgroundAndColors(pkg);
    if (!background) return reply.code(422).send({ error: 'This wallpaper has no display file.' });

    if (target === 'default') {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('appearance');
      let appearance = {};
      try { appearance = row ? JSON.parse(row.value) : {}; } catch { appearance = {}; }
      appearance.background = background;
      if (colors) appearance.colors = colors;
      if (colorsDark) appearance.colorsDark = colorsDark;
      db.prepare(`
        INSERT INTO settings (key, value) VALUES ('appearance', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(JSON.stringify(appearance));
      return reply.send({ ok: true, packages });
    }

    const userId = Number(target);
    if (!Number.isInteger(userId) || userId <= 0) {
      return reply.code(400).send({ error: 'Target must be a user id or "default".' });
    }
    for (const p of packages) {
      if (Number(p.ownerProfileId) === userId && String(p.id) !== String(pkg.id)) {
        p.owner = null;
        p.ownerProfileId = null;
      }
    }
    const user = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
    pkg.owner = user ? user.username : pkg.owner;
    pkg.ownerProfileId = userId;
    writeStorage('packages', packages);
    writeStorage(`profile:${userId}`, String(pkg.id));
    return reply.send({ ok: true, packages });
  });

  fastify.delete('/api/wallpapers/:id', async (request, reply) => {
    const { id } = request.params;
    const packages = readPackages();
    const pkg = packages.find((p) => String(p.id) === String(id));
    if (!pkg) return reply.code(404).send({ error: 'No such wallpaper.' });
    writeStorage('packages', packages.filter((p) => String(p.id) !== String(id)));
    if (pkg.ownerProfileId != null) {
      db.prepare('DELETE FROM plugin_storage WHERE plugin_id = ? AND key = ?')
        .run(PLUGIN_ID, `profile:${pkg.ownerProfileId}`);
    }
    fs.rmSync(path.join(uploadsDir, 'wallpapers', String(id)), { recursive: true, force: true });
    return reply.send({ ok: true, packages: readPackages() });
  });
}

module.exports = { registerWallpaperRoutes };
