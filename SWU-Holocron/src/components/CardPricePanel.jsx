import React, { useEffect, useState } from 'react';
import { DollarSign } from 'lucide-react';
import { PricingService } from '../services/PricingService';
import { getCardQuantities } from '../utils/collectionHelpers';

/**
 * Today's market price of one card, standard and foil (TCGplayer, via the
 * weekly price sync), and what the copies you own are worth. Loads on its own
 * so it never holds up the card view.
 */
const money = (v) => `$${v.toFixed(2)}`;
const isPriced = (p) => typeof p?.market === 'number' && Number.isFinite(p.market);

function PriceRow({ label, price, other }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-gray-400">{label}</span>
      {isPriced(price) ? (
        <span>
          {price.url ? (
            <a href={price.url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">{money(price.market)}</a>
          ) : (
            <span>{money(price.market)}</span>
          )}
          {price.isFallback && <span className="text-xs text-gray-500"> (from {other})</span>}
        </span>
      ) : (
        <span className="text-gray-500">No price data</span>
      )}
    </div>
  );
}

export default function CardPricePanel({ card, collectionData = {}, getCardPrice = PricingService.getCardPrice }) {
  // undefined while loading, null on error, else { std, foil }.
  const [prices, setPrices] = useState(undefined);

  useEffect(() => {
    let cancelled = false;
    setPrices(undefined);
    Promise.all([getCardPrice(card.Set, card.Number, false), getCardPrice(card.Set, card.Number, true)])
      .then(([std, foil]) => { if (!cancelled) setPrices({ std, foil }); })
      .catch(() => { if (!cancelled) setPrices(null); });
    return () => { cancelled = true; };
  }, [card.Set, card.Number, getCardPrice]);

  const { standard, foil } = getCardQuantities(collectionData, card.Set, card.Number);
  let copies = null;
  if (prices && standard + foil > 0) {
    const parts = [[standard, prices.std], [foil, prices.foil]].filter(([n]) => n > 0);
    const total = parts.reduce((s, [n, p]) => s + (isPriced(p) ? n * p.market : 0), 0);
    const approx = parts.some(([, p]) => !isPriced(p));
    copies = `${standard} + ${foil}F = ${approx ? '≈' : ''}${money(total)}`;
  }

  return (
    <div className="mt-4 bg-gray-800/50 p-4 rounded-xl border border-gray-700 text-sm space-y-1.5">
      <p className="flex items-center gap-1 font-semibold text-white">
        <DollarSign size={14} aria-hidden="true" /> Market price
      </p>
      {prices === undefined && <p className="text-gray-500">Loading…</p>}
      {prices === null && <p className="text-gray-500">Price unavailable</p>}
      {prices && (
        <>
          <PriceRow label="Standard" price={prices.std} other="foil" />
          <PriceRow label="Foil" price={prices.foil} other="standard" />
          {copies && (
            <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-gray-700">
              <span className="text-gray-400">Your copies</span>
              <span className="font-semibold text-white">{copies}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
