SWU Holocron: React Native Migration Context

1. Project Overview

App Name: SWU Holocron

Purpose: A virtual binder and collection tracker for the "Star Wars Unlimited" TCG.

Current State: A single-file React web application using Firebase for persistence and swu-db.com for card data.

Target: A full-featured React Native application (Android/iOS).

2. Core Architecture

The application relies on a "Seed and Store" data strategy (internally referred to as the "Holocron" pattern) to ensure stability and offline access.

Data Flow (Critical Logic)

Check Local Storage: The app first checks for cached JSON data on the device.

Check Cloud "Holocron": If local data is missing/stale, it checks a public Firestore path: /artifacts/{appId}/public/data/sets/{setCode}.

Concept: Users share a single "master copy" of the card database in the cloud to reduce API load.

Fetch API (Seeding): If the cloud is empty, the client fetches data from api.swu-db.com.

Current Web limitation: Uses CORS proxies (allorigins, corsproxy) to bypass browser restrictions.

React Native Opportunity: Direct fetch calls should be used. Native apps do not suffer from CORS, so the proxy logic can be stripped out entirely.

Persistence (User Data)

Authentication: Currently uses Firebase Anonymous Auth.

Sync Logic: Users identify via a "Sync Code" (a simple string key).

Data Path:

User Collection: /artifacts/{appId}/public/data/sync_{SYNC_CODE} (if Sync Code is used).

Private Fallback: /artifacts/{appId}/users/{uid}/collection (if Guest).

Note: The schema is a flat collection of documents where the ID is constructed as: ${SetCode}_${CardNumber}_${isFoil ? 'foil' : 'std'}.

3. Component Breakdown & Refactoring Strategy

The current App.jsx is a monolith. It should be refactored into the following React Native structure:

Screens

LandingScreen: The entry point. Handles "Sync Code" input or "Guest Mode" selection.

BinderScreen: The main grid view.

Native Tip: Use FlatList with numColumns instead of CSS Grid for performance.

DashboardScreen (Command Center): Stats, Charts, and Missing Cards list.

Native Tip: Ensure the table layout for "Missing Cards" is adapted for mobile widths (perhaps a list view instead of a table).

Components

CardModal: The detail view. Needs to be converted to a Modal or a separate Stack Navigation screen.

CardImage: Handles caching/loading states for images.

CollectionControls: The + / - counters and variant toggles.

4. Technical Debt & Platform Specifics

Remove CORS Proxies

The web app rotates through proxies (corsproxy.io, allorigins.win) to fetch data.

Action: Delete fetchWithTimeout proxy rotation strategies. Use standard fetch() or axios directly against api.swu-db.com.

File System (CSV Import/Export)

The web app uses an <input type="file"> and URL.createObjectURL for CSV handling.

Action: Replace with:

react-native-document-picker for importing.

react-native-fs or expo-file-system for saving exported files.

react-native-share for exporting the generated CSV.

Images

Currently uses standard <img> tags with onError fallbacks.

Action: Use react-native-fast-image for aggressive caching, as card images are heavy and static.

State Management

Currently uses huge useState hooks in the root component.

Recommendation: Move global state (User, Collection Data, Card Database) to a proper Context API or a lightweight store like Zustand to avoid prop drilling.

5. Data Models

Card Object (Frontend)

interface Card {
  Set: string;
  Number: string;
  Name: string;
  Subtitle: string;
  Type: string; // "Leader", "Unit", "Base", "Event"
  Aspects: string[];
  Cost: number;
  HP?: number;
  Power?: number;
  Rarity: string;
  FrontText?: string;
  BackText?: string; // For Leaders
  EpicAction?: string; // For Leaders
}


Collection Item (Firestore)

interface CollectionItem {
  set: string;
  number: string;
  name: string; // Stored for offline reconstruction
  quantity: number;
  isFoil: boolean;
  timestamp: number;
}


6. Migration Checklist

[ ] Initialize React Native (CLI or Expo).

[ ] Install react-native-firebase (Auth & Firestore).

[ ] Port CardService logic but strip proxy layers.

[ ] Rebuild Binder grid using FlatList.

[ ] Implement AsyncStorage for local caching of the "Holocron" (card database) to minimize Firestore reads.

[ ] Rewrite CSV parser to work with file streams/strings provided by the native document picker.