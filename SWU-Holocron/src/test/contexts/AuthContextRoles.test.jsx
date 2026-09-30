/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const state = vi.hoisted(() => ({ user: null, profile: null }));

vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: vi.fn(() => ({ setCustomParameters: vi.fn() })),
  signInWithPopup: vi.fn(),
  signInAnonymously: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChanged: (auth, cb) => {
    cb(state.user);
    return () => {};
  },
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  getDoc: vi.fn(async () => ({
    exists: () => state.profile !== null,
    data: () => state.profile,
  })),
}));

vi.mock('../../firebase', () => ({ auth: {}, db: {}, isConfigured: true, APP_ID: 'test-app-id' }));

import { AuthProvider, useAuth } from '../../contexts/AuthContext';

function Harness() {
  // `loading` only clears after the profile read resolves, so waiting on it
  // means the role flags are final -- a falsy assertion before then is vacuous.
  const { isAdmin, isPro, canScan, loading } = useAuth();
  return (
    <div>
      <div data-testid="settled">{loading ? 'no' : 'yes'}</div>
      <div data-testid="admin">{String(isAdmin)}</div>
      <div data-testid="pro">{String(isPro)}</div>
      <div data-testid="can-scan">{String(canScan)}</div>
    </div>
  );
}

const renderWith = async (user, profile) => {
  state.user = user;
  state.profile = profile;
  render(<AuthProvider><Harness /></AuthProvider>);
  await waitFor(() => expect(screen.getByTestId('settled').textContent).toBe('yes'));
};

describe('AuthContext entitlements', () => {
  beforeEach(() => {
    state.user = null;
    state.profile = null;
  });

  it('marks a Pro user as able to scan', async () => {
    await renderWith({ uid: 'u1', isAnonymous: false }, { isPro: true });
    await waitFor(() => expect(screen.getByTestId('pro').textContent).toBe('true'));
    expect(screen.getByTestId('can-scan').textContent).toBe('true');
  });

  it('lets an admin scan without isPro', async () => {
    await renderWith({ uid: 'u2', isAnonymous: false }, { isAdmin: true });
    await waitFor(() => expect(screen.getByTestId('admin').textContent).toBe('true'));
    expect(screen.getByTestId('pro').textContent).toBe('false');
    expect(screen.getByTestId('can-scan').textContent).toBe('true');
  });

  it('does not let an ordinary user scan', async () => {
    await renderWith({ uid: 'u3', isAnonymous: false }, {});
    expect(screen.getByTestId('can-scan').textContent).toBe('false');
  });

  it('only accepts a literal true, not a truthy string', async () => {
    await renderWith({ uid: 'u4', isAnonymous: false }, { isPro: 'yes' });
    expect(screen.getByTestId('pro').textContent).toBe('false');
  });

  it('never grants scanning to an anonymous guest, whatever the profile says', async () => {
    await renderWith({ uid: 'g1', isAnonymous: true }, { isPro: true });
    expect(screen.getByTestId('pro').textContent).toBe('false');
    expect(screen.getByTestId('can-scan').textContent).toBe('false');
  });
});
