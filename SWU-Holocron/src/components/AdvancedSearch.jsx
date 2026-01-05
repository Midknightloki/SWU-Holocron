import React, { useState, useEffect, useMemo } from 'react';
import { Search, X, Filter, Loader2, Tag, Plus, Minus, ChevronDown } from 'lucide-react';
import { SETS, ASPECTS } from '../constants';
import { CardService } from '../services/CardService';

export default function AdvancedSearch({ onCardClick, collectionData, currentSet, onClose, onUpdateQuantity }) {
  const [searchText, setSearchText] = useState('');
  const [selectedSets, setSelectedSets] = useState([]);
  const [selectedAspects, setSelectedAspects] = useState([]);
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [costMin, setCostMin] = useState('');
  const [costMax, setCostMax] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [allCards, setAllCards] = useState([]);
  const [loadedSets, setLoadedSets] = useState(new Set());
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  // Load ALL sets on mount for comprehensive search
  useEffect(() => {
    const loadAllSets = async () => {
      console.log('🚀 Loading all sets for search...');
      for (const set of SETS) {
        if (!loadedSets.has(set.code)) {
          await loadSetCards(set.code);
        }
      }
    };

    loadAllSets();
  }, []); // Empty dependency - only run once on mount

  const loadSetCards = async (setCode) => {
    if (loadedSets.has(setCode)) return;

    try {
      const { data } = await CardService.fetchSetData(setCode);
      console.log(`✓ Loaded ${data.length} cards from ${setCode}`);
      setAllCards(prev => [...prev.filter(c => c.Set !== setCode), ...data]);
      setLoadedSets(prev => new Set([...prev, setCode]));
    } catch (error) {
      console.error(`Failed to load set ${setCode}:`, error);
    }
  };

  // Load additional sets when user selects specific sets
  useEffect(() => {
    const loadSelectedSets = async () => {
      if (selectedSets.length > 0) {
        for (const setCode of selectedSets) {
          if (!loadedSets.has(setCode)) {
            await loadSetCards(setCode);
          }
        }
      }
    };

    loadSelectedSets();
  }, [selectedSets, loadedSets]);

  const uniqueTypes = useMemo(() => {
    const types = new Set(allCards.map(c => c.Type).filter(Boolean));
    return ['All', ...Array.from(types).sort()];
  }, [allCards]);

  // Perform search with debounce
  useEffect(() => {
    const debounce = setTimeout(() => {
      if (searchText.trim() || selectedSets.length > 0 || selectedAspects.length > 0 ||
          selectedTypes.length > 0 || costMin || costMax) {
        performSearch();
      } else {
        setSearchResults([]);
      }
    }, 300);

    return () => clearTimeout(debounce);
  }, [searchText, selectedSets, selectedAspects, selectedTypes, costMin, costMax, allCards]);

  const performSearch = () => {
    setIsSearching(true);

    try {
      console.log('🔍 Searching in', allCards.length, 'cards');
      if (allCards.length > 0) {
        console.log('📝 Sample card structure:', allCards[0]);
      }

      const filtered = allCards.filter(card => {
        // Text search across ALL text fields for comprehensive fuzzy matching
        if (searchText.trim()) {
          const text = searchText.toLowerCase();
          const matchesName = card.Name?.toLowerCase().includes(text);
          const matchesSubtitle = card.Subtitle?.toLowerCase().includes(text);
          const matchesFrontText = card.FrontText?.toLowerCase().includes(text);
          const matchesBackText = card.BackText?.toLowerCase().includes(text);
          const matchesTraits = card.Traits?.some(t => t.toLowerCase().includes(text));
          const matchesKeywords = card.Keywords?.some(k => k.toLowerCase().includes(text));
          const matchesArenas = card.Arenas?.some(a => a.toLowerCase().includes(text));

          if (!matchesName && !matchesSubtitle && !matchesFrontText && !matchesBackText && !matchesTraits && !matchesKeywords && !matchesArenas) {
            return false;
          }
        }

        // Set filter
        if (selectedSets.length > 0 && !selectedSets.includes(card.Set)) {
          return false;
        }

        // Aspect filter
        if (selectedAspects.length > 0) {
          const isNeutral = !card.Aspects || card.Aspects.length === 0;
          const hasSelectedAspect = selectedAspects.some(a => {
            if (a === 'Neutral') return isNeutral;
            return card.Aspects && card.Aspects.includes(a);
          });
          if (!hasSelectedAspect) {
            return false;
          }
        }

        // Type filter
        if (selectedTypes.length > 0 && !selectedTypes.includes(card.Type)) {
          return false;
        }

        // Cost filter
        if (costMin && (card.Cost === undefined || card.Cost < parseInt(costMin))) {
          return false;
        }
        if (costMax && (card.Cost === undefined || card.Cost > parseInt(costMax))) {
          return false;
        }

        return true;
      });

      // Deduplicate by card name (keep first occurrence of each unique name)
      const uniqueCards = [];
      const seenNames = new Set();

      for (const card of filtered) {
        const nameKey = `${card.Name}${card.Subtitle || ''}`;
        if (!seenNames.has(nameKey)) {
          seenNames.add(nameKey);
          uniqueCards.push(card);
        }
      }

      setSearchResults(uniqueCards.sort((a, b) => {
        // Sort by name first, then by set
        const nameCompare = a.Name.localeCompare(b.Name);
        if (nameCompare !== 0) return nameCompare;
        return a.Set.localeCompare(b.Set);
      }));
    } finally {
      setIsSearching(false);
    }
  };

  const toggleSet = (setCode) => {
    setSelectedSets(prev =>
      prev.includes(setCode)
        ? prev.filter(s => s !== setCode)
        : [...prev, setCode]
    );
  };

  const toggleAspect = (aspect) => {
    setSelectedAspects(prev =>
      prev.includes(aspect)
        ? prev.filter(a => a !== aspect)
        : [...prev, aspect]
    );
  };

  const toggleType = (type) => {
    setSelectedTypes(prev =>
      prev.includes(type)
        ? prev.filter(t => t !== type)
        : [...prev, type]
    );
  };

  const clearFilters = () => {
    setSearchText('');
    setSelectedSets([]);
    setSelectedAspects([]);
    setSelectedTypes([]);
    setCostMin('');
    setCostMax('');
    setSearchResults([]);
  };

  const handleCardClick = (card) => {
    onCardClick(card);
    // Keep search open so user can continue browsing results
  };

  const activeFiltersCount =
    (searchText.trim() ? 1 : 0) +
    selectedSets.length +
    selectedAspects.length +
    selectedTypes.length +
    (costMin ? 1 : 0) +
    (costMax ? 1 : 0);

  return (
    <div className="fixed inset-0 z-40 bg-gray-950 overflow-y-auto">
      <div className="min-h-screen">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-gray-900/95 backdrop-blur-md border-b border-gray-800">
          <div className="max-w-7xl mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Search className="text-blue-500" size={28} />
                <div>
                  <h1 className="text-2xl font-bold text-white">Advanced Search</h1>
                  <p className="text-sm text-gray-400">Search across all your cards with multiple filters</p>
                </div>
                {activeFiltersCount > 0 && (
                  <span className="bg-blue-600 text-white text-sm px-3 py-1 rounded-full font-bold">
                    {activeFiltersCount} {activeFiltersCount === 1 ? 'filter' : 'filters'}
                  </span>
                )}
              </div>
              <button
                onClick={onClose}
                className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors border border-gray-700"
              >
                <X size={20} />
                <span className="hidden sm:inline">Close</span>
              </button>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Filters Panel */}
            <div className="space-y-6 lg:col-span-1">
              {/* Text Search - Always Visible */}
              <div>
                <label className="block text-sm font-bold text-gray-400 uppercase tracking-wider mb-2">
                  Search Text
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                  <input
                    type="text"
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    placeholder="Name, text, traits..."
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg py-2 pl-10 pr-4 text-white placeholder:text-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Filters Toggle Button (Mobile) */}
              <button
                onClick={() => setFiltersExpanded(!filtersExpanded)}
                className="lg:hidden w-full flex items-center justify-between p-4 bg-gray-800 border border-gray-700 rounded-lg text-white font-semibold hover:bg-gray-750 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Filter size={20} />
                  <span>Advanced Filters</span>
                  {activeFiltersCount > 0 && (
                    <span className="bg-blue-600 text-xs px-2 py-0.5 rounded-full">
                      {activeFiltersCount}
                    </span>
                  )}
                </div>
                <ChevronDown
                  size={20}
                  className={`transition-transform ${filtersExpanded ? 'rotate-180' : ''}`}
                />
              </button>

              {/* Collapsible Filters Content */}
              <div className={`space-y-6 ${filtersExpanded ? 'block' : 'hidden'} lg:block`}>

            {/* Sets Filter */}
            <div>
              <label className="block text-sm font-bold text-gray-400 uppercase tracking-wider mb-2">
                Sets
              </label>
              <div className="flex flex-wrap gap-2">
                {SETS.map(set => (
                  <button
                    key={set.code}
                    onClick={() => toggleSet(set.code)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                      selectedSets.includes(set.code)
                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
                    }`}
                  >
                    {set.code}
                  </button>
                ))}
              </div>
            </div>

            {/* Aspects Filter */}
            <div>
              <label className="block text-sm font-bold text-gray-400 uppercase tracking-wider mb-2">
                Aspects
              </label>
              <div className="grid grid-cols-2 gap-2">
                {ASPECTS.map(aspect => {
                  const Icon = aspect.icon;
                  const isSelected = selectedAspects.includes(aspect.name);
                  return (
                    <button
                      key={aspect.name}
                      onClick={() => toggleAspect(aspect.name)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold border transition-all ${
                        isSelected
                          ? 'bg-gray-800/80 shadow-lg shadow-black/20'
                          : 'bg-gray-850 hover:bg-gray-800'
                      }`}
                      style={{
                        color: aspect.hexColor,
                        borderColor: isSelected ? aspect.hexColor : 'transparent'
                      }}
                    >
                      <Icon className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                      <span className="truncate">{aspect.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Type Filter */}
            <div>
              <label className="block text-sm font-bold text-gray-400 uppercase tracking-wider mb-2">
                Type
              </label>
              <div className="grid grid-cols-2 gap-2">
                {uniqueTypes.filter(t => t !== 'All').map(type => (
                  <button
                    key={type}
                    onClick={() => toggleType(type)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                      selectedTypes.includes(type)
                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            {/* Cost Filter */}
            <div>
              <label className="block text-sm font-bold text-gray-400 uppercase tracking-wider mb-2">
                Cost
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  value={costMin}
                  onChange={(e) => setCostMin(e.target.value)}
                  placeholder="Min"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg py-2 px-3 text-white placeholder:text-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
                <span className="text-gray-500">to</span>
                <input
                  type="number"
                  min="0"
                  value={costMax}
                  onChange={(e) => setCostMax(e.target.value)}
                  placeholder="Max"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg py-2 px-3 text-white placeholder:text-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Clear Filters */}
            {activeFiltersCount > 0 && (
              <button
                onClick={clearFilters}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg border border-gray-700 transition-colors"
              >
                <X size={18} />
                Clear All Filters
              </button>
            )}
            </div>
          </div>

          {/* Results Panel */}
          <div className="lg:col-span-2">
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
              {/* Results Header */}
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-700">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  {isSearching ? (
                    <>
                      <Loader2 className="animate-spin text-blue-500" size={20} />
                      Searching...
                    </>
                  ) : (
                    <>
                      <Filter size={20} className="text-blue-500" />
                      {searchResults.length} {searchResults.length === 1 ? 'Result' : 'Results'}
                    </>
                  )}
                </h3>
                {searchResults.length > 0 && (
                  <div className="text-sm text-gray-400">
                    {[...new Set(searchResults.map(c => c.Set))].length} sets
                  </div>
                )}
              </div>

              {/* Results Grid */}
              <div className="max-h-[600px] overflow-y-auto space-y-2 pr-2">
                {searchResults.length === 0 && !isSearching && activeFiltersCount > 0 && (
                  <div className="text-center py-12 text-gray-500">
                    <Filter size={48} className="mx-auto mb-4 opacity-30" />
                    <p className="text-lg font-medium mb-2">No cards found</p>
                    <p className="text-sm">Try adjusting your filters</p>
                  </div>
                )}

                {searchResults.length === 0 && !isSearching && activeFiltersCount === 0 && (
                  <div className="text-center py-12 text-gray-500">
                    <Search size={48} className="mx-auto mb-4 opacity-30" />
                    <p className="text-lg font-medium mb-2">Start searching</p>
                    <p className="text-sm">Use filters to find specific cards</p>
                  </div>
                )}

                {searchResults.map(card => {
                  const collectionId = CardService.getCollectionId(card.Set, card.Number, card.FrontImage || '', card.BackImage || '');
                  const owned = collectionData?.[collectionId]?.quantity || 0;

                  return (
                    <button
                      key={`${card.Set}-${card.Number}`}
                      onClick={() => handleCardClick(card)}
                      className="w-full flex items-center gap-4 p-3 bg-gray-900 hover:bg-gray-850 border border-gray-700 hover:border-blue-500 rounded-lg transition-all text-left group"
                    >
                      <div className="flex-shrink-0 w-16 h-22 bg-gray-800 rounded overflow-hidden">
                        <img
                          src={CardService.getCardImage(card.Set, card.Number)}
                          alt={card.Name}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start gap-2 mb-1">
                          <span className="flex-shrink-0 text-xs font-bold px-2 py-0.5 rounded bg-blue-600 text-white">
                            {card.Set}
                          </span>
                          <h4 className="font-bold text-white group-hover:text-blue-400 transition-colors truncate">
                            {card.Name}
                          </h4>
                        </div>

                        {card.Subtitle && (
                          <p className="text-sm text-gray-400 truncate mb-1">{card.Subtitle}</p>
                        )}

                        <div className="flex items-center gap-3 text-xs text-gray-500">
                          <span>{card.Type}</span>
                          {card.Cost !== undefined && <span>Cost: {card.Cost}</span>}
                          {card.Aspects && card.Aspects.length > 0 && (
                            <span>{card.Aspects.join(', ')}</span>
                          )}
                        </div>

                        {card.Traits && card.Traits.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {card.Traits.map(trait => (
                              <span key={trait} className="text-xs px-2 py-0.5 bg-gray-800 text-gray-400 rounded">
                                {trait}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex-shrink-0 flex items-center gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onUpdateQuantity(card, -1);
                          }}
                          disabled={owned === 0}
                          className="w-8 h-8 bg-red-600/80 hover:bg-red-500 disabled:bg-gray-700 disabled:opacity-30 text-white rounded-full flex items-center justify-center transition-all transform active:scale-95 shadow-md disabled:cursor-not-allowed"
                        >
                          <Minus size={14} />
                        </button>

                        <span className="min-w-[2rem] text-center font-bold text-white">{owned}</span>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onUpdateQuantity(card, 1);
                          }}
                          className="w-8 h-8 bg-green-600/80 hover:bg-green-500 text-white rounded-full flex items-center justify-center transition-all transform active:scale-95 shadow-md"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}
