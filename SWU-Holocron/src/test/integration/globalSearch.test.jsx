import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdvancedSearch from '../../components/AdvancedSearch';
import { CardService } from '../../services/CardService';

// Mock CardService
vi.mock('../../services/CardService', () => ({
  CardService: {
    fetchSetData: vi.fn(),
    getCollectionId: vi.fn((set, number) => `${set}-${number}`),
    getCardImage: vi.fn((set, image) => `/images/${set}/${image}`),
  }
}));

const mockCards = {
  SOR: [
    { Set: 'SOR', Number: '001', Name: 'Luke Skywalker', Subtitle: 'Jedi Knight', Type: 'Unit', Cost: 7, Aspects: ['Heroism'], Traits: ['Jedi', 'Force'], FrontText: 'When played: Draw a card', FrontImage: 'luke.jpg' },
    { Set: 'SOR', Number: '002', Name: 'Han Solo', Subtitle: 'Reluctant Hero', Type: 'Unit', Cost: 6, Aspects: ['Cunning'], Traits: ['Smuggler'], FrontText: 'Ambush', FrontImage: 'han.jpg' },
  ],
  JTL: [
    { Set: 'JTL', Number: '017', Name: 'Han Solo', Subtitle: 'Audacious Smuggler', Type: 'Unit', Cost: 5, Aspects: ['Cunning'], Traits: ['Smuggler'], FrontText: 'Smuggle', FrontImage: 'han-jtl.jpg' },
    { Set: 'JTL', Number: '045', Name: 'Leia Organa', Subtitle: 'Alliance General', Type: 'Leader', Cost: 0, Aspects: ['Command'], Traits: ['Official'], FrontText: 'Deploy ready', FrontImage: 'leia.jpg' },
  ],
  SHD: [
    { Set: 'SHD', Number: '023', Name: 'Lando Calrissian', Subtitle: 'Smooth Operator', Type: 'Unit', Cost: 4, Aspects: ['Cunning'], Traits: ['Scoundrel'], FrontText: 'Exhaust a unit', FrontImage: 'lando.jpg' },
  ]
};

