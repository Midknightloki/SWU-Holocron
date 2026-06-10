import React, { useState, useEffect, useCallback } from 'react';
import {
  Database, RefreshCw, Clock, CheckCircle, XCircle, AlertTriangle,
  Shield, Plus, Trash2, Edit2, Package, Wand2, Users, Save, X, Mail
} from 'lucide-react';
import { db, APP_ID } from '../firebase';
import { collection, doc, getDoc, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { GuidedModeService } from '../services/GuidedModeService';
import { CardService } from '../services/CardService';

const PACKET_ROLES = ['Ramp', 'Removal', 'Draw', 'Aggression', 'Control', 'Combo', 'Utility', 'Tech'];

// ─── Shell Editor ──────────────────────────────────────────────────────────────
function ShellEditor({ shell, allCards, cardDataMap, onSave, onCancel }) {
  const [name, setName] = useState(shell?.name || '');
  const [description, setDescription] = useState(shell?.description || '');
  const [leaderId, setLeaderId] = useState(shell?.leaderId || '');
  const [baseId, setBaseId] = useState(shell?.baseId || '');
  const [cards, setCards] = useState(shell?.cards || {});
  const [cardSearch, setCardSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const leaders = allCards.filter(c => c.Type === 'Leader');
  const bases = allCards.filter(c => c.Type === 'Base');
  const nonLeaderBase = allCards.filter(c => c.Type !== 'Leader' && c.Type !== 'Base');

  const filteredCards = cardSearch.trim()
    ? nonLeaderBase.filter(c => c.Name?.toLowerCase().includes(cardSearch.toLowerCase())).slice(0, 30)
    : [];

  const totalCards = Object.values(cards).reduce((s, c) => s + c, 0);

  const handleAddCard = (card) => {
    const id = `${card.Set}_${card.Number}`;
    setCards(prev => ({ ...prev, [id]: Math.min((prev[id] || 0) + 1, 3) }));
  };

  const handleSetCount = (cardId, count) => {
    if (count <= 0) {
      setCards(prev => { const n = { ...prev }; delete n[cardId]; return n; });
    } else {
      setCards(prev => ({ ...prev, [cardId]: count }));
    }
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({ name, description, leaderId, baseId, cards });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 space-y-4">
      <h3 className="text-lg font-bold text-white">{shell ? 'Edit Shell' : 'New Shell'}</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-gray-400 mb-1">Name *</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-yellow-500"
            placeholder="Shell name"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-400 mb-1">Description</label>
          <input
            value={description}
            onChange={e => setDescription(e.target.value)}
            className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-yellow-500"
            placeholder="Brief description"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-400 mb-1">Leader</label>
          <select
            value={leaderId}
            onChange={e => setLeaderId(e.target.value)}
            className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-yellow-500"
          >
            <option value="">-- Select Leader --</option>
            {leaders.map(c => {
              const id = `${c.Set}_${c.Number}`;
              return <option key={id} value={id}>{c.Name}</option>;
            })}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-400 mb-1">Base</label>
          <select
            value={baseId}
            onChange={e => setBaseId(e.target.value)}
            className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-yellow-500"
          >
            <option value="">-- Select Base --</option>
            {bases.map(c => {
              const id = `${c.Set}_${c.Number}`;
              return <option key={id} value={id}>{c.Name}</option>;
            })}
          </select>
        </div>
      </div>

      {/* Card picker */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-semibold text-gray-400">Main Deck Cards ({totalCards}/50)</label>
        </div>
        <input
          value={cardSearch}
          onChange={e => setCardSearch(e.target.value)}
          placeholder="Search cards to add..."
          className="w-full px-3 py-2 mb-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-yellow-500"
        />
        {filteredCards.length > 0 && (
          <div className="max-h-40 overflow-auto bg-gray-900 border border-gray-700 rounded-lg mb-2">
            {filteredCards.map(c => {
              const id = `${c.Set}_${c.Number}`;
              return (
                <button
                  key={id}
                  onClick={() => handleAddCard(c)}
                  className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 flex items-center justify-between"
                >
                  <span>{c.Name}</span>
                  <span className="text-xs text-gray-500">{c.Type} · {id}</span>
                </button>
              );
            })}
          </div>
        )}
        {Object.keys(cards).length > 0 && (
          <div className="max-h-52 overflow-auto space-y-1">
            {Object.entries(cards).map(([cardId, count]) => {
              const card = cardDataMap[cardId];
              return (
                <div key={cardId} className="flex items-center gap-2 bg-gray-900 px-3 py-1.5 rounded border border-gray-700">
                  <span className="flex-1 text-sm text-gray-300 truncate">{card?.Name || cardId}</span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => handleSetCount(cardId, count - 1)} className="w-7 h-7 bg-gray-700 hover:bg-gray-600 rounded text-white text-xs">-</button>
                    <span className="w-6 text-center text-white text-sm">{count}</span>
                    <button onClick={() => handleSetCount(cardId, count + 1)} className="w-7 h-7 bg-gray-700 hover:bg-gray-600 rounded text-white text-xs">+</button>
                    <button onClick={() => handleSetCount(cardId, 0)} className="w-7 h-7 bg-red-500/20 hover:bg-red-500/30 rounded text-red-400 text-xs ml-1"><X size={12} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex gap-3 justify-end">
        <button onClick={onCancel} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm" style={{ minHeight: '44px' }}>Cancel</button>
        <button
          onClick={handleSave}
          disabled={!name.trim() || saving}
          className="flex items-center gap-2 px-4 py-2 bg-yellow-500 hover:bg-yellow-600 disabled:bg-gray-700 disabled:text-gray-500 text-black font-bold rounded-lg text-sm"
          style={{ minHeight: '44px' }}
        >
          {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
          Save Shell
        </button>
      </div>
    </div>
  );
}

// ─── Packet Editor ─────────────────────────────────────────────────────────────
function PacketEditor({ packet, allCards, cardDataMap, onSave, onCancel }) {
  const [name, setName] = useState(packet?.name || '');
  const [description, setDescription] = useState(packet?.description || '');
  const [role, setRole] = useState(packet?.role || '');
  const [cards, setCards] = useState(packet?.cards || {});
  const [cardSearch, setCardSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const nonLeaderBase = allCards.filter(c => c.Type !== 'Leader' && c.Type !== 'Base');
  const filteredCards = cardSearch.trim()
    ? nonLeaderBase.filter(c => c.Name?.toLowerCase().includes(cardSearch.toLowerCase())).slice(0, 30)
    : [];

  const totalCards = Object.values(cards).reduce((s, c) => s + c, 0);

  const handleAddCard = (card) => {
    const id = `${card.Set}_${card.Number}`;
    setCards(prev => ({ ...prev, [id]: Math.min((prev[id] || 0) + 1, 3) }));
  };

  const handleSetCount = (cardId, count) => {
    if (count <= 0) {
      setCards(prev => { const n = { ...prev }; delete n[cardId]; return n; });
    } else {
      setCards(prev => ({ ...prev, [cardId]: count }));
    }
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({ name, description, role, cards });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 space-y-4">
      <h3 className="text-lg font-bold text-white">{packet ? 'Edit Packet' : 'New Packet'}</h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-semibold text-gray-400 mb-1">Name *</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-yellow-500"
            placeholder="Packet name"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-400 mb-1">Role</label>
          <select
            value={role}
            onChange={e => setRole(e.target.value)}
            className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-yellow-500"
          >
            <option value="">-- Select Role --</option>
            {PACKET_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-400 mb-1">Description</label>
          <input
            value={description}
            onChange={e => setDescription(e.target.value)}
            className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-yellow-500"
            placeholder="Brief description"
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-semibold text-gray-400">Cards ({totalCards} / 6–8 recommended)</label>
        </div>
        <input
          value={cardSearch}
          onChange={e => setCardSearch(e.target.value)}
          placeholder="Search cards to add..."
          className="w-full px-3 py-2 mb-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-yellow-500"
        />
        {filteredCards.length > 0 && (
          <div className="max-h-40 overflow-auto bg-gray-900 border border-gray-700 rounded-lg mb-2">
            {filteredCards.map(c => {
              const id = `${c.Set}_${c.Number}`;
              return (
                <button
                  key={id}
                  onClick={() => handleAddCard(c)}
                  className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 flex items-center justify-between"
                >
                  <span>{c.Name}</span>
                  <span className="text-xs text-gray-500">{c.Type} · Cost {c.Cost ?? '?'}</span>
                </button>
              );
            })}
          </div>
        )}
        {Object.keys(cards).length > 0 && (
          <div className="max-h-52 overflow-auto space-y-1">
            {Object.entries(cards).map(([cardId, count]) => {
              const card = cardDataMap[cardId];
              return (
                <div key={cardId} className="flex items-center gap-2 bg-gray-900 px-3 py-1.5 rounded border border-gray-700">
                  <span className="flex-1 text-sm text-gray-300 truncate">{card?.Name || cardId}</span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => handleSetCount(cardId, count - 1)} className="w-7 h-7 bg-gray-700 hover:bg-gray-600 rounded text-white text-xs">-</button>
                    <span className="w-6 text-center text-white text-sm">{count}</span>
                    <button onClick={() => handleSetCount(cardId, count + 1)} className="w-7 h-7 bg-gray-700 hover:bg-gray-600 rounded text-white text-xs">+</button>
                    <button onClick={() => handleSetCount(cardId, 0)} className="w-7 h-7 bg-red-500/20 hover:bg-red-500/30 rounded text-red-400 text-xs ml-1"><X size={12} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex gap-3 justify-end">
        <button onClick={onCancel} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm" style={{ minHeight: '44px' }}>Cancel</button>
        <button
          onClick={handleSave}
          disabled={!name.trim() || saving}
          className="flex items-center gap-2 px-4 py-2 bg-yellow-500 hover:bg-yellow-600 disabled:bg-gray-700 disabled:text-gray-500 text-black font-bold rounded-lg text-sm"
          style={{ minHeight: '44px' }}
        >
          {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
          Save Packet
        </button>
      </div>
    </div>
  );
}

// ─── Main AdminPanel ───────────────────────────────────────────────────────────
export default function AdminPanel() {
  const { user, isAdmin, isContributor, adminLoading } = useAuth();
  const canEdit = isAdmin || isContributor;

  const [activeTab, setActiveTab] = useState('database');
  const [metadata, setMetadata] = useState(null);
  const [syncLogs, setSyncLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [syncing, setSyncing] = useState(false);

  // Shells state
  const [shells, setShells] = useState([]);
  const [shellsLoading, setShellsLoading] = useState(false);
  const [editingShell, setEditingShell] = useState(null); // null | {} | shell obj
  const [allCards, setAllCards] = useState([]);
  const [cardDataMap, setCardDataMap] = useState({});

  // Packets state
  const [packets, setPackets] = useState([]);
  const [packetsLoading, setPacketsLoading] = useState(false);
  const [editingPacket, setEditingPacket] = useState(null);

  // Contributors state
  const [invites, setInvites] = useState([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [inviteSaving, setInviteSaving] = useState(false);
  const [invitesLoading, setInvitesLoading] = useState(false);

  useEffect(() => {
    loadDashboardData();
  }, []);

  // Load card database when switching to shells/packets tabs
  useEffect(() => {
    if ((activeTab === 'shells' || activeTab === 'packets') && allCards.length === 0) {
      loadCardDatabase();
    }
    if (activeTab === 'shells' && shells.length === 0) loadShells();
    if (activeTab === 'packets' && packets.length === 0) loadPackets();
    if (activeTab === 'contributors' && invites.length === 0) loadInvites();
  }, [activeTab]);

  const loadCardDatabase = async () => {
    try {
      const sets = await CardService.getAvailableSets();
      const setsToLoad = sets.length > 0 ? sets : ['SOR', 'SHD', 'TWI', 'UIQ'];
      const cardMap = {};
      const list = [];
      for (const set of setsToLoad) {
        try {
          const { data } = await CardService.fetchSetData(set);
          data.forEach(card => {
            const id = `${card.Set}_${card.Number}`;
            cardMap[id] = card;
            list.push(card);
          });
        } catch {}
      }
      setCardDataMap(cardMap);
      setAllCards(list);
    } catch (err) {
      console.error('Failed to load card database:', err);
    }
  };

  const loadShells = async () => {
    setShellsLoading(true);
    try {
      setShells(await GuidedModeService.getShells());
    } finally {
      setShellsLoading(false);
    }
  };

  const loadPackets = async () => {
    setPacketsLoading(true);
    try {
      setPackets(await GuidedModeService.getPackets());
    } finally {
      setPacketsLoading(false);
    }
  };

  const loadInvites = async () => {
    setInvitesLoading(true);
    try {
      setInvites(await GuidedModeService.getInvites());
    } finally {
      setInvitesLoading(false);
    }
  };

  const loadDashboardData = async () => {
    setLoading(true);
    setError(null);
    try {
      const metadataRef = doc(db, 'artifacts', APP_ID, 'public', 'data', 'cardDatabase', 'metadata');
      const metadataSnap = await getDoc(metadataRef);
      if (metadataSnap.exists()) setMetadata(metadataSnap.data());

      const logsRef = collection(db, 'artifacts', APP_ID, 'admin', 'sync', 'logs');
      const logsQuery = query(logsRef, orderBy('timestamp', 'desc'), limit(10));
      const logsSnap = await getDocs(logsQuery);
      setSyncLogs(logsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveShell = async (data) => {
    if (editingShell?.id) {
      await GuidedModeService.updateShell(editingShell.id, data);
    } else {
      await GuidedModeService.createShell(user.uid, data);
    }
    setEditingShell(null);
    await loadShells();
  };

  const handleDeleteShell = async (shellId) => {
    if (!window.confirm('Delete this shell?')) return;
    await GuidedModeService.deleteShell(shellId);
    await loadShells();
  };

  const handleSavePacket = async (data) => {
    if (editingPacket?.id) {
      await GuidedModeService.updatePacket(editingPacket.id, data);
    } else {
      await GuidedModeService.createPacket(user.uid, data);
    }
    setEditingPacket(null);
    await loadPackets();
  };

  const handleDeletePacket = async (packetId) => {
    if (!window.confirm('Delete this packet?')) return;
    await GuidedModeService.deletePacket(packetId);
    await loadPackets();
  };

  const handleSendInvite = async () => {
    setInviteError('');
    if (!inviteEmail.trim() || !inviteEmail.includes('@')) {
      setInviteError('Enter a valid email address.');
      return;
    }
    setInviteSaving(true);
    try {
      await GuidedModeService.createInvite(user.uid, inviteEmail);
      setInviteEmail('');
      await loadInvites();
    } catch (err) {
      setInviteError(err.message);
    } finally {
      setInviteSaving(false);
    }
  };

  const handleDeleteInvite = async (inviteId) => {
    await GuidedModeService.deleteInvite(inviteId);
    await loadInvites();
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    const diff = Date.now() - timestamp;
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
          <span>Loading admin dashboard...</span>
        </div>
      </div>
    );
  }

  if (!user || user.isAnonymous || (!isAdmin && !isContributor)) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900">
        <div className="max-w-md w-full bg-gray-800 border border-gray-700 rounded-lg p-8 text-center">
          <Shield className="w-16 h-16 text-yellow-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Access Denied</h2>
          <p className="text-gray-400 mb-6">
            {!user || user.isAnonymous
              ? 'You must be signed in with a verified account.'
              : 'You do not have admin or contributor privileges.'}
          </p>
        </div>
      </div>
    );
  }

  const tabs = [
    ...(isAdmin ? [{ id: 'database', label: 'Card Database', icon: Database }] : []),
    { id: 'shells', label: 'Shells', icon: Wand2 },
    { id: 'packets', label: 'Packets', icon: Package },
    ...(isAdmin ? [{ id: 'contributors', label: 'Contributors', icon: Users }] : []),
  ];

  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 p-6">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div className="border-b border-gray-800 pb-6">
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Shield className="w-8 h-8 text-yellow-500" />
            Admin Panel
          </h1>
          <p className="text-gray-500 mt-1">
            {isAdmin ? 'Full admin access' : 'Contributor access — manage shells and packets'}
          </p>
          {user?.email && <p className="text-sm text-gray-400 mt-1">Signed in as {user.email}</p>}
        </div>

        {error && (
          <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 flex items-start gap-3">
            <XCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <p className="text-red-300 text-sm">{error}</p>
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-gray-800 rounded-xl p-1 border border-gray-700 w-fit">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                activeTab === id ? 'bg-yellow-500 text-black' : 'text-gray-400 hover:text-white'
              }`}
              style={{ minHeight: '40px' }}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>

        {/* ── Card Database Tab ── */}
        {activeTab === 'database' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold">Sync Status</h2>
                  {metadata?.syncStatus === 'healthy' ? <CheckCircle className="w-5 h-5 text-green-500" /> : <AlertTriangle className="w-5 h-5 text-yellow-500" />}
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-gray-400">Status:</span><span className={metadata?.syncStatus === 'healthy' ? 'text-green-400' : 'text-yellow-400'}>{metadata?.syncStatus || 'Unknown'}</span></div>
                  <div className="flex justify-between"><span className="text-gray-400">Last Sync:</span><span>{formatTimestamp(metadata?.lastFullSync)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-400">Duration:</span><span>{formatDuration(metadata?.lastDuration)}</span></div>
                </div>
              </div>
              <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold">Statistics</h2>
                  <Database className="w-5 h-5 text-blue-500" />
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-gray-400">Total Cards:</span><span className="font-mono">{metadata?.totalCards || 0}</span></div>
                  <div className="flex justify-between"><span className="text-gray-400">Sets Synced:</span><span className="font-mono">{metadata?.setVersions ? Object.keys(metadata.setVersions).length : 0}</span></div>
                </div>
              </div>
              <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
                <h2 className="text-lg font-semibold mb-4">Actions</h2>
                <div className="space-y-3">
                  <button
                    onClick={() => alert('Run: node scripts/seedCardDatabase.js')}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-500 text-white rounded-lg font-medium transition-colors"
                    style={{ minHeight: '44px' }}
                  >
                    <RefreshCw className="w-4 h-4" />
                    Manual Sync (server-side)
                  </button>
                  <button onClick={loadDashboardData} className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg font-medium transition-colors" style={{ minHeight: '44px' }}>
                    <RefreshCw className="w-4 h-4" />
                    Refresh Data
                  </button>
                </div>
              </div>
            </div>

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

            <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Recent Sync Logs</h2>
                <Clock className="w-5 h-5 text-gray-500" />
              </div>
              {syncLogs.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No sync logs found</p>
              ) : (
                <div className="space-y-3">
                  {syncLogs.map(log => (
                    <div key={log.id} className="bg-gray-900 rounded-lg p-4 border border-gray-700">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {log.status === 'success' ? <CheckCircle className="w-4 h-4 text-green-500" /> : log.status === 'failed' ? <XCircle className="w-4 h-4 text-red-500" /> : <AlertTriangle className="w-4 h-4 text-yellow-500" />}
                          <span className="font-medium capitalize">{log.status}</span>
                        </div>
                        <span className="text-xs text-gray-500">{new Date(log.timestamp).toLocaleString()}</span>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mt-3">
                        <div><div className="text-gray-500 text-xs">Sets</div><div className="font-mono">{log.sets?.length || 0}</div></div>
                        <div><div className="text-gray-500 text-xs">Cards</div><div className="font-mono">{log.cardCount || 0}</div></div>
                        <div><div className="text-gray-500 text-xs">Duration</div><div className="font-mono">{formatDuration(log.duration)}</div></div>
                        <div><div className="text-gray-500 text-xs">Updates</div><div className="font-mono">{log.changes?.updated || 0}</div></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Shells Tab ── */}
        {activeTab === 'shells' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-white flex items-center gap-2"><Wand2 size={20} className="text-green-400" /> Shells ({shells.length})</h2>
              {canEdit && !editingShell && (
                <button
                  onClick={() => setEditingShell({})}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 text-white font-semibold rounded-lg text-sm"
                  style={{ minHeight: '44px' }}
                >
                  <Plus size={16} /> New Shell
                </button>
              )}
            </div>

            {editingShell !== null && (
              <ShellEditor
                shell={editingShell?.id ? editingShell : null}
                allCards={allCards}
                cardDataMap={cardDataMap}
                onSave={handleSaveShell}
                onCancel={() => setEditingShell(null)}
              />
            )}

            {shellsLoading ? (
              <div className="flex justify-center py-12"><RefreshCw size={24} className="animate-spin text-gray-400" /></div>
            ) : shells.length === 0 ? (
              <div className="text-center py-12 text-gray-500">No shells yet. Create one to enable Guided Start for players.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {shells.map(shell => {
                  const leader = cardDataMap[shell.leaderId];
                  const cardCount = Object.values(shell.cards || {}).reduce((s, c) => s + c, 0);
                  return (
                    <div key={shell.id} className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-white font-bold">{shell.name}</p>
                          {shell.description && <p className="text-gray-400 text-xs mt-1">{shell.description}</p>}
                        </div>
                        {canEdit && (
                          <div className="flex gap-1 shrink-0">
                            <button onClick={() => setEditingShell(shell)} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-700 rounded"><Edit2 size={14} /></button>
                            <button onClick={() => handleDeleteShell(shell.id)} className="w-8 h-8 flex items-center justify-center text-red-400 hover:bg-red-500/20 rounded"><Trash2 size={14} /></button>
                          </div>
                        )}
                      </div>
                      {leader && <span className="text-xs px-2 py-0.5 bg-yellow-500/10 text-yellow-400 rounded">{leader.Name}</span>}
                      <p className="text-xs text-gray-500">{cardCount} main deck cards</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Packets Tab ── */}
        {activeTab === 'packets' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-white flex items-center gap-2"><Package size={20} className="text-blue-400" /> Packets ({packets.length})</h2>
              {canEdit && !editingPacket && (
                <button
                  onClick={() => setEditingPacket({})}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg text-sm"
                  style={{ minHeight: '44px' }}
                >
                  <Plus size={16} /> New Packet
                </button>
              )}
            </div>

            {editingPacket !== null && (
              <PacketEditor
                packet={editingPacket?.id ? editingPacket : null}
                allCards={allCards}
                cardDataMap={cardDataMap}
                onSave={handleSavePacket}
                onCancel={() => setEditingPacket(null)}
              />
            )}

            {packetsLoading ? (
              <div className="flex justify-center py-12"><RefreshCw size={24} className="animate-spin text-gray-400" /></div>
            ) : packets.length === 0 ? (
              <div className="text-center py-12 text-gray-500">No packets yet. Create modular card groups to offer players.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {packets.map(packet => {
                  const cardCount = Object.values(packet.cards || {}).reduce((s, c) => s + c, 0);
                  return (
                    <div key={packet.id} className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-white font-bold">{packet.name}</p>
                          {packet.role && <span className="text-xs px-2 py-0.5 bg-blue-500/10 text-blue-400 rounded mt-1 inline-block">{packet.role}</span>}
                          {packet.description && <p className="text-gray-400 text-xs mt-1">{packet.description}</p>}
                        </div>
                        {canEdit && (
                          <div className="flex gap-1 shrink-0">
                            <button onClick={() => setEditingPacket(packet)} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-700 rounded"><Edit2 size={14} /></button>
                            <button onClick={() => handleDeletePacket(packet.id)} className="w-8 h-8 flex items-center justify-center text-red-400 hover:bg-red-500/20 rounded"><Trash2 size={14} /></button>
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-gray-500">{cardCount} cards</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Contributors Tab (admin only) ── */}
        {activeTab === 'contributors' && isAdmin && (
          <div className="space-y-6">
            <h2 className="text-xl font-bold text-white flex items-center gap-2"><Users size={20} className="text-purple-400" /> Contributor Invites</h2>
            <p className="text-gray-400 text-sm">
              Invite a user by email. When they next log in with that email address, they will automatically receive contributor access to manage shells and packets.
            </p>

            <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 space-y-4">
              <h3 className="text-base font-semibold text-white flex items-center gap-2"><Mail size={16} /> Send Invite</h3>
              <div className="flex gap-3">
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={e => { setInviteEmail(e.target.value); setInviteError(''); }}
                  placeholder="contributor@example.com"
                  className="flex-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-purple-500"
                  style={{ minHeight: '44px' }}
                />
                <button
                  onClick={handleSendInvite}
                  disabled={inviteSaving}
                  className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 text-white font-bold rounded-lg text-sm"
                  style={{ minHeight: '44px' }}
                >
                  {inviteSaving ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />}
                  Invite
                </button>
              </div>
              {inviteError && <p className="text-red-400 text-sm">{inviteError}</p>}
            </div>

            <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
              <h3 className="text-base font-semibold text-white mb-4">Pending Invites</h3>
              {invitesLoading ? (
                <div className="flex justify-center py-8"><RefreshCw size={20} className="animate-spin text-gray-400" /></div>
              ) : invites.length === 0 ? (
                <p className="text-gray-500 text-center py-6">No pending invites.</p>
              ) : (
                <div className="space-y-2">
                  {invites.map(invite => (
                    <div key={invite.id} className="flex items-center justify-between bg-gray-900 px-4 py-3 rounded-lg border border-gray-700">
                      <div>
                        <p className="text-white text-sm font-medium">{invite.email}</p>
                        {invite.createdAt && (
                          <p className="text-gray-500 text-xs mt-0.5">Invited {new Date(invite.createdAt?.toDate?.() || invite.createdAt).toLocaleDateString()}</p>
                        )}
                      </div>
                      <button
                        onClick={() => handleDeleteInvite(invite.id)}
                        className="w-8 h-8 flex items-center justify-center text-red-400 hover:bg-red-500/20 rounded"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
