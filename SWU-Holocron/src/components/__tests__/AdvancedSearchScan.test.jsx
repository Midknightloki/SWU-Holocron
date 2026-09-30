/**
 * @vitest-environment happy-dom
 *
 * Only the scan-button wiring. The main AdvancedSearch suite is skipped for
 * async-initialisation timeouts (see TESTING.md); these assertions need nothing
 * from the card load, so they live here and run.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('../../services/CardService', () => ({
  CardService: {
    getSetRegistry: vi.fn(async () => []),
    fetchSetData: vi.fn(async () => ({ data: [] })),
    getCardImage: vi.fn(() => ''),
  },
}));

import AdvancedSearch from '../AdvancedSearch';

const base = { onCardClick: vi.fn(), collectionData: {}, currentSet: 'SOR', onClose: vi.fn() };

describe('AdvancedSearch scan button', () => {
  it('sits beside the search box when given onScan', () => {
    const onScan = vi.fn();
    render(<AdvancedSearch {...base} onScan={onScan} />);
    fireEvent.click(screen.getByRole('button', { name: 'Scan cards' }));
    expect(onScan).toHaveBeenCalled();
  });

  it('is absent without onScan', () => {
    render(<AdvancedSearch {...base} />);
    expect(screen.queryByRole('button', { name: 'Scan cards' })).not.toBeInTheDocument();
  });

  it('is absent when embedded in the DeckBuilder', () => {
    render(<AdvancedSearch {...base} embedded onScan={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Scan cards' })).not.toBeInTheDocument();
  });
});
