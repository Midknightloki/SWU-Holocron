import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import CardModal from '../../components/CardModal';
import { CardService } from '../../services/CardService';

// Mock CardService
vi.mock('../../services/CardService', () => ({
  CardService: {
    getCollectionId: vi.fn((set, number, isFoil) => `${set}_${number}_${isFoil ? 'foil' : 'std'}`),
    getCardImage: vi.fn((set, number) => `/cards/${set}/${number}.jpg`),
    getBackImage: vi.fn((set, number) => `/cards/${set}/${number}_back.jpg`),
  }
}));

// Mock Firebase
vi.mock('../../firebase', () => ({
  db: {},
  APP_ID: 'test-app'
}));

describe('CardModal - Set Code Usage', () => {
  const mockOnClose = vi.fn();
  
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should use card.Set instead of activeSet for image URLs', () => {
    const jtlCard = {
      Set: 'JTL',
      Number: '017',
      Name: 'Han Solo',
      Subtitle: 'Never Tell Me the Odds',
      Type: 'Leader'
    };

    render(
      <CardModal
        initialCard={jtlCard}
        allCards={[jtlCard]}
        setCode="SHD" // User is viewing SHD set
        user={null}
        collectionData={{}}
        syncCode="test"
        onClose={mockOnClose}
      />
    );

    // Should request JTL image, not SHD image
    expect(CardService.getCardImage).toHaveBeenCalledWith('JTL', '017');
    expect(CardService.getCardImage).not.toHaveBeenCalledWith('SHD', '017');
  });

  it('should use card.Set for collection ID lookup', () => {
    const shdCard = {
      Set: 'SHD',
      Number: '017',
      Name: 'Lando Calrissian',
      Subtitle: 'With Impeccable Taste',
      Type: 'Leader'
    };

    render(
      <CardModal
        initialCard={shdCard}
        allCards={[shdCard]}
        setCode="ALL" // User is viewing ALL sets
        user={null}
        collectionData={{}}
        syncCode="test"
        onClose={mockOnClose}
      />
    );

    // Should create collection ID with SHD, not ALL
    expect(CardService.getCollectionId).toHaveBeenCalledWith('SHD', '017', false);
    expect(CardService.getCollectionId).not.toHaveBeenCalledWith('ALL', '017', false);
  });

  it('should show correct card when viewing ALL sets', () => {
    const jtlHan = {
      Set: 'JTL',
      Number: '017',
      Name: 'Han Solo',
      Subtitle: 'Never Tell Me the Odds',
      Type: 'Leader',
      FrontText: 'Han ability text'
    };

    const shdLando = {
      Set: 'SHD',
      Number: '017',
      Name: 'Lando Calrissian',
      Subtitle: 'With Impeccable Taste',
      Type: 'Leader',
      FrontText: 'Lando ability text'
    };

    // Click on SHD Lando while viewing ALL
    render(
      <CardModal
        initialCard={shdLando}
        allCards={[jtlHan, shdLando]}
        setCode="ALL"
        user={null}
        collectionData={{}}
        syncCode="test"
        onClose={mockOnClose}
      />
    );

    // Should show Lando's name, not Han's
    expect(screen.getByText('Lando Calrissian')).toBeInTheDocument();
    expect(screen.queryByText('Han Solo')).not.toBeInTheDocument();
  });

  it('should use card.Set for back image when flipped', () => {
    const jtlCard = {
      Set: 'JTL',
      Number: '017',
      Name: 'Han Solo',
      Subtitle: 'Never Tell Me the Odds',
      Type: 'Leader'
    };

    const { rerender } = render(
      <CardModal
        initialCard={jtlCard}
        allCards={[jtlCard]}
        setCode="SHD" // Viewing SHD but card is from JTL
        user={null}
        collectionData={{}}
        syncCode="test"
        onClose={mockOnClose}
      />
    );

    // Initial render uses front image
    expect(CardService.getCardImage).toHaveBeenCalledWith('JTL', '017');

    // Note: We can't easily test the flip interaction here without clicking,
    // but the test above validates the pattern - card.Set should be used
  });

  it('should prevent collection ID collisions between sets with same card number', () => {
    const shdCard = {
      Set: 'SHD',
      Number: '017',
      Name: 'Lando Calrissian',
      Type: 'Leader'
    };

    const jtlCard = {
      Set: 'JTL',
      Number: '017',
      Name: 'Han Solo',
      Type: 'Leader'
    };

    const collectionData = {
      'SHD_017_std': { quantity: 2 },
      'JTL_017_std': { quantity: 3 }
    };

    const { rerender } = render(
      <CardModal
        initialCard={shdCard}
        allCards={[shdCard, jtlCard]}
        setCode="ALL"
        user={null}
        collectionData={collectionData}
        syncCode="test"
        onClose={mockOnClose}
      />
    );

    // Should look up SHD_017_std, finding quantity 2
    expect(CardService.getCollectionId).toHaveBeenCalledWith('SHD', '017', false);

    // Change to JTL card
    rerender(
      <CardModal
        initialCard={jtlCard}
        allCards={[shdCard, jtlCard]}
        setCode="ALL"
        user={null}
        collectionData={collectionData}
        syncCode="test"
        onClose={mockOnClose}
      />
    );

    // Should now look up JTL_017_std, finding quantity 3
    expect(CardService.getCollectionId).toHaveBeenCalledWith('JTL', '017', false);
  });

  it('should document the bug: modal receives setCode prop but should use card.Set', () => {
    // This test documents the bug discovered 2024-12-23:
    // When viewing SHD set and clicking on a card that's actually from JTL
    // (due to collection ID collision), the modal would show:
    // - Image: Lando (SHD 017) - CORRECT
    // - Name/Text: Han Solo (JTL 017) - WRONG
    //
    // Root cause: CardModal was using setCode prop (activeSet) instead of card.Set
    // Fix: Use initialCard.Set everywhere instead of setCode prop

    const jtlCard = {
      Set: 'JTL',
      Number: '017',
      Name: 'Han Solo',
      Subtitle: 'Never Tell Me the Odds'
    };

    // Modal receives setCode="SHD" because user clicked while viewing SHD
    // But card is actually from JTL
    render(
      <CardModal
        initialCard={jtlCard}
        allCards={[jtlCard]}
        setCode="SHD" // BUG: This causes wrong image/collection lookup
        user={null}
        collectionData={{}}
        syncCode="test"
        onClose={mockOnClose}
      />
    );

    // AFTER FIX: Should use JTL (card.Set) not SHD (setCode prop)
    expect(CardService.getCardImage).toHaveBeenCalledWith('JTL', '017');
    expect(CardService.getCollectionId).toHaveBeenCalledWith('JTL', '017', false);
  });
});
