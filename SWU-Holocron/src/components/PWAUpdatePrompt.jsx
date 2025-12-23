// PWA Update Prompt Component
import { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';

export default function PWAUpdatePrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      console.log('✓ PWA Service Worker registered');
    },
    onRegisterError(error) {
      console.error('✗ PWA registration error:', error);
    },
  });

  const close = () => {
    setOfflineReady(false);
    setNeedRefresh(false);
  };

  const update = () => {
    updateServiceWorker(true);
  };

  if (!offlineReady && !needRefresh) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-md">
      <div className="bg-gray-800 border border-gray-700 rounded-lg shadow-xl p-4 animate-in slide-in-from-bottom-4 fade-in duration-300">
        <div className="flex items-start gap-3">
          {needRefresh ? (
            <RefreshCw className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
          ) : (
            <div className="w-5 h-5 rounded-full bg-green-500 flex-shrink-0 mt-0.5" />
          )}
          
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white">
              {needRefresh ? 'Update Available' : 'Ready for Offline Use'}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {needRefresh
                ? 'A new version is available. Refresh to update.'
                : 'The app is now cached and works offline.'}
            </p>
            
            {needRefresh && (
              <button
                onClick={update}
                className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 bg-yellow-600 hover:bg-yellow-500 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Reload & Update
              </button>
            )}
          </div>
          
          <button
            onClick={close}
            className="flex-shrink-0 p-1 hover:bg-gray-700 rounded transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>
      </div>
    </div>
  );
}
