/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

vi.mock('../CardPickerModal', () => ({
  default: ({ onSelect, initialSearch }) => (
    <button type="button" data-initial-search={initialSearch ?? ''} onClick={() => onSelect({ Set: 'SHD', Number: 7, Name: 'Boba Fett' })}>pick-mock</button>
  ),
}));

import ScanReview from '../ScanReview';
import { emptyDraft, addCapture, applyResult, groupRows } from '../../utils/scanDraft';

const LUKE = { status: 'matched', set: 'SOR', number: '012', name: 'Luke Skywalker' };

const build = (specs) => specs.reduce((d, [id, result, { isFoil = false, photo = `p-${id}` } = {}]) => {
  const next = addCapture(d, { id, isFoil, photo });
  return result ? applyResult(next, id, result) : next;
}, emptyDraft());

const renderReview = (draft, props = {}) => {
  const handlers = {
    onChange: vi.fn(), onRetry: vi.fn(), onBack: vi.fn(), onCommit: vi.fn(), onDiscard: vi.fn(),
  };
  render(<ScanReview draft={draft} committing={false} commitError={null} {...handlers} {...props} />);
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
    expect(screen.getByRole('img', { name: 'Captured photo' })).toHaveAttribute('src', 'data:image/jpeg;base64,p-u');
    await user.click(screen.getByRole('button', { name: 'Pick card' }));
    await user.click(screen.getByText('pick-mock'));
    expect(onChange.mock.calls[0][0].rows[0]).toMatchObject({ status: 'matched', set: 'SHD', number: '007' });
  });

  it('opens a captured photo full size and closes it again', async () => {
    const user = userEvent.setup();
    renderReview(build([['u', { status: 'unidentified', reason: 'unreadable', read: null }]]));
    await user.click(screen.getByRole('button', { name: 'View photo' }));
    const viewer = screen.getByRole('dialog', { name: 'Photo' });
    expect(within(viewer).getByRole('img')).toHaveAttribute('src', 'data:image/jpeg;base64,p-u');
    await user.click(within(viewer).getByRole('button', { name: 'Close photo' }));
    expect(screen.queryByRole('dialog', { name: 'Photo' })).not.toBeInTheDocument();
  });

  it('shows the captured photo for a matched card, so a match can be checked', async () => {
    const user = userEvent.setup();
    renderReview(build([['a', LUKE]]));
    await user.click(screen.getByRole('button', { name: 'View photo of Luke Skywalker' }));
    expect(within(screen.getByRole('dialog', { name: 'Photo' })).getByRole('img')).toHaveAttribute('src', 'data:image/jpeg;base64,p-a');
  });

  it('falls back to the card image when the photo was not kept', async () => {
    const user = userEvent.setup();
    const draft = { rows: [{ id: 'a', status: 'matched', set: 'SOR', number: '012', name: 'Luke Skywalker', isFoil: false, qty: 1, photo: null, hadPhoto: true }] };
    renderReview(draft);
    await user.click(screen.getByRole('button', { name: 'View photo of Luke Skywalker' }));
    expect(within(screen.getByRole('dialog', { name: 'Photo' })).getByRole('img').getAttribute('src')).toContain('/cards/SOR/012');
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

  it('says so when a photo was lost to a reload', () => {
    const draft = { rows: [{ id: 'u', status: 'unidentified', reason: 'unreadable', read: null, isFoil: false, qty: 1, photo: null, hadPhoto: true }] };
    renderReview(draft);
    expect(screen.getByText('Photo lost')).toBeInTheDocument();
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

  it('disables commit while any card is still reading', () => {
    renderReview(build([['a', LUKE], ['r', null]]));
    expect(screen.getByRole('button', { name: /Add 1 card to collection/ })).toBeDisabled();
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
});
