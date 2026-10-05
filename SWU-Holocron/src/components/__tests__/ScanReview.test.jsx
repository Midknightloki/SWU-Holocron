/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

vi.mock('../CardPickerModal', () => ({
  default: ({ onSelect, initialSearch }) => (
    <button type="button" data-initial-search={initialSearch ?? ''} onClick={() => onSelect({ Set: 'SHD', Number: 7, Name: 'Boba Fett' })}>pick-mock</button>
  ),
}));

import ScanReview from '../ScanReview';
import { emptyDraft, addCapture, applyResult, groupRows, markWaiting } from '../../utils/scanDraft';

const LUKE = { status: 'matched', set: 'SOR', number: '012', name: 'Luke Skywalker' };

// Photos come from the photo store; the test store returns "p-<id>".
const build = (specs) => specs.reduce((d, [id, result, { isFoil = false } = {}]) => {
  const next = addCapture(d, { id, isFoil });
  return result ? applyResult(next, id, result) : next;
}, emptyDraft());

const renderReview = (draft, props = {}) => {
  const handlers = {
    onChange: vi.fn(), onRetry: vi.fn(), onBack: vi.fn(), onCommit: vi.fn(), onDiscard: vi.fn(),
  };
  const getPhoto = (id) => Promise.resolve(`p-${id}`);
  render(<ScanReview draft={draft} committing={false} commitError={null} getPhoto={getPhoto} {...handlers} {...props} />);
  return handlers;
};

