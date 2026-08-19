const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;
const DB_PATH = path.join(__dirname, 'data.sqlite');

// ===== Database =====
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
// Foreign keys off — history rows snapshot names/types, so definition rows
// (exercises, routines) can be edited or deleted without breaking past sessions.

db.exec(`
  CREATE TABLE IF NOT EXISTS exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    measurement_type TEXT NOT NULL DEFAULT 'weight_reps',
    body_part TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS routines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS routine_exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    routine_id INTEGER NOT NULL,
    exercise_id INTEGER NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    superset_group INTEGER,
    annotation TEXT NOT NULL DEFAULT '',
    target_sets TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    routine_id INTEGER,
    routine_name TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS session_exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    exercise_id INTEGER NOT NULL,
    exercise_name TEXT NOT NULL DEFAULT '',
    measurement_type TEXT NOT NULL DEFAULT 'weight_reps',
    position INTEGER NOT NULL DEFAULT 0,
    superset_group INTEGER,
    annotation TEXT NOT NULL DEFAULT '',
    actual_sets TEXT NOT NULL DEFAULT '[]'
  );

  CREATE INDEX IF NOT EXISTS idx_re_routine ON routine_exercises(routine_id);
  CREATE INDEX IF NOT EXISTS idx_se_session ON session_exercises(session_id);
  CREATE INDEX IF NOT EXISTS idx_se_exercise ON session_exercises(exercise_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
`);

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'app')));

// ===== Helpers =====
const json = (v) => JSON.stringify(v ?? []);
const parse = (s) => {
  try { return JSON.parse(s || '[]'); } catch { return []; }
};
const asInt = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

function wrap(handler) {
  return (req, res) => {
    try { handler(req, res); }
    catch (err) {
      console.error(err);
      res.status(500).json({ error: String(err.message || err) });
    }
  };
}

// ===== Exercises =====
app.get('/api/exercises', wrap((req, res) => {
  res.json(db.prepare('SELECT * FROM exercises ORDER BY name').all());
}));

app.post('/api/exercises', wrap((req, res) => {
  const { name, measurement_type = 'weight_reps', body_part = '', notes = '' } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const info = db.prepare(
    'INSERT INTO exercises (name, measurement_type, body_part, notes) VALUES (?, ?, ?, ?)'
  ).run(name, measurement_type, body_part, notes);
  res.json({ id: info.lastInsertRowid });
}));

app.put('/api/exercises/:id', wrap((req, res) => {
  const { name, measurement_type = 'weight_reps', body_part = '', notes = '' } = req.body || {};
  db.prepare(
    'UPDATE exercises SET name = ?, measurement_type = ?, body_part = ?, notes = ? WHERE id = ?'
  ).run(name, measurement_type, body_part, notes, req.params.id);
  res.json({ ok: true });
}));

