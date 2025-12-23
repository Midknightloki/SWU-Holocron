# Firebase Setup Guide - Complete Walkthrough

**Time Required**: 15-20 minutes  
**Cost**: 100% Free (using Spark Plan)

This guide assumes you've never used Firebase before. We'll set up everything step by step.

---

## What is Firebase?

Firebase is Google's platform that provides:
- **Hosting**: Serves your website with free HTTPS
- **Firestore**: Cloud database for storing card data
- **Authentication**: User login/signup system

Think of it as your app's backend, all managed by Google.

---

## Part 1: Create Firebase Project (5 minutes)

### Step 1: Go to Firebase Console
1. Open your browser and go to: **https://console.firebase.google.com**
2. Click **"Sign in with Google"** (use any Google account)
3. Accept the terms if prompted

### Step 2: Create New Project
1. Click the **"Add project"** button (big plus icon)
2. **Project name**: Enter `SWU-Holocron` (or any name you like)
3. Click **"Continue"**
4. **Google Analytics**: Toggle OFF (you don't need this for now)
5. Click **"Create project"**
6. Wait 30 seconds while Firebase sets up your project
7. Click **"Continue"** when it says "Your new project is ready"

✅ **Checkpoint**: You should now see your Firebase project dashboard

---

## Part 2: Set Up Firestore Database (3 minutes)

### Step 3: Enable Firestore
1. In the left sidebar, click **"Build"** → **"Firestore Database"**
2. Click the **"Create database"** button
3. **Location**: Choose closest to you (e.g., `us-east1` for East Coast US)
   - ⚠️ **Can't change later**, but doesn't matter much for this app
4. Click **"Next"**
5. **Security rules**: Choose **"Start in test mode"** for now
   - We'll secure it later
6. Click **"Enable"**
7. Wait 20 seconds while database is created

✅ **Checkpoint**: You should see an empty database with "Start collection" button

### Step 4: Set Up Database Structure (Optional - script will do this)
Your database will be automatically populated when we run the seed script later. For now, it's empty - that's fine!

---

## Part 3: Set Up Authentication (2 minutes)

### Step 5: Enable Email/Password Auth
1. In the left sidebar, click **"Build"** → **"Authentication"**
2. Click the **"Get started"** button
3. Click on **"Email/Password"** in the list of providers
4. Toggle **"Email/Password"** to **Enabled** (should turn blue)
5. Leave "Email link (passwordless sign-in)" OFF
6. Click **"Save"**

✅ **Checkpoint**: Email/Password should show "Enabled" status

---

## Part 4: Set Up Hosting (2 minutes)

### Step 6: Enable Firebase Hosting
1. In the left sidebar, click **"Build"** → **"Hosting"**
2. Click the **"Get started"** button
3. You'll see 3 steps shown - **ignore them** (we'll do this via CLI)
4. Just click the X or back button to close the dialog

