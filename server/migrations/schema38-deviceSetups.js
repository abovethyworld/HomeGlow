const context = globalThis.__HOMEGLOW_SCHEMA_MIGRATION_CONTEXT;

if (!context || !context.db) {
    throw new Error('Schema migration context is missing for migration');
}

const { db, schemaIdKey, targetSchemaId } = context;

try {
    console.log(`=== Starting device setups migration to version ${targetSchemaId} ===`);

    db.exec('BEGIN');
    try {
        // Named setups: a saved copy of one device's tabs/widgets
        // configuration (tab rows plus the per-widget entries of its
        // widgetSettings), stored once on the server so any device can
        // apply it. One setup at a time may be flagged as the default;
        // a device with no configuration of its own is seeded from the
        // default setup on first read. Applying a setup is always an
        // explicit action and is the only way a setup overwrites a
        // configured device. A setup may also link to one family
        // profile (profile_user_id); picking that profile on a display
        // applies the linked setup there. At most one setup links to a
        // given profile, enforced where links are written.
        db.exec(`
            CREATE TABLE IF NOT EXISTS device_setups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                tabs_json TEXT NOT NULL DEFAULT '[]',
                widget_settings_json TEXT NOT NULL DEFAULT '{}',
                is_default INTEGER NOT NULL DEFAULT 0,
                profile_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);

        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
            schemaIdKey,
            String(targetSchemaId)
        );

        db.exec('COMMIT');
        console.log(`=== Device setups migration completed (version ${targetSchemaId}) ===`);
    } catch (migrationError) {
        db.exec('ROLLBACK');
        throw migrationError;
    }
} catch (error) {
    console.error('=== Device setups migration failed ===');
    console.error(error);
    throw error;
}
