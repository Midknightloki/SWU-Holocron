import React, { useState, useEffect } from 'react';
import {
  X,
  History,
  RotateCcw,
  Clock,
  FileText,
  Loader2,
  ChevronRight,
} from 'lucide-react';
import { DeckService } from '../services/DeckService';

/**
 * Calculate differences between two decks
 * Returns: { added: [{cardId, count}], removed: [{cardId, count}], changed: [{cardId, from, to}] }
 */
function diffDecks(deckA_cards, deckB_cards) {
  const added = [];
  const removed = [];
  const changed = [];

  // Get all unique card IDs
  const allCardIds = new Set([
    ...Object.keys(deckA_cards || {}),
    ...Object.keys(deckB_cards || {}),
  ]);

  for (const cardId of allCardIds) {
    const countA = (deckA_cards || {})[cardId] || 0;
    const countB = (deckB_cards || {})[cardId] || 0;

    if (countA === 0 && countB > 0) {
      added.push({ cardId, count: countB });
    } else if (countA > 0 && countB === 0) {
      removed.push({ cardId, count: countA });
    } else if (countA !== countB) {
      changed.push({ cardId, from: countA, to: countB });
    }
  }

  return { added, removed, changed };
}

export default function DeckHistory({ deckId, deckName, currentDeck, user, onClose, onRestored }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(null);
  const [error, setError] = useState(null);
  const [restoringNote, setRestoringNote] = useState('');

  // Fetch versions on mount
  useEffect(() => {
    loadVersions();
  }, []);

  const loadVersions = async () => {
    try {
      setLoading(true);
      setError(null);
      const versionsList = await DeckService.listVersions(user.uid, deckId);
      // Reverse to show newest first
      setVersions(versionsList.reverse());
    } catch (e) {
      console.error('Failed to load versions:', e);
      setError(e.message || 'Failed to load versions');
    } finally {
      setLoading(false);
    }
  };

  const handleRestoreVersion = async (version) => {
    const confirmRestore = window.confirm(
      `Restore this deck to version ${version.versionNumber}?\n\nDate saved: ${formatDate(version.savedAt)}\n\nThis will create a new version snapshot of your current deck.`
    );

    if (!confirmRestore) return;

    // Ask for optional note
    const note = window.prompt(
      'Optional: Add a note for this restoration (e.g., "Tried different strategy")',
      ''
    );
    if (note === null) return; // User cancelled

    try {
      setRestoring(version.id);
      setError(null);

      await DeckService.restoreVersion(user.uid, deckId, version.id, note || undefined);

      // Reload versions
      await loadVersions();

      // Call callback
      if (onRestored) onRestored();

      alert(`Deck restored to version ${version.versionNumber}`);
    } catch (e) {
      console.error('Failed to restore version:', e);
      setError(e.message || 'Failed to restore version');
    } finally {
      setRestoring(null);
    }
  };

  // Format date
  const formatDate = (timestamp) => {
    if (!timestamp) return 'Unknown';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <History size={24} className="text-blue-400" />
            <div>
              <h2 className="text-2xl font-bold text-white">Version History</h2>
              <p className="text-sm text-gray-400">{deckName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors text-gray-400 hover:text-white"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-4">
            {/* Error message */}
            {error && (
              <div className="p-4 bg-red-900/20 border border-red-600/50 rounded-lg text-red-200 text-sm">
                {error}
              </div>
            )}

            {/* Loading state */}
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={32} className="text-gray-400 animate-spin" />
              </div>
            ) : versions.length === 0 ? (
              /* Empty state */
              <div className="text-center py-12 text-gray-400">
                <History size={40} className="mx-auto mb-3 opacity-50" />
                <p className="text-sm">No version history yet</p>
                <p className="text-xs text-gray-500 mt-2">
                  Versions are saved automatically when you update a deck
                </p>
              </div>
            ) : (
              /* Version list */
              <div className="space-y-3">
                {versions.map((version, idx) => {
                  // Calculate diff vs current deck
                  const diff = diffDecks(version.cards, currentDeck.cards);
                  const addedCount = diff.added.length;
                  const removedCount = diff.removed.length;
                  const changedCount = diff.changed.length;

                  // Build diff summary
                  let diffSummary = '';
                  if (addedCount > 0) diffSummary += `Added: +${addedCount} card${addedCount !== 1 ? 's' : ''}`;
                  if (removedCount > 0) {
                    if (diffSummary) diffSummary += ', ';
                    diffSummary += `Removed: -${removedCount} card${removedCount !== 1 ? 's' : ''}`;
                  }
                  if (changedCount > 0) {
                    if (diffSummary) diffSummary += ', ';
                    diffSummary += `Changed: ${changedCount} card${changedCount !== 1 ? 's' : ''}`;
                  }
                  if (!diffSummary) {
                    diffSummary = 'No changes';
                  }

                  return (
                    <div
                      key={version.id}
                      className="bg-gray-800 border border-gray-700 rounded-lg p-4 hover:border-gray-600 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div className="flex-1">
                          {/* Version badge and date */}
                          <div className="flex items-center gap-2 mb-2">
                            <span className="inline-flex items-center justify-center w-6 h-6 bg-blue-600 text-white text-xs font-bold rounded">
                              v{version.versionNumber}
                            </span>
                            <span className="flex items-center gap-1 text-xs text-gray-400">
                              <Clock size={12} />
                              {formatDate(version.savedAt)} at {formatTime(version.savedAt)}
                            </span>
                          </div>

                          {/* Card count */}
                          <p className="text-sm text-gray-300 mb-2">
                            <span className="font-semibold">{version.totalCards || 0}</span>
                            <span className="text-gray-500">/50 cards</span>
                          </p>

                          {/* Leader and base info */}
                          <p className="text-xs text-gray-400 mb-2">
                            {version.leaderId || 'No leader'} / {version.baseId || 'No base'}
                          </p>

                          {/* Diff summary */}
                          <p className="text-xs text-gray-500 italic">{diffSummary}</p>

                          {/* Version note */}
                          {version.note && (
                            <div className="mt-2 p-2 bg-gray-700/30 border border-gray-600 rounded text-xs text-gray-300 flex items-start gap-2">
                              <FileText size={12} className="flex-shrink-0 mt-0.5" />
                              <span>{version.note}</span>
                            </div>
                          )}
                        </div>

                        {/* Restore button */}
                        <button
                          onClick={() => handleRestoreVersion(version)}
                          disabled={restoring === version.id}
                          className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:text-gray-400 text-white text-sm font-semibold rounded-lg transition-colors flex-shrink-0"
                          title={`Restore version ${version.versionNumber}`}
                        >
                          {restoring === version.id ? (
                            <>
                              <Loader2 size={14} className="animate-spin" />
                              Restoring
                            </>
                          ) : (
                            <>
                              <RotateCcw size={14} />
                              Restore
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