✅ **Checkpoint**: Hosting is now enabled (even though we haven't deployed yet)

---

## Part 5: Get Your Firebase Config (3 minutes)

### Step 7: Register Web App
1. On the Firebase project homepage (click "Project Overview" at top of sidebar)
2. Look for **"Get started by adding Firebase to your app"**
3. Click the **`</>`** icon (Web app icon)
4. **App nickname**: Enter `SWU Holocron Web`
5. **Firebase Hosting**: Check this box ✓
6. Click **"Register app"**

### Step 8: Copy Your Config
You'll see a code snippet like this:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSyB...",
  authDomain: "swu-holocron-xxxxx.firebaseapp.com",
  projectId: "swu-holocron-xxxxx",
  storageBucket: "swu-holocron-xxxxx.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:xxxxx"
};
```

**Copy everything inside the `firebaseConfig = { ... }` braces**

✅ **Checkpoint**: You have your config copied to clipboard

---

## Part 6: Configure Your App (3 minutes)

### Step 9: Update firebase.js
1. In VS Code, open **`src/firebase.js`**
2. Find this section (lines 5-12):
   ```javascript
   const firebaseConfig = {
     apiKey: "YOUR_API_KEY",
     authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
     projectId: "YOUR_PROJECT_ID",
     storageBucket: "YOUR_PROJECT_ID.appspot.com",
     messagingSenderId: "YOUR_SENDER_ID",
     appId: "YOUR_APP_ID"
   };
   ```
3. **Replace the entire `firebaseConfig` object** with what you copied from Firebase Console
4. Save the file (Ctrl+S)

✅ **Checkpoint**: Your app can now connect to Firebase

---

## Part 7: Install Firebase CLI (2 minutes)

### Step 10: Install Firebase Tools
Open PowerShell in VS Code and run:

```powershell
npm install -g firebase-tools
```

Wait for it to finish (30 seconds).

### Step 11: Login to Firebase
```powershell
firebase login
```

This will:
1. Open your browser
2. Ask you to sign in to Google (use same account as Firebase Console)
3. Ask for permissions - click **"Allow"**
4. Show "Success" message

✅ **Checkpoint**: Terminal should show "✔ Success! Logged in as your-email@gmail.com"

---

## Part 8: Initialize Firebase in Your Project (3 minutes)

### Step 12: Initialize Firebase
In your project folder (`C:\Projects\SWU-Holocron`), run:

```powershell
firebase init
```

You'll see a series of prompts. Answer exactly like this:

#### Prompt 1: "Which Firebase features?"
- Use arrow keys to move
- Press **Space** to select (mark with ◉):
  - [x] **Firestore** (press Space)
  - [x] **Hosting** (press Space)
- Press **Enter** to continue

#### Prompt 2: "Use an existing project"
- Choose **"Use an existing project"**
- Press **Enter**

#### Prompt 3: "Select a project"
- Choose your project (e.g., `swu-holocron-xxxxx`)
- Press **Enter**

#### Prompt 4: "Firestore rules file?"
- Press **Enter** (accept default: `firestore.rules`)

#### Prompt 5: "Firestore indexes file?"
- Press **Enter** (accept default: `firestore.indexes.json`)

#### Prompt 6: "Public directory?"
- Type: `dist`
- Press **Enter**

#### Prompt 7: "Configure as single-page app?"
- Type: `y` (yes)
- Press **Enter**

#### Prompt 8: "Set up automatic builds with GitHub?"
- Type: `N` (no - we'll deploy manually for now)
- Press **Enter**

#### Prompt 9: "File dist/index.html already exists. Overwrite?"
- Type: `N` (no - keep our file!)
- Press **Enter**

✅ **Checkpoint**: You should see "✔ Firebase initialization complete!"

---

## Part 9: Deploy Your App (2 minutes)

### Step 13: Build Your App
```powershell
npm run build
```

This creates the `dist/` folder with your optimized app (30 seconds).

### Step 14: Deploy to Firebase
```powershell
firebase deploy
```

This uploads your app to Firebase hosting (30-60 seconds).

When finished, you'll see:

```
✔ Deploy complete!

