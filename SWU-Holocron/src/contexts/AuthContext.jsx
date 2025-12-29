import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { GoogleAuthProvider, signInAnonymously, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db, isConfigured, APP_ID } from '../firebase';

export const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminLoading, setAdminLoading] = useState(false);

  useEffect(() => {
    if (!isConfigured) {
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);

      // Check admin status
      if (u && !u.isAnonymous) {
        setAdminLoading(true);
        try {
          const profileRef = doc(db, `artifacts/${APP_ID}/users/${u.uid}/profile`);
          const profileSnap = await getDoc(profileRef);

          if (profileSnap.exists()) {
            const profileData = profileSnap.data();
            setIsAdmin(profileData.isAdmin === true);
          } else {
            setIsAdmin(false);
          }
        } catch (error) {
          console.error('Error checking admin status:', error);
          setIsAdmin(false);
        } finally {
          setAdminLoading(false);
        }
      } else {
        setIsAdmin(false);
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
    adminLoading,
    loginWithGoogle,
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
