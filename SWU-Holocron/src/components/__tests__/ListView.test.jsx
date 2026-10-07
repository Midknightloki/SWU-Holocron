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
  <ListView uid="u1" list={list} collectionData={{}} onBack={vi.fn()} onDeleted={vi.fn()} service={service} loadPrices={loadPrices} saveDelay={0} />,
);

beforeEach(() => {
  vi.clearAllMocks();
  service = {
    updateList: vi.fn(async () => ({ ok: true })),
    deleteList: vi.fn(async () => ({ ok: true })),
    shareList: vi.fn(async () => ({ code: 'abcd2345' })),
    updatePublic: vi.fn(async () => ({ ok: true })),
    unshareList: vi.fn(async () => ({ ok: true })),
  };
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
    await waitFor(() => expect(service.updateList).toHaveBeenCalledWith('u1', 'l1', { items: expect.objectContaining({ SOR_020_any: expect.objectContaining({ qty: 2 }) }) }));
  });

  it('removes a card', async () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Luke' }));
    expect(screen.getAllByTestId('list-row')).toHaveLength(2);
    await waitFor(() => expect(service.updateList).toHaveBeenCalled());
    expect(service.updateList.mock.calls[0][2].items.SOR_020_any).toBeUndefined();
  });

  it('merges lines when a finish change lands on an existing one', async () => {
    renderView();
    const [anyRow] = screen.getAllByTestId('list-row').filter((r) => within(r).queryByLabelText('Finish for Vader')?.value === 'any');
    fireEvent.change(within(anyRow).getByLabelText('Finish for Vader'), { target: { value: 'standard' } });
    await waitFor(() => expect(service.updateList).toHaveBeenCalled());
    const items = service.updateList.mock.calls[0][2].items;
    expect(items.SOR_010_any).toBeUndefined();
    expect(items.SOR_010_standard.qty).toBe(3);
  });

  it('renames on blur', async () => {
    renderView();
    const name = screen.getByLabelText('List name');
    fireEvent.change(name, { target: { value: 'My wants' } });
    fireEvent.blur(name);
    await waitFor(() => expect(service.updateList).toHaveBeenCalledWith('u1', 'l1', { name: 'My wants' }));
  });

  it('saves a note on blur', async () => {
    renderView();
    const note = screen.getByLabelText('Note for Luke');
    fireEvent.change(note, { target: { value: 'any art' } });
    fireEvent.blur(note);
    await waitFor(() => expect(service.updateList).toHaveBeenCalled());
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
    await waitFor(() => expect(service.updateList).toHaveBeenCalled());
    expect(service.updateList.mock.calls[0][2].items.SOR_099_any).toMatchObject({ name: 'Picked', qty: 1 });
  });

  it('hides every dollar amount when prices are off, and saves the choice', async () => {
    renderView();
    await screen.findByTestId('list-value');
    fireEvent.click(screen.getByRole('button', { name: 'Show prices' }));
    await waitFor(() => expect(service.updateList).toHaveBeenCalledWith('u1', 'l1', { showPrices: false }));
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
    render(<ListView uid="u1" list={LIST} collectionData={{}} onBack={vi.fn()} onDeleted={onDeleted} service={service} loadPrices={loadPrices} saveDelay={0} />);
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

  it('shares the list and shows its link', async () => {
    renderView();
    await screen.findByTestId('list-value');
    fireEvent.click(screen.getByRole('button', { name: 'Share link' }));
    expect(await screen.findByLabelText('Share link')).toHaveValue(`${window.location.origin}/list/abcd2345`);
    const [uid, id, body] = service.shareList.mock.calls[0];
    expect([uid, id]).toEqual(['u1', 'l1']);
    expect(body).toMatchObject({ kind: 'wants', name: 'Gaps', showPrices: true, cards: 4 });
  });

  it('keeps a shared list current: every edit updates the public copy', async () => {
    renderView({ ...LIST, publicCode: 'abcd2345' });
    await waitFor(() => expect(service.updatePublic).toHaveBeenCalled());
    service.updatePublic.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'More Luke' }));
    await waitFor(() => expect(service.updatePublic).toHaveBeenCalled());
    const [, code, body] = service.updatePublic.mock.calls.at(-1);
    expect(code).toBe('abcd2345');
    expect(body.lines.find((l) => l.name === 'Luke').qty).toBe(2);
  });

  it('drops prices from the public copy when they are turned off', async () => {
    renderView({ ...LIST, publicCode: 'abcd2345' });
    await waitFor(() => expect(service.updatePublic).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Show prices' }));
    await waitFor(() => expect(service.updatePublic.mock.calls.at(-1)[2].showPrices).toBe(false));
    const body = service.updatePublic.mock.calls.at(-1)[2];
    expect(JSON.stringify(body)).not.toMatch(/unitPrice|pricesAsOf|"value"/);
  });

  it('says so quietly when the public copy could not be updated', async () => {
    service.updatePublic.mockResolvedValue({ error: 'timeout' });
    renderView({ ...LIST, publicCode: 'abcd2345' });
    expect(await screen.findByRole('status')).toHaveTextContent('Shared link not updated yet');
  });

  it('stops sharing only on the second tap', async () => {
    renderView({ ...LIST, publicCode: 'abcd2345' });
    fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));
    expect(service.unshareList).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to stop sharing' }));
    await screen.findByRole('button', { name: 'Share link' });
    expect(service.unshareList).toHaveBeenCalledWith('u1', 'l1', 'abcd2345');
  });

  it('deleting a shared list deletes its public copy', async () => {
    renderView({ ...LIST, publicCode: 'abcd2345' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete list' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to delete' }));
    await waitFor(() => expect(service.deleteList).toHaveBeenCalledWith('u1', 'l1', 'abcd2345'));
  });

  it('does not touch a public copy for a list that is not shared', async () => {
    renderView();
    await screen.findByTestId('list-value');
    fireEvent.click(screen.getByRole('button', { name: 'More Luke' }));
    expect(service.updatePublic).not.toHaveBeenCalled();
  });

  it('shows the list as not shared when sharing was stopped elsewhere', async () => {
    service.updatePublic.mockResolvedValue({ error: 'not-shared' });
    renderView({ ...LIST, publicCode: 'abcd2345' });
    expect(await screen.findByRole('button', { name: 'Share link' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Share link')).not.toBeInTheDocument();
  });

  it('does not republish a shared list when its prices failed to load', async () => {
    loadPrices.mockResolvedValueOnce({ prices: {}, error: 'prices' });
    renderView({ ...LIST, publicCode: 'abcd2345' });
    await screen.findByText('Prices are unavailable right now.');
    expect(service.updatePublic).not.toHaveBeenCalled();
  });

  it('turns a burst of taps into one save', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<ListView uid="u1" list={LIST} collectionData={{}} onBack={vi.fn()} onDeleted={vi.fn()} service={service} loadPrices={loadPrices} saveDelay={800} />);
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: 'More Luke' }));
    expect(service.updateList).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(800);
    expect(service.updateList).toHaveBeenCalledTimes(1);
    expect(service.updateList.mock.calls[0][2].items.SOR_020_any.qty).toBe(4);
    vi.useRealTimers();
  });

  it('saves a pending edit when leaving the list', async () => {
    const onBack = vi.fn();
    render(<ListView uid="u1" list={LIST} collectionData={{}} onBack={onBack} onDeleted={vi.fn()} service={service} loadPrices={loadPrices} saveDelay={60000} />);
    fireEvent.click(screen.getByRole('button', { name: 'More Luke' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(service.updateList).toHaveBeenCalledTimes(1));
    expect(onBack).toHaveBeenCalled();
  });

  it('saves a pending edit when the view unmounts', async () => {
    const { unmount } = render(<ListView uid="u1" list={LIST} collectionData={{}} onBack={vi.fn()} onDeleted={vi.fn()} service={service} loadPrices={loadPrices} saveDelay={60000} />);
    fireEvent.click(screen.getByRole('button', { name: 'More Luke' }));
    unmount();
    await waitFor(() => expect(service.updateList).toHaveBeenCalledTimes(1));
  });

  it('does not republish right after sharing', async () => {
    renderView();
    await screen.findByTestId('list-value');
    fireEvent.click(screen.getByRole('button', { name: 'Share link' }));
    await screen.findByLabelText('Share link');
    await new Promise((r) => setTimeout(r, 20));
    expect(service.updatePublic).not.toHaveBeenCalled();
  });

  it('dates prices by when they were loaded, not by the edit', async () => {
    const loadedAt = Date.now();
    renderView({ ...LIST, publicCode: 'abcd2345' });
    await waitFor(() => expect(service.updatePublic).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 30));
    fireEvent.click(screen.getByRole('button', { name: 'More Luke' }));
    await waitFor(() => expect(service.updatePublic).toHaveBeenCalledTimes(2));
    const asOf = service.updatePublic.mock.calls[1][2].pricesAsOf;
    expect(asOf).toBeGreaterThanOrEqual(loadedAt);
    expect(asOf).toBeLessThan(loadedAt + 25);
  });

  it('saves a pending edit when the page is hidden (phone app switch) or closed', async () => {
    render(<ListView uid="u1" list={LIST} collectionData={{}} onBack={vi.fn()} onDeleted={vi.fn()} service={service} loadPrices={loadPrices} saveDelay={60000} />);
    fireEvent.click(screen.getByRole('button', { name: 'More Luke' }));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    await waitFor(() => expect(service.updateList).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'More Luke' }));
    window.dispatchEvent(new Event('pagehide'));
    await waitFor(() => expect(service.updateList).toHaveBeenCalledTimes(2));
  });

  it('adds prices to the shared copy when they load after sharing', async () => {
    let resolvePrices;
    loadPrices.mockImplementationOnce(() => new Promise((r) => { resolvePrices = r; }));
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Share link' }));
    await screen.findByLabelText('Share link');
    expect(service.shareList.mock.calls[0][2]).not.toHaveProperty('value');
    resolvePrices({ prices: { SOR_010_any: { market: 1.5 } } });
    await waitFor(() => expect(service.updatePublic).toHaveBeenCalled());
    expect(service.updatePublic.mock.calls.at(-1)[2].value).toBe(3);
  });
});