Hosting URL: https://swu-holocron-xxxxx.web.app
```

### Step 15: Visit Your Live App!
1. Copy the URL from the terminal
2. Open it in your browser
3. 🎉 **Your app is live on the internet!**

✅ **Checkpoint**: Your app is deployed and accessible from any device!

---

## Part 10: Set Up Background Sync (5 minutes)

This allows your app to automatically update the card database daily.

### Step 16: Create Service Account
1. Go back to Firebase Console
2. Click the **⚙️ gear icon** (top left) → **"Project settings"**
3. Click the **"Service accounts"** tab
4. Click **"Generate new private key"** button
5. Click **"Generate key"** in the dialog
6. A JSON file downloads - **save it somewhere safe**
7. Rename the file to: `firebase-admin-key.json`

⚠️ **IMPORTANT**: This file is like a password - never commit it to Git!

### Step 17: Add Service Account to GitHub
1. Go to your GitHub repository
2. Click **"Settings"** (top right)
3. In left sidebar: **"Secrets and variables"** → **"Actions"**
4. Click **"New repository secret"** button
5. **Name**: `FIREBASE_SERVICE_ACCOUNT`
6. **Value**: Open `firebase-admin-key.json` in notepad, copy ALL the content, paste it
7. Click **"Add secret"**

✅ **Checkpoint**: GitHub can now sync cards to your database

### Step 18: Seed Initial Card Data
Run this to populate your database with Star Wars Unlimited cards:

```powershell
npm run admin:seed-cards
```

This will:
- Fetch all cards from swu-db.com API
- Save them to your Firestore database
- Take 1-2 minutes depending on card count

✅ **Checkpoint**: Your database now has all card data!

---

## Part 11: Verify Everything Works

### Test 1: Check Database
1. Go to Firebase Console → Firestore Database
2. You should see collections: `cardDatabase`, `users`, etc.
3. Click into `cardDatabase/sets` - you should see card sets like `SOR`, `SHD`

### Test 2: Test Authentication
1. Visit your deployed app URL
2. Click "Sign Up" or "Login"
3. Create an account with email/password
4. Go back to Firebase Console → Authentication
5. You should see your user listed!

### Test 3: Test PWA Installation
1. On mobile, visit your app URL
2. You should see "Install SWU Holocron" banner
3. Tap it - app installs to home screen!
4. Launch from home screen - runs like native app!

---

## Troubleshooting

### "Firebase not configured" warning in console
- Check `src/firebase.js` - make sure you replaced the placeholder config with your real config from Firebase Console

### `firebase deploy` fails with "no project"
- Run: `firebase use swu-holocron-xxxxx` (use your project ID)
- Then try deploy again

### `npm run admin:seed-cards` fails
- Make sure you created `firebase-admin-key.json` and placed it in project root
- Check the file has proper JSON format (open in VS Code)

### App deployed but shows blank page
- Check browser console for errors
- Make sure `dist/` folder exists and has files
- Try: `npm run build` then `firebase deploy` again

### Database empty after seed script
- Check Firebase Console → Firestore → Rules
- Make sure rules allow write (test mode = allows all)
- Run seed script again: `npm run admin:seed-cards`

---

## Security (Do This Before Going Public!)

### Step 19: Secure Firestore Rules
1. Firebase Console → Firestore → Rules
2. Replace with these rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Card database - read-only for all, write only for admins
    match /cardDatabase/{document=**} {
      allow read: if true;
      allow write: if false; // Only GitHub Actions can write
    }
    
    // User collections - only owner can read/write
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

3. Click **"Publish"**

✅ Now your database is secure!

---

## Summary - What You Set Up

✅ **Firebase Project**: Your app's home on Google's servers  
✅ **Firestore Database**: Stores card data and user collections  
✅ **Authentication**: Handles user login/signup  
✅ **Hosting**: Serves your app with free HTTPS  
✅ **Service Account**: Allows GitHub Actions to sync cards daily  
✅ **PWA**: Makes your app installable on phones/tablets  

---

## Daily Workflow

Now that setup is complete, your daily workflow is simple:

### To Deploy Changes:
```powershell
npm run build
firebase deploy
```

### To Update Cards:
Cards update automatically every day at 6 AM UTC via GitHub Actions.  
Or manually run: `npm run admin:seed-cards`

### To Check Logs:
- GitHub: Actions tab (for sync logs)
- Firebase Console: Firestore/Authentication tabs (for data)

---

## Costs

Everything is **100% FREE** with Firebase Spark Plan:
- **Hosting**: 10 GB/month bandwidth, 360 MB storage
- **Firestore**: 1 GB storage, 50K reads/day, 20K writes/day
- **Authentication**: Unlimited users

Your app will stay well under these limits. No credit card required!

---

## Next Steps

- ✅ Share your app URL with friends!
- ✅ Install on your phone's home screen
- ✅ Test offline mode (airplane mode)
- ✅ Star/favorite some cards
- ✅ Build your collection!

---

## Support

If you get stuck:
1. Check Firebase Console for error messages
2. Check browser DevTools → Console for errors
3. Check GitHub Actions tab for sync issues
4. See specific troubleshooting section above

**You're all set! Happy collecting! 🎉**
