import { describe, it, expect } from 'vitest';
import { showsSetPicker } from '../../utils/viewChrome';

describe('showsSetPicker', () => {
  it('shows the set picker only where the chosen set matters', () => {
    expect(showsSetPicker('binder')).toBe(true);
    expect(showsSetPicker('dashboard')).toBe(true);
    for (const view of ['decks', 'submit', 'admin', 'publicDeck']) expect(showsSetPicker(view)).toBe(false);
  });
});
