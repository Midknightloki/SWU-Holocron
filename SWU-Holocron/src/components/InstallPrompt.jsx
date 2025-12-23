// Install Prompt Banner Component
import { useState } from 'react';
import { Download, X, Share } from 'lucide-react';
import { useInstallPrompt } from '../hooks/useInstallPrompt';

export default function InstallPrompt() {
  const { canInstall, isInstalled, install, isIOS } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(() => 
    localStorage.getItem('pwa-install-dismissed') === 'true'
  );

  if (isInstalled || dismissed) return null;

  const handleInstall = async () => {
    const success = await install();
    if (success) {
      setDismissed(true);
      localStorage.setItem('pwa-install-dismissed', 'true');
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem('pwa-install-dismissed', 'true');
  };

  if (!canInstall && !isIOS) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-md w-full px-4">
      <div className="bg-gradient-to-r from-yellow-600 to-yellow-500 rounded-lg shadow-lg p-4 animate-in slide-in-from-top-4 fade-in duration-300">
        <div className="flex items-start gap-3">
          <Download className="w-5 h-5 text-white flex-shrink-0 mt-0.5" />
          
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white">
              Install SWU Holocron
            </p>
            <p className="text-xs text-yellow-50 mt-1">
              {isIOS 
                ? `Tap the Share button ${String.fromCharCode(0x2191)} and select "Add to Home Screen"`
                : 'Install the app for quick access and offline use'
              }
            </p>
            
            {!isIOS && (
              <button
                onClick={handleInstall}
                className="mt-3 px-4 py-2 bg-white text-yellow-600 text-sm font-bold rounded-lg hover:bg-yellow-50 transition-colors"
              >
                Install App
              </button>
            )}
          </div>
          
          <button
            onClick={handleDismiss}
            className="flex-shrink-0 p-1 hover:bg-yellow-500/50 rounded transition-colors"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4 text-white" />
          </button>
        </div>
      </div>
    </div>
  );
}
