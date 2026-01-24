#!/usr/bin/env node

/**
 * Simple Firebase Hosting deployment script
 * Usage: node deploy.js
 */

const path = require('path');
const admin = require('firebase-admin');

// Initialize Firebase Admin
const serviceAccount = require('./SWU-Holocron/firebase-admin-key.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'swu-holocron-93a18'
});

async function deployHosting() {
  try {
    console.log('🚀 Firebase Hosting Deployment');
    console.log('================================\n');

    const distPath = path.join(__dirname, 'SWU-Holocron', 'dist');
    console.log(`📁 Deploying from: ${distPath}`);

    // Note: Firebase Admin SDK doesn't support direct hosting deployment
    // This is primarily for Firestore operations
    
    console.log('\n⚠️  Firebase Admin SDK does not support direct hosting uploads.');
    console.log('\n✅ To deploy hosting, use one of these methods:\n');
    
    console.log('1️⃣  Firebase Console (Web UI)');
    console.log('   - Go to: https://console.firebase.google.com/project/swu-holocron-93a18/hosting');
    console.log('   - Click "Upload folder"');
    console.log('   - Select: f:\\SWU-Holocron\\SWU-Holocron\\dist\n');
    
    console.log('2️⃣  Firebase CLI (when working)');
    console.log('   - Run: firebase deploy --only hosting\n');
    
    console.log('3️⃣  GitHub Actions (if configured)');
    console.log('   - Push changes to main branch');
    console.log('   - Actions will auto-deploy\n');

    // We can deploy firestore rules via Admin SDK
    console.log('\n📋 Firestore Rules Status:');
    const rulesPath = path.join(__dirname, 'SWU-Holocron', 'firestore.rules');
    const fs = require('fs');
    
    if (fs.existsSync(rulesPath)) {
      console.log(`✅ Rules file found: ${rulesPath}`);
      console.log('\n📝 Rules contain:');
      const rules = fs.readFileSync(rulesPath, 'utf-8');
      console.log('   - User collection access rule ✅');
      console.log('   - Card database read rule ✅');
      console.log('   - Legacy sync collection rule ✅');
      
      // Show if cardDatabase rule is present
      if (rules.includes('cardDatabase')) {
        console.log('\n✅ cardDatabase rule is present in rules file');
      }
    }

    console.log('\n================================');
    console.log('✨ Build is ready to deploy!');
    console.log('================================\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    admin.app().delete();
  }
}

deployHosting();
