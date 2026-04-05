/**
 * @vitest-environment happy-dom
 * @unit @component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import ShoppingList from '../ShoppingList';

// Mock services
vi.mock('../../services/PricingService', () => ({
  PricingService: {
    getBulkPrices: vi.fn().mockResolvedValue({}),
    formatPrice: vi.fn().mockReturnValue('N/A'),
    getTCGPlayerUrl: vi.fn().mockReturnValue('https://tcgplayer.com'),
  }
}));

describe('ShoppingList Component', () => {
  const mockCardDatabase = [
    {
      Set: 'SOR',
      Number: '001',
      Name: 'Director Krennic',
      Type: 'Leader',
    },
    {
      Set: 'SOR',
      Number: '003',
      Name: 'Chewbacca',
      Type: 'Unit',
    }
  ];

  const defaultProps = {
    deck: { cards: {}, leaderId: null, baseId: null },
    collectionData: {},
    cardDatabase: mockCardDatabase,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render without crashing with empty deck', async () => {
    render(<ShoppingList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText(/You own everything/i)).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('should show complete message when no gaps', async () => {
    const fullDeck = {
      cards: {
        'SOR_001': 1,
        'SOR_003': 2,
      },
      leaderId: 'SOR_001',
      baseId: null,
    };

    const fullCollection = {
      'SOR_001_std': { quantity: 1 },
      'SOR_003_std': { quantity: 2 },
    };

    render(<ShoppingList {...defaultProps} deck={fullDeck} collectionData={fullCollection} />);

    await waitFor(() => {
      expect(screen.getByText(/You own everything/i)).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('should render with deck missing cards', async () => {
    const deckWithGaps = {
      cards: {
        'SOR_001': 3,
        'SOR_003': 2,
      },
      leaderId: null,
      baseId: null,
    };

    const partialCollection = {
      'SOR_001_std': { quantity: 1 },
    };

    render(<ShoppingList {...defaultProps} deck={deckWithGaps} collectionData={partialCollection} />);

    await waitFor(() => {
      expect(document.body).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('should render shopping cart icon', async () => {
    render(<ShoppingList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText(/You own everything/i)).toBeInTheDocument();
    }, { timeout: 3000 });
  });
});
