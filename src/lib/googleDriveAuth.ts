import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const SCOPES = ['https://www.googleapis.com/auth/drive'];

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
for (const scope of SCOPES) {
  provider.addScope(scope);
}

// Keep Google OAuth access token strictly in memory (never localStorage/sessionStorage).
let isSigningIn = false;
let cachedAccessToken: string | null = null;
let cachedUserEmail: string | null = null;

export function initGoogleDriveAuth(
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void,
): () => void {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user) {
      cachedUserEmail = user.email ?? null;
      if (cachedAccessToken) {
        onAuthSuccess?.(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        onAuthFailure?.();
      }
    } else {
      cachedAccessToken = null;
      cachedUserEmail = null;
      onAuthFailure?.();
    }
  });
}

export async function googleDriveSignIn(): Promise<{
  user: User;
  accessToken: string;
}> {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error(
        'Không nhận được quyền truy cập Google Drive từ cửa sổ đăng nhập.',
      );
    }

    cachedAccessToken = credential.accessToken;
    cachedUserEmail = result.user.email ?? null;
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
}

export async function getGoogleDriveAccessToken(): Promise<string | null> {
  return cachedAccessToken;
}

export function getGoogleDriveUserEmail(): string | null {
  return cachedUserEmail;
}

export function clearGoogleDriveAccessToken(): void {
  cachedAccessToken = null;
}

export async function logoutGoogleDrive(): Promise<void> {
  cachedAccessToken = null;
  cachedUserEmail = null;
  await auth.signOut();
}
