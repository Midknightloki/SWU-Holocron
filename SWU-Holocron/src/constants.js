import AggressionIcon from './assets/aspects/Aggression.svg?react';
import CommandIcon from './assets/aspects/Command.svg?react';
import CunningIcon from './assets/aspects/Cunning.svg?react';
import HeroismIcon from './assets/aspects/Heroism.svg?react';
import NeutralIcon from './assets/aspects/Neutral.svg?react';
import VigilanceIcon from './assets/aspects/Vigilence.svg?react';
import VillainyIcon from './assets/aspects/Villany.svg?react';

// Raw URLs so we can render the native SVG colors without inheriting currentColor
import AggressionIconUrl from './assets/aspects/Aggression.svg?url';
import CommandIconUrl from './assets/aspects/Command.svg?url';
import CunningIconUrl from './assets/aspects/Cunning.svg?url';
import HeroismIconUrl from './assets/aspects/Heroism.svg?url';
import NeutralIconUrl from './assets/aspects/Neutral.svg?url';
import VigilanceIconUrl from './assets/aspects/Vigilence.svg?url';
import VillainyIconUrl from './assets/aspects/Villany.svg?url';

export const API_BASE = 'https://api.swu-db.com';

export const SETS = [
  { code: 'SOR', name: 'Spark of Rebellion' },
  { code: 'SHD', name: 'Shadows of the Galaxy' },
  { code: 'TWI', name: 'Twilight of the Republic' },
  { code: 'JTL', name: 'Jump to Lightspeed' },
  { code: 'LOF', name: 'Legends of the Force' },
  { code: 'SEC', name: 'Secrets of Power' },
  { code: 'ALT', name: 'A Lawless Time' },
  { code: 'PROMO', name: 'Promotional Cards' },
];

export const ASPECTS = [
  { name: 'Aggression', icon: AggressionIcon, iconUrl: AggressionIconUrl, hexColor: '#ef4444', textColor: '#ffffff', color: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500/30' },
  { name: 'Vigilance', icon: VigilanceIcon, iconUrl: VigilanceIconUrl, hexColor: '#3b82f6', textColor: '#ffffff', color: 'text-blue-500', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
  { name: 'Command', icon: CommandIcon, iconUrl: CommandIconUrl, hexColor: '#22c55e', textColor: '#ffffff', color: 'text-green-500', bg: 'bg-green-500/10', border: 'border-green-500/30' },
  { name: 'Cunning', icon: CunningIcon, iconUrl: CunningIconUrl, hexColor: '#eab308', textColor: '#000000', color: 'text-yellow-500', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30' },
  { name: 'Heroism', icon: HeroismIcon, iconUrl: HeroismIconUrl, hexColor: '#ffffff', textColor: '#000000', color: 'text-white', bg: 'bg-white/10', border: 'border-white/30' },
  { name: 'Villainy', icon: VillainyIcon, iconUrl: VillainyIconUrl, hexColor: '#09090b', textColor: '#ffffff', color: 'text-zinc-950', bg: 'bg-zinc-200', border: 'border-zinc-400' },
  { name: 'Neutral', icon: NeutralIcon, iconUrl: NeutralIconUrl, hexColor: '#7e7e7c', textColor: '#ffffff', color: 'text-gray-500', bg: 'bg-gray-500/10', border: 'border-gray-500/30' },
];

export const FALLBACK_DATA = [
  { Number: "001", Name: "Director Krennic", Subtitle: "Aspiring to Authority", Type: "Leader", Aspects: ["Villainy", "Vigilance"], Cost: null, Rarity: "Rare" },
  { Number: "002", Name: "Iden Versio", Subtitle: "Inferno Squad Commander", Type: "Leader", Aspects: ["Villainy", "Vigilance"], Cost: null, Rarity: "Common" },
  { Number: "003", Name: "Chewbacca", Subtitle: "Walking Carpet", Type: "Unit", Aspects: ["Heroism", "Vigilance"], Cost: 9, Power: 6, HP: 9, Rarity: "Uncommon" },
];