app.delete('/api/exercises/:id', wrap((req, res) => {
  db.prepare('DELETE FROM exercises WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

// ===== Routines =====
function loadRoutine(row) {
  if (!row) return null;
  const exercises = db.prepare(`
    SELECT re.*, e.name AS exercise_name, e.measurement_type
    FROM routine_exercises re
    LEFT JOIN exercises e ON e.id = re.exercise_id
    WHERE re.routine_id = ?
    ORDER BY re.position, re.id
  `).all(row.id).map(r => ({ ...r, target_sets: parse(r.target_sets) }));
  return { ...row, exercises };
}

app.get('/api/routines', wrap((req, res) => {
  const rows = db.prepare('SELECT * FROM routines ORDER BY position, id').all();
  res.json(rows.map(loadRoutine));
}));

app.get('/api/routines/:id', wrap((req, res) => {
  const row = db.prepare('SELECT * FROM routines WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(loadRoutine(row));
}));

const writeRoutineExercises = db.transaction((routineId, exercises) => {
  db.prepare('DELETE FROM routine_exercises WHERE routine_id = ?').run(routineId);
  const insert = db.prepare(`
    INSERT INTO routine_exercises
      (routine_id, exercise_id, position, superset_group, annotation, target_sets)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  (exercises || []).forEach((ex, i) => {
    insert.run(
      routineId,
      ex.exercise_id,
      ex.position ?? i,
      asInt(ex.superset_group),
      ex.annotation || '',
      json(ex.target_sets)
    );
  });
});

app.post('/api/routines', wrap((req, res) => {
  const { name, notes = '', position = 0, exercises = [] } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const info = db.prepare(
    'INSERT INTO routines (name, notes, position) VALUES (?, ?, ?)'
  ).run(name, notes, position);
  writeRoutineExercises(info.lastInsertRowid, exercises);
  res.json({ id: info.lastInsertRowid });
}));

app.put('/api/routines/:id', wrap((req, res) => {
  const { name, notes = '', position = 0, exercises = [] } = req.body || {};
  db.prepare('UPDATE routines SET name = ?, notes = ?, position = ? WHERE id = ?')
    .run(name, notes, position, req.params.id);
  writeRoutineExercises(Number(req.params.id), exercises);
  res.json({ ok: true });
}));

app.delete('/api/routines/:id', wrap((req, res) => {
  const del = db.transaction((id) => {
    db.prepare('DELETE FROM routine_exercises WHERE routine_id = ?').run(id);
    db.prepare('DELETE FROM routines WHERE id = ?').run(id);
  });
  del(Number(req.params.id));
  res.json({ ok: true });
}));

// ===== Sessions =====
function loadSession(row) {
  if (!row) return null;
  const exercises = db.prepare(
    'SELECT * FROM session_exercises WHERE session_id = ? ORDER BY position, id'
  ).all(row.id).map(r => ({ ...r, actual_sets: parse(r.actual_sets) }));
  return { ...row, exercises };
}

// Build session_exercises from a routine's targets (prefill when starting a session).
function prefillFromRoutine(routineId) {
  const res = [];
  const routineExercises = db.prepare(`
    SELECT re.*, e.name AS exercise_name, e.measurement_type
    FROM routine_exercises re
    LEFT JOIN exercises e ON e.id = re.exercise_id
    WHERE re.routine_id = ?
    ORDER BY re.position, re.id
  `).all(routineId);
  routineExercises.forEach((re, i) => {
    res.push({
      exercise_id: re.exercise_id,
      exercise_name: re.exercise_name || '',
      measurement_type: re.measurement_type || 'weight_reps',
      position: re.position ?? i,
      superset_group: re.superset_group,
      annotation: re.annotation || '',
      actual_sets: parse(re.target_sets).map(s => ({ ...s, completed: false })),
    });
  });
  return res;
}

app.get('/api/sessions', wrap((req, res) => {
  const { exerciseId, from, to } = req.query;
  let rows;
  if (exerciseId) {
    rows = db.prepare(`
      SELECT DISTINCT s.* FROM sessions s
      JOIN session_exercises se ON se.session_id = s.id
      WHERE se.exercise_id = ?
        AND (? = '' OR s.started_at >= ?)
        AND (? = '' OR s.started_at <= ?)
      ORDER BY s.started_at DESC, s.id DESC
    `).all(exerciseId, from || '', from || '', to || '', to || '');
  } else {
    rows = db.prepare(`
      SELECT * FROM sessions
      WHERE (? = '' OR started_at >= ?) AND (? = '' OR started_at <= ?)
      ORDER BY started_at DESC, id DESC
    `).all(from || '', from || '', to || '', to || '');
  }
  res.json(rows.map(loadSession));
}));

app.get('/api/sessions/:id', wrap((req, res) => {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(loadSession(row));
}));

const writeSessionExercises = db.transaction((sessionId, exercises) => {
  db.prepare('DELETE FROM session_exercises WHERE session_id = ?').run(sessionId);
  const insert = db.prepare(`
    INSERT INTO session_exercises
      (session_id, exercise_id, exercise_name, measurement_type, position,
       superset_group, annotation, actual_sets)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  (exercises || []).forEach((ex, i) => {
    insert.run(
      sessionId,
      ex.exercise_id,
      ex.exercise_name || '',
      ex.measurement_type || 'weight_reps',
      ex.position ?? i,
      asInt(ex.superset_group),
      ex.annotation || '',
      json(ex.actual_sets)
    );
  });
});

app.post('/api/sessions', wrap((req, res) => {
  const b = req.body || {};
  const routineId = asInt(b.routine_id);
  let routineName = b.routine_name || '';
  if (routineId && !routineName) {
    const r = db.prepare('SELECT name FROM routines WHERE id = ?').get(routineId);
    if (r) routineName = r.name;
  }
  const info = db.prepare(
    'INSERT INTO sessions (routine_id, routine_name, started_at, ended_at, notes) VALUES (?, ?, ?, ?, ?)'
  ).run(
    routineId,
    routineName,
    b.started_at || new Date().toISOString(),
    b.ended_at || '',
    b.notes || ''
  );
  // Prefill from routine when the client didn't send exercises.
  const exercises = (b.exercises && b.exercises.length)
    ? b.exercises
    : (routineId ? prefillFromRoutine(routineId) : []);
  writeSessionExercises(info.lastInsertRowid, exercises);
  res.json({ id: info.lastInsertRowid });
}));

app.put('/api/sessions/:id', wrap((req, res) => {
  const b = req.body || {};
  db.prepare(
    'UPDATE sessions SET routine_id = ?, routine_name = ?, started_at = ?, ended_at = ?, notes = ? WHERE id = ?'
  ).run(
    asInt(b.routine_id),
    b.routine_name || '',
    b.started_at || new Date().toISOString(),
    b.ended_at || '',
    b.notes || '',
    req.params.id
  );
  writeSessionExercises(Number(req.params.id), b.exercises || []);
  res.json({ ok: true });
}));

app.delete('/api/sessions/:id', wrap((req, res) => {
  const del = db.transaction((id) => {
    db.prepare('DELETE FROM session_exercises WHERE session_id = ?').run(id);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  });
  del(Number(req.params.id));
  res.json({ ok: true });
}));

// ===== Progression =====
const num = (v) => (typeof v === 'number' && !Number.isNaN(v) ? v : 0);

app.get('/api/progression/:exerciseId', wrap((req, res) => {
  const { from, to } = req.query;
  const rows = db.prepare(`
    SELECT se.actual_sets, se.measurement_type, s.started_at
    FROM session_exercises se
    JOIN sessions s ON s.id = se.session_id
    WHERE se.exercise_id = ?
      AND (? = '' OR s.started_at >= ?)
      AND (? = '' OR s.started_at <= ?)
    ORDER BY s.started_at ASC
  `).all(req.params.exerciseId, from || '', from || '', to || '', to || '');

  const series = rows.map(r => {
    const sets = parse(r.actual_sets).filter(s => s.completed);
    if (!sets.length) return null; // ignore sessions with no completed sets for this exercise
    let volume = 0, maxWeight = 0, maxReps = 0, best1RM = 0, maxDuration = 0, maxDistance = 0;
    for (const s of sets) {
      const reps = num(s.reps), weight = num(s.weight);
      volume += reps * weight;
      if (weight > maxWeight) maxWeight = weight;
      if (reps > maxReps) maxReps = reps;
      const oneRM = weight * (1 + reps / 30); // Epley
      if (oneRM > best1RM) best1RM = oneRM;
      if (num(s.durationSec) > maxDuration) maxDuration = num(s.durationSec);
      if (num(s.distanceM) > maxDistance) maxDistance = num(s.distanceM);
    }
    return {
      date: r.started_at,
      measurement_type: r.measurement_type,
      completedSets: sets.length,
      volume,
      maxWeight,
      maxReps,
      best1RM: Math.round(best1RM * 10) / 10,
      maxDuration,
      maxDistance,
    };
  }).filter(Boolean);
  res.json(series);
}));

// ===== Export / Import (backup + restore) =====
const TABLES = ['exercises', 'routines', 'routine_exercises', 'sessions', 'session_exercises'];

function dumpAll() {
  const tables = {};
  for (const t of TABLES) tables[t] = db.prepare(`SELECT * FROM ${t}`).all();
  return { meta: { version: 1, takenAt: new Date().toISOString() }, tables };
}

app.get('/api/export', wrap((req, res) => {
  res.setHeader('Content-Disposition',
    `attachment; filename="fitness-tracker-${new Date().toISOString().split('T')[0]}.json"`);
  res.json(dumpAll());
}));

app.post('/api/import', wrap((req, res) => {
  const payload = req.body || {};
  const tables = payload.tables || {};
  if (!tables.exercises && !tables.routines && !tables.sessions) {
    return res.status(400).json({ error: 'invalid backup: no known tables' });
  }
  // Safety copy of the current DB before replacing.
  try { if (fs.existsSync(DB_PATH)) fs.copyFileSync(DB_PATH, DB_PATH + '.bak'); }
  catch (e) { console.error('backup copy failed', e); }

  const restore = db.transaction(() => {
    for (const t of [...TABLES].reverse()) db.prepare(`DELETE FROM ${t}`).run();
    for (const t of TABLES) {
      const rows = tables[t] || [];
      if (!rows.length) continue;
      const cols = Object.keys(rows[0]);
      const stmt = db.prepare(
        `INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
      );
      for (const row of rows) stmt.run(cols.map(c => row[c]));
    }
  });
  restore();
  res.json({ ok: true });
}));

// ===== Health =====
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Fitness Tracker running at http://0.0.0.0:${PORT}`);
});
