/**
 * Pure data constants — no Vite-specific imports.
 * Safe to import from Node.js scripts (admin/seed/scrape) and from the browser app.
 *
 * UI-specific constants (ASPECTS with SVG icons) live in constants.js which
 * re-exports everything from here and adds the icon references.
 */

export const API_BASE = 'https://api.swu-db.com';

export const SETS = [
  // Fallback only. The live list comes from the set registry that
  // scripts/setDiscovery.js publishes (see CardService.getSetRegistry).
  // This array exists for a cold database, an offline first load, or a denied
  // read -- it cannot discover anything, so keep it short and let the registry
  // do the work.
  { code: 'SOR', name: 'Spark of Rebellion' },
  { code: 'SHD', name: 'Shadows of the Galaxy' },
  { code: 'TWI', name: 'Twilight of the Republic' },
  { code: 'JTL', name: 'Jump To Lightspeed' },
  { code: 'LOF', name: 'Legends of the Force' },
  { code: 'IBH', name: 'Intro Battle: Hoth' },
  { code: 'SEC', name: 'Secrets of Power' },
  { code: 'LAW', name: 'A Lawless Time' },
  { code: 'TS26', name: 'Twin Suns 2026' },
  { code: 'ASH', name: 'Ashes of the Empire' },
  { code: 'HMW', name: 'Homeworlds' },
  { code: 'IC27', name: 'Icons 2027' },
  // Legacy buckets: not real API sets, but existing collection documents are
  // keyed with them (PROMO_001_std), so they must keep resolving.
  { code: 'PROMO', name: 'Promotional Cards' },
  { code: 'OTHER', name: 'Other' },
];

export const FALLBACK_DATA = [
  { Number: "001", Name: "Director Krennic", Subtitle: "Aspiring to Authority", Type: "Leader", Aspects: ["Villainy", "Vigilance"], Cost: null, Rarity: "Rare" },
  { Number: "002", Name: "Iden Versio", Subtitle: "Inferno Squad Commander", Type: "Leader", Aspects: ["Villainy", "Vigilance"], Cost: null, Rarity: "Common" },
  { Number: "003", Name: "Chewbacca", Subtitle: "Walking Carpet", Type: "Unit", Aspects: ["Heroism", "Vigilance"], Cost: 9, Power: 6, HP: 9, Rarity: "Uncommon" },
];
