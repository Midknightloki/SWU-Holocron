# Polish Round Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Imports become batches with reports; copied text fits Discord; the public list page reads well on a phone; list editing writes less; shared decks get shape checks; a guest can upgrade to Google without losing their collection.

**Architecture:**
- **Discord text:** pure helpers (`discordText.js`) feed one shared `CopyTextButton`, which replaces three hand-rolled copy flows.
- **Imports:** `importBatch.js` holds the import logic for both modes. It reuses `ScanService.commitDraft` (adding mode) and `BatchService` (the report). `ImportDialog` asks which mode, and `App` opens the resulting `BatchReport`.
- **Guest upgrade:** `guestUpgrade.js` links the Google account to the guest, or merges the guest's cards into an existing Google account through `importToCollection`. `AuthContext` exposes the outcome, and `App` shows it.

**Tech Stack:** React 18, Vite, Tailwind, Firestore and Firebase Auth v9 modular, Vitest + Testing Library (happy-dom), `@firebase/rules-unit-testing`.

**Spec:** `SWU-Holocron/docs/superpowers/specs/2026-10-07-polish-round-design.md`

## Global Constraints

- All commands run from `SWU-Holocron/`.
- **Commit gate:** the task's tests pass, then `npx eslint src --ext js,jsx --quiet` prints nothing, then commit. The last task also runs `npm run test:unit`, `npm run test:rules` and `npm run build`.
- **Rules tests need JDK 21:** prefix with `JAVA_HOME="/c/Program Files/Microsoft/jdk-21.0.12.101-hotspot" PATH="$JAVA_HOME/bin:$PATH"`.
- **No U+FEFF escape sequences** in source.
- **Firestore field values:** no `undefined`.
- **Services** never throw; they return `{ error }`.
- **No browser dialogs:** no `alert`/`confirm`/`console.log` in new code, and the import path's existing `alert`s are removed.
- **Writes chunk at 400.**
- **Hook order:** every hook comes before any conditional return.
- **Never shown as $0:** unpriced cards.

## Review Focus

1. **A CSV listing the same card on two rows** is summed in both modes, not last-row-wins. Tested in Task 6.
2. **An Add import that fails part-way** reports how many cards landed, and records no batch, so a retry is not counted twice in the report. Tested in Task 6.
3. **Leaving a list within the 800 ms debounce** (Back, closing the page) still saves the edit. Tested in Task 4.
4. **A guest whose Google account already exists:** the guest's cards are read before switching accounts. After the switch the guest's data can no longer be read. Tested in Task 8.
5. **An existing shared deck written by today's `publishDeck`** still passes the new rules. Tested in Task 5.

## Plan decisions (beyond the spec)

- An import's mode has **no default**: Import stays disabled until Add or Replace is chosen, which is what "ask each time" means.
- **"Shared link not updated yet"** clears on the next successful update. A queued write landing on its own is not observable without holding its promise past the 8 s timeout.
- **The guest upgrade entry point is new:** a signed-in guest had no Google button anywhere. "Sign in with Google" is added to the desktop header and the phone Me sheet, for guests only.
- **`toPublicList` now carries `type`** (for landscape thumbnails) and `priceIsFallback`.

## File map

| File | Responsibility |
|---|---|
| Create `src/utils/discordText.js` | `escapeDiscord`, `splitForDiscord` |
| Create `src/components/CopyTextButton.jsx` | Copy in one or several parts, with the fallback box |
| Modify `src/components/ListView.jsx` | CopyTextButton; debounced saves; share skip; price time |
| Modify `src/components/PublicListView.jsx` | CopyTextButton; phone layout; thumbnails; fallback marker |
| Modify `src/components/CollectionValueReport.jsx` | CopyTextButton |
| Modify `src/utils/cardLists.js` | `toPublicList` carries `type`, `priceIsFallback` |
| Modify `firestore.rules`, `src/test/rules/firestore.rules.test.js` | `publicDecks` shape |
| Modify `src/services/BatchService.js` | `closeBatch(uid, id, extra)` |
| Create `src/services/importBatch.js` | `importToCollection` |
| Create `src/components/ImportDialog.jsx` | The import dialog |
| Modify `src/components/BatchReport.jsx` | "Quantities lowered" section |
| Modify `src/App.jsx` | Import dialog → report; upgrade buttons and notice |
| Create `src/services/guestUpgrade.js` | `upgradeGuest` |
| Modify `src/contexts/AuthContext.jsx` | Guest path in `loginWithGoogle`; `upgrade` state |
| Modify `src/components/MobileNav.jsx` | Guest "Sign in with Google" |
| Modify `CLAUDE.md` (git root) | Document imports as batches, guest upgrade, rules |

---

### Task 1: Discord text helpers

**Files:**
- Create: `src/utils/discordText.js`
- Test: `src/test/utils/discordText.test.js`

**Interfaces:**
- Produces: `DISCORD_LIMIT = 2000`; `escapeDiscord(text) → string`; `splitForDiscord(text, limit = DISCORD_LIMIT) → string[]` (always at least one part).

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { escapeDiscord, splitForDiscord } from '../../utils/discordText';

describe('escapeDiscord', () => {
  it('escapes characters Discord treats as formatting', () => {
    expect(escapeDiscord('*Vader* _Lord_ ~x~ |s| `c`')).toBe('\\*Vader\\* \\_Lord\\_ \\~x\\~ \\|s\\| \\`c\\`');
  });
  it('leaves ordinary text alone', () => {
    expect(escapeDiscord('2× Luke (SOR 005) — $1.50 ea')).toBe('2× Luke (SOR 005) — $1.50 ea');
  });
});

