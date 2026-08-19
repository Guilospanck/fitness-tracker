import * as api from './db.js';
import { lineChart } from './charts.js';
import { downloadBackup, pickAndImport } from './io.js';

// ===== Measurement types =====
const MEASURE = {
  weight_reps:        { label: 'Weight & Reps',       fields: ['weight', 'reps'] },
  bodyweight_reps:    { label: 'Bodyweight Reps',     fields: ['reps'] },
  weighted_bodyweight:{ label: 'Weighted Bodyweight', fields: ['weight', 'reps'] },
  duration:           { label: 'Duration',            fields: ['durationSec'] },
  duration_weight:    { label: 'Duration & Weight',   fields: ['weight', 'durationSec'] },
  distance_duration:  { label: 'Distance & Duration', fields: ['distanceM', 'durationSec'] },
};
const FIELD = {
  weight:      { label: 'kg',   step: '0.5', ph: 'kg' },
  reps:        { label: 'reps', step: '1',   ph: 'reps' },
  durationSec: { label: 'sec',  step: '1',   ph: 'sec' },
  distanceM:   { label: 'm',    step: '1',   ph: 'm' },
};
const SS_OPTS = [['', '—'], ['1', 'A'], ['2', 'B'], ['3', 'C'], ['4', 'D'], ['5', 'E']];
const ssLabel = (g) => (SS_OPTS.find(o => o[0] === String(g ?? ''))?.[1]) || '';

// ===== DOM helper =====
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return e;
}
const clone = (o) => JSON.parse(JSON.stringify(o));
// Bounded, internally-scrolling region so pinned sections + footer stay visible.
const scroll = (...kids) => h('div', { class: 'scroll' }, ...kids);

// ===== Shell =====
const view = document.getElementById('view');
const titleEl = document.getElementById('view-title');
const actionsEl = document.getElementById('header-actions');
const modalRoot = document.getElementById('modal-root');
const toastEl = document.getElementById('toast');

function setHeader(title, actions = []) {
  titleEl.textContent = title;
  actionsEl.replaceChildren(...actions);
}
function setView(...nodes) {
  view.replaceChildren(...nodes.flat().filter(Boolean));
  window.scrollTo(0, 0);
}
let toastTimer;
function toast(msg, isErr = false) {
  toastEl.textContent = msg;
  toastEl.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.className = 'toast'; }, 2600);
}
async function guard(fn) {
  try { return await fn(); }
  catch (err) { toast(err.message || 'Something went wrong', true); throw err; }
}

function openModal(node) {
  const backdrop = h('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === backdrop) closeModal(); } },
    h('div', { class: 'modal' }, node));
  modalRoot.replaceChildren(backdrop);
}
function closeModal() { modalRoot.replaceChildren(); }

// ===== Exercise catalog cache =====
let exercises = [];
const exName = (id) => exercises.find(e => e.id === id)?.name || '(deleted)';
async function loadExercises() { exercises = await api.getExercises(); return exercises; }

// ===== Tabs / routing =====
const routes = {
  routines: renderRoutines,
  history: renderHistory,
  progress: renderProgress,
  settings: renderSettings,
};
const tabTitle = { routines: 'Routines', history: 'History', progress: 'Progress', settings: 'Settings' };
let activeTab = 'routines';

function selectTab(route) {
  activeTab = route;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.route === route));
  routes[route]();
}
document.querySelectorAll('.tab').forEach(t => t.onclick = () => selectTab(t.dataset.route));

const backBtn = (onBack) => h('button', { class: 'btn ghost sm', onclick: onBack }, '‹ Back');

// ===================================================================
// ROUTINES
// ===================================================================
async function renderRoutines() {
  setHeader('Routines');
  await guard(loadExercises);
  const routines = await guard(api.getRoutines);

  const list = routines.length
    ? routines.map(r => routineCard(r))
    : [h('div', { class: 'empty' }, 'No routines yet. Tap + to create your first exercise day.')];

  const fab = h('button', { class: 'fab', onclick: () => openRoutineEditor(null) }, '+');
  setView(scroll(list), fab);
}

function summarizeRoutine(r) {
  const n = r.exercises.length;
  return `${n} exercise${n === 1 ? '' : 's'}`;
}

