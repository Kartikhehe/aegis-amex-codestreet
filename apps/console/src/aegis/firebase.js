/**
 * Firebase client.
 *
 * Firestore is the console's LIVE data layer: decisions, agents, incidents and
 * fleet state are mirrored there by the backend, and the console subscribes to
 * them so the dashboard updates without polling.
 *
 * Two rules shape everything here.
 *
 * 1. **Firestore is optional.** If it is not configured, or the browser cannot
 *    reach it, every hook falls back to the REST API. A cloud dependency must
 *    never be the reason an operator cannot see the fleet, so this module is
 *    written to be absent without breaking anything.
 *
 * 2. **The client never writes.** Every document is a mirror of a decision the
 *    backend already made and recorded. Writes are denied to all clients by the
 *    security rules; the console reads, and posts changes through the API.
 */
import { getApps, initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signOut } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/** Firestore is only usable if the project is actually configured. */
export const firebaseConfigured = Boolean(config.apiKey && config.projectId);

let app = null;
let db = null;
let auth = null;

if (firebaseConfigured) {
  try {
    app = getApps().length ? getApps()[0] : initializeApp(config);
    db = getFirestore(app);
    auth = getAuth(app);

    const emulator = import.meta.env.VITE_FIRESTORE_EMULATOR_HOST;
    if (emulator) {
      const [host, port] = emulator.split(':');
      connectFirestoreEmulator(db, host, Number(port));
    }
  } catch (error) {
    // A misconfigured Firebase must degrade to REST, not white-screen the app.
    console.warn('Firebase unavailable; falling back to the REST API.', error);
    app = null;
    db = null;
    auth = null;
  }
}

export const firestore = db;
export const firebaseAuth = auth;

/** True when live subscriptions are actually possible right now. */
export const canSubscribe = () => Boolean(db && auth?.currentUser);

/**
 * Exchange the AEGIS session for a Firebase one.
 *
 * The backend mints a Firebase custom token carrying the SAME role claims as
 * the AEGIS JWT. That is what lets the security rules scope reads server-side:
 * an agent operator's token simply cannot read another operator's decisions,
 * regardless of what the client asks for.
 */
export const signInToFirebase = async (customToken) => {
  if (!auth || !customToken) return false;
  try {
    await signInWithCustomToken(auth, customToken);
    return true;
  } catch (error) {
    console.warn('Firebase sign-in failed; using the REST API.', error);
    return false;
  }
};

export const signOutOfFirebase = async () => {
  if (!auth) return;
  try {
    await signOut(auth);
  } catch {
    // Signing out of a session that is already gone is not an error.
  }
};

export default firestore;
