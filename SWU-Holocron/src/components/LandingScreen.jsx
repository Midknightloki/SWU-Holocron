import React, { useState } from 'react';
import { Layers, Key, ArrowRight, Orbit } from 'lucide-react';

export default function LandingScreen({ onStart }) {
  const [code, setCode] = useState('');

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-900/20 via-gray-900 to-gray-950 z-0"></div>
      
      <div className="relative z-10 w-full max-w-md bg-gray-900/80 backdrop-blur-xl border border-gray-700 rounded-2xl p-8 shadow-2xl flex flex-col items-center">
        <div className="w-16 h-16 bg-yellow-500 rounded-2xl flex items-center justify-center shadow-lg shadow-yellow-500/20 mb-6 transform rotate-3">
           <Layers className="text-black" size={32} />
        </div>
        
        <h1 className="text-3xl font-bold text-white mb-2 text-center tracking-tight">SWU Holocron</h1>
        <p className="text-gray-400 text-center mb-8 text-sm">Access the shared archive. Manage your collection.</p>

        <div className="w-full space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 ml-1">Sync Key (Optional)</label>
            <div className="relative">
              <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
              <input 
                type="text" 
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. jedi-master-42"
                className="w-full bg-gray-950 border border-gray-700 rounded-xl py-3 pl-10 pr-4 text-white placeholder:text-gray-600 focus:outline-none focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500 transition-all"
              />
            </div>
          </div>

          <button 
            onClick={() => onStart(code.trim() || null)}
            className="w-full bg-gradient-to-r from-yellow-500 to-yellow-400 hover:from-yellow-400 hover:to-yellow-300 text-black font-bold py-3.5 rounded-xl shadow-lg transition-all transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2"
          >
            {code ? 'Load Collection' : 'Enter as Guest'}
            <ArrowRight size={18} />
          </button>
        </div>

        <div className="mt-6 pt-6 border-t border-gray-800 w-full text-center">
           <div className="flex items-center justify-center gap-2 text-xs text-gray-600">
             <Orbit size={12} />
             <span>Secure Cloud Storage • Offline Ready</span>
           </div>
        </div>
      </div>
    </div>
  );
}