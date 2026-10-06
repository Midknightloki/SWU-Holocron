/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';
vi.mock('../CardPickerModal', () => ({
  default: ({ onSelect }) => (
    <button type="button" onClick={() => onSelect({ Set: 'SOR', Number: '099', Name: 'Picked', Subtitle: '', Type: 'Unit' })}>pick-card</button>
  ),
}));
import ListView from '../ListView';

const item = (o) => ({ set: 'SOR', number: '010', name: 'Vader', subtitle: null, type: 'Unit', finish: 'any', qty: 2, ...o });
const LIST = {
  id: 'l1', kind: 'wants', name: 'Gaps', showPrices: true,
  items: { SOR_010_any: item(), SOR_010_standard: item({ finish: 'standard', qty: 1 }), SOR_020_any: item({ number: '020', name: 'Luke', qty: 1 }) },
};
let service;
const loadPrices = vi.fn(async () => ({ prices: { SOR_010_any: { market: 1.5 } } }));

const renderView = (list = LIST) => render(
  <ListView uid="u1" list={list} collectionData={{}} onBack={vi.fn()} onDeleted={vi.fn()} service={service} loadPrices={loadPrices} />,
);

beforeEach(() => {
  vi.clearAllMocks();
  service = { updateList: vi.fn(async () => ({ ok: true })), deleteList: vi.fn(async () => ({ ok: true })) };
});

describe('ListView', () => {
  it('shows rows, card count and value', async () => {
    renderView();
    expect(await screen.findByTestId('list-value')).toHaveTextContent('$3.00');
    expect(screen.getAllByTestId('list-row')).toHaveLength(3);
    expect(screen.getByTestId('list-cards')).toHaveTextContent('4');
  });

  it('changes a quantity and saves the items', async () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'More Luke' }));
    expect(service.updateList).toHaveBeenCalledWith('u1', 'l1', { items: expect.objectContaining({ SOR_020_any: expect.objectContaining({ qty: 2 }) }) });
  });

  it('removes a card', async () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Luke' }));
    expect(screen.getAllByTestId('list-row')).toHaveLength(2);
    expect(service.updateList.mock.calls[0][2].items.SOR_020_any).toBeUndefined();
  });

  it('merges lines when a finish change lands on an existing one', async () => {
    renderView();
    const [anyRow] = screen.getAllByTestId('list-row').filter((r) => within(r).queryByLabelText('Finish for Vader')?.value === 'any');
    fireEvent.change(within(anyRow).getByLabelText('Finish for Vader'), { target: { value: 'standard' } });
    const items = service.updateList.mock.calls[0][2].items;
    expect(items.SOR_010_any).toBeUndefined();
    expect(items.SOR_010_standard.qty).toBe(3);
  });

  it('renames on blur', async () => {
    renderView();
    const name = screen.getByLabelText('List name');
    fireEvent.change(name, { target: { value: 'My wants' } });
    fireEvent.blur(name);
    expect(service.updateList).toHaveBeenCalledWith('u1', 'l1', { name: 'My wants' });
  });

  it('saves a note on blur', async () => {
    renderView();
    const note = screen.getByLabelText('Note for Luke');
    fireEvent.change(note, { target: { value: 'any art' } });
    fireEvent.blur(note);
    expect(service.updateList.mock.calls[0][2].items.SOR_020_any.note).toBe('any art');
  });

  it('keeps an edit on screen and says so when the save fails', async () => {
    service.updateList.mockResolvedValue({ error: 'offline' });
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Luke' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save");
    expect(screen.getAllByTestId('list-row')).toHaveLength(2);
  });

  it('adds a card by search', async () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Add card' }));
    fireEvent.click(screen.getByText('pick-card'));
    expect(service.updateList.mock.calls[0][2].items.SOR_099_any).toMatchObject({ name: 'Picked', qty: 1 });
  });

  it('hides every dollar amount when prices are off, and saves the choice', async () => {
    renderView();
    await screen.findByTestId('list-value');
    fireEvent.click(screen.getByRole('button', { name: 'Show prices' }));
    expect(service.updateList).toHaveBeenCalledWith('u1', 'l1', { showPrices: false });
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it('copies the list as text without prices when they are off', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderView({ ...LIST, showPrices: false });
    fireEvent.click(screen.getByRole('button', { name: 'Copy as text' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toMatch(/^Wants: Gaps/);
    expect(writeText.mock.calls[0][0]).not.toContain('$');
  });

  it('deletes only on the second tap', async () => {
    const onDeleted = vi.fn();
    render(<ListView uid="u1" list={LIST} collectionData={{}} onBack={vi.fn()} onDeleted={onDeleted} service={service} loadPrices={loadPrices} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete list' }));
    expect(service.deleteList).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to delete' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(service.deleteList).toHaveBeenCalledWith('u1', 'l1');
  });

  it('prints the finish of wants lines (the picker is hidden in print)', async () => {
    renderView({ ...LIST, items: { SOR_010_foil: item({ finish: 'foil' }) } });
    expect(screen.getByTestId('print-finish')).toHaveTextContent('Foil');
  });

  it('has no finish picker or Add card on a trade list', async () => {
    renderView({ ...LIST, kind: 'trade', items: { SOR_010_standard: item({ finish: 'standard' }) } });
    expect(screen.queryByLabelText('Finish for Vader')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add card' })).not.toBeInTheDocument();
  });
});
