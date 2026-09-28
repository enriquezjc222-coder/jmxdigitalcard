// TEST MOCK of firebase-storage. Files are PUT to the test server (/__storage/…) and served back
// from https://firebasestorage.googleapis.com (routed by the harness) without CORS headers —
// like a real Storage bucket without CORS configuration.
export function getStorage() { return { __storage: true }; }
export function ref(s, path) { return { fullPath: path, name: String(path).split('/').pop() }; }
export async function uploadBytes(r, blob, meta = {}) {
  const res = await fetch(`/__storage/${r.fullPath}`, { method: 'PUT', body: blob, headers: { 'Content-Type': meta.contentType || blob.type || 'application/octet-stream' } });
  if (!res.ok) throw new Error('mock upload failed');
  return { ref: r, metadata: meta };
}
// Real Firebase download-URL shape; the Playwright harness routes this host to the local
// in-memory store (served WITHOUT CORS headers, like a bucket without a CORS config).
export async function getDownloadURL(r) {
  return `https://firebasestorage.googleapis.com/v0/b/jmx-mock.appspot.com/o/${encodeURIComponent(r.fullPath)}?alt=media&token=mock`;
}
export async function deleteObject(r) { await fetch(`/__storage/${r.fullPath}`, { method: 'DELETE' }); }
