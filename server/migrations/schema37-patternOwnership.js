const context = globalThis.__HOMEGLOW_SCHEMA_MIGRATION_CONTEXT;

if (!context || !context.db) {
    throw new Error('Schema migration context is missing for migration');
}

const { db, schemaIdKey, targetSchemaId } = context;

try {
    console.log(`=== Starting pattern ownership schema migration to version ${targetSchemaId} ===`);

    db.exec('BEGIN');
    try {
        // A schedule's owner rule: 'fixed' (the schedule belongs to its
        // user_id, as before) or 'pattern' (the schedule belongs to whoever
        // owns that date under the household alternating pattern; see
        // utils/pattern.js). Existing rows are all fixed until a later
        // data migration flags them.
        const scheduleColumns = db.prepare('PRAGMA table_info(chore_schedules)').all().map((c) => c.name);
        if (!scheduleColumns.includes('owner_rule')) {
            db.exec(`ALTER TABLE chore_schedules ADD COLUMN owner_rule TEXT DEFAULT 'fixed'`);
        }

        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
            schemaIdKey,
            String(targetSchemaId)
        );

        db.exec('COMMIT');
        console.log(`=== Pattern ownership schema migration completed (version ${targetSchemaId}) ===`);
    } catch (migrationError) {
        db.exec('ROLLBACK');
        throw migrationError;
    }
} catch (error) {
    console.error('=== Pattern ownership schema migration failed ===');
    console.error('Error:', error);
    throw error;
}
