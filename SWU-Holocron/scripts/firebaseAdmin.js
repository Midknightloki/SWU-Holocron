/**
 * Shared firebase-admin bootstrap for the data scripts.
 *
 * Credential resolution, in order:
 *   1. FIREBASE_SERVICE_ACCOUNT   inline JSON (legacy CI path, kept as a fallback)
 *   2. Application Default Creds  Workload Identity Federation in GitHub Actions,
 *                                 or `gcloud auth application-default login` locally
 *   3. firebase-admin-key.json    legacy local key file
 *
 * CI uses (2): google-github-actions/auth exports GOOGLE_APPLICATION_CREDENTIALS,
 * and no long-lived key exists anywhere. See docs/CI-KEYLESS-AUTH.md.
 *
 * Every data script must go through this module. Four copies of this logic
 * previously lived in the individual scripts, which is why none of them could
 * use ADC when the credential model changed.
 *
 * @environment:firebase
 * @critical
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const PROJECT_ID =
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT ||
  'swu-holocron-93a18';

let firestore = null;

/**
 * Initialise firebase-admin once and return a Firestore handle.
 * Safe to call from multiple scripts in the same process.
 *
 * @returns {Promise<FirebaseFirestore.Firestore>}
 */
export async function initFirestore() {
  if (firestore) return firestore;

  const admin = (await import('firebase-admin')).default;

  if (admin.apps.length) {
    firestore = admin.firestore();
    return firestore;
  }

  const { credential, source } = await resolveCredential(admin);
  admin.initializeApp({ credential, projectId: PROJECT_ID });
  console.warn(`[firebaseAdmin] project=${PROJECT_ID} credential=${source}`);

  firestore = admin.firestore();
  return firestore;
}

async function resolveCredential(admin) {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    return {
      credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
      source: 'FIREBASE_SERVICE_ACCOUNT',
    };
  }

  // applicationDefault() resolves GOOGLE_APPLICATION_CREDENTIALS, the gcloud
  // ADC file, or the metadata server. It throws only when none are present.
  try {
    return {
      credential: admin.credential.applicationDefault(),
      source: 'application-default',
    };
  } catch {
    // fall through to the legacy key file
  }

  try {
    const keyPath = join(__dirname, '..', 'firebase-admin-key.json');
    return {
      credential: admin.credential.cert(JSON.parse(readFileSync(keyPath, 'utf8'))),
      source: 'firebase-admin-key.json',
    };
  } catch {
    console.error('No Firebase credentials available.');
    console.error('  In CI this comes from Workload Identity Federation');
    console.error('  (see docs/CI-KEYLESS-AUTH.md).');
    console.error('  Locally, run: gcloud auth application-default login');
    process.exit(1);
  }
}