describe('ScanReview', () => {
  it('groups identical captures into one line with a count', () => {
    renderReview(build([['a', LUKE], ['b', LUKE]]));
    const line = screen.getByTestId('group-SOR_012_std');
    expect(within(line).getByText('Luke Skywalker')).toBeInTheDocument();
    expect(within(line).getByText('×2')).toBeInTheDocument();
  });

  it('shows leaders and bases landscape instead of cropping them', () => {
    renderReview(build([
      ['l', { ...LUKE, type: 'Leader' }],
      ['u', { status: 'matched', set: 'SOR', number: '045', name: 'Admiral Ackbar', type: 'Unit' }],
    ]));
    const thumb = (key) => screen.getByTestId(`group-${key}`).querySelector('img');
    expect(thumb('SOR_012_std')).toHaveAttribute('data-orientation', 'horizontal');
    expect(thumb('SOR_045_std')).toHaveAttribute('data-orientation', 'vertical');
  });

  it('shows foil and standard copies as separate lines', () => {
    renderReview(build([['a', LUKE], ['b', LUKE, { isFoil: true }]]));
    expect(screen.getByTestId('group-SOR_012_std')).toBeInTheDocument();
    expect(screen.getByTestId('group-SOR_012_foil')).toBeInTheDocument();
  });

  it('increments and decrements a line through onChange', async () => {
    const user = userEvent.setup();
    const { onChange } = renderReview(build([['a', LUKE]]));
    await user.click(screen.getByRole('button', { name: 'Increase Luke Skywalker' }));
    expect(groupRows(onChange.mock.calls[0][0])[0].qty).toBe(2);
    await user.click(screen.getByRole('button', { name: 'Decrease Luke Skywalker' }));
    expect(onChange.mock.calls[1][0].rows).toEqual([]);
  });

  it('toggles foil for a whole line', async () => {
    const user = userEvent.setup();
    const { onChange } = renderReview(build([['a', LUKE], ['b', LUKE]]));
    const foil = screen.getByRole('button', { name: 'Foil' });
    expect(foil).toHaveAttribute('aria-pressed', 'false');
    await user.click(foil);
    expect(onChange.mock.calls[0][0].rows.every((r) => r.isFoil)).toBe(true);
  });

  it('shows what was read for an unidentified card and resolves it by picking', async () => {
    const user = userEvent.setup();
    const read = { readable: true, set: 'SOR', number: '999', name: 'Nobody' };
    const { onChange } = renderReview(build([['u', { status: 'unidentified', reason: 'no-such-card', read }]]));
    expect(screen.getByText('Read as SOR 999 · Nobody')).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'Captured photo' })).toHaveAttribute('src', 'data:image/jpeg;base64,p-u');
    await user.click(screen.getByRole('button', { name: 'Pick card' }));
    await user.click(screen.getByText('pick-mock'));
    expect(onChange.mock.calls[0][0].rows[0]).toMatchObject({ status: 'matched', set: 'SHD', number: '007' });
  });

  it('opens a captured photo full size and closes it again', async () => {
    const user = userEvent.setup();
    renderReview(build([['u', { status: 'unidentified', reason: 'unreadable', read: null }]]));
    await user.click(await screen.findByRole('button', { name: 'View photo' }));
    const viewer = screen.getByRole('dialog', { name: 'Photo' });
    expect(within(viewer).getByRole('img')).toHaveAttribute('src', 'data:image/jpeg;base64,p-u');
    await user.click(within(viewer).getByRole('button', { name: 'Close photo' }));
    expect(screen.queryByRole('dialog', { name: 'Photo' })).not.toBeInTheDocument();
  });

  it('shows the captured photo for a matched card, so a match can be checked', async () => {
    const user = userEvent.setup();
    renderReview(build([['a', LUKE]]));
    await user.click(screen.getByRole('button', { name: 'View photo of Luke Skywalker' }));
    expect(within(await screen.findByRole('dialog', { name: 'Photo' })).getByRole('img')).toHaveAttribute('src', 'data:image/jpeg;base64,p-a');
  });

  it('falls back to the card image when the photo was not kept', async () => {
    const user = userEvent.setup();
    const draft = { rows: [{ id: 'a', status: 'matched', set: 'SOR', number: '012', name: 'Luke Skywalker', isFoil: false, qty: 1, hasPhoto: true }] };
    renderReview(draft, { getPhoto: () => Promise.resolve(null) });
    await user.click(screen.getByRole('button', { name: 'View photo of Luke Skywalker' }));
    expect(within(await screen.findByRole('dialog', { name: 'Photo' })).getByRole('img').getAttribute('src')).toContain('/cards/SOR/012');
  });

  it('opens the picker searching for the title that was read', async () => {
    const user = userEvent.setup();
    const read = { readable: true, set: 'SOR', number: '999', name: 'Han Solo' };
    renderReview(build([['u', { status: 'unidentified', reason: 'no-such-card', read }]]));
    await user.click(screen.getByRole('button', { name: 'Pick card' }));
    expect(screen.getByText('pick-mock')).toHaveAttribute('data-initial-search', 'Han Solo');
  });

  it('opens the picker with an empty search when nothing was read', async () => {
    const user = userEvent.setup();
    renderReview(build([['u', { status: 'unidentified', reason: 'unreadable', read: null }]]));
    await user.click(screen.getByRole('button', { name: 'Pick card' }));
    expect(screen.getByText('pick-mock')).toHaveAttribute('data-initial-search', '');
  });

  it('asks to check the printing of a leader matched by name only', () => {
    renderReview(build([['a', { ...LUKE, type: 'Leader', via: 'name' }]]));
    expect(within(screen.getByTestId('group-SOR_012_std')).getByText(/matched by name/i)).toBeInTheDocument();
  });

  it('badges cards that are new to the collection', () => {
    renderReview(
      build([['a', LUKE], ['b', { status: 'matched', set: 'SOR', number: '045', name: 'Admiral Ackbar', type: 'Unit' }]]),
      { collectionData: { SOR_045_std: { quantity: 2 } } },
    );
    expect(within(screen.getByTestId('group-SOR_012_std')).getByText('NEW')).toBeInTheDocument();
    expect(within(screen.getByTestId('group-SOR_045_std')).queryByText('NEW')).not.toBeInTheDocument();
  });

  it('counts a foil-only card as already owned', () => {
    renderReview(build([['a', LUKE]]), { collectionData: { SOR_012_foil: { quantity: 1 } } });
    expect(screen.queryByText('NEW')).not.toBeInTheDocument();
  });

  it('explains a card whose name was read but not its number', () => {
    const read = { readable: true, set: '', number: '', name: 'Han Solo', subtitle: 'Worth the Risk' };
    renderReview(build([['u', { status: 'unidentified', reason: 'no-number', read }]]));
    expect(screen.getByText(/no card number/i)).toBeInTheDocument();
  });

  it('loads a photo only once its row scrolls into view', async () => {
    // Review finding: a mid-box review loaded every full-size photo at once.
    let trigger;
    const observe = vi.fn();
    globalThis.IntersectionObserver = class {
      constructor(cb) { trigger = cb; }
      observe(el) { observe(el); }
      disconnect() {}
    };
    try {
      const getPhoto = vi.fn((id) => Promise.resolve(`p-${id}`));
      renderReview(build([['u', { status: 'unidentified', reason: 'unreadable', read: null }]]), { getPhoto });
      expect(observe).toHaveBeenCalled();
      expect(getPhoto).not.toHaveBeenCalled();
      await act(async () => { trigger([{ isIntersecting: true }]); });
      expect(await screen.findByRole('img', { name: 'Captured photo' })).toHaveAttribute('src', 'data:image/jpeg;base64,p-u');
    } finally {
      delete globalThis.IntersectionObserver;
    }
  });

  it('shows No photo when the store has none', async () => {
    renderReview(build([['u', { status: 'unidentified', reason: 'unreadable', read: null }]]), { getPhoto: () => Promise.resolve(null) });
    expect(await screen.findByText('No photo')).toBeInTheDocument();
    expect(screen.getByText("Couldn't read this card")).toBeInTheDocument();
  });

  it('offers retry for a failed row that still has its photo', async () => {
    const user = userEvent.setup();
    const { onRetry } = renderReview(build([['f', { status: 'failed', error: 'network' }]]));
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledWith('f');
  });

  it('removes a problem row', async () => {
    const user = userEvent.setup();
    const { onChange } = renderReview(build([['f', { status: 'failed', error: 'network' }]]));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onChange.mock.calls[0][0].rows).toEqual([]);
  });

  it('labels the commit with the matched count and warns about leftovers', () => {
    renderReview(build([['a', LUKE], ['b', LUKE], ['f', { status: 'failed', error: 'network' }]]));
    expect(screen.getByRole('button', { name: 'Add 2 cards to collection' })).toBeEnabled();
    expect(screen.getByText(/1 card needs attention and will stay in the batch/)).toBeInTheDocument();
  });

  it('Add works while cards are reading or waiting, and says they stay', () => {
    const d = markWaiting(build([['a', LUKE], ['r', null], ['w', null]]), ['w'], 'quota');
    renderReview(d);
    expect(screen.getByRole('button', { name: 'Add 1 card to collection' })).toBeEnabled();
    expect(screen.getByText(/1 still reading will stay in the batch/)).toBeInTheDocument();
    expect(screen.getByText(/waiting: daily limit/i)).toBeInTheDocument();
  });

  it('offers retry for a row waiting on the daily limit', async () => {
    const user = userEvent.setup();
    const { onRetry } = renderReview(markWaiting(build([['w', null]]), ['w'], 'quota'));
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledWith('w');
  });

  it('disables commit while committing and shows the error', () => {
    renderReview(build([['a', LUKE]]), { committing: true, commitError: 'Some cards were not saved.' });
    expect(screen.getByRole('button', { name: /Adding/ })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Some cards were not saved.');
  });

  it('locks every control while a commit is in flight', () => {
    renderReview(
      build([['a', LUKE], ['u', { status: 'unidentified', reason: 'unreadable', read: null }], ['f', { status: 'failed', error: 'network' }]]),
      { committing: true },
    );
    for (const name of ['Back to camera', 'Foil', 'Increase Luke Skywalker', 'Decrease Luke Skywalker', 'Retry', 'Discard batch']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    for (const button of screen.getAllByRole('button', { name: /Pick card|Remove/ })) {
      expect(button).toBeDisabled();
    }
  });

  it('confirms before discarding the batch', async () => {
    const user = userEvent.setup();
    const { onDiscard } = renderReview(build([['a', LUKE]]));
    await user.click(screen.getByRole('button', { name: 'Discard batch' }));
    expect(onDiscard).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Discard 1 card' }));
    expect(onDiscard).toHaveBeenCalled();
  });

  it('goes back to the camera', async () => {
    const user = userEvent.setup();
    const { onBack } = renderReview(emptyDraft());
    await user.click(screen.getByRole('button', { name: 'Back to camera' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('edits the batch name and price paid', () => {
    const onBatchChange = vi.fn();
    renderReview(build([['a', LUKE]]), { batch: { id: 'b1', name: 'Batch Oct 5', pricePaid: null }, onBatchChange });
    expect(screen.getByLabelText('Batch name')).toHaveValue('Batch Oct 5');
    fireEvent.change(screen.getByLabelText('Batch name'), { target: { value: 'eBay SOR box' } });
    expect(onBatchChange).toHaveBeenLastCalledWith({ name: 'eBay SOR box' });
    fireEvent.change(screen.getByLabelText('Price paid'), { target: { value: '89.99' } });
    expect(onBatchChange).toHaveBeenLastCalledWith({ pricePaid: 89.99 });
    fireEvent.change(screen.getByLabelText('Price paid'), { target: { value: '' } });
    expect(onBatchChange).toHaveBeenLastCalledWith({ pricePaid: null });
  });

  it('accepts $ and commas in the price, and marks what it cannot read', () => {
    const onBatchChange = vi.fn();
    renderReview(build([['a', LUKE]]), { batch: { id: 'b1', name: 'B', pricePaid: null }, onBatchChange });
    const price = screen.getByLabelText('Price paid');
    fireEvent.change(price, { target: { value: '$1,200' } });
    expect(onBatchChange).toHaveBeenLastCalledWith({ pricePaid: 1200 });
    expect(price).not.toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(price, { target: { value: 'forty' } });
    expect(onBatchChange).toHaveBeenLastCalledWith({ pricePaid: null });
    expect(price).toHaveAttribute('aria-invalid', 'true');
  });

  it('offers no Retry for a waiting card whose photo is gone', () => {
    const draft = markWaiting(build([['a']]), ['a'], 'quota');
    draft.rows[0].hasPhoto = false;
    renderReview(draft);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('shows no batch fields without a batch', () => {
    renderReview(build([['a', LUKE]]));
    expect(screen.queryByLabelText('Batch name')).not.toBeInTheDocument();
  });
});
