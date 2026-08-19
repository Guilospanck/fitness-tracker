// Thin fetch wrapper over the server /api. The server owns SQLite; this is the
// only place the frontend talks to it.
const API = '/api';

async function request(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    let msg = `API error: ${res.status}`;
    try { const e = await res.json(); if (e.error) msg = e.error; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

// Exercises
export const getExercises = () => request('/exercises');
export const addExercise = (ex) => request('/exercises', { method: 'POST', body: ex });
export const updateExercise = (id, ex) => request(`/exercises/${id}`, { method: 'PUT', body: ex });
export const deleteExercise = (id) => request(`/exercises/${id}`, { method: 'DELETE' });

// Routines
export const getRoutines = () => request('/routines');
export const getRoutine = (id) => request(`/routines/${id}`);
export const addRoutine = (r) => request('/routines', { method: 'POST', body: r });
export const updateRoutine = (id, r) => request(`/routines/${id}`, { method: 'PUT', body: r });
export const deleteRoutine = (id) => request(`/routines/${id}`, { method: 'DELETE' });

// Sessions
export const getSessions = (q = {}) => {
  const p = new URLSearchParams();
  if (q.exerciseId) p.set('exerciseId', q.exerciseId);
  if (q.from) p.set('from', q.from);
  if (q.to) p.set('to', q.to);
  const qs = p.toString();
  return request(`/sessions${qs ? '?' + qs : ''}`);
};
export const getSession = (id) => request(`/sessions/${id}`);
export const addSession = (s) => request('/sessions', { method: 'POST', body: s });
export const updateSession = (id, s) => request(`/sessions/${id}`, { method: 'PUT', body: s });
export const deleteSession = (id) => request(`/sessions/${id}`, { method: 'DELETE' });

// Progression
export const getProgression = (exerciseId) => request(`/progression/${exerciseId}`);

// Export / Import
export const exportData = () => request('/export');
export const importData = (payload) => request('/import', { method: 'POST', body: payload });
