import { onAuthStateChanged, signOut } from "firebase/auth";
import { apiRequest } from "./api.js";
import { auth, firebaseConfigured } from "./firebase.js";

const LOCAL_SESSION_KEY = "payapp.local-development-session";

export function subscribeToSession(onChange, onError, useFirebase = firebaseConfigured) {
  if (useFirebase) {
    return onAuthStateChanged(auth, onChange, onError);
  }

  let active = true;

  async function restoreLocalSession() {
    try {
      let session;
      const stored = localStorage.getItem(LOCAL_SESSION_KEY);
      if (stored) {
        try {
          session = JSON.parse(stored);
        } catch {
          localStorage.removeItem(LOCAL_SESSION_KEY);
        }
      }

      if (!session?.token || !session?.expiresAt || session.expiresAt <= Date.now()) {
        localStorage.removeItem(LOCAL_SESSION_KEY);
        const result = await apiRequest("/api/dev/session", { method: "POST" });
        session = result.session;
        localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(session));
      }

      if (active) {
        onChange({
          uid: session.uid,
          email: "Local development session",
          isLocalDevelopment: true,
          getIdToken: async () => session.token
        });
      }
    } catch (error) {
      if (active) onError(error);
    }
  }

  restoreLocalSession();
  return () => {
    active = false;
  };
}

export function getSessionToken(user) {
  if (!user) throw new Error("Sign in to continue.");
  return user.getIdToken();
}

export async function signOutSession(authMode) {
  if (authMode === "firebase") {
    await signOut(auth);
    return;
  }
  localStorage.removeItem(LOCAL_SESSION_KEY);
  window.location.reload();
}
