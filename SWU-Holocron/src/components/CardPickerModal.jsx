import React, { useState, useEffect, useMemo } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { SETS } from '../constants';
import { CardService } from '../services/CardService';
import { getCardQuantities } from '../utils/collectionHelpers';

/**
 * CardPickerModal — full-screen overlay for selecting a specific card type
 * (used for Leader and Base selection in DeckBuilder)
 * Renders above DeckBuilder (z-[60] > DeckBuilder's z-50).
 */
export default function CardPickerModal({ type, collectionData, onSelect, onClose }) {
  const safeCollection = collectionData ?? {};
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [collectionOnly, setCollectionOnly] = useState(false);

  // Reset filters when switching between Leader and Base pickers
  useEffect(() => {
    setSearch('');
    setCollectionOnly(false);
  }, [type]);

  // Load all cards of this type from every known set
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const loaded = [];
      for (const set of SETS) {
        try {
          const { data } = await CardService.fetchSetData(set.code);
          loaded.push(...data.filter(c => c.Type === type));
        } catch {
          // Skip sets that fail to load
        }
      }
      if (!cancelled) {
        setCards(loaded);
        setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [type]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cards
      .filter(card => {
        if (!q) return true;
        return (
          card.Name?.toLowerCase().includes(q) ||
          card.Subtitle?.toLowerCase().includes(q) ||
          card.Traits?.some(t => t.toLowerCase().includes(q))
        );
      })
      .filter(card => {
        if (!collectionOnly) return true;
        return getCardQuantities(safeCollection, card.Set, card.Number).total > 0;
      });
  }, [cards, search, collectionOnly, collectionData]);

  return (
    // Backdrop — click outside to dismiss
    <div
      className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Modal panel — stop propagation so clicking inside doesn't close */}
      <div
        className="bg-gray-900 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col border border-gray-800 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="text-lg font-bold text-white">
            Select a {type}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Search + collection toggle */}
        <div className="px-5 py-3 border-b border-gray-800 flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
            <input
              autoFocus
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={`Search by name or trait…`}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg py-2 pl-9 pr-4 text-white placeholder:text-gray-500 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={() => setCollectionOnly(v => !v)}
            className={`flex-shrink-0 px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${
              collectionOnly
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
            }`}
          >
            Owned only
          </button>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {loading && (
            <div className="flex items-center justify-center py-12 gap-3 text-gray-500">
              <Loader2 size={24} className="animate-spin" />
              <span>Loading {type.toLowerCase()}s…</span>
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              <p>No {type.toLowerCase()}s found</p>
              {collectionOnly && (
                <p className="text-sm mt-1 text-gray-600">
                  Try disabling "Owned only"
                </p>
              )}
            </div>
          )}

          {filtered.map(card => {
            const owned = getCardQuantities(safeCollection, card.Set, card.Number).total;
            return (
              // Single <button> per result — no nesting
              <button
                key={`${card.Set}-${card.Number}`}
                onClick={() => onSelect(card)}
                className="w-full flex items-center gap-4 p-3 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-yellow-500 rounded-xl transition-all text-left"
              >
                <img
                  src={CardService.getCardImage(card.Set, card.Number)}
                  alt={card.Name}
                  className="flex-shrink-0 w-16 h-[88px] object-cover rounded"
                  onError={e => { e.target.style.display = 'none'; }}
                />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-white truncate">{card.Name}</p>
                  {card.Subtitle && (
                    <p className="text-sm text-gray-400 truncate">{card.Subtitle}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <span className="text-xs font-bold bg-blue-600 text-white px-2 py-0.5 rounded">
                      {card.Set}
                    </span>
                    {card.Aspects?.length > 0 && (
                      <span className="text-xs text-gray-500">{card.Aspects.join(', ')}</span>
                    )}
                    {card.Traits?.length > 0 && (
                      <span className="text-xs text-gray-600 truncate">
                        {card.Traits.slice(0, 3).join(' · ')}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex-shrink-0">
                  {owned > 0 ? (
                    <span className="text-xs font-bold text-green-400 bg-green-500/20 px-2 py-1 rounded">
                      {owned} owned
                    </span>
                  ) : (
                    <span className="text-xs text-gray-600 bg-gray-800 px-2 py-1 rounded">
                      Not owned
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
