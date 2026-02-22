import { Database } from 'bun:sqlite';
const db = new Database('local.db');

try {
	db.exec('ALTER TABLE dm_session ADD COLUMN notes TEXT');
	console.log('OK: dm_session.notes added');
} catch (e) {
	console.log('dm_session.notes:', e.message);
}

try {
	db.exec('ALTER TABLE dm_campaign ADD COLUMN current_game_day INTEGER NOT NULL DEFAULT 1');
	console.log('OK: dm_campaign.current_game_day added');
} catch (e) {
	console.log('dm_campaign.current_game_day:', e.message);
}

try {
	db.exec(`CREATE TABLE IF NOT EXISTS dm_location (
    id TEXT PRIMARY KEY NOT NULL,
    campaign_id TEXT NOT NULL REFERENCES dm_campaign(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    location_type TEXT NOT NULL DEFAULT 'other',
    description TEXT NOT NULL DEFAULT '',
    parent_location_id TEXT,
    linked_npc_ids TEXT NOT NULL DEFAULT '[]',
    linked_quest_ids TEXT NOT NULL DEFAULT '[]',
    tags TEXT NOT NULL DEFAULT '[]',
    notes TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
	console.log('OK: dm_location created');
} catch (e) {
	console.log('dm_location:', e.message);
}

try {
	db.exec(`CREATE TABLE IF NOT EXISTS dm_calendar_event (
    id TEXT PRIMARY KEY NOT NULL,
    campaign_id TEXT NOT NULL REFERENCES dm_campaign(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    game_day INTEGER NOT NULL,
    category TEXT NOT NULL DEFAULT 'note',
    created_at INTEGER NOT NULL
  )`);
	console.log('OK: dm_calendar_event created');
} catch (e) {
	console.log('dm_calendar_event:', e.message);
}

db.close();
console.log('Migration complete');
