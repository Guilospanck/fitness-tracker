// Daily JSON backup → S3.
// Reads data.sqlite directly (works whether or not the server is running),
// dumps every table to the same JSON shape /api/export produces, uploads to S3.
require('dotenv').config();

const path = require('path');
const Database = require('better-sqlite3');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const DB_PATH = path.join(__dirname, 'data.sqlite');
const BUCKET = process.env.AWS_S3_BUCKET;
const REGION = process.env.AWS_REGION || 'eu-central-1';
const PREFIX = (process.env.AWS_S3_PREFIX || 'backups').replace(/\/+$/, '');

const TABLES = ['exercises', 'routines', 'routine_exercises', 'sessions', 'session_exercises'];

if (!BUCKET) {
  console.error('AWS_S3_BUCKET env var is required');
  process.exit(1);
}
if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  console.error('AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY env vars are required');
  process.exit(1);
}

function dumpAll() {
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  const tables = {};
  let count = 0;
  for (const t of TABLES) {
    tables[t] = db.prepare(`SELECT * FROM ${t}`).all();
    count += tables[t].length;
  }
  db.close();
  return { payload: { meta: { version: 1, takenAt: new Date().toISOString() }, tables }, count };
}

async function main() {
  const { payload, count } = dumpAll();
  const body = JSON.stringify(payload);
  const date = new Date().toISOString().split('T')[0];
  const key = `${PREFIX}/fitness-tracker-${date}.json`;

  const s3 = new S3Client({ region: REGION });
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: 'application/json',
  }));

  console.log(`[${new Date().toISOString()}] Backup uploaded: s3://${BUCKET}/${key} (${count} rows, ${body.length} bytes)`);
}

main().catch(err => {
  console.error(`[${new Date().toISOString()}] Backup failed:`, err);
  process.exit(1);
});
