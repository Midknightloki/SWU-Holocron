/**
 * Test fixture data for SWU Holocron
 * @environment:test
 */

export const mockCards = [
  {
    Set: 'SOR',
    Number: '001',
    Name: 'Director Krennic',
    Subtitle: 'Aspiring to Authority',
    Type: 'Leader',
    Aspects: ['Villainy', 'Vigilance'],
    Cost: null,
    HP: null,
    Power: null,
    Rarity: 'Rare',
    FrontText: 'Action: If you control 7 or more resources, deal 7 damage to a unit.',
    BackText: 'Deploy. When Played: Draw 2 cards.',
    EpicAction: 'Epic Action: If you control 7 or more resources, deal 7 damage divided as you choose among enemy units.'
  },
  {
    Set: 'SOR',
    Number: '002',
    Name: 'Iden Versio',
    Subtitle: 'Inferno Squad Commander',
    Type: 'Leader',
    Aspects: ['Villainy', 'Vigilance'],
    Cost: null,
    HP: null,
    Power: null,
    Rarity: 'Common',
    FrontText: 'Action: Ready a Villainy unit. It gets +1/+0 for this phase.',
    BackText: 'Deploy. Ambush.',
    EpicAction: 'Epic Action: Ready up to 3 Villainy units. They each get +2/+0 for this phase.'
  },
  {
    Set: 'SOR',
    Number: '003',
    Name: 'Chewbacca',
    Subtitle: 'Walking Carpet',
    Type: 'Unit',
    Aspects: ['Heroism', 'Vigilance'],
    Cost: 9,
    HP: 9,
    Power: 6,
    Rarity: 'Uncommon',
    FrontText: 'Overwhelm. When Defeated: You may deal damage equal to this unit\'s remaining HP to a unit.'
  },
  {
    Set: 'SOR',
    Number: '004',
    Name: 'Luke Skywalker',
    Subtitle: 'Faithful Friend',
    Type: 'Unit',
    Aspects: ['Heroism', 'Vigilance'],
    Cost: 6,
    HP: 5,
    Power: 5,
    Rarity: 'Rare',
    FrontText: 'When Played: You may attach a [Vigilance] upgrade from your hand or discard pile to this unit.',
    Traits: ['FORCE', 'REBEL', 'JEDI']
  },
  {
    Set: 'SOR',
    Number: '005',
    Name: 'Darth Vader',
    Subtitle: 'Dark Lord of the Sith',
    Type: 'Unit',
    Aspects: ['Villainy', 'Aggression'],
    Cost: 8,
    HP: 7,
    Power: 7,
    Rarity: 'Legendary',
    FrontText: 'Overwhelm. When Played: Deal 1 damage to a unit for each resource you control.',
    Traits: ['FORCE', 'IMPERIAL', 'SITH']
  },
  {
    Set: 'SHD',
    Number: '001',
    Name: 'Boba Fett',
    Subtitle: 'Collecting the Bounty',
    Type: 'Leader',
    Aspects: ['Villainy', 'Cunning'],
    Cost: null,
    HP: null,
    Power: null,
    Rarity: 'Rare',
    FrontText: 'Action: Exhaust a resource to deal 1 damage to a unit.',
    BackText: 'Ambush. Bounty: When this unit defeats a unit, you may play a unit that costs 3 or less from your hand for free.',
    EpicAction: 'Epic Action: Exhaust any number of resources. Deal 1 damage to a unit for each resource exhausted this way.'
  }
];

export const mockCollectionData = {
  'SOR_001_std': { quantity: 1, set: 'SOR', number: '001', name: 'Director Krennic', isFoil: false, timestamp: Date.now() },
  'SOR_001_foil': { quantity: 1, set: 'SOR', number: '001', name: 'Director Krennic', isFoil: true, timestamp: Date.now() },
  'SOR_003_std': { quantity: 3, set: 'SOR', number: '003', name: 'Chewbacca', isFoil: false, timestamp: Date.now() },
  'SOR_004_std': { quantity: 2, set: 'SOR', number: '004', name: 'Luke Skywalker', isFoil: false, timestamp: Date.now() },
  'SOR_005_foil': { quantity: 1, set: 'SOR', number: '005', name: 'Darth Vader', isFoil: true, timestamp: Date.now() }
};

export const mockCSVValid = `Name,Set,Number,Quantity
"Director Krennic",SOR,001,1
"Chewbacca",SOR,003,3
"Luke Skywalker",SOR,004,2`;

export const mockCSVWithFoil = `Card Name,Set,Collector Number,Count,Foil
"Director Krennic",SOR,001,1,
"Chewbacca",SOR,003,2,
"Chewbacca",SOR,003,1,Foil
"Darth Vader",SOR,005,1,Foil`;

export const mockCSVMalformed = `Name,Set
"Director Krennic",SOR
"Missing Number"`;

export const mockCSVWithSpecialChars = `Name,Set,Number,Quantity
"Han Solo, \"Scoundrel\"",SOR,010,1
"Leia, Princess of Alderaan",SOR,011,2
"Card with, Commas",SOR,012,1`;

export const generateLargeCardSet = (count = 100) => {
  return Array.from({ length: count }, (_, i) => ({
    Set: 'SOR',
    Number: String(i + 1).padStart(3, '0'),
    Name: `Test Card ${i + 1}`,
    Subtitle: i % 3 === 0 ? `Subtitle ${i + 1}` : undefined,
    Type: i % 5 === 0 ? 'Leader' : 'Unit',
    Aspects: ['Heroism'],
    Cost: (i % 10) + 1,
    HP: (i % 8) + 2,
    Power: (i % 6) + 2,
    Rarity: ['Common', 'Uncommon', 'Rare', 'Legendary'][i % 4]
  }));
};
