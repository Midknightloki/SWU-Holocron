/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import SaveListDialog from '../SaveListDialog';

const ITEMS = { SOR_010_any: { set: 'SOR', number: '010', name: 'V', subtitle: null, type: 'Unit', finish: 'any', qty: 2 } };
const EXISTING = { id: 'w1', kind: 'wants', name: 'Old', items: { SOR_010_any: { ...ITEMS.SOR_010_any, qty: 1 } } };
let service;
beforeEach(() => {
  service = {
    listLists: vi.fn(async () => ({ lists: [EXISTING] })),
    createList: vi.fn(async () => ({ id: 'n1' })),
    updateList: vi.fn(async () => ({ ok: true })),
  };
});
const open = (props) => render(
  <SaveListDialog uid="u1" kind="wants" items={ITEMS} source={{ type: 'deck', label: 'Vader deck' }} defaultName="Wants: Vader deck" onClose={vi.fn()} service={service} {...props} />,
);

describe('SaveListDialog', () => {
  it('creates a new list with the default name', async () => {
    open();
    await screen.findByLabelText('Add to “Old”');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved to “Wants: Vader deck”');
    expect(service.createList).toHaveBeenCalledWith('u1', { kind: 'wants', name: 'Wants: Vader deck', items: ITEMS, source: { type: 'deck', label: 'Vader deck' } });
  });

  it('creates the list with prices hidden when the report had them hidden', async () => {
    open({ showPrices: false });
    await screen.findByLabelText('Add to “Old”');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('status');
    expect(service.createList.mock.calls[0][1].showPrices).toBe(false);
  });

  it('adds into an existing wants list', async () => {
    open();
    fireEvent.click(await screen.findByLabelText('Add to “Old”'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('status');
    expect(service.updateList.mock.calls[0][2].items.SOR_010_any.qty).toBe(3);
  });

  it('replaces an existing trade list', async () => {
    service.listLists.mockResolvedValue({ lists: [{ ...EXISTING, kind: 'trade' }] });
    open({ kind: 'trade' });
    fireEvent.click(await screen.findByLabelText('Replace “Old”'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('status');
    expect(service.updateList.mock.calls[0][2].items.SOR_010_any.qty).toBe(2);
  });

  it('stays open with an error when saving fails', async () => {
    service.createList.mockResolvedValue({ error: 'offline' });
    open();
    await screen.findByLabelText('Add to “Old”');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save");
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('cannot save an empty list', async () => {
    open({ items: {} });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByText('Nothing to save.')).toBeInTheDocument();
  });
});
