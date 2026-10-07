import React, { createContext, useContext, useEffect, useReducer, useState, useCallback } from 'react';
import { GoogleAuthProvider, signInAnonymously, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db, isConfigured, APP_ID } from '../firebase';
import { upgradeGuest } from '../services/guestUpgrade';

export const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isContributor, setIsContributor] = useState(false);
  const [isPro, setIsPro] = useState(false);
  const [adminLoading, setAdminLoading] = useState(false);
  // The outcome of a guest signing in with Google, for the app to show.
  const [upgrade, setUpgrade] = useState(null);
  const [, rerender] = useReducer((n) => n + 1, 0);

  useEffect(() => {
    if (!isConfigured) {
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      // Clear the previous account's roles before the new profile read. Left
      // in place, an A-to-B switch keeps A's isPro/isAdmin for the length of
      // that read -- long enough for the scanner to act for the wrong user.
      setIsAdmin(false);
      setIsContributor(false);
      setIsPro(false);

      // Check admin/contributor status
      if (u && !u.isAnonymous) {
        setAdminLoading(true);
        try {
          // Contributor invites are redeemed explicitly with a code, through the
          // redeemInviteCode Cloud Function -- not applied silently at login.
          // The previous auto-apply granted the role from the client, which made
          // it unenforceable, and its .catch(() => {}) hid every failure.
          const profileRef = doc(db, 'artifacts', APP_ID, 'users', u.uid);
          const profileSnap = await getDoc(profileRef);

          if (profileSnap.exists()) {
            const profileData = profileSnap.data();
            setIsAdmin(profileData.isAdmin === true);
            setIsContributor(profileData.isContributor === true);
            setIsPro(profileData.isPro === true);
          } else {
            setIsAdmin(false);
            setIsContributor(false);
            setIsPro(false);
          }
        } catch (error) {
          console.error('Error checking admin status:', error);
          setIsAdmin(false);
          setIsContributor(false);
          setIsPro(false);
        } finally {
          setAdminLoading(false);
        }
      } else {
        setIsAdmin(false);
        setIsContributor(false);
        setIsPro(false);
        setAdminLoading(false);
      }

      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const loginWithGoogle = useCallback(async () => {
    if (!isConfigured) throw new Error('Firebase is not configured');
    setError(null);
    setLoading(true);

    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      if (auth.currentUser?.isAnonymous) {
        try {
          const res = await upgradeGuest({ auth, provider });
          const { user: upgraded, ...outcome } = res;
          setUpgrade(outcome);
          // Linking keeps the same user object (no auth-state event): re-render
          // so isAnonymous reads false everywhere.
          if (res.kind === 'linked') rerender();
          return upgraded;
        } catch (err) {
          if (err?.code !== 'auth/popup-closed-by-user' && err?.code !== 'auth/cancelled-popup-request') {
            setUpgrade({ kind: 'error', message: err?.message ?? 'Sign-in failed' });
          }
          throw err;
        }
      }
      const result = await signInWithPopup(auth, provider);
      return result.user;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const loginAnonymously = useCallback(async () => {
    if (!isConfigured) throw new Error('Firebase is not configured');
    setError(null);
    setLoading(true);

    try {
      const result = await signInAnonymously(auth);
      return result.user;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    if (!isConfigured) return;
    setError(null);
    setLoading(true);

    try {
      await signOut(auth);
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const value = {
    user,
    loading,
    error,
    isAdmin,
    isContributor,
    isPro,
    canScan: isAdmin || isPro,
    adminLoading,
    loginWithGoogle,
    upgrade,
    dismissUpgrade: () => setUpgrade(null),
    loginAnonymously,
    logout,
    isConfigured
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
};
