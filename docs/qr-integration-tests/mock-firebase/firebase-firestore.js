// TEST MOCK of firebase-firestore backed by localStorage (shared across tabs of the test context).
const DB_KEY = '__jmx_mock_db__';
const LOG_KEY = '__jmx_mock_writes__';
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
function loadDb() { try { return JSON.parse(localStorage.getItem(DB_KEY) || '{}'); } catch { return {}; } }
function saveDb(db) { localStorage.setItem(DB_KEY, JSON.stringify(db)); }
function log(entry) { const l = JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); l.push({ ...entry, page: location.pathname + location.search, at: Date.now() }); localStorage.setItem(LOG_KEY, JSON.stringify(l)); }

class Timestamp {
  constructor(seconds, nanoseconds = 0) { this.seconds = seconds; this.nanoseconds = nanoseconds; }
  static fromMillis(ms) { return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6); }
  static fromDate(d) { return Timestamp.fromMillis(d.getTime()); }
  static now() { return Timestamp.fromMillis(Date.now()); }
  toMillis() { return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6); }
  toDate() { return new Date(this.toMillis()); }
  toJSON() { return { __ts: this.toMillis() }; }
}
export { Timestamp };
const SENT = '__sentinel';
export const serverTimestamp = () => ({ [SENT]: 'serverTimestamp' });
export const deleteField = () => ({ [SENT]: 'delete' });
export const increment = (n) => ({ [SENT]: 'increment', n });
export const arrayUnion = (...v) => ({ [SENT]: 'arrayUnion', v });
export const arrayRemove = (...v) => ({ [SENT]: 'arrayRemove', v });

function revive(v) {
  if (Array.isArray(v)) return v.map(revive);
  if (v && typeof v === 'object') {
    if (typeof v.__ts === 'number' && Object.keys(v).length === 1) return Timestamp.fromMillis(v.__ts);
    const o = {}; for (const [k, x] of Object.entries(v)) o[k] = revive(x); return o;
  }
  return v;
}
function applyValue(prev, val) {
  if (val && typeof val === 'object' && val[SENT]) {
    switch (val[SENT]) {
      case 'serverTimestamp': return { __ts: Date.now() };
      case 'increment': return (Number(prev) || 0) + val.n;
      case 'arrayUnion': return [...new Set([...(Array.isArray(prev) ? prev : []), ...val.v])];
      case 'arrayRemove': return (Array.isArray(prev) ? prev : []).filter((x) => !val.v.includes(x));
      default: return undefined;
    }
  }
  if (val instanceof Timestamp) return { __ts: val.toMillis() };
  if (val instanceof Date) return { __ts: val.getTime() };
  return val;
}
function isPlainObj(v) { return v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Timestamp) && !(v instanceof Date) && !v[SENT] && !('__ts' in v); }
function mergeInto(target, src, deep) {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object' && v[SENT] === 'delete') { delete target[k]; continue; }
    if (deep && isPlainObj(v) && isPlainObj(target[k])) { mergeInto(target[k], v, true); continue; }
    if (deep && isPlainObj(v)) { target[k] = {}; mergeInto(target[k], v, true); continue; }
    const nv = applyValue(target[k], v);
    if (nv === undefined) delete target[k]; else target[k] = isPlainObj(nv) ? clone(nv) : clone(nv);
  }
  return target;
}
function setPath(obj, dotted, v) {
  const parts = dotted.split('.'); let o = obj;
  for (let i = 0; i < parts.length - 1; i++) { if (!isPlainObj(o[parts[i]])) o[parts[i]] = {}; o = o[parts[i]]; }
  const last = parts[parts.length - 1];
  if (v && typeof v === 'object' && v[SENT] === 'delete') delete o[last]; else o[last] = clone(applyValue(o[last], v));
}

