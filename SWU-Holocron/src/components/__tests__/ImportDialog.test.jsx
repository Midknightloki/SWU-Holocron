/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import ImportDialog from '../ImportDialog';

const ITEMS = [{ set: 'SOR', number: '010', name: 'Vader', quantity: 2, isFoil: false }];
const file = { name: 'box.csv', text: async () => 'csv' };
let importImpl; let onImported; let parse;
beforeEach(() => {
  importImpl = vi.fn(async () => ({ ok: true, cards: 2, lowered: 0, batchId: 'b1' }));
  onImported = vi.fn();
  parse = vi.fn(() => ({ items: ITEMS, errors: ['row 3: no number'] }));
});
const open = (o = {}) => render(
  <ImportDialog file={file} uid="u1" collectionRef={{ id: 'r' }} collectionData={{}} onClose={vi.fn()} onImported={onImported}
    importImpl={importImpl} parse={parse} {...o} />,
);

describe('ImportDialog', () => {
  it('shows what the file holds and asks how to import', async () => {
    open();
    expect(await screen.findByText(/2 cards in 1 row/)).toBeInTheDocument();
    expect(screen.getByText(/1 row skipped/)).toBeInTheDocument();
    expect(screen.getByLabelText('Batch name')).toHaveValue('Import box');
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });

  it('imports as a batch and hands over the report', async () => {
    open();
    await screen.findByText(/2 cards in 1 row/);
    fireEvent.click(screen.getByLabelText(/Add these cards/));
    fireEvent.change(screen.getByLabelText('Price paid'), { target: { value: '$12.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await vi.waitFor(() => expect(onImported).toHaveBeenCalledWith('b1'));
    expect(importImpl).toHaveBeenCalledWith(expect.objectContaining({
      uid: 'u1', items: ITEMS, mode: 'add', name: 'Import box', pricePaid: 12.5, file: 'box.csv',
    }));
  });

  it('says when nothing changed', async () => {
    importImpl.mockResolvedValue({ nothing: true });
    open();
    await screen.findByText(/2 cards in 1 row/);
    fireEvent.click(screen.getByLabelText(/Replace quantities/));
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Nothing changed');
  });

  it('warns about double-counting after a failed add', async () => {
    importImpl.mockResolvedValue({ error: 'offline', written: 5 });
    open();
    await screen.findByText(/2 cards in 1 row/);
    fireEvent.click(screen.getByLabelText(/Add these cards/));
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Import stopped after 5 cards: offline.');
    expect(alert).toHaveTextContent('Importing again will add those 5 again.');
  });

  it('imports without a report when there is no account to file it under', async () => {
    importImpl.mockResolvedValue({ ok: true, cards: 2, lowered: 0 });
    open({ uid: undefined });
    await screen.findByText(/2 cards in 1 row/);
    fireEvent.click(screen.getByLabelText(/Add these cards/));
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Imported 2 cards.');
    expect(onImported).not.toHaveBeenCalled();
  });

  it('cannot import an empty file', async () => {
    parse.mockReturnValue({ items: [], errors: [] });
    open();
    expect(await screen.findByText('No cards found in this file.')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Add these cards/));
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });
});
