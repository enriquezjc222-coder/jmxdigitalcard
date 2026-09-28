import { readFileSync } from 'node:fs';

const DEFAULT_BUCKET_ENDPOINT = 'https://firebasestorage.googleapis.com/v1alpha';

export function normalizeBucketName(value) {
  const name = String(value || '').trim().replace(/^gs:\/\//i, '').replace(/\/+$/, '');
  if (!name) return '';
  if (name.includes('/') || !/^[a-z0-9][a-z0-9._-]{1,221}[a-z0-9]$/i.test(name)) {
    throw new Error(`Invalid Storage bucket name: ${JSON.stringify(value)}.`);
  }
  return name;
}

export function bucketFromFirebaseConfig(value, readFile = readFileSync) {
  if (!value) return '';
  let raw = String(value).trim();
  if (!raw) return '';
  if (!raw.startsWith('{')) {
    try { raw = readFile(raw, 'utf8'); } catch (error) {
      throw new Error(`FIREBASE_CONFIG could not be read as JSON or a file: ${error.message}`);
    }
  }
  let config;
  try { config = JSON.parse(raw); } catch (error) {
    throw new Error(`FIREBASE_CONFIG is not valid JSON: ${error.message}`);
  }
  return normalizeBucketName(config.storageBucket);
}

export function bucketNameFromDefaultBucketResource(resource) {
  const name = resource?.bucket?.name;
  if (!name) throw new Error('Firebase returned a default-bucket resource without bucket.name.');
  const marker = '/buckets/';
  const index = name.lastIndexOf(marker);
  return normalizeBucketName(index >= 0 ? decodeURIComponent(name.slice(index + marker.length)) : name);
}

export async function discoverDefaultBucket({ projectId, credential, fetchImpl = globalThis.fetch }) {
  if (!projectId) throw new Error('A Firebase project ID is required to discover the Storage bucket.');
  if (!credential?.getAccessToken) throw new Error('Application Default Credentials cannot provide an access token for bucket discovery.');
  if (typeof fetchImpl !== 'function') throw new Error('This Node.js runtime does not provide fetch for bucket discovery.');
  const tokenResult = await credential.getAccessToken();
  const accessToken = tokenResult?.access_token;
  if (!accessToken) throw new Error('Application Default Credentials returned no access token for bucket discovery.');
  const url = `${DEFAULT_BUCKET_ENDPOINT}/projects/${encodeURIComponent(projectId)}/defaultBucket`;
  let response;
  try {
    response = await fetchImpl(url, { headers: { authorization: `Bearer ${accessToken}` } });
  } catch (error) {
    throw new Error(`Could not query Firebase for the default Storage bucket: ${error.message}`);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const detail = body ? ` ${body.slice(0, 500)}` : '';
    throw new Error(`Could not resolve the default Storage bucket for ${projectId}: Firebase API returned HTTP ${response.status}.${detail}`);
  }
  return bucketNameFromDefaultBucketResource(await response.json());
}

export async function resolveStorageBucket({ projectId, bucket, env = process.env, credential, fetchImpl } = {}) {
  const explicit = normalizeBucketName(bucket);
  if (explicit) return { name: explicit, source: '--bucket' };
  const environment = normalizeBucketName(env?.FIREBASE_STORAGE_BUCKET);
  if (environment) return { name: environment, source: 'FIREBASE_STORAGE_BUCKET' };
  const firebaseConfig = bucketFromFirebaseConfig(env?.FIREBASE_CONFIG);
  if (firebaseConfig) return { name: firebaseConfig, source: 'FIREBASE_CONFIG' };
  const discovered = await discoverDefaultBucket({ projectId, credential, fetchImpl });
  if (!discovered) throw new Error(`Firebase has no default Storage bucket configured for ${projectId}. Use --bucket <name> only after verifying the real bucket.`);
  return { name: discovered, source: 'Firebase defaultBucket API' };
}
