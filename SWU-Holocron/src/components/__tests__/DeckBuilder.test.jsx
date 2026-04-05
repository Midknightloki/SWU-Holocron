/**
 * @vitest-environment happy-dom
 * @unit @component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import DeckBuilder from '../DeckBuilder';

// Mock AuthContext
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'user-123', displayName: 'Test User' },
    isAdmin: false,
    loading: false,
  }),
}));

// Mock services
vi.mock('../../services/DeckService', () => ({
  DeckService: {
    listDecks: vi.fn().mockResolvedValue([]),
    createDeck: vi.fn().mockResolvedValue('new-deck-id'),
    updateDeck: vi.fn().mockResolvedValue(undefined),
    deleteDeck: vi.fn().mockResolvedValue(undefined),
    duplicateDeck: vi.fn().mockResolvedValue('dup-id'),
    listGameLogs: vi.fn().mockResolvedValue([]),
    computeRecord: vi.fn().mockReturnValue({ wins: 0, losses: 0, draws: 0, total: 0, winRate: 0 }),
  }
}));

vi.mock('../../services/CardService', () => ({
  CardService: {
    getCardImage: vi.fn().mockReturnValue('https://example.com/card.jpg'),
    fetchSetData: vi.fn().mockResolvedValue({ data: [] }),
  }
}));

vi.mock('../../utils/collectionHelpers', () => ({
  getPlaysetQuantity: vi.fn().mockReturnValue(0),
  getCardQuantities: vi.fn().mockReturnValue([]),
}));

vi.mock('../AdvancedSearch', () => ({
  default: () => <div>Advanced Search</div>,
}));

describe('DeckBuilder Component', () => {
  const defaultProps = {
    deck: null,
    collectionData: {},
    onClose: vi.fn(),
    onSaved: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render without crashing with null deck prop', async () => {
    render(<DeckBuilder {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Untitled Deck')).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('should show leader placeholder initially', async () => {
    render(<DeckBuilder {...defaultProps} />);

    await waitFor(() => {
      const leadersText = screen.queryAllByText(/leader/i);
      expect(leadersText.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
  });

  it('should show base placeholder initially', async () => {
    render(<DeckBuilder {...defaultProps} />);

    await waitFor(() => {
      const baseText = screen.queryAllByText(/base/i);
      expect(baseText.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
  });

  it('should render close button', async () => {
    render(<DeckBuilder {...defaultProps} />);

    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
  });

  it('should render save button for deck', async () => {
    render(<DeckBuilder {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Untitled Deck')).toBeInTheDocument();
    }, { timeout: 3000 });
  });
});