function routineCard(r) {
  const exLines = r.exercises.map(re => {
    const ss = ssLabel(re.superset_group);
    return h('div', { class: 'row small muted' },
      ss ? h('span', { class: 'ss-badge' }, ss) : null,
      h('span', {}, `${re.exercise_name || exName(re.exercise_id)} · ${re.target_sets.length} set${re.target_sets.length === 1 ? '' : 's'}`));
  });
  return h('div', { class: 'card' },
    h('div', { class: 'row between' },
      h('h3', {}, r.name),
      h('div', { class: 'row' },
        h('button', { class: 'btn sm ghost', onclick: () => openRoutineEditor(r) }, 'Edit'),
        h('button', { class: 'btn sm primary', onclick: () => startSession(r) }, 'Start'))),
    h('div', { class: 'sub' }, summarizeRoutine(r)),
    r.notes ? h('div', { class: 'small muted', style: 'margin-top:6px' }, r.notes) : null,
    h('div', { style: 'margin-top:8px; display:flex; flex-direction:column; gap:3px' }, exLines));
}

// ---- Routine editor ----
async function openRoutineEditor(routine) {
  await guard(loadExercises);
  const model = routine
    ? clone(routine)
    : { name: '', notes: '', position: 0, exercises: [] };
  // normalise fields
  model.exercises = model.exercises.map(e => ({
    exercise_id: e.exercise_id,
    exercise_name: e.exercise_name || exName(e.exercise_id),
    measurement_type: e.measurement_type || (exercises.find(x => x.id === e.exercise_id)?.measurement_type) || 'weight_reps',
    superset_group: e.superset_group ?? null,
    annotation: e.annotation || '',
    target_sets: e.target_sets && e.target_sets.length ? clone(e.target_sets) : [{}],
  }));

  const exWrap = h('div', {});

  function renderExercises() {
    exWrap.replaceChildren(...model.exercises.map((ex, i) => exerciseEditorBlock(ex, i, model, renderExercises, false)));
  }
  renderExercises();

  const nameInput = h('input', { type: 'text', placeholder: 'e.g. Push Day A', value: model.name });
  const notesInput = h('textarea', { placeholder: 'Routine notes (optional)' }, model.notes);

  const save = h('button', { class: 'btn primary', onclick: () => guard(async () => {
    model.name = nameInput.value.trim();
    model.notes = notesInput.value;
    if (!model.name) return toast('Give the routine a name', true);
    const payload = {
      name: model.name, notes: model.notes, position: model.position || 0,
      exercises: model.exercises.map((e, idx) => ({
        exercise_id: e.exercise_id, position: idx,
        superset_group: e.superset_group, annotation: e.annotation, target_sets: e.target_sets,
      })),
    };
    if (routine) await api.updateRoutine(routine.id, payload);
    else await api.addRoutine(payload);
    toast('Routine saved');
    selectTab('routines');
  }) }, 'Save');

  setHeader(routine ? 'Edit routine' : 'New routine', [backBtn(() => selectTab('routines')), save]);
  setView(scroll(
    h('label', { class: 'field' }, h('span', {}, 'Name'), nameInput),
    h('label', { class: 'field' }, h('span', {}, 'Notes'), notesInput),
    h('hr', { class: 'sep' }),
    exWrap,
    h('button', { class: 'btn', style: 'width:100%', onclick: () => openExercisePicker((chosen) => {
      model.exercises.push({
        exercise_id: chosen.id, exercise_name: chosen.name,
        measurement_type: chosen.measurement_type, superset_group: null,
        annotation: '', target_sets: [{}],
      });
      renderExercises();
    }) }, '+ Add exercise'),
    routine ? h('button', { class: 'btn danger ghost', style: 'width:100%; margin-top:20px', onclick: () => guard(async () => {
      if (!confirm('Delete this routine?')) return;
      await api.deleteRoutine(routine.id); toast('Routine deleted'); selectTab('routines');
    }) }, 'Delete routine') : null,
  ));
}

