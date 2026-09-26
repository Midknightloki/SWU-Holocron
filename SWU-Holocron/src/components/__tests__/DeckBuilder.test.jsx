/**
 * @vitest-environment happy-dom
 * @unit @component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    getSetRegistry: vi.fn().mockResolvedValue([
      { code: 'SOR', name: 'Spark of Rebellion', isBaseSet: true, releaseDate: '2024-03-08' },
      { code: 'SHD', name: 'Shadows of the Galaxy', isBaseSet: true, releaseDate: '2024-07-12' },
    ]),
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

describe('DeckBuilder tags', () => {
  const defaultProps = {
    deck: null,
    collectionData: {},
    onClose: vi.fn(),
    onSaved: vi.fn(),
  };

  const existingDeck = {
    id: 'deck-1',
    name: 'Existing Deck',
    format: 'Premier',
    leaderId: 'SOR_001',
    baseId: 'SOR_002',
    cards: {}
  };

  const openTagInput = async () => {
    const user = userEvent.setup();
    render(<DeckBuilder {...defaultProps} deck={existingDeck} />);
    const input = await screen.findByPlaceholderText('Add tag…');
    await user.click(input);
    return { user, input };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should open the suggestion list on focus', async () => {
    await openTagInput();
    expect(screen.getByText('Aggro')).toBeInTheDocument();
    expect(screen.getByText('Midrange')).toBeInTheDocument();
  });

  // The list used to close as soon as a tag was picked. Because the input keeps
  // focus, `onFocus` could not fire again, so the only way back to the list was
  // to click away and click back -- reported as the field "sticking".
  it('should keep the suggestion list open after picking a tag', async () => {
    const { user, input } = await openTagInput();

    await user.click(screen.getByText('Aggro'));

    expect(screen.getByText('Midrange')).toBeInTheDocument();
    expect(document.activeElement).toBe(input);
  });

  it('should pick a second suggestion without refocusing the field', async () => {
    const { user } = await openTagInput();

    await user.click(screen.getByText('Aggro'));
    await user.click(screen.getByText('Midrange'));

    // Both are now chips, and neither is offered again.
    expect(screen.getByText('Aggro')).toBeInTheDocument();
    expect(screen.getByText('Midrange')).toBeInTheDocument();
    expect(screen.queryAllByText('Aggro')).toHaveLength(1);
    expect(screen.queryAllByText('Midrange')).toHaveLength(1);
  });

  it('should add a typed tag on Enter and clear the field for the next one', async () => {
    const { user, input } = await openTagInput();

    await user.type(input, 'Indirect damage{Enter}');

    expect(screen.getByText('Indirect damage')).toBeInTheDocument();
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);

    await user.type(input, 'Sabotage{Enter}');
    expect(screen.getByText('Sabotage')).toBeInTheDocument();
  });

  it('should ignore a duplicate tag', async () => {
    const { user, input } = await openTagInput();

    await user.type(input, 'Aggro{Enter}');
    await user.type(input, 'Aggro{Enter}');

    expect(screen.queryAllByText('Aggro')).toHaveLength(1);
    expect(input.value).toBe('Aggro');
  });
});
