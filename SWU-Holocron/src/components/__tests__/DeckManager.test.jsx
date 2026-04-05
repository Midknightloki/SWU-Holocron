/**
 * @vitest-environment happy-dom
 * @unit @component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DeckManager from '../DeckManager';

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
  }
}));

describe('DeckManager Component', () => {
  const mockUser = { uid: 'user-123', displayName: 'Test User' };
  const mockCollectionData = {};

  const defaultProps = {
    user: mockUser,
    collectionData: mockCollectionData,
    onOpenDeck: vi.fn(),
    onCreateDeck: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render without crashing', async () => {
    render(<DeckManager {...defaultProps} />);
    
    await waitFor(() => {
      expect(document.body).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('should render "No decks yet" empty state', async () => {
    render(<DeckManager {...defaultProps} />);
    
    await waitFor(() => {
      expect(screen.getByText('No decks yet')).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('should render deck cards when decks exist', async () => {
    const { DeckService } = await import('../../services/DeckService');
    DeckService.listDecks.mockResolvedValueOnce([
      {
        id: 'deck-1',
        name: 'Villain Deck',
        leaderId: 'SOR_001',
        baseId: 'SOR_002',
        totalCards: 45,
        updatedAt: new Date(),
        description: 'A test deck',
        cards: {}
      }
    ]);

    render(<DeckManager {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Villain Deck')).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('should render New Deck button in header', async () => {
    render(<DeckManager {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('My Decks')).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('should call onOpenDeck when Open button clicked', async () => {
    const { DeckService } = await import('../../services/DeckService');
    DeckService.listDecks.mockResolvedValueOnce([
      {
        id: 'deck-1',
        name: 'Test Deck',
        leaderId: 'SOR_001',
        baseId: 'SOR_002',
        totalCards: 50,
        updatedAt: new Date(),
        description: 'A test deck',
        cards: {}
      }
    ]);

    const onOpenDeck = vi.fn();
    render(<DeckManager {...defaultProps} onOpenDeck={onOpenDeck} />);

    await waitFor(() => {
      const openButton = screen.getByText('Open');
      expect(openButton).toBeInTheDocument();
      fireEvent.click(openButton);
      expect(onOpenDeck).toHaveBeenCalled();
    }, { timeout: 3000 });
  });
});