// A single exercise block used by both the routine editor (targets) and the
// session logger (actuals, withCompleted=true).
function exerciseEditorBlock(ex, i, model, rerender, withCompleted) {
  const setsHost = setsEditor(ex.measurement_type, ex.target_sets ?? ex.actual_sets, { withCompleted });

  const ssSelect = h('select', { onchange: (e) => { ex.superset_group = e.target.value === '' ? null : Number(e.target.value); rerender(); } },
    ...SS_OPTS.map(([v, l]) => {
      const o = h('option', { value: v }, l === '—' ? 'No superset' : `Superset ${l}`);
      if (String(ex.superset_group ?? '') === v) o.selected = true;
      return o;
    }));

  const annotation = h('textarea', { class: 'annotation', rows: '1', placeholder: 'Note (e.g. tempo, RPE, cue)' }, ex.annotation || '');
  const growAnnotation = () => { annotation.style.height = 'auto'; annotation.style.height = annotation.scrollHeight + 'px'; };
  annotation.oninput = () => { ex.annotation = annotation.value; growAnnotation(); };
  requestAnimationFrame(growAnnotation); // size to content once it's in the DOM

  const up = () => { if (i > 0) { const a = model.exercises; [a[i - 1], a[i]] = [a[i], a[i - 1]]; rerender(); } };
  const down = () => { const a = model.exercises; if (i < a.length - 1) { [a[i + 1], a[i]] = [a[i], a[i + 1]]; rerender(); } };
  const remove = () => { model.exercises.splice(i, 1); rerender(); };

  return h('div', { class: 'ex-block' + (ex.superset_group != null ? ' superset' : '') },
    h('div', { class: 'row between' },
      h('div', { class: 'row' },
        h('h3', { style: 'font-size:0.98rem' }, ex.exercise_name || exName(ex.exercise_id)),
        ex.superset_group != null ? h('span', { class: 'ss-badge' }, ssLabel(ex.superset_group)) : null),
      h('div', { class: 'row' },
        h('button', { class: 'icon', onclick: up }, '↑'),
        h('button', { class: 'icon', onclick: down }, '↓'),
        h('button', { class: 'icon', onclick: remove }, '✕'))),
    h('div', { class: 'small muted', style: 'margin:-2px 0 8px' }, MEASURE[ex.measurement_type]?.label || ex.measurement_type),
    setsHost,
    h('div', { style: 'margin-top:8px' }, annotation),
    withCompleted ? null : h('div', { style: 'margin-top:8px' }, ssSelect),
  );
}

// sets: array mutated in place. Fields depend on measurement type.
function setsEditor(type, sets, { withCompleted = false } = {}) {
  const fields = MEASURE[type]?.fields || ['reps'];
  const wrap = h('div', { class: 'sets-editor' });
  const head = h('div', { class: 'metric-head' });
  if (withCompleted) head.append(h('span', { style: 'flex:0 0 26px' }, ''));
  head.append(h('span', { style: 'flex:0 0 22px' }, '#'));
  fields.forEach(f => head.append(h('span', {}, FIELD[f].label)));
  head.append(h('span', { style: 'flex:0 0 26px' }, ''));

  const rowsWrap = h('div', {});
  function render() {
    rowsWrap.replaceChildren(...sets.map((s, i) => {
      const row = h('div', { class: 'set-row' });
      if (withCompleted) {
        const c = h('input', { type: 'checkbox' });
        c.checked = !!s.completed;
        c.onchange = () => { s.completed = c.checked; };
        row.append(h('span', { class: 'chk' }, c));
      }
      row.append(h('span', { class: 'set-num' }, String(i + 1)));
      fields.forEach(f => {
        const inp = h('input', { type: 'number', inputmode: 'decimal', step: FIELD[f].step, placeholder: FIELD[f].ph });
        if (s[f] != null) inp.value = s[f];
        inp.oninput = () => { s[f] = inp.value === '' ? null : Number(inp.value); };
        row.append(inp);
      });
      row.append(h('button', { class: 'icon', onclick: () => { sets.splice(i, 1); render(); } }, '✕'));
      return row;
    }));
  }
  render();
  const add = h('button', { class: 'btn sm ghost', style: 'margin-top:4px', onclick: () => {
    const last = sets[sets.length - 1];
    sets.push(last ? { ...last, completed: false } : {});
    render();
  } }, '+ Add set');
  wrap.append(head, rowsWrap, add);
  return wrap;
}

