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
    it('should render closed by default with button', () => {
      const { container } = render(
        <AdvancedSearch 
          onCardClick={vi.fn()}
          collectionData={{}}
          currentSet="SOR"
        />
      );
      
      expect(screen.getByText('Advanced Search')).toBeInTheDocument();
      expect(container.querySelector('.fixed')).not.toBeInTheDocument(); // Modal not open
    });

    it('should open modal when button is clicked', async () => {
      const user = userEvent.setup();
      render(
        <AdvancedSearch 
          onCardClick={vi.fn()}
          collectionData={{}}
          currentSet="SOR"
        />
      );
      
      await user.click(screen.getByText('Advanced Search'));
      
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Advanced Search/i })).toBeInTheDocument();
      });
    });

    it('should close modal when X button is clicked', async () => {
      const user = userEvent.setup();
      const { container } = render(
        <AdvancedSearch 
          onCardClick={vi.fn()}
          collectionData={{}}
          currentSet="SOR"
        />
      );
      
      await user.click(screen.getByText('Advanced Search'));
      await waitFor(() => screen.getByRole('heading', { name: /Advanced Search/i }));
      
      const closeButton = container.querySelector('button svg').closest('button');
      await user.click(closeButton);
      
      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: /Advanced Search/i })).not.toBeInTheDocument();
      });
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
      
      await user.click(screen.getByText('Advanced Search'));
      await waitFor(() => screen.getByPlaceholderText('Name, text, traits...'));
      
      const searchInput = screen.getByPlaceholderText('Name, text, traits...');
      await user.type(searchInput, 'Han Solo');
      
      await waitFor(() => {
        expect(screen.getByText('1 Result')).toBeInTheDocument();
        expect(screen.getByText('Han Solo')).toBeInTheDocument();
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
      
      await user.click(screen.getByText('Advanced Search'));
      await waitFor(() => screen.getByPlaceholderText('Name, text, traits...'));
      
      const searchInput = screen.getByPlaceholderText('Name, text, traits...');
      await user.type(searchInput, 'Smooth Operator');
      
      await waitFor(() => {
        expect(screen.getByText('1 Result')).toBeInTheDocument();
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
      
      await user.click(screen.getByText('Advanced Search'));
      await waitFor(() => screen.getByPlaceholderText('Name, text, traits...'));
      
      const searchInput = screen.getByPlaceholderText('Name, text, traits...');
      await user.type(searchInput, 'Ambush');
      
      await waitFor(() => {
        expect(screen.getByText('1 Result')).toBeInTheDocument();        expect(screen.getByText('Luke Skywalker')).toBeInTheDocument();      });
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
      
      await user.click(screen.getByText('Advanced Search'));
      await waitFor(() => screen.getByPlaceholderText('Name, text, traits...'));
      
      const searchInput = screen.getByPlaceholderText('Name, text, traits...');
      await user.type(searchInput, 'Smuggler');
      
      await waitFor(() => {
        expect(screen.getByText('2 Results')).toBeInTheDocument();        expect(screen.getByText('Han Solo')).toBeInTheDocument();      });
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
      
      await user.click(screen.getByText('Advanced Search'));
      await waitFor(() => screen.getAllByText('SOR')[1]); // Get the filter button, not the badge
      
      await user.type(screen.getByPlaceholderText('Name, text, traits...'), 'Han');
      await user.click(screen.getAllByText('JTL').find(el => el.tagName === 'BUTTON'));
      
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
      
      await user.click(screen.getByText('Advanced Search'));
      await waitFor(() => screen.getByPlaceholderText('Name, text, traits...'));
      
      await user.type(screen.getByPlaceholderText('Name, text, traits...'), 'Han');
      const setButtons = screen.getAllByText('SOR').filter(el => el.tagName === 'BUTTON');
      await user.click(setButtons[0]);
      await user.click(screen.getAllByText('JTL').find(el => el.tagName === 'BUTTON'));
      
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
      
      await user.click(screen.getByText('Advanced Search'));
      await waitFor(() => screen.getByText('Cunning'));
      
      await user.click(screen.getByText('Cunning'));
      
      await waitFor(() => {
        expect(screen.getByText('3 Results')).toBeInTheDocument();
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
      
      await user.click(screen.getByText('Advanced Search'));
      await waitFor(() => screen.getByText('Leader'));
      
      await user.click(screen.getByText('Leader'));
      
      await waitFor(() => {
        expect(screen.getByText('1 Result')).toBeInTheDocument();
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
      
      await user.click(screen.getByText('Advanced Search'));
      await waitFor(() => screen.getByPlaceholderText('Min'));
      
      await user.type(screen.getByPlaceholderText('Min'), '6');
      
      await waitFor(() => {
        expect(screen.getByText('2 Results')).toBeInTheDocument();
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
      
      await user.click(screen.getByText('Advanced Search'));
      await waitFor(() => screen.getByPlaceholderText('Max'));
      
      await user.type(screen.getByPlaceholderText('Max'), '5');
      
      await waitFor(() => {
        expect(screen.getByText('3 Results')).toBeInTheDocument();
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
      
      await user.click(screen.getByText('Advanced Search'));
      await waitFor(() => screen.getByPlaceholderText('Min'));
      
      await user.type(screen.getByPlaceholderText('Min'), '4');
      await user.type(screen.getByPlaceholderText('Max'), '6');
      
      await waitFor(() => {
        expect(screen.getByText('3 Results')).toBeInTheDocument();
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
      
      await user.click(screen.getByText('Advanced Search'));
      await waitFor(() => screen.getByPlaceholderText('Name, text, traits...'));
      
      await user.type(screen.getByPlaceholderText('Name, text, traits...'), 'Han');
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
      
      await user.click(screen.getByText('Advanced Search'));
      await waitFor(() => screen.getByPlaceholderText('Name, text, traits...'));
      
      await user.type(screen.getByPlaceholderText('Name, text, traits...'), 'Han');
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
      
      await user.click(screen.getByText('Advanced Search'));
      await waitFor(() => screen.getByPlaceholderText('Name, text, traits...'));
      
      await user.type(screen.getByPlaceholderText('Name, text, traits...'), 'Luke');
      
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
      
      await user.click(screen.getByText('Advanced Search'));
      await waitFor(() => screen.getByPlaceholderText('Name, text, traits...'));
      
      await user.type(screen.getByPlaceholderText('Name, text, traits...'), 'Luke');
      
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
      
      await user.click(screen.getByText('Advanced Search'));
      await waitFor(() => screen.getByPlaceholderText('Name, text, traits...'));
      
      const searchInput = screen.getByPlaceholderText('Name, text, traits...');
      
      // Type quickly
      await user.type(searchInput, 'Han Solo', { delay: 1 });
      
      // Should not show results immediately
      expect(screen.queryByText(/Results/)).not.toBeInTheDocument();
      
      // Should show results after debounce
      await waitFor(() => {
        expect(screen.getByText('2 Results')).toBeInTheDocument();
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
      
      await user.click(screen.getByText('Advanced Search'));
      await waitFor(() => screen.getByPlaceholderText('Name, text, traits...'));
      
      // Initially only current set should be loaded
      expect(CardService.fetchSetData).toHaveBeenCalledWith('SOR');
      expect(CardService.fetchSetData).toHaveBeenCalledTimes(1);
      
      // Select another set
      await user.click(screen.getAllByText('JTL').find(el => el.tagName === 'BUTTON'));
      
      await waitFor(() => {
        expect(CardService.fetchSetData).toHaveBeenCalledWith('JTL');
      });
    });
  });
});
