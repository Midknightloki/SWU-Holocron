/**
 * Curated Starter Shells and Modular Packets for Guided Mode.
 *
 * Provides ready-to-play, format-legal 50-card starter shells and modular 6-8 card
 * packets for the Guided Deck Builder. These serve as built-in content for new
 * users, offline play, and fallback data when Firestore collections are empty.
 */

export const DEFAULT_SHELLS = [
  {
    id: 'default-vader-command',
    name: 'Darth Vader — Imperial Might',
    description: 'Relentless Imperial assault combining overwhelming ground presence with high-impact space superiority.',
    leaderId: 'SOR_010', // Darth Vader, Dark Lord of the Sith
    baseId: 'SOR_023',   // Command Center (30 HP, Command)
    cards: {
      SOR_128: 3, // Death Star Stormtrooper
      SOR_226: 3, // Admiral Motti
      SOR_129: 1, // Admiral Ozzel
      SOR_079: 1, // Admiral Piett
      SOR_130: 2, // First Legion Snowtrooper
      SOR_227: 2, // Snowtrooper Lieutenant
      SOR_228: 2, // Viper Probe Droid
      SOR_229: 3, // Cell Block Guard
      SOR_230: 1, // General Veers
      SOR_083: 3, // Superlaser Technician
      SOR_084: 3, // Grand Moff Tarkin (Unit)
      SOR_232: 2, // AT-ST
      SOR_088: 1, // Blizzard Assault AT-AT
      SOR_135: 1, // Emperor Palpatine (Unit)
      SOR_225: 2, // TIE/ln Fighter
      SOR_132: 3, // Imperial Interceptor
      SOR_231: 1, // TIE Advanced
      SOR_086: 1, // Gladiator Star Destroyer
      SOR_089: 1, // Relentless
      SOR_123: 1, // Recruit
      SOR_139: 1, // Force Choke
      SOR_233: 3, // I Am Your Father
      SOR_172: 3, // Open Fire
      SOR_126: 1, // Resupply
      SOR_234: 1, // Maximum Firepower
      SOR_092: 1, // Overwhelming Barrage
      SOR_136: 3, // Vader's Lightsaber
    },
    isDefault: true,
  },
  {
    id: 'default-luke-cunning',
    name: 'Luke Skywalker — Heroic Defense',
    description: 'Defensive Rebel synergy using sentinels, Force upgrades, and cunning combat tricks to outlast opponents.',
    leaderId: 'SOR_005', // Luke Skywalker, Faithful Friend
    baseId: 'SOR_029',   // Administrator's Tower (30 HP, Cunning)
    cards: {
      SOR_059: 1, // 2-1B Surgical Droid
      SOR_236: 3, // R2-D2
      SOR_238: 3, // C-3P0
      SOR_239: 1, // Rebel Pathfinder
      SOR_189: 3, // Leia Organa (Unit)
      SOR_240: 3, // Fleet Lieutenant
      SOR_045: 1, // Yoda
      SOR_063: 1, // Cloud City Wing Guard
      SOR_194: 1, // Rogue Operative
      SOR_046: 3, // Consular Security Force
      SOR_242: 1, // General Dodonna
      SOR_244: 1, // Snowspeeder
      SOR_196: 1, // Chewbacca (Unit)
      SOR_048: 1, // Vigilant Honor Guards
      SOR_049: 1, // Obi-Wan Kenobi
      SOR_198: 1, // Han Solo (Unit)
      SOR_237: 3, // Alliance X-Wing
      SOR_044: 2, // Restored ARC-170
      SOR_241: 1, // Wing Leader
      SOR_066: 1, // System Patrol Craft
      SOR_195: 1, // Auzituck Liberator Gunship
      SOR_217: 1, // Shoot First
      SOR_074: 2, // Repair
      SOR_218: 2, // Asteroid Sanctuary
      SOR_220: 2, // Surprise Strike
      SOR_222: 2, // Waylay
      SOR_078: 3, // Vanquish
      SOR_069: 1, // Resilient
      SOR_053: 3, // Luke's Lightsaber
    },
    isDefault: true,
  },
  {
    id: 'default-sabine-aggro',
    name: 'Sabine Wren — Rebel Rush',
    description: 'Fast-paced Aggression archetype leveraging Energy Conversion Lab and low-curve Rebels for relentless pressure.',
    leaderId: 'SOR_014', // Sabine Wren, Galvanized Revolutionary
    baseId: 'SOR_022',   // Energy Conversion Lab (25 HP, Command)
    cards: {
      SOR_140: 3, // SpecForce Soldier
      SOR_156: 3, // Benthic "Two Tubes"
      SOR_095: 3, // Battlefield Marine
      SOR_142: 3, // Sabine Wren (Unit)
      SOR_141: 3, // Green Squadron A-Wing
      SOR_143: 3, // Fighters For Freedom
      SOR_240: 3, // Fleet Lieutenant
      SOR_144: 3, // Red Three
      SOR_162: 3, // Disabling Fang Fighter
      SOR_241: 3, // Wing Leader
      SOR_098: 3, // Echo Base Defender
      SOR_145: 3, // K-2SO
      SOR_116: 3, // Steadfast Battalion
      SOR_146: 2, // Zeb Orrelios
      SOR_103: 3, // Rebel Assault
      SOR_152: 3, // For a Cause I Believe In
      SOR_172: 3, // Open Fire
    },
    isDefault: true,
  },
];

export const DEFAULT_PACKETS = [
  {
    id: 'packet-imperial-troopers',
    name: 'Imperial Trooper Swarm',
    role: 'Aggression',
    description: 'Low-cost Imperial troopers boosted by officer buffs to flood ground combat.',
    cards: {
      SOR_229: 2, // Cell Block Guard
      SOR_227: 3, // Snowtrooper Lieutenant
      SOR_230: 2, // General Veers
    },
    isDefault: true,
  },
  {
    id: 'packet-heavy-removal',
    name: 'Heavy Removal',
    role: 'Removal',
    description: 'Direct damage and targeted takedown events to clear threats.',
    cards: {
      SOR_172: 3, // Open Fire
      SOR_139: 2, // Force Choke
      SOR_234: 2, // Maximum Firepower
    },
    isDefault: true,
  },
  {
    id: 'packet-resource-ramp',
    name: 'Resource Ramp',
    role: 'Ramp',
    description: 'Accelerate your resource pool early to deploy boss monsters ahead of tempo.',
    cards: {
      SOR_083: 3, // Superlaser Technician
      SOR_126: 3, // Resupply
      SOR_107: 2, // Command
    },
    isDefault: true,
  },
  {
    id: 'packet-rebel-fleet',
    name: 'Rebel Fleet Support',
    role: 'Utility',
    description: 'Fast Rebel starfighters and squadron attack buffs in the space arena.',
    cards: {
      SOR_141: 3, // Green Squadron A-Wing
      SOR_144: 2, // Red Three
      SOR_241: 3, // Wing Leader
    },
    isDefault: true,
  },
  {
    id: 'packet-defensive-line',
    name: 'Defensive Line',
    role: 'Control',
    description: 'Stalwart Sentinel units that intercept attacker combat to protect your base.',
    cards: {
      SOR_098: 3, // Echo Base Defender
      SOR_063: 2, // Cloud City Wing Guard
      SOR_048: 2, // Vigilant Honor Guards
    },
    isDefault: true,
  },
];
