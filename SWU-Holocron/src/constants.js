import { Sword, Shield, Crown, Zap, Star, Skull, Info } from 'lucide-react';

export const API_BASE = 'https://api.swu-db.com';

export const SETS = [
  { code: 'ALL', name: 'All Sets' },
  { code: 'SOR', name: 'Spark of Rebellion' },
  { code: 'SHD', name: 'Shadows of the Galaxy' },
  { code: 'TWI', name: 'Twilight of the Republic' },
  { code: 'JTL', name: 'Jump to Lightspeed' },
  { code: 'LOF', name: 'Legends of the Force' },
  { code: 'SEC', name: 'Secrets of Power' },
  { code: 'ALT', name: 'A Lawless Time' },
];

export const ASPECTS = [
  { name: 'Aggression', icon: Sword, color: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500/30' },
  { name: 'Vigilance', icon: Shield, color: 'text-blue-500', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
  { name: 'Command', icon: Crown, color: 'text-green-500', bg: 'bg-green-500/10', border: 'border-green-500/30' },
  { name: 'Cunning', icon: Zap, color: 'text-yellow-500', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30' },
  { name: 'Heroism', icon: Star, color: 'text-white', bg: 'bg-white/10', border: 'border-white/30' },
  { name: 'Villainy', icon: Skull, color: 'text-zinc-950', bg: 'bg-zinc-200', border: 'border-zinc-400' },
];

export const FALLBACK_DATA = [
  { Number: "001", Name: "Director Krennic", Subtitle: "Aspiring to Authority", Type: "Leader", Aspects: ["Villainy", "Vigilance"], Cost: null, Rarity: "Rare" },
  { Number: "002", Name: "Iden Versio", Subtitle: "Inferno Squad Commander", Type: "Leader", Aspects: ["Villainy", "Vigilance"], Cost: null, Rarity: "Common" },
  { Number: "003", Name: "Chewbacca", Subtitle: "Walking Carpet", Type: "Unit", Aspects: ["Heroism", "Vigilance"], Cost: 9, Power: 6, HP: 9, Rarity: "Uncommon" },
];