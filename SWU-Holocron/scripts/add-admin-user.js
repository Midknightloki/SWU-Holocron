/**
 * Admin User Setup Utility
 *
 * Use this script to grant admin privileges to specific users.
 *
 * Usage:
 * 1. User must sign in to the app at least once
 * 2. Get their Firebase UID from the console or Firebase Auth panel
 * 3. Run this script: node scripts/add-admin-user.js <USER_UID>
 */

import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';

// Initialize Firebase Admin SDK
const serviceAccountPath = path.join(process.cwd(), 'firebase-admin-key.json');

if (!fs.existsSync(serviceAccountPath)) {
  console.error('❌ firebase-admin-key.json not found!');
  console.error('Download it from Firebase Console:');
  console.error('1. Go to Project Settings → Service Accounts');
  console.error('2. Click "Generate New Private Key"');
  console.error('3. Save as firebase-admin-key.json in project root');
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

// Allow explicit project override via --project <id> or env var
const projectFlagIndex = process.argv.indexOf('--project');
const cliProjectId = projectFlagIndex > -1 ? process.argv[projectFlagIndex + 1] : null;
const envProjectId = process.env.FIREBASE_ADMIN_PROJECT_ID || null;
const projectId = cliProjectId || envProjectId || serviceAccount.project_id;

console.log(`\n🛠 Using Firebase Admin Project: ${projectId}`);
console.log(`🔑 Service account: ${serviceAccount.client_email}`);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId
});

const db = admin.firestore();
const APP_ID = 'swu-holocron-v1';

/**
 * Grant admin privileges to a user
 */
async function addAdminUser(userId, email = null) {
  try {
    console.log(`\n🔐 Granting admin privileges to user: ${userId}`);

    // Verify user exists in Firebase Auth
    let userRecord;
    try {
      userRecord = await admin.auth().getUser(userId);
      console.log(`✅ User found: ${userRecord.email || 'Anonymous'}`);
    } catch (error) {
      console.error(`❌ User not found in project '${projectId}': ${userId}`);
      console.error('Make sure the user has signed in to the app at least once and that the service account\n  belongs to the SAME Firebase project used by the web app.');

      // Debug: list a few users to confirm we are hitting the expected project
      try {
        console.log('\n🔎 Listing up to 5 users in this project to help diagnose:');
        const list = await admin.auth().listUsers(5);
        if (list.users.length === 0) {
          console.log('  • No users found in this project.');
        } else {
          list.users.forEach((u, i) => {
            console.log(`  ${i + 1}. UID: ${u.uid} | Email: ${u.email || '—'} | Provider: ${(u.providerData[0]?.providerId) || '—'}`);
          });
        }
      } catch (e) {
        console.log('  (Could not list users:', e.message, ')');
      }

      console.log('\n✅ Tip: Verify the project IDs match:');
      console.log(`  • Service account project_id: ${serviceAccount.project_id}`);
      console.log('  • Frontend config projectId: check src/firebase.js');
      console.log('  • Or run: firebase use && firebase projects:list');
      process.exit(1);
    }

    // Create/update user profile in Firestore
    const profileRef = db.doc(`artifacts/${APP_ID}/users/${userId}/profile`);

    await profileRef.set({
      isAdmin: true,
      email: email || userRecord.email,
      grantedAt: admin.firestore.FieldValue.serverTimestamp(),
      grantedBy: 'admin-script'
    }, { merge: true });

    console.log('✅ Admin privileges granted successfully!');
    console.log(`\n📋 Profile created at: artifacts/${APP_ID}/users/${userId}/profile`);
    console.log('\n🎉 User can now access the admin panel after refreshing the app.');

  } catch (error) {
    console.error('❌ Error granting admin privileges:', error);
    process.exit(1);
  }
}

/**
 * Revoke admin privileges from a user
 */
async function removeAdminUser(userId) {
  try {
    console.log(`\n🔐 Revoking admin privileges from user: ${userId}`);

    const profileRef = db.doc(`artifacts/${APP_ID}/users/${userId}/profile`);

    await profileRef.update({
      isAdmin: false,
      revokedAt: admin.firestore.FieldValue.serverTimestamp(),
      revokedBy: 'admin-script'
    });

    console.log('✅ Admin privileges revoked successfully!');

  } catch (error) {
    console.error('❌ Error revoking admin privileges:', error);
    process.exit(1);
  }
}

/**
 * List all admin users
 */
async function listAdminUsers() {
  try {
    console.log('\n📋 Listing all admin users...\n');

    const usersRef = db.collectionGroup('profile');
    const snapshot = await usersRef.where('isAdmin', '==', true).get();

    const admins = [];

    for (const doc of snapshot.docs) {
      const profile = doc.data();
      const userId = doc.ref.parent.parent.id;
      if (profile?.isAdmin) {
        admins.push({
          uid: userId,
          email: profile.email,
          grantedAt: profile.grantedAt?.toDate()
        });
      }
    }

    if (admins.length === 0) {
      console.log('⚠️  No admin users found.');
    } else {
      console.log(`Found ${admins.length} admin user(s):\n`);
      admins.forEach(admin => {
        console.log(`  👤 ${admin.email}`);
        console.log(`     UID: ${admin.uid}`);
        console.log(`     Granted: ${admin.grantedAt || 'Unknown'}\n`);
      });
    }

  } catch (error) {
    console.error('❌ Error listing admin users:', error);
    process.exit(1);
  }
}

// CLI handling
const command = process.argv[2];
const userId = process.argv[3];
const email = process.argv[4];

if (!command) {
  console.log('Admin User Management Tool');
  console.log('==========================\n');
  console.log('Usage:');
  console.log('  node scripts/add-admin-user.js add <USER_UID> [EMAIL]');
  console.log('  node scripts/add-admin-user.js add-email <EMAIL>');
  console.log('  node scripts/add-admin-user.js remove <USER_UID>');
  console.log('  node scripts/add-admin-user.js list\n');
  console.log('Examples:');
  console.log('  node scripts/add-admin-user.js add abc123xyz user@example.com');
  console.log('  node scripts/add-admin-user.js add-email user@example.com');
  console.log('  node scripts/add-admin-user.js remove abc123xyz');
  console.log('  node scripts/add-admin-user.js list');
  process.exit(0);
}

switch (command) {
  case 'add':
    if (!userId) {
      console.error('❌ USER_UID is required');
      process.exit(1);
    }
    addAdminUser(userId, email).then(() => process.exit(0));
    break;

  case 'add-email':
    if (!userId) {
      console.error('❌ EMAIL is required');
      process.exit(1);
    }
    (async () => {
      try {
        console.log(`\n🔐 Resolving user by email: ${userId}`);
        const userRecord = await admin.auth().getUserByEmail(userId);
        await addAdminUser(userRecord.uid, userId);
        process.exit(0);
      } catch (e) {
        console.error(`❌ Could not find user by email '${userId}' in project '${projectId}':`, e.message);
        console.log('Ensure the user logged in with that email to this Firebase project.');
        process.exit(1);
      }
    })();
    break;

  case 'remove':
    if (!userId) {
      console.error('❌ USER_UID is required');
      process.exit(1);
    }
    removeAdminUser(userId).then(() => process.exit(0));
    break;

  case 'list':
    listAdminUsers().then(() => process.exit(0));
    break;

  default:
    console.error(`❌ Unknown command: ${command}`);
    console.log('Valid commands: add, add-email, remove, list');
    process.exit(1);
}