describe('splitForDiscord', () => {
  const card = (i) => `1× Card number ${String(i).padStart(3, '0')} with a long enough name (SOR ${i})`;
  const text = ['Wants: Gaps', '', ...Array.from({ length: 80 }, (_, i) => card(i)), 'Total: 80 cards'].join('\n');

  it('keeps a short text in one part', () => {
    expect(splitForDiscord('Wants: A\n\n1× X\nTotal: 1 cards')).toEqual(['Wants: A\n\n1× X\nTotal: 1 cards']);
  });

  it('splits on line boundaries, every part under the limit', () => {
    const parts = splitForDiscord(text, 2000);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(2000);
    const cardLines = parts.flatMap((p) => p.split('\n')).filter((l) => l.startsWith('1×'));
    expect(cardLines).toHaveLength(80);
  });

  it('repeats the heading with part numbers and ends with the total', () => {
    const parts = splitForDiscord(text, 2000);
    parts.forEach((p, i) => expect(p.split('\n')[0]).toBe(`Wants: Gaps (part ${i + 1} of ${parts.length})`));
    expect(parts.at(-1).endsWith('Total: 80 cards')).toBe(true);
    expect(parts.slice(0, -1).some((p) => p.includes('Total:'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/test/utils/discordText.test.js`
Expected: FAIL — cannot resolve `../../utils/discordText`.

- [ ] **Step 3: Implement `src/utils/discordText.js`**

```js
/**
 * Copied lists go into Discord: escape what Discord would read as formatting,
 * and split anything over a message's 2000 characters into parts, each with
 * the heading (marked "part N of M") and the total on the last.
 * Text shape: heading line, blank line, card lines, total line.
 */
export const DISCORD_LIMIT = 2000;

export const escapeDiscord = (text) => String(text).replace(/([*_~|`])/g, '\\$1');

export function splitForDiscord(text, limit = DISCORD_LIMIT) {
  if (text.length <= limit) return [text];
  const lines = text.split('\n');
  const heading = lines[0];
  const total = lines.at(-1);
  const body = lines.slice(1, -1).filter((l, i) => !(i === 0 && l === ''));
  // Room for "<heading> (part NN of NN)\n\n" and, on the last part, "\n<total>".
  const room = limit - heading.length - ' (part 99 of 99)'.length - 2;
  const chunks = [];
  let current = [];
  let size = 0;
  for (const line of body) {
    if (current.length && size + line.length + 1 > room) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(line);
    size += line.length + 1;
  }
  chunks.push(current);
  // The total must fit on the last part.
  if (size + total.length + 1 > room) chunks.push([]);
  return chunks.map((chunk, i) => {
    const out = [`${heading} (part ${i + 1} of ${chunks.length})`, '', ...chunk];
    if (i === chunks.length - 1) out.push(total);
    return out.join('\n');
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/test/utils/discordText.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx vitest run src/test/utils/discordText.test.js && L=$(npx eslint src --ext js,jsx --quiet 2>/dev/null); [ -n "$L" ] && echo "$L" || { git add src/utils/discordText.js src/test/utils/discordText.test.js && git commit -m "feat(polish): Discord escaping and splitting for copied text"; }
```

---

### Task 2: CopyTextButton, used by the list view, the public page and Market reports

**Files:**
- Create: `src/components/CopyTextButton.jsx`
- Modify: `src/components/ListView.jsx`, `src/components/PublicListView.jsx`, `src/components/CollectionValueReport.jsx`
- Test: `src/components/__tests__/CopyTextButton.test.jsx` (existing copy tests in the three components must stay green)

**Interfaces:**
- Consumes: Task 1.
- Produces: `<CopyTextButton text count? fallbackLabel disabled? className? />`.
  - **One part:** the button reads `Copy as text`; after copying, the status reads `Copied {count} cards` when `count` is given, else `Copied`.
  - **Several parts:** the button reads `Copy part {i} of {n}`; after each copy the status reads `Copied part {i} of {n}` and the button advances. After the last part it returns to part 1.
  - **Clipboard blocked:** a read-only textarea with `aria-label={fallbackLabel}` holds the current part.
  - **Text changes** (filters, prices, edits): the state resets and the status and box disappear.

- [ ] **Step 1: Write the failing test**

```jsx
/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import CopyTextButton from '../CopyTextButton';

let writeText;
beforeEach(() => {
  writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});
const long = ['Wants: Big', '', ...Array.from({ length: 120 }, (_, i) => `1× A card with quite a long name number ${i} (SOR ${i})`), 'Total: 120 cards'].join('\n');

describe('CopyTextButton', () => {
  it('copies a short list in one tap, escaped for Discord', async () => {
    render(<CopyTextButton text={'Wants: A\n\n1× *Star* (SOR 001)\nTotal: 1 cards'} count={1} fallbackLabel="List text" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy as text' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Copied 1 cards');
    expect(writeText).toHaveBeenCalledWith('Wants: A\n\n1× \\*Star\\* (SOR 001)\nTotal: 1 cards');
  });

  it('copies a long list part by part', async () => {
    render(<CopyTextButton text={long} fallbackLabel="List text" />);
    const first = screen.getByRole('button', { name: /^Copy part 1 of \d$/ });
    const n = Number(first.textContent.match(/of (\d)/)[1]);
    fireEvent.click(first);
    expect(await screen.findByRole('status')).toHaveTextContent(`Copied part 1 of ${n}`);
    expect(writeText.mock.calls[0][0].length).toBeLessThanOrEqual(2000);
    expect(screen.getByRole('button', { name: `Copy part 2 of ${n}` })).toBeInTheDocument();
  });

  it('shows the current part to select by hand when the clipboard is blocked', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    render(<CopyTextButton text={long} fallbackLabel="List text" />);
    fireEvent.click(screen.getByRole('button', { name: /^Copy part 1/ }));
    expect((await screen.findByLabelText('List text')).value.startsWith('Wants: Big (part 1 of')).toBe(true);
  });

  it('resets when the text changes', async () => {
    const { rerender } = render(<CopyTextButton text={long} fallbackLabel="List text" />);
    fireEvent.click(screen.getByRole('button', { name: /^Copy part 1/ }));
    await screen.findByRole('status');
    rerender(<CopyTextButton text={`${long}\n`} fallbackLabel="List text" />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Copy part 1/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/__tests__/CopyTextButton.test.jsx`
Expected: FAIL — cannot resolve `../CopyTextButton`.

- [ ] **Step 3: Implement `src/components/CopyTextButton.jsx`**

```jsx
import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardCopy } from 'lucide-react';
import { escapeDiscord, splitForDiscord } from '../utils/discordText';

/** Copy a list for Discord: escaped, and in parts when it is over a message's limit. */
export default function CopyTextButton({ text, count, fallbackLabel, disabled = false, className = '' }) {
  const parts = useMemo(() => splitForDiscord(escapeDiscord(text ?? '')), [text]);
  const [index, setIndex] = useState(0);
  // { kind: 'copied', part } | { kind: 'fallback', part } | null
  const [state, setState] = useState(null);

  useEffect(() => { setIndex(0); setState(null); }, [text]);

  const many = parts.length > 1;
  const copy = async () => {
    const part = index;
    try {
      await navigator.clipboard.writeText(parts[part]);
      setState({ kind: 'copied', part });
      setIndex((part + 1) % parts.length);
    } catch {
      setState({ kind: 'fallback', part });
    }
  };

  const label = many ? `Copy part ${index + 1} of ${parts.length}` : 'Copy as text';
  let status = null;
  if (state?.kind === 'copied') {
    if (many) status = `Copied part ${state.part + 1} of ${parts.length}`;
    else status = typeof count === 'number' ? `Copied ${count} cards` : 'Copied';
  }

  return (
    <>
      <button type="button" onClick={copy} disabled={disabled}
        className={className || 'flex items-center gap-1 px-3 py-2 rounded-lg bg-gray-800 text-sm disabled:opacity-40'}>
        <ClipboardCopy className="w-4 h-4" /> {label}
      </button>
      {status && <p role="status" className="basis-full text-sm text-green-400 print:hidden">{status}</p>}
      {state?.kind === 'fallback' && (
        <div className="basis-full space-y-1 print:hidden">
          <p className="text-xs text-gray-400">Select and copy:</p>
          <textarea readOnly aria-label={fallbackLabel} value={parts[state.part]} rows={6} onFocus={(e) => e.target.select()}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-xs font-mono" />
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Adopt it in the three components**

`ListView.jsx`:
- Remove the `copyState` state, every `setCopyState(…)` call, the `copyText` function, the `Copy as text` button, and the `copyState` status and textarea block. Remove `ClipboardCopy` from the lucide import if it is unused.
- Add `import CopyTextButton from './CopyTextButton';`.
- Add `const listText = useMemo(() => toListText({ kind: list.kind, name: savedName }, lines, { showPrices }), [list.kind, savedName, lines, showPrices]);` after `summary`.
- In the toolbar, where the Copy button was: `<CopyTextButton text={listText} count={summary.cards} fallbackLabel="List text" disabled={lines.length === 0} />`.

`PublicListView.jsx`:
- Remove the `copyState` state, `copyText`, the button and the status/textarea block.
- Add `const text = useMemo(() => (doc ? toListText(doc, lines, { showPrices }) : ''), [doc, lines, showPrices]);` next to the other hooks, before any conditional rendering.
- Render `<CopyTextButton text={text} fallbackLabel="List text" />` where the button was.

`CollectionValueReport.jsx`:
- Remove `copyState`, `copyText`, the `Copy as text` button and its status/textarea block. Remove every `setCopyState(null)` call: CopyTextButton resets itself when the text changes.
- Add `const tradeText = useMemo(() => toTradeText(lines, { showPrices }), [lines, showPrices]);` with the other hooks.
- Where the button was: `<CopyTextButton text={tradeText} count={summary.cards} fallbackLabel="Trade list" disabled={noExport} />`.

- [ ] **Step 5: Run all affected tests**

Run: `npx vitest run src/components/__tests__/CopyTextButton.test.jsx src/components/__tests__/ListView.test.jsx src/components/__tests__/PublicListView.test.jsx src/components/__tests__/CollectionValueReport.test.jsx`
Expected: PASS. The existing assertions keep their meaning: "Copied 3 cards", the `Trade list` / `List text` fallback boxes, and "clears the copy box when prices or filters change" (the text changes, so the box resets). If an existing test asserted exact copied text containing a character that is now escaped, update the expectation to the escaped form and ledger it.

- [ ] **Step 6: Commit**

```bash
npx vitest run src/components/__tests__/CopyTextButton.test.jsx src/components/__tests__/ListView.test.jsx src/components/__tests__/PublicListView.test.jsx src/components/__tests__/CollectionValueReport.test.jsx && L=$(npx eslint src --ext js,jsx --quiet 2>/dev/null); [ -n "$L" ] && echo "$L" || { git add src/components/CopyTextButton.jsx src/components/ListView.jsx src/components/PublicListView.jsx src/components/CollectionValueReport.jsx src/components/__tests__ && git commit -m "feat(polish): copy lists for Discord in parts"; }
```

---

### Task 3: Public page on a phone

**Files:**
- Modify: `src/utils/cardLists.js`, `src/components/PublicListView.jsx`
- Test: `src/test/utils/cardLists.test.js`, `src/components/__tests__/PublicListView.test.jsx`

**Interfaces:**
- Produces: public lines carry `type` (when known) and `priceIsFallback: true` (only on priced fallback lines). `publicLines` keeps `priceIsFallback` from the doc.

- [ ] **Step 1: Write the failing tests**

In `src/test/utils/cardLists.test.js`, update the expected `lines` in "carries prices only on priced lines…": add `type: 'Leader'` to both lines (the fixture card is a Leader), and give the test's price `{ market: 1.5, isFallback: true }`, so the Vader line also carries `priceIsFallback: true`. Add:

```js
  it('marks fallback prices only on priced lines, and keeps them on the way back', () => {
    const body = toPublicList({ kind: 'wants', name: 'G' }, listLines(items, { SOR_010_any: { market: 1.5, isFallback: true } }), { showPrices: true, now: 1 });
    expect(body.lines[1].priceIsFallback).toBe(true);
    expect('priceIsFallback' in body.lines[0]).toBe(false);
    expect(publicLines(body)[1].priceIsFallback).toBe(true);
  });
```

In `src/components/__tests__/PublicListView.test.jsx`, give the Vader line `type: 'Leader', priceIsFallback: true` and the Luke line `type: 'Unit'`, then add:

```jsx
  it('fits a phone: wrapping notes and names, wide quantities, landscape leaders, fallback marker', async () => {
    render(<PublicListView code="abcd2345" service={service} />);
    await screen.findAllByTestId('public-row');
    expect(screen.getByText('any art')).toHaveClass('break-words');
    expect(screen.getByText('Darth Vader, Dark Lord')).toHaveClass('break-words');
    const [luke, vader] = screen.getAllByTestId('public-row');
    expect(luke.querySelector('img')).toHaveClass('w-10', 'h-14');
    expect(vader.querySelector('img')).toHaveClass('w-14', 'h-10');
    expect(screen.getByText('$1.50 ↺')).toBeInTheDocument();
    expect(screen.getByText('×2')).toHaveClass('whitespace-nowrap');
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/test/utils/cardLists.test.js src/components/__tests__/PublicListView.test.jsx`
Expected: FAIL — no `type` or `priceIsFallback` on public lines; the classes are missing.

- [ ] **Step 3: Implement**

`cardLists.js`, inside `toPublicList`'s line mapping:
- after `if (l.note) out.note = l.note;` add `if (l.type) out.type = l.type;`;
- change the price line to:
  `if (showPrices && l.unitPrice !== null) { out.unitPrice = l.unitPrice; if (l.priceIsFallback) out.priceIsFallback = true; }`.

In `publicLines`, replace `priceIsFallback: false` with `priceIsFallback: Boolean(l.priceIsFallback)`. Keep the spread order so this value wins.

`PublicListView.jsx` row:
- **Thumbnail** class: `` className={`${l.type === 'Leader' || l.type === 'Base' ? 'w-14 h-10' : 'w-10 h-14'} object-cover rounded bg-gray-800 shrink-0`} ``.
- **Name** span: `className="block font-medium break-words"`. Remove `truncate`.
- **Note** span: `className="block text-xs text-gray-400 break-words"`.
- **Price** span: `{money(l.unitPrice)}{l.priceIsFallback ? ' ↺' : ''}`, with `title="Priced from the other finish"` when it's a fallback.
- **Quantity** span: `className="min-w-[3rem] text-right font-bold whitespace-nowrap"`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/test/utils/cardLists.test.js src/components/__tests__/PublicListView.test.jsx src/components/__tests__/ListView.test.jsx`
Expected: PASS. ListView's public-body tests still pass: they check fields with `toMatchObject` or `JSON.stringify`.

- [ ] **Step 5: Commit**

```bash
npx vitest run src/test/utils/cardLists.test.js src/components/__tests__/PublicListView.test.jsx && L=$(npx eslint src --ext js,jsx --quiet 2>/dev/null); [ -n "$L" ] && echo "$L" || { git add src/utils/cardLists.js src/components/PublicListView.jsx src/test/utils/cardLists.test.js src/components/__tests__/PublicListView.test.jsx && git commit -m "feat(polish): public list page fits a phone"; }
```

---

### Task 4: Fewer writes, honest dates

**Files:**
- Modify: `src/components/ListView.jsx`
- Test: `src/components/__tests__/ListView.test.jsx`

**Interfaces:**
- Produces: `ListView` takes `saveDelay = 800` (ms). List saves and public updates are debounced together and flushed on Back, on unmount and on `beforeunload`. A share does not trigger an immediate republish. The public body's `now` is the time prices were loaded.

- [ ] **Step 1: Write the failing tests and adapt the existing ones**

In `ListView.test.jsx`:
- The `renderView` helper passes `saveDelay={0}`. The two tests that render `<ListView …>` directly also get `saveDelay={0}`.
- Every assertion on `service.updateList`, `service.updatePublic` or `.mock.calls[…]` made right after a `fireEvent` is wrapped in `await waitFor(() => …)`. For tests that read `mock.calls[0][2]`, first `await waitFor(() => expect(service.updateList).toHaveBeenCalled())`, then read.

Add:

```jsx
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
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run src/components/__tests__/ListView.test.jsx`
Expected: the five new tests FAIL (several saves, no debounce, a republish after share, `pricesAsOf` set at the edit). The adapted old tests pass.

- [ ] **Step 3: Implement in `ListView.jsx`**

- **Signature:** add `saveDelay = 800`. Add `useRef` and `useCallback` to the React import.
- **State:** add `const [pricesAt, setPricesAt] = useState(null);`. In the price-loading effect, call `setPricesAt(Date.now())` alongside `setPrices(…)`.
- **`publicBody`:** use `now: pricesAt ?? Date.now()`.
- **Replace** `save`, `saveItems` and the public-sync effect with:

```jsx
  // Edits are saved together after a short pause: a burst of + taps is one
  // write to the list and one to its public copy.
  const pending = useRef({ patch: null, publicDirty: false, timer: null, justShared: false });
  const latest = useRef({});
  latest.current = { publicCode, publicBody };

  const flush = useCallback(async () => {
    const p = pending.current;
    clearTimeout(p.timer);
    p.timer = null;
    const patch = p.patch;
    const publish = p.publicDirty;
    p.patch = null;
    p.publicDirty = false;
    if (patch) {
      const res = await service.updateList(uid, list.id, patch);
      setSaveError(Boolean(res?.error));
    }
    const { publicCode: code, publicBody: body } = latest.current;
    if (publish && code) {
      const res = await service.updatePublic(uid, code, body());
      // Stopped on another device: show it as not shared.
      if (res?.error === 'not-shared') { setPublicCode(null); setSyncError(false); return; }
      setSyncError(Boolean(res?.error));
    }
  }, [service, uid, list.id]);

  const schedule = useCallback(() => {
    const p = pending.current;
    clearTimeout(p.timer);
    p.timer = setTimeout(flush, saveDelay);
  }, [flush, saveDelay]);

  const save = (patch) => {
    pending.current.patch = { ...(pending.current.patch ?? {}), ...patch };
    schedule();
  };
  const saveItems = (next) => { setItems(next); save({ items: next }); };

  // While shared, keep the public copy current: once prices load (which also
  // refreshes "prices as of") and after every change -- but not straight
  // after sharing, whose write already carried this content, and not after a
  // failed price load, which would publish every price missing.
  useEffect(() => {
    if (!publicCode || prices === null || priceError) return;
    if (pending.current.justShared) { pending.current.justShared = false; return; }
    pending.current.publicDirty = true;
    schedule();
  }, [publicCode, lines, savedName, showPrices]); // eslint-disable-line react-hooks/exhaustive-deps -- publish on content change

  // Leaving (unmount, page close) sends whatever is still waiting.
  useEffect(() => {
    const onUnload = () => { flush(); };
    window.addEventListener('beforeunload', onUnload);
    return () => { window.removeEventListener('beforeunload', onUnload); flush(); };
  }, [flush]);
```

- **`share`:** set `pending.current.justShared = true;` before `setPublicCode(res.code)`.
- **`stopSharing`:** after a successful unshare, set `pending.current.publicDirty = false;`.
- **`del`:** before calling `deleteList`, add `clearTimeout(pending.current.timer); pending.current.patch = null; pending.current.publicDirty = false;`. Never save into a deleted list.
- **Back button:** `onClick={() => { flush(); onBack(); }}`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/__tests__/ListView.test.jsx src/components/__tests__/SavedListsPage.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx vitest run src/components/__tests__/ListView.test.jsx && L=$(npx eslint src --ext js,jsx --quiet 2>/dev/null); [ -n "$L" ] && echo "$L" || { git add src/components/ListView.jsx src/components/__tests__/ListView.test.jsx && git commit -m "feat(polish): debounce list saves; one write on share; honest price dates"; }
```

---

### Task 5: Shared deck shape checks

**Files:**
- Modify: `firestore.rules`, `src/test/rules/firestore.rules.test.js`

**Interfaces:**
- Produces: `publicDecks` create and update also require `isPublicDeckBody()`.

- [ ] **Step 1: Write the failing tests** (inside `describe('public decks', …)`)

```js
  const FULL = {
    deckId: 'd1', uid: 'plain-uid', name: 'Vader Aggro', description: 'Fast', leaderId: 'SOR_010', baseId: 'SOR_020',
    cards: { SOR_050: 3 }, aspects: ['Villainy'], format: 'Premier', tags: ['aggro'], totalCards: 50, publishedAt: 1,
  };

  it('accepts a deck published the way the app publishes', async () => {
    await assertSucceeds(setDoc(doc(asUser('plain-uid'), p('publicDecks', 'abc12345')), FULL));
  });

  it('refuses unexpected or oversized deck content', async () => {
    const db = asUser('plain-uid');
    await assertFails(setDoc(doc(db, p('publicDecks', 'abc12345')), { ...FULL, link: 'https://evil.example' }));
    await assertFails(setDoc(doc(db, p('publicDecks', 'abc12345')), { ...FULL, name: 'x'.repeat(201) }));
    await assertFails(setDoc(doc(db, p('publicDecks', 'abc12345')), { ...FULL, description: 'x'.repeat(2001) }));
    const cards = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`SOR_${i}`, 1]));
    await assertFails(setDoc(doc(db, p('publicDecks', 'abc12345')), { ...FULL, cards }));
    await assertFails(setDoc(doc(db, p('publicDecks', 'abc12345')), { ...FULL, tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }));
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `JAVA_HOME="/c/Program Files/Microsoft/jdk-21.0.12.101-hotspot" PATH="/c/Program Files/Microsoft/jdk-21.0.12.101-hotspot/bin:$PATH" npm run test:rules > /tmp/rules.txt 2>&1; grep -E "Tests |FAIL .*>" /tmp/rules.txt`
Expected: FAIL — "refuses unexpected or oversized deck content".

- [ ] **Step 3: Implement**

In `firestore.rules`, add this function above the `publicDecks` match:

```
    // Shared decks: known fields, bounded size. No slug-format check, so
    // every link already shared keeps working.
    function isPublicDeckBody() {
      let d = request.resource.data;
      return d.keys().hasOnly(['deckId', 'uid', 'name', 'description', 'leaderId', 'baseId', 'cards',
                               'aspects', 'format', 'tags', 'totalCards', 'publishedAt'])
        && d.name is string && d.name.size() <= 200
        && (!('description' in d) || (d.description is string && d.description.size() <= 2000))
        && (!('cards' in d) || (d.cards is map && d.cards.size() <= 200))
        && (!('tags' in d) || (d.tags is list && d.tags.size() <= 20));
    }
```

Then append `&& isPublicDeckBody()` to both the `create` and `update` conditions of `publicDecks`.

- [ ] **Step 4: Run to verify it passes**

Run: the Step 2 command.
Expected: all rules tests pass, including the earlier deck tests (`{ uid, name }` documents still satisfy the shape).

- [ ] **Step 5: Commit**

```bash
git add firestore.rules src/test/rules/firestore.rules.test.js && git commit -m "fix(rules): shape checks for shared decks"
```

---

### Task 6: Import into the collection, as a batch

**Files:**
- Create: `src/services/importBatch.js`
- Modify: `src/services/BatchService.js`
- Test: `src/test/services/importBatch.test.js`, `src/test/services/BatchService.test.js`

**Interfaces:**
- Produces:
  - `BatchService.closeBatch(uid, id, extra = {})` merges `extra` into the close update.
  - `importToCollection({ uid, collectionRef, collectionData, items, mode, name, pricePaid = null, file = null, source = null, deps })`, where `items` = parseCSV items `{ set, number, name, quantity, isFoil }` and `mode` is `'add' | 'replace'`. It returns one of:
    - `{ nothing: true }` — a replace that changed nothing;
    - `{ ok: true, cards, lowered, batchId }` — `batchId` is absent without a `uid`;
    - `{ error, written }` — the write failed part-way;
    - `{ error: 'report', cards, batchId }` — the cards were imported but the report wasn't saved.
  - `deps` overrides `{ commit, writeQuantities, cardDetails, pricing, batches, now, newId }`, for tests.
  - The batch doc gets `source: source ?? { type: 'import', mode, file }` and `reductions: [{ id, set, number, name, isFoil, from, to }]`.

- [ ] **Step 1: Write the failing tests**

`src/test/services/BatchService.test.js`, append:

```js
  it('closes a batch with extra fields', async () => {
    store.docs.set(PATH, { name: 'x' });
    expect(await BatchService.closeBatch('u1', 'b1', { source: { type: 'import' } })).toEqual({ ok: true });
    expect(store.docs.get(PATH)).toMatchObject({ source: { type: 'import' } });
    expect(store.docs.get(PATH).closedAt).toEqual(expect.any(Number));
  });
```

(If the file's existing `describe` structure makes `PATH`/`store` unavailable at the end, place the test inside the main `describe`.)

`src/test/services/importBatch.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../firebase', () => ({ db: {}, APP_ID: 'app' }));
import { importToCollection } from '../../services/importBatch';

const item = (o) => ({ set: 'SOR', number: '010', name: 'Vader', quantity: 1, isFoil: false, ...o });
let deps;
let ids;
beforeEach(() => {
  ids = 0;
  deps = {
    commit: vi.fn(async () => ({ rows: [] })),
    writeQuantities: vi.fn(async () => {}),
    cardDetails: vi.fn(async (set, number) => ({ name: `Card ${number}`, type: 'Unit', rarity: 'Rare', aspects: ['Villainy'], variant: 'Normal' })),
    pricing: { getBulkPrices: vi.fn(async () => ({ SOR_010_std: { market: 2 } })) },
    batches: { appendToBatch: vi.fn(async () => ({ ok: true })), closeBatch: vi.fn(async () => ({ ok: true })) },
    now: () => 100,
    newId: () => `id${++ids}`,
  };
});
const run = (o) => importToCollection({ uid: 'u1', collectionRef: { id: 'ref' }, collectionData: {}, name: 'Import box', file: 'box.csv', deps, ...o });

describe('importToCollection — add', () => {
  it('adds every card, summing rows for the same card, and files a closed batch', async () => {
    const res = await run({ mode: 'add', items: [item({ quantity: 2 }), item({ quantity: 1 }), item({ number: '020', isFoil: true })] });
    expect(res).toEqual({ ok: true, cards: 4, lowered: 0, batchId: 'id1' });
    const draft = deps.commit.mock.calls[0][0];
    expect(draft.rows.map((r) => [r.set, r.number, r.isFoil, r.qty])).toEqual([['SOR', '010', false, 3], ['SOR', '020', true, 1]]);
    const [uid, batch, lines] = deps.batches.appendToBatch.mock.calls[0];
    expect(uid).toBe('u1');
    expect(batch).toEqual({ id: 'id1', name: 'Import box', pricePaid: null, createdAt: 100 });
    expect(lines[0]).toMatchObject({ id: 'SOR_010_std', qty: 3, isNew: true, priceAtAdd: 2, type: 'Unit', rarity: 'Rare' });
    expect(lines[1]).toMatchObject({ id: 'SOR_020_foil', qty: 1, priceAtAdd: null });
    expect(deps.batches.closeBatch).toHaveBeenCalledWith('u1', 'id1', { source: { type: 'import', mode: 'add', file: 'box.csv' }, reductions: [] });
  });

  it('marks cards already owned (any finish) as not new', async () => {
    await run({ mode: 'add', items: [item()], collectionData: { SOR_010_foil: { quantity: 1 } } });
    expect(deps.batches.appendToBatch.mock.calls[0][2][0].isNew).toBe(false);
  });

  it('reports how many cards landed when the commit fails part-way, and files no batch', async () => {
    deps.commit.mockImplementation(async (draft, ref, { onProgress }) => {
      onProgress({ rows: draft.rows.slice(1) });
      throw new Error('offline');
    });
    const res = await run({ mode: 'add', items: [item({ quantity: 2 }), item({ number: '020', quantity: 5 })] });
    expect(res).toEqual({ error: 'offline', written: 2 });
    expect(deps.batches.appendToBatch).not.toHaveBeenCalled();
  });
});

describe('importToCollection — replace', () => {
  const owned = { SOR_010_std: { quantity: 1 }, SOR_020_std: { quantity: 4 }, SOR_030_std: { quantity: 2 } };

  it('records increases as the batch and decreases as reductions', async () => {
    const res = await run({
      mode: 'replace', collectionData: owned,
      items: [item({ quantity: 3 }), item({ number: '020', name: 'Luke', quantity: 1 }), item({ number: '030', quantity: 2 })],
    });
    expect(res).toEqual({ ok: true, cards: 2, lowered: 1, batchId: 'id1' });
    expect(deps.writeQuantities.mock.calls[0][1].map((w) => [w.id, w.quantity])).toEqual([['SOR_010_std', 3], ['SOR_020_std', 1]]);
    const lines = deps.batches.appendToBatch.mock.calls[0][2];
    expect(lines.map((l) => [l.id, l.qty, l.isNew])).toEqual([['SOR_010_std', 2, false]]);
    expect(deps.batches.closeBatch.mock.calls[0][2].reductions).toEqual([
      { id: 'SOR_020_std', set: 'SOR', number: '020', name: 'Luke', isFoil: false, from: 4, to: 1 },
    ]);
  });

  it('changes nothing and files nothing when the collection already matches', async () => {
    const res = await run({ mode: 'replace', collectionData: owned, items: [item({ quantity: 1 })] });
    expect(res).toEqual({ nothing: true });
    expect(deps.writeQuantities).not.toHaveBeenCalled();
    expect(deps.batches.appendToBatch).not.toHaveBeenCalled();
  });

  it('reports cards written before a failure', async () => {
    deps.writeQuantities.mockImplementation(async (ref, writes, { onChunk }) => { onChunk(1); throw new Error('offline'); });
    expect(await run({ mode: 'replace', items: [item({ quantity: 2 })] })).toEqual({ error: 'offline', written: 1 });
  });
});

describe('importToCollection — other', () => {
  it('imports without a report when there is no uid (legacy sync path)', async () => {
    const res = await run({ uid: undefined, mode: 'add', items: [item()] });
    expect(res).toEqual({ ok: true, cards: 1, lowered: 0 });
    expect(deps.batches.appendToBatch).not.toHaveBeenCalled();
  });

  it('keeps the cards when only the report fails', async () => {
    deps.batches.appendToBatch.mockResolvedValue({ error: 'offline' });
    expect(await run({ mode: 'add', items: [item()] })).toEqual({ error: 'report', cards: 1, batchId: 'id1' });
  });

  it('uses a given source (guest merge)', async () => {
    await run({ mode: 'add', items: [item()], source: { type: 'guest' } });
    expect(deps.batches.closeBatch.mock.calls[0][2].source).toEqual({ type: 'guest' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/test/services/importBatch.test.js src/test/services/BatchService.test.js`
Expected: FAIL — cannot resolve `importBatch`; the closeBatch extra fields are missing.

- [ ] **Step 3: Implement**

`BatchService.closeBatch`:

```js
  async closeBatch(uid, id, extra = {}) {
    try {
      await updateDoc(batchRef(uid, id), { ...extra, closedAt: Date.now() });
      return { ok: true };
    } catch (err) {
      return fail(err);
    }
  },
```

`src/services/importBatch.js`:

```js
import { doc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { ScanService, COMMIT_CHUNK_SIZE } from './ScanService';
import { PricingService } from './PricingService';
import { BatchService } from './BatchService';
import { getCardQuantities, getCollectionId } from '../utils/collectionHelpers';

/**
 * A CSV import, recorded as a batch with a report like a scanned box.
 * 'add' adds quantities (like scanning); 'replace' sets each card to the
 * file's number, and its batch holds only what went up -- what went down is
 * listed as reductions. Never throws.
 *
 * @environment:firebase
 */

// Today's import write: set each card's quantity, 400 to a batch.
async function writeQuantities(collectionRef, writes, { onChunk = () => {} } = {}) {
  for (let i = 0; i < writes.length; i += COMMIT_CHUNK_SIZE) {
    const chunk = writes.slice(i, i + COMMIT_CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const w of chunk) {
      batch.set(doc(collectionRef, w.id), {
        quantity: w.quantity, set: w.set, number: w.number, name: w.name, isFoil: w.isFoil, timestamp: Date.now(),
      }, { merge: true });
    }
    await batch.commit();
    onChunk(chunk.reduce((s, w) => s + w.quantity, 0));
  }
}

const defaultId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export async function importToCollection({
  uid, collectionRef, collectionData = {}, items, mode, name, pricePaid = null, file = null, source = null, deps = {},
}) {
  const {
    commit = (d, r, o) => ScanService.commitDraft(d, r, o), writeQuantities: write = writeQuantities,
    cardDetails = (s, n) => ScanService.cardDetails(s, n), pricing = PricingService, batches = BatchService,
    now = Date.now, newId = defaultId,
  } = deps;

  // One entry per card and finish; a card on two rows is summed.
  const byId = new Map();
  for (const it of items ?? []) {
    const id = getCollectionId(it.set, it.number, it.isFoil);
    const prev = byId.get(id);
    byId.set(id, prev ? { ...prev, quantity: prev.quantity + it.quantity } : { ...it, id, number: String(it.number) });
  }
  const entries = [...byId.values()];
  const owned = (id) => Number(collectionData?.[id]?.quantity) || 0;

  const increases = [];
  const reductions = [];
  for (const e of entries) {
    const delta = mode === 'replace' ? e.quantity - owned(e.id) : e.quantity;
    if (delta > 0) increases.push({ ...e, delta });
    if (mode === 'replace' && delta < 0) {
      reductions.push({ id: e.id, set: e.set, number: e.number, name: e.name, isFoil: e.isFoil, from: owned(e.id), to: e.quantity });
    }
  }
  if (mode === 'replace' && increases.length === 0 && reductions.length === 0) return { nothing: true };

  // Write.
  let written = 0;
  try {
    if (mode === 'replace') {
      const changed = entries.filter((e) => e.quantity !== owned(e.id));
      await write(collectionRef, changed, { onChunk: (n) => { written += n; } });
    } else {
      const draft = {
        rows: increases.map((e) => ({ id: newId(), status: 'matched', set: e.set, number: e.number, name: e.name, type: null, isFoil: e.isFoil, qty: e.delta })),
      };
      const total = increases.reduce((s, e) => s + e.delta, 0);
      await commit(draft, collectionRef, {
        onProgress: (remaining) => { written = total - remaining.rows.reduce((s, r) => s + r.qty, 0); },
      });
    }
  } catch (err) {
    return { error: err?.message ?? 'unknown', written };
  }

  const cards = increases.reduce((s, e) => s + e.delta, 0);
  if (!uid) return { ok: true, cards, lowered: reductions.length };

  // The report: details, today's price and whether each card is new.
  const details = await Promise.all(increases.map((e) => cardDetails(e.set, e.number)));
  const prices = await pricing.getBulkPrices(increases.map((e) => ({ cardId: e.id, set: e.set, number: e.number, isFoil: e.isFoil })))
    .catch(() => ({}));
  const lines = increases.map((e, i) => ({
    id: e.id, set: e.set, number: e.number, name: details[i]?.name ?? e.name,
    type: details[i]?.type ?? null, rarity: details[i]?.rarity ?? null, aspects: details[i]?.aspects ?? [],
    variant: details[i]?.variant ?? null, isFoil: e.isFoil, qty: e.delta,
    isNew: getCardQuantities(collectionData, e.set, e.number).total === 0,
    priceAtAdd: typeof prices?.[e.id]?.market === 'number' ? prices[e.id].market : null,
    priceIsFallback: Boolean(prices?.[e.id]?.isFallback),
  }));

  const batch = { id: newId(), name, pricePaid, createdAt: now() };
  const appended = await batches.appendToBatch(uid, batch, lines);
  if (appended?.error) return { error: 'report', cards, batchId: batch.id };
  await batches.closeBatch(uid, batch.id, { source: source ?? { type: 'import', mode, file }, reductions });
  return { ok: true, cards, lowered: reductions.length, batchId: batch.id };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/test/services/importBatch.test.js src/test/services/BatchService.test.js`
Expected: PASS. If `getCardQuantities` reads padded keys differently from `getCollectionId` for the fixtures, fix the fixture (not the code) and ledger it.

- [ ] **Step 5: Commit**

```bash
npx vitest run src/test/services/importBatch.test.js src/test/services/BatchService.test.js && L=$(npx eslint src --ext js,jsx --quiet 2>/dev/null); [ -n "$L" ] && echo "$L" || { git add src/services/importBatch.js src/services/BatchService.js src/test/services/importBatch.test.js src/test/services/BatchService.test.js && git commit -m "feat(polish): imports recorded as batches (add or replace)"; }
```

---

### Task 7: Import dialog, report section, App wiring

**Files:**
- Create: `src/components/ImportDialog.jsx`
- Modify: `src/components/BatchReport.jsx`, `src/App.jsx`
- Test: `src/components/__tests__/ImportDialog.test.jsx`, `src/test/components/BatchReport.test.jsx` (or wherever its existing test lives)

**Interfaces:**
- Consumes: Task 6; `parseCSV` (`{ items, errors }`); `parsePricePaid` (`null` | number | `undefined` for invalid input).
- Produces:
  - `<ImportDialog file uid collectionRef collectionData onClose onImported(batchId) importImpl? parse? />` — `role="dialog"` named `Import cards`.
  - The mode radios are labelled `Add these cards` and `Replace quantities`, with none chosen at first. The other fields are `Batch name` (default `Import <file name without .csv>`) and `Price paid`.
  - The `Import` button stays disabled until a mode is chosen and the file has parsed with at least one card.
  - **Success with a report:** `onImported(batchId)`.
  - **Success without a report** (no uid): a status line "Imported N cards." and a `Done` button.
  - **Nothing changed:** a status line "Nothing changed — your collection already matches this file."
  - **Error:** an alert line "Import stopped after N cards: <error>." In Add mode it adds "Importing again will add those N again."
  - **Report failed:** an alert line "Cards imported, but the report couldn't be saved."
  - **`BatchReport`** shows a `Quantities lowered` section (`data-testid="reductions"`) when `batch.reductions?.length`. Each row reads `{set} {number} {name}{ (foil)} {from} → {to}`.

- [ ] **Step 1: Write the failing tests**

`src/components/__tests__/ImportDialog.test.jsx`:

```jsx
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
```

For `BatchReport`, add a test to its existing test file that loads a batch with `reductions: [{ id: 'SOR_020_std', set: 'SOR', number: '020', name: 'Luke', isFoil: false, from: 4, to: 1 }]`, using the same mocking the file already uses to supply a batch. Assert `screen.getByTestId('reductions')` contains `SOR 020` and `4 → 1`. Find the file with `grep -rl "BatchReport" src/test src/components/__tests__`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/__tests__/ImportDialog.test.jsx` plus the BatchReport test file.
Expected: FAIL — `ImportDialog` is missing; there is no reductions section.

- [ ] **Step 3: Implement**

`src/components/ImportDialog.jsx`:

```jsx
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { parseCSV } from '../utils/csvParser';
import { parsePricePaid } from '../utils/scanDraft';
import { importToCollection } from '../services/importBatch';

const MODES = [
  ['add', 'Add these cards', 'Adds to what you own, like scanning — for a purchase or a trade.'],
  ['replace', 'Replace quantities', 'Sets each card to the number in the file — for restoring a full export.'],
];

/** A CSV import: choose Add or Replace, name the batch, then see its report. */
export default function ImportDialog({
  file, uid, collectionRef, collectionData, onClose, onImported, importImpl = importToCollection, parse = parseCSV,
}) {
  const [parsed, setParsed] = useState(null); // { items, errors } | { failed: true }
  const [mode, setMode] = useState(null);
  const [name, setName] = useState(`Import ${file.name.replace(/\.csv$/i, '')}`);
  const [priceText, setPriceText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { kind: 'status'|'alert', text }

  useEffect(() => {
    let cancelled = false;
    file.text().then((text) => { if (!cancelled) setParsed(parse(text)); })
      .catch(() => { if (!cancelled) setParsed({ failed: true }); });
    return () => { cancelled = true; };
  }, [file, parse]);

  const items = parsed?.items ?? [];
  const cards = items.reduce((s, i) => s + i.quantity, 0);
  const pricePaid = parsePricePaid(priceText);
  const canImport = Boolean(mode) && items.length > 0 && !busy && pricePaid !== undefined && !result;

  const run = async () => {
    setBusy(true);
    const res = await importImpl({
      uid, collectionRef, collectionData, items, mode, name: name.trim() || `Import ${file.name}`, pricePaid: pricePaid ?? null, file: file.name,
    });
    setBusy(false);
    if (res.batchId && res.ok) { onImported(res.batchId); return; }
    if (res.nothing) setResult({ kind: 'status', text: 'Nothing changed — your collection already matches this file.' });
    else if (res.ok) setResult({ kind: 'status', text: `Imported ${res.cards} cards.` });
    else if (res.error === 'report') setResult({ kind: 'alert', text: "Cards imported, but the report couldn't be saved." });
    else {
      const again = mode === 'add' && res.written ? ` Importing again will add those ${res.written} again.` : '';
      setResult({ kind: 'alert', text: `Import stopped after ${res.written ?? 0} cards: ${res.error}.${again}` });
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4">
      <div role="dialog" aria-label="Import cards" className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl bg-gray-900 border border-gray-700 p-4 space-y-3 text-gray-100">
        <h3 className="text-lg font-bold">Import cards</h3>
        <p className="text-sm text-gray-400 break-words">{file.name}</p>
        {parsed === null && <p className="text-sm text-gray-400">Reading file…</p>}
        {parsed?.failed && <p role="alert" className="text-sm text-red-400">Couldn&apos;t read this file.</p>}
        {parsed && !parsed.failed && (items.length === 0
          ? <p className="text-sm text-yellow-300">No cards found in this file.</p>
          : (
            <p className="text-sm">
              {cards} cards in {items.length} {items.length === 1 ? 'row' : 'rows'}
              {parsed.errors?.length > 0 && <span className="text-yellow-300"> · {parsed.errors.length} {parsed.errors.length === 1 ? 'row' : 'rows'} skipped</span>}
            </p>
          ))}

        <fieldset className="space-y-2">
          <legend className="text-xs uppercase tracking-wide text-gray-500">How to import</legend>
          {MODES.map(([id, label, hint]) => (
            <label key={id} className="flex items-start gap-2">
              <input type="radio" name="import-mode" checked={mode === id} onChange={() => setMode(id)} className="mt-1" />
              <span><span className="block">{label}</span><span className="block text-xs text-gray-400">{hint}</span></span>
            </label>
          ))}
        </fieldset>

        <label className="flex flex-col gap-1 text-xs text-gray-400">
          Batch name
          <input aria-label="Batch name" value={name} onChange={(e) => setName(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-100" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-400">
          Price paid (optional)
          <input aria-label="Price paid" inputMode="decimal" value={priceText} onChange={(e) => setPriceText(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-100" />
        </label>
        {pricePaid === undefined && <p className="text-xs text-red-400">Enter a price like 12.50, or leave it empty.</p>}

        {result && <p role={result.kind} className={`text-sm ${result.kind === 'alert' ? 'text-red-400' : 'text-green-400'}`}>{result.text}</p>}

        <div className="flex gap-2 justify-end">
          {result ? (
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-yellow-500 text-black font-semibold">Done</button>
          ) : (
            <>
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-gray-800">Cancel</button>
              <button type="button" onClick={run} disabled={!canImport}
                className="px-4 py-2 rounded-lg bg-yellow-500 text-black font-semibold disabled:opacity-40">{busy ? 'Importing…' : 'Import'}</button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
```

`BatchReport.jsx`: after the `unpriced` CardList line, add:

```jsx
      {batch.reductions?.length > 0 && (
        <section className="break-inside-avoid">
          <h3 className="text-sm font-semibold text-gray-300 mb-1 print:text-black">Quantities lowered</h3>
          <ul data-testid="reductions" className="text-sm divide-y divide-gray-800 print:divide-gray-200">
            {batch.reductions.map((r) => (
              <li key={r.id} className="py-1 flex gap-2">
                <span className="text-gray-500 w-20 flex-shrink-0">{r.set} {r.number}</span>
                <span className="flex-1 min-w-0 break-words">{r.name}{r.isFoil ? ' (foil)' : ''}</span>
                <span>{r.from} → {r.to}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
```

Use whatever variable holds the loaded batch document in that component (`batch`). If the component's `return` sits behind early returns for loading, place the JSX in the final render only. No new hooks are needed.

`App.jsx`:
- Imports: `ImportDialog` and `BatchReport` (if not already imported).
- State: `const [importFile, setImportFile] = useState(null);` and `const [reportBatchId, setReportBatchId] = useState(null);` next to the other state.
- Replace the body of `handleFileUpload` with:

```jsx
  const handleFileUpload = (event) => {
    const file = event.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (file) setImportFile(file);
  };
```

- Delete the now-unused `importing` state and its `setImporting` calls. `Dashboard`'s `isImporting` becomes `isImporting={Boolean(importFile)}`. If `parseCSV` becomes unused in App, remove its import.
- Render next to the other overlays:

```jsx
      {importFile && (
        <ImportDialog
          file={importFile}
          uid={useLegacyPath ? undefined : user?.uid}
          collectionRef={getCollectionRef(user, legacySyncCode, useLegacyPath)}
          collectionData={collectionData}
          onClose={() => setImportFile(null)}
          onImported={(batchId) => { setImportFile(null); setBatchesRefresh((n) => n + 1); setReportBatchId(batchId); }}
        />
      )}
      {reportBatchId && user?.uid && (
        <BatchReport uid={user.uid} batchId={reportBatchId} onClose={() => setReportBatchId(null)} onDeleted={() => { setReportBatchId(null); setBatchesRefresh((n) => n + 1); }} />
      )}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/__tests__/ImportDialog.test.jsx` plus the BatchReport test file, then `npx vitest run src/test/components src/test/integration 2>&1 | tail -n 5` to catch App-level import tests.
Expected: PASS. Any existing App test that drove the old alert-based import must be updated to the dialog flow; ledger each one.

- [ ] **Step 5: Commit**

```bash
L=$(npx eslint src --ext js,jsx --quiet 2>/dev/null); [ -n "$L" ] && echo "$L" || { git add src/components/ImportDialog.jsx src/components/BatchReport.jsx src/App.jsx src/components/__tests__ src/test && git commit -m "feat(polish): import dialog with add/replace and a batch report"; }
```

---

### Task 8: Guest upgrade

**Files:**
- Create: `src/services/guestUpgrade.js`
- Modify: `src/contexts/AuthContext.jsx`
- Test: `src/test/services/guestUpgrade.test.js`, `src/test/contexts/AuthContext.test.jsx`

**Interfaces:**
- Consumes: `importToCollection` (Task 6).
- Produces:
  - `upgradeGuest({ auth, provider, deps }) → { kind: 'linked', user }` | `{ kind: 'merged', user, cards }` | `{ kind: 'copy-failed', user, csv }`. It throws the original error for anything other than `credential-already-in-use`, such as a closed popup.
  - `AuthContext`: when `auth.currentUser?.isAnonymous`, `loginWithGoogle` uses `upgradeGuest`. The context exposes `upgrade` (the last result without `user`, or `{ kind: 'error', message }`) and `dismissUpgrade()`. After `linked`, the context re-renders so `user.isAnonymous` reads `false`.

- [ ] **Step 1: Write the failing tests**

`src/test/services/guestUpgrade.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../firebase', () => ({ db: {}, APP_ID: 'app' }));
import { upgradeGuest } from '../../services/guestUpgrade';

const guest = { uid: 'guest1', isAnonymous: true };
const auth = { currentUser: guest };
const inUse = Object.assign(new Error('in use'), { code: 'auth/credential-already-in-use' });
let deps;
beforeEach(() => {
  deps = {
    linkWithPopup: vi.fn(async () => ({ user: { ...guest, isAnonymous: false } })),
    credentialFromError: vi.fn(() => ({ token: 't' })),
    signInWithCredential: vi.fn(async () => ({ user: { uid: 'google1', isAnonymous: false } })),
    readCollection: vi.fn(async (uid) => (uid === 'guest1'
      ? { SOR_010_std: { quantity: 2, set: 'SOR', number: '010', name: 'Vader', isFoil: false } }
      : { SOR_010_std: { quantity: 1, set: 'SOR', number: '010', name: 'Vader', isFoil: false } })),
    collectionRefFor: vi.fn((uid) => ({ uid })),
    importToCollection: vi.fn(async () => ({ ok: true, cards: 2, lowered: 0, batchId: 'b1' })),
  };
});

describe('upgradeGuest', () => {
  it('links Google to the guest: same uid, nothing to copy', async () => {
    const res = await upgradeGuest({ auth, provider: {}, deps });
    expect(res.kind).toBe('linked');
    expect(deps.linkWithPopup).toHaveBeenCalledWith(guest, {});
    expect(deps.importToCollection).not.toHaveBeenCalled();
  });

  it('merges the guest cards into an existing Google account, read before switching', async () => {
    deps.linkWithPopup.mockRejectedValue(inUse);
    const order = [];
    deps.readCollection.mockImplementation(async (uid) => { order.push(`read:${uid}`); return uid === 'guest1' ? { SOR_010_std: { quantity: 2, set: 'SOR', number: '010', name: 'Vader', isFoil: false } } : {}; });
    deps.signInWithCredential.mockImplementation(async () => { order.push('signin'); return { user: { uid: 'google1', isAnonymous: false } }; });
    const res = await upgradeGuest({ auth, provider: {}, deps });
    expect(order).toEqual(['read:guest1', 'signin', 'read:google1']);
    expect(res).toMatchObject({ kind: 'merged', cards: 2 });
    expect(deps.importToCollection).toHaveBeenCalledWith(expect.objectContaining({
      uid: 'google1', collectionRef: { uid: 'google1' }, mode: 'add', name: 'Guest collection', source: { type: 'guest' },
      items: [{ set: 'SOR', number: '010', name: 'Vader', quantity: 2, isFoil: false }],
    }));
  });

  it('offers the guest cards as a CSV when copying fails', async () => {
    deps.linkWithPopup.mockRejectedValue(inUse);
    deps.importToCollection.mockResolvedValue({ error: 'offline', written: 0 });
    const res = await upgradeGuest({ auth, provider: {}, deps });
    expect(res.kind).toBe('copy-failed');
    expect(res.csv).toContain('SOR,010,"Vader",2,');
  });

  it('passes other errors (popup closed) through untouched', async () => {
    const closed = Object.assign(new Error('closed'), { code: 'auth/popup-closed-by-user' });
    deps.linkWithPopup.mockRejectedValue(closed);
    await expect(upgradeGuest({ auth, provider: {}, deps })).rejects.toBe(closed);
    expect(deps.signInWithCredential).not.toHaveBeenCalled();
  });

  it('merges nothing for a guest with an empty collection', async () => {
    deps.linkWithPopup.mockRejectedValue(inUse);
    deps.readCollection.mockResolvedValue({});
    const res = await upgradeGuest({ auth, provider: {}, deps });
    expect(res).toMatchObject({ kind: 'merged', cards: 0 });
    expect(deps.importToCollection).not.toHaveBeenCalled();
  });
});
```

`src/test/contexts/AuthContext.test.jsx`: extend the `firebase/auth` mock with `linkWithPopup: (...a) => mockLinkWithPopup(...a)`, `signInWithCredential: vi.fn()`, and `GoogleAuthProvider.credentialFromError: vi.fn()`. Make the existing `GoogleAuthProvider` mock a function with that static property attached. Add `vi.mock('../../services/guestUpgrade', () => ({ upgradeGuest: (...a) => mockUpgradeGuest(...a) }))`. Then add:

```jsx
  it('upgrades a guest in place instead of signing in fresh', async () => {
    // Arrange the harness's auth state to a guest (mirror how existing tests
    // set a signed-in user via mockOnAuthStateChanged), with auth.currentUser
    // set to the same guest object.
    // mockUpgradeGuest resolves { kind: 'linked', user: guestObjectMutatedToNonAnonymous }.
    // Trigger loginWithGoogle; expect mockUpgradeGuest called, mockSignInWithPopup not called,
    // and the harness's rendered isAnonymous flag now reads false.
  });

  it('keeps popup sign-in for someone who is not a guest', async () => {
    // No current user (or a non-anonymous one): loginWithGoogle uses signInWithPopup.
  });
```

Write these two using the file's existing `Harness` pattern. The harness may need to render `String(user?.isAnonymous)` and `upgrade?.kind`; add that to the harness. Because the `firebase` mock is `{ auth: {}, … }`, set `auth.currentUser` by importing the mocked `auth` object in the test and assigning to it.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/test/services/guestUpgrade.test.js src/test/contexts/AuthContext.test.jsx`
Expected: FAIL — no `guestUpgrade`; `loginWithGoogle` always uses the popup.

- [ ] **Step 3: Implement**

`src/services/guestUpgrade.js`:

```js
import { GoogleAuthProvider, linkWithPopup, signInWithCredential } from 'firebase/auth';
import { collection, getDocs } from 'firebase/firestore';
import { db, APP_ID } from '../firebase';
import { importToCollection } from './importBatch';
import { generateCSV } from '../utils/csvParser';

/**
 * A guest signing in with Google. Linking keeps the guest's uid, so
 * everything stays. When that Google account already exists, the guest's
 * cards are read first (the guest's data is unreadable once signed out of
 * it), then added into the Google account's collection as a batch.
 *
 * @environment:firebase
 */
const collectionRefFor = (uid) => collection(db, 'artifacts', APP_ID, 'users', uid, 'collection');
const readCollection = async (uid) => {
  const snap = await getDocs(collectionRefFor(uid));
  return Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
};

export async function upgradeGuest({ auth, provider, deps = {} }) {
  const d = {
    linkWithPopup, signInWithCredential, credentialFromError: (e) => GoogleAuthProvider.credentialFromError(e),
    readCollection, collectionRefFor, importToCollection, ...deps,
  };
  const guest = auth.currentUser;
  try {
    const res = await d.linkWithPopup(guest, provider);
    return { kind: 'linked', user: res.user };
  } catch (err) {
    if (err?.code !== 'auth/credential-already-in-use') throw err;
    const credential = d.credentialFromError(err);
    if (!credential) throw err;

    const guestCards = await d.readCollection(guest.uid).catch(() => ({}));
    const { user } = await d.signInWithCredential(auth, credential);
    const items = Object.values(guestCards)
      .filter((c) => (Number(c?.quantity) || 0) > 0 && c.set && c.number)
      .map((c) => ({ set: c.set, number: String(c.number), name: c.name ?? '', quantity: Number(c.quantity), isFoil: Boolean(c.isFoil) }));
    if (items.length === 0) return { kind: 'merged', user, cards: 0 };

    const target = await d.readCollection(user.uid).catch(() => ({}));
    const res = await d.importToCollection({
      uid: user.uid, collectionRef: d.collectionRefFor(user.uid), collectionData: target, items,
      mode: 'add', name: 'Guest collection', source: { type: 'guest' },
    });
    if (res?.ok || res?.error === 'report') return { kind: 'merged', user, cards: res.cards ?? items.reduce((s, i) => s + i.quantity, 0) };
    return { kind: 'copy-failed', user, csv: generateCSV(guestCards) };
  }
}
```

`AuthContext.jsx`:
- Imports: `useReducer`; `import { upgradeGuest } from '../services/guestUpgrade';`.
- State: `const [upgrade, setUpgrade] = useState(null);` and `const [, rerender] = useReducer((n) => n + 1, 0);`.
- In `loginWithGoogle`, after creating `provider`:

```jsx
      if (auth.currentUser?.isAnonymous) {
        try {
          const res = await upgradeGuest({ auth, provider });
          const { user: upgraded, ...outcome } = res;
          setUpgrade(outcome);
          // Linking keeps the same user object (no auth-state event): re-render
          // so isAnonymous reads false everywhere.
          if (res.kind === 'linked') rerender();
          return upgraded;
        } catch (err) {
          if (err?.code !== 'auth/popup-closed-by-user' && err?.code !== 'auth/cancelled-popup-request') {
            setUpgrade({ kind: 'error', message: err?.message ?? 'Sign-in failed' });
          }
          throw err;
        }
      }
```

- Add `upgrade` and `dismissUpgrade: () => setUpgrade(null)` to `value`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/test/services/guestUpgrade.test.js src/test/contexts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx vitest run src/test/services/guestUpgrade.test.js src/test/contexts && L=$(npx eslint src --ext js,jsx --quiet 2>/dev/null); [ -n "$L" ] && echo "$L" || { git add src/services/guestUpgrade.js src/contexts/AuthContext.jsx src/test/services/guestUpgrade.test.js src/test/contexts && git commit -m "feat(polish): guests upgrade to Google without losing their collection"; }
```

---

### Task 9: Upgrade buttons and notice; docs; full gate

**Files:**
- Modify: `src/App.jsx`, `src/components/MobileNav.jsx`, `CLAUDE.md` (git root)
- Test: `src/components/__tests__/MobileNav.test.jsx`, plus App-level tests in `src/test/components/` (pick the test file that already renders App with a mocked `useAuth`, e.g. `CommandCenterReports.test.jsx`, and add the tests there)

**Interfaces:**
- Consumes: `upgrade` and `dismissUpgrade` from `useAuth()` (Task 8).
- Produces:
  - **Guests:** the desktop header shows a `Sign in with Google` button beside Log out; `MobileNav` takes `onUpgrade` and shows `Sign in with Google` in the Me sheet for guests only.
  - **`App`** renders a dismissible notice (`role="status"`) from `upgrade`:
    - `linked` — "Signed in with Google — your collection is kept."
    - `merged` — "Signed in — your guest collection is now in this account (N cards). Guest decks and lists weren't moved."
    - `copy-failed` — "Signed in, but your guest cards couldn't be copied." plus a `Download guest cards (CSV)` button (`downloadText(csv, 'guest-collection.csv')`).
    - `error` — "Google sign-in failed: <message>".
    - Every notice has a `Dismiss` button.

- [ ] **Step 1: Write the failing tests**

`MobileNav.test.jsx`, add (using the file's existing render helper and props):

```jsx
  it('offers guests a Google sign-in that keeps their collection', () => {
    const onUpgrade = vi.fn();
    // render with user={{ isAnonymous: true }} and onUpgrade, open the Me sheet as existing tests do
    // click 'Sign in with Google'; expect onUpgrade called
  });
  it('does not offer it to a Google user', () => {
    // render with user={{ isAnonymous: false, email: 'a@b.c' }}; open Me; expect no 'Sign in with Google'
  });
```

App-level test (in the chosen file, with its `useAuth` mock extended to return `upgrade` and `dismissUpgrade`):

```jsx
  it('shows the guest-merge notice and offers the CSV when copying failed', async () => {
    // mockAuthState.upgrade = { kind: 'copy-failed', csv: 'Set,Number\nSOR,010' }
    // render(<App />); expect findByText(/couldn't be copied/) and a 'Download guest cards (CSV)' button
  });
```

Fill in these bodies against the files' existing helpers. They must assert exactly the behaviour named in the comments.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/__tests__/MobileNav.test.jsx src/test/components`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement**

`MobileNav.jsx`:
- Add `onUpgrade` to the props.
- In the Me sheet, before `Submit missing card`:

```jsx
            {user?.isAnonymous && onUpgrade && (
              <button type="button" onClick={act(onUpgrade)} className={sheetItem}>
                <LogIn size={18} aria-hidden="true" /> Sign in with Google
              </button>
            )}
```

- Add `LogIn` to its lucide import.

`App.jsx`:
- Destructure `upgrade, dismissUpgrade` from `useAuth()`.
- Add:

```jsx
  const handleUpgrade = async () => {
    try {
      await loginWithGoogle();
    } catch {
      // AuthContext records anything worth showing in `upgrade`.
    }
  };
```

- In the desktop user block, before the `Log out` button:

```jsx
                    {user.isAnonymous && (
                      <button onClick={handleUpgrade} className="text-yellow-400 hover:text-yellow-300 text-[11px] font-semibold">
                        Sign in with Google
                      </button>
                    )}
```

- Pass `onUpgrade={handleUpgrade}` to `<MobileNav>`.
- Import `downloadText` from `./utils/downloadText`, and render near the other overlays:

```jsx
      {upgrade && (
        <div role="status" className="fixed top-3 left-1/2 -translate-x-1/2 z-[95] w-[calc(100%-2rem)] max-w-md rounded-xl bg-gray-900 border border-gray-700 p-3 text-sm text-gray-100 shadow-xl space-y-2">
          <p>
            {upgrade.kind === 'linked' && 'Signed in with Google — your collection is kept.'}
            {upgrade.kind === 'merged' && `Signed in — your guest collection is now in this account (${upgrade.cards} cards). Guest decks and lists weren't moved.`}
            {upgrade.kind === 'copy-failed' && "Signed in, but your guest cards couldn't be copied."}
            {upgrade.kind === 'error' && `Google sign-in failed: ${upgrade.message}`}
          </p>
          <div className="flex gap-2 justify-end">
            {upgrade.kind === 'copy-failed' && (
              <button type="button" onClick={() => downloadText(upgrade.csv, 'guest-collection.csv')} className="px-3 py-1.5 rounded-lg bg-yellow-500 text-black font-semibold">
                Download guest cards (CSV)
              </button>
            )}
            <button type="button" onClick={dismissUpgrade} className="px-3 py-1.5 rounded-lg bg-gray-800">Dismiss</button>
          </div>
        </div>
      )}
```

`CLAUDE.md`:
- **Guest mode section:** replace the paragraphs saying sign-in issues a different uid and nothing migrates, and the "fix, if this is picked up" line, with:
  > A signed-in guest gets **Sign in with Google** in the header and the Me sheet. `upgradeGuest` (`src/services/guestUpgrade.js`) links the Google account to the guest (`linkWithPopup`), keeping the uid and everything under it. If that Google account already exists (`credential-already-in-use`), the guest's collection is read first, then the existing account is signed in and the cards are added to it as a "Guest collection" batch; guest decks and lists are not moved. A failed copy offers the guest cards as a CSV.

  Keep the warning that clearing site data while still a guest loses the account.
- **Batches bullet:** add
  > CSV imports are batches too: **Import cards** (`ImportDialog`) asks Add (additive, like scanning) or Replace (today's overwrite) and opens the batch report (`importBatch.js`). A Replace batch holds only the increases; decreases are stored as `reductions` and listed under "Quantities lowered".
- **Elsewhere:**
  - Change "Commits are **additive** (`increment`), unlike CSV import, which overwrites." to say CSV import overwrites only in Replace mode.
  - Add to the saved-lists paragraph: copied text is escaped and split for Discord's 2000-character limit (`discordText.js`, `CopyTextButton`), and list edits save after an 800 ms pause.
  - Add to the rules note: `publicDecks` writes are shape-checked too.

- [ ] **Step 4: Full gate**

Run: `npm run test:unit > /tmp/unit.txt 2>&1; tail -n 6 /tmp/unit.txt`
Expected: all pass.

Run: `JAVA_HOME="/c/Program Files/Microsoft/jdk-21.0.12.101-hotspot" PATH="/c/Program Files/Microsoft/jdk-21.0.12.101-hotspot/bin:$PATH" npm run test:rules > /tmp/rules.txt 2>&1; grep -E "Tests " /tmp/rules.txt`
Expected: all pass.

Run: `npm run build 2>&1 | tail -n 3`
Expected: `✓ built in …`.

- [ ] **Step 5: Commit**

```bash
L=$(npx eslint src --ext js,jsx --quiet 2>/dev/null); [ -n "$L" ] && echo "$L" || { git add src/App.jsx src/components/MobileNav.jsx src/components/__tests__/MobileNav.test.jsx src/test ../CLAUDE.md && git commit -m "feat(polish): guest sign-in with Google, upgrade notice; docs"; }
```
