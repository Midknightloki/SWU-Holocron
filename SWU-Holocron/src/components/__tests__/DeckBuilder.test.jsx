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
    getAvailableSets: vi.fn().mockResolvedValue(['SOR', 'SHD']),
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

  it('should render welcome screen for a new deck', async () => {
    render(<DeckBuilder {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Create New Deck')).toBeInTheDocument();
      expect(screen.getByText('Start from Scratch')).toBeInTheDocument();
      expect(screen.getByText('Import Decklist')).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('should transition to Format step when clicking Start from Scratch', async () => {
    render(<DeckBuilder {...defaultProps} />);

    const startBtn = await screen.findByText('Start from Scratch');
    startBtn.click();

    await waitFor(() => {
      expect(screen.getByText('Select Format')).toBeInTheDocument();
      expect(screen.getByText('Premier')).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('should transition to Leader step after selecting Format', async () => {
    render(<DeckBuilder {...defaultProps} />);

    const startBtn = await screen.findByText('Start from Scratch');
    startBtn.click();

    const premierBtn = await screen.findByText('Premier');
    premierBtn.click();

    await waitFor(() => {
      expect(screen.getByText('Select Leader')).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('should render close button', async () => {
    render(<DeckBuilder {...defaultProps} />);

    await waitFor(() => {
      const closeBtn = screen.getByLabelText('Close');
      expect(closeBtn).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('should render deck building interface when deck is provided', async () => {
    const existingDeck = {
      id: 'deck-1',
      name: 'Existing Deck',
      format: 'Premier',
      leaderId: 'SOR_001',
      baseId: 'SOR_002',
      cards: {}
    };
    render(<DeckBuilder {...defaultProps} deck={existingDeck} />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Existing Deck')).toBeInTheDocument();
      expect(screen.getByText('Card Search')).toBeInTheDocument();
    }, { timeout: 3000 });
  });
});
