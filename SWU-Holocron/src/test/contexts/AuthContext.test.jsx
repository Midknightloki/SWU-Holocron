/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { useState } from 'react';
import { AuthProvider, useAuth } from '../../contexts/AuthContext';

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
  const { user, loading, loginWithGoogle, loginAnonymously, logout } = useAuth();
  const [lastUser, setLastUser] = useState(null);

  return (
    <div>
      <div data-testid="loading">{loading ? 'loading' : 'idle'}</div>
      <div data-testid="user">{user ? user.uid : 'none'}</div>
      <div data-testid="last-user">{lastUser ? lastUser.uid : 'none'}</div>
      <button onClick={async () => setLastUser(await loginWithGoogle())}>google</button>
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
