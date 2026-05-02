import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Save, X, Plus, Minus, Search, BarChart3, CheckCircle, AlertCircle,
  Swords, ChevronDown, Loader2, ShoppingCart, Download, Upload, Copy, ClipboardPaste,
  Layers, User, LayoutGrid, Info, Shield, Sparkles
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
  importFromSWUComText,
  importFromMeleeText,
} from '../utils/deckImportExport';
import { getCardSuggestions } from '../services/AiSuggestionsService';

/**
 * DeckBuilder.jsx — Core deck building interface
 * Two-panel layout: search (left) and deck list (right)
 * Enforces SWU deck rules: 1 Leader, 1 Base, 50 main deck cards, max 3x per card
 */
export default function DeckBuilder({ deck, collectionData, onClose, onSaved }) {
  const { user } = useAuth();

  // Wizard state
  const [step, setStep] = useState(deck?.id ? 4 : 0); // 0: Start, 1: Format, 2: Leader, 3: Base, 4: Deck, 5: Analysis
  const [selectedFormat, setSelectedFormat] = useState(deck?.format || 'Premier');

  // Deck state
  const [deckName, setDeckName] = useState(deck?.name || '');
  const [deckDescription, setDeckDescription] = useState(deck?.description || '');
  const [selectedLeader, setSelectedLeader] = useState(deck?.leaderId || null);
  const [selectedBase, setSelectedBase] = useState(deck?.baseId || null);
  const [deckCards, setDeckCards] = useState(deck?.cards || {});
  const [sideboardCards, setSideboardCards] = useState(deck?.sideboard || {});
  const [allCards, setAllCards] = useState([]);
  const [cardDataMap, setCardDataMap] = useState({}); // cardId -> card object
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [loadingCards, setLoadingCards] = useState(false);

  // Panel state: 'deck' | 'shopping' | 'importexport' | 'ai'
  const [activePanel, setActivePanel] = useState('deck');
  // Search add target: 'mainboard' | 'sideboard'
  const [addTarget, setAddTarget] = useState('mainboard');

  // AI suggestions state
  const [aiSuggestions, setAiSuggestions] = useState([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState('');
  const [importText, setImportText] = useState('');
  const [importFeedback, setImportFeedback] = useState(null); // { type: 'success'|'error', message }
  const [copyFeedback, setCopyFeedback] = useState(''); // format key that was just copied

  // Mobile state
  const [isMobile, setIsMobile] = useState(false);
  // 'search' | 'deck' | 'shopping' | 'importexport' | 'analysis'
  const [activeMobileTab, setActiveMobileTab] = useState('search');
  const [previewCard, setPreviewCard] = useState(null); // card object for full-size overlay

  // Mobile detection
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Load all card data on mount
  useEffect(() => {
    const loadAllCards = async () => {
      setLoadingCards(true);
      try {
        const sets = await CardService.getAvailableSets();
        // If discovery returns nothing, fallback to mainline sets
        const setsToLoad = sets.length > 0 ? sets : ['SOR', 'SHD', 'TWI', 'UIQ'];

        const cardMap = {};
        const allCardsList = [];

        for (const set of setsToLoad) {
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

  const sideboardCardsList = useMemo(() => {
    return Object.entries(sideboardCards)
      .map(([cardId, count]) => ({
        cardId,
        count,
        card: cardDataMap[cardId]
      }))
      .filter(({ card }) => card && card.Type !== 'Leader' && card.Type !== 'Base');
  }, [sideboardCards, cardDataMap]);

  const sideboardTotal = useMemo(() => {
    return sideboardCardsList.reduce((sum, { count }) => sum + count, 0);
  }, [sideboardCardsList]);

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

  const getDeckCount = useCallback((cardId) => {
    if (addTarget === 'sideboard') return sideboardCards[cardId] || 0;
    return deckCards[cardId] || 0;
  }, [deckCards, sideboardCards, addTarget]);

  // Handlers
  const handleAddCard = useCallback((card) => {
    const cardId = `${card.Set}_${card.Number}`;
    const currentCount = deckCards[cardId] || 0;
    const maxCopies = getPlaysetQuantity(card.Type);

    if (card.Type === 'Leader') {
      if (currentCount >= maxCopies) return;
      setDeckCards(prev => {
        const next = { ...prev };
        if (selectedLeader) delete next[selectedLeader];
        next[cardId] = 1;
        return next;
      });
      setSelectedLeader(cardId);
    } else if (card.Type === 'Base') {
      if (currentCount >= maxCopies) return;
      setDeckCards(prev => {
        const next = { ...prev };
        if (selectedBase) delete next[selectedBase];
        next[cardId] = 1;
        return next;
      });
      setSelectedBase(cardId);
    } else {
      // Combined copy limit: mainboard + sideboard cannot exceed maxCopies
      const sideCount = sideboardCards[cardId] || 0;
      if (currentCount + sideCount >= maxCopies) return;
      setDeckCards(prev => ({
        ...prev,
        [cardId]: currentCount + 1
      }));
    }
  }, [deckCards, sideboardCards, selectedLeader, selectedBase]);

  const handleAddToSideboard = useCallback((card) => {
    if (card.Type === 'Leader' || card.Type === 'Base') return;
    const cardId = `${card.Set}_${card.Number}`;
    const maxCopies = getPlaysetQuantity(card.Type);

    setSideboardCards(prev => {
      const currentSide = prev[cardId] || 0;
      const currentMain = deckCards[cardId] || 0;
      const currentTotal = Object.values(prev).reduce((s, c) => s + c, 0);
      if (currentTotal >= 10) return prev;
      if (currentSide + currentMain >= maxCopies) return prev;
      return { ...prev, [cardId]: currentSide + 1 };
    });
  }, [deckCards]);

  const handleRemoveCard = useCallback((cardId) => {
    if (cardId === selectedLeader) setSelectedLeader(null);
    if (cardId === selectedBase) setSelectedBase(null);

    setDeckCards(prev => {
      const newDeck = { ...prev };
      delete newDeck[cardId];
      return newDeck;
    });
  }, [selectedLeader, selectedBase]);

  const handleRemoveFromSideboard = useCallback((cardId) => {
    setSideboardCards(prev => {
      const next = { ...prev };
      delete next[cardId];
      return next;
    });
  }, []);

  const handleUpdateCardCount = useCallback((cardId, newCount) => {
    if (newCount <= 0) {
      handleRemoveCard(cardId);
    } else {
      const card = cardDataMap[cardId];
      const maxCopies = getPlaysetQuantity(card.Type);
      const sideCount = sideboardCards[cardId] || 0;
      const effectiveMax = maxCopies - sideCount;
      setDeckCards(prev => ({
        ...prev,
        [cardId]: Math.min(Math.max(newCount, 1), effectiveMax)
      }));
    }
  }, [cardDataMap, sideboardCards, handleRemoveCard]);

  const handleUpdateSideboardCount = useCallback((cardId, newCount) => {
    if (newCount <= 0) {
      handleRemoveFromSideboard(cardId);
      return;
    }
    const card = cardDataMap[cardId];
    const maxCopies = getPlaysetQuantity(card?.Type || 'Unit');
    const mainCount = deckCards[cardId] || 0;

    setSideboardCards(prev => {
      const currentSide = prev[cardId] || 0;
      const currentTotal = Object.values(prev).reduce((s, c) => s + c, 0);
      const maxByRules = maxCopies - mainCount;
      const maxByCap = 10 - currentTotal + currentSide;
      const effectiveMax = Math.min(maxByRules, maxByCap);
      return { ...prev, [cardId]: Math.min(Math.max(newCount, 1), effectiveMax) };
    });
  }, [cardDataMap, deckCards, handleRemoveFromSideboard]);

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
        sideboard: sideboardCards,
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

  const handleGetSuggestions = useCallback(async () => {
    if (!selectedLeader || !selectedBase) {
      setSuggestionsError('Please select a Leader and Base before getting suggestions.');
      return;
    }

    setIsLoadingSuggestions(true);
    setSuggestionsError('');
    setAiSuggestions([]);

    try {
      const leader = cardDataMap[selectedLeader];
      const base = cardDataMap[selectedBase];

      const aspects = new Set();
      if (leader?.Aspects) leader.Aspects.forEach(a => aspects.add(a));
      if (base?.Aspects) base.Aspects.forEach(a => aspects.add(a));

      const deckCardsSummary = mainDeckCards.map(({ card, count }) => ({
        count,
        name: card.Name,
        type: card.Type,
      }));

      const available = allCards
        .filter(card => card.Type !== 'Leader' && card.Type !== 'Base')
        .filter(card => {
          const cardId = `${card.Set}_${card.Number}`;
          const currentCount = deckCards[cardId] || 0;
          return currentCount < getPlaysetQuantity(card.Type);
        })
        .map(card => ({
          id: `${card.Set}_${card.Number}`,
          name: card.Name,
          type: card.Type,
          cost: card.Cost ?? null,
          aspects: card.Aspects || [],
          traits: (card.Traits || []).slice(0, 3),
        }))
        .slice(0, 300);

      const suggestions = await getCardSuggestions({
        leaderName: leader?.Name || selectedLeader,
        baseName: base?.Name || selectedBase,
        aspects: Array.from(aspects),
        deckCards: deckCardsSummary,
        availableCards: available,
      });

      setAiSuggestions(suggestions);
    } catch (error) {
      console.error('AI suggestions error:', error);
      setSuggestionsError(error.message || 'Failed to get suggestions. Make sure you are signed in.');
    } finally {
      setIsLoadingSuggestions(false);
    }
  }, [selectedLeader, selectedBase, cardDataMap, mainDeckCards, deckCards, allCards]);

  const leaderCard = selectedLeader ? cardDataMap[selectedLeader] : null;
  const baseCard = selectedBase ? cardDataMap[selectedBase] : null;

  // Build current deck snapshot for export/shopping
  const currentDeckSnapshot = useMemo(() => ({
    name: deckName,
    leaderId: selectedLeader,
    baseId: selectedBase,
    cards: deckCards,
    sideboard: sideboardCards,
  }), [deckName, selectedLeader, selectedBase, deckCards, sideboardCards]);

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
    } else if (format === 'swucom') {
      result = importFromSWUComText(importText, allCards);
    } else if (format === 'melee') {
      result = importFromMeleeText(importText, allCards);
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
    if (imported.sideboard) setSideboardCards(imported.sideboard);
    if (imported.name) setDeckName(imported.name);
    if (imported.format) setSelectedFormat(imported.format);

    setImportText('');
    setImportFeedback({ type: 'success', message: 'Deck imported successfully!' });
    setStep(4); // Jump to deck building
  }, [importText, allCards]);

  const steps = [
    { name: 'Start', icon: <Plus size={18} /> },
    { name: 'Format', icon: <Layers size={18} /> },
    { name: 'Leader', icon: <User size={18} /> },
    { name: 'Base', icon: <LayoutGrid size={18} /> },
    { name: 'Deck', icon: <Swords size={18} /> },
    { name: 'Analysis', icon: <BarChart3 size={18} /> }
  ];

  // ─── Reusable panel fragments ───────────────────────────────────────────────

  const renderDeckPanel = () => (
    <div className="flex-1 overflow-auto space-y-4">
      {/* Leader Section */}
      <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
        <h4 className="text-xs font-bold uppercase text-gray-400 mb-3">Leader</h4>
        {leaderCard ? (
          <div className="flex items-center gap-3">
            <button
              onClick={() => setPreviewCard(leaderCard)}
              className="shrink-0 focus:outline-none focus:ring-2 focus:ring-yellow-500 rounded"
              aria-label={`Preview ${leaderCard.Name}`}
            >
              <img
                src={CardService.getCardImage(leaderCard.Set, leaderCard.Number)}
                alt={leaderCard.Name}
                className="w-20 h-28 rounded object-cover border border-gray-600 hover:border-yellow-400 transition-colors"
                onError={(e) => { e.target.style.display = 'none'; }}
              />
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold truncate">{leaderCard.Name}</p>
              <p className="text-gray-400 text-sm">{leaderCard.Set} - {leaderCard.Number}</p>
              <button
                onClick={() => handleRemoveCard(selectedLeader)}
                className="mt-2 px-3 py-2 bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-colors text-xs font-semibold"
                style={{ minHeight: '44px', minWidth: '44px' }}
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
            <button
              onClick={() => setPreviewCard(baseCard)}
              className="shrink-0 focus:outline-none focus:ring-2 focus:ring-yellow-500 rounded"
              aria-label={`Preview ${baseCard.Name}`}
            >
              <img
                src={CardService.getCardImage(baseCard.Set, baseCard.Number)}
                alt={baseCard.Name}
                className="w-20 h-28 rounded object-cover border border-gray-600 hover:border-yellow-400 transition-colors"
                onError={(e) => { e.target.style.display = 'none'; }}
              />
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold truncate">{baseCard.Name}</p>
              <p className="text-gray-400 text-sm">{baseCard.Set} - {baseCard.Number}</p>
              <button
                onClick={() => handleRemoveCard(selectedBase)}
                className="mt-2 px-3 py-2 bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-colors text-xs font-semibold"
                style={{ minHeight: '44px', minWidth: '44px' }}
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
                  className={`w-3 h-3 rounded-full shrink-0 ${getOwnershipColor(cardId, count)}`}
                  title={`Owned: ${getCardOwnership(cardId).total}`}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-semibold truncate">{card.Name}</p>
                  <p className="text-gray-400 text-xs">{cardId}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleUpdateCardCount(cardId, count - 1)}
                    className="flex items-center justify-center bg-gray-700 hover:bg-gray-600 rounded transition-colors"
                    style={{ minWidth: '44px', minHeight: '44px' }}
                  >
                    <Minus size={14} className="text-gray-300" />
                  </button>
                  <span className="w-8 text-center text-white font-semibold">{count}</span>
                  <button
                    onClick={() => handleUpdateCardCount(cardId, count + 1)}
                    className="flex items-center justify-center bg-gray-700 hover:bg-gray-600 rounded transition-colors"
                    style={{ minWidth: '44px', minHeight: '44px' }}
                    disabled={count >= getPlaysetQuantity(card.Type)}
                  >
                    <Plus size={14} className="text-gray-300" />
                  </button>
                </div>
                <button
                  onClick={() => handleRemoveCard(cardId)}
                  className="flex items-center justify-center bg-red-500/20 hover:bg-red-500/30 rounded transition-colors"
                  style={{ minWidth: '44px', minHeight: '44px' }}
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
  );

  const renderImportExportPanel = () => (
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
            className="flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors"
            style={{ minHeight: '44px' }}
          >
            {copyFeedback === 'forcetable' ? <CheckCircle size={14} /> : <Copy size={14} />}
            {copyFeedback === 'forcetable' ? 'Copied!' : 'Copy as Forcetable JSON'}
          </button>
          <button
            onClick={() => handleExportCopy('swudb')}
            className="flex items-center justify-center gap-2 px-4 py-3 bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold rounded-lg transition-colors"
            style={{ minHeight: '44px' }}
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
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-3 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors"
            style={{ minHeight: '44px' }}
          >
            <Upload size={12} />
            Forcetable
          </button>
          <button
            onClick={() => handleImport('swudb')}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-3 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded-lg transition-colors"
            style={{ minHeight: '44px' }}
          >
            <Upload size={12} />
            SWUDB
          </button>
        </div>
      </div>
    </div>
  );

  const renderAnalysisPanel = () => (
    <div className="flex-1 overflow-auto">
      <div className="max-w-5xl mx-auto py-8 space-y-8">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h3 className="text-3xl font-bold text-white">Deck Analysis</h3>
          <div className={`px-4 py-1.5 rounded-full font-bold flex items-center gap-2 ${deckStatus.isValid ? 'bg-green-500 text-black' : 'bg-red-500 text-white'}`}>
            {deckStatus.isValid ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
            {deckStatus.isValid ? 'Format Legal' : 'Illegal Format'}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Status Overview */}
          <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700 space-y-4">
            <h4 className="text-sm font-bold uppercase tracking-wider text-gray-400">Deck Status</h4>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-gray-300">Format</span>
                <span className="text-white font-semibold">{selectedFormat}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-300">Main Deck</span>
                <span className={`font-semibold ${mainDeckTotal === 50 ? 'text-green-400' : 'text-yellow-400'}`}>{mainDeckTotal} / 50</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-300">Leader</span>
                <span className={selectedLeader ? 'text-green-400' : 'text-red-400'}>{selectedLeader ? 'Selected' : 'Missing'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-300">Base</span>
                <span className={selectedBase ? 'text-green-400' : 'text-red-400'}>{selectedBase ? 'Selected' : 'Missing'}</span>
              </div>
            </div>
          </div>

          {/* Ownership Overview */}
          <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700 space-y-4">
            <h4 className="text-sm font-bold uppercase tracking-wider text-gray-400">Collection Status</h4>
            {(() => {
              const totalNeeded = mainDeckTotal + (selectedLeader ? 1 : 0) + (selectedBase ? 1 : 0);
              let totalOwned = 0;
              mainDeckCards.forEach(({cardId, count}) => {
                const { total } = getCardOwnership(cardId);
                totalOwned += Math.min(count, total);
              });
              if (selectedLeader) {
                const { total } = getCardOwnership(selectedLeader);
                if (total > 0) totalOwned += 1;
              }
              if (selectedBase) {
                const { total } = getCardOwnership(selectedBase);
                if (total > 0) totalOwned += 1;
              }
              const percent = totalNeeded > 0 ? Math.round((totalOwned / totalNeeded) * 100) : 0;

              return (
                <div className="space-y-4">
                  <div className="flex items-end justify-between">
                    <span className="text-3xl font-bold text-white">{percent}%</span>
                    <span className="text-gray-400 text-sm">{totalOwned} / {totalNeeded} cards owned</span>
                  </div>
                  <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 transition-all" style={{ width: `${percent}%` }} />
                  </div>
                  {percent < 100 && (
                    <button
                      onClick={() => {
                        setActivePanel('shopping');
                        if (isMobile) setActiveMobileTab('shopping');
                        else setStep(4);
                      }}
                      className="w-full py-3 bg-blue-600/20 text-blue-400 text-sm font-bold rounded-lg border border-blue-500/30 hover:bg-blue-600/30 transition-all"
                      style={{ minHeight: '44px' }}
                    >
                      View Missing Cards
                    </button>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Mana/Cost Curve Summary */}
          <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700 space-y-4">
            <h4 className="text-sm font-bold uppercase tracking-wider text-gray-400">Average Cost</h4>
            {(() => {
              const totalCost = mainDeckCards.reduce((sum, {card, count}) => sum + (card.Cost || 0) * count, 0);
              const avg = mainDeckTotal > 0 ? (totalCost / mainDeckTotal).toFixed(2) : '0.00';
              return (
                <div className="space-y-1">
                  <div className="text-3xl font-bold text-white">{avg}</div>
                  <p className="text-xs text-gray-500">Resource cost average (excluding Leader/Base)</p>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Detailed Analysis Reports */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Cost Curve Graph */}
          <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
            <h4 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
              <BarChart3 className="text-yellow-500" size={20} />
              Resource Distribution
            </h4>
            <div className="flex items-end gap-2 h-48 px-4">
              {costCurve.map((count, cost) => (
                <div key={cost} className="flex-1 flex flex-col items-center gap-2 group">
                  <div
                    className="w-full bg-yellow-500/80 rounded-t-lg transition-all group-hover:bg-yellow-500 relative"
                    style={{ height: maxCostInCurve > 0 ? `${(count / maxCostInCurve) * 100}%` : '0%' }}
                  >
                    {count > 0 && <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs font-bold text-white">{count}</span>}
                  </div>
                  <span className="text-xs font-bold text-gray-500">{cost === 7 ? '7+' : cost}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Validation & Flags */}
          <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800">
            <h4 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
              <Shield className="text-blue-500" size={20} />
              Deck Validation
            </h4>
            <div className="space-y-3">
              {(() => {
                const flags = [];
                const leader = cardDataMap[selectedLeader];
                const base = cardDataMap[selectedBase];
                const deckAspects = new Set();
                if (leader?.Aspects) leader.Aspects.forEach(a => deckAspects.add(a));
                if (base?.Aspects) base.Aspects.forEach(a => deckAspects.add(a));

                // Aspect Penalty Check
                mainDeckCards.forEach(({card, count}) => {
                  if (card.Aspects) {
                    const penalties = card.Aspects.filter(a => !deckAspects.has(a));
                    if (penalties.length > 0) {
                      flags.push({
                        type: 'warning',
                        title: 'Aspect Penalty',
                        message: `${card.Name} requires ${penalties.join(', ')} (not provided by Leader/Base).`
                      });
                    }
                  }
                });

                // Synergy/Theme Detection
                const traitsCount = {};
                mainDeckCards.forEach(({card, count}) => {
                  if (card.Traits) {
                    card.Traits.forEach(t => {
                      traitsCount[t] = (traitsCount[t] || 0) + count;
                    });
                  }
                });

                const majorThemes = Object.entries(traitsCount).filter(([t, c]) => c >= 10);
                majorThemes.forEach(([trait, count]) => {
                  flags.push({
                    type: 'info',
                    title: `Theme: ${trait}`,
                    message: `Your deck has a strong ${trait} presence (${count} cards).`
                  });
                });

                if (mainDeckTotal < 50) flags.push({ type: 'error', title: 'Under Minimum Size', message: `Your deck needs ${50 - mainDeckTotal} more cards.` });
                if (mainDeckTotal > 50) flags.push({ type: 'warning', title: 'Over Minimum Size', message: `Your deck is ${mainDeckTotal - 50} cards over the 50-card minimum.` });

                if (flags.length === 0) return <p className="text-gray-500 italic text-center py-8">No issues detected. Deck looks solid!</p>;

                return flags.map((f, i) => (
                  <div key={i} className={`p-4 rounded-xl border flex items-start gap-3 ${
                    f.type === 'error' ? 'bg-red-500/10 border-red-500/30 text-red-400' :
                    f.type === 'warning' ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400' :
                    'bg-blue-500/10 border-blue-500/30 text-blue-400'
                  }`}>
                    {f.type === 'error' ? <AlertCircle size={18} className="mt-0.5" /> :
                     f.type === 'warning' ? <AlertCircle size={18} className="mt-0.5" /> :
                     <Info size={18} className="mt-0.5" />}
                    <div>
                      <div className="font-bold text-sm uppercase tracking-tight">{f.title}</div>
                      <div className="text-sm opacity-90">{f.message}</div>
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderAiSuggestionsPanel = () => (
    <div className="flex-1 overflow-auto space-y-4">
      {/* Header / trigger */}
      <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              <Sparkles size={16} className="text-purple-400" />
              AI Card Suggestions
            </h4>
            <p className="text-xs text-gray-500 mt-1">
              {selectedLeader && selectedBase
                ? 'Powered by Claude Haiku — select up to 5 suggested cards.'
                : 'Select a Leader and Base first.'}
            </p>
          </div>
          <button
            onClick={handleGetSuggestions}
            disabled={!selectedLeader || !selectedBase || isLoadingSuggestions}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm transition-colors ${
              selectedLeader && selectedBase && !isLoadingSuggestions
                ? 'bg-purple-600 hover:bg-purple-700 text-white'
                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
            }`}
            style={{ minHeight: '44px' }}
          >
            {isLoadingSuggestions
              ? <Loader2 size={14} className="animate-spin" />
              : <Sparkles size={14} />}
            {isLoadingSuggestions ? 'Analyzing…' : 'Suggest'}
          </button>
        </div>

        {suggestionsError && (
          <div className="mt-3 p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-xs flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            {suggestionsError}
          </div>
        )}
      </div>

      {/* Suggestion cards */}
      {aiSuggestions.length > 0 && (
        <div className="space-y-3">
          {aiSuggestions.map((suggestion) => {
            const card = cardDataMap[suggestion.id];
            if (!card) return null;
            const canAdd = (deckCards[suggestion.id] || 0) < getPlaysetQuantity(card.Type);
            return (
              <div
                key={suggestion.id}
                className="bg-gray-900 rounded-lg p-3 border border-gray-700 hover:border-purple-500/40 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => setPreviewCard(card)}
                    className="shrink-0 focus:outline-none focus:ring-2 focus:ring-purple-500 rounded"
                    aria-label={`Preview ${card.Name}`}
                  >
                    <img
                      src={CardService.getCardImage(card.Set, card.Number)}
                      alt={card.Name}
                      className="w-12 h-16 rounded object-cover border border-gray-600 hover:border-purple-400 transition-colors"
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-semibold text-sm truncate">{card.Name}</p>
                    <p className="text-gray-400 text-xs mb-1">{card.Type} · Cost {card.Cost ?? '?'}</p>
                    <p className="text-gray-300 text-xs italic leading-relaxed">{suggestion.reason}</p>
                  </div>
                  <button
                    onClick={() => handleAddCard(card)}
                    disabled={!canAdd}
                    className={`shrink-0 flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                      canAdd
                        ? 'bg-purple-600 hover:bg-purple-700 text-white'
                        : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                    }`}
                    style={{ minHeight: '44px', minWidth: '56px' }}
                    title={canAdd ? `Add ${card.Name} to deck` : 'Already at max copies'}
                  >
                    <Plus size={12} />
                    Add
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {!isLoadingSuggestions && aiSuggestions.length === 0 && !suggestionsError && (
        <div className="flex flex-col items-center justify-center py-16 text-gray-600 space-y-3">
          <Sparkles size={40} className="opacity-20" />
          <p className="text-sm text-center">
            {selectedLeader && selectedBase
              ? 'Click "Suggest" to get AI-powered card recommendations.'
              : 'Select a Leader and Base to unlock AI suggestions.'}
          </p>
        </div>
      )}
    </div>
  );

  // ─── Mobile tab definitions ──────────────────────────────────────────────────
  const mobileTabs = [
    { key: 'search', icon: Search, label: 'Search' },
    { key: 'deck', icon: Swords, label: 'Deck' },
    { key: 'ai', icon: Sparkles, label: 'AI' },
    { key: 'shopping', icon: ShoppingCart, label: 'Shop' },
    { key: 'importexport', icon: Download, label: 'Import' },
    { key: 'analysis', icon: BarChart3, label: 'Analysis' },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/80 md:flex md:items-center md:justify-center md:p-4">
      <div className="bg-gray-900 md:rounded-2xl md:shadow-2xl w-full md:max-w-7xl h-full md:h-auto md:max-h-[90vh] flex flex-col border-0 md:border border-gray-800">

        {/* Header */}
        <div className="flex items-center justify-between px-4 md:px-6 py-3 md:py-4 border-b border-gray-800 bg-gray-950 shrink-0">
          <div className="flex items-center gap-3">
            <Swords size={24} className="text-yellow-500" />
            <h2 className="text-xl font-bold text-white">Deck Builder</h2>
          </div>

          {/* Stepper — desktop only */}
          <div className="hidden md:flex items-center gap-2">
            {steps.map((s, idx) => (
              <React.Fragment key={s.name}>
                <div
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold transition-all ${
                    step === idx
                      ? 'bg-yellow-500 text-black'
                      : step > idx
                      ? 'bg-green-500/20 text-green-400'
                      : 'text-gray-500'
                  }`}
                  onClick={() => idx <= step && setStep(idx)}
                  style={{ cursor: idx <= step ? 'pointer' : 'default' }}
                >
                  {step > idx ? <CheckCircle size={14} /> : s.icon}
                  {s.name}
                </div>
                {idx < steps.length - 1 && <div className="w-4 h-px bg-gray-700" />}
              </React.Fragment>
            ))}
          </div>

          {/* Mobile step indicator */}
          <div className="flex md:hidden items-center gap-2 text-sm text-gray-400">
            <span className="font-semibold text-yellow-500">{steps[step]?.name}</span>
            <span>{step + 1}/{steps.length}</span>
          </div>

          <button
            onClick={onClose}
            className="flex items-center justify-center hover:bg-gray-800 rounded-lg transition-colors text-gray-400 hover:text-white"
            style={{ minWidth: '44px', minHeight: '44px' }}
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-hidden flex flex-col p-3 md:p-6">

          {loadingCards ? (
            <div className="flex flex-col items-center justify-center flex-1 gap-4">
              <Loader2 size={48} className="animate-spin text-yellow-500" />
              <p className="text-gray-400 animate-pulse">Loading card database...</p>
            </div>
          ) : (
            <>
              {/* Step 0: Welcome / Import */}
              {step === 0 && (
                <div className="flex-1 flex flex-col items-center justify-center max-w-2xl mx-auto w-full text-center space-y-8">
                  <div>
                    <h3 className="text-2xl md:text-3xl font-bold text-white mb-2">Create New Deck</h3>
                    <p className="text-gray-400">Choose how you want to start building your Star Wars: Unlimited deck.</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                    <button
                      onClick={() => setStep(1)}
                      className="flex flex-col items-center gap-4 p-8 bg-gray-800 hover:bg-gray-750 border border-gray-700 hover:border-yellow-500/50 rounded-2xl transition-all group"
                      style={{ minHeight: '120px' }}
                    >
                      <div className="w-16 h-16 bg-yellow-500/10 rounded-full flex items-center justify-center text-yellow-500 group-hover:scale-110 transition-transform">
                        <Plus size={32} />
                      </div>
                      <div>
                        <span className="block text-xl font-bold text-white">Start from Scratch</span>
                        <span className="text-sm text-gray-400">Pick format, leader, and base step-by-step</span>
                      </div>
                    </button>

                    <button
                      onClick={() => setActivePanel('importexport')}
                      className="flex flex-col items-center gap-4 p-8 bg-gray-800 hover:bg-gray-750 border border-gray-700 hover:border-blue-500/50 rounded-2xl transition-all group"
                      style={{ minHeight: '120px' }}
                    >
                      <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center text-blue-500 group-hover:scale-110 transition-transform">
                        <Upload size={32} />
                      </div>
                      <div>
                        <span className="block text-xl font-bold text-white">Import Decklist</span>
                        <span className="text-sm text-gray-400">Paste from SWUDB, Melee, or SWU.com</span>
                      </div>
                    </button>
                  </div>

                  {activePanel === 'importexport' && (
                    <div className="w-full bg-gray-900 rounded-xl p-6 border border-gray-700 animate-in fade-in slide-in-from-bottom-4">
                      <h4 className="text-lg font-bold text-white mb-4">Paste Decklist</h4>
                      {importFeedback && (
                        <div className={`mb-4 p-3 rounded-lg text-sm flex items-start gap-2 ${
                          importFeedback.type === 'success' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                        }`}>
                          {importFeedback.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                          {importFeedback.message}
                        </div>
                      )}
                      <textarea
                        value={importText}
                        onChange={(e) => { setImportText(e.target.value); setImportFeedback(null); }}
                        placeholder="Paste decklist here..."
                        className="w-full h-48 px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white font-mono text-sm focus:outline-none focus:border-yellow-500 resize-none"
                      />
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
                        <button onClick={() => handleImport('swudb')} className="px-3 py-3 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-lg" style={{ minHeight: '44px' }}>SWUDB</button>
                        <button onClick={() => handleImport('swucom')} className="px-3 py-3 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg" style={{ minHeight: '44px' }}>SWU.com</button>
                        <button onClick={() => handleImport('melee')} className="px-3 py-3 bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold rounded-lg" style={{ minHeight: '44px' }}>Melee.gg</button>
                        <button onClick={() => handleImport('forcetable')} className="px-3 py-3 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg" style={{ minHeight: '44px' }}>Forcetable</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Step 1: Format Selection */}
              {step === 1 && (
                <div className="flex-1 flex flex-col items-center justify-center max-w-4xl mx-auto w-full text-center space-y-8">
                  <div>
                    <h3 className="text-2xl md:text-3xl font-bold text-white mb-2">Select Format</h3>
                    <p className="text-gray-400">Choose the gameplay format for this deck.</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full">
                    {[
                      { id: 'Premier', name: 'Premier', desc: 'Standard 50-card deck, 1 Leader, 1 Base, max 3 copies.' },
                      { id: 'Twin Suns', name: 'Twin Suns', desc: 'Two Leaders, 1 Base, 50-card deck, singleton (max 1 copy).' },
                      { id: 'Trilogy', name: 'Trilogy', desc: 'Premier rules, but only using cards from the current block.' }
                    ].map(f => (
                      <button
                        key={f.id}
                        onClick={() => { setSelectedFormat(f.id); setStep(2); }}
                        className={`flex flex-col items-start gap-3 p-6 rounded-2xl border-2 transition-all text-left ${
                          selectedFormat === f.id ? 'bg-yellow-500/10 border-yellow-500' : 'bg-gray-800 border-gray-700 hover:border-gray-600'
                        }`}
                        style={{ minHeight: '44px' }}
                      >
                        <span className={`px-2 py-1 rounded text-[10px] font-black uppercase ${selectedFormat === f.id ? 'bg-yellow-500 text-black' : 'bg-gray-700 text-gray-400'}`}>Format</span>
                        <span className="text-xl font-bold text-white">{f.name}</span>
                        <p className="text-sm text-gray-400">{f.desc}</p>
                      </button>
                    ))}
                  </div>

                  <button onClick={() => setStep(0)} className="text-gray-500 hover:text-white transition-colors py-3 px-6" style={{ minHeight: '44px' }}>Back to Start</button>
                </div>
              )}

              {/* Step 2: Leader Selection */}
              {step === 2 && (
                <div className="flex-1 flex flex-col min-h-0">
                  <div className="mb-4 text-center">
                    <h3 className="text-xl md:text-2xl font-bold text-white">Select Leader</h3>
                    <p className="text-gray-400 text-sm">Choose the leader that will lead your deck.</p>
                  </div>

                  <div className="flex-1 overflow-auto bg-gray-800/50 rounded-2xl border border-gray-700 p-3 md:p-4">
                    <AdvancedSearch
                      onCardClick={(card) => {
                        if (card.Type === 'Leader') {
                          setSelectedLeader(`${card.Set}_${card.Number}`);
                          setDeckCards(prev => ({ ...prev, [`${card.Set}_${card.Number}`]: 1 }));
                          setStep(3);
                        }
                      }}
                      collectionData={collectionData}
                      embedded={true}
                      initialFilters={{ types: ['Leader'] }}
                    />
                  </div>
                  <div className="mt-4 flex justify-between">
                    <button
                      onClick={() => setStep(1)}
                      className="px-6 py-3 text-gray-400 hover:text-white"
                      style={{ minHeight: '44px' }}
                    >
                      Back
                    </button>
                    {selectedLeader && (
                      <button
                        onClick={() => setStep(3)}
                        className="px-8 py-3 bg-yellow-500 text-black font-bold rounded-lg"
                        style={{ minHeight: '44px' }}
                      >
                        Next: Select Base
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Step 3: Base Selection */}
              {step === 3 && (
                <div className="flex-1 flex flex-col min-h-0">
                  <div className="mb-4 text-center">
                    <h3 className="text-xl md:text-2xl font-bold text-white">Select Base</h3>
                    <p className="text-gray-400 text-sm">Choose your base of operations.</p>
                  </div>

                  <div className="flex-1 overflow-auto bg-gray-800/50 rounded-2xl border border-gray-700 p-3 md:p-4">
                    <AdvancedSearch
                      onCardClick={(card) => {
                        if (card.Type === 'Base') {
                          setSelectedBase(`${card.Set}_${card.Number}`);
                          setDeckCards(prev => ({ ...prev, [`${card.Set}_${card.Number}`]: 1 }));
                          setStep(4);
                        }
                      }}
                      collectionData={collectionData}
                      embedded={true}
                      initialFilters={{ types: ['Base'] }}
                    />
                  </div>
                  <div className="mt-4 flex justify-between">
                    <button
                      onClick={() => setStep(2)}
                      className="px-6 py-3 text-gray-400 hover:text-white"
                      style={{ minHeight: '44px' }}
                    >
                      Back
                    </button>
                    {selectedBase && (
                      <button
                        onClick={() => setStep(4)}
                        className="px-8 py-3 bg-yellow-500 text-black font-bold rounded-lg"
                        style={{ minHeight: '44px' }}
                      >
                        Next: Build Deck
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* ── Step 4: Deck Construction ── */}

              {/* MOBILE layout: single-panel, bottom-nav controlled */}
              {step === 4 && isMobile && (
                <div className="flex-1 overflow-hidden flex flex-col">
                  {activeMobileTab === 'search' && (
                    <div className="flex-1 min-h-0 overflow-auto bg-gray-800/50 rounded-xl p-3 border border-gray-700">
                      <AdvancedSearch
                        onCardClick={handleAddCard}
                        collectionData={collectionData}
                        embedded={true}
                        getDeckCount={getDeckCount}
                        initialFilters={{
                          aspects: (() => {
                            const aspects = new Set();
                            const leader = cardDataMap[selectedLeader];
                            const base = cardDataMap[selectedBase];
                            if (leader?.Aspects) leader.Aspects.forEach(a => aspects.add(a));
                            if (base?.Aspects) base.Aspects.forEach(a => aspects.add(a));
                            return Array.from(aspects);
                          })()
                        }}
                      />
                    </div>
                  )}

                  {activeMobileTab === 'deck' && renderDeckPanel()}

                  {activeMobileTab === 'ai' && renderAiSuggestionsPanel()}

                  {activeMobileTab === 'shopping' && (
                    <div className="flex-1 overflow-auto">
                      <ShoppingList
                        deck={currentDeckSnapshot}
                        collectionData={collectionData}
                        cardDatabase={allCards}
                      />
                    </div>
                  )}

                  {activeMobileTab === 'importexport' && renderImportExportPanel()}

                  {activeMobileTab === 'analysis' && renderAnalysisPanel()}
                </div>
              )}

              {/* DESKTOP layout: two-panel side by side */}
              {step === 4 && !isMobile && (
                <div className="flex-1 overflow-hidden flex flex-col lg:flex-row gap-6">

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
                          initialFilters={{
                            aspects: (() => {
                              const aspects = new Set();
                              const leader = cardDataMap[selectedLeader];
                              const base = cardDataMap[selectedBase];
                              if (leader?.Aspects) leader.Aspects.forEach(a => aspects.add(a));
                              if (base?.Aspects) base.Aspects.forEach(a => aspects.add(a));
                              return Array.from(aspects);
                            })()
                          }}
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
                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-semibold transition-colors ${
                          activePanel === 'deck' ? 'bg-yellow-500 text-gray-950' : 'text-gray-400 hover:text-white'
                        }`}
                        style={{ minHeight: '44px' }}
                      >
                        <Swords size={14} />
                        Deck
                      </button>
                      <button
                        onClick={() => setActivePanel('shopping')}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-semibold transition-colors ${
                          activePanel === 'shopping' ? 'bg-yellow-500 text-gray-950' : 'text-gray-400 hover:text-white'
                        }`}
                        style={{ minHeight: '44px' }}
                      >
                        <ShoppingCart size={14} />
                        Shopping
                      </button>
                      <button
                        onClick={() => setActivePanel('importexport')}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-semibold transition-colors ${
                          activePanel === 'importexport' ? 'bg-yellow-500 text-gray-950' : 'text-gray-400 hover:text-white'
                        }`}
                        style={{ minHeight: '44px' }}
                      >
                        <Download size={14} />
                        Import/Export
                      </button>
                      <button
                        onClick={() => setActivePanel('ai')}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-semibold transition-colors ${
                          activePanel === 'ai' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'
                        }`}
                        style={{ minHeight: '44px' }}
                      >
                        <Sparkles size={14} />
                        AI
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
                    {activePanel === 'importexport' && renderImportExportPanel()}

                    {/* AI Suggestions Panel */}
                    {activePanel === 'ai' && renderAiSuggestionsPanel()}

                    {/* Deck Panel (default) */}
                    {activePanel === 'deck' && renderDeckPanel()}
                  </div>
                </div>
              )}

              {/* Step 5: Analysis (desktop / non-mobile) */}
              {step === 5 && renderAnalysisPanel()}
            </>
          )}
        </div>

        {/* Mobile Bottom Navigation — step 4 only */}
        {isMobile && step === 4 && (
          <div className="flex items-stretch bg-gray-950 border-t border-gray-800 shrink-0">
            {mobileTabs.map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                onClick={() => setActiveMobileTab(key)}
                className="flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors"
                style={{ minHeight: '56px' }}
              >
                <Icon
                  size={20}
                  className={activeMobileTab === key ? 'text-yellow-500' : 'text-gray-500'}
                />
                <span className={`text-[10px] font-semibold ${activeMobileTab === key ? 'text-yellow-500' : 'text-gray-500'}`}>
                  {label}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Bottom Bar */}
        <div className="border-t border-gray-800 bg-gray-950 px-4 md:px-6 py-3 md:py-4 shrink-0">
          {saveError && (
            <div className="mb-3 p-3 bg-red-500/20 border border-red-500/50 rounded-lg flex items-center gap-2 text-red-300 text-sm">
              <AlertCircle size={16} />
              {saveError}
            </div>
          )}

          <div className="flex gap-3 items-center">
            <input
              type="text"
              value={deckName}
              onChange={(e) => setDeckName(e.target.value)}
              placeholder="Deck name..."
              className="flex-1 min-w-0 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-yellow-500"
              style={{ minHeight: '44px' }}
            />

            {/* Desktop-only: Analyze / Back to Building */}
            {!isMobile && step === 4 && (
              <button
                onClick={() => setStep(5)}
                className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold shrink-0"
                style={{ minHeight: '44px' }}
              >
                <BarChart3 size={18} />
                Analyze
              </button>
            )}
            {!isMobile && step === 5 && (
              <button
                onClick={() => setStep(4)}
                className="flex items-center justify-center px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-semibold shrink-0"
                style={{ minHeight: '44px' }}
              >
                Back to Building
              </button>
            )}

            <button
              onClick={onClose}
              className="flex items-center justify-center px-4 md:px-6 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-gray-200 font-semibold transition-colors shrink-0"
              style={{ minHeight: '44px' }}
            >
              <span className="hidden md:inline">Close</span>
              <X size={18} className="md:hidden" />
            </button>
            <button
              onClick={handleSaveDeck}
              disabled={!deckStatus.isValid || isSaving}
              className={`flex items-center justify-center gap-2 px-4 md:px-6 py-2 rounded-lg font-semibold transition-colors shrink-0 ${
                deckStatus.isValid && !isSaving
                  ? 'bg-yellow-500 hover:bg-yellow-600 text-black'
                  : 'bg-gray-700 text-gray-400 cursor-not-allowed'
              }`}
              style={{ minHeight: '44px' }}
              title={deckStatus.isValid ? 'Save Deck' : deckStatus.message}
            >
              {isSaving ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Save size={18} />
              )}
              <span className="hidden md:inline">
                {deckStatus.isValid ? 'Save Deck' : deckStatus.message}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Full-size card preview overlay */}
      {previewCard && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4"
          onClick={() => setPreviewCard(null)}
        >
          <button
            className="absolute top-4 right-4 flex items-center justify-center bg-black/60 hover:bg-red-500/80 rounded-full text-white transition-colors border border-white/10"
            style={{ minWidth: '44px', minHeight: '44px' }}
            onClick={() => setPreviewCard(null)}
            aria-label="Close preview"
          >
            <X size={22} />
          </button>
          <img
            src={CardService.getCardImage(previewCard.Set, previewCard.Number)}
            alt={previewCard.Name}
            className="max-h-[85vh] max-w-[85vw] object-contain rounded-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <p className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white text-sm font-semibold bg-black/70 px-4 py-2 rounded-full pointer-events-none">
            {previewCard.Name}
          </p>
        </div>
      )}
    </div>
  );
}
