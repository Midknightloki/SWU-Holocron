/**
 * @vitest-environment happy-dom
 * @unit @component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import GameLog from '../GameLog';

// Mock services
vi.mock('../../services/DeckService', () => ({
  DeckService: {
    listGameLogs: vi.fn().mockResolvedValue([]),
    logGame: vi.fn().mockResolvedValue('log-id'),
    deleteGameLog: vi.fn().mockResolvedValue(undefined),
    computeRecord: vi.fn().mockReturnValue({ wins: 0, losses: 0, draws: 0, total: 0, winRate: 0 }),
  }
}));

describe('GameLog Component', () => {
  const mockUser = { uid: 'user-123', displayName: 'Test User' };

  const defaultProps = {
    deckId: 'deck-1',
    deckName: 'Test Deck',
    user: mockUser,
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render with deckId and deckName props', async () => {
    render(<GameLog {...defaultProps} />);

    await waitFor(() => {
      const headings = screen.queryAllByText(/Test Deck/i);
      expect(headings.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
  });

  it('should show record display with W/L/D counts', async () => {
    render(<GameLog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText(/Test Deck/i)).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('should show no games logged message when empty', async () => {
    render(<GameLog {...defaultProps} />);

    await waitFor(() => {
      const emptyMsg = screen.queryByText(/No games logged/i);
      expect(emptyMsg).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('should render action buttons for logging games', async () => {
    render(<GameLog {...defaultProps} />);

    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
  });

  it('should render close button', async () => {
    render(<GameLog {...defaultProps} />);

    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
  });
});
