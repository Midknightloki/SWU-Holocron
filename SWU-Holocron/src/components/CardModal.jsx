import React, { useState, useEffect, useMemo } from 'react';
import { X, RefreshCw, Sparkles, Plus, Minus, Loader2, ImageIcon, Info } from 'lucide-react';
import { CardService } from '../services/CardService';
import { db, APP_ID } from '../firebase';
import { doc, setDoc, deleteDoc, collection } from 'firebase/firestore';

const AspectIcon = ({ aspect }) => { /* ... icon logic ... */ return <span>{aspect}</span> }; // Simplification for brevity in this file block, copy from previous if needed

export default function CardModal({ initialCard, allCards, setCode, user, collectionData, syncCode, onClose }) {
  const [currentCard, setCurrentCard] = useState(initialCard);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isFoil, setIsFoil] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);

  const collectionKey = CardService.getCollectionId(currentCard.Set, currentCard.Number, isFoil);
  const ownedCount = collectionData[collectionKey]?.quantity || 0;

  const variants = useMemo(() => {
    if (!allCards || !initialCard) return [];
    return allCards
      .filter(c => c.Name === initialCard.Name && c.Subtitle === initialCard.Subtitle)
      .sort((a, b) => a.Number.localeCompare(b.Number, undefined, { numeric: true }));
  }, [allCards, initialCard]);

  useEffect(() => { setCurrentCard(initialCard); setIsFlipped(false); setIsFoil(false); }, [initialCard]);

  const hasBack = currentCard.Type === 'Leader';
  const imageUrl = isFlipped && hasBack ? CardService.getBackImage(currentCard.Set, currentCard.Number) : CardService.getCardImage(currentCard.Set, currentCard.Number);

  useEffect(() => { setImageLoading(true); setImageError(false); }, [imageUrl]);

  const handleQuantityChange = async (delta) => {
    if (!db || (!user && !syncCode)) return;
    const newQuantity = ownedCount + delta;
    
    // Determine path dynamically
    let collectionRef;
    if (syncCode) collectionRef = collection(db, 'artifacts', APP_ID, 'public', 'data', `sync_${syncCode}`);
    else if (user) collectionRef = collection(db, 'artifacts', APP_ID, 'users', user.uid, 'collection');
    else return;

    try {
      const docRef = doc(collectionRef, collectionKey);
      if (newQuantity > 0) {
        await setDoc(docRef, {
          quantity: newQuantity, set: currentCard.Set, number: currentCard.Number, name: currentCard.Name, isFoil: isFoil, timestamp: Date.now()
        }, { merge: true });
      } else {
        await deleteDoc(docRef);
      }
    } catch (e) {
      console.error("Error updating collection:", e);
    }
  };

  // ... rest of UI (Image, Controls, Info) ...
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-in fade-in duration-200">
       <div className="relative w-full max-w-7xl bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col md:flex-row h-[90vh] md:h-[85vh]">
          {/* Close Button */}
          <button onClick={onClose} className="absolute top-4 right-4 z-10 p-2 bg-black/50 hover:bg-red-500/80 rounded-full text-white transition-colors border border-white/10"><X size={24} /></button>
          
          {/* Image & Controls Column */}
          <div className="w-full md:w-3/5 bg-black/50 flex flex-col items-center justify-center p-4 md:p-8 relative overflow-hidden">
             {/* ... Image Logic ... */}
             <div className="relative flex items-center justify-center w-full h-full">
                <img src={imageUrl} alt={currentCard.Name} className={`max-h-[65vh] object-contain drop-shadow-2xl rounded-lg ${imageLoading ? 'opacity-0' : 'opacity-100'} transition-opacity`} onLoad={() => setImageLoading(false)} />
             </div>

             {/* Controls */}
             <div className="absolute bottom-6 flex flex-col items-center gap-3 z-30">
                <div className="flex items-center gap-3 bg-gray-900/90 px-4 py-2 rounded-full border border-gray-600">
                    <button onClick={() => handleQuantityChange(-1)}><Minus size={16} /></button>
                    <span className="font-bold text-white w-6 text-center">{ownedCount}</span>
                    <button onClick={() => handleQuantityChange(1)}><Plus size={16} /></button>
                </div>
                <div className="flex gap-2">
                   {hasBack && <button onClick={() => setIsFlipped(!isFlipped)} className="bg-gray-800 text-white px-3 py-1 rounded"><RefreshCw size={14} /></button>}
                   <button onClick={() => setIsFoil(!isFoil)} className={`px-3 py-1 rounded flex items-center gap-1 ${isFoil ? 'bg-yellow-500 text-black' : 'bg-gray-800 text-white'}`}><Sparkles size={14} /> Foil</button>
                </div>
                {/* Variants */}
                {variants.length > 1 && (
                  <div className="flex gap-1 overflow-x-auto max-w-[300px]">
                    {variants.map(v => (
                      <button key={v.Number} onClick={() => setCurrentCard(v)} className={`px-2 py-1 text-xs rounded ${currentCard.Number === v.Number ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400'}`}>{v.Number}</button>
                    ))}
                  </div>
                )}
             </div>
          </div>

          {/* Info Column */}
          <div className="w-full md:w-2/5 p-6 md:p-8 bg-gray-900 text-gray-100 border-l border-gray-800 overflow-y-auto">
             <h2 className="text-3xl font-bold">{currentCard.Name}</h2>
             <p className="text-yellow-500 italic mb-4">{currentCard.Subtitle}</p>
             <div className="bg-gray-800/50 p-4 rounded-xl border border-gray-700">
               <p className="whitespace-pre-wrap">{isFlipped && hasBack ? currentCard.BackText : currentCard.FrontText}</p>
             </div>
          </div>
       </div>
    </div>
  );
}