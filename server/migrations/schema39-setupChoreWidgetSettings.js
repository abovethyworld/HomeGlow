const context = globalThis.__HOMEGLOW_SCHEMA_MIGRATION_CONTEXT;

if (!context || !context.db) {
    throw new Error('Schema migration context is missing for migration');
}

const { db, schemaIdKey, targetSchemaId } = context;

try {
    console.log(`=== Starting setup chore widget settings migration to version ${targetSchemaId} ===`);

    db.exec('BEGIN');
    try {
        // Device setups gain room for the chore widget's own settings
        // block (hidden members, bonus chores, sounds, week view),
        // which lives on the device outside widgetSettings. A setup
        // whose tabs carry the chores widget captures that block so
        // applying the setup reproduces the same chore view on any
        // display (a kid's setup shows only their own chores). NULL
        // means the setup predates the capture; applying one still
        // resets the block to the widget's defaults when the setup
        // carries the chores widget, so one profile's chore view
        // never leaks into the next profile's.
        const setupColumns = db.prepare('PRAGMA table_info(device_setups)').all().map((c) => c.name);
        if (!setupColumns.includes('chore_widget_settings_json')) {
            db.exec(`
                ALTER TABLE device_setups ADD COLUMN chore_widget_settings_json TEXT
            `);
        }

        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
            schemaIdKey,
            String(targetSchemaId)
        );

        db.exec('COMMIT');
        console.log(`=== Setup chore widget settings migration completed (version ${targetSchemaId}) ===`);
    } catch (migrationError) {
        db.exec('ROLLBACK');
        throw migrationError;
    }
} catch (error) {
    console.error('=== Setup chore widget settings migration failed ===');
    console.error(error);
    throw error;
}
