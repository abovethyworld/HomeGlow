// Named device setups (schema 38): a setup is a server-side snapshot of
// one device's tabs/widgets configuration that any device can apply.
// These tests pin the rules around them:
//   - saving requires a configured source device and upserts by name
//   - only one setup can be the default at a time
//   - a device with NO configuration is seeded on first read, from the
//     default setup when one exists, else from the earliest configured
//     device
//   - seeding is a one-time starting point: it never overwrites or
//     follows later changes on a configured device
//   - applying a setup is explicit and does replace the target's config

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { freePort } = require('./freePort');

const serverDir = path.resolve(__dirname, '..');
const tmpDir = path.resolve(__dirname, '.tmp');
const testDbPath = path.join(tmpDir, `device-setups-${process.pid}-${Date.now()}.db`);
const keepTestArtifacts = process.env.HOMEGLOW_TEST_KEEP_ARTIFACTS === '1';
let port;
let baseUrl;
let serverProcess;
let serverLogs = '';

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServerReady(timeoutMs = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const response = await fetch(`${baseUrl}/api/test`);
            if (response.ok) {
                return;
            }
        } catch {
            // Server is still starting.
        }
        await delay(250);
    }

    throw new Error(`Server did not become ready within ${timeoutMs}ms. Logs:\n${serverLogs}`);
}

