/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { useState } from 'react';
import { AuthProvider, useAuth } from '../../contexts/AuthContext';
import { auth as mockAuth } from '../../firebase';

const mockGoogleUser = { uid: 'google-123', displayName: 'Test User', email: 'test@example.com' };
const mockAnonUser = { uid: 'anon-123', isAnonymous: true };

const mockSignInWithPopup = vi.fn(async () => ({ user: mockGoogleUser }));
const mockSignInAnonymously = vi.fn(async () => ({ user: mockAnonUser }));
const mockSignOut = vi.fn(async () => {});
const mockOnAuthStateChanged = vi.fn((auth, cb) => {
  cb(null);
  return vi.fn();
});

const mockSetCustomParameters = vi.fn();

const mockUpgradeGuest = vi.fn();
vi.mock('../../services/guestUpgrade', () => ({ upgradeGuest: (...args) => mockUpgradeGuest(...args) }));

vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: vi.fn(() => ({ setCustomParameters: mockSetCustomParameters })),
  signInWithPopup: (...args) => mockSignInWithPopup(...args),
  signInAnonymously: (...args) => mockSignInAnonymously(...args),
  signOut: (...args) => mockSignOut(...args),
  onAuthStateChanged: (...args) => mockOnAuthStateChanged(...args),
}));

vi.mock('../../firebase', () => ({
  auth: {},
  isConfigured: true,
}));

function Harness() {
  const { user, loading, loginWithGoogle, loginAnonymously, logout, upgrade } = useAuth();
  const [lastUser, setLastUser] = useState(null);

  return (
    <div>
      <div data-testid="loading">{loading ? 'loading' : 'idle'}</div>
      <div data-testid="user">{user ? user.uid : 'none'}</div>
      <div data-testid="last-user">{lastUser ? lastUser.uid : 'none'}</div>
      <div data-testid="anonymous">{String(Boolean(user?.isAnonymous))}</div>
      <div data-testid="upgrade">{upgrade?.kind ?? 'none'}</div>
      <button onClick={async () => setLastUser(await loginWithGoogle())}>google</button>
      <button onClick={() => loginWithGoogle().catch(() => {})}>google-try</button>
      <button onClick={async () => setLastUser(await loginAnonymously())}>guest</button>
      <button onClick={logout}>logout</button>
    </div>
  );
}

const renderHarness = () => render(<AuthProvider><Harness /></AuthProvider>);

describe('AuthContext', () => {
  beforeEach(() => {
    mockSignInWithPopup.mockClear();
    mockSignInAnonymously.mockClear();
    mockSignOut.mockClear();
    mockOnAuthStateChanged.mockClear();
    mockSetCustomParameters.mockClear();
    mockUpgradeGuest.mockReset();
    mockOnAuthStateChanged.mockImplementation((a, cb) => { cb(null); return vi.fn(); });
    mockAuth.currentUser = null;
  });

  it('upgrades a guest in place instead of signing in fresh', async () => {
    const guest = { uid: 'anon-9', isAnonymous: true };
    mockAuth.currentUser = guest;
    mockOnAuthStateChanged.mockImplementation((a, cb) => { cb(guest); return vi.fn(); });
    // Linking turns the same user object into a Google user, with no auth event.
    mockUpgradeGuest.mockImplementation(async () => { guest.isAnonymous = false; return { kind: 'linked', user: guest }; });
    const user = userEvent.setup();
    renderHarness();
    expect(screen.getByTestId('anonymous').textContent).toBe('true');
    await user.click(screen.getByText('google'));
    await waitFor(() => expect(screen.getByTestId('anonymous').textContent).toBe('false'));
    expect(screen.getByTestId('upgrade').textContent).toBe('linked');
    expect(screen.getByTestId('user').textContent).toBe('anon-9');
    expect(mockSignInWithPopup).not.toHaveBeenCalled();
  });

  it('keeps popup sign-in for someone who is not a guest', async () => {
    const user = userEvent.setup();
    renderHarness();
    await user.click(screen.getByText('google'));
    expect(mockSignInWithPopup).toHaveBeenCalledTimes(1);
    expect(mockUpgradeGuest).not.toHaveBeenCalled();
  });

  it('records a failed guest upgrade, but not a closed popup', async () => {
    mockAuth.currentUser = { uid: 'anon-9', isAnonymous: true };
    mockUpgradeGuest.mockRejectedValueOnce(Object.assign(new Error('closed'), { code: 'auth/popup-closed-by-user' }));
    const user = userEvent.setup();
    renderHarness();
    await user.click(screen.getByText('google-try'));
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getByTestId('upgrade').textContent).toBe('none');
    mockUpgradeGuest.mockRejectedValueOnce(Object.assign(new Error('network down'), { code: 'auth/network-request-failed' }));
    await user.click(screen.getByText('google-try'));
    await waitFor(() => expect(screen.getByTestId('upgrade').textContent).toBe('error'));
  });

  it('performs Google login and returns user', async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByText('google'));

    expect(mockSignInWithPopup).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByTestId('last-user').textContent).toBe(mockGoogleUser.uid);
    });
  });

  it('performs anonymous login for guest mode', async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByText('guest'));

    expect(mockSignInAnonymously).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByTestId('last-user').textContent).toBe(mockAnonUser.uid);
    });
  });

  it('logs out via Firebase', async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByText('logout'));

    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });
});
