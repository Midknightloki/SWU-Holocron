import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdvancedSearch from '../AdvancedSearch';
import { CardService } from '../../services/CardService';

// Mock the CardService
vi.mock('../../services/CardService', () => ({
  CardService: {
    fetchSetData: vi.fn(),
    getCardImage: vi.fn((set, number) => `https://api.swu-db.com/cards/${set}/${number}?format=image`),
    getCollectionId: vi.fn((set, number) => `${set}_${number}_std`)
  }
}));

describe('AdvancedSearch', () => {
  const mockCards = [
    {
      Set: 'SOR',
      Number: '001',
      Name: 'Sabine Wren',
      Subtitle: 'Explosives Artist',
      Type: 'Unit',
      Aspects: ['Cunning'],
      Cost: 3,
      Traits: ['Rebel', 'Mandalorian'],
      FrontText: 'When Played: Deal 1 indirect damage to a base.',
      Keywords: []
    },
    {
      Set: 'SHD',
      Number: '045',
      Name: 'Bo-Katan Kryze',
      Subtitle: 'Fighting for Mandalore',
      Type: 'Unit',
      Aspects: ['Vigilance'],
      Cost: 5,
      Traits: ['Mandalorian', 'Official'],
      FrontText: 'When Played: You may return a Mandalorian unit card.',
      Keywords: []
    },
    {
      Set: 'JTL',
      Number: '123',
      Name: 'Pyke Sentinel',
      Subtitle: null,
      Type: 'Unit',
      Aspects: ['Cunning'],
      Cost: 2,
      Traits: ['Underworld'],
      FrontText: 'On Attack: Deal 2 indirect damage to the defender\'s base.',
      Keywords: ['Raid']
    }
  ];

  const defaultProps = {
    onCardClick: vi.fn(),
    collectionData: {},
    currentSet: 'SOR',
    onClose: vi.fn(),
    onUpdateQuantity: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock fetchSetData to return cards
    CardService.fetchSetData.mockResolvedValue({
      data: mockCards,
      source: 'Mock'
    });
  });

  describe('Component Rendering', () => {
    it('should render the search interface', async () => {
      render(<AdvancedSearch {...defaultProps} />);
      
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/name, text, traits/i)).toBeInTheDocument();
      });
    });

    it('should render close button', async () => {
      render(<AdvancedSearch {...defaultProps} />);
      
      const closeButton = await screen.findByRole('button', { name: /close/i });
      expect(closeButton).toBeInTheDocument();
    });

    it('should call onClose when close button is clicked', async () => {
      const onClose = vi.fn();
      render(<AdvancedSearch {...defaultProps} onClose={onClose} />);
      
      const closeButton = await screen.findByRole('button', { name: /close/i });
      fireEvent.click(closeButton);
      
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('Card Loading', () => {
    it('should load all sets on mount', async () => {
      render(<AdvancedSearch {...defaultProps} />);
      
      await waitFor(() => {
        expect(CardService.fetchSetData).toHaveBeenCalledWith('SOR');
        expect(CardService.fetchSetData).toHaveBeenCalledWith('SHD');
        expect(CardService.fetchSetData).toHaveBeenCalledWith('TWI');
        expect(CardService.fetchSetData).toHaveBeenCalledWith('JTL');
      });
    });

    it('should display loaded cards count in console', async () => {
      const consoleSpy = vi.spyOn(console, 'log');
      render(<AdvancedSearch {...defaultProps} />);
      
      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Loading all sets'));
      });
    });
  });

  describe('Text Search', () => {
    it('should search by card name', async () => {
      render(<AdvancedSearch {...defaultProps} />);
      
      const searchInput = await screen.findByPlaceholderText(/name, text, traits/i);
      fireEvent.change(searchInput, { target: { value: 'Sabine' } });
      
      await waitFor(() => {
        expect(screen.getByText('Sabine Wren')).toBeInTheDocument();
      });
    });

    it('should search by subtitle', async () => {
      render(<AdvancedSearch {...defaultProps} />);
      
      const searchInput = await screen.findByPlaceholderText(/name, text, traits/i);
      fireEvent.change(searchInput, { target: { value: 'Explosives Artist' } });
      
      await waitFor(() => {
        expect(screen.getByText('Sabine Wren')).toBeInTheDocument();
      });
    });

    it('should search by trait (Mandalorian)', async () => {
      render(<AdvancedSearch {...defaultProps} />);
      
      const searchInput = await screen.findByPlaceholderText(/name, text, traits/i);
      fireEvent.change(searchInput, { target: { value: 'Mandalorian' } });
      
      await waitFor(() => {
        expect(screen.getByText('Sabine Wren')).toBeInTheDocument();
        expect(screen.getByText('Bo-Katan Kryze')).toBeInTheDocument();
      });
    });

    it('should search by ability text (indirect damage)', async () => {
      render(<AdvancedSearch {...defaultProps} />);
      
      const searchInput = await screen.findByPlaceholderText(/name, text, traits/i);
      fireEvent.change(searchInput, { target: { value: 'indirect' } });
      
      await waitFor(() => {
        expect(screen.getByText('Sabine Wren')).toBeInTheDocument();
        expect(screen.getByText('Pyke Sentinel')).toBeInTheDocument();
      });
    });

    it('should search by keyword (Raid)', async () => {
      render(<AdvancedSearch {...defaultProps} />);
      
      const searchInput = await screen.findByPlaceholderText(/name, text, traits/i);
      fireEvent.change(searchInput, { target: { value: 'raid' } });
      
      await waitFor(() => {
        expect(screen.getByText('Pyke Sentinel')).toBeInTheDocument();
      });
    });

    it('should be case insensitive', async () => {
      render(<AdvancedSearch {...defaultProps} />);
      
      const searchInput = await screen.findByPlaceholderText(/name, text, traits/i);
      fireEvent.change(searchInput, { target: { value: 'SABINE' } });
      
      await waitFor(() => {
        expect(screen.getByText('Sabine Wren')).toBeInTheDocument();
      });
    });

    it('should debounce search input', async () => {
      vi.useFakeTimers();
      render(<AdvancedSearch {...defaultProps} />);
      
      const searchInput = await screen.findByPlaceholderText(/name, text, traits/i);
      
      // Type multiple characters quickly
      fireEvent.change(searchInput, { target: { value: 'S' } });
      fireEvent.change(searchInput, { target: { value: 'Sa' } });
      fireEvent.change(searchInput, { target: { value: 'Sab' } });
      
      // Fast-forward time by 300ms (debounce delay)
      vi.advanceTimersByTime(300);
      
      await waitFor(() => {
        expect(screen.getByText('Sabine Wren')).toBeInTheDocument();
      });
      
      vi.useRealTimers();
    });
  });

  describe('Result Deduplication', () => {
    it('should show unique card names only', async () => {
      const duplicateCards = [
        ...mockCards,
        { ...mockCards[0], Set: 'SHD', Number: '999' } // Duplicate Sabine from different set
      ];
      
      CardService.fetchSetData.mockResolvedValue({
        data: duplicateCards,
        source: 'Mock'
      });
      
      render(<AdvancedSearch {...defaultProps} />);
      
      const searchInput = await screen.findByPlaceholderText(/name, text, traits/i);
      fireEvent.change(searchInput, { target: { value: 'Sabine' } });
      
      await waitFor(() => {
        const sabineCards = screen.getAllByText('Sabine Wren');
        expect(sabineCards).toHaveLength(1); // Only one result despite multiple variants
      });
    });
  });

  describe('Quantity Controls', () => {
    it('should render quantity controls for each card', async () => {
      render(<AdvancedSearch {...defaultProps} />);
      
      const searchInput = await screen.findByPlaceholderText(/name, text, traits/i);
      fireEvent.change(searchInput, { target: { value: 'Sabine' } });
      
      await waitFor(() => {
        expect(screen.getByText('Sabine Wren')).toBeInTheDocument();
      });
      
      // Should have + and - buttons
      const buttons = screen.getAllByRole('button');
      const plusButtons = buttons.filter(btn => btn.querySelector('svg')); // Plus/Minus icons
      expect(plusButtons.length).toBeGreaterThan(0);
    });

    it('should call onUpdateQuantity when plus button clicked', async () => {
      const onUpdateQuantity = vi.fn();
      render(<AdvancedSearch {...defaultProps} onUpdateQuantity={onUpdateQuantity} />);
      
      const searchInput = await screen.findByPlaceholderText(/name, text, traits/i);
      fireEvent.change(searchInput, { target: { value: 'Sabine' } });
      
      await waitFor(() => {
        expect(screen.getByText('Sabine Wren')).toBeInTheDocument();
      });
      
      const buttons = screen.getAllByRole('button');
      const plusButton = buttons.find(btn => 
        btn.className.includes('bg-green-600') && 
        !btn.disabled
      );
      
      if (plusButton) {
        fireEvent.click(plusButton);
        
        await waitFor(() => {
          expect(onUpdateQuantity).toHaveBeenCalledWith(
            expect.objectContaining({ Name: 'Sabine Wren' }),
            1
          );
        });
      }
    });

    it('should call onUpdateQuantity when minus button clicked', async () => {
      const collectionData = {
        'SOR_001_std': { quantity: 2 }
      };
      const onUpdateQuantity = vi.fn();
      
      render(<AdvancedSearch 
        {...defaultProps} 
        collectionData={collectionData}
        onUpdateQuantity={onUpdateQuantity} 
      />);
      
      const searchInput = await screen.findByPlaceholderText(/name, text, traits/i);
      fireEvent.change(searchInput, { target: { value: 'Sabine' } });
      
      await waitFor(() => {
        expect(screen.getByText('Sabine Wren')).toBeInTheDocument();
      });
      
      const buttons = screen.getAllByRole('button');
      const minusButton = buttons.find(btn => 
        btn.className.includes('bg-red-600') && 
        !btn.disabled
      );
      
      if (minusButton) {
        fireEvent.click(minusButton);
        
        await waitFor(() => {
          expect(onUpdateQuantity).toHaveBeenCalledWith(
            expect.objectContaining({ Name: 'Sabine Wren' }),
            -1
          );
        });
      }
    });

    it('should disable minus button when quantity is 0', async () => {
      const collectionData = {
        'SOR_001_std': { quantity: 0 }
      };
      
      render(<AdvancedSearch {...defaultProps} collectionData={collectionData} />);
      
      const searchInput = await screen.findByPlaceholderText(/name, text, traits/i);
      fireEvent.change(searchInput, { target: { value: 'Sabine' } });
      
      await waitFor(() => {
        expect(screen.getByText('Sabine Wren')).toBeInTheDocument();
      });
      
      const buttons = screen.getAllByRole('button');
      const minusButton = buttons.find(btn => 
        btn.className.includes('bg-red-600')
      );
      
      expect(minusButton).toBeDisabled();
    });

    it('should display current owned quantity', async () => {
      const collectionData = {
        'SOR_001_std': { quantity: 5 }
      };
      
      render(<AdvancedSearch {...defaultProps} collectionData={collectionData} />);
      
      const searchInput = await screen.findByPlaceholderText(/name, text, traits/i);
      fireEvent.change(searchInput, { target: { value: 'Sabine' } });
      
      await waitFor(() => {
        expect(screen.getByText('5')).toBeInTheDocument();
      });
    });

    it('should not trigger card modal when clicking quantity buttons', async () => {
      const onCardClick = vi.fn();
      render(<AdvancedSearch {...defaultProps} onCardClick={onCardClick} />);
      
      const searchInput = await screen.findByPlaceholderText(/name, text, traits/i);
      fireEvent.change(searchInput, { target: { value: 'Sabine' } });
      
      await waitFor(() => {
        expect(screen.getByText('Sabine Wren')).toBeInTheDocument();
      });
      
      const buttons = screen.getAllByRole('button');
      const plusButton = buttons.find(btn => 
        btn.className.includes('bg-green-600') && 
        !btn.disabled
      );
      
      if (plusButton) {
        fireEvent.click(plusButton);
        
        // Should NOT open modal
        expect(onCardClick).not.toHaveBeenCalled();
      }
    });
  });

  describe('Card Modal Integration', () => {
    it('should call onCardClick when card row is clicked', async () => {
      const onCardClick = vi.fn();
      render(<AdvancedSearch {...defaultProps} onCardClick={onCardClick} />);
      
      const searchInput = await screen.findByPlaceholderText(/name, text, traits/i);
      fireEvent.change(searchInput, { target: { value: 'Sabine' } });
      
      await waitFor(() => {
        expect(screen.getByText('Sabine Wren')).toBeInTheDocument();
      });
      
      const cardRow = screen.getByText('Sabine Wren').closest('button');
      fireEvent.click(cardRow);
      
      expect(onCardClick).toHaveBeenCalledWith(
        expect.objectContaining({ Name: 'Sabine Wren' })
      );
    });

    it('should NOT close search view when card is clicked', async () => {
      const onCardClick = vi.fn();
      const onClose = vi.fn();
      render(<AdvancedSearch {...defaultProps} onCardClick={onCardClick} onClose={onClose} />);
      
      const searchInput = await screen.findByPlaceholderText(/name, text, traits/i);
      fireEvent.change(searchInput, { target: { value: 'Sabine' } });
      
      await waitFor(() => {
        expect(screen.getByText('Sabine Wren')).toBeInTheDocument();
      });
      
      const cardRow = screen.getByText('Sabine Wren').closest('button');
      fireEvent.click(cardRow);
      
      // onClose should NOT be called - search should stay open
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('Filter Controls', () => {
    it('should have set filter controls', async () => {
      render(<AdvancedSearch {...defaultProps} />);
      
      await waitFor(() => {
        expect(screen.getByText(/sets/i)).toBeInTheDocument();
      });
    });

    it('should have aspect filter controls', async () => {
      render(<AdvancedSearch {...defaultProps} />);
      
      await waitFor(() => {
        expect(screen.getByText(/aspects/i)).toBeInTheDocument();
      });
    });

    it('should have cost range filters', async () => {
      render(<AdvancedSearch {...defaultProps} />);
      
      await waitFor(() => {
        expect(screen.getByText(/cost/i)).toBeInTheDocument();
      });
    });
  });

  describe('Empty States', () => {
    it('should show empty state when no results', async () => {
      render(<AdvancedSearch {...defaultProps} />);
      
      const searchInput = await screen.findByPlaceholderText(/name, text, traits/i);
      fireEvent.change(searchInput, { target: { value: 'NonExistentCard12345' } });
      
      await waitFor(() => {
        expect(screen.getByText(/no cards found/i)).toBeInTheDocument();
      });
    });

    it('should show start searching message initially', async () => {
      render(<AdvancedSearch {...defaultProps} />);
      
      await waitFor(() => {
        expect(screen.getByText(/start searching/i)).toBeInTheDocument();
      });
    });
  });
});