async function api(pathname, options = {}) {
    const headers = { ...(options.headers || {}) };

    if (options.body !== undefined && !headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(`${baseUrl}${pathname}`, { ...options, headers });
    const text = await response.text();
    let body;
    try {
        body = text ? JSON.parse(text) : null;
    } catch {
        body = text;
    }

    return { status: response.status, body };
}

// The settings endpoint merges top-level keys only, so each PATCH sends
// the device's full accumulated widgetSettings, like the real client does.
const deviceWidgetNames = new Map();

async function configureDevice(deviceName, widgetNames) {
    const allNames = [...new Set([...(deviceWidgetNames.get(deviceName) || []), ...widgetNames])];
    deviceWidgetNames.set(deviceName, allNames);
    await api(`/api/devices/${deviceName}/settings`, {
        method: 'PATCH',
        body: JSON.stringify({
            widgetSettings: Object.fromEntries(allNames.map((name) => [name, { enabled: true }])),
        }),
    });
    for (const widgetName of widgetNames) {
        const { status } = await api(`/api/devices/${deviceName}/widget-assignments`, {
            method: 'POST',
            body: JSON.stringify({ widget_name: widgetName, tabNumber: 1 }),
        });
        assert.equal(status, 200, `assigning ${widgetName} to ${deviceName}`);
    }
}

async function assignmentNames(deviceName) {
    const { status, body } = await api(`/api/devices/${deviceName}/widget-assignments`);
    assert.equal(status, 200);
    return body.map((assignment) => assignment.widget_name).sort();
}

test.before(async () => {
    port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
    fs.mkdirSync(tmpDir, { recursive: true });

    serverProcess = spawn('node', ['index.js'], {
        cwd: serverDir,
        env: {
            ...process.env,
            PORT: String(port),
            DB_PATH: testDbPath,
            TZ: 'UTC',
            HOMEGLOW_DISABLE_BACKGROUND_JOBS: '1',
            HOMEGLOW_DISABLE_CALENDAR_SYNC: '1',
            HOMEGLOW_DISABLE_UPDATE_CHECK: '1',
            ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    serverProcess.stdout.on('data', (chunk) => { serverLogs += chunk.toString(); });
    serverProcess.stderr.on('data', (chunk) => { serverLogs += chunk.toString(); });

    await waitForServerReady();
});

test.after(async () => {
    if (serverProcess && !serverProcess.killed) {
        serverProcess.kill('SIGTERM');
        await new Promise((resolve) => {
            serverProcess.once('close', () => resolve());
            setTimeout(resolve, 5000);
        });
    }

    if (!keepTestArtifacts) {
        for (const suffix of ['', '-shm', '-wal', '-journal']) {
            const filePath = `${testDbPath}${suffix}`;
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }
    }
});

test('saving a setup requires a configured source device', async () => {
    const { status } = await api('/api/device-setups', {
        method: 'POST',
        body: JSON.stringify({ name: 'Nowhere', deviceName: 'never-configured' }),
    });
    assert.equal(status, 400);
});

test('setup names must contain a letter or digit', async () => {
    await configureDevice('board-main', ['chores']);
    const { status } = await api('/api/device-setups', {
        method: 'POST',
        body: JSON.stringify({ name: '   ', deviceName: 'board-main' }),
    });
    assert.equal(status, 400);
});

test('save, list, overwrite by name, and delete a setup', async () => {
    await configureDevice('board-main', ['calendar']);

    const created = await api('/api/device-setups', {
        method: 'POST',
        body: JSON.stringify({ name: 'Living Room', deviceName: 'board-main' }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.created, true);
    assert.equal(created.body.setup.widgetCount, 2);

    const overwritten = await api('/api/device-setups', {
        method: 'POST',
        body: JSON.stringify({ name: 'Living Room', deviceName: 'board-main' }),
    });
    assert.equal(overwritten.status, 200);
    assert.equal(overwritten.body.created, false);
    assert.equal(overwritten.body.setup.id, created.body.setup.id);

    const list = await api('/api/device-setups');
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.map((setup) => setup.name), ['Living Room']);

    const removed = await api(`/api/device-setups/${created.body.setup.id}`, { method: 'DELETE' });
    assert.equal(removed.status, 200);

    const missing = await api(`/api/device-setups/${created.body.setup.id}`, { method: 'DELETE' });
    assert.equal(missing.status, 404);
});

test('only one setup can be the default at a time', async () => {
    const first = await api('/api/device-setups', {
        method: 'POST',
        body: JSON.stringify({ name: 'First', deviceName: 'board-main' }),
    });
    const second = await api('/api/device-setups', {
        method: 'POST',
        body: JSON.stringify({ name: 'Second', deviceName: 'board-main' }),
    });

    await api(`/api/device-setups/${first.body.setup.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isDefault: true }),
    });
    const promoted = await api(`/api/device-setups/${second.body.setup.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isDefault: true }),
    });
    assert.equal(promoted.body.setup.isDefault, true);

    const list = await api('/api/device-setups');
    assert.deepEqual(list.body.filter((setup) => setup.isDefault).map((setup) => setup.name), ['Second']);
});

test('a new device is seeded from the default setup on first read', async () => {
    assert.deepEqual(await assignmentNames('fresh-one'), ['calendar', 'chores']);

    const { body } = await api('/api/devices/fresh-one/settings');
    assert.equal(body.widgetSettings.chores.enabled, true);
    assert.equal(body.widgetSettings.calendar.enabled, true);
});

test('seeding never overwrites or follows changes on a configured device', async () => {
    // Customize the seeded device, then change the source device: neither
    // re-reads nor source changes may alter the seeded device.
    await api('/api/devices/fresh-one/widget-assignments', {
        method: 'POST',
        body: JSON.stringify({ widget_name: 'weather', tabNumber: 1 }),
    });
    await api('/api/devices/board-main/widget-assignments/widget/calendar', { method: 'DELETE' });

    assert.deepEqual(await assignmentNames('fresh-one'), ['calendar', 'chores', 'weather']);
    assert.deepEqual(await assignmentNames('board-main'), ['chores']);
});

test('without a default setup, a new device copies the earliest configured device', async () => {
    const list = await api('/api/device-setups');
    for (const setup of list.body) {
        await api(`/api/device-setups/${setup.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ isDefault: false }),
        });
    }

    // board-main is the earliest configured device and now has chores only.
    assert.deepEqual(await assignmentNames('fresh-two'), ['chores']);
});

test('applying a setup explicitly replaces a configured device', async () => {
    const saved = await api('/api/device-setups', {
        method: 'POST',
        body: JSON.stringify({ name: 'Full Board', deviceName: 'fresh-one' }),
    });
    assert.equal(saved.status, 201);

    const applied = await api(`/api/devices/board-main/apply-setup/${saved.body.setup.id}`, { method: 'POST' });
    assert.equal(applied.status, 200);
    assert.deepEqual(await assignmentNames('board-main'), ['calendar', 'chores', 'weather']);

    const missing = await api('/api/devices/board-main/apply-setup/999999', { method: 'POST' });
    assert.equal(missing.status, 404);
});

test('a setup can link to one profile, and a profile links to at most one setup', async () => {
    const user = await api('/api/users', {
        method: 'POST',
        body: JSON.stringify({ username: 'Profile Pat' }),
    });
    const userId = user.body.id;
    assert.ok(Number.isInteger(userId) && userId > 0);

    const linked = await api('/api/device-setups', {
        method: 'POST',
        body: JSON.stringify({ name: 'Pat Board', deviceName: 'board-main', profileUserId: userId }),
    });
    assert.equal(linked.status, 201);
    assert.equal(linked.body.setup.profileUserId, userId);

    // Linking a second setup to the same profile moves the link.
    const other = await api('/api/device-setups', {
        method: 'POST',
        body: JSON.stringify({ name: 'Pat Board Two', deviceName: 'board-main' }),
    });
    const relinked = await api(`/api/device-setups/${other.body.setup.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ profileUserId: userId }),
    });
    assert.equal(relinked.body.setup.profileUserId, userId);

    const list = await api('/api/device-setups');
    const byName = Object.fromEntries(list.body.map((setup) => [setup.name, setup.profileUserId]));
    assert.equal(byName['Pat Board'], null);
    assert.equal(byName['Pat Board Two'], userId);

    // Unlinking with an explicit null clears it.
    const unlinked = await api(`/api/device-setups/${other.body.setup.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ profileUserId: null }),
    });
    assert.equal(unlinked.body.setup.profileUserId, null);

    // A profile id that is not a family profile is rejected.
    const invalid = await api(`/api/device-setups/${other.body.setup.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ profileUserId: 999999 }),
    });
    assert.equal(invalid.status, 400);
});

