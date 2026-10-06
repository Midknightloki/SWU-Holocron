/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import WantsFromGaps from '../WantsFromGaps';

const REGISTRY = [
  { code: 'SOR', name: 'Spark of Rebellion', isBaseSet: true },
  { code: 'SHD', name: 'Shadows of the Galaxy', isBaseSet: true },
  { code: 'SOROP', name: 'SOR promos', isBaseSet: false },
  { code: 'PROMO', name: 'Promo', isBaseSet: false },
];
const ITEMS = { SOR_050_any: { set: 'SOR', number: '050', name: 'Droid', subtitle: null, type: 'Unit', finish: 'any', qty: 1 } };
let service; let loadGaps; let onCreated;
beforeEach(() => {
  service = { createList: vi.fn(async () => ({ id: 'w9' })) };
  loadGaps = vi.fn(async () => ({ items: ITEMS, failedSets: [] }));
  onCreated = vi.fn();
});
const open = () => render(
  <WantsFromGaps uid="u1" collectionData={{}} onCreated={onCreated} onClose={vi.fn()} service={service} loadGaps={loadGaps} getRegistry={async () => REGISTRY} />,
);

describe('WantsFromGaps', () => {
  it('lists real sets only and needs one picked', async () => {
    open();
    expect(await screen.findByLabelText('Spark of Rebellion')).toBeInTheDocument();
    expect(screen.queryByLabelText('Promo')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create list' })).toBeDisabled();
  });

  it('creates a playset wants list from the picked sets', async () => {
    open();
    fireEvent.click(await screen.findByLabelText('Spark of Rebellion'));
    fireEvent.click(screen.getByLabelText('Up to a playset'));
    fireEvent.click(screen.getByRole('button', { name: 'Create list' }));
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith('w9'));
    expect(loadGaps).toHaveBeenCalledWith(['SOR'], {}, { mode: 'playset' });
    expect(service.createList).toHaveBeenCalledWith('u1', {
      kind: 'wants', name: 'Wants: playsets', items: ITEMS, source: { type: 'gaps', label: 'playsets in SOR' },
    });
  });

  it('says so when there are no gaps, and creates nothing', async () => {
    loadGaps.mockResolvedValue({ items: {}, failedSets: [] });
    open();
    fireEvent.click(await screen.findByLabelText('Spark of Rebellion'));
    fireEvent.click(screen.getByRole('button', { name: 'Create list' }));
    expect(await screen.findByRole('status')).toHaveTextContent('you own every title');
    expect(service.createList).not.toHaveBeenCalled();
  });

  it('names sets that would not load, then opens the list', async () => {
    loadGaps.mockResolvedValue({ items: ITEMS, failedSets: ['SHD'] });
    open();
    fireEvent.click(await screen.findByLabelText('Spark of Rebellion'));
    fireEvent.click(screen.getByLabelText('Shadows of the Galaxy'));
    fireEvent.click(screen.getByRole('button', { name: 'Create list' }));
    expect(await screen.findByRole('status')).toHaveTextContent("Couldn't load SHD");
    fireEvent.click(screen.getByRole('button', { name: 'Open list' }));
    expect(onCreated).toHaveBeenCalledWith('w9');
  });
});
