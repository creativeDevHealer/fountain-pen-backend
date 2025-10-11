// Small utility to delete documents inserted "today" (by createdAt) from MongoDB
// Usage:
//   node scripts/deleteToday.js            -> deletes docs where createdAt is today (local time)
//   node scripts/deleteToday.js --dry      -> only prints how many would be deleted
//   node scripts/deleteToday.js --from=ebay -> limit deletion to a specific source in `from`

/* eslint-disable no-console */
const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/';
const DB_NAME = process.env.DB_NAME || 'products_db';
const COLLECTION_NAME = process.env.COLLECTION_NAME || 'products';

function getCliFlags() {
  const flags = {};
  process.argv.slice(2).forEach((arg) => {
    if (arg === '--dry' || arg === '--dry-run') flags.dry = true;
    else if (arg.startsWith('--from=')) flags.from = arg.split('=')[1];
    else if (arg === '--utc') flags.utc = true;
  });
  return flags;
}

function getTodayRange(useUtc) {
  const now = new Date();
  let start; let end;
  if (useUtc) {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
  } else {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  }
  return { start, end };
}

async function run() {
  const { dry, from, utc } = getCliFlags();
  const { start, end } = getTodayRange(utc);

  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);

    const filter = { createdAt: { $gte: start, $lte: end } };
    if (from) filter.from = from;

    const toDelete = await collection.countDocuments(filter);
    console.log(`[deleteToday] Matching documents: ${toDelete}`);
    console.log(`[deleteToday] Range ${start.toISOString()} -> ${end.toISOString()}${from ? `, from=${from}` : ''}`);

    if (toDelete === 0) {
      console.log('[deleteToday] Nothing to delete.');
      return;
    }
    if (dry) {
      console.log('[deleteToday] Dry-run enabled: no documents deleted.');
      return;
    }
    const res = await collection.deleteMany(filter);
    console.log(`[deleteToday] Deleted ${res.deletedCount} document(s).`);
  } catch (err) {
    console.error('[deleteToday] Error:', err);
    process.exitCode = 1;
  } finally {
    try { await client.close(); } catch (_) {}
  }
}

run();


