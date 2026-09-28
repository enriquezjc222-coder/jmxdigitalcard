// TEST MOCK of firebase-auth. The signed-in user comes from localStorage "__jmx_mock_user__".
const USER_KEY = '__jmx_mock_user__';
const current = () => { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; } };
const listeners = new Set();
const auth = { get currentUser() { const u = current(); return u ? { ...u, getIdToken: async () => 'mock-token' } : null; } };
export function getAuth() { return auth; }
export function onAuthStateChanged(a, cb) { listeners.add(cb); setTimeout(() => cb(auth.currentUser), 0); return () => listeners.delete(cb); }
export class GoogleAuthProvider { setCustomParameters() {} addScope() {} }
export async function signInWithPopup() { const u = current(); if (!u) throw new Error('No mock user'); return { user: auth.currentUser }; }
export async function signInWithEmailAndPassword() { return signInWithPopup(); }
export async function createUserWithEmailAndPassword() { return signInWithPopup(); }
export async function signOut() { localStorage.removeItem(USER_KEY); listeners.forEach((cb) => cb(null)); }
export function setPersistence() { return Promise.resolve(); }
export const browserLocalPersistence = {};
