import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { GoogleAuthProvider, signInAnonymously, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { auth, isConfigured } from '../firebase';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isConfigured) {
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
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

  const value = { user, loading, error, loginWithGoogle, loginAnonymously, logout, isConfigured };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
};
