import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Copy, Trash2, Loader2, Trophy, History } from 'lucide-react';
import { DeckService } from '../services/DeckService';
import { CardService } from '../services/CardService';
import GameLog from './GameLog';
import DeckHistory from './DeckHistory';

export default function DeckManager({ user, collectionData, onOpenDeck, onCreateDeck }) {
  const [decks, setDecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [gameLogs, setGameLogs] = useState({}); // { deckId: logs }
  const [gameLogDeck, setGameLogDeck] = useState(null); // deck to show GameLog modal for
  const [historyDeck, setHistoryDeck] = useState(null); // deck to show DeckHistory modal for

  // Fetch decks on mount
  useEffect(() => {
    if (!user) return;
    loadDecks();
  }, [user]);

  const loadDecks = async () => {
    try {
      setLoading(true);
      setError(null);
      const decksList = await DeckService.listDecks(user.uid);
      setDecks(decksList);

      // Fetch game logs for each deck to compute records
      const logsMap = {};
      for (const deck of decksList) {
        try {
          const logs = await DeckService.listGameLogs(user.uid, deck.id);
          logsMap[deck.id] = logs;
        } catch (e) {
          console.warn(`Failed to load game logs for deck ${deck.id}:`, e.message);
          logsMap[deck.id] = [];
        }
      }
      setGameLogs(logsMap);
    } catch (e) {
      console.error('Failed to load decks:', e);
      setError(e.message || 'Failed to load decks');
    } finally {
      setLoading(false);
    }
  };

  const handleDuplicate = async (deck) => {
    const newName = prompt(`Duplicate "${deck.name}" as:`, `${deck.name} (Copy)`);
    if (!newName) return;

    try {
      const newDeckId = await DeckService.duplicateDeck(user.uid, deck.id, newName);
      await loadDecks();
      alert(`Deck duplicated successfully! (ID: ${newDeckId})`);
    } catch (e) {
      alert(`Failed to duplicate deck: ${e.message}`);
    }
  };

  const handleDelete = async (deck) => {
    if (!window.confirm(`Delete deck "${deck.name}"? This cannot be undone.`)) return;

    try {
      await DeckService.deleteDeck(user.uid, deck.id);
      await loadDecks();
    } catch (e) {
      alert(`Failed to delete deck: ${e.message}`);
    }
  };

  // Format date
  const formatDate = (timestamp) => {
    if (!timestamp) return 'Never';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // Get leader card image
  const getLeaderImage = (leaderId) => {
    if (!leaderId) return null;
    const [set, number] = leaderId.split('_');
    if (!set || !number) return null;
    return CardService.getCardImage(set, number);
  };

  // Get record badge
  const getRecordBadge = (deckId) => {
    const logs = gameLogs[deckId] || [];
    if (logs.length === 0) return null;
    const record = DeckService.computeRecord(logs);
    return record;
  };

  // Empty state
  if (!loading && decks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <div className="text-center">
          <h2 className="text-xl font-bold text-white mb-2">No decks yet</h2>
          <p className="text-gray-400 mb-6 max-w-md">
            Start building your first Star Wars Unlimited deck
          </p>
          <button
            onClick={onCreateDeck}
            className="inline-flex items-center gap-2 px-4 py-2 bg-yellow-500 text-gray-950 font-semibold rounded-lg hover:bg-yellow-400 transition-colors"
          >
            <Plus size={18} />
            Build your first deck
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-white">My Decks</h1>
        <button
          onClick={onCreateDeck}
          className="flex items-center gap-2 px-4 py-2 bg-yellow-500 text-gray-950 font-semibold rounded-lg hover:bg-yellow-400 transition-colors"
        >
          <Plus size={18} />
          New Deck
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 bg-red-900/20 border border-red-600/50 rounded-lg text-red-200 text-sm">
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={32} className="text-gray-400 animate-spin" />
        </div>
      )}

      {/* Deck grid */}
      {!loading && decks.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {decks.map((deck) => {
            const record = getRecordBadge(deck.id);
            const leaderImage = getLeaderImage(deck.leaderId);

            return (
              <div
                key={deck.id}
                className="rounded-xl border border-gray-700/50 bg-gray-800/50 hover:bg-gray-800 transition-all overflow-hidden flex flex-col"
              >
                {/* Leader image */}
                {leaderImage && (
                  <div className="aspect-video bg-gray-900 flex items-center justify-center overflow-hidden">
                    <img
                      src={leaderImage}
                      alt={deck.leaderId}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.target.style.display = 'none';
                      }}
                    />
                  </div>
                )}

                {/* Content */}
                <div className="p-4 flex-1 flex flex-col">
                  {/* Deck name */}
                  <h2 className="text-lg font-bold text-white mb-1 truncate">
                    {deck.name}
                  </h2>

                  {/* Leader ID */}
                  <p className="text-xs text-gray-400 mb-3">
                    {deck.leaderId ? `Leader: ${deck.leaderId}` : 'No leader selected'}
                  </p>

                  {/* Card count */}
                  <p className="text-sm text-gray-300 mb-3">
                    <span className="font-semibold">{deck.totalCards || 0}</span>
                    <span className="text-gray-500">/50 cards</span>
                  </p>

                  {/* Record badge */}
                  {record && record.total > 0 && (
                    <div className="flex items-center gap-2 mb-3 text-xs">
                      <span className="text-green-400 font-semibold">{record.wins}W</span>
                      <span className="text-red-400 font-semibold">{record.losses}L</span>
                      {record.draws > 0 && (
                        <span className="text-yellow-400 font-semibold">{record.draws}D</span>
                      )}
                      <span className="text-gray-500 ml-auto">
                        {record.winRate}%
                      </span>
                    </div>
                  )}

                  {/* Last updated */}
                  <p className="text-xs text-gray-500 mb-4">
                    Updated {formatDate(deck.updatedAt)}
                  </p>

                  {/* Action buttons */}
                  <div className="flex items-center gap-2 mt-auto">
                    <button
                      onClick={() => onOpenDeck(deck)}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors"
                      title="Open deck builder"
                    >
                      <Edit2 size={14} />
                      Open
                    </button>
                    <button
                      onClick={() => setGameLogDeck(deck)}
                      className="px-3 py-2 bg-gray-700 hover:bg-green-900/50 text-gray-300 hover:text-green-400 text-sm rounded-lg transition-colors"
                      title="Game log"
                    >
                      <Trophy size={14} />
                    </button>
                    <button
                      onClick={() => setHistoryDeck(deck)}
                      className="px-3 py-2 bg-gray-700 hover:bg-yellow-900/50 text-gray-300 hover:text-yellow-400 text-sm rounded-lg transition-colors"
                      title="Deck history"
                    >
                      <History size={14} />
                    </button>
                    <button
                      onClick={() => handleDuplicate(deck)}
                      className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-lg transition-colors"
                      title="Duplicate deck"
                    >
                      <Copy size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(deck)}
                      className="px-3 py-2 bg-gray-700 hover:bg-red-900/50 text-gray-300 hover:text-red-400 text-sm rounded-lg transition-colors"
                      title="Delete deck"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* GameLog Modal */}
      {gameLogDeck && (
        <GameLog
          deckId={gameLogDeck.id}
          deckName={gameLogDeck.name}
          user={user}
          onClose={() => {
            setGameLogDeck(null);
            loadDecks(); // refresh record badges after logging
          }}
        />
      )}

      {/* DeckHistory Modal */}
      {historyDeck && (
        <DeckHistory
          deckId={historyDeck.id}
          deckName={historyDeck.name}
          currentDeck={historyDeck}
          user={user}
          onClose={() => setHistoryDeck(null)}
          onRestored={() => {
            setHistoryDeck(null);
            loadDecks();
          }}
        />
      )}
    </div>
  );
}
