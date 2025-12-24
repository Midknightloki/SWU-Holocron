import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Layers, RefreshCw, Loader2, Cloud, WifiOff, LayoutGrid, BarChart3,
  Search, ChevronUp, ChevronDown, Plus, Minus, Info, AlertCircle
} from 'lucide-react';
import { SETS, ASPECTS } from './constants';
import { auth, db, isConfigured as isFirebaseConfigured, APP_ID } from './firebase';
import { CardService } from './services/CardService';
import { collection, doc, onSnapshot, setDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { parseCSV, generateCSV } from './utils/csvParser';
import { getCollectionId, reconstructCardsFromCollection, isHorizontalCard } from './utils/collectionHelpers';

import LandingScreen from './components/LandingScreen';
import Dashboard from './components/Dashboard';
import CardModal from './components/CardModal';
import PWAUpdatePrompt from './components/PWAUpdatePrompt';
import InstallPrompt from './components/InstallPrompt';

// Helper to determine collection path
// @environment:firebase
const getCollectionRef = (user, syncCode) => {
  if (!db || !APP_ID) return null;
  if (!user) return null;
  if (syncCode) {
    return collection(db, 'artifacts', APP_ID, 'public', 'data', `sync_${syncCode}`);
  } else {
    return collection(db, 'artifacts', APP_ID, 'users', user.uid, 'collection');
  }
};

export default function App() {
  // Set and Card State
  const [activeSet, setActiveSet] = useState('ALL');
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [error, setError] = useState(null);
  const [reconstructedData, setReconstructedData] = useState(false);
  const [availableSets, setAvailableSets] = useState(() => {
    const cached = localStorage.getItem('swu-available-sets');
    return cached ? JSON.parse(cached) : [];
  });

  // Auth and Collection State
  const [user, setUser] = useState(null);
  const [collectionData, setCollectionData] = useState({});
  const [authLoading, setAuthLoading] = useState(true);
  const [syncCode, setSyncCode] = useState(() => localStorage.getItem('swu-sync-code') || '');
  const [isGuestMode, setIsGuestMode] = useState(() => localStorage.getItem('swu-guest-mode') === 'true');
  const [hasVisited, setHasVisited] = useState(() => localStorage.getItem('swu-has-visited') === 'true');
  
  // UI State
  const [view, setView] = useState('binder');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedAspect, setSelectedAspect] = useState('All');
  const [selectedType, setSelectedType] = useState('All');
  const [selectedCard, setSelectedCard] = useState(null);
  const [isHeaderExpanded, setIsHeaderExpanded] = useState(true);
  const [importing, setImporting] = useState(false);

  const fileInputRef = useRef(null);

  // Auth Init
  useEffect(() => {
    if (!isFirebaseConfigured) {
      setAuthLoading(false);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      if (u) {
        setUser(u);
        setAuthLoading(false);
      } else {
        signInAnonymously(auth).catch(e => console.error(e));
      }
    });
    return () => unsubscribe();
  }, []);

  // Discover Available Sets
  useEffect(() => {
    const discoverSets = async () => {
      const sets = await CardService.getAvailableSets();
      if (sets.length > 0) {
        setAvailableSets(sets);
        localStorage.setItem('swu-available-sets', JSON.stringify(sets));
      }
    };
    
    if (hasVisited && (syncCode || isGuestMode)) {
      discoverSets();
      // Refresh available sets every hour
      const interval = setInterval(discoverSets, 60 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [hasVisited, syncCode, isGuestMode]);

  // Sync Code Persistence
  useEffect(() => {
    if(syncCode) localStorage.setItem('swu-sync-code', syncCode);
    else localStorage.removeItem('swu-sync-code');
  }, [syncCode]);

  // Guest Mode Persistence
  useEffect(() => {
    if(isGuestMode) localStorage.setItem('swu-guest-mode', 'true');
    else localStorage.removeItem('swu-guest-mode');
  }, [isGuestMode]);

  // Collection Data Listener
  useEffect(() => {
    if (!user || (!syncCode && !isGuestMode)) {
      console.log('Collection listener not active:', 'user:', !!user, 'syncCode:', !!syncCode, 'isGuestMode:', isGuestMode);
      return;
    }
    
    const ref = getCollectionRef(user, syncCode);
    if (!ref) {
      console.error('Failed to get collection ref');
      return;
    }

    console.log('Setting up collection listener - uid:', user.uid, 'syncCode:', syncCode || '(guest)', 'isGuestMode:', isGuestMode);
    const unsub = onSnapshot(ref, (snap) => {
      const data = {};
      snap.forEach(d => data[d.id] = d.data());
      console.log('Collection updated:', Object.keys(data).length, 'items');
      setCollectionData(data);
    }, err => console.error("Collection sync error:", err));
    
    return () => unsub();
  }, [user, syncCode, isGuestMode]);

  // Data Loading
  useEffect(() => {
    if (hasVisited && (syncCode || isGuestMode)) {
      // Clear filters when switching sets for cleaner UX
      setSearchTerm('');
      setSelectedAspect('All');
      setSelectedType('All');
      loadSetData();
    }
  }, [activeSet, hasVisited, syncCode, isGuestMode]);

  const loadSetData = async (force = false) => {
    setLoading(true);
    setError(null);
    setReconstructedData(false);

    try {
      // 1. Try Local Cache
      const cacheKey = `swu-cards-${activeSet}`;
      const local = localStorage.getItem(cacheKey);
      if (!force && local) {
        setCards(JSON.parse(local));
        setLoading(false);
        return;
      }

      // 2. Fetch from Service
      const { data, source } = await CardService.fetchSetData(activeSet);
      data.sort((a, b) => a.Number.localeCompare(b.Number, undefined, { numeric: true }));
      setCards(data);
      setLastSync(source);
      localStorage.setItem(cacheKey, JSON.stringify(data));
    } catch (e) {
      console.error(e);
      // 3. Fallback: Reconstruct from Collection
      const reconstructed = reconstructCardsFromCollection(collectionData, activeSet);
      if (reconstructed.length > 0) {
        setCards(reconstructed);
        setReconstructedData(true);
        setError("Network offline. Showing collection-only view.");
      } else {
        setCards([]);
        setError("Unable to load card data. Check your connection and try refreshing.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleStart = (code) => {
    console.log('handleStart called with code:', code);
    if (code) {
      console.log('Setting sync code:', code);
      setSyncCode(code);
      setIsGuestMode(false);
      // Immediately save to localStorage to ensure persistence
      localStorage.setItem('swu-sync-code', code);
      localStorage.removeItem('swu-guest-mode');
    } else {
      console.log('Starting in guest mode');
      setIsGuestMode(true);
      setSyncCode('');
      localStorage.setItem('swu-guest-mode', 'true');
      localStorage.removeItem('swu-sync-code');
    }
    setHasVisited(true);
    localStorage.setItem('swu-has-visited', 'true');
  };

  // CSV Import Handler
  // @environment:web-file-api
  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImporting(true);
    try {
      const text = await file.text();
      const { items, errors } = parseCSV(text);

      if (errors.length > 0) {
        console.warn('CSV parsing warnings:', errors);
      }

      if (items.length === 0) {
        alert('No valid items found in CSV file');
        return;
      }

      // Batch write to Firestore
      const ref = getCollectionRef(user, syncCode);
      if (!ref) {
        alert('Not connected to cloud storage');
        return;
      }

      let batch = writeBatch(db);
      let batchCount = 0;

      for (const item of items) {
        const collId = getCollectionId(item.set, item.number, item.isFoil);
        const docRef = doc(ref, collId);

        batch.set(docRef, {
          quantity: item.quantity,
          set: item.set,
          number: item.number,
          name: item.name,
          isFoil: item.isFoil,
          timestamp: Date.now()
        }, { merge: true });

        batchCount++;

        // Firestore batch limit is 500, commit at 400 to be safe
        if (batchCount >= 400) {
          await batch.commit();
          batch = writeBatch(db); // Create new batch after commit
          batchCount = 0;
        }
      }

      // Commit remaining
      if (batchCount > 0) {
        await batch.commit();
      }

      alert(`Successfully imported ${items.length} items${errors.length > 0 ? ` with ${errors.length} warnings` : ''}`);
    } catch (error) {
      console.error('Import error:', error);
      alert(`Import failed: ${error.message}`);
    } finally {
      setImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // CSV Export Handler
  // @environment:web-file-api
  const handleExport = () => {
    if (Object.keys(collectionData).length === 0) {
      alert('No collection data to export');
      return;
    }

    try {
      const csv = generateCSV(collectionData);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);

      link.setAttribute('href', url);
      link.setAttribute('download', `swu_collection_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export error:', error);
      alert(`Export failed: ${error.message}`);
    }
  };

  // Grid Quantity Handler
  const handleGridQuantityChange = async (card, delta) => {
    if (!db || (!user && !syncCode)) {
      console.error('Cannot update: no db or user');
      return;
    }

    const ref = getCollectionRef(user, syncCode);
    if (!ref) {
      console.error('Cannot get collection ref');
      return;
    }

    const collId = getCollectionId(card.Set, card.Number, false); // Default to standard
    const currentQty = collectionData[collId]?.quantity || 0;
    const newQty = currentQty + delta;

    console.log('Updating card:', { collId, currentQty, newQty, card: card.Name });

    try {
      const docRef = doc(ref, collId);
      if (newQty > 0) {
        await setDoc(docRef, {
          quantity: newQty,
          set: activeSet,
          number: card.Number,
          name: card.Name,
          isFoil: false,
          timestamp: Date.now()
        }, { merge: true });
        console.log('✓ Card updated successfully');
      } else {
        await deleteDoc(docRef);
      }
    } catch (error) {
      console.error('Error updating collection:', error);
    }
  };

  if (!hasVisited || (!syncCode && !isGuestMode)) {
    return <LandingScreen onStart={handleStart} />;
  }

  // Safety check: Don't render if user is authenticated but syncCode isn't set yet
  if (user && !syncCode && !isGuestMode) {
    console.log('Waiting for syncCode to be set...');
    return <div className="min-h-screen bg-gray-900 flex items-center justify-center text-white">Loading...</div>;
  }

  // Filter Logic
  const filteredCards = useMemo(() => {
    if (!Array.isArray(cards)) return [];
    return cards.filter(card => {
      if (!card) return false;
      // Only show cards from the current set
      if (card.Set !== activeSet) return false;
      const matchSearch = card.Name?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchAspect = selectedAspect === 'All' || (card.Aspects && card.Aspects.includes(selectedAspect));
      const matchType = selectedType === 'All' || card.Type === selectedType;
      return matchSearch && matchAspect && matchType;
    });
  }, [cards, searchTerm, selectedAspect, selectedType, activeSet]);

  const uniqueTypes = useMemo(() => {
    if (!Array.isArray(cards)) return ['All'];
    const types = new Set(cards.map(c => c?.Type).filter(Boolean));
    return ['All', ...types].sort();
  }, [cards]);

  // Compute available SETS based on discovered sets
  const visibleSets = useMemo(() => {
    // If we have discovered sets, only show those with cards
    if (availableSets.length > 0) {
      const filtered = SETS.filter(s => availableSets.includes(s.code));
      // If filtering resulted in sets, use them; otherwise show all as fallback
      return filtered.length > 0 ? filtered : SETS;
    }
    // If no discovery data yet, show all sets (will be filtered once discovery completes)
    return SETS;
  }, [availableSets]);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans selection:bg-yellow-500/30">
      <input
        type="file"
        accept=".csv,text/csv,application/vnd.ms-excel,text/plain"
        ref={fileInputRef}
        onChange={handleFileUpload}
        className="hidden"
      />

      {/* Header */}
      <header className="sticky top-0 z-40 bg-gray-900/90 backdrop-blur-md border-b border-gray-800 shadow-xl transition-all duration-300">
        <div className="max-w-7xl mx-auto px-4 py-2">
          {/* Top Bar */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 flex-1">
              <div className="w-8 h-8 bg-yellow-500 rounded-lg flex items-center justify-center shadow-lg shadow-yellow-500/20">
                <Layers className="text-black" size={20} />
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight text-white leading-tight">SWU Holocron</h1>
                <div className="flex items-center gap-2 text-[10px] text-gray-500">
                  {loading ? (
                    <span className="flex items-center gap-1 text-yellow-500">
                      <RefreshCw size={8} className="animate-spin" /> Syncing...
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">DB: {lastSync || 'Never'}</span>
                  )}
                  <div className="flex items-center gap-1 pl-2 border-l border-gray-700">
                    {authLoading ? (
                      <Loader2 size={8} className="animate-spin text-gray-400" />
                    ) : (
                      <>
                        {syncCode ? <Cloud size={8} className="text-yellow-500" /> : (user ? <Cloud size={8} className="text-green-500" /> : <WifiOff size={8} className="text-red-500" />)}
                        <span>{syncCode ? "Sync Active" : (user ? "Cloud" : "Offline")}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* View Toggle */}
            <div className="flex items-center gap-2">
              <div className="flex bg-gray-800 rounded-lg p-1 mr-2 border border-gray-700">
                <button
                  onClick={() => setView('binder')}
                  className={`p-2 rounded-md transition-colors ${view === 'binder' ? 'bg-gray-700 text-white shadow' : 'text-gray-400 hover:text-white'}`}
                  title="Binder View"
                >
                  <LayoutGrid size={18} />
                </button>
                <button
                  onClick={() => setView('dashboard')}
                  className={`p-2 rounded-md transition-colors ${view === 'dashboard' ? 'bg-gray-700 text-white shadow' : 'text-gray-400 hover:text-white'}`}
                  title="Dashboard"
                >
                  <BarChart3 size={18} />
                </button>
              </div>
              <button
                onClick={() => loadSetData(true)}
                disabled={loading}
                className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-full transition-colors hidden md:block border border-gray-700/50"
                title="Force Sync"
              >
                <RefreshCw size={20} className={loading ? "animate-spin" : ""} />
              </button>
              <button
                onClick={() => setIsHeaderExpanded(!isHeaderExpanded)}
                className="p-2 text-gray-400 hover:text-white bg-gray-800/50 hover:bg-gray-800 rounded-full transition-colors"
              >
                {isHeaderExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              </button>
            </div>
          </div>

          {/* Expandable Controls */}
          <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isHeaderExpanded ? 'max-h-[500px] opacity-100 mt-2' : 'max-h-0 opacity-0'}`}>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2">
              {/* Set Tabs */}
              <div className="flex bg-gray-800 p-1 rounded-lg overflow-x-auto no-scrollbar max-w-full">
                {visibleSets.map(set => (
                  <button
                    key={set.code}
                    onClick={() => setActiveSet(set.code)}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-all whitespace-nowrap ${activeSet === set.code ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'}`}
                  >
                    {set.code}
                  </button>
                ))}
              </div>
            </div>

            {/* Filters (Only in Binder View) */}
            {view === 'binder' && (
              <div className="mt-2 flex flex-col md:flex-row gap-4 items-center justify-between pb-2 border-t border-gray-800 pt-4">
                <div className="relative w-full md:w-64 group">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-yellow-500 transition-colors" size={16} />
                  <input
                    type="text"
                    placeholder="Search cards..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full bg-gray-800/50 border border-gray-700 rounded-full pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-yellow-500/50 focus:ring-1 focus:ring-yellow-500/50 transition-all placeholder:text-gray-600"
                  />
                </div>
                <div className="flex items-center gap-3 overflow-x-auto w-full md:w-auto pb-2 md:pb-0 no-scrollbar">
                  <div className="flex items-center gap-1 bg-gray-800/50 rounded-full p-1 border border-gray-700">
                    <button
                      onClick={() => setSelectedAspect('All')}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${selectedAspect === 'All' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
                    >
                      All
                    </button>
                    {ASPECTS.map(aspect => {
                      const Icon = aspect.icon;
                      return (
                        <button
                          key={aspect.name}
                          onClick={() => setSelectedAspect(aspect.name)}
                          className={`p-1.5 rounded-full transition-all ${selectedAspect === aspect.name ? `${aspect.bg} ${aspect.color} ring-1 ring-inset ${aspect.border} shadow-[0_0_10px_rgba(0,0,0,0.5)]` : `${aspect.color} opacity-70 hover:opacity-100 hover:bg-gray-800`}`}
                          title={aspect.name}
                        >
                          <Icon size={16} />
                        </button>
                      );
                    })}
                  </div>
                  <select
                    value={selectedType}
                    onChange={(e) => setSelectedType(e.target.value)}
                    className="bg-gray-800/50 text-gray-300 text-xs font-medium px-3 py-2 rounded-full border border-gray-700 focus:outline-none focus:border-yellow-500 cursor-pointer"
                  >
                    {uniqueTypes.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 md:p-6">
        {error && (
          <div className="mb-6 p-4 bg-red-900/20 border border-red-500/30 rounded-xl text-red-200 flex items-center gap-2">
            <Info size={18} />
            {error}
          </div>
        )}

        {loading && (!cards || cards.length === 0) ? (
          <div className="flex flex-col items-center justify-center h-96 gap-4 text-gray-500">
            <div className="w-12 h-12 border-4 border-gray-700 border-t-yellow-500 rounded-full animate-spin"></div>
            <p className="animate-pulse">Accessing Imperial Archives...</p>
          </div>
        ) : (
          <>
            {view === 'dashboard' ? (
              <Dashboard
                setCode={activeSet}
                cards={cards}
                collectionData={collectionData}
                onImport={() => fileInputRef.current?.click()}
                onExport={handleExport}
                isImporting={importing}
                hasDataToExport={Object.keys(collectionData).length > 0}
                syncCode={syncCode || ''}
                setSyncCode={setSyncCode}
                onUpdateQuantity={handleGridQuantityChange}
                onCardClick={setSelectedCard}
              />
            ) : (
              <>
                {reconstructedData && (
                  <div className="bg-yellow-900/20 border border-yellow-600/50 p-4 rounded-xl mb-4 flex items-center gap-3 text-yellow-200 text-sm">
                    <AlertCircle size={20} />
                    <span>Showing collection-based view. Some card details may be missing until API connection is restored.</span>
                  </div>
                )}

                <div className="mb-4 text-gray-500 text-sm font-medium">
                  Showing {filteredCards.length} cards from <span className="text-yellow-500">{SETS.find(s => s.code === activeSet)?.name}</span>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-6">
                  {filteredCards.map((card) => {
                    const isHoriz = isHorizontalCard(card.Type);
                    const stdKey = getCollectionId(card.Set, card.Number, false);
                    const foilKey = getCollectionId(card.Set, card.Number, true);
                    const stdOwned = collectionData[stdKey]?.quantity || 0;
                    const foilOwned = collectionData[foilKey]?.quantity || 0;
                    const totalOwned = stdOwned + foilOwned;

                    return (
                      <div
                        key={`${card.Number}-${card.Name}`}
                        onClick={() => setSelectedCard(card)}
                        className={`group relative bg-gray-800 rounded-xl overflow-hidden cursor-pointer shadow-lg hover:shadow-2xl transition-all hover:-translate-y-2 hover:ring-2 ring-yellow-500/50 ${isHoriz ? 'col-span-2 aspect-[88/63]' : 'col-span-1 aspect-[63/88]'}`}
                      >
                        <div className="absolute top-2 right-2 z-20" onClick={(e) => e.stopPropagation()}>
                          <div className={`flex items-center gap-1 bg-gray-900/90 rounded-full border border-gray-600 shadow-xl backdrop-blur-sm p-0.5 transition-all duration-300 ${totalOwned > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0'}`}>
                            <button
                              onClick={() => handleGridQuantityChange(card, -1)}
                              className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-red-500/20 text-gray-400 hover:text-red-400"
                              disabled={(!user && !syncCode) || !db}
                            >
                              <Minus size={12} />
                            </button>
                            <div className="flex flex-col items-center justify-center min-w-[20px]">
                              <span className={`text-xs font-bold leading-none ${stdOwned > 0 ? 'text-white' : 'text-gray-500'}`}>{stdOwned}</span>
                              {foilOwned > 0 && <span className="text-[8px] font-bold text-yellow-500 leading-none mt-0.5">+{foilOwned}F</span>}
                            </div>
                            <button
                              onClick={() => handleGridQuantityChange(card, 1)}
                              className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-green-500/20 text-gray-400 hover:text-green-400"
                              disabled={(!user && !syncCode) || !db}
                            >
                              <Plus size={12} />
                            </button>
                          </div>
                        </div>

                        <div className="absolute inset-0 bg-gray-900 flex items-center justify-center">
                          <img
                            src={CardService.getCardImage(card.Set, card.Number)}
                            alt={card.Name}
                            loading="lazy"
                            className={`w-full h-full object-cover transition-opacity duration-300 ${totalOwned > 0 ? 'opacity-100' : 'opacity-80 group-hover:opacity-100'}`}
                            onError={(e) => {
                              e.target.style.display = 'none';
                              e.target.nextSibling.style.display = 'flex';
                            }}
                          />
                          <div className="hidden absolute inset-0 flex-col items-center justify-center p-4 text-center bg-gray-800">
                            <span className="text-xs text-gray-500">{card.Name}</span>
                          </div>
                        </div>

                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-4 pointer-events-none">
                          <div className="transform translate-y-4 group-hover:translate-y-0 transition-transform duration-300">
                            <h3 className="text-white font-bold leading-tight shadow-black drop-shadow-md">{card.Name}</h3>
                            {card.Subtitle && <p className="text-yellow-400 text-xs italic">{card.Subtitle}</p>}
                            <div className="flex items-center gap-2 mt-2">
                              <span className="text-gray-300 text-xs px-2 py-0.5 bg-gray-700 rounded-full">{card.Type}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {filteredCards.length === 0 && (
                  <div className="py-20 text-center text-gray-500">
                    <p className="text-lg">No cards found matching your criteria.</p>
                    <button
                      onClick={() => { setSearchTerm(''); setSelectedAspect('All'); setSelectedType('All'); }}
                      className="mt-4 text-yellow-500 hover:underline"
                    >
                      Clear all filters
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>

      {/* Card Modal */}
      {selectedCard && (
        <CardModal
          initialCard={selectedCard}
          allCards={cards}
          setCode={activeSet}
          user={user}
          collectionData={collectionData}
          syncCode={syncCode}
          onClose={() => setSelectedCard(null)}
        />
      )}

      {/* PWA Components */}
      <PWAUpdatePrompt />
      <InstallPrompt />
    </div>
  );
}