test('chore widget settings travel with a setup and never leak into the next one', async () => {
    // A kid's chart: chores only, the parents hidden, no bonus chores.
    await configureDevice('kid-source', ['chores']);
    await api('/api/devices/kid-source/settings', {
        method: 'PATCH',
        body: JSON.stringify({
            choreWidgetSettings: { hiddenUserIds: [11, 22], showBonusChores: false, soundEnabled: true, showWeek: false },
        }),
    });
    const kid = await api('/api/device-setups', {
        method: 'POST',
        body: JSON.stringify({ name: 'Kid Chart', deviceName: 'kid-source' }),
    });
    assert.equal(kid.status, 201);

    // A family screen currently showing everyone's chores.
    await configureDevice('target-screen', ['chores', 'calendar']);
    await api('/api/devices/target-screen/settings', {
        method: 'PATCH',
        body: JSON.stringify({
            choreWidgetSettings: { hiddenUserIds: [], showBonusChores: true, soundEnabled: true, showWeek: false },
        }),
    });

    const applied = await api(`/api/devices/target-screen/apply-setup/${kid.body.setup.id}`, { method: 'POST' });
    assert.equal(applied.status, 200);
    assert.deepEqual(await assignmentNames('target-screen'), ['chores']);
    const kidSettings = await api('/api/devices/target-screen/settings');
    assert.deepEqual(kidSettings.body.choreWidgetSettings.hiddenUserIds, [11, 22]);
    assert.equal(kidSettings.body.choreWidgetSettings.showBonusChores, false);

    // The next profile's setup restores its own chore view in full.
    await configureDevice('grown-source', ['chores']);
    await api('/api/devices/grown-source/settings', {
        method: 'PATCH',
        body: JSON.stringify({
            choreWidgetSettings: { hiddenUserIds: [], showBonusChores: true, soundEnabled: false, showWeek: true },
        }),
    });
    const grown = await api('/api/device-setups', {
        method: 'POST',
        body: JSON.stringify({ name: 'Grownups', deviceName: 'grown-source' }),
    });
    const restored = await api(`/api/devices/target-screen/apply-setup/${grown.body.setup.id}`, { method: 'POST' });
    assert.equal(restored.status, 200);
    const grownSettings = await api('/api/devices/target-screen/settings');
    assert.deepEqual(grownSettings.body.choreWidgetSettings.hiddenUserIds, []);
    assert.equal(grownSettings.body.choreWidgetSettings.soundEnabled, false);
    assert.equal(grownSettings.body.choreWidgetSettings.showWeek, true);
});

test('plugin settings travel with a setup so its plugin widgets render', async () => {
    // A plugin widget only renders on a display whose plugin settings
    // enable its file. A setup carrying one captures that enablement,
    // or the applied setup would leave the widget's slot dark.
    await configureDevice('plugin-source', ['chores', 'plugin:Scoreboard.html']);
    await api('/api/devices/plugin-source/settings', {
        method: 'PATCH',
        body: JSON.stringify({
            pluginSettings: {
                'Scoreboard.html': { enabled: true, transparent: true },
                'Other.html': { enabled: true },
            },
        }),
    });
    const saved = await api('/api/device-setups', {
        method: 'POST',
        body: JSON.stringify({ name: 'Plugin Screen', deviceName: 'plugin-source' }),
    });
    assert.equal(saved.status, 201);

    await configureDevice('plugin-target', ['calendar']);
    const applied = await api(`/api/devices/plugin-target/apply-setup/${saved.body.setup.id}`, { method: 'POST' });
    assert.equal(applied.status, 200);
    assert.deepEqual(await assignmentNames('plugin-target'), ['chores', 'plugin:Scoreboard.html']);
    const settings = await api('/api/devices/plugin-target/settings');
    // Only the plugin the setup carries travels; the unrelated
    // plugin's settings stay on the source device.
    assert.deepEqual(settings.body.pluginSettings, {
        'Scoreboard.html': { enabled: true, transparent: true },
    });
});
