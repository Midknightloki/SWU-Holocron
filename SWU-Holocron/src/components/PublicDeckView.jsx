import React, { useState, useEffect } from 'react';
import { Loader2, AlertCircle, ExternalLink, Globe, Layers } from 'lucide-react';
import { DeckService } from '../services/DeckService';
import { CardService } from '../services/CardService';

const ASPECTS = ['Aggression', 'Command', 'Cunning', 'Heroism', 'Villainy', 'Vigilance'];

const ASPECT_COLORS = {
  Aggression: 'bg-red-700',
  Command:    'bg-green-700',
  Cunning:    'bg-yellow-600',
  Heroism:    'bg-blue-600',
  Villainy:   'bg-purple-700',
  Vigilance:  'bg-gray-600',
};

function injectOGTags({ title, description, imageUrl, url }) {
  const setMeta = (property, content) => {
    let el = document.querySelector(`meta[property="${property}"]`);
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute('property', property);
      document.head.appendChild(el);
    }
    el.setAttribute('content', content);
  };
  const setNameMeta = (name, content) => {
    let el = document.querySelector(`meta[name="${name}"]`);
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute('name', name);
      document.head.appendChild(el);
    }
    el.setAttribute('content', content);
  };

  document.title = title;
  setMeta('og:title', title);
  setMeta('og:description', description);
  setMeta('og:type', 'website');
  setMeta('og:url', url);
  if (imageUrl) setMeta('og:image', imageUrl);
  setNameMeta('twitter:card', 'summary_large_image');
  setNameMeta('twitter:title', title);
  setNameMeta('twitter:description', description);
  if (imageUrl) setNameMeta('twitter:image', imageUrl);
}

function groupCardsByType(cards) {
  const groups = {};
  for (const [cardId, count] of Object.entries(cards)) {
    const [set, number] = cardId.split('_');
    if (!set || !number) continue;
    const prefix = number.padStart ? number : number;
    const numInt = parseInt(number, 10);
    // Rough type grouping by number range (SWU convention)
    let group = 'Unit';
    if (numInt <= 10) group = 'Leader';
    else if (numInt <= 20) group = 'Base';
    // Just group everything else as 'Other'
    else group = 'Unit';
    if (!groups[group]) groups[group] = [];
    groups[group].push({ set, number, cardId, count });
  }
  return groups;
}

export default function PublicDeckView({ slug }) {
  const [deck, setDeck] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await DeckService.getPublicDeck(slug);
        if (cancelled) return;
        if (!data) {
          setNotFound(true);
        } else {
          setDeck(data);
          const leaderImage = data.leaderId
            ? (() => { const [s, n] = data.leaderId.split('_'); return s && n ? CardService.getCardImage(s, n) : null; })()
            : null;
          injectOGTags({
            title: `${data.name} — SWU Holocron`,
            description: data.description
              ? data.description
              : `A ${data.format || 'Premier'} deck with ${data.totalCards || 0} cards.`,
            imageUrl: leaderImage,
            url: window.location.href,
          });
        }
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <Loader2 size={40} className="text-yellow-500 animate-spin" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col items-center justify-center gap-4 px-4">
        <AlertCircle size={48} className="text-red-400" />
        <h1 className="text-2xl font-bold">Deck not found</h1>
        <p className="text-gray-400 text-center max-w-md">
          This share link is no longer valid. The owner may have revoked access.
        </p>
        <a
          href="/"
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-yellow-500 text-gray-950 font-semibold rounded-lg hover:bg-yellow-400 transition-colors"
        >
          <Layers size={16} />
          Go to SWU Holocron
        </a>
      </div>
    );
  }

  const leaderParts = deck.leaderId ? deck.leaderId.split('_') : null;
  const baseParts = deck.baseId ? deck.baseId.split('_') : null;
  const leaderImage = leaderParts ? CardService.getCardImage(leaderParts[0], leaderParts[1]) : null;
  const baseImage = baseParts ? CardService.getCardImage(baseParts[0], baseParts[1]) : null;

  const cardEntries = Object.entries(deck.cards || {}).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans">
      {/* Hero */}
      <div className="relative overflow-hidden">
        {leaderImage && (
          <img
            src={leaderImage}
            alt={deck.leaderId}
            className="absolute inset-0 w-full h-full object-cover opacity-20 blur-sm scale-105"
          />
        )}
        <div className="relative max-w-4xl mx-auto px-4 py-12">
          <div className="flex flex-col sm:flex-row gap-6 items-start">
            {/* Leader card */}
            {leaderImage && (
              <div className="shrink-0 w-40 rounded-xl overflow-hidden shadow-2xl border border-yellow-500/30">
                <img src={leaderImage} alt={deck.leaderId} className="w-full" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-yellow-500 text-xs font-semibold mb-2 uppercase tracking-widest">
                <Globe size={12} />
                Public Deck
              </div>
              <h1 className="text-3xl font-bold text-white mb-2 break-words">{deck.name}</h1>
              {deck.description && (
                <p className="text-gray-300 text-sm mb-3 line-clamp-3">{deck.description}</p>
              )}
              <div className="flex flex-wrap gap-2 mb-3">
                <span className="px-2 py-0.5 bg-gray-800 border border-gray-700 rounded-full text-xs text-gray-300">
                  {deck.format || 'Premier'}
                </span>
                <span className="px-2 py-0.5 bg-gray-800 border border-gray-700 rounded-full text-xs text-gray-300">
                  {deck.totalCards || 0} cards
                </span>
                {(deck.aspects || []).map((aspect) => (
                  <span
                    key={aspect}
                    className={`px-2 py-0.5 rounded-full text-xs text-white font-medium ${ASPECT_COLORS[aspect] || 'bg-gray-600'}`}
                  >
                    {aspect}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-4xl mx-auto px-4 pb-16">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {/* Base card */}
          {baseImage && (
            <div className="sm:col-span-1">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Base</h2>
              <div className="rounded-xl overflow-hidden border border-gray-700/50 shadow-lg">
                <img src={baseImage} alt={deck.baseId} className="w-full" />
              </div>
              <p className="text-xs text-gray-500 text-center mt-1">{deck.baseId}</p>
            </div>
          )}

          {/* Card list */}
          <div className={baseImage ? 'sm:col-span-2' : 'sm:col-span-3'}>
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Deck List ({deck.totalCards || 0} cards)
            </h2>
            <div className="space-y-1">
              {cardEntries.map(([cardId, count]) => {
                const [set, number] = cardId.split('_');
                return (
                  <div
                    key={cardId}
                    className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-gray-800/60 hover:bg-gray-800 transition-colors text-sm"
                  >
                    <span className="font-mono text-gray-200">
                      {set} {number}
                    </span>
                    <span className="text-yellow-400 font-semibold text-xs">
                      ×{count}
                    </span>
                  </div>
                );
              })}
              {cardEntries.length === 0 && (
                <p className="text-gray-500 text-sm">No cards in this deck.</p>
              )}
            </div>
          </div>
        </div>

        {/* Footer CTA */}
        <div className="mt-12 pt-8 border-t border-gray-800 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-gray-400">
            <Layers size={20} className="text-yellow-500" />
            <span className="text-sm">
              Shared via <span className="text-white font-semibold">SWU Holocron</span>
            </span>
          </div>
          <a
            href="/"
            className="inline-flex items-center gap-2 px-4 py-2 bg-yellow-500 text-gray-950 font-semibold rounded-lg hover:bg-yellow-400 transition-colors text-sm"
          >
            <ExternalLink size={14} />
            Build your own deck
          </a>
        </div>
      </div>
    </div>
  );
}
