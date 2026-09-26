# Deck builder nits — reported 2026-09-26

Observed on the live site after PR #14. Ordered roughly by impact, not by
report order. None investigated yet beyond what is noted.

## 1. Card variant selection picks the wrong printing  ← highest impact

Searching `Fett's Firespray: Feared Silhouette` returns the **prestige variant**
rather than the base card, then reports it missing from the collection because
the user owns the base, not the prestige.

**Maintainer's rule for identity:** a card is identified by **name + subtitle**;
among printings sharing that identity, **the lowest card number is the base
card**.

Two places get this wrong today, and one of them is worse than the report
suggests:

- `AdvancedSearch.jsx` dedupes by `` `${card.Name}${card.Subtitle || ''}` ``
  (correct identity) but keeps the **first occurrence in filter order**, which
  is not necessarily the lowest number. Needs to keep the lowest card number.
- `src/utils/suggestionRanking.js` dedupes by **name only**, ignoring subtitle.
  That is wrong by the rule above: two genuinely different cards sharing a name
  but differing by subtitle collapse into one, and the survivor is whichever
  scored higher rather than the base printing. Added in the AI-suggestions
  ranking work; not reported, found while writing this up.

Both want a shared helper — identity is `name + subtitle`, preferred printing is
the lowest numeric card number — so the two paths cannot drift apart again.

## 2. Leader and base card frames are vertical, cards are horizontal

On the Deck tab the frame for leaders and bases uses the portrait aspect ratio,
so most of the card is cut off. CLAUDE.md already records the convention:
horizontal cards are `aspect-[88/63] col-span-2`, everything else
`aspect-[63/88] col-span-1`. The deck tab is not applying it.

## 3. Cost curve graph does not populate

The chart on the Deck tab renders empty. Not investigated — could be the data
shape, the cost field type (the pipeline now stores numbers where swu-db gave
strings), or the chart component itself.

## 4. Tag input sticks after adding a tag

After adding a tag the field will not accept another until focus moves
elsewhere and back. Likely a focus or controlled-input reset issue in the tag
handler.

## 5. Add to collection from the shopping tab

Feature request: buying a card at a local store should be addable to the
collection directly from the shopping list, without navigating to the binder.
Fits the project's standing rule that collection controls stay inline
(see CLAUDE.md, House rules).

## 6. Pricing warning with no key configured

The shopping tab shows "Pricing not available: add VITE_TCGAPI_KEY to .env to
see prices." Decide whether to configure a key, hide the pricing UI when
unconfigured, or drop the feature. A warning about a missing dev-environment
variable should not reach end users either way.

## 7. Sticky search bar wiggles

The search bar now holds position (fixed in PR #14) but shifts slightly while
scrolling. Cosmetic. Likely a sub-pixel or padding interaction with the
backdrop blur on the sticky wrapper.