// ---- Exercise picker (modal) ----
async function openExercisePicker(onChoose) {
  await guard(loadExercises);
  const listHost = h('div', {});
  const search = h('input', { type: 'text', placeholder: 'Search exercises…' });

  function renderList() {
    const q = search.value.toLowerCase();
    const matches = exercises.filter(e => e.name.toLowerCase().includes(q));
    listHost.replaceChildren(...(matches.length ? matches.map(e =>
      h('div', { class: 'card', style: 'padding:10px; cursor:pointer', onclick: () => { closeModal(); onChoose(e); } },
        h('div', { class: 'row between' },
          h('div', {}, h('b', {}, e.name), h('div', { class: 'small muted' }, MEASURE[e.measurement_type]?.label || e.measurement_type)),
          h('button', { class: 'icon', onclick: (ev) => { ev.stopPropagation(); openExerciseForm(e, renderAfterEdit); } }, '✎')))
    ) : [h('div', { class: 'empty small' }, 'No matches. Create one below.')]));
  }
  const renderAfterEdit = async () => { await loadExercises(); renderList(); };
  search.oninput = renderList;
  renderList();

  openModal(h('div', {},
    h('h2', {}, 'Pick exercise'),
    search,
    h('div', { style: 'margin:12px 0' }, listHost),
    h('button', { class: 'btn primary', style: 'width:100%', onclick: () => openExerciseForm(null, async (created) => {
      await loadExercises();
      if (created) { closeModal(); onChoose(created); }
    }) }, '+ New exercise'),
  ));
}

// ---- Exercise create/edit form (modal) ----
function openExerciseForm(ex, done) {
  const name = h('input', { type: 'text', placeholder: 'Exercise name', value: ex?.name || '' });
  const type = h('select', {}, ...Object.entries(MEASURE).map(([v, m]) => {
    const o = h('option', { value: v }, m.label);
    if ((ex?.measurement_type || 'weight_reps') === v) o.selected = true;
    return o;
  }));
  const body = h('input', { type: 'text', placeholder: 'Body part (optional)', value: ex?.body_part || '' });
  const notes = h('textarea', { placeholder: 'Notes (optional)' }, ex?.notes || '');

  const save = h('button', { class: 'btn primary', onclick: () => guard(async () => {
    const payload = { name: name.value.trim(), measurement_type: type.value, body_part: body.value, notes: notes.value };
    if (!payload.name) return toast('Name required', true);
    let created;
    if (ex) { await api.updateExercise(ex.id, payload); created = { ...ex, ...payload }; }
    else { const { id } = await api.addExercise(payload); created = { id, ...payload }; }
    toast('Exercise saved');
    done && done(created);
  }) }, 'Save');

  openModal(h('div', {},
    h('h2', {}, ex ? 'Edit exercise' : 'New exercise'),
    h('label', { class: 'field' }, h('span', {}, 'Name'), name),
    h('label', { class: 'field' }, h('span', {}, 'Measurement'), type),
    h('label', { class: 'field' }, h('span', {}, 'Body part'), body),
    h('label', { class: 'field' }, h('span', {}, 'Notes'), notes),
    h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: closeModal }, 'Cancel'), h('div', { class: 'spacer' }), save),
    ex ? h('button', { class: 'btn danger ghost', style: 'width:100%; margin-top:14px', onclick: () => guard(async () => {
      if (!confirm('Delete this exercise from the catalog? Past sessions keep their history.')) return;
      await api.deleteExercise(ex.id); toast('Exercise deleted'); done && done(null);
    }) }, 'Delete') : null,
  ));
}

// ===================================================================
// SESSIONS — start & log
// ===================================================================
async function startSession(routine) {
  await guard(loadExercises);
  const session = {
    id: null,
    routine_id: routine.id,
    routine_name: routine.name,
    started_at: new Date().toISOString(),
    ended_at: '',
    notes: '',
    exercises: routine.exercises.map(re => ({
      exercise_id: re.exercise_id,
      exercise_name: re.exercise_name || exName(re.exercise_id),
      measurement_type: re.measurement_type || 'weight_reps',
      superset_group: re.superset_group ?? null,
      annotation: re.annotation || '',
      actual_sets: (re.target_sets.length ? re.target_sets : [{}]).map(s => ({ ...s, completed: false })),
    })),
  };
  openSessionLogger(session, true);
}

