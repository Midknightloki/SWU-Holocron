import React from 'react';
import { DEFAULT_AUTO_SETTINGS } from '../utils/autoCapture';

/**
 * Tuning for hands-free capture on a particular rig. Opened from the auto
 * status chip; values are saved per device by the scanner.
 *
 * @environment:react
 */
const SLIDERS = [
  { key: 'presence', label: 'Card detection', min: 0.02, max: 0.5, step: 0.01,
    help: 'How different from the empty rig counts as a card. Raise it if the empty rig triggers scans.',
    show: (v) => v.toFixed(2) },
  { key: 'stillness', label: 'Stillness', min: 0.005, max: 0.1, step: 0.005,
    help: 'How much change still counts as "not moving". Raise it if a still card never scans.',
    show: (v) => v.toFixed(3) },
  { key: 'settleMs', label: 'Settle time', min: 200, max: 3000, step: 100,
    help: 'How long a card must be still before it is scanned.',
    // Math.round, not toFixed: (0.35).toFixed(1) is "0.3" in binary floating point.
    show: (v) => `${Math.round(v / 100) / 10} s` },
  { key: 'sharpness', label: 'Sharpness', min: 10, max: 300, step: 5,
    help: 'How crisp an instant frame must be; blurrier frames fall back to a full photo. Raise it if reads suffer.',
    show: (v) => String(Math.round(v)) },
];

export default function AutoSettings({ settings, onChange, onRelearn, onClose }) {
  return (
    <div role="dialog" aria-label="Auto settings" className="absolute inset-0 z-20 flex flex-col bg-gray-950 text-gray-100">
      <div className="px-4 pt-4 pb-2">
        <h2 className="text-lg font-bold text-white">Auto settings</h2>
        <p className="text-sm text-gray-400">Tune hands-free capture for your rig.</p>
      </div>
      <div className="flex-1 overflow-y-auto px-4 space-y-5">
        {SLIDERS.map(({ key, label, min, max, step, help, show }) => (
          <div key={key}>
            <div className="flex justify-between text-sm">
              <label htmlFor={`auto-${key}`} className="font-bold">{label}</label>
              <span className="text-yellow-400">{show(settings[key])}</span>
            </div>
            <input
              id={`auto-${key}`}
              type="range"
              min={min}
              max={max}
              step={step}
              value={settings[key]}
              onChange={(e) => onChange({ ...settings, [key]: Number(e.target.value) })}
              className="w-full accent-yellow-500"
            />
            <p className="text-xs text-gray-500">{help}</p>
          </div>
        ))}
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={settings.fullPhotos}
            onChange={(e) => onChange({ ...settings, fullPhotos: e.target.checked })}
            className="w-5 h-5 accent-yellow-500"
          />
          Always use full photos
        </label>
        <p className="text-xs text-gray-500 -mt-3">Slower (hold still for each photo), for rigs where instant frames read poorly.</p>
        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onRelearn} className="flex-1 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm">
            Re-learn empty rig
          </button>
          <button type="button" onClick={() => onChange(DEFAULT_AUTO_SETTINGS)} className="flex-1 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm">
            Reset to defaults
          </button>
        </div>
      </div>
      <div className="px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-gray-900 border-t border-gray-800">
        <button type="button" onClick={onClose} className="w-full py-2 rounded-lg bg-yellow-500 hover:bg-yellow-400 text-black font-bold">
          Done
        </button>
      </div>
    </div>
  );
}
