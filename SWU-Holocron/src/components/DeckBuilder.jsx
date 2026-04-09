import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Save, X, Plus, Minus, Search, BarChart3, CheckCircle, AlertCircle,
  Swords, ChevronDown, Loader2, ShoppingCart, Download, Upload, Copy, ClipboardPaste
} from 'lucide-react';
import { CardService } from '../services/CardService';
import { DeckService } from '../services/DeckService';
import { useAuth } from '../contexts/AuthContext';
import { getPlaysetQuantity, getCardQuantities } from '../utils/collectionHelpers';
import AdvancedSearch from './AdvancedSearch';
import ShoppingList from './ShoppingList';
import {
  exportToForcetableJSON,
  exportToSWUDBText,
  importFromForcetableJSON,
  importFromSWUDBText,
} from '../utils/deckImportExport';

/**
 * DeckBuilder.jsx — Core deck building interface
 * Two-panel layout: search (left) and deck list (right)
 * Enforces SWU deck rules: 1 Leader, 1 Base, 50 main deck cards, max 3x per card
 */
export default function DeckBuilder({ deck, collectionData, onClose, onSaved }) {
  const { user } = useAuth();

  // Deck state
  const [deckName, setDeckName] = useState(deck?.name || 'Untitled Deck');
  const [deckDescription, setDeckDescription] = useState(deck?.description || '');
  const [selectedLeader, setSelectedLeader] = useState(deck?.leaderId || null);
  const [selectedBase, setSelectedBase] = useState(deck?.baseId || null);
  const [deckCards, setDeckCards] = useState(deck?.cards || {});
  const [allCards, setAllCards] = useState([]);
  const [cardDataMap, setCardDataMap] = useState({}); // cardId -> card object
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [loadingCards, setLoadingCards] = useState(false);

  // Panel state: 'deck' | 'shopping' | 'importexport'
  const [activePanel, setActivePanel] = useState('deck');
  const [importText, setImportText] = useState('');
  const [importFeedback, setImportFeedback] = useState(null); // { type: 'success'|'error', message }
  const [copyFeedback, setCopyFeedback] = useState(''); // format key that was just copied

  // Load all card data on mount
  useEffect(() => {
    const loadAllCards = async () => {
      setLoadingCards(true);
      try {
        const sets = ['SOR', 'TWI', 'SHD', 'UIQ'];
        const cardMap = {};
        const allCardsList = [];

        for (const set of sets) {
          try {
            const { data } = await CardService.fetchSetData(set);
            data.forEach(card => {
              const cardId = `${card.Set}_${card.Number}`;
              cardMap[cardId] = card;
              allCardsList.push(card);
            });
          } catch (error) {
            console.warn(`Failed to load set ${set}:`, error);
          }
        }

        setCardDataMap(cardMap);
        setAllCards(allCardsList);
      } catch (error) {
        console.error('Error loading card data:', error);
      } finally {
        setLoadingCards(false);
      }
    };

    loadAllCards();
  }, []);

  // Computed values
  const mainDeckCards = useMemo(() => {
    return Object.entries(deckCards)
      .filter(([cardId]) => {
        const card = cardDataMap[cardId];
        return card && card.Type !== 'Leader' && card.Type !== 'Base';
      })
      .map(([cardId, count]) => ({
        cardId,
        count,
        card: cardDataMap[cardId]
      }));
  }, [deckCards, cardDataMap]);

  const mainDeckTotal = useMemo(() => {
    return mainDeckCards.reduce((sum, { count }) => sum + count, 0);
  }, [mainDeckCards]);

  const costCurve = useMemo(() => {
    const curve = Array(8).fill(0);
    mainDeckCards.forEach(({ card, count }) => {
      const cost = card.Cost ?? null;
      if (cost !== null && cost <= 7) {
        curve[cost] += count;
      } else if (cost !== null && cost > 7) {
        curve[7] += count;
      }
    });
    return curve;
  }, [mainDeckCards]);

  const maxCostInCurve = useMemo(() => {
    return Math.max(...costCurve);
  }, [costCurve]);

  const deckStatus = useMemo(() => {
    const hasLeader = !!selectedLeader;
    const hasBase = !!selectedBase;
    const isValidCount = mainDeckTotal === 50;
    return {
      isValid: hasLeader && hasBase && isValidCount,
      hasLeader,
      hasBase,
      isValidCount,
      message:
        !hasLeader ? 'Missing Leader'
        : !hasBase ? 'Missing Base'
        : mainDeckTotal < 50 ? `${50 - mainDeckTotal} cards needed`
        : mainDeckTotal > 50 ? `${mainDeckTotal - 50} cards over limit`
        : 'Ready to save'
    };
  }, [selectedLeader, selectedBase, mainDeckTotal]);

  const getCardOwnership = useCallback((cardId) => {
    const [set, number] = cardId.split('_');
    const { standard, foil, total } = getCardQuantities(collectionData, set, number);
    return { standard, foil, total };
  }, [collectionData]);

  const getOwnershipColor = useCallback((cardId, needed = 1) => {
    const { total } = getCardOwnership(cardId);
    if (total >= needed) return 'bg-green-500';
    if (total > 0) return 'bg-yellow-500';
    return 'bg-red-500';
  }, [getCardOwnership]);

  const getDeckCount = useCallback((cardId) => deckCards[cardId] || 0, [deckCards]);

  // Handlers
  const handleAddCard = useCallback((card) => {
    const cardId = `${card.Set}_${card.Number}`;
    const currentCount = deckCards[cardId] || 0;
    const maxCopies = getPlaysetQuantity(card.Type);
    const { total: owned } = getCardOwnership(cardId);

    // Cannot exceed max copies
    if (currentCount >= maxCopies) return;

    // For leader/base, max 1
    if (card.Type === 'Leader') {
      setSelectedLeader(cardId);
      setDeckCards(prev => ({
        ...prev,
        [cardId]: 1
      }));
    } else if (card.Type === 'Base') {
      setSelectedBase(cardId);
      setDeckCards(prev => ({
        ...prev,
        [cardId]: 1
      }));
    } else {
      // Main deck card
      setDeckCards(prev => ({
        ...prev,
        [cardId]: Math.min(currentCount + 1, maxCopies)
      }));
    }
  }, [deckCards, getCardOwnership]);

  const handleRemoveCard = useCallback((cardId) => {
    const card = cardDataMap[cardId];
    if (!card) return;

    if (card.Type === 'Leader') {
      setSelectedLeader(null);
    } else if (card.Type === 'Base') {
      setSelectedBase(null);
    }

    setDeckCards(prev => {
      const newDeck = { ...prev };
      delete newDeck[cardId];
      return newDeck;
    });
  }, [cardDataMap]);

  const handleUpdateCardCount = useCallback((cardId, newCount) => {
    if (newCount <= 0) {
      handleRemoveCard(cardId);
    } else {
      const card = cardDataMap[cardId];
      const maxCopies = getPlaysetQuantity(card.Type);
      setDeckCards(prev => ({
        ...prev,
        [cardId]: Math.min(Math.max(newCount, 1), maxCopies)
      }));
    }
  }, [cardDataMap, handleRemoveCard]);

  const handleSaveDeck = async () => {
    if (!user || !deckStatus.isValid) return;

    setSaveError('');
    setIsSaving(true);

    try {
      // Extract aspects from cards
      const aspectsSet = new Set();
      mainDeckCards.forEach(({ card }) => {
        if (card.Aspects && Array.isArray(card.Aspects)) {
          card.Aspects.forEach(a => aspectsSet.add(a));
        }
      });

      const deckData = {
        name: deckName || 'Untitled Deck',
        description: deckDescription,
        leaderId: selectedLeader,
        baseId: selectedBase,
        cards: deckCards,
        aspects: Array.from(aspectsSet),
        format: 'Premier',
        tags: []
      };

      let savedDeckId;
      if (deck?.id) {
        // Update existing deck
        await DeckService.updateDeck(user.uid, deck.id, deckData);
        savedDeckId = deck.id;
      } else {
        // Create new deck
        savedDeckId = await DeckService.createDeck(user.uid, deckData);
      }

      if (onSaved) {
        onSaved({ id: savedDeckId, ...deckData });
      }

      onClose();
    } catch (error) {
      console.error('Error saving deck:', error);
      setSaveError(error.message || 'Failed to save deck');
    } finally {
      setIsSaving(false);
    }
  };

  const leaderCard = selectedLeader ? cardDataMap[selectedLeader] : null;
  const baseCard = selectedBase ? cardDataMap[selectedBase] : null;

  // Build current deck snapshot for export/shopping
  const currentDeckSnapshot = useMemo(() => ({
    name: deckName,
    leaderId: selectedLeader,
    baseId: selectedBase,
    cards: deckCards,
  }), [deckName, selectedLeader, selectedBase, deckCards]);

  // Import/export handlers
  const handleExportCopy = useCallback(async (format) => {
    let text;
    if (format === 'forcetable') {
      text = exportToForcetableJSON(currentDeckSnapshot, user?.displayName || '');
    } else {
      text = exportToSWUDBText(currentDeckSnapshot, allCards);
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback(format);
      setTimeout(() => setCopyFeedback(''), 2000);
    } catch {
      // Fallback: show in textarea
    }
  }, [currentDeckSnapshot, user, allCards]);

  const handleImport = useCallback((format) => {
    setImportFeedback(null);
    if (!importText.trim()) {
      setImportFeedback({ type: 'error', message: 'Paste a decklist above before importing.' });
      return;
    }
    let result;
    if (format === 'forcetable') {
      result = importFromForcetableJSON(importText);
    } else {
      result = importFromSWUDBText(importText);
    }
    if (result.errors && result.errors.length > 0) {
      setImportFeedback({ type: 'error', message: result.errors.join(' ') });
      return;
    }
    const imported = result.deck;
    if (imported.leaderId) setSelectedLeader(imported.leaderId);
    if (imported.baseId) setSelectedBase(imported.baseId);
    if (imported.cards) setDeckCards(imported.cards);
    if (imported.name) setDeckName(imported.name);
    setImportText('');
    setImportFeedback({ type: 'success', message: 'Deck imported successfully!' });
  }, [importText]);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-2xl shadow-2xl w-full max-w-7xl max-h-[90vh] flex flex-col border border-gray-800">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-950">
          <div className="flex items-center gap-3">
            <Swords size={24} className="text-yellow-500" />
            <h2 className="text-xl font-bold text-white">Deck Builder</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors text-gray-400 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-hidden flex flex-col lg:flex-row gap-6 p-6">

          {/* Left Panel: Search */}
          <div className="flex-1 min-h-0 flex flex-col bg-gray-800/50 rounded-xl p-4 border border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <Search size={18} className="text-blue-500" />
                Card Search
              </h3>
            </div>

            {loadingCards ? (
              <div className="flex items-center justify-center flex-1">
                <Loader2 size={32} className="animate-spin text-yellow-500" />
              </div>
            ) : (
              <div className="flex-1 overflow-auto">
                <AdvancedSearch
                  onCardClick={handleAddCard}
                  collectionData={collectionData}
                  embedded={true}
                  getDeckCount={getDeckCount}
                />
              </div>
            )}
          </div>

          {/* Right Panel: Deck List / Shopping / Import-Export */}
          <div className="flex-1 min-h-0 flex flex-col bg-gray-800/50 rounded-xl p-4 border border-gray-700 overflow-hidden">

            {/* Panel Tabs */}
            <div className="flex items-center gap-1 mb-4 bg-gray-900 rounded-lg p-1 border border-gray-700">
              <button
                onClick={() => setActivePanel('deck')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold transition-colors ${
                  activePanel === 'deck' ? 'bg-yellow-500 text-gray-950' : 'text-gray-400 hover:text-white'
                }`}
              >
                <Swords size={14} />
                Deck
              </button>
              <button
                onClick={() => setActivePanel('shopping')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold transition-colors ${
                  activePanel === 'shopping' ? 'bg-yellow-500 text-gray-950' : 'text-gray-400 hover:text-white'
                }`}
              >
                <ShoppingCart size={14} />
                Shopping
              </button>
              <button
                onClick={() => setActivePanel('importexport')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold transition-colors ${
                  activePanel === 'importexport' ? 'bg-yellow-500 text-gray-950' : 'text-gray-400 hover:text-white'
                }`}
              >
                <Download size={14} />
                Import/Export
              </button>
            </div>

            {/* Shopping List Panel */}
            {activePanel === 'shopping' && (
              <div className="flex-1 overflow-auto">
                <ShoppingList
                  deck={currentDeckSnapshot}
                  collectionData={collectionData}
                  cardDatabase={allCards}
                />
              </div>
            )}

            {/* Import/Export Panel */}
            {activePanel === 'importexport' && (
              <div className="flex-1 overflow-auto space-y-4">
                {/* Export */}
                <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
                  <h4 className="text-xs font-bold uppercase text-gray-400 mb-3 flex items-center gap-2">
                    <Download size={14} />
                    Export Deck
                  </h4>
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => handleExportCopy('forcetable')}
                      className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors"
                    >
                      {copyFeedback === 'forcetable' ? <CheckCircle size={14} /> : <Copy size={14} />}
                      {copyFeedback === 'forcetable' ? 'Copied!' : 'Copy as Forcetable JSON'}
                    </button>
                    <button
                      onClick={() => handleExportCopy('swudb')}
                      className="flex items-center justify-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold rounded-lg transition-colors"
                    >
                      {copyFeedback === 'swudb' ? <CheckCircle size={14} /> : <Copy size={14} />}
                      {copyFeedback === 'swudb' ? 'Copied!' : 'Copy as SWUDB Text'}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    Paste Forcetable JSON into Forcetable to import. SWUDB text works with SWUDB and most other builders.
                  </p>
                </div>

                {/* Import */}
                <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
                  <h4 className="text-xs font-bold uppercase text-gray-400 mb-3 flex items-center gap-2">
                    <Upload size={14} />
                    Import Deck
                  </h4>
                  {importFeedback && (
                    <div className={`mb-3 p-2 rounded text-sm flex items-start gap-2 ${
                      importFeedback.type === 'success'
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-red-500/20 text-red-400'
                    }`}>
                      {importFeedback.type === 'success' ? <CheckCircle size={14} className="mt-0.5" /> : <AlertCircle size={14} className="mt-0.5" />}
                      {importFeedback.message}
                    </div>
                  )}
                  <textarea
                    value={importText}
                    onChange={(e) => { setImportText(e.target.value); setImportFeedback(null); }}
                    placeholder={'Paste a Forcetable JSON or SWUDB text decklist here…'}
                    className="w-full h-32 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 text-xs placeholder-gray-600 focus:outline-none focus:border-yellow-500 resize-none font-mono"
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => handleImport('forcetable')}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors"
                    >
                      <Upload size={12} />
                      Import Forcetable JSON
                    </button>
                    <button
                      onClick={() => handleImport('swudb')}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded-lg transition-colors"
                    >
                      <Upload size={12} />
                      Import SWUDB Text
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Deck Panel (default) */}
            {activePanel === 'deck' && (
            <div className="flex-1 overflow-auto space-y-4">

              {/* Leader Section */}
              <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
                <h4 className="text-xs font-bold uppercase text-gray-400 mb-3">Leader</h4>
                {leaderCard ? (
                  <div className="flex items-center gap-3">
                    <img
                      src={CardService.getCardImage(leaderCard.Set, leaderCard.Number)}
                      alt={leaderCard.Name}
                      className="w-20 h-28 rounded object-cover border border-gray-600"
                      onError={(e) => {
                        e.target.style.display = 'none';
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-semibold truncate">{leaderCard.Name}</p>
                      <p className="text-gray-400 text-sm">{leaderCard.Set} - {leaderCard.Number}</p>
                      <button
                        onClick={() => handleRemoveCard(selectedLeader)}
                        className="mt-2 px-3 py-1 bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-colors text-xs font-semibold"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="h-32 border-2 border-dashed border-gray-600 rounded flex items-center justify-center text-gray-500">
                    <p>No leader selected</p>
                  </div>
                )}
              </div>

              {/* Base Section */}
              <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
                <h4 className="text-xs font-bold uppercase text-gray-400 mb-3">Base</h4>
                {baseCard ? (
                  <div className="flex items-center gap-3">
                    <img
                      src={CardService.getCardImage(baseCard.Set, baseCard.Number)}
                      alt={baseCard.Name}
                      className="w-20 h-28 rounded object-cover border border-gray-600"
                      onError={(e) => {
                        e.target.style.display = 'none';
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-semibold truncate">{baseCard.Name}</p>
                      <p className="text-gray-400 text-sm">{baseCard.Set} - {baseCard.Number}</p>
                      <button
                        onClick={() => handleRemoveCard(selectedBase)}
                        className="mt-2 px-3 py-1 bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-colors text-xs font-semibold"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="h-32 border-2 border-dashed border-gray-600 rounded flex items-center justify-center text-gray-500">
                    <p>No base selected</p>
                  </div>
                )}
              </div>

              {/* Main Deck Cards */}
              <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-bold uppercase text-gray-400">Main Deck</h4>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-bold ${
                      deckStatus.isValidCount
                        ? 'bg-green-500/20 text-green-400'
                        : mainDeckTotal > 50
                        ? 'bg-red-500/20 text-red-400'
                        : 'bg-yellow-500/20 text-yellow-400'
                    }`}
                  >
                    {mainDeckTotal}/50
                  </span>
                </div>

                {mainDeckCards.length === 0 ? (
                  <p className="text-gray-500 text-sm">No cards added yet</p>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {mainDeckCards.map(({ cardId, card, count }) => (
                      <div key={cardId} className="flex items-center gap-3 bg-gray-800 p-3 rounded border border-gray-700 hover:border-gray-600 transition-colors">
                        <div
                          className={`w-3 h-3 rounded-full ${getOwnershipColor(cardId, count)}`}
                          title={`Owned: ${getCardOwnership(cardId).total}`}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm font-semibold truncate">{card.Name}</p>
                          <p className="text-gray-400 text-xs">{cardId}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleUpdateCardCount(cardId, count - 1)}
                            className="p-1 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
                          >
                            <Minus size={14} className="text-gray-300" />
                          </button>
                          <span className="w-8 text-center text-white font-semibold">{count}</span>
                          <button
                            onClick={() => handleUpdateCardCount(cardId, count + 1)}
                            className="p-1 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
                            disabled={count >= getPlaysetQuantity(card.Type)}
                          >
                            <Plus size={14} className="text-gray-300" />
                          </button>
                        </div>
                        <button
                          onClick={() => handleRemoveCard(cardId)}
                          className="p-1 bg-red-500/20 hover:bg-red-500/30 rounded transition-colors"
                        >
                          <X size={14} className="text-red-400" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Cost Curve */}
              {mainDeckTotal > 0 && (
                <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
                  <h4 className="text-xs font-bold uppercase text-gray-400 mb-3 flex items-center gap-2">
                    <BarChart3 size={14} />
                    Cost Curve
                  </h4>
                  <div className="flex items-end gap-1 h-20">
                    {costCurve.map((count, cost) => (
                      <div key={cost} className="flex-1 flex flex-col items-center gap-1">
                        <div
                          className="w-full bg-yellow-500 rounded-t transition-all hover:bg-yellow-400"
                          style={{
                            height: maxCostInCurve > 0 ? `${(count / maxCostInCurve) * 100}%` : '0%'
                          }}
                          title={`Cost ${cost}: ${count} cards`}
                        />
                        <span className="text-xs text-gray-500 font-semibold">{cost}+</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            )}
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="border-t border-gray-800 bg-gray-950 px-6 py-4">
          {saveError && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg flex items-center gap-2 text-red-300 text-sm">
              <AlertCircle size={16} />
              {saveError}
            </div>
          )}

          <div className="flex flex-col lg:flex-row gap-4 items-stretch lg:items-center">
            <input
              type="text"
              value={deckName}
              onChange={(e) => setDeckName(e.target.value)}
              placeholder="Deck name..."
              className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500"
            />

            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="px-6 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-gray-200 font-semibold transition-colors"
              >
                Close
              </button>
              <button
                onClick={handleSaveDeck}
                disabled={!deckStatus.isValid || isSaving}
                className={`flex items-center gap-2 px-6 py-2 rounded-lg font-semibold transition-colors ${
                  deckStatus.isValid && !isSaving
                    ? 'bg-yellow-500 hover:bg-yellow-600 text-black'
                    : 'bg-gray-700 text-gray-400 cursor-not-allowed'
                }`}
              >
                {isSaving ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Save size={18} />
                )}
                {deckStatus.isValid ? 'Save Deck' : deckStatus.message}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