function openSessionLogger(session, isNew) {
  const model = clone(session);
  const exWrap = h('div', {});
  function rerender() {
    exWrap.replaceChildren(...model.exercises.map((ex, i) =>
      exerciseEditorBlock(ex, i, model, rerender, true)));
  }
  rerender();

  const notes = h('textarea', { placeholder: 'Session notes (optional)' }, model.notes || '');

  const finish = h('button', { class: 'btn primary', onclick: () => guard(async () => {
    model.notes = notes.value;
    model.ended_at = new Date().toISOString();
    const payload = {
      routine_id: model.routine_id, routine_name: model.routine_name,
      started_at: model.started_at, ended_at: model.ended_at, notes: model.notes,
      exercises: model.exercises.map((e, idx) => ({
        exercise_id: e.exercise_id, exercise_name: e.exercise_name,
        measurement_type: e.measurement_type, position: idx,
        superset_group: e.superset_group, annotation: e.annotation, actual_sets: e.actual_sets,
      })),
    };
    if (model.id) await api.updateSession(model.id, payload);
    else await api.addSession(payload);
    toast('Workout saved');
    selectTab('history');
  }) }, isNew ? 'Finish' : 'Save');

  const back = backBtn(() => selectTab(isNew ? 'routines' : 'history'));
  setHeader(model.routine_name || 'Workout', [back, finish]);
  setView(scroll(
    h('div', { class: 'small muted', style: 'margin-bottom:10px' },
      new Date(model.started_at).toLocaleString()),
    exWrap,
    h('button', { class: 'btn', style: 'width:100%', onclick: () => openExercisePicker((chosen) => {
      model.exercises.push({
        exercise_id: chosen.id, exercise_name: chosen.name,
        measurement_type: chosen.measurement_type, superset_group: null,
        annotation: '', actual_sets: [{ completed: false }],
      });
      rerender();
    }) }, '+ Add exercise'),
    h('label', { class: 'field', style: 'margin-top:16px' }, h('span', {}, 'Session notes'), notes),
    model.id ? h('button', { class: 'btn danger ghost', style: 'width:100%', onclick: () => guard(async () => {
      if (!confirm('Delete this workout?')) return;
      await api.deleteSession(model.id); toast('Workout deleted'); selectTab('history');
    }) }, 'Delete workout') : null,
  ));
}

// ===================================================================
// HISTORY
// ===================================================================
async function renderHistory() {
  setHeader('History');
  await guard(loadExercises);
  const sessions = await guard(() => api.getSessions());
  if (!sessions.length) { setView(h('div', { class: 'empty' }, 'No workouts logged yet.')); return; }
  setView(scroll(sessions.map(s => {
    const done = s.exercises.reduce((n, e) => n + e.actual_sets.filter(x => x.completed).length, 0);
    return h('div', { class: 'card', style: 'cursor:pointer', onclick: () => openSessionLogger(s, false) },
      h('div', { class: 'row between' },
        h('h3', {}, s.routine_name || 'Workout'),
        h('span', { class: 'small muted' }, new Date(s.started_at).toLocaleDateString())),
      h('div', { class: 'sub' }, `${s.exercises.length} exercise${s.exercises.length === 1 ? '' : 's'} · ${done} set${done === 1 ? '' : 's'} completed`),
      s.notes ? h('div', { class: 'small muted', style: 'margin-top:6px' }, s.notes) : null);
  })));
}

// ===================================================================
// PROGRESS
// ===================================================================
const METRICS = {
  volume:    { label: 'Volume (kg)',   key: 'volume' },
  best1RM:   { label: 'Est. 1RM (kg)', key: 'best1RM' },
  maxWeight: { label: 'Max weight (kg)', key: 'maxWeight' },
  maxReps:   { label: 'Max reps',      key: 'maxReps' },
  maxDuration:{ label: 'Max duration (s)', key: 'maxDuration' },
  maxDistance:{ label: 'Max distance (m)', key: 'maxDistance' },
};
const METRICS_FOR = {
  weight_reps: ['maxWeight', 'maxReps'],
  weighted_bodyweight: ['maxWeight', 'maxReps'],
  bodyweight_reps: ['maxReps'],
  duration: ['maxDuration'],
  duration_weight: ['maxDuration', 'maxWeight'],
  distance_duration: ['maxDistance', 'maxDuration'],
};

