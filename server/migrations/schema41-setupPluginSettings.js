const context = globalThis.__HOMEGLOW_SCHEMA_MIGRATION_CONTEXT;

if (!context || !context.db) {
    throw new Error('Schema migration context is missing for migration');
}

const { db, schemaIdKey, targetSchemaId } = context;

try {
    console.log(`=== Starting setup plugin settings migration to version ${targetSchemaId} ===`);

    db.exec('BEGIN');
    try {
        // Device setups gain room for the device's plugin settings
        // (which installed plugins are enabled, per filename), the
        // same travel companion the chore widget's settings got in
        // schema 39. A plugin widget sits in a setup's tabs like any
        // widget, but it only renders on a display whose plugin
        // settings enable it, so a snapshot that carries a plugin
        // widget captures the enablement too. Without it, applying
        // the setup would show the widget's empty slot and never the
        // plugin. NULL means the setup predates the capture;
        // applying one still enables its plugin widgets, so a
        // setup saved before this migration keeps working.
        const setupColumns = db.prepare('PRAGMA table_info(device_setups)').all().map((c) => c.name);
        if (!setupColumns.includes('plugin_settings_json')) {
            db.exec(`
                ALTER TABLE device_setups ADD COLUMN plugin_settings_json TEXT
            `);
        }

        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
            schemaIdKey,
            String(targetSchemaId)
        );

        db.exec('COMMIT');
        console.log(`=== Setup plugin settings migration completed (version ${targetSchemaId}) ===`);
    } catch (migrationError) {
        db.exec('ROLLBACK');
        throw migrationError;
    }
} catch (error) {
    console.error('=== Setup plugin settings migration failed ===');
    console.error(error);
    throw error;
}
