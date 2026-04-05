import React, { useState, useEffect, useMemo } from 'react';
import {
  ShoppingCart, ExternalLink, DollarSign, Loader2, AlertCircle
} from 'lucide-react';
import { PricingService } from '../services/PricingService';

/**
 * ShoppingList — Panel component showing cards needed to complete a deck
 *
 * Props:
 * - deck: { cards: {cardId: count}, leaderId, baseId }
 * - collectionData: { 'SOR_008_std': { quantity: N } }
 * - cardDatabase: array of card objects with { Set, Number, Name }
 */
export default function ShoppingList({ deck, collectionData, cardDatabase }) {
  const [prices, setPrices] = useState({});
  const [loading, setLoading] = useState(false);
  const [apiKeyMissing, setApiKeyMissing] = useState(false);

  // Compute cards needed to acquire
  const gapCards = useMemo(() => {
    if (!deck || !deck.cards) return [];

    const gaps = [];

    Object.entries(deck.cards).forEach(([cardId, needed]) => {
      // Find card in database
      const card = cardDatabase?.find(c => `${c.Set}_${c.Number}` === cardId);
      if (!card) return;

      // Check collection (both std and foil variants)
      const owned =
        (collectionData?.[`${cardId}_std`]?.quantity || 0) +
        (collectionData?.[`${cardId}_foil`]?.quantity || 0);

      const gap = needed - owned;
      if (gap > 0) {
        gaps.push({
          cardId,
          cardName: card.Name,
          needed,
          owned,
          gap,
          card
        });
      }
    });

    return gaps;
  }, [deck, collectionData, cardDatabase]);

  // Fetch prices for gap cards
  useEffect(() => {
    if (gapCards.length === 0) {
      setLoading(false);
      return;
    }

    const fetchPrices = async () => {
      setLoading(true);
      setApiKeyMissing(false);

      // Check if API key is configured
      const apiKey = import.meta.env.VITE_TCGAPI_KEY;
      if (!apiKey) {
        setApiKeyMissing(true);
        setLoading(false);
        return;
      }

      try {
        const cardsToPrice = gapCards.map(g => ({
          cardId: g.cardId,
          cardName: g.cardName
        }));

        const priceMap = await PricingService.getBulkPrices(cardsToPrice);
        setPrices(priceMap);
      } catch (error) {
        console.error('ShoppingList: Error fetching prices:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchPrices();
  }, [gapCards]);

  // Compute total acquisition cost
  const totalCost = useMemo(() => {
    let total = 0;
    gapCards.forEach(gap => {
      const priceData = prices[gap.cardId];
      if (priceData?.marketPrice) {
        total += gap.gap * priceData.marketPrice;
      }
    });
    return total;
  }, [gapCards, prices]);

  // Empty state: deck complete
  if (gapCards.length === 0 && !loading) {
    return (
      <div className="p-6 bg-gradient-to-b from-green-900/20 to-transparent border border-green-500/30 rounded-lg">
        <div className="flex items-center gap-3 text-green-400">
          <ShoppingCart size={20} />
          <div>
            <p className="font-semibold">You own everything!</p>
            <p className="text-sm text-green-400/70">All cards in this deck are in your collection.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 bg-zinc-900/50 border border-zinc-700 rounded-lg p-4">
      {/* Header */}
      <div className="flex items-center gap-2 pb-3 border-b border-zinc-700">
        <ShoppingCart size={18} className="text-amber-400" />
        <h3 className="font-semibold text-zinc-100">Shopping List</h3>
        <span className="ml-auto text-sm text-zinc-400">{gapCards.length} cards needed</span>
      </div>

      {/* API Key Missing Message */}
      {apiKeyMissing && (
        <div className="p-3 bg-amber-900/20 border border-amber-700/50 rounded flex gap-3 items-start">
          <AlertCircle size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-amber-200">
            <p className="font-semibold">Pricing not available</p>
            <p className="text-amber-200/70 text-xs mt-1">
              Add <code className="bg-zinc-800 px-1 rounded text-amber-300">VITE_TCGAPI_KEY</code> to <code className="bg-zinc-800 px-1 rounded text-amber-300">.env</code> to see prices
            </p>
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center gap-2 py-6 text-zinc-400">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">Fetching prices...</span>
        </div>
      )}

      {/* Card List */}
      {!loading && (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {gapCards.map(gap => {
            const priceData = prices[gap.cardId];
            const subtotal = gap.gap * (priceData?.marketPrice || 0);

            return (
              <div
                key={gap.cardId}
                className="p-3 bg-zinc-800/50 border border-zinc-700 rounded-md hover:border-zinc-600 transition"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-zinc-100 truncate">{gap.cardName}</p>
                    <p className="text-xs text-zinc-400">
                      <span className="text-green-400">Own: {gap.owned}</span>
                      {' '}
                      <span className="text-amber-400">Need: {gap.needed}</span>
                      {' '}
                      <span className="text-yellow-400">Gap: {gap.gap}</span>
                    </p>
                  </div>

                  {/* TCGplayer Link */}
                  <a
                    href={PricingService.getTCGPlayerUrl(gap.cardName)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 hover:bg-blue-500/20 text-blue-400 hover:text-blue-300 rounded transition"
                    title="Search on TCGplayer"
                  >
                    <ExternalLink size={14} />
                  </a>
                </div>

                {/* Price Row */}
                {priceData ? (
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <DollarSign size={13} className="text-yellow-400" />
                      <span className="text-yellow-400 font-semibold">
                        {PricingService.formatPrice(priceData.marketPrice)}
                      </span>
                      <span className="text-zinc-500 text-xs">
                        × {gap.gap}
                      </span>
                    </div>
                    <div className="text-right">
                      <p className="text-yellow-300 font-semibold">
                        {PricingService.formatPrice(subtotal)}
                      </p>
                      {priceData.lowPrice && priceData.highPrice && (
                        <p className="text-xs text-zinc-400">
                          {PricingService.formatPrice(priceData.lowPrice)}
                          {' '}–{' '}
                          {PricingService.formatPrice(priceData.highPrice)}
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-zinc-500 italic">Price not available</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Total Cost Footer */}
      {!loading && gapCards.length > 0 && (
        <div className="pt-3 border-t border-zinc-700 flex items-center justify-between">
          <span className="text-sm font-medium text-zinc-300">Total Acquisition Cost</span>
          <div className="text-right">
            <p className="text-lg font-bold text-yellow-300">
              {PricingService.formatPrice(totalCost)}
            </p>
            {totalCost > 0 && (
              <p className="text-xs text-zinc-400">
                for {gapCards.reduce((sum, g) => sum + g.gap, 0)} cards
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