export function getFirestore() { return { __db: true, type: 'firestore' }; }
const pathOf = (a) => (a && a.__path ? a.__path.split('/') : []);
export function doc(a, ...segs) {
  let parts = [...pathOf(a), ...segs.flatMap((s) => String(s).split('/'))].filter(Boolean);
  if (a && a.type === 'collection' && segs.length === 0) parts = [...parts, Math.random().toString(36).slice(2, 12)];
  return { __path: parts.join('/'), id: parts[parts.length - 1], type: 'document', path: parts.join('/') };
}
export function collection(a, ...segs) {
  const parts = [...pathOf(a), ...segs.flatMap((s) => String(s).split('/'))].filter(Boolean);
  return { __path: parts.join('/'), id: parts[parts.length - 1], type: 'collection', path: parts.join('/') };
}
export const collectionGroup = (db, id) => ({ __group: id, type: 'group' });
function snap(path, data) {
  const id = path.split('/').pop();
  return { id, ref: { __path: path, id, type: 'document', path }, exists: () => data !== undefined, data: () => (data === undefined ? undefined : revive(clone(data))), get: (f) => revive(clone(data?.[f])) };
}
export async function getDoc(ref) { const db = loadDb(); return snap(ref.__path, db[ref.__path]); }
export function where(field, op, value) { return { kind: 'where', field, op, value }; }
export function orderBy(field, dir = 'asc') { return { kind: 'orderBy', field, dir }; }
export function limit(n) { return { kind: 'limit', n }; }
export function query(coll, ...cons) { return { ...coll, constraints: [...(coll.constraints || []), ...cons] }; }
const getField = (d, f) => f.split('.').reduce((o, k) => (o == null ? undefined : o[k]), d);
function matches(d, c) {
  const v = getField(d, c.field); const x = c.value;
  switch (c.op) {
    case '==': return JSON.stringify(v) === JSON.stringify(x);
    case '!=': return JSON.stringify(v) !== JSON.stringify(x);
    case 'in': return x.some((y) => JSON.stringify(y) === JSON.stringify(v));
    case 'not-in': return !x.some((y) => JSON.stringify(y) === JSON.stringify(v));
    case 'array-contains': return Array.isArray(v) && v.includes(x);
    case 'array-contains-any': return Array.isArray(v) && v.some((y) => x.includes(y));
    case '>': return v > x; case '>=': return v >= x; case '<': return v < x; case '<=': return v <= x;
    default: return true;
  }
}
export async function getDocs(q) {
  const db = loadDb();
  const base = q.__path; const depth = base ? base.split('/').length + 1 : 0;
  let rows = Object.entries(db).filter(([p]) => {
    const parts = p.split('/');
    if (q.type === 'group') return parts.length >= 2 && parts[parts.length - 2] === q.__group;
    return p.startsWith(`${base}/`) && parts.length === depth;
  }).map(([p, d]) => ({ p, d }));
  for (const c of q.constraints || []) if (c.kind === 'where') rows = rows.filter((r) => matches(r.d, c));
  const lim = (q.constraints || []).find((c) => c.kind === 'limit'); if (lim) rows = rows.slice(0, lim.n);
  const docs = rows.map((r) => snap(r.p, r.d));
  return { docs, empty: docs.length === 0, size: docs.length, forEach: (fn) => docs.forEach(fn) };
}
export async function setDoc(ref, data, opts = {}) {
  const db = loadDb(); const merge = !!(opts.merge || opts.mergeFields);
  const cur = merge ? clone(db[ref.__path] || {}) : {};
  db[ref.__path] = mergeInto(cur, data, merge);
  saveDb(db); log({ op: 'set', path: ref.__path, merge, keys: Object.keys(data) });
}
export async function updateDoc(ref, data) {
  const db = loadDb(); if (!db[ref.__path]) throw Object.assign(new Error('No document to update'), { code: 'not-found' });
  for (const [k, v] of Object.entries(data)) setPath(db[ref.__path], k, v);
  saveDb(db); log({ op: 'update', path: ref.__path, keys: Object.keys(data) });
}
export async function addDoc(coll, data) { const r = doc(collection({ __path: coll.__path })); r.__path = `${coll.__path}/${Math.random().toString(36).slice(2, 12)}`; r.id = r.__path.split('/').pop(); await setDoc(r, data); return r; }
export async function deleteDoc(ref) { const db = loadDb(); delete db[ref.__path]; saveDb(db); log({ op: 'delete', path: ref.__path }); }
export function writeBatch() {
  const ops = [];
  return {
    set(ref, data, opts) { ops.push(() => setDoc(ref, data, opts)); return this; },
    update(ref, data) { ops.push(() => updateDoc(ref, data)); return this; },
    delete(ref) { ops.push(() => deleteDoc(ref)); return this; },
    async commit() { for (const o of ops) await o(); },
  };
}
export async function runTransaction(db, fn) {
  const tx = { get: getDoc, set: (r, d, o) => { setDoc(r, d, o); return tx; }, update: (r, d) => { updateDoc(r, d); return tx; }, delete: (r) => { deleteDoc(r); return tx; } };
  return fn(tx);
}
export function onSnapshot(ref, cb) { (ref.type === 'document' ? getDoc(ref) : getDocs(ref)).then(cb); return () => {}; }
export function enableIndexedDbPersistence() { return Promise.resolve(); }
