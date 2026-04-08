import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Layers, RefreshCw, Loader2, Cloud, LayoutGrid, BarChart3,
  Search, Plus, Minus, Info, AlertCircle, FileText,
  User, Menu, X, Shield, Swords
} from 'lucide-react';
import { SETS, ASPECTS } from './constants';
import { db, APP_ID } from './firebase';
import { CardService } from './services/CardService';
import { DeckService } from './services/DeckService';
import { collection, doc, onSnapshot, setDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { parseCSV, generateCSV } from './utils/csvParser';
import { getCollectionId, reconstructCardsFromCollection, isHorizontalCard } from './utils/collectionHelpers';
import { isSpecialSet, SET_CODE_MAP } from './utils/officialCodeUtils';
import { useAuth } from './contexts/AuthContext';
import { MigrationService } from './services/MigrationService';

import LandingScreen from './components/LandingScreen';
import Dashboard from './components/Dashboard';
import CardModal from './components/CardModal';
import AdvancedSearch from './components/AdvancedSearch';
import PWAUpdatePrompt from './components/PWAUpdatePrompt';
import InstallPrompt from './components/InstallPrompt';
import CardSubmissionForm from './components/CardSubmissionForm';
import AdminPanel from './components/AdminPanel';
import DeckManager from './components/DeckManager';
import DeckBuilder from './components/DeckBuilder';

// Version info
const VERSION = __APP_VERSION__;
const BUILD_TIME = __BUILD_TIME__;

// Helper to determine collection path
// @environment:firebase
const getCollectionRef = (user, legacySyncCode, useLegacyPath) => {
  if (!db || !APP_ID || !user) return null;
  if (useLegacyPath && legacySyncCode) {
    return collection(db, 'artifacts', APP_ID, 'public', 'data', `sync_${legacySyncCode}`);
  }
  return collection(db, 'artifacts', APP_ID, 'users', user.uid, 'collection');
};

export default function App() {
  const { user, isAdmin, loading: authLoading, loginWithGoogle, loginAnonymously, logout, error: authErrorFromContext } = useAuth();

  // Set and Card State
  const [activeSet, setActiveSet] = useState('SOR');
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
  const [collectionData, setCollectionData] = useState({});
  const [legacySyncCode, setLegacySyncCode] = useState(() => localStorage.getItem('swu-sync-code') || '');
  const [useLegacyPath, setUseLegacyPath] = useState(() => !!localStorage.getItem('swu-sync-code'));
  const [hasVisited, setHasVisited] = useState(() => localStorage.getItem('swu-has-visited') === 'true');
  const [authError, setAuthError] = useState('');
  const [migrationState, setMigrationState] = useState('idle');
  const [migrationMessage, setMigrationMessage] = useState('');
  const errorMessage = authError || authErrorFromContext?.message || '';

  // UI State
  const [view, setView] = useState('binder');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedAspect, setSelectedAspect] = useState('All');
  const [selectedType, setSelectedType] = useState('All');
  const [selectedCard, setSelectedCard] = useState(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [activeDeck, setActiveDeck] = useState(null);
  const [sortBy, setSortBy] = useState('number'); // 'number' | 'cost' | 'recent'
  const [sortDir, setSortDir] = useState('asc');   // 'asc' | 'desc'
  const [showMyCollection, setShowMyCollection] = useState(false);

  const fileInputRef = useRef(null);

  // Prevent non-admins from staying on the admin view if status changes
  useEffect(() => {
    if (view === 'admin' && !isAdmin) {
      setView('binder');
    }
  }, [view, isAdmin]);

  const handleGoogleLogin = async () => {
    setAuthError('');
    try {
      await loginWithGoogle();
      setHasVisited(true);
      localStorage.setItem('swu-has-visited', 'true');
    } catch (e) {
      console.error('Google login failed:', e);
      setAuthError(e?.message || 'Google sign-in failed. Please try again.');
    }
  };

  const handleGuestLogin = async () => {
    setAuthError('');
    try {
      await loginAnonymously();
      setHasVisited(true);
      localStorage.setItem('swu-has-visited', 'true');
    } catch (e) {
      console.error('Guest login failed:', e);
      setAuthError(e?.message || 'Guest mode failed. Please try again.');
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch (e) {
      console.error('Logout failed:', e);
      setAuthError(e?.message || 'Logout failed.');
    }
  };

  // Close user menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isUserMenuOpen && !event.target.closest('.user-menu-container')) {
        setIsUserMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isUserMenuOpen]);

  // Mark visit once authentication restores an existing session
  useEffect(() => {
    if (user && !hasVisited) {
      setHasVisited(true);
      localStorage.setItem('swu-has-visited', 'true');
    }
  }, [user, hasVisited]);

  // Prompt and run legacy sync migration when signing in with Google
  useEffect(() => {
    if (!user || !legacySyncCode || !useLegacyPath) return;
    if (migrationState === 'running') return;
    if (user.isAnonymous) return;

    const proceed = window.confirm(`We found a legacy Sync Key (${legacySyncCode}). Import it to your account?`);
    if (!proceed) return;

    const runMigration = async () => {
      try {
        setMigrationState('running');
        setMigrationMessage('Migrating legacy collection...');

        const { migrated } = await MigrationService.migrateCollection(
          db,
          ['artifacts', APP_ID, 'public', 'data', `sync_${legacySyncCode}`],
          ['artifacts', APP_ID, 'users', user.uid, 'collection']
        );

        setMigrationMessage(`Imported ${migrated} items from Sync Key ${legacySyncCode}.`);
        setUseLegacyPath(false);
        setLegacySyncCode('');
        localStorage.removeItem('swu-sync-code');
        setMigrationState('success');
        setCollectionData({});
      } catch (e) {
        console.error('Migration failed', e);
        setMigrationMessage(`Migration failed: ${e.message}`);
        setMigrationState('error');
      }
    };

    runMigration();
  }, [user, legacySyncCode, useLegacyPath, migrationState]);

  // Sync showMyCollection with auth state
  useEffect(() => {
    setShowMyCollection(!!user);
  }, [user]);

  // Discover Available Sets
  useEffect(() => {
    const discoverSets = async () => {
      const sets = await CardService.getAvailableSets();
      if (sets.length > 0) {
        setAvailableSets(sets);
        localStorage.setItem('swu-available-sets', JSON.stringify(sets));
      }
    };

    if (hasVisited && user) {
      discoverSets();
      // Refresh available sets every hour
      const interval = setInterval(discoverSets, 60 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [hasVisited, user]);

  // Collection Data Listener
  useEffect(() => {
    if (!user) {
      console.log('Collection listener not active: no user session');
      return;
    }

    const ref = getCollectionRef(user, legacySyncCode, useLegacyPath);
    if (!ref) {
      console.error('Failed to get collection ref');
      return;
    }

    console.log('Setting up collection listener - uid:', user.uid, 'mode:', useLegacyPath ? `legacy:${legacySyncCode}` : 'user');

    // Defer the listener setup to avoid React error #310
    // onSnapshot can fire synchronously if there's cached data, which would call
    // setCollectionData during the render cycle when handleStart triggers this effect
    let unsubscribe = null;
    const timer = setTimeout(() => {
      unsubscribe = onSnapshot(ref, (snap) => {
        const data = {};
        snap.forEach(d => data[d.id] = d.data());
        console.log('Collection updated:', Object.keys(data).length, 'items');
        setCollectionData(data);
      }, err => console.error("Collection sync error:", err));
    }, 0);

    return () => {
      clearTimeout(timer);
      if (unsubscribe) unsubscribe();
    };
  }, [user, legacySyncCode, useLegacyPath]);

  // Clear filters when switching sets
  useEffect(() => {
    setSearchTerm('');
    setSelectedAspect('All');
    setSelectedType('All');
  }, [activeSet]);

  // Data Loading
  useEffect(() => {
    if (hasVisited && user) {
      loadSetData();
    }
  }, [activeSet, hasVisited, user]);

  const loadSetData = async (force = false) => {
    setLoading(true);
    setError(null);
    setReconstructedData(false);

    try {
      // Special case: "All Sets" — combine data from per-set caches
      if (activeSet === 'ALL') {
        const allCards = [];
        for (const setCode of availableSets) {
          const cacheKey = `swu-cards-${setCode}`;
          const local = localStorage.getItem(cacheKey);
          if (local) {
            try { allCards.push(...JSON.parse(local)); } catch (_) {}
          }
        }
        if (allCards.length > 0) {
          allCards.sort((a, b) => String(a.Number).localeCompare(String(b.Number), undefined, { numeric: true }));
          setCards(allCards);
        } else {
          // No individual sets cached yet — nudge the user to browse a set first
          setCards([]);
          setError('Browse individual sets first to cache card data, then "All Sets" will work offline.');
        }
        setLoading(false);
        return;
      }

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
      data.sort((a, b) => String(a.Number).localeCompare(String(b.Number), undefined, { numeric: true }));
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
      const ref = getCollectionRef(user, legacySyncCode, useLegacyPath);
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
    if (!db || !user) {
      console.error('Cannot update: no db or user');
      return;
    }

    const ref = getCollectionRef(user, legacySyncCode, useLegacyPath);
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

  // Filter Logic - MUST be before any conditional returns (Rules of Hooks)
  const filteredCards = useMemo(() => {
    if (!Array.isArray(cards)) return [];
    return cards.filter(card => {
      if (!card) return false;
      // Only show cards from the current set (skip if 'ALL' is selected)
      if (activeSet !== 'ALL' && card.Set !== activeSet) return false;
      const matchSearch = card.Name?.toLowerCase().includes(searchTerm.toLowerCase());
      // Handle Neutral aspect filter for cards with no aspects
      const isNeutral = !card.Aspects || card.Aspects.length === 0;
      const matchAspect = selectedAspect === 'All' ||
        (selectedAspect === 'Neutral' ? isNeutral : (card.Aspects && card.Aspects.includes(selectedAspect)));
      const matchType = selectedType === 'All' || card.Type === selectedType;

      // Filter by collection ownership if showMyCollection is true
      if (showMyCollection) {
        const hasStandard = (collectionData[getCollectionId(card.Set, card.Number, false)]?.quantity ?? 0) > 0;
        const hasFoil = (collectionData[getCollectionId(card.Set, card.Number, true)]?.quantity ?? 0) > 0;
        if (!hasStandard && !hasFoil) return false;
      }

      return matchSearch && matchAspect && matchType;
    });
  }, [cards, searchTerm, selectedAspect, selectedType, activeSet, showMyCollection, collectionData]);

  // Sort Logic
  const sortedCards = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filteredCards].sort((a, b) => {
      if (sortBy === 'cost') {
        const aCost = a.Cost ?? Infinity;
        const bCost = b.Cost ?? Infinity;
        if (aCost !== bCost) return (aCost - bCost) * dir;
        // tie-break by card number
        return String(a.Number).localeCompare(String(b.Number), undefined, { numeric: true });
      }
      if (sortBy === 'recent') {
        const aKey = getCollectionId(a.Set, a.Number, false);
        const bKey = getCollectionId(b.Set, b.Number, false);
        const aTime = collectionData[aKey]?.timestamp ?? 0;
        const bTime = collectionData[bKey]?.timestamp ?? 0;
        if (aTime !== bTime) return (bTime - aTime) * dir; // higher timestamp = more recent, so invert for asc
        return String(a.Number).localeCompare(String(b.Number), undefined, { numeric: true });
      }
      // default: 'number'
      return String(a.Number).localeCompare(String(b.Number), undefined, { numeric: true }) * dir;
    });
  }, [filteredCards, collectionData, sortBy, sortDir]);

  const uniqueTypes = useMemo(() => {
    if (!Array.isArray(cards)) return ['All'];
    const types = new Set(cards.map(c => c?.Type).filter(Boolean));
    return ['All', ...types].sort();
  }, [cards]);

  // Compute available SETS based on discovered sets - fully dynamic
  const visibleSets = useMemo(() => {
    // If no discovery data yet, use fallback SETS constant (excluding ALT and PROMO initially)
    if (availableSets.length === 0) {
      return SETS.filter(s => s.code !== 'LAW' && s.code !== 'PROMO');
    }

    // Build set objects dynamically from discovered sets (only if they have cards)
    const dynamicSets = availableSets
      .filter(code => {
        // Always include discovered sets that have cards
        return true;
      })
      .map(code => {
        // Try to find metadata in known SETS constant
        const knownSet = SETS.find(s => s.code === code);
        return knownSet || { code, name: code }; // Fallback for unknown sets
      });

    // Separate mainline and special sets
    const mainlineSets = dynamicSets
      .filter(s => !isSpecialSet(s.code))
      .sort((a, b) => {
        const numA = parseInt(SET_CODE_MAP[a.code] || '99');
        const numB = parseInt(SET_CODE_MAP[b.code] || '99');
        return numA - numB;
      });

    const specialSets = dynamicSets
      .filter(s => isSpecialSet(s.code))
      .sort((a, b) => a.code.localeCompare(b.code));

    // Return mainline sets first, then special sets
    return [...mainlineSets, ...specialSets];
  }, [availableSets]);

  // Conditional rendering - MUST be after all hooks
  if (!user) {
    return (
      <LandingScreen
        onGoogleLogin={handleGoogleLogin}
        onGuest={handleGuestLogin}
        loading={authLoading}
        error={errorMessage}
        hasLegacySync={!!legacySyncCode}
      />
    );
  }

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
          <div className="flex items-center justify-between gap-2 md:gap-4">
            <div className="flex items-center gap-2 md:gap-4 flex-1 min-w-0">
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
                        <Cloud size={8} className={user?.isAnonymous ? 'text-yellow-500' : 'text-green-500'} />
                        <span>{user?.isAnonymous ? 'Guest mode' : 'Cloud'}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* View Toggle */}
            <div className="flex items-center gap-1 md:gap-2">
              <button
                onClick={() => setIsSearchOpen(true)}
                className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-all group border border-gray-700 hover:border-blue-500/50"
                title="Advanced Search"
              >
                <Search className="text-blue-500" size={18} />
                <span className="text-sm font-medium hidden lg:inline">Search</span>
              </button>
              <div className="flex bg-gray-800 rounded-lg p-1 border border-gray-700">
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
                <button
                  onClick={() => setView('decks')}
                  className={`p-2 rounded-md transition-colors ${view === 'decks' ? 'bg-gray-700 text-white shadow' : 'text-gray-400 hover:text-white'}`}
                  title="My Decks"
                >
                  <Swords size={18} />
                </button>
                <button
                  onClick={() => setView('submit')}
                  className={`p-2 rounded-md transition-colors ${view === 'submit' ? 'bg-gray-700 text-white shadow' : 'text-gray-400 hover:text-white'}`}
                  title="Submit Missing Card"
                >
                  <FileText size={18} />
                </button>
                {isAdmin && (
                  <button
                    onClick={() => setView('admin')}
                    className={`p-2 rounded-md transition-colors ${view === 'admin' ? 'bg-gray-700 text-white shadow' : 'text-gray-400 hover:text-white'}`}
                    title="Admin"
                  >
                    <Shield size={18} />
                  </button>
                )}
              </div>
              <button
                onClick={() => loadSetData(true)}
                disabled={loading}
                className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-full transition-colors hidden md:block border border-gray-700/50"
                title="Force Sync"
              >
                <RefreshCw size={20} className={loading ? "animate-spin" : ""} />
              </button>
              {user && (
                <div className="relative user-menu-container">
                  {/* Mobile User Menu Button */}
                  <button
                    onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                    className="md:hidden flex items-center gap-2 bg-gray-800 px-2 py-2 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors"
                    title="User menu"
                  >
                    <User className="text-gray-400" size={18} />
                  </button>

                  {/* Desktop User Info - Always visible on md+ screens */}
                  <div className="hidden md:flex items-center gap-2 bg-gray-800 px-3 py-1.5 rounded-lg border border-gray-700 text-xs text-gray-200">
                    <div className="flex flex-col leading-tight">
                      <span className="font-semibold">{user.displayName || 'Guest user'}</span>
                      <span className="text-[10px] text-gray-400">{user.email || 'Anonymous session'}</span>
                    </div>
                    <button
                      onClick={handleLogout}
                      className="text-gray-400 hover:text-white text-[11px] font-semibold"
                    >
                      Log out
                    </button>
                  </div>

                  {/* Mobile User Menu Dropdown */}
                  {isUserMenuOpen && (
                    <div className="md:hidden absolute right-0 top-full mt-2 w-64 bg-gray-800 rounded-lg border border-gray-700 shadow-xl z-50 overflow-hidden">
                      <div className="p-4 border-b border-gray-700">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1">
                            <div className="font-semibold text-sm text-white mb-1">{user.displayName || 'Guest user'}</div>
                            <div className="text-xs text-gray-400">{user.email || 'Anonymous session'}</div>
                          </div>
                          <button
                            onClick={() => setIsUserMenuOpen(false)}
                            className="text-gray-400 hover:text-white p-1"
                          >
                            <X size={16} />
                          </button>
                        </div>
                        <div className="flex items-center gap-2 mt-3 text-xs">
                          {authLoading ? (
                            <Loader2 size={12} className="animate-spin text-gray-400" />
                          ) : (
                            <>
                              <Cloud size={12} className={user?.isAnonymous ? 'text-yellow-500' : 'text-green-500'} />
                              <span className="text-gray-300">{user?.isAnonymous ? 'Guest mode' : 'Cloud sync active'}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="p-2">
                        <button
                          onClick={() => {
                            handleLogout();
                            setIsUserMenuOpen(false);
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 rounded-lg transition-colors"
                        >
                          Log out
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Filter Controls */}
          <div className="mt-2">
            {/* Binder-only Row 1: Search + My Collection toggle */}
            {view === 'binder' && (
              <div className="flex gap-2 items-center mb-3">
                <div className="relative flex-1 group">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-yellow-500 transition-colors" size={16} />
                  <input
                    type="text"
                    placeholder="Search cards..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full bg-gray-800/50 border border-gray-700 rounded-full pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-yellow-500/50 focus:ring-1 focus:ring-yellow-500/50 transition-all placeholder:text-gray-600"
                  />
                </div>
                <button
                  onClick={() => {
                    const next = !showMyCollection;
                    setShowMyCollection(next);
                    if (!next && sortBy === 'recent') setSortBy('number');
                  }}
                  className={`shrink-0 px-3 py-2 rounded-full text-xs font-medium border transition-colors ${
                    showMyCollection
                      ? 'bg-yellow-500/20 border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/30'
                      : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white hover:border-gray-500'
                  }`}
                >
                  {showMyCollection ? '★ My Collection' : '☆ All Cards'}
                </button>
              </div>
            )}

            {/* Row 2: Set selector (all views) · Sort · Direction · Type · Aspect (binder only) */}
            <div className="flex items-center gap-2 flex-wrap pb-2">
              {/* Set selector — always visible so dashboard can switch sets */}
              <select
                value={activeSet}
                onChange={(e) => setActiveSet(e.target.value)}
                className="bg-gray-800 border border-gray-700 text-white text-xs rounded-lg px-2 py-2 focus:outline-none focus:border-yellow-500/50 cursor-pointer"
              >
                <option value="ALL">All Sets</option>
                {visibleSets.map(set => (
                  <option key={set.code} value={set.code}>{set.name || set.code}</option>
                ))}
              </select>

              {view === 'binder' && (
                <>
                  {/* Sort option */}
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="bg-gray-800 border border-gray-700 text-white text-xs rounded-lg px-2 py-2 focus:outline-none focus:border-yellow-500/50 cursor-pointer"
                  >
                    <option value="number">Card #</option>
                    <option value="cost">Cost</option>
                    <option
                      value="recent"
                      disabled={!showMyCollection}
                      title={!showMyCollection ? 'Switch to My Collection to sort by recently added' : ''}
                    >
                      Recently Added
                    </option>
                  </select>

                  {/* Sort direction — text-xs + py-2 to match select heights */}
                  <button
                    onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                    title={sortDir === 'asc' ? 'Sort ascending' : 'Sort descending'}
                    className="px-2 py-2 text-xs bg-gray-800 border border-gray-700 text-gray-300 hover:text-white rounded-lg transition-colors"
                  >
                    {sortDir === 'asc' ? '↑' : '↓'}
                  </button>

                  {/* Type filter */}
                  <select
                    value={selectedType}
                    onChange={(e) => setSelectedType(e.target.value)}
                    className="bg-gray-800 border border-gray-700 text-white text-xs rounded-lg px-2 py-2 focus:outline-none focus:border-yellow-500/50 cursor-pointer"
                  >
                    {uniqueTypes.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>

                  {/* Aspect filter */}
                  <div className="flex items-center gap-1 bg-gray-800/50 rounded-full p-1 border border-gray-700">
                    <button
                      onClick={() => setSelectedAspect('All')}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${selectedAspect === 'All' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
                    >
                      All
                    </button>
                    {ASPECTS.map(aspect => (
                      <button
                        key={aspect.name}
                        onClick={() => setSelectedAspect(aspect.name)}
                        className={`p-1.5 rounded-full transition-all ${selectedAspect === aspect.name ? `${aspect.bg} ring-1 ring-inset ${aspect.border} shadow-[0_0_10px_rgba(0,0,0,0.5)]` : `opacity-70 hover:opacity-100 hover:bg-gray-800`}`}
                        title={aspect.name}
                      >
                        <img src={aspect.iconUrl} alt="" className="w-4 h-4" aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {useLegacyPath && legacySyncCode && (
        <div className="max-w-7xl mx-auto px-4 pt-4">
          <div className="bg-yellow-900/30 border border-yellow-600/40 text-yellow-100 rounded-xl p-3 text-sm">
            Using legacy Sync Key storage ({legacySyncCode}). Sign in with Google to import and move to your account.
          </div>
        </div>
      )}

      {migrationMessage && (
        <div className="max-w-7xl mx-auto px-4 pt-4">
          <div className={`${migrationState === 'error' ? 'bg-red-900/30 border-red-600/40 text-red-100' : 'bg-blue-900/30 border-blue-600/40 text-blue-100'} border rounded-xl p-3 text-sm`}>
            {migrationMessage}
          </div>
        </div>
      )}

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
                onUpdateQuantity={handleGridQuantityChange}
                onCardClick={setSelectedCard}
              />
              ) : view === 'decks' ? (
                <DeckManager
                  user={user}
                  collectionData={collectionData}
                  onOpenDeck={(deck) => {
                    setActiveDeck(deck);
                    setView('deckbuilder');
                  }}
                  onCreateDeck={() => {
                    setActiveDeck(null);
                    setView('deckbuilder');
                  }}
                />
              ) : view === 'deckbuilder' ? (
                <DeckBuilder
                  deck={activeDeck}
                  collectionData={collectionData}
                  onClose={() => {
                    setActiveDeck(null);
                    setView('decks');
                  }}
                  onSaved={(savedDeck) => {
                    setActiveDeck(savedDeck);
                  }}
                />
              ) : view === 'submit' ? (
                <CardSubmissionForm
                  onSuccess={(submissionId) => {
                    alert('Card submitted successfully! Submission ID: ' + submissionId);
                    setView('binder');
                  }}
                  onCancel={() => setView('binder')}
                />
              ) : view === 'admin' && isAdmin ? (
                <AdminPanel />
              ) : (
              <>
                {reconstructedData && (
                  <div className="bg-yellow-900/20 border border-yellow-600/50 p-4 rounded-xl mb-4 flex items-center gap-3 text-yellow-200 text-sm">
                    <AlertCircle size={20} />
                    <span>Showing collection-based view. Some card details may be missing until API connection is restored.</span>
                  </div>
                )}

                <div className="mb-4 text-gray-500 text-sm font-medium">
                  Showing {sortedCards.length} cards
                  {activeSet !== 'ALL' && <> from <span className="text-yellow-500">{visibleSets.find(s => s.code === activeSet)?.name || activeSet}</span></>}
                </div>

                {showMyCollection && sortedCards.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <p className="text-gray-400 text-sm mb-4">No cards in your collection for this set — try browsing all cards.</p>
                    <button
                      onClick={() => setShowMyCollection(false)}
                      className="px-4 py-2 bg-yellow-500/20 border border-yellow-500/40 text-yellow-400 rounded-full text-sm hover:bg-yellow-500/30 transition-colors"
                    >
                      Show All Cards
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-6">
                  {sortedCards.map((card) => {
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
                              disabled={!user || !db}
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
                              disabled={!user || !db}
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

                {sortedCards.length === 0 && (
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
          onClose={() => setSelectedCard(null)}
        />
      )}

      {/* Advanced Search - Full page view */}
      {isSearchOpen && (
        <AdvancedSearch
          onCardClick={(card) => {
            setSelectedCard(card);
            // Don't close search - let modal overlay on top of results
          }}
          collectionData={collectionData}
          currentSet={activeSet}
          onClose={() => setIsSearchOpen(false)}
          onUpdateQuantity={handleGridQuantityChange}
        />
      )}

      {/* PWA Components */}
      <PWAUpdatePrompt />
      <InstallPrompt />

      {/* Version Footer */}
      <footer className="text-center py-4 text-xs text-gray-500">
        <div>v{VERSION}</div>
        <div className="text-gray-600">{BUILD_TIME}</div>
      </footer>
    </div>
  );
}
