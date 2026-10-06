/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
vi.mock('../BatchesPanel', () => ({ default: ({ uid, refreshKey }) => <div>batches for {uid} #{refreshKey}</div> }));
vi.mock('../ListView', () => ({
  default: ({ list, onBack, onDeleted }) => (
    <div>
      viewing {list.name}
      <button type="button" onClick={onBack}>back</button>
      <button type="button" onClick={onDeleted}>deleted</button>
    </div>
  ),
}));
vi.mock('../WantsFromGaps', () => ({
  default: ({ onCreated }) => <button type="button" onClick={() => onCreated('w2')}>gaps-create</button>,
}));
import SavedListsPage from '../SavedListsPage';

const LISTS = {
  trade: [{ id: 't1', kind: 'trade', name: 'Binder dupes', items: { a: { qty: 4 } }, source: { type: 'surplus', label: 'Surplus' }, updatedAt: 1 }],
  wants: [{ id: 'w1', kind: 'wants', name: 'Gaps', items: {}, source: null, updatedAt: 1 }],
};
let service;
beforeEach(() => {
  localStorage.getItem.mockReset();
  localStorage.setItem.mockReset();
  service = {
    listLists: vi.fn(async (uid, kind) => ({ lists: LISTS[kind] })),
    getList: vi.fn(async (uid, id) => ({ list: { id, kind: 'wants', name: 'Fresh', items: {} } })),
    createList: vi.fn(async () => ({ id: 'w3' })),
  };
});
const open = (props) => render(<SavedListsPage uid="u1" collectionData={{}} batchesRefresh={2} onClose={vi.fn()} service={service} {...props} />);

describe('SavedListsPage', () => {
  it('opens on Batches by default and shows the batches panel', () => {
    open();
    expect(screen.getByRole('dialog', { name: 'Saved reports/lists' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Batches' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('batches for u1 #2')).toBeInTheDocument();
  });

  it('lists trade lists with their card count and remembers the tab', async () => {
    open();
    fireEvent.click(screen.getByRole('tab', { name: 'Trade lists' }));
    expect(await screen.findByText('Binder dupes')).toBeInTheDocument();
    expect(screen.getByText(/4 cards/)).toBeInTheDocument();
    expect(localStorage.setItem).toHaveBeenCalledWith('swu-saved-lists-tab', 'trade');
  });

  it('opens a list and comes back to the tab', async () => {
    open({ initialTab: 'trade' });
    fireEvent.click(await screen.findByText('Binder dupes'));
    expect(screen.getByText('viewing Binder dupes')).toBeInTheDocument();
    expect(document.getElementById('batch-report')).not.toBeNull();
    fireEvent.click(screen.getByText('back'));
    expect(await screen.findByText('Binder dupes')).toBeInTheDocument();
    expect(document.getElementById('batch-report')).toBeNull();
  });

  it('creates a wants list from gaps and opens it', async () => {
    open({ initialTab: 'wants' });
    fireEvent.click(await screen.findByRole('button', { name: 'New wants list' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fill gaps in my collection' }));
    fireEvent.click(screen.getByText('gaps-create'));
    expect(await screen.findByText('viewing Fresh')).toBeInTheDocument();
    expect(service.getList).toHaveBeenCalledWith('u1', 'w2');
  });

  it('creates an empty wants list and opens it', async () => {
    open({ initialTab: 'wants' });
    fireEvent.click(await screen.findByRole('button', { name: 'New wants list' }));
    fireEvent.click(screen.getByRole('button', { name: 'Empty list' }));
    expect(await screen.findByText('viewing Fresh')).toBeInTheDocument();
    expect(service.createList).toHaveBeenCalledWith('u1', { kind: 'wants', name: 'Wants list' });
  });

  it('explains how to make a trade list when there are none', async () => {
    service.listLists.mockResolvedValue({ lists: [] });
    open({ initialTab: 'trade' });
    expect(await screen.findByText(/Market reports → Surplus/)).toBeInTheDocument();
  });

  it('says when the lists cannot load', async () => {
    service.listLists.mockResolvedValue({ error: 'offline' });
    open({ initialTab: 'wants' });
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your lists");
  });
});
