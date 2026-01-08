import React, { useState, useEffect } from 'react';
import { Database, RefreshCw, Clock, CheckCircle, XCircle, AlertTriangle, Download, Shield } from 'lucide-react';
import { db, APP_ID } from '../firebase';
import { collection, doc, getDoc, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';

export default function AdminPanel() {
  const { user, isAdmin, adminLoading } = useAuth();
  const [metadata, setMetadata] = useState(null);
  const [syncLogs, setSyncLogs] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    setLoading(true);
    setError(null);

    try {
      // Load sync metadata
      const metadataRef = doc(
        db,
        'artifacts', APP_ID,
        'public', 'data',
        'cardDatabase', 'metadata'
      );
      const metadataSnap = await getDoc(metadataRef);

      if (metadataSnap.exists()) {
        setMetadata(metadataSnap.data());
      }

      // Load recent sync logs
      const logsRef = collection(
        db,
        'artifacts', APP_ID,
        'admin', 'sync', 'logs'
      );
      const logsQuery = query(logsRef, orderBy('timestamp', 'desc'), limit(10));
      const logsSnap = await getDocs(logsQuery);

      const logs = [];
      logsSnap.forEach(doc => {
        logs.push({ id: doc.id, ...doc.data() });
      });
      setSyncLogs(logs);

    } catch (err) {
      console.error('Failed to load dashboard data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleManualSync = async () => {
    alert('Card database sync must be run server-side using the admin script:\n\nnode scripts/seedCardDatabase.js\n\nThis requires Firebase Admin SDK credentials.');
    return;

    /* Disabled - requires server-side execution
    if (!window.confirm('This will fetch all card sets from the API and update Firestore. Continue?')) {
      return;
    }

    setSyncing(true);
    setError(null);

    try {
      const result = await seedCardDatabase();

      if (result.success) {
        alert(`✓ Sync completed!\n\nCards synced: ${result.results}\nDuration: ${(result.duration / 1000).toFixed(2)}s`);
      } else {
        alert(`⚠ Sync completed with errors\n\nErrors: ${result.errors.length}\nSee console for details`);
      }

      // Reload dashboard
      await loadDashboardData();

    } catch (err) {
      console.error('Sync failed:', err);
      setError(err.message);
      alert(`✗ Sync failed: ${err.message}`);
    } finally {
      setSyncing(false);
    }
    */
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    const now = Date.now();
    const diff = now - timestamp;

    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString();
  };

  const formatDuration = (ms) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  if (loading || adminLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900">
        <div className="flex items-center gap-3 text-gray-400">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span>Loading the admin dashboard...</span>
        </div>
      </div>
    );
  }

  // Auth guard: Show access denied if not admin
  if (!user || user.isAnonymous || !isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900">
        <div className="max-w-md w-full bg-gray-800 border border-gray-700 rounded-lg p-8 text-center">
          <Shield className="w-16 h-16 text-yellow-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Access Denied</h2>
          <p className="text-gray-400 mb-6">
            {!user || user.isAnonymous
              ? 'You must be signed in with a verified account to access the admin panel.'
              : 'You do not have administrator privileges.'}
          </p>
          {(!user || user.isAnonymous) && (
            <p className="text-sm text-gray-500">
              Please sign in with Google using an authorized admin account.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 p-6">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div className="border-b border-gray-800 pb-6">
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Database className="w-8 h-8 text-yellow-500" />
            Card Database Admin
          </h1>
          <p className="text-gray-500 mt-2">
            Monitor and manage the card database sync system
          </p>
          {user?.email && (
            <p className="text-sm text-gray-400 mt-1">Signed in as {user.email}</p>
          )}
        </div>

        {/* Error Alert */}
        {error && (
          <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 flex items-start gap-3">
            <XCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-red-400">Error</p>
              <p className="text-sm text-red-300 mt-1">{error}</p>
            </div>
          </div>
        )}

        {/* Status Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

          {/* Sync Status */}
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Sync Status</h2>
              {metadata?.syncStatus === 'healthy' ? (
                <CheckCircle className="w-5 h-5 text-green-500" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-yellow-500" />
              )}
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Status:</span>
                <span className={metadata?.syncStatus === 'healthy' ? 'text-green-400' : 'text-yellow-400'}>
                  {metadata?.syncStatus || 'Unknown'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Last Sync:</span>
                <span>{formatTimestamp(metadata?.lastFullSync)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Duration:</span>
                <span>{formatDuration(metadata?.lastDuration)}</span>
              </div>
            </div>
          </div>

          {/* Card Statistics */}
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Statistics</h2>
              <Database className="w-5 h-5 text-blue-500" />
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Total Cards:</span>
                <span className="font-mono">{metadata?.totalCards || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Sets Synced:</span>
                <span className="font-mono">
                  {metadata?.setVersions ? Object.keys(metadata.setVersions).length : 0}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Last Updated:</span>
                <span className="font-mono">{metadata?.updatedSets || 0} sets</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Actions</h2>
            <div className="space-y-3">
              <button
                onClick={handleManualSync}
                disabled={syncing}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors"
              >
                {syncing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    Manual Sync
                  </>
                )}
              </button>
              <button
                onClick={loadDashboardData}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg font-medium transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh Data
              </button>
            </div>
          </div>
        </div>

        {/* Set Versions */}
        {metadata?.setVersions && (
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Set Versions</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Object.entries(metadata.setVersions).map(([setCode, version]) => (
                <div key={setCode} className="bg-gray-900 rounded-lg p-3 border border-gray-700">
                  <div className="text-xs text-gray-500 uppercase">{setCode}</div>
                  <div className="text-sm font-mono text-gray-300 mt-1">{version}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sync Logs */}
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Recent Sync Logs</h2>
            <Clock className="w-5 h-5 text-gray-500" />
          </div>

          {syncLogs.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No sync logs found</p>
          ) : (
            <div className="space-y-3">
              {syncLogs.map((log) => (
                <div key={log.id} className="bg-gray-900 rounded-lg p-4 border border-gray-700">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {log.status === 'success' ? (
                        <CheckCircle className="w-4 h-4 text-green-500" />
                      ) : log.status === 'failed' ? (
                        <XCircle className="w-4 h-4 text-red-500" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-yellow-500" />
                      )}
                      <span className="font-medium capitalize">{log.status}</span>
                    </div>
                    <span className="text-xs text-gray-500">
                      {new Date(log.timestamp).toLocaleString()}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mt-3">
                    <div>
                      <div className="text-gray-500 text-xs">Sets</div>
                      <div className="font-mono">{log.sets?.length || 0}</div>
                    </div>
                    <div>
                      <div className="text-gray-500 text-xs">Cards</div>
                      <div className="font-mono">{log.cardCount || 0}</div>
                    </div>
                    <div>
                      <div className="text-gray-500 text-xs">Duration</div>
                      <div className="font-mono">{formatDuration(log.duration)}</div>
                    </div>
                    <div>
                      <div className="text-gray-500 text-xs">Updates</div>
                      <div className="font-mono">{log.changes?.updated || 0}</div>
                    </div>
                  </div>

                  {log.errors && log.errors.length > 0 && (
                    <div className="mt-3 text-xs text-red-400">
                      {log.errors.length} error(s) - See console
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
