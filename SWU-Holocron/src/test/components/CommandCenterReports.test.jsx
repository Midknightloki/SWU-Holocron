/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';

// Market reports and Saved reports/lists open from the Command Center; the
// binder no longer has a Value button.
// App setup copied from UserMenu.test.jsx; the collection listener delivers
// whatever each test puts in mockDocs.

let mockAuthState;
let mockDocs = {};

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: mockAuthState.user,
    loading: mockAuthState.loading,
    loginWithGoogle: vi.fn(),
    loginAnonymously: vi.fn(),
    logout: vi.fn(),
    error: null,
    isConfigured: true,
  }),
}));

vi.mock('../../firebase', () => ({ db: {}, APP_ID: 'test-app', isConfigured: true }));

vi.mock('firebase/firestore', () => ({
  onSnapshot: vi.fn((ref, onNext) => {
    onNext({ forEach: (fn) => Object.entries(mockDocs).forEach(([id, d]) => fn({ id, data: () => d })) });
    return () => {};
  }),
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
    fetchSetData: vi.fn(async (setCode) => ({ data: [{ Set: setCode, Number: '001', Name: 'Test Card', Type: 'Unit' }], source: 'test' })),
    getCollectionId: vi.fn((set, number, isFoil) => `${set}_${number}_${isFoil ? 'foil' : 'std'}`),
    getCardImage: vi.fn(() => '/card.jpg'),
    getBackImage: vi.fn(() => '/card_back.jpg'),
  },
}));

vi.mock('../../components/PWAUpdatePrompt', () => ({ default: () => null }));
vi.mock('../../components/InstallPrompt', () => ({ default: () => null }));
vi.mock('../../components/Dashboard', () => ({
  default: ({ onOpenMarketReports, onOpenSavedLists }) => (
    <div>
      Dashboard
      <button type="button" onClick={onOpenMarketReports}>open-market</button>
      {onOpenSavedLists && <button type="button" onClick={onOpenSavedLists}>open-saved</button>}
    </div>
  ),
}));
vi.mock('../../components/SavedListsPage', () => ({
  default: ({ onClose, batchesRefresh }) => (
    <div role="dialog" aria-label="Saved reports/lists">
      saved #{batchesRefresh}
      <button type="button" onClick={onClose}>close-saved</button>
    </div>
  ),
}));
vi.mock('../../components/AdvancedSearch', () => ({ default: () => null }));
vi.mock('../../components/CollectionValueReport', () => ({
  default: ({ onClose }) => (
    <div role="dialog" aria-label="Market reports">
      value report
      <button type="button" onClick={onClose}>close-value</button>
    </div>
  ),
}));

beforeEach(() => {
  mockAuthState = { user: { uid: 'u1', displayName: 'Test User', email: 't@x.com', isAnonymous: false }, loading: false };
  mockDocs = {};
  localStorage.clear();
  localStorage.setItem('swu-has-visited', 'true');
});

describe('Market reports and saved lists', () => {
  it('has no Value button in the binder any more', async () => {
    mockDocs = { SOR_001_std: { quantity: 2, set: 'SOR', number: '001', name: 'Test Card', isFoil: false } };
    render(<App />);
    // Wait until the binder has rendered the owned card, so the collection
    // (which used to reveal the Value button) has arrived.
    await screen.findAllByText('Test Card', {}, { timeout: 5000 });
    expect(screen.queryByRole('button', { name: 'Value' })).not.toBeInTheDocument();
  });

  it('opens Market reports from the Command Center', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByTitle('Dashboard', {}, { timeout: 5000 }));
    await user.click(screen.getByText('open-market'));
    expect(screen.getByRole('dialog', { name: 'Market reports' })).toBeInTheDocument();
    await user.click(screen.getByText('close-value'));
    expect(screen.queryByRole('dialog', { name: 'Market reports' })).not.toBeInTheDocument();
  });

  it('opens Saved reports/lists from the Command Center', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByTitle('Dashboard', {}, { timeout: 5000 }));
    await user.click(screen.getByText('open-saved'));
    expect(screen.getByRole('dialog', { name: 'Saved reports/lists' })).toHaveTextContent('saved #0');
    await user.click(screen.getByText('close-saved'));
    expect(screen.queryByRole('dialog', { name: 'Saved reports/lists' })).not.toBeInTheDocument();
  });
});