async function renderProgress() {
  setHeader('Progress');
  await guard(loadExercises);
  if (!exercises.length) { setView(h('div', { class: 'empty' }, 'Add exercises and log a workout to see progress.')); return; }

  let selectedId = null;
  const search = h('input', { type: 'text', placeholder: 'Search exercises…' });
  const body = h('div', { class: 'scroll' });

  function renderList() {
    const q = search.value.trim().toLowerCase();
    const matches = exercises.filter(e =>
      e.name.toLowerCase().includes(q) || (e.body_part || '').toLowerCase().includes(q));
    body.replaceChildren(...(matches.length ? matches.map(e =>
      h('div', { class: 'card', style: 'padding:10px; cursor:pointer', onclick: () => { selectedId = e.id; showCharts(e); } },
        h('div', { class: 'row between' },
          h('div', {}, h('b', {}, e.name),
            h('div', { class: 'small muted' }, (e.body_part ? e.body_part + ' · ' : '') + (MEASURE[e.measurement_type]?.label || e.measurement_type))),
          h('span', { class: 'muted' }, '›')))
    ) : [h('div', { class: 'empty small' }, 'No matches.')]));
  }

  async function showCharts(ex) {
    const series = await guard(() => api.getProgression(ex.id));
    body.replaceChildren(
      h('div', { class: 'row between', style: 'margin-bottom:8px' },
        h('h3', { style: 'font-size:1rem' }, ex.name),
        h('button', { class: 'btn sm ghost', onclick: () => { selectedId = null; search.value = ''; renderList(); } }, '‹ Change')),
      renderProgress_(ex, series));
  }

  search.oninput = () => { if (search.value.trim() || !selectedId) { selectedId = null; renderList(); } };

  setView(
    h('label', { class: 'field' }, h('span', {}, 'Exercise'), search),
    body,
  );
  renderList();
}

function renderProgress_(ex, series) {
  if (!series.length) return h('div', { class: 'empty' }, 'No completed sets logged for this exercise yet.');
  const metricKeys = METRICS_FOR[ex.measurement_type] || ['volume'];
  const last = series[series.length - 1];

  const pills = h('div', { class: 'metric-pills' },
    ...metricKeys.map(k => h('span', { class: 'pill' }, METRICS[k].label.split(' (')[0] + ': ', h('b', {}, fmt(last[k])))));

  const charts = metricKeys.map(k => {
    const points = series.map(s => ({ y: s[k], label: new Date(s.date).toLocaleDateString() }));
    return h('div', { class: 'card' },
      h('div', { class: 'small muted' }, METRICS[k].label),
      lineChart(points, { label: '' }));
  });

  return h('div', {},
    h('div', { class: 'small muted' }, `${series.length} session${series.length === 1 ? '' : 's'} · latest ${new Date(last.date).toLocaleDateString()}`),
    pills,
    ...charts);
}
const fmt = (v) => (Math.round((v || 0) * 10) / 10);

// ===================================================================
// SETTINGS
// ===================================================================
async function renderSettings() {
  setHeader('Settings');
  await guard(loadExercises);

  const exList = exercises.length
    ? exercises.map(e => h('div', { class: 'row between', style: 'padding:8px 0; border-bottom:1px solid var(--border)' },
        h('div', {}, h('b', {}, e.name), h('span', { class: 'small muted' }, '  ' + (MEASURE[e.measurement_type]?.label || ''))),
        h('button', { class: 'btn sm ghost', onclick: () => openExerciseForm(e, () => renderSettings()) }, 'Edit')))
    : [h('div', { class: 'empty small' }, 'No exercises yet.')];

  setView(
    h('div', { class: 'card' },
      h('h3', {}, 'Backup & restore'),
      h('div', { class: 'small muted', style: 'margin-bottom:10px' },
        'Daily backups upload to S3 automatically. You can also export/import manually here.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => guard(downloadBackup) }, '⬇ Export JSON'),
        h('button', { class: 'btn', onclick: () => guard(async () => {
          if (!confirm('Import replaces ALL current data with the file you pick. Continue?')) return;
          const ok = await pickAndImport();
          if (ok) { toast('Data imported'); selectTab('routines'); }
        }) }, '⬆ Import JSON'))),
    h('div', { class: 'card fill' },
      h('div', { class: 'row between', style: 'margin-bottom:6px' },
        h('h3', {}, 'Exercises'),
        h('button', { class: 'btn sm primary', onclick: () => openExerciseForm(null, () => renderSettings()) }, '+ New')),
      scroll(exList)),
  );
}

// ===== Boot =====
selectTab('routines');
