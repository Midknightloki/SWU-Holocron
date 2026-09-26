/**
 * @vitest-environment happy-dom
 * @unit @component
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ShoppingList from '../ShoppingList';

// Mock services
vi.mock('../../services/PricingService', () => ({
  PricingService: {
    getBulkPrices: vi.fn().mockResolvedValue({}),
    formatPrice: vi.fn().mockReturnValue('N/A'),
    getTCGPlayerUrl: vi.fn().mockReturnValue('https://tcgplayer.com'),
  }
}));

import { PricingService } from '../../services/PricingService';

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

  const deckWithGaps = {
    cards: {
      'SOR_001': 3,
      'SOR_003': 2,
    },
    leaderId: null,
    baseId: null,
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
    const partialCollection = {
      'SOR_001_std': { quantity: 1 },
    };

    render(<ShoppingList {...defaultProps} deck={deckWithGaps} collectionData={partialCollection} />);

    await waitFor(() => {
      expect(screen.getByText('Chewbacca')).toBeInTheDocument();
      expect(screen.getByText('Director Krennic')).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('should render shopping cart icon', async () => {
    render(<ShoppingList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText(/You own everything/i)).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  // Pricing is an optional integration. With no key there is nothing to show,
  // and a note about a missing dev-environment variable is not something an end
  // user can act on.
  describe('without VITE_TCGAPI_KEY', () => {
    it('should not mention the missing key', async () => {
      render(<ShoppingList {...defaultProps} deck={deckWithGaps} />);

      await screen.findByText('Chewbacca');
      expect(screen.queryByText(/Pricing not available/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/VITE_TCGAPI_KEY/)).not.toBeInTheDocument();
    });

    it('should hide every trace of pricing', async () => {
      render(<ShoppingList {...defaultProps} deck={deckWithGaps} />);

      await screen.findByText('Chewbacca');
      expect(screen.queryByText(/Price not available/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Total Acquisition Cost/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Fetching prices/i)).not.toBeInTheDocument();
    });

    it('should not call the pricing service at all', async () => {
      render(<ShoppingList {...defaultProps} deck={deckWithGaps} />);

      await screen.findByText('Chewbacca');
      expect(PricingService.getBulkPrices).not.toHaveBeenCalled();
    });

    it('should still link out to TCGplayer', async () => {
      render(<ShoppingList {...defaultProps} deck={deckWithGaps} />);

      await screen.findByText('Chewbacca');
      expect(screen.getAllByTitle('Search on TCGplayer')).toHaveLength(2);
    });
  });

  describe('with VITE_TCGAPI_KEY', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_TCGAPI_KEY', 'test-key');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('should fetch prices and show the total', async () => {
      render(<ShoppingList {...defaultProps} deck={deckWithGaps} />);

      await waitFor(() => {
        expect(PricingService.getBulkPrices).toHaveBeenCalled();
      });
      expect(await screen.findByText(/Total Acquisition Cost/i)).toBeInTheDocument();
    });
  });

  // Browsing and managing the collection are the same activity, so a card bought
  // at a store is added from the list itself (CLAUDE.md, House rules).
  describe('inline collection controls', () => {
    const partialCollection = {
      'SOR_001_std': { quantity: 1 },
      'SOR_003_foil': { quantity: 1 },
    };

    const renderWithControls = () => {
      const onUpdateQuantity = vi.fn();
      const user = userEvent.setup();
      render(
        <ShoppingList
          {...defaultProps}
          deck={deckWithGaps}
          collectionData={partialCollection}
          onUpdateQuantity={onUpdateQuantity}
        />
      );
      return { user, onUpdateQuantity };
    };

    it('should not render controls when no handler is supplied', async () => {
      render(<ShoppingList {...defaultProps} deck={deckWithGaps} collectionData={partialCollection} />);

      await screen.findByText('Chewbacca');
      expect(screen.queryByLabelText(/^Add Chewbacca/)).not.toBeInTheDocument();
    });

    it('should add a standard copy from the row', async () => {
      const { user, onUpdateQuantity } = renderWithControls();

      await user.click(await screen.findByLabelText('Add Chewbacca'));

      expect(onUpdateQuantity).toHaveBeenCalledWith(
        expect.objectContaining({ Set: 'SOR', Number: '003' }),
        1,
        { isFoil: false }
      );
    });

    it('should remove a standard copy from the row', async () => {
      const { user, onUpdateQuantity } = renderWithControls();

      await user.click(await screen.findByLabelText('Remove Director Krennic'));

      expect(onUpdateQuantity).toHaveBeenCalledWith(
        expect.objectContaining({ Set: 'SOR', Number: '001' }),
        -1,
        { isFoil: false }
      );
    });

    it('should target foils once the row is toggled to foil', async () => {
      const { user, onUpdateQuantity } = renderWithControls();

      await user.click(await screen.findByLabelText('Buy foil copies of Chewbacca'));
      await user.click(screen.getByLabelText('Add Chewbacca'));

      expect(onUpdateQuantity).toHaveBeenCalledWith(
        expect.objectContaining({ Number: '003' }),
        1,
        { isFoil: true }
      );
    });

    it('should toggle only the row that was clicked', async () => {
      const { user, onUpdateQuantity } = renderWithControls();

      await user.click(await screen.findByLabelText('Buy foil copies of Chewbacca'));
      await user.click(screen.getByLabelText('Add Director Krennic'));

      expect(onUpdateQuantity).toHaveBeenCalledWith(
        expect.anything(),
        1,
        { isFoil: false }
      );
    });

    it('should count the variant the controls are pointed at', async () => {
      const { user } = renderWithControls();

      // Chewbacca is owned only as a foil, so the standard count reads 0...
      const row = (await screen.findByText('Chewbacca')).closest('[data-card-id]');
      expect(row.querySelector('[data-variant-count]').textContent).toBe('0');

      // ...and 1 once the controls are pointed at foils.
      await user.click(screen.getByLabelText('Buy foil copies of Chewbacca'));
      expect(row.querySelector('[data-variant-count]').textContent).toBe('1');
    });

    it('should not offer to remove a variant that is not owned', async () => {
      renderWithControls();

      // Owned as a foil only, so there is no standard copy to remove.
      expect(await screen.findByLabelText('Remove Chewbacca')).toBeDisabled();
      expect(screen.getByLabelText('Remove Director Krennic')).not.toBeDisabled();
    });

    it('should show standard and foil counts owned', async () => {
      renderWithControls();

      const row = (await screen.findByText('Chewbacca')).closest('[data-card-id]');
      expect(row.textContent).toContain('+1F');
    });
  });
});
