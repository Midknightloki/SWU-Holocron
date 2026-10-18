/**
 * Admin Script: Seed Guided Mode Starter Content
 *
 * Populates Firestore artifacts/{APP_ID}/shells and artifacts/{APP_ID}/packets
 * with curated default shells and modular packets.
 *
 * Usage:
 *   node scripts/seedGuidedMode.js
 */

import { initFirestore } from './firebaseAdmin.js';
import { DEFAULT_SHELLS, DEFAULT_PACKETS } from '../src/data/defaultGuidedContent.js';
import { APP_ID as FIREBASE_APP_ID } from '../src/firebase.js';

const APP_ID = FIREBASE_APP_ID;

async function seedGuidedContent() {
  console.log('--- Seeding Guided Mode Starter Content ---');
  const db = await initFirestore();

  const shellsRef = db.collection('artifacts').doc(APP_ID).collection('shells');
  const packetsRef = db.collection('artifacts').doc(APP_ID).collection('packets');

  let seededShells = 0;
  for (const shell of DEFAULT_SHELLS) {
    const docRef = shellsRef.doc(shell.id);
    const snap = await docRef.get();
    if (!snap.exists) {
      await docRef.set({
        name: shell.name,
        description: shell.description,
        leaderId: shell.leaderId,
        baseId: shell.baseId,
        cards: shell.cards,
        createdBy: 'system-seed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      console.log(`✓ Seeded shell: ${shell.name} (${shell.id})`);
      seededShells++;
    } else {
      console.log(`- Shell already exists: ${shell.name} (${shell.id})`);
    }
  }

  let seededPackets = 0;
  for (const packet of DEFAULT_PACKETS) {
    const docRef = packetsRef.doc(packet.id);
    const snap = await docRef.get();
    if (!snap.exists) {
      await docRef.set({
        name: packet.name,
        description: packet.description,
        role: packet.role,
        cards: packet.cards,
        createdBy: 'system-seed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      console.log(`✓ Seeded packet: ${packet.name} (${packet.id})`);
      seededPackets++;
    } else {
      console.log(`- Packet already exists: ${packet.name} (${packet.id})`);
    }
  }

  console.log(`Done! Seeded ${seededShells} shells and ${seededPackets} packets.`);
}

seedGuidedContent().catch((err) => {
  console.error('Failed to seed guided content:', err);
  process.exit(1);
});
