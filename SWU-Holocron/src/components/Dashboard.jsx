import React, { useMemo } from 'react';
import { Database, Upload, Download, Loader2, CheckCircle2, Layers, Trophy, AlertCircle, Plus } from 'lucide-react';
import { SETS } from '../constants';
import { calculateStats, calculateGlobalSummary } from '../utils/statsCalculator';
import { generateMissingCardsCSV } from '../utils/csvParser';

export default function Dashboard({ setCode, cards, collectionData, onImport, onExport, isImporting, hasDataToExport, onUpdateQuantity, onCardClick }) {
  const stats = useMemo(() => {
    return calculateStats(cards, collectionData, setCode);
  }, [cards, collectionData, setCode]);

  const globalSummary = useMemo(() => {
    return calculateGlobalSummary(collectionData);
  }, [collectionData]);

  const handleExportMissing = () => {
    if (!stats || stats.missingList.length === 0) {
      alert("No missing cards!");
      return;
    }

    try {
      const csv = generateMissingCardsCSV(stats.missingList, setCode);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);

      link.setAttribute('href', url);
      link.setAttribute('download', `swu_missing_${setCode}_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export missing cards error:', error);
      alert(`Export failed: ${error.message}`);
    }
  };

  if (!stats) return <div className="p-10 text-center text-gray-500">Loading set data...</div>;

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-gray-800 pb-6">
        <div>
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                <Database size={24} className="text-yellow-500" />
                Command Center
            </h2>
            <div className="flex items-center gap-2 mt-1">
               <p className="text-gray-500 text-sm">Manage your collection</p>
            </div>
        </div>
        
        <div className="flex flex-wrap gap-3 w-full sm:w-auto">
            <button onClick={onImport} disabled={isImporting} className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg border border-gray-700 transition-colors disabled:opacity-50">
                {isImporting ? <Loader2 size={18} className="animate-spin text-yellow-500" /> : <Upload size={18} />}
                <span>Import CSV</span>
            </button>
            <button onClick={onExport} disabled={!hasDataToExport} className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg border border-gray-700 transition-colors disabled:opacity-50">
                <Download size={18} />
                <span>Export CSV</span>
            </button>
        </div>
      </div>

      {/* Stats Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* ... Stats cards (same as before, concise for brevity) ... */}
         <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700 shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10"><Layers size={100} className="text-yellow-500" /></div>
          <h3 className="text-gray-400 font-bold uppercase text-xs tracking-widest mb-1">Unique Cards</h3>
          <div className="text-3xl font-bold text-white mb-4">{stats.ownedUniqueCount} <span className="text-gray-500 text-lg">/ {stats.totalUniqueCards}</span></div>
          <div className="relative w-full h-4 bg-gray-700 rounded-full overflow-hidden">
            <div className="absolute top-0 left-0 h-full bg-gradient-to-r from-yellow-600 to-yellow-400 transition-all duration-1000 ease-out" style={{ width: `${stats.percentComplete}%` }}></div>
          </div>
          <div className="mt-2 text-right text-yellow-500 font-bold">{stats.percentComplete}% Complete</div>
        </div>

        <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700 shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10"><Trophy size={100} className="text-blue-500" /></div>
          <h3 className="text-gray-400 font-bold uppercase text-xs tracking-widest mb-1">Playable Sets</h3>
          <div className="text-4xl font-bold text-white mb-2">{stats.playsetsCount}</div>
          <p className="text-gray-500 text-sm">3x Units/Events, 1x Leaders/Bases</p>
        </div>

        <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700 shadow-xl overflow-y-auto max-h-48 scrollbar-thin scrollbar-thumb-gray-600">
          <h3 className="text-gray-400 font-bold uppercase text-xs tracking-widest mb-3">Total Volume</h3>
          <div className="space-y-2">
            {SETS.map(s => (
              <div key={s.code} className="flex justify-between items-center text-sm">
                <span className={s.code === setCode ? "text-yellow-500 font-bold" : "text-gray-300"}>{s.name}</span>
                <span className="bg-gray-700 px-2 py-0.5 rounded-full text-xs text-gray-100">{globalSummary[s.code] || 0}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Missing Cards Table */}
      <div className="bg-gray-900 rounded-2xl border border-gray-800 shadow-xl overflow-hidden">
        <div className="p-6 border-b border-gray-800 flex justify-between items-center bg-gray-800/50">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <AlertCircle size={20} className="text-red-400" /> Missing Unique Titles
            </h2>
            <p className="text-gray-500 text-sm mt-1">Cards you don't own any version of.</p>
          </div>
          {stats.missingList.length > 0 && (
            <button
              onClick={handleExportMissing}
              className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-bold rounded-lg border border-gray-700 transition-colors"
            >
              <Download size={14} />
              Export List
            </button>
          )}
        </div>
        {stats.missingList.length > 0 ? (
          <div className="max-h-[500px] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-700">
            <table className="w-full text-left border-collapse">
              <thead className="bg-gray-800 text-gray-400 text-xs uppercase tracking-wider sticky top-0 z-10">
                <tr>
                  <th className="p-3 w-10"></th>
                  <th className="p-3 font-semibold">#</th>
                  <th className="p-3 font-semibold">Name</th>
                  <th className="p-3 font-semibold">Rarity</th>
                  <th className="p-3 font-semibold">Type</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800 text-sm text-gray-300">
                {stats.missingList.map(card => (
                  <tr key={card.id || card.Number} className="hover:bg-gray-800/50 transition-colors">
                    <td className="p-3">
                      <button 
                        onClick={() => onUpdateQuantity(card, 1)}
                        className="w-8 h-8 bg-green-600 hover:bg-green-500 text-white rounded-full flex items-center justify-center transition-all transform active:scale-95 shadow-md shadow-green-900/20"
                      >
                        <Plus size={16} />
                      </button>
                    </td>
                    <td className="p-3 font-mono text-gray-500 text-xs sm:text-sm">{card.Number}</td>
                    <td 
                      className="p-3 font-medium text-white cursor-pointer hover:text-yellow-400 transition-colors"
                      onClick={() => onCardClick(card)}
                    >
                      {card.Name} 
                      {card.Subtitle && <span className="text-gray-500 text-xs italic block sm:inline sm:ml-2">{card.Subtitle}</span>}
                    </td>
                    <td className="p-3"><span className="px-2 py-1 rounded text-[10px] bg-gray-800 border border-gray-700">{card.Rarity}</span></td>
                    <td className="p-3 text-gray-400 text-xs sm:text-sm">{card.Type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-12 text-center text-green-500"><CheckCircle2 className="mx-auto mb-2"/>Set Complete!</div>
        )}
      </div>
    </div>
  );
}