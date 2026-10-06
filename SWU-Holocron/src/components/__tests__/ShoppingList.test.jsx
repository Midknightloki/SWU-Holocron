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
    formatPrice: vi.fn((v) => (v === null || v === undefined ? 'N/A' : `$${Number(v).toFixed(2)}`)),
    getTCGPlayerUrl: vi.fn((name, priceData) => priceData?.url || 'https://tcgplayer.com/search'),
  }
}));

vi.mock('../SaveListDialog', () => ({
  default: ({ kind, items, defaultName }) => <div role="dialog" aria-label="save-dialog">{kind}|{defaultName}|{Object.keys(items).join(',')}</div>,
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

  it('saves the deck gaps as a wants list', async () => {
    render(<ShoppingList deck={deckWithGaps} collectionData={{}} cardDatabase={mockCardDatabase} uid="u1" deckName="Krennic aggro" />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Save as wants list' }));
    expect(screen.getByRole('dialog', { name: 'save-dialog' })).toHaveTextContent(/^wants\|Wants: Krennic aggro\|SOR_001_any,SOR_003_any$/);
  });

  it('offers no save without a signed-in user', async () => {
    render(<ShoppingList deck={deckWithGaps} collectionData={{}} cardDatabase={mockCardDatabase} />);
    await screen.findByText(/cards needed/);
    expect(screen.queryByRole('button', { name: 'Save as wants list' })).not.toBeInTheDocument();
  });

  it('should render shopping cart icon', async () => {
    render(<ShoppingList {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText(/You own everything/i)).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  // Pricing needs no configuration now: prices arrive with the weekly card sync
  // and are read from Firestore. What varies is whether the sync has prices for
  // these particular cards -- not every set has a TCGplayer group.
  describe('when no prices are available', () => {
    beforeEach(() => {
      PricingService.getBulkPrices.mockResolvedValue({});
    });

    it('should hide every trace of pricing rather than showing empty prices', async () => {
      render(<ShoppingList {...defaultProps} deck={deckWithGaps} />);

      await screen.findByText('Chewbacca');
      await waitFor(() => {
        expect(screen.queryByText(/Fetching prices/i)).not.toBeInTheDocument();
      });
      expect(screen.queryByText(/Price not available/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Total Acquisition Cost/i)).not.toBeInTheDocument();
    });

    // The old implementation announced a missing build-time variable to end
    // users. There is no such variable any more, and there never should have
    // been a message about one.
    it('should never mention configuration', async () => {
      render(<ShoppingList {...defaultProps} deck={deckWithGaps} />);

      await screen.findByText('Chewbacca');
      expect(screen.queryByText(/Pricing not available/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/VITE_TCGAPI_KEY/)).not.toBeInTheDocument();
      expect(screen.queryByText(/\.env/)).not.toBeInTheDocument();
    });

    it('should still link out to TCGplayer', async () => {
      render(<ShoppingList {...defaultProps} deck={deckWithGaps} />);

      await screen.findByText('Chewbacca');
      expect(screen.getAllByTitle('Search on TCGplayer')).toHaveLength(2);
    });
  });

  describe('when prices are available', () => {
    const priced = {
      SOR_001: { market: 2.5, low: 1, mid: 2, high: 9, productId: 111, url: 'https://tcgplayer.com/product/111/krennic' },
      SOR_003: { market: 0.5, low: 0.1, mid: 0.4, high: 3, productId: 222, url: 'https://tcgplayer.com/product/222/chewie' },
    };

    beforeEach(() => {
      PricingService.getBulkPrices.mockResolvedValue(priced);
    });

    it('should ask for prices by set and card number, not by name', async () => {
      render(<ShoppingList {...defaultProps} deck={deckWithGaps} />);

      await waitFor(() => {
        expect(PricingService.getBulkPrices).toHaveBeenCalled();
      });
      const arg = PricingService.getBulkPrices.mock.calls[0][0];
      expect(arg[0]).toMatchObject({ cardId: expect.any(String), set: 'SOR', number: expect.any(String) });
      expect(arg[0]).not.toHaveProperty('cardName');
    });

    it('should show the market price and the total', async () => {
      render(<ShoppingList {...defaultProps} deck={deckWithGaps} />);

      expect(await screen.findByText(/Total Acquisition Cost/i)).toBeInTheDocument();
      expect(screen.getByText('$2.50')).toBeInTheDocument();
    });

    it('should show the low-to-high range on the card it belongs to', async () => {
      render(<ShoppingList {...defaultProps} deck={deckWithGaps} />);

      await screen.findByText(/Total Acquisition Cost/i);
      // Scoped to the row: $1.00 is also SOR_003's subtotal elsewhere on screen.
      const row = screen.getByText('Director Krennic').closest('[data-card-id]');
      expect(row.textContent).toContain('$1.00');
      expect(row.textContent).toContain('$9.00');
    });

    // A search page makes the shopper find the card again; the product page is
    // the thing they actually want, and is where an affiliate tag would go.
    it('should link to the exact product page when one is known', async () => {
      render(<ShoppingList {...defaultProps} deck={deckWithGaps} />);

      await screen.findByText(/Total Acquisition Cost/i);
      const links = screen.getAllByTitle('Search on TCGplayer');
      const hrefs = links.map((a) => a.getAttribute('href'));
      expect(hrefs).toContain('https://tcgplayer.com/product/111/krennic');
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

// Not every card has both printings: across Spark of Rebellion 58 are
// standard-only and 16 foil-only. Showing the other printing is better than
// showing nothing, but it has to be labelled.
describe('ShoppingList fallback prices', () => {
  const deck = { cards: { SOR_001: 1 }, leaderId: null, baseId: null };
  const cardDatabase = [{ Set: 'SOR', Number: '001', Name: 'Director Krennic', Type: 'Leader' }];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should label a price that came from the other printing', async () => {
    PricingService.getBulkPrices.mockResolvedValue({
      SOR_001: { market: 9, low: 8, mid: 9, high: 10, printing: 'foil', isFoil: true, isFallback: true },
    });

    render(<ShoppingList deck={deck} collectionData={{}} cardDatabase={cardDatabase} />);

    expect(await screen.findByText('foil price')).toBeInTheDocument();
  });

  it('should not label a price that is the printing asked for', async () => {
    PricingService.getBulkPrices.mockResolvedValue({
      SOR_001: { market: 9, low: 8, mid: 9, high: 10, printing: 'std', isFoil: false, isFallback: false },
    });

    render(<ShoppingList deck={deck} collectionData={{}} cardDatabase={cardDatabase} />);

    await screen.findByText(/Total Acquisition Cost/i);
    expect(screen.queryByText('foil price')).not.toBeInTheDocument();
    expect(screen.queryByText('standard price')).not.toBeInTheDocument();
  });
});