describe('Advanced Search Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    CardService.fetchSetData.mockImplementation((setCode) => {
      return Promise.resolve({ data: mockCards[setCode] || [] });
    });
  });

  describe('Component Rendering', () => {
    it('should render overlay with header and search input', async () => {
      render(
        <AdvancedSearch 
          onCardClick={vi.fn()}
          collectionData={{}}
          currentSet="SOR"
        />
      );
      
      expect(screen.getByRole('heading', { name: /Advanced Search/i })).toBeInTheDocument();
      expect(await screen.findByPlaceholderText(/name, text, traits/i)).toBeInTheDocument();
    });

    it('should call onClose when Close is clicked', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(
        <AdvancedSearch 
          onCardClick={vi.fn()}
          collectionData={{}}
          currentSet="SOR"
          onClose={onClose}
        />
      );
      
      const closeButton = await screen.findByRole('button', { name: /close/i });
      await user.click(closeButton);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('Text Search', () => {
    it('should search across card names', async () => {
      const user = userEvent.setup();
      render(
        <AdvancedSearch 
          onCardClick={vi.fn()}
          collectionData={{}}
          currentSet="SOR"
        />
      );
      
      const searchInput = await screen.findByPlaceholderText(/name, text, traits/i);
      await user.type(searchInput, 'Han Solo');
      
      await waitFor(() => {
        expect(screen.getAllByText('Han Solo').length).toBeGreaterThan(0);
      });
    });

    it('should search across subtitles', async () => {
      const user = userEvent.setup();
      render(
        <AdvancedSearch 
          onCardClick={vi.fn()}
          collectionData={{}}
          currentSet="SOR"
        />
      );
      
      const searchInput = await screen.findByPlaceholderText(/name, text, traits/i);
      await user.type(searchInput, 'Smooth Operator');
      
      await waitFor(() => {
        expect(screen.getByText('Lando Calrissian')).toBeInTheDocument();
      });
    });

    it('should search across card text', async () => {
      const user = userEvent.setup();
      render(
        <AdvancedSearch 
          onCardClick={vi.fn()}
          collectionData={{}}
          currentSet="SOR"
        />
      );
      
      const searchInput = await screen.findByPlaceholderText(/name, text, traits/i);
      await user.type(searchInput, 'Ambush');
      
      await waitFor(() => {
        expect(screen.getAllByText('Han Solo').length).toBeGreaterThan(0);
      });
    });

    it('should search across traits', async () => {
      const user = userEvent.setup();
      render(
        <AdvancedSearch 
          onCardClick={vi.fn()}
          collectionData={{}}
          currentSet="SOR"
        />
      );
      
      const searchInput = await screen.findByPlaceholderText(/name, text, traits/i);
      await user.type(searchInput, 'Smuggler');
      
      await waitFor(() => {
        expect(screen.getAllByText('Han Solo').length).toBeGreaterThan(0);
      });
    });
  });

  describe('Set Filtering', () => {
    it('should filter by single set', async () => {
      const user = userEvent.setup();
      render(
        <AdvancedSearch 
          onCardClick={vi.fn()}
          collectionData={{}}
          currentSet="SOR"
        />
      );
      
      const searchInput = await screen.findByPlaceholderText(/name, text, traits/i);
      await user.type(searchInput, 'Han');
      const jtlButton = screen.getAllByRole('button', { name: 'JTL' })[0];
      await user.click(jtlButton);
      
      await waitFor(() => {
        expect(screen.getByText('1 Result')).toBeInTheDocument();
        expect(screen.getByText('Audacious Smuggler')).toBeInTheDocument();
      });
    });

    it('should filter by multiple sets', async () => {
      const user = userEvent.setup();
      render(
        <AdvancedSearch 
          onCardClick={vi.fn()}
          collectionData={{}}
          currentSet="SOR"
        />
      );
      
      const searchInput = await screen.findByPlaceholderText(/name, text, traits/i);
      await user.type(searchInput, 'Han');
      const sorButton = screen.getAllByRole('button', { name: 'SOR' })[0];
      const jtlButton = screen.getAllByRole('button', { name: 'JTL' })[0];
      await user.click(sorButton);
      await user.click(jtlButton);
      
      await waitFor(() => {
        expect(screen.getByText('2 Results')).toBeInTheDocument();
      });
    });
  });

  describe('Aspect Filtering', () => {
    it('should filter by aspect', async () => {
      const user = userEvent.setup();
      render(
        <AdvancedSearch 
          onCardClick={vi.fn()}
          collectionData={{}}
          currentSet="SOR"
        />
      );
      
      await waitFor(() => screen.getByText('Cunning'));
      
      await user.click(screen.getByText('Cunning'));
      
      await waitFor(() => {
        expect(screen.getAllByText('Han Solo').length).toBeGreaterThan(0);
        expect(screen.getByText('Lando Calrissian')).toBeInTheDocument();
      });
    });
  });

  describe('Type Filtering', () => {
    it('should filter by card type', async () => {
      const user = userEvent.setup();
      render(
        <AdvancedSearch 
          onCardClick={vi.fn()}
          collectionData={{}}
          currentSet="SOR"
        />
      );
      
      await waitFor(() => screen.getByText('Leader'));
      
      await user.click(screen.getByText('Leader'));
      
      await waitFor(() => {
        expect(screen.getByText('Leia Organa')).toBeInTheDocument();
      });
    });
  });

  describe('Cost Filtering', () => {
    it('should filter by minimum cost', async () => {
      const user = userEvent.setup();
      render(
        <AdvancedSearch 
          onCardClick={vi.fn()}
          collectionData={{}}
          currentSet="SOR"
        />
      );
      
      await waitFor(() => screen.getByPlaceholderText('Min'));
      
      await user.type(screen.getByPlaceholderText('Min'), '6');
      
      await waitFor(() => {
        expect(screen.getByText('Han Solo')).toBeInTheDocument();
        expect(screen.queryByText('Lando Calrissian')).not.toBeInTheDocument();
      });
    });

    it('should filter by maximum cost', async () => {
      const user = userEvent.setup();
      render(
        <AdvancedSearch 
          onCardClick={vi.fn()}
          collectionData={{}}
          currentSet="SOR"
        />
      );
      
      await waitFor(() => screen.getByPlaceholderText('Max'));
      
      await user.type(screen.getByPlaceholderText('Max'), '5');
      
      await waitFor(() => {
        expect(screen.getByText('Lando Calrissian')).toBeInTheDocument();
        expect(screen.queryByText('Luke Skywalker')).not.toBeInTheDocument();
      });
    });

    it('should filter by cost range', async () => {
      const user = userEvent.setup();
      render(
        <AdvancedSearch 
          onCardClick={vi.fn()}
          collectionData={{}}
          currentSet="SOR"
        />
      );
      
      await waitFor(() => screen.getByPlaceholderText('Min'));
      
      await user.type(screen.getByPlaceholderText('Min'), '4');
      await user.type(screen.getByPlaceholderText('Max'), '6');
      
      await waitFor(() => {
        expect(screen.getAllByText('Han Solo').length).toBeGreaterThan(0);
        expect(screen.getByText('Lando Calrissian')).toBeInTheDocument();
        expect(screen.queryByText('Luke Skywalker')).not.toBeInTheDocument();
      });
    });
  });

  describe('Combined Filters', () => {
    it('should apply multiple filters together', async () => {
      const user = userEvent.setup();
      render(
        <AdvancedSearch 
          onCardClick={vi.fn()}
          collectionData={{}}
          currentSet="SOR"
        />
      );
      
      const searchInput = await screen.findByPlaceholderText(/name, text, traits/i);
      await user.type(searchInput, 'Han');
      await user.click(screen.getByText('Cunning'));
      await user.type(screen.getByPlaceholderText('Max'), '5');
      
      await waitFor(() => {
        expect(screen.getByText('1 Result')).toBeInTheDocument();
        expect(screen.getByText('Audacious Smuggler')).toBeInTheDocument();
      });
    });
  });

  describe('Clear Filters', () => {
    it('should clear all filters when Clear All button is clicked', async () => {
      const user = userEvent.setup();
      render(
        <AdvancedSearch 
          onCardClick={vi.fn()}
          collectionData={{}}
          currentSet="SOR"
        />
      );
      
      await user.type(await screen.findByPlaceholderText(/name, text, traits/i), 'Han');
      await user.click(screen.getByText('Cunning'));
      
      await waitFor(() => screen.getByText('Clear All Filters'));
      await user.click(screen.getByText('Clear All Filters'));
      
      await waitFor(() => {
        expect(screen.getByPlaceholderText('Name, text, traits...')).toHaveValue('');
        expect(screen.queryByText('Clear All Filters')).not.toBeInTheDocument();
      });
    });
  });

  describe('Card Interaction', () => {
    it('should call onCardClick when card is clicked', async () => {
      const onCardClick = vi.fn();
      const user = userEvent.setup();
      render(
        <AdvancedSearch 
          onCardClick={onCardClick}
          collectionData={{}}
          currentSet="SOR"
        />
      );
      
      await user.type(await screen.findByPlaceholderText(/name, text, traits/i), 'Luke');
      
      await waitFor(() => screen.getByText('Luke Skywalker'));
      await user.click(screen.getByText('Luke Skywalker'));
      
      expect(onCardClick).toHaveBeenCalledWith(
        expect.objectContaining({ Name: 'Luke Skywalker' })
      );
    });

    it('should show owned quantity badge for owned cards', async () => {
      const user = userEvent.setup();
      render(
        <AdvancedSearch 
          onCardClick={vi.fn()}
          collectionData={{ 'SOR-001': { quantity: 3 } }}
          currentSet="SOR"
        />
      );
      
      await user.type(await screen.findByPlaceholderText(/name, text, traits/i), 'Luke');
      
      await waitFor(() => {
        expect(screen.getByText('3')).toBeInTheDocument();
      });
    });
  });

  describe('Performance', () => {
    it('should debounce search queries', async () => {
      const user = userEvent.setup();
      render(
        <AdvancedSearch 
          onCardClick={vi.fn()}
          collectionData={{}}
          currentSet="SOR"
        />
      );
      
      const searchInput = await screen.findByPlaceholderText(/name, text, traits/i);
      
      // Type quickly
      await user.type(searchInput, 'Han Solo', { delay: 1 });
      
      await waitFor(() => {
        expect(screen.getAllByText('Han Solo').length).toBeGreaterThan(0);
      }, { timeout: 500 });
    });

    it('should only load selected sets', async () => {
      const user = userEvent.setup();
      render(
        <AdvancedSearch 
          onCardClick={vi.fn()}
          collectionData={{}}
          currentSet="SOR"
        />
      );
      
      await waitFor(() => {
        expect(CardService.fetchSetData).toHaveBeenCalledWith('SOR');
        expect(CardService.fetchSetData).toHaveBeenCalledWith('JTL');
        expect(CardService.fetchSetData).toHaveBeenCalledWith('SHD');
      });
    });
  });
});
