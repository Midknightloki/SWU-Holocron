import React from 'react';
import { Layers, ArrowRight, Orbit, ShieldCheck, LogIn } from 'lucide-react';

export default function LandingScreen({ onGoogleLogin, onGuest, loading, error, hasLegacySync }) {
  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-900/20 via-gray-900 to-gray-950 z-0"></div>

      <div className="relative z-10 w-full max-w-md bg-gray-900/80 backdrop-blur-xl border border-gray-700 rounded-2xl p-8 shadow-2xl flex flex-col items-center">
        <div className="w-16 h-16 bg-yellow-500 rounded-2xl flex items-center justify-center shadow-lg shadow-yellow-500/20 mb-6 transform rotate-3">
          <Layers className="text-black" size={32} />
        </div>

        <h1 className="text-3xl font-bold text-white mb-2 text-center tracking-tight">SWU Holocron</h1>
        <p className="text-gray-400 text-center mb-6 text-sm">Sign in to sync your collection across devices.</p>

        <div className="w-full space-y-3">
          <button
            onClick={onGoogleLogin}
            disabled={loading}
            className="w-full bg-white text-gray-900 font-semibold py-3.5 rounded-xl shadow-lg transition-all transform hover:scale-[1.01] active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-70"
          >
            <LogIn size={18} />
            {loading ? 'Connecting…' : 'Continue with Google'}
          </button>

          <button
            onClick={onGuest}
            disabled={loading}
            className="w-full bg-gradient-to-r from-yellow-500 to-yellow-400 hover:from-yellow-400 hover:to-yellow-300 text-black font-bold py-3.5 rounded-xl shadow-lg transition-all transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-70"
          >
            Continue as Guest
            <ArrowRight size={18} />
          </button>

          {hasLegacySync && (
            <div className="flex items-center gap-2 text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-2">
              <ShieldCheck size={14} />
              <span>Legacy Sync data detected. You can import it after signing in.</span>
            </div>
          )}
        </div>

        {error && (
          <div className="w-full mt-4 text-sm text-red-300 bg-red-900/30 border border-red-700/50 rounded-lg p-3 text-center">
            {error}
          </div>
        )}

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