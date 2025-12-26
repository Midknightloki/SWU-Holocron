import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';

/**
 * Integration coverage for the new auth-driven landing flow.
 */

let mockAuthState;
const mockLoginWithGoogle = vi.fn().mockResolvedValue({ uid: 'google-1' });
const mockLoginAnonymously = vi.fn().mockResolvedValue({ uid: 'anon-1', isAnonymous: true });
const mockLogout = vi.fn().mockResolvedValue();

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: mockAuthState.user,
    loading: mockAuthState.loading,
    loginWithGoogle: mockLoginWithGoogle,
    loginAnonymously: mockLoginAnonymously,
    logout: mockLogout,
    error: null,
    isConfigured: true,
  }),
}));

vi.mock('../../firebase', () => ({
  db: {},
  APP_ID: 'test-app',
  isConfigured: true,
}));

vi.mock('firebase/firestore', () => ({
  onSnapshot: vi.fn(() => () => {}),
  collection: vi.fn(() => ({})),
  doc: vi.fn(() => ({})),
  writeBatch: vi.fn(() => ({ set: vi.fn(), commit: vi.fn() })),
  setDoc: vi.fn(),
  deleteDoc: vi.fn(),
}));

vi.mock('../../services/CardService', () => ({
  CardService: {
    getAvailableSets: vi.fn(async () => ['SOR']),
    fetchSetData: vi.fn(async (setCode) => ({
      data: [
        { Set: setCode, Number: '001', Name: 'Test Card', Type: 'Unit' }
      ],
      source: 'test'
    })),
    getCollectionId: vi.fn((set, number, isFoil) => `${set}_${number}_${isFoil ? 'foil' : 'std'}`),
    getCardImage: vi.fn(() => '/card.jpg'),
    getBackImage: vi.fn(() => '/card_back.jpg'),
  }
}));

vi.mock('../../components/PWAUpdatePrompt', () => ({ default: () => null }));
vi.mock('../../components/InstallPrompt', () => ({ default: () => null }));

describe('Landing Flow with Google SSO', () => {
  beforeEach(() => {
    mockAuthState = { user: null, loading: false };
    mockLoginWithGoogle.mockClear();
    mockLoginAnonymously.mockClear();
    mockLogout.mockClear();
    localStorage.clear();
  });

  it('shows landing and triggers Google login', async () => {
    const user = userEvent.setup();
    render(<App />);

    const googleBtn = await screen.findByRole('button', { name: /continue with google/i });
    await user.click(googleBtn);

    expect(mockLoginWithGoogle).toHaveBeenCalledTimes(1);
  });

  it('allows guest entry via anonymous auth', async () => {
    const user = userEvent.setup();
    render(<App />);

    const guestBtn = await screen.findByRole('button', { name: /continue as guest/i });
    await user.click(guestBtn);

    expect(mockLoginAnonymously).toHaveBeenCalledTimes(1);
  });

  it('renders main shell when authenticated user exists', async () => {
    mockAuthState = { user: { uid: 'u1', displayName: 'Tester', email: 't@example.com', isAnonymous: false }, loading: false };

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('SWU Holocron')).toBeInTheDocument();
      expect(screen.getByText('Tester')).toBeInTheDocument();
    });
  });
});
