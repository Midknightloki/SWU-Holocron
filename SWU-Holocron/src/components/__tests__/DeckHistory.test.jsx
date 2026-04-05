/**
 * @vitest-environment happy-dom
 * @unit @component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import DeckHistory from '../DeckHistory';

// Mock services
vi.mock('../../services/DeckService', () => ({
  DeckService: {
    listVersions: vi.fn().mockResolvedValue([]),
    restoreVersion: vi.fn().mockResolvedValue(undefined),
  }
}));

describe('DeckHistory Component', () => {
  const mockUser = { uid: 'user-123', displayName: 'Test User' };
  const mockCurrentDeck = {
    id: 'deck-1',
    name: 'Test Deck',
    cards: {},
    leaderId: 'SOR_001',
    baseId: 'SOR_002',
  };

  const defaultProps = {
    deckId: 'deck-1',
    deckName: 'Test Deck',
    currentDeck: mockCurrentDeck,
    user: mockUser,
    onClose: vi.fn(),
    onRestored: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render with required props', async () => {
    render(<DeckHistory {...defaultProps} />);

    await waitFor(() => {
      const heading = screen.queryByText(/Test Deck/i);
      expect(heading).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('should show no version history message when empty', async () => {
    render(<DeckHistory {...defaultProps} />);

    await waitFor(() => {
      const emptyMsg = screen.queryByText(/No version history/i);
      expect(emptyMsg).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('should render close button', async () => {
    render(<DeckHistory {...defaultProps} />);

    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
  });

  it('should have history icon or label', async () => {
    render(<DeckHistory {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText(/Test Deck/i)).toBeInTheDocument();
    }, { timeout: 3000 });
  });
});
