import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Search, RefreshCw, Shield, Sword, Zap, Crown, Star, Skull, X, 
  Layers, Box, Info, Image as ImageIcon, AlertCircle, Loader2, 
  Sparkles, Plus, Minus, CheckCircle2, Cloud, Upload, Download, 
  LayoutGrid, BarChart3, ChevronUp, ChevronDown, Database, Trophy, Key, Save, ArrowRight, Orbit, WifiOff 
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, onAuthStateChanged, signInWithCustomToken, signInAnonymously 
} from 'firebase/auth';
import { 
  getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot, writeBatch 
} from 'firebase/firestore';

// --- Configuration ---

const API_BASE = 'https://api.swu-db.com';
const SETS = [
  { code: 'SOR', name: 'Spark of Rebellion' },
  { code: 'SHD', name: 'Shadows of the Galaxy' },
  { code: 'TWI', name: 'Twilight of the Republic' },
  { code: 'JTL', name: 'Jump to Lightspeed' },
  { code: 'LOF', name: 'Legends of the Force' },
  { code: 'SEC', name: 'Secrets of Power' },
  { code: 'ALT', name: 'A Lawless Time' },
];

const ASPECTS = [
  { name: 'Aggression', icon: Sword, color: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500/30' },
  { name: 'Vigilance', icon: Shield, color: 'text-blue-500', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
  { name: 'Command', icon: Crown, color: 'text-green-500', bg: 'bg-green-500/10', border: 'border-green-500/30' },
  { name: 'Cunning', icon: Zap, color: 'text-yellow-500', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30' },
  { name: 'Heroism', icon: Star, color: 'text-white', bg: 'bg-white/10', border: 'border-white/30' },
  { name: 'Villainy', icon: Skull, color: 'text-zinc-950', bg: 'bg-zinc-200', border: 'border-zinc-400' },
];

const FALLBACK_DATA = [
  { Number: "001", Name: "Director Krennic", Subtitle: "Aspiring to Authority", Type: "Leader", Aspects: ["Villainy", "Vigilance"], Cost: null, Rarity: "Rare" },
  { Number: "002", Name: "Iden Versio", Subtitle: "Inferno Squad Commander", Type: "Leader", Aspects: ["Villainy", "Vigilance"], Cost: null, Rarity: "Common" },
  { Number: "003", Name: "Chewbacca", Subtitle: "Walking Carpet", Type: "Unit", Aspects: ["Heroism", "Vigilance"], Cost: 9, Power: 6, HP: 9, Rarity: "Uncommon" },
];

// --- Safe Firebase Initialization ---
let auth = null;
let db = null;
let appId = 'default-app-id';
let firebaseError = null;

try {
  if (typeof __firebase_config !== 'undefined') {
    const firebaseConfig = JSON.parse(__firebase_config);
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
  } else {
    console.warn("Firebase config missing. Offline mode.");
    firebaseError = "Cloud config missing";
  }
} catch (e) {
  console.error("Firebase init failed:", e);
  firebaseError = e.message;
}

// --- Data Services & Helpers ---

const getCollectionId = (set, number, isFoil) => `${set}_${number}_${isFoil ? 'foil' : 'std'}`;

const getCardImage = (set, number) => `${API_BASE}/cards/${set}/${number}?format=image`;

const getBackImage = (set, number) => `${API_BASE}/cards/${set}/${number}?format=image&face=back`;

const isHorizontalCard = (type) => type === 'Leader' || type === 'Base';

const getCollectionRef = (user, syncCode) => {
  if (!db || !appId) return null;
  // CRITICAL: We need user to be authenticated for ANY operation
  if (!user) return null;
  
  if (syncCode) {
    // Persistent Public Path: /artifacts/{appId}/public/data/sync_{syncCode}
    return collection(db, 'artifacts', appId, 'public', 'data', `sync_${syncCode}`);
  } else {
    // Temporary Private Path: /artifacts/{appId}/users/{userId}/collection
    return collection(db, 'artifacts', appId, 'users', user.uid, 'collection');
  }
};

const fetchWithTimeout = async (url, options = {}, timeout = 35000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    if (error.name === 'AbortError') throw new Error(`Request timed out after ${timeout}ms`);
    throw error;
  }
};

// --- Components ---

const AspectIcon = ({ aspect }) => {
  const config = ASPECTS.find(a => a.name === aspect) || { icon: Info, color: 'text-gray-400', bg: 'bg-gray-800' };
  const Icon = config.icon;
  return (
    <div title={aspect} className={`p-1 rounded-full ${config.bg} ${config.color} border ${config.border || 'border-transparent'}`}>
      <Icon size={14} />
    </div>
  );
};

const LandingScreen = ({ onStart }) => {
  const [code, setCode] = useState('');
  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-900/20 via-gray-900 to-gray-950 z-0"></div>
      <div className="relative z-10 w-full max-w-md bg-gray-900/80 backdrop-blur-xl border border-gray-700 rounded-2xl p-8 shadow-2xl flex flex-col items-center">
        <div className="w-16 h-16 bg-yellow-500 rounded-2xl flex items-center justify-center shadow-lg shadow-yellow-500/20 mb-6 transform rotate-3"><Layers className="text-black" size={32} /></div>
        <h1 className="text-3xl font-bold text-white mb-2 text-center tracking-tight">SWU Holocron</h1>
        <p className="text-gray-400 text-center mb-8 text-sm">Access the shared archive. Manage your collection.</p>
        <div className="w-full space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 ml-1">Sync Key (Optional)</label>
            <div className="relative">
              <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
              <input type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. jedi-master-42" className="w-full bg-gray-950 border border-gray-700 rounded-xl py-3 pl-10 pr-4 text-white placeholder:text-gray-600 focus:outline-none focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500 transition-all" />
            </div>
          </div>
          <button onClick={() => onStart(code.trim() || null)} className="w-full bg-gradient-to-r from-yellow-500 to-yellow-400 hover:from-yellow-400 hover:to-yellow-300 text-black font-bold py-3.5 rounded-xl shadow-lg transition-all transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2">
            {code ? 'Load Collection' : 'Enter as Guest'} <ArrowRight size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};

const Dashboard = ({ setCode, cards, collectionData, onImport, onExport, isImporting, hasDataToExport, onUpdateQuantity, onCardClick, syncCode }) => {
  const stats = useMemo(() => {
    if (!cards || !Array.isArray(cards) || cards.length === 0) return null;
    const totalCards = cards.length;
    let ownedUnique = 0;
    let ownedTotal = 0;
    let missingList = [];
    const uniqueMap = new Map();

    cards.forEach(card => {
      const key = `${card.Name}${card.Subtitle ? ` ${card.Subtitle}` : ''}`;
      if (!uniqueMap.has(key)) uniqueMap.set(key, { representative: card, totalOwned: 0 });
      const stdKey = getCollectionId(setCode, card.Number, false);
      const foilKey = getCollectionId(setCode, card.Number, true);
      const qty = (collectionData[stdKey]?.quantity || 0) + (collectionData[foilKey]?.quantity || 0);
      const entry = uniqueMap.get(key);
      entry.totalOwned += qty;
      ownedTotal += qty;
    });

    const uniqueEntries = Array.from(uniqueMap.values());
    const totalUniqueCards = uniqueEntries.length;
    let ownedUniqueCount = 0;
    let playsetsCount = 0;

    uniqueEntries.forEach(entry => {
      if (entry.totalOwned > 0) ownedUniqueCount++;
      else missingList.push(entry.representative);
      const required = (entry.representative.Type === 'Leader' || entry.representative.Type === 'Base') ? 1 : 3;
      if (entry.totalOwned >= required) playsetsCount++;
    });

    missingList.sort((a, b) => a.Number.localeCompare(b.Number, undefined, { numeric: true }));
    const percentComplete = totalUniqueCards > 0 ? Math.round((ownedUniqueCount / totalUniqueCards) * 100) : 0;
    return { totalUniqueCards, ownedUniqueCount, playsetsCount, percentComplete, missingList, ownedTotal };
  }, [cards, collectionData, setCode]);

  const globalSummary = useMemo(() => {
    const summary = {};
    Object.values(collectionData).forEach(item => {
      if (item.set) {
        if (!summary[item.set]) summary[item.set] = 0;
        summary[item.set] += item.quantity;
      }
    });
    return summary;
  }, [collectionData]);

  if (!stats) return <div className="p-10 text-center text-gray-500">Loading set data...</div>;

  const handleExportMissing = () => {
    if (!stats.missingList.length) { alert("No missing cards!"); return; }
    const headers = ["Set,Number,Name,Subtitle,Rarity,Type"];
    const rows = stats.missingList.map(card => {
      const safeName = `"${card.Name.replace(/"/g, '""')}"`;
      const safeSubtitle = card.Subtitle ? `"${card.Subtitle.replace(/"/g, '""')}"` : "";
      return `${setCode},${card.Number},${safeName},${safeSubtitle},${card.Rarity},${card.Type}`;
    });
    const blob = new Blob([[headers, ...rows].join("\n")], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `swu_missing_${setCode}.csv`;
    link.click();
  };

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-gray-800 pb-6">
        <div>
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                <Database size={24} className="text-yellow-500" />
                Command Center
            </h2>
            <div className="flex items-center gap-2 mt-1">
               <p className="text-gray-500 text-sm">Manage your collection</p>
               {syncCode && (
                 <span className="bg-gray-800 text-yellow-500 text-xs px-2 py-0.5 rounded border border-gray-700 font-mono flex items-center gap-1">
                   <Key size={10} /> {syncCode}
                 </span>
               )}
            </div>
        </div>
        <div className="flex gap-3 w-full sm:w-auto">
            <button onClick={onImport} disabled={isImporting} className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg border border-gray-700 transition-colors disabled:opacity-50">{isImporting ? <Loader2 size={18} className="animate-spin text-yellow-500" /> : <Upload size={18} />}<span>Import CSV</span></button>
            <button onClick={onExport} disabled={!hasDataToExport} className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg border border-gray-700 transition-colors disabled:opacity-50"><Download size={18} /><span>Export CSV</span></button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700 shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10"><Layers size={100} className="text-yellow-500" /></div>
          <h3 className="text-gray-400 font-bold uppercase text-xs tracking-widest mb-1">Unique Cards</h3>
          <div className="text-3xl font-bold text-white mb-4">{stats.ownedUniqueCount} <span className="text-gray-500 text-lg">/ {stats.totalUniqueCards}</span></div>
          <div className="relative w-full h-4 bg-gray-700 rounded-full overflow-hidden"><div className="absolute top-0 left-0 h-full bg-gradient-to-r from-yellow-600 to-yellow-400" style={{ width: `${stats.percentComplete}%` }}></div></div>
          <div className="mt-2 text-right text-yellow-500 font-bold">{stats.percentComplete}% Complete</div>
        </div>
        <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700 shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10"><Trophy size={100} className="text-blue-500" /></div>
          <h3 className="text-gray-400 font-bold uppercase text-xs tracking-widest mb-1">Playable Sets</h3>
          <div className="text-4xl font-bold text-white mb-2">{stats.playsetsCount}</div>
          <p className="text-gray-500 text-sm">3x Units, 1x Leaders</p>
        </div>
        <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700 shadow-xl overflow-y-auto max-h-48 scrollbar-thin scrollbar-thumb-gray-600">
          <h3 className="text-gray-400 font-bold uppercase text-xs tracking-widest mb-3">Total Volume</h3>
          <div className="space-y-2">{SETS.map(s => (<div key={s.code} className="flex justify-between items-center text-sm"><span className={s.code === setCode ? "text-yellow-500 font-bold" : "text-gray-300"}>{s.name}</span><span className="bg-gray-700 px-2 py-0.5 rounded-full text-xs text-gray-100">{globalSummary[s.code] || 0}</span></div>))}</div>
        </div>
      </div>
      <div className="bg-gray-900 rounded-2xl border border-gray-800 shadow-xl overflow-hidden">
        <div className="p-6 border-b border-gray-800 flex justify-between items-center bg-gray-800/50">
          <div><h2 className="text-xl font-bold text-white flex items-center gap-2"><AlertCircle size={20} className="text-red-400" /> Missing Unique Titles</h2><p className="text-gray-500 text-sm mt-1">Cards you don't own any version of.</p></div>
          {stats.missingList.length > 0 && (<button onClick={handleExportMissing} className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-bold rounded-lg border border-gray-700 transition-colors"><Download size={14} />Export List</button>)}
        </div>
        {stats.missingList.length > 0 ? (
          <div className="max-h-[500px] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-700">
            <table className="w-full text-left border-collapse">
              <thead className="bg-gray-800 text-gray-400 text-xs uppercase tracking-wider sticky top-0 z-10">
                <tr><th className="p-3 w-10"></th><th className="p-3 font-semibold">#</th><th className="p-3 font-semibold">Name</th><th className="p-3 font-semibold">Rarity</th><th className="p-3 font-semibold">Type</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-800 text-sm text-gray-300">
                {stats.missingList.map(card => (
                  <tr key={card.Number} className="hover:bg-gray-800/50 transition-colors">
                    <td className="p-3"><button onClick={() => onUpdateQuantity(card, 1)} className="w-8 h-8 bg-green-600 hover:bg-green-500 text-white rounded-full flex items-center justify-center transition-all transform active:scale-95 shadow-md shadow-green-900/20" title="Add"><Plus size={16} /></button></td>
                    <td className="p-3 font-mono text-gray-500 text-xs sm:text-sm">{card.Number}</td>
                    <td className="p-3 font-medium text-white cursor-pointer hover:text-yellow-400 transition-colors" onClick={() => onCardClick(card)}>{card.Name} {card.Subtitle && <span className="text-gray-500 text-xs italic block sm:inline sm:ml-2">{card.Subtitle}</span>}</td>
                    <td className="p-3"><span className={`px-2 py-1 rounded text-[10px] uppercase font-bold border ${card.Rarity === 'Common' ? 'border-gray-600 text-gray-400' : card.Rarity === 'Uncommon' ? 'border-gray-500 text-gray-300' : card.Rarity === 'Rare' ? 'border-yellow-600 text-yellow-500' : 'border-red-600 text-red-500'}`}>{card.Rarity}</span></td>
                    <td className="p-3 text-gray-400 text-xs sm:text-sm">{card.Type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (<div className="p-12 text-center flex flex-col items-center justify-center text-green-500"><CheckCircle2 size={48} className="mb-4" /><h3 className="text-xl font-bold">Set Complete!</h3></div>)}
      </div>
    </div>
  );
};

const CardModal = ({ initialCard, allCards, setCode, user, collectionData, syncCode, onClose }) => {
  const [currentCard, setCurrentCard] = useState(initialCard);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isFoil, setIsFoil] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);

  const collectionKey = getCollectionId(setCode, currentCard.Number, isFoil);
  const ownedCount = collectionData[collectionKey]?.quantity || 0;

  const variants = useMemo(() => {
    if (!allCards || !initialCard) return [];
    return allCards
      .filter(c => c.Name === initialCard.Name && c.Subtitle === initialCard.Subtitle)
      .sort((a, b) => a.Number.localeCompare(b.Number, undefined, { numeric: true }));
  }, [allCards, initialCard]);

  useEffect(() => { setCurrentCard(initialCard); setIsFlipped(false); setIsFoil(false); }, [initialCard]);

  const hasBack = currentCard.Type === 'Leader';
  const imageUrl = isFlipped && hasBack ? getBackImage(setCode, currentCard.Number) : getCardImage(setCode, currentCard.Number);

  useEffect(() => { setImageLoading(true); setImageError(false); }, [imageUrl]);

  const handleQuantityChange = async (delta) => {
    if (!db || (!user && !syncCode)) return;
    const newQuantity = ownedCount + delta;
    try {
      const collectionRef = getCollectionRef(user, syncCode);
      if(!collectionRef) return;
      const docRef = doc(collectionRef, collectionKey);
      if (newQuantity > 0) {
        await setDoc(docRef, {
          quantity: newQuantity, set: setCode, number: currentCard.Number, name: currentCard.Name, isFoil: isFoil, timestamp: Date.now()
        }, { merge: true });
      } else {
        await deleteDoc(docRef);
      }
    } catch (e) { console.error("Error updating collection:", e); }
  };

  const getVariantLabel = (v) => v.Number === variants[0].Number ? "Base Art" : (v.Rarity === 'S' || v.Rarity === 'Special' ? "Showcase" : `Variant ${v.Number}`);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-7xl bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col md:flex-row h-[90vh] md:h-[85vh]">
        <button onClick={onClose} className="absolute top-4 right-4 z-10 p-2 bg-black/50 hover:bg-red-500/80 rounded-full text-white transition-colors border border-white/10"><X size={24} /></button>
        <div className="w-full md:w-3/5 bg-black/50 flex flex-col items-center justify-center p-4 md:p-8 relative overflow-hidden">
          <div className="relative flex items-center justify-center w-full h-full transition-all duration-300 perspective-1000">
             {!imageError ? (
               <div className="relative max-h-full max-w-full group">
                 {imageLoading && (<div className="absolute inset-0 flex items-center justify-center z-10"><Loader2 size={48} className="text-yellow-500 animate-spin" /></div>)}
                 {isFoil && !imageLoading && (<div className="absolute inset-0 z-20 pointer-events-none rounded-lg mix-blend-color-dodge opacity-40 bg-[linear-gradient(115deg,transparent_20%,#fff_30%,transparent_40%,transparent_60%,#fff_70%,transparent_80%)] bg-[length:200%_200%] animate-shimmer"></div>)}
                 {isFoil && !imageLoading && (<div className="absolute inset-0 z-20 pointer-events-none rounded-lg mix-blend-overlay opacity-30 bg-[linear-gradient(to_bottom,transparent,#000_100%)]"></div>)}
                 <img key={imageUrl} src={imageUrl} alt={currentCard.Name} className={`max-h-[65vh] md:max-h-[70vh] max-w-full object-contain drop-shadow-2xl rounded-lg transition-opacity duration-300 ${imageLoading ? 'opacity-0' : 'opacity-100'}`} onLoad={() => setImageLoading(false)} onError={() => { setImageLoading(false); setImageError(true); }} />
               </div>
             ) : (<div className="flex flex-col items-center justify-center text-gray-500"><ImageIcon size={64} className="mb-4 opacity-50" /><p>Image not available</p></div>)}
          </div>
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 pointer-events-auto">
            <div className="flex items-center gap-3 bg-gray-900/90 backdrop-blur-md px-4 py-2 rounded-full border border-gray-600 shadow-xl">
              <span className="text-gray-400 text-[10px] font-bold uppercase tracking-widest">Owned</span>
              <button onClick={() => handleQuantityChange(-1)} className="w-6 h-6 rounded-full bg-gray-800 hover:bg-red-500/20 hover:text-red-500 flex items-center justify-center transition-colors border border-gray-700"><Minus size={12} /></button>
              <span className={`text-base font-bold w-6 text-center ${ownedCount > 0 ? 'text-white' : 'text-gray-500'}`}>{ownedCount}</span>
              <button onClick={() => handleQuantityChange(1)} className="w-6 h-6 rounded-full bg-yellow-500 hover:bg-yellow-400 text-black flex items-center justify-center transition-colors shadow-sm"><Plus size={12} /></button>
            </div>
          </div>
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3 z-30 w-full max-w-2xl px-4 pointer-events-auto">
            <div className="flex flex-wrap justify-center gap-2">
               {hasBack && (<button onClick={() => setIsFlipped(!isFlipped)} className="flex items-center gap-2 bg-gray-800/80 hover:bg-blue-600 text-white px-4 py-2 rounded-full backdrop-blur-md transition-all shadow-lg text-xs font-semibold border border-gray-700"><RefreshCw size={14} className={isFlipped ? "rotate-180 transition-transform" : ""} />{isFlipped ? 'Show Front' : 'Flip'}</button>)}
              <button onClick={() => setIsFoil(!isFoil)} className={`flex items-center gap-2 px-4 py-2 rounded-full backdrop-blur-md transition-all shadow-lg text-xs font-semibold border border-gray-700 ${isFoil ? 'bg-gradient-to-r from-yellow-600 to-yellow-400 text-black border-yellow-400 shadow-[0_0_15px_rgba(234,179,8,0.4)]' : 'bg-gray-800/80 text-white hover:bg-gray-700'}`}><Sparkles size={14} className={isFoil ? "fill-black" : ""} />Foil</button>
            </div>
            {variants.length > 1 && (
              <div className="flex bg-gray-800/90 rounded-full p-1 border border-gray-700 backdrop-blur-md shadow-lg overflow-x-auto max-w-full no-scrollbar">
                {variants.map(v => (<button key={v.Number} onClick={() => setCurrentCard(v)} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap flex items-center gap-2 ${currentCard.Number === v.Number ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}><span>{getVariantLabel(v)}</span></button>))}
              </div>
            )}
          </div>
        </div>
        <div className="w-full md:w-2/5 p-6 md:p-8 overflow-y-auto bg-gray-900 text-gray-100 border-l border-gray-800 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
          <div className="flex items-start justify-between mb-4">
            <div><h2 className="text-3xl font-bold text-white font-serif tracking-wide">{currentCard.Name}</h2>{currentCard.Subtitle && <h3 className="text-xl text-yellow-500 italic">{currentCard.Subtitle}</h3>}</div>
            {currentCard.Cost !== null && currentCard.Cost !== undefined && (<div className="bg-blue-600 text-white w-12 h-12 flex items-center justify-center rounded-full text-2xl font-bold shadow-lg border-2 border-blue-400">{currentCard.Cost}</div>)}
          </div>
          <div className="flex flex-wrap gap-2 mb-6">
            <span className="px-3 py-1 bg-gray-800 rounded-full text-xs uppercase tracking-wider text-gray-400 border border-gray-700">{currentCard.Type}</span>
             {currentCard.Aspects && currentCard.Aspects.map(aspect => (<div key={aspect} className="flex items-center gap-1 px-3 py-1 bg-gray-800 rounded-full border border-gray-700"><AspectIcon aspect={aspect} /><span className="text-sm">{aspect}</span></div>))}
          </div>
          <div className="space-y-6">
            {(currentCard.Power !== undefined || currentCard.HP !== undefined) && (
              <div className="grid grid-cols-2 gap-4">
                {currentCard.Power !== undefined && (<div className="bg-red-900/20 p-4 rounded-xl border border-red-500/30 flex items-center justify-between"><span className="text-red-400 font-bold uppercase text-sm">Power</span><span className="text-3xl font-bold text-red-100">{currentCard.Power}</span></div>)}
                {currentCard.HP !== undefined && (<div className="bg-blue-900/20 p-4 rounded-xl border border-blue-500/30 flex items-center justify-between"><span className="text-blue-400 font-bold uppercase text-sm">HP</span><span className="text-3xl font-bold text-blue-100">{currentCard.HP}</span></div>)}
              </div>
            )}
            <div className="bg-gray-800/50 p-6 rounded-xl border border-gray-700/50">
              <h4 className="text-gray-400 text-sm uppercase tracking-wider mb-3 font-semibold">{isFlipped && hasBack ? "Unit Side Abilities" : "Abilities"}</h4>
              <p className="text-gray-200 leading-relaxed text-lg whitespace-pre-wrap font-serif">{(isFlipped && hasBack && currentCard.BackText) ? currentCard.BackText : (currentCard.FrontText || "No ability text.")}</p>
              {!isFlipped && currentCard.EpicAction && (<div className="mt-4 pt-4 border-t border-gray-700"><span className="text-yellow-500 font-bold">Epic Action: </span><span className="text-gray-300">{currentCard.EpicAction}</span></div>)}
            </div>
             <div className="grid grid-cols-2 gap-4 text-sm text-gray-500 pt-4 border-t border-gray-800 mt-6">
                <div>Set: <span className="text-gray-300">{setCode}</span></div>
                <div>Number: <span className="text-gray-300">{currentCard.Number}</span></div>
                <div>Artist: <span className="text-gray-300">{currentCard.Artist || 'Unknown'}</span></div>
                <div>Rarity: <span className="text-gray-300">{currentCard.Rarity || 'Unknown'}</span></div>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const [activeSet, setActiveSet] = useState(SETS[0].code);
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [error, setError] = useState(null);
  
  const [user, setUser] = useState(null);
  const [collectionData, setCollectionData] = useState({});
  const [authLoading, setAuthLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [view, setView] = useState('binder');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedAspect, setSelectedAspect] = useState('All');
  const [selectedType, setSelectedType] = useState('All');
  const [selectedCard, setSelectedCard] = useState(null);
  const [isHeaderExpanded, setIsHeaderExpanded] = useState(true);
  
  const [syncCode, setSyncCode] = useState(() => localStorage.getItem('swu-sync-code') || '');
  const [isGuestMode, setIsGuestMode] = useState(false);
  const [reconstructedData, setReconstructedData] = useState(false);
  const [hasVisited, setHasVisited] = useState(() => localStorage.getItem('swu-has-visited') === 'true');

  const fileInputRef = useRef(null);
  const collectionDataRef = useRef(collectionData);

  useEffect(() => {
    if (syncCode) localStorage.setItem('swu-sync-code', syncCode);
    else localStorage.removeItem('swu-sync-code');
  }, [syncCode]);

  useEffect(() => {
    if (!auth) { setAuthLoading(false); return; }
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (e) { console.error("Auth init failed:", e); setAuthLoading(false); }
    };
    initAuth();
    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => { setUser(currentUser); setAuthLoading(false); });
    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (!db || (!user && !syncCode)) {
      setCollectionData({});
      return;
    }
    const collectionRef = getCollectionRef(user, syncCode);
    if (!collectionRef) return;
    const unsubscribeSnapshot = onSnapshot(collectionRef, (snapshot) => {
        const data = {};
        snapshot.forEach(doc => { data[doc.id] = doc.data(); });
        setCollectionData(data);
      }, (error) => { console.error("Error fetching collection:", error); }
    );
    return () => unsubscribeSnapshot();
  }, [user, syncCode]);

  useEffect(() => {
      collectionDataRef.current = collectionData;
  }, [collectionData]);
  
  useEffect(() => {
    if ((error || cards === FALLBACK_DATA) && Object.keys(collectionData).length > 0 && !loading) {
       fetchSetData(true);
    }
  }, [collectionData]);

  const fetchSetData = async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    setReconstructedData(false);
    const cacheKey = `swu-cards-${activeSet}`;
    const timeKey = `swu-sync-${activeSet}`;

    try {
      const cachedData = localStorage.getItem(cacheKey);
      const cachedTime = localStorage.getItem(timeKey);
      const isStale = !cachedTime || (Date.now() - parseInt(cachedTime) > 24 * 60 * 60 * 1000);

      if (!forceRefresh && cachedData && !isStale) {
        try {
          const parsedData = JSON.parse(cachedData);
          let cardList = Array.isArray(parsedData) ? parsedData : (parsedData.data || []);
          if(cardList.length > 0) {
            console.log(`Loading ${activeSet} from cache...`);
            cardList.sort((a, b) => a.Number.localeCompare(b.Number, undefined, { numeric: true, sensitivity: 'base' }));
            setCards(cardList);
            setLastSync(new Date(parseInt(cachedTime)).toLocaleString());
            setLoading(false);
            return;
          }
        } catch (e) { console.warn("Cache corrupted, re-fetching."); }
      }

      console.log(`Fetching ${activeSet} from API (Seeding Cloud)...`);
      const targetUrl = `${API_BASE}/cards/${activeSet}`;
      
      const fetchStrategies = [
        async () => {
          const res = await fetchWithTimeout(`https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}&t=${Date.now()}`, {}, 35000);
          if (!res.ok) throw new Error(`AllOrigins status: ${res.status}`);
          const data = await res.json();
          if (!data.contents) throw new Error('AllOrigins empty response');
          return JSON.parse(data.contents);
        },
        async () => {
           const res = await fetchWithTimeout(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`, {}, 35000);
           if (!res.ok) throw new Error(`CodeTabs status: ${res.status}`);
           return res.json();
        },
        async () => {
          const res = await fetchWithTimeout(`https://corsproxy.io/?${encodeURIComponent(targetUrl)}`, {}, 30000);
          if (!res.ok) throw new Error(`CorsProxy status: ${res.status}`);
          return res.json();
        },
        async () => {
          const res = await fetchWithTimeout(targetUrl, {}, 8000);
          if (!res.ok) throw new Error(`Direct fetch status: ${res.status}`);
          return res.json();
        }
      ];

      let data = null;
      let lastError = null;

      for (const strategy of fetchStrategies) {
        try {
          data = await strategy();
          if (data) break;
        } catch (e) {
          console.warn("Fetch strategy failed, trying next...", e);
          lastError = e;
        }
      }

      if (!data) throw lastError || new Error("Unable to connect. All proxies failed.");

      let cardList = Array.isArray(data) ? data : (data.data || []);
      if (!Array.isArray(cardList)) throw new Error("Invalid data format received from API");

      cardList.sort((a, b) => a.Number.localeCompare(b.Number, undefined, { numeric: true, sensitivity: 'base' }));
      setCards(cardList);
      setLastSync(new Date().toLocaleString());
      localStorage.setItem(cacheKey, JSON.stringify(cardList)); 
      localStorage.setItem(timeKey, Date.now().toString());

      if (db && cardList.length > 0) {
        // Only seed to user's collection space if needed, not public set data
      }

    } catch (err) {
      console.error("Fetch failed:", err);
      const currentCollection = collectionDataRef.current;
      const relevantKeys = Object.keys(currentCollection).filter(k => k.startsWith(`${activeSet}_`));
      
      if (relevantKeys.length > 0) {
          console.log("Reconstructing view from Collection Data...");
          const reconstructedCards = relevantKeys.map(key => {
             const item = currentCollection[key];
             return {
                 Number: item.number,
                 Name: item.name || `Card #${item.number}`, 
                 Set: item.set,
                 Type: "Unknown",
                 Rarity: "Unknown",
                 Cost: "?",
                 Aspects: []
             };
          });
          const uniqueReconstructed = [];
          const seenNumbers = new Set();
          reconstructedCards.forEach(c => {
              if(!seenNumbers.has(c.Number)){ seenNumbers.add(c.Number); uniqueReconstructed.push(c); }
          });
          uniqueReconstructed.sort((a, b) => a.Number.localeCompare(b.Number, undefined, { numeric: true, sensitivity: 'base' }));
          setCards(uniqueReconstructed);
          setReconstructedData(true);
          setError(`Network unreachable. Displaying collection-only view (${uniqueReconstructed.length} cards).`);
      } else {
        console.warn("Using Fallback Data due to critical failure");
        setCards(FALLBACK_DATA);
        setError(`System Critical: Network Unreachable. Showing minimal offline backup.`);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (syncCode || isGuestMode) {
      fetchSetData();
    }
  }, [activeSet, syncCode, isGuestMode]);

  const handleStartApp = (code) => {
    if (code) setSyncCode(code);
    else setIsGuestMode(true);
    localStorage.setItem('swu-has-visited', 'true');
    setHasVisited(true);
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file || !db) return;
    if (!user) { alert("Please wait for cloud connection..."); return; }

    setImporting(true);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/);
      const headers = lines[0].toLowerCase().split(',').map(h => h.trim());
      const setIdx = headers.findIndex(h => h.includes('set'));
      const numIdx = headers.findIndex(h => h.includes('cardnumber') || h.includes('number'));
      const qtyIdx = headers.findIndex(h => h.includes('count') || h.includes('quantity'));
      const nameIdx = headers.findIndex(h => h.includes('cardname') || h.includes('name'));
      const foilIdx = headers.findIndex(h => h.includes('isfoil') || h.includes('foil'));

      if (setIdx === -1 || numIdx === -1 || qtyIdx === -1) throw new Error("CSV must have 'Set', 'CardNumber' (or Number), and 'Count' (or Quantity) columns");

      let batch = writeBatch(db);
      let opCount = 0;
      const collectionRef = getCollectionRef(user, syncCode);
      if (!collectionRef) throw new Error("Storage unavailable");

      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const row = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.trim().replace(/^"|"$/g, ''));
        const setCode = row[setIdx]?.toUpperCase();
        const number = row[numIdx];
        const qty = parseInt(row[qtyIdx] || '0');
        const name = nameIdx > -1 ? row[nameIdx] : '';
        const isFoilStr = foilIdx > -1 ? (row[foilIdx] || '').toLowerCase() : 'false';
        const isFoil = ['true', 'yes', '1', 'y'].includes(isFoilStr);

        if (setCode && number && qty >= 0) {
           const collectionKey = getCollectionId(setCode, number, isFoil);
           const docRef = doc(collectionRef, collectionKey); 
           if (qty > 0) {
              batch.set(docRef, { quantity: qty, set: setCode, number: number, name: name, isFoil: isFoil, timestamp: Date.now() }, { merge: true });
           } else {
              batch.delete(docRef);
           }
           opCount++;
           if (opCount >= 400) { await batch.commit(); batch = writeBatch(db); opCount = 0; }
        }
      }
      if (opCount > 0) await batch.commit();
      setError(null);
      alert("Import Successful!");
      
      if(error || cards === FALLBACK_DATA) {
        setTimeout(() => fetchSetData(true), 1000);
      }
    } catch (err) {
      console.error(err);
      setError(`Import failed: ${err.message}`);
    } finally {
      setImporting(false);
      event.target.value = '';
    }
  };

  const handleExport = () => {
    if (!Object.keys(collectionData).length) { alert("No collection data to export."); return; }
    const headers = ["Set, Number, Quantity, Foil"];
    const rows = Object.values(collectionData).map(item => `${item.set}, ${item.number}, ${item.quantity}, ${item.isFoil}`);
    const csvContent = [headers, ...rows].join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "swu_collection_backup.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredCards = useMemo(() => {
    if (!Array.isArray(cards)) return [];
    return cards.filter(card => {
      if (!card) return false;
      const matchesSearch = card.Name?.toLowerCase().includes(searchTerm.toLowerCase()) || (card.Traits && card.Traits.some(t => t.toLowerCase().includes(searchTerm.toLowerCase())));
      const matchesAspect = selectedAspect === 'All' || (card.Aspects && card.Aspects.includes(selectedAspect));
      const matchesType = selectedType === 'All' || card.Type === selectedType;
      return matchesSearch && matchesAspect && matchesType;
    });
  }, [cards, searchTerm, selectedAspect, selectedType]);

  const uniqueTypes = useMemo(() => {
     if(!Array.isArray(cards)) return ['All'];
     const types = new Set(cards.map(c => c?.Type).filter(Boolean));
     return ['All', ...types].sort();
  }, [cards]);

  const handleGridQuantityChange = async (card, delta) => {
    if (!db || (!user && !syncCode)) return;
    const collectionKey = getCollectionId(activeSet, card.Number, false);
    const currentQty = collectionData[collectionKey]?.quantity || 0;
    const newQuantity = currentQty + delta;
    try {
      const collectionRef = getCollectionRef(user, syncCode);
      if(!collectionRef) return;
      const docRef = doc(collectionRef, collectionKey);

      if (newQuantity > 0) {
        await setDoc(docRef, { quantity: newQuantity, set: activeSet, number: card.Number, name: card.Name, isFoil: false, timestamp: Date.now() }, { merge: true });
      } else {
        await deleteDoc(docRef);
      }
    } catch (e) { console.error("Error updating collection:", e); }
  };

  if (!hasVisited && !syncCode) {
    return <LandingScreen onStart={handleStartApp} />;
  }

  if (firebaseError && !cards.length && (syncCode || isGuestMode)) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center p-6 text-center">
        <WifiOff size={64} className="text-red-500 mb-4" />
        <h1 className="text-2xl font-bold mb-2">Holocron Offline</h1>
        <p className="text-gray-400 max-w-md mb-6">{firebaseError}. We also couldn't load any card data. Please check your configuration.</p>
        <button onClick={() => window.location.reload()} className="px-6 py-3 bg-yellow-500 text-black font-bold rounded-full hover:bg-yellow-400">Retry Connection</button>
      </div>
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
          
          {/* Top Bar: Title & Persistent Actions */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 flex-1">
              <div className="w-8 h-8 bg-yellow-500 rounded-lg flex items-center justify-center shadow-lg shadow-yellow-500/20"><Layers className="text-black" size={20} /></div>
              <div>
                <h1 className="text-lg font-bold tracking-tight text-white leading-tight">SWU Holocron</h1>
                <div className="flex items-center gap-2 text-[10px] text-gray-500">
                   {loading ? (<span className="flex items-center gap-1 text-yellow-500"><RefreshCw size={8} className="animate-spin"/> Syncing...</span>) : (<span className="flex items-center gap-1">DB: {lastSync || 'Never'}</span>)}
                   <div className="flex items-center gap-1 pl-2 border-l border-gray-700">
                      {authLoading ? (<Loader2 size={8} className="animate-spin text-gray-400" />) : (<>{syncCode ? <Cloud size={8} className="text-yellow-500" /> : (user ? <Cloud size={8} className="text-green-500" /> : <WifiOff size={8} className="text-red-500" />)}<span>{syncCode ? "Sync Active" : (user ? "Cloud" : "Offline")}</span></>)}
                   </div>
                </div>
              </div>
            </div>
            
            {/* Persistent Controls (View & Actions) */}
            <div className="flex items-center gap-2">
                <div className="flex bg-gray-800 rounded-lg p-1 mr-2 border border-gray-700">
                    <button onClick={() => setView('binder')} className={`p-2 rounded-md transition-colors ${view === 'binder' ? 'bg-gray-700 text-white shadow' : 'text-gray-400 hover:text-white'}`} title="Binder View"><LayoutGrid size={18} /></button>
                    <button onClick={() => setView('dashboard')} className={`p-2 rounded-md transition-colors ${view === 'dashboard' ? 'bg-gray-700 text-white shadow' : 'text-gray-400 hover:text-white'}`} title="Collection Dashboard"><BarChart3 size={18} /></button>
                </div>
                <button onClick={() => fetchSetData(true)} disabled={loading} className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-full transition-colors hidden md:block border border-gray-700/50" title="Force Sync"><RefreshCw size={20} className={loading ? "animate-spin" : ""} /></button>
                
                {/* Collapse Toggle */}
                <button 
                onClick={() => setIsHeaderExpanded(!isHeaderExpanded)}
                className="p-2 text-gray-400 hover:text-white bg-gray-800/50 hover:bg-gray-800 rounded-full transition-colors"
                >
                {isHeaderExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                </button>
            </div>
          </div>

          {/* Collapsible Content */}
          <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isHeaderExpanded ? 'max-h-[500px] opacity-100 mt-2' : 'max-h-0 opacity-0'}`}>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2">
                {/* Set Tabs */}
                <div className="flex bg-gray-800 p-1 rounded-lg overflow-x-auto no-scrollbar max-w-full">
                  {SETS.map(set => (
                    <button key={set.code} onClick={() => setActiveSet(set.code)} className={`px-4 py-2 rounded-md text-sm font-medium transition-all whitespace-nowrap ${activeSet === set.code ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'}`}>{set.code}</button>
                  ))}
                </div>
            </div>

            {/* Filters Bar (Only show in Binder View) */}
            {view === 'binder' && (
              <div className="mt-2 flex flex-col md:flex-row gap-4 items-center justify-between pb-2 border-t border-gray-800 pt-4">
                <div className="relative w-full md:w-64 group">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-yellow-500 transition-colors" size={16} />
                  <input type="text" placeholder="Search cards..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-gray-800/50 border border-gray-700 rounded-full pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-yellow-500/50 focus:ring-1 focus:ring-yellow-500/50 transition-all placeholder:text-gray-600" />
                </div>
                <div className="flex items-center gap-3 overflow-x-auto w-full md:w-auto pb-2 md:pb-0 no-scrollbar">
                  <div className="flex items-center gap-1 bg-gray-800/50 rounded-full p-1 border border-gray-700">
                    <button onClick={() => setSelectedAspect('All')} className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${selectedAspect === 'All' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}>All</button>
                    {ASPECTS.map(aspect => (<button key={aspect.name} onClick={() => setSelectedAspect(aspect.name)} className={`p-1.5 rounded-full transition-all ${selectedAspect === aspect.name ? `${aspect.bg} ${aspect.color} ring-1 ring-inset ${aspect.border} shadow-[0_0_10px_rgba(0,0,0,0.5)]` : `${aspect.color} opacity-70 hover:opacity-100 hover:bg-gray-800`}`} title={aspect.name}><aspect.icon size={16} /></button>))}
                  </div>
                  <select value={selectedType} onChange={(e) => setSelectedType(e.target.value)} className="bg-gray-800/50 text-gray-300 text-xs font-medium px-3 py-2 rounded-full border border-gray-700 focus:outline-none focus:border-yellow-500 cursor-pointer">{uniqueTypes.map(t => <option key={t} value={t}>{t}</option>)}</select>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto p-4 md:p-6">
        {error && (<div className="mb-6 p-4 bg-red-900/20 border border-red-500/30 rounded-xl text-red-200 flex items-center gap-2"><Info size={18} />{error}</div>)}
        {loading && (!cards || cards.length === 0) ? (
          <div className="flex flex-col items-center justify-center h-96 gap-4 text-gray-500"><div className="w-12 h-12 border-4 border-gray-700 border-t-yellow-500 rounded-full animate-spin"></div><p className="animate-pulse">Accessing Imperial Archives...</p></div>
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
                syncCode={syncCode}
                setSyncCode={setSyncCode}
                onUpdateQuantity={handleGridQuantityChange}
                onCardClick={setSelectedCard}
              />
            ) : (
              <>
                {reconstructedData && (
                    <div className="bg-yellow-900/20 border border-yellow-600/50 p-4 rounded-xl mb-4 flex items-center gap-3 text-yellow-200 text-sm">
                        <AlertCircle size={20} />
                        <span>Showing collection-based view. Some card details (HP, Power, Cost) may be missing until API connection is restored.</span>
                    </div>
                )}
                <div className="mb-4 text-gray-500 text-sm font-medium">Showing {filteredCards.length} cards from <span className="text-yellow-500">{SETS.find(s=>s.code===activeSet)?.name}</span></div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-6 auto-rows-fr grid-flow-dense">
                  {filteredCards.map((card) => {
                    const isHorizontal = isHorizontalCard(card.Type);
                    const stdKey = getCollectionId(activeSet, card.Number, false);
                    const foilKey = getCollectionId(activeSet, card.Number, true);
                    const stdOwned = collectionData[stdKey]?.quantity || 0;
                    const foilOwned = collectionData[foilKey]?.quantity || 0;
                    const totalOwned = stdOwned + foilOwned;
                    return (
                      <div key={`${card.Number}-${card.Name}`} onClick={() => setSelectedCard(card)} className={`group relative bg-gray-800 rounded-xl overflow-hidden cursor-pointer shadow-lg hover:shadow-2xl transition-all hover:-translate-y-2 hover:ring-2 ring-yellow-500/50 ${isHorizontal ? 'col-span-2 aspect-[88/63]' : 'col-span-1 aspect-[63/88]'}`}>
                        <div className="absolute top-2 right-2 z-20" onClick={(e) => e.stopPropagation()}>
                            <div className={`flex items-center gap-1 bg-gray-900/90 rounded-full border border-gray-600 shadow-xl backdrop-blur-sm p-0.5 transition-all duration-300 ${totalOwned > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0'}`}>
                                <button onClick={() => handleGridQuantityChange(card, -1)} className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-red-500/20 text-gray-400 hover:text-red-400" disabled={(!user && !syncCode) || !db}><Minus size={12} /></button>
                                <div className="flex flex-col items-center justify-center min-w-[20px]">
                                    <span className={`text-xs font-bold leading-none ${stdOwned > 0 ? 'text-white' : 'text-gray-500'}`}>{stdOwned}</span>
                                    {foilOwned > 0 && (<span className="text-[8px] font-bold text-yellow-500 leading-none mt-0.5">+{foilOwned}F</span>)}
                                </div>
                                <button onClick={() => handleGridQuantityChange(card, 1)} className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-green-500/20 text-gray-400 hover:text-green-400" disabled={(!user && !syncCode) || !db}><Plus size={12} /></button>
                            </div>
                        </div>
                        <div className="absolute inset-0 bg-gray-900 flex items-center justify-center">
                          <img src={getCardImage(activeSet, card.Number)} alt={card.Name} loading="lazy" className={`w-full h-full object-cover transition-opacity duration-300 ${totalOwned > 0 ? 'opacity-100' : 'opacity-80 group-hover:opacity-100'}`} onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
                          <div className="hidden absolute inset-0 flex-col items-center justify-center p-4 text-center bg-gray-800"><Box size={32} className="text-gray-600 mb-2"/><span className="text-xs text-gray-500">{card.Name}</span></div>
                        </div>
                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-4 pointer-events-none">
                          <div className="transform translate-y-4 group-hover:translate-y-0 transition-transform duration-300">
                            <h3 className="text-white font-bold leading-tight shadow-black drop-shadow-md">{card.Name}</h3>
                            {card.Subtitle && <p className="text-yellow-400 text-xs italic">{card.Subtitle}</p>}
                            <div className="flex items-center gap-2 mt-2"><span className="text-gray-300 text-xs px-2 py-0.5 bg-gray-700 rounded-full">{card.Type}</span></div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {filteredCards.length === 0 && (<div className="col-span-full py-20 text-center text-gray-500"><p className="text-lg">No cards found matching your criteria.</p><button onClick={() => {setSearchTerm(''); setSelectedAspect('All'); setSelectedType('All');}} className="mt-4 text-yellow-500 hover:underline">Clear all filters</button></div>)}
              </>
            )}
          </>
        )}
      </main>
      {selectedCard && (<CardModal initialCard={selectedCard} allCards={cards} setCode={activeSet} user={user} collectionData={collectionData} syncCode={syncCode} onClose={() => setSelectedCard(null)} />)}
    </div>
  );
}