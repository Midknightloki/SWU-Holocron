/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';

/**
 * Test coverage for mobile user menu functionality.
 * 
 * This test suite covers:
 * - Mobile user menu visibility on small screens
 * - Desktop user info display on larger screens
 * - User menu interactions (open/close)
 * - Click-outside behavior
 * - Logout functionality from mobile menu
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
    getLastSync: vi.fn(async () => null),
    getSetRegistry: vi.fn(async () => [{ code: 'SOR', name: 'Spark of Rebellion', isBaseSet: true, releaseDate: '2024-03-08' }]),
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
vi.mock('../../components/Dashboard', () => ({ default: () => <div>Dashboard</div> }));
vi.mock('../../components/CardSubmissionForm', () => ({ default: () => <div>Submit Form</div> }));
vi.mock('../../components/AdvancedSearch', () => ({ default: () => null }));

describe('User Menu - Mobile Responsiveness', () => {
  beforeEach(() => {
    mockAuthState = { 
      user: { 
        uid: 'u1', 
        displayName: 'Test User', 
        email: 'test@example.com', 
        isAnonymous: false 
      }, 
      loading: false 
    };
    mockLogout.mockClear();
    localStorage.clear();
    localStorage.setItem('swu-has-visited', 'true');
  });

  it('renders user information when authenticated', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Test User')).toBeInTheDocument();
      expect(screen.getByText('test@example.com')).toBeInTheDocument();
    });
  });

  it('shows guest user information for anonymous users', async () => {
    mockAuthState = { 
      user: { 
        uid: 'anon-1', 
        displayName: null, 
        email: null, 
        isAnonymous: true 
      }, 
      loading: false 
    };

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Guest user')).toBeInTheDocument();
      expect(screen.getByText('Anonymous session')).toBeInTheDocument();
    });
  });

  // Phones: the account menu is the "Me" sheet on the bottom bar (MobileNav).
  const openMe = async (user) => {
    await user.click(await screen.findByRole('button', { name: 'Me' }));
    return screen.getByRole('dialog', { name: 'Me' });
  };

  it('renders the Me button on the phone bottom bar', async () => {
    render(<App />);
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('button', { name: 'Me' })).toBeInTheDocument();
  });

  it('opens Me with the user details', async () => {
    const user = userEvent.setup();
    render(<App />);
    const sheet = await openMe(user);
    expect(within(sheet).getByText('Test User')).toBeInTheDocument();
    expect(within(sheet).getByText('test@example.com')).toBeInTheDocument();
  });

  it('closes Me with its close button', async () => {
    const user = userEvent.setup();
    render(<App />);
    const sheet = await openMe(user);
    await user.click(within(sheet).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Me' })).not.toBeInTheDocument();
  });

  it('logs out from Me', async () => {
    const user = userEvent.setup();
    render(<App />);
    const sheet = await openMe(user);
    await user.click(within(sheet).getByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
  });

  it('shows cloud sync status in Me for signed-in users', async () => {
    const user = userEvent.setup();
    render(<App />);
    const sheet = await openMe(user);
    expect(within(sheet).getByText(/cloud sync active/i)).toBeInTheDocument();
  });

  it('shows guest mode in Me for anonymous users', async () => {
    mockAuthState = {
      user: { uid: 'anon-1', displayName: null, email: null, isAnonymous: true },
      loading: false,
    };
    const user = userEvent.setup();
    render(<App />);
    const sheet = await openMe(user);
    expect(within(sheet).getByText(/guest mode/i)).toBeInTheDocument();
  });
});

describe('User Menu - Desktop Display', () => {
  beforeEach(() => {
    mockAuthState = { 
      user: { 
        uid: 'u1', 
        displayName: 'Desktop User', 
        email: 'desktop@example.com', 
        isAnonymous: false 
      }, 
      loading: false 
    };
    localStorage.setItem('swu-has-visited', 'true');
  });

  it('displays user info inline on desktop', async () => {
    render(<App />);

    await waitFor(() => {
      // Desktop view should show user name and email directly
      expect(screen.getByText('Desktop User')).toBeInTheDocument();
      expect(screen.getByText('desktop@example.com')).toBeInTheDocument();
    });
  });

  it('shows logout button on desktop', async () => {
    render(<App />);

    await waitFor(() => {
      const logoutButtons = screen.getAllByText(/log out/i);
      // Should have at least one logout button visible
      expect(logoutButtons.length).toBeGreaterThan(0);
    });
  });

  it('calls logout when desktop logout button is clicked', async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => {
      const logoutButtons = screen.getAllByText(/log out/i);
      expect(logoutButtons.length).toBeGreaterThan(0);
    });

    const logoutButtons = screen.getAllByText(/log out/i);
    await user.click(logoutButtons[0]);

    await waitFor(() => {
      expect(mockLogout).toHaveBeenCalled();
    });
  });
});
