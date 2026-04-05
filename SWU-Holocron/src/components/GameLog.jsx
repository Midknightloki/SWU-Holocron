import React, { useState, useEffect } from 'react';
import {
  X,
  Trophy,
  Trash2,
  CheckCircle,
  XCircle,
  Minus,
  Loader2,
  Calendar,
  StickyNote,
} from 'lucide-react';
import { DeckService } from '../services/DeckService';

export default function GameLog({ deckId, deckName, user, onClose }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Form state
  const [selectedResult, setSelectedResult] = useState(null);
  const [opponentLeaderId, setOpponentLeaderId] = useState('');
  const [opponentBaseId, setOpponentBaseId] = useState('');
  const [notes, setNotes] = useState('');
  const [format, setFormat] = useState('Premier');

  // Fetch game logs on mount
  useEffect(() => {
    loadGameLogs();
  }, []);

  const loadGameLogs = async () => {
    try {
      setLoading(true);
      setError(null);
      const gameLogsList = await DeckService.listGameLogs(user.uid, deckId);
      setLogs(gameLogsList);
    } catch (e) {
      console.error('Failed to load game logs:', e);
      setError(e.message || 'Failed to load game logs');
    } finally {
      setLoading(false);
    }
  };

  const handleLogGame = async () => {
    if (!selectedResult) return;

    try {
      setSubmitting(true);
      setError(null);

      await DeckService.logGame(user.uid, deckId, {
        result: selectedResult,
        opponentLeaderId: opponentLeaderId || null,
        opponentBaseId: opponentBaseId || null,
        notes: notes || '',
        format: format || 'Premier',
      });

      // Reset form
      setSelectedResult(null);
      setOpponentLeaderId('');
      setOpponentBaseId('');
      setNotes('');
      setFormat('Premier');

      // Reload logs
      await loadGameLogs();
    } catch (e) {
      console.error('Failed to log game:', e);
      setError(e.message || 'Failed to log game');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteLog = async (logId) => {
    if (!window.confirm('Delete this game log? This cannot be undone.')) return;

    try {
      await DeckService.deleteGameLog(user.uid, deckId, logId);
      await loadGameLogs();
    } catch (e) {
      console.error('Failed to delete log:', e);
      alert(`Failed to delete log: ${e.message}`);
    }
  };

  // Compute record
  const record = DeckService.computeRecord(logs);

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
            <Trophy size={24} className="text-yellow-500" />
            <div>
              <h2 className="text-2xl font-bold text-white">Game Log</h2>
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
          <div className="p-6 space-y-6">
            {/* Record Summary */}
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
              <div className="flex items-baseline justify-between">
                <div className="flex items-baseline gap-4">
                  <span className="text-sm text-gray-400 uppercase tracking-wider">Record</span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-green-500">{record.wins}W</span>
                    <span className="text-3xl font-bold text-red-500">{record.losses}L</span>
                    {record.draws > 0 && (
                      <span className="text-3xl font-bold text-gray-400">{record.draws}D</span>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-white">{record.winRate}%</p>
                  <p className="text-xs text-gray-400">Win rate</p>
                </div>
              </div>
              <p className="text-sm text-gray-400 mt-2">
                {record.total} total games played
              </p>
            </div>

            {/* Error message */}
            {error && (
              <div className="p-4 bg-red-900/20 border border-red-600/50 rounded-lg text-red-200 text-sm">
                {error}
              </div>
            )}

            {/* Log a game form */}
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 space-y-4">
              <h3 className="font-semibold text-white">Log a Game</h3>

              {/* Result selector */}
              <div className="space-y-2">
                <label className="block text-sm text-gray-300">Result</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSelectedResult('win')}
                    className={`flex-1 py-2 px-3 rounded-lg font-semibold transition-colors flex items-center justify-center gap-2 ${
                      selectedResult === 'win'
                        ? 'bg-green-600 text-white border-2 border-yellow-500'
                        : 'bg-gray-700 text-gray-300 border-2 border-gray-700'
                    }`}
                  >
                    <CheckCircle size={16} />
                    Win
                  </button>
                  <button
                    onClick={() => setSelectedResult('loss')}
                    className={`flex-1 py-2 px-3 rounded-lg font-semibold transition-colors flex items-center justify-center gap-2 ${
                      selectedResult === 'loss'
                        ? 'bg-red-600 text-white border-2 border-yellow-500'
                        : 'bg-gray-700 text-gray-300 border-2 border-gray-700'
                    }`}
                  >
                    <XCircle size={16} />
                    Loss
                  </button>
                  <button
                    onClick={() => setSelectedResult('draw')}
                    className={`flex-1 py-2 px-3 rounded-lg font-semibold transition-colors flex items-center justify-center gap-2 ${
                      selectedResult === 'draw'
                        ? 'bg-gray-500 text-white border-2 border-yellow-500'
                        : 'bg-gray-700 text-gray-300 border-2 border-gray-700'
                    }`}
                  >
                    <Minus size={16} />
                    Draw
                  </button>
                </div>
              </div>

              {/* Opponent leader ID */}
              <div className="space-y-2">
                <label className="block text-sm text-gray-300">
                  Opponent Leader (optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g., SOR_001"
                  value={opponentLeaderId}
                  onChange={(e) => setOpponentLeaderId(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-yellow-500 focus:ring-2 focus:ring-yellow-500/20"
                />
              </div>

              {/* Opponent base ID */}
              <div className="space-y-2">
                <label className="block text-sm text-gray-300">
                  Opponent Base (optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g., SOR_001"
                  value={opponentBaseId}
                  onChange={(e) => setOpponentBaseId(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-yellow-500 focus:ring-2 focus:ring-yellow-500/20"
                />
              </div>

              {/* Format */}
              <div className="space-y-2">
                <label className="block text-sm text-gray-300">Format (optional)</label>
                <input
                  type="text"
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-yellow-500 focus:ring-2 focus:ring-yellow-500/20"
                />
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <label className="block text-sm text-gray-300">
                  Notes (optional)
                </label>
                <textarea
                  placeholder="How the game went, key moments, etc."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows="3"
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-yellow-500 focus:ring-2 focus:ring-yellow-500/20 resize-none"
                />
              </div>

              {/* Submit button */}
              <button
                onClick={handleLogGame}
                disabled={!selectedResult || submitting}
                className="w-full py-2 px-4 bg-yellow-500 hover:bg-yellow-400 disabled:bg-gray-600 disabled:text-gray-400 text-gray-950 font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Logging...
                  </>
                ) : (
                  <>
                    <Trophy size={16} />
                    Log Game
                  </>
                )}
              </button>
            </div>

            {/* Recent games list */}
            <div className="space-y-3">
              <h3 className="font-semibold text-white">Recent Games</h3>

              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={24} className="text-gray-400 animate-spin" />
                </div>
              ) : logs.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <Trophy size={32} className="mx-auto mb-2 opacity-50" />
                  <p>No games logged yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {logs.map((log) => (
                    <div
                      key={log.id}
                      className="bg-gray-800 border border-gray-700 rounded-lg p-3 flex items-start justify-between gap-3 hover:border-gray-600 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {log.result === 'win' && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-500/20 text-green-400 text-xs font-semibold rounded">
                              <CheckCircle size={12} />
                              WIN
                            </span>
                          )}
                          {log.result === 'loss' && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-500/20 text-red-400 text-xs font-semibold rounded">
                              <XCircle size={12} />
                              LOSS
                            </span>
                          )}
                          {log.result === 'draw' && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-500/20 text-gray-300 text-xs font-semibold rounded">
                              <Minus size={12} />
                              DRAW
                            </span>
                          )}
                          <span className="flex items-center gap-1 text-xs text-gray-500">
                            <Calendar size={12} />
                            {formatDate(log.playedAt)} at {formatTime(log.playedAt)}
                          </span>
                        </div>

                        {(log.opponentLeaderId || log.opponentBaseId) && (
                          <p className="text-xs text-gray-400">
                            vs {log.opponentLeaderId || '?'} / {log.opponentBaseId || '?'}
                          </p>
                        )}

                        {log.notes && (
                          <p className="text-xs text-gray-400 mt-1 line-clamp-2">
                            {log.notes}
                          </p>
                        )}

                        {log.format && (
                          <p className="text-xs text-gray-500 mt-1">{log.format}</p>
                        )}
                      </div>

                      <button
                        onClick={() => handleDeleteLog(log.id)}
                        className="p-2 hover:bg-red-900/30 rounded-lg transition-colors text-gray-400 hover:text-red-400 flex-shrink-0"
                        title="Delete log"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
