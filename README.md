# 🌌 SWU Holocron

> A comprehensive collection management and deck building application for **Star Wars™: Unlimited**, the trading card game by Fantasy Flight Games.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![PWA](https://img.shields.io/badge/PWA-enabled-brightgreen.svg)](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps)
[![Firebase](https://img.shields.io/badge/Firebase-powered-orange.svg)](https://firebase.google.com/)

## 📖 Overview

SWU Holocron is an **offline-first Progressive Web App (PWA)** designed to help Star Wars: Unlimited players manage their card collections, track statistics, and build competitive decks. Built with modern web technologies, it offers a seamless experience across desktop and mobile devices with full offline support.

### ✨ Key Features

- **📊 Collection Management**
  - Track your complete card collection across all sets
  - View collection statistics (completion %, playsets, missing cards)
  - Import/Export collections via CSV (Moxfield & Archidekt compatible)
  - Visual card grid with binder and stats views

- **🔍 Advanced Search & Filtering**
  - Search by card name, text, or traits
  - Filter by aspect (Aggression, Cunning, Vigilance, Villainy, Heroism, Command)
  - Filter by card type (Unit, Event, Upgrade, Leader, Base)
  - Filter by rarity and set

- **☁️ Cloud Sync & Offline Support**
  - Firebase-powered real-time synchronization across devices
  - Full offline functionality with local caching
  - Optional sync codes for collection sharing
  - Guest mode for local-only usage

- **🗄️ Reliable Card Database**
  - Automated daily card database updates via GitHub Actions
  - Zero dependency on live external APIs during usage
  - Comprehensive admin panel for database management
  - Version tracking and sync monitoring

- **📱 Progressive Web App**
  - Install on any device (mobile, tablet, desktop)
  - Works offline after initial load
  - Native-like experience with app icons
  - Responsive design optimized for all screen sizes

- **🎯 Deck Building Tools** *(Coming Soon)*
  - Format validation (Premier, Twin Suns, Trilogy)
  - Deck statistics and mana curve analysis
  - Export to popular deck-sharing platforms

## 🚀 Quick Start

### For Users

**Web App:** Visit the deployed application (URL TBD)

**Install as PWA:**
1. Open the web app in your browser
2. Click the "Install" prompt or browser menu
3. Use as a native app with offline support

**Import Your Collection:**
1. Export your collection from Moxfield or Archidekt as CSV
2. Click the import button in SWU Holocron
3. Select your CSV file
4. Your collection is now tracked!

### For Developers

#### Prerequisites

- **Node.js 20+** - [Download](https://nodejs.org/)
- **npm** (comes with Node.js)
- **Git**
- **Firebase Account** (for deployment)

#### Installation

```bash
# Clone the repository
git clone https://github.com/Midknightloki/SWU-Holocron.git
cd SWU-Holocron
cd SWU-Holocron  # Navigate to the project directory

# Install dependencies
npm install

# Initialize Git hooks
npm run prepare

# Start development server
npm run dev
```

Visit `http://localhost:5173` to see the app running locally.

#### Firebase Setup

1. Create a Firebase project at [Firebase Console](https://console.firebase.google.com/)
2. Enable Authentication, Firestore Database, and Hosting
3. Copy your Firebase config to `src/firebase.js`
4. Update Firestore security rules (see `firestore.rules`)

For detailed setup instructions, see [README-SETUP.md](./SWU-Holocron/README-SETUP.md).

## 🛠️ Technology Stack

### Frontend
- **React 18** - Modern UI library with hooks
- **Vite** - Lightning-fast build tool
- **Tailwind CSS** - Utility-first CSS framework
- **Lucide React** - Beautiful icon library

### Backend & Services
- **Firebase Authentication** - Anonymous and user auth
- **Cloud Firestore** - Real-time NoSQL database
- **Firebase Hosting** - Fast, secure web hosting
- **Firebase Data Connect** - Type-safe database queries

### Development & Testing
- **Vitest** - Fast unit testing framework
- **Testing Library** - Component testing utilities
- **ESLint** - Code quality and consistency
- **Husky** - Git hooks for quality gates
- **Happy DOM** - Lightweight DOM for testing

### PWA & Offline
- **Vite Plugin PWA** - Service worker and manifest generation
- **Workbox** - Runtime caching strategies
- **LocalStorage** - Client-side data persistence

### CI/CD
- **GitHub Actions** - Automated testing and deployment
- **Codecov** - Test coverage reporting
- **Automated Card Sync** - Daily card database updates

## 📂 Project Structure

```
SWU-Holocron/
├── src/
│   ├── components/         # React components
│   │   ├── AdminPanel.jsx
│   │   ├── AdvancedSearch.jsx
│   │   ├── CardModal.jsx
│   │   ├── Dashboard.jsx
│   │   └── ...
│   ├── services/          # API and data services
│   │   └── CardService.js
│   ├── utils/             # Pure utility functions
│   │   ├── csvParser.js
│   │   ├── statsCalculator.js
│   │   └── collectionHelpers.js
│   ├── test/              # Test suite
│   │   ├── components/
│   │   ├── services/
│   │   └── utils/
│   ├── constants.js       # App constants (sets, aspects)
│   ├── firebase.js        # Firebase configuration
│   └── main.jsx           # Application entry point
├── docs/                  # Documentation
│   ├── CARD-DATABASE-ARCHITECTURE.md
│   ├── IMPLEMENTATION-SUMMARY.md
│   ├── PLATFORM-ARCHITECTURE-DECISION.md
│   └── ...
├── scripts/               # Admin and utility scripts
│   └── seedCardDatabase.js
├── .github/
│   └── workflows/         # CI/CD pipelines
│       ├── ci.yml
│       └── sync-cards.yml
├── package.json
├── vite.config.js
├── tailwind.config.js
└── README-SETUP.md        # Detailed setup guide
```

## 📚 Documentation

- **[README-SETUP.md](./SWU-Holocron/README-SETUP.md)** - Comprehensive setup and testing guide
- **[TESTING.md](./SWU-Holocron/TESTING.md)** - Testing infrastructure and best practices
- **[CARD-DATABASE-ARCHITECTURE.md](./SWU-Holocron/docs/CARD-DATABASE-ARCHITECTURE.md)** - Database design and sync system
- **[PLATFORM-ARCHITECTURE-DECISION.md](./SWU-Holocron/docs/PLATFORM-ARCHITECTURE-DECISION.md)** - Multi-platform strategy
- **[IMPLEMENTATION-SUMMARY.md](./SWU-Holocron/docs/IMPLEMENTATION-SUMMARY.md)** - Card database implementation details
- **[SWU-RULES-AND-FORMATS.md](./SWU-Holocron/docs/SWU-RULES-AND-FORMATS.md)** - Game rules reference

## 🧪 Testing

The project maintains **80%+ test coverage** with comprehensive unit, component, and integration tests.

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run unit tests only
npm run test:unit

# Run with coverage report
npm run test:ci

# Run linter
npm run lint
```

See [TESTING.md](./SWU-Holocron/TESTING.md) for detailed testing documentation.

## 🔧 Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server (localhost:5173) |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |
| `npm test` | Run tests in watch mode |
| `npm run test:unit` | Run unit tests only |
| `npm run test:ci` | Run full test suite with coverage |
| `npm run lint` | Check code style |
| `npm run admin:seed-cards` | Seed card database (admin) |
| `npm run admin:verify-db` | Verify database integrity (admin) |

## 🌟 Features in Detail

### Collection Management
Track every card you own with detailed quantity management:
- **Regular cards**: 0-3 copies (Premier format)
- **Foil variants**: Separate tracking
- **Playsets**: Automatic completion indicators
- **Statistics**: Real-time collection metrics

### CSV Import/Export
Seamlessly integrate with popular deck-building platforms:
- **Moxfield format** - Full compatibility
- **Archidekt format** - Full compatibility
- **Round-trip guarantee** - Export and re-import without data loss

### Offline-First Architecture
Designed to work without internet connectivity:
- **Initial sync** - Downloads card database on first visit
- **Local caching** - All data stored in browser
- **Background sync** - Updates when connection available
- **Conflict resolution** - Intelligent merge strategies

### Admin Dashboard
For administrators and power users:
- **Sync monitoring** - View database sync status
- **Manual triggers** - Force card database updates
- **Sync history** - Audit logs of all updates
- **Statistics** - Database health metrics

## 🚦 Development Workflow

### Local Development
1. Make changes to source files
2. Tests run automatically on save (watch mode)
3. Pre-commit hook validates code quality
4. Pre-push hook runs full unit test suite

### CI/CD Pipeline
1. **Lint Stage** - ESLint checks all files
2. **Unit Tests** - Fast component and utility tests
3. **Build Stage** - Verify production build succeeds
4. **Integration Tests** - Firebase and CSV integration
5. **Coverage Report** - Upload to Codecov

### Automated Card Sync
- Runs daily at 6 AM UTC via GitHub Actions
- Fetches latest card data from SWU-DB API
- Updates Firestore database with change detection
- Creates GitHub issues on failures
- Stores sync logs for audit trail

## 🤝 Contributing

Contributions are welcome! Please follow these guidelines:

1. **Fork the repository**
2. **Create a feature branch** (`git checkout -b feature/amazing-feature`)
3. **Write tests** for your changes (maintain 80%+ coverage)
4. **Run the test suite** (`npm run test:ci`)
5. **Commit your changes** (`git commit -m 'Add amazing feature'`)
6. **Push to the branch** (`git push origin feature/amazing-feature`)
7. **Open a Pull Request**

### Code Standards
- Follow existing code style (enforced by ESLint)
- Write descriptive commit messages
- Add tests for new features
- Update documentation as needed
- Keep changes focused and minimal

## 📝 Roadmap

### Current Version (v1.0)
- ✅ Collection management
- ✅ CSV import/export
- ✅ Cloud sync
- ✅ Offline support
- ✅ PWA installation
- ✅ Admin panel
- ✅ Automated card sync

### Upcoming Features
- 🔄 Deck builder with format validation
- 🔄 Advanced statistics and insights
- 🔄 Multi-language support
- 🔄 Card image caching
- 🔄 Community deck sharing
- 🔄 Mobile-optimized UI improvements

### Future Considerations
- 📋 Native mobile apps (React Native/Capacitor)
- 📋 Desktop applications (Electron)
- 📋 Tournament organizer tools
- 📋 Trade management system

## 🐛 Known Issues & Limitations

- **Image loading** - Card images load from external CDN (SWU-DB)
- **iOS Safari** - Limited PWA features (no push notifications)
- **Sync delay** - Card database updates propagate within 24 hours
- **Storage limits** - Browser storage quotas apply (typically 50MB+)

Report bugs via [GitHub Issues](https://github.com/Midknightloki/SWU-Holocron/issues).

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## ⚠️ Disclaimer

This is an unofficial fan-made application. Star Wars™ and Star Wars: Unlimited™ are trademarks of Lucasfilm Ltd. and Fantasy Flight Games. This project is not affiliated with, endorsed by, or sponsored by Lucasfilm Ltd. or Fantasy Flight Games.

Card data is sourced from community-maintained databases and may not always reflect the most current official information.

## 🙏 Acknowledgments

- **Fantasy Flight Games** - For creating Star Wars: Unlimited
- **SWU-DB Community** - For maintaining the card database API
- **Karabast.net** - For additional card data and inspiration
- **Open Source Community** - For the amazing tools and libraries

## 📞 Support & Community

- **Issues**: [GitHub Issues](https://github.com/Midknightloki/SWU-Holocron/issues)
- **Discussions**: [GitHub Discussions](https://github.com/Midknightloki/SWU-Holocron/discussions)
- **Discord**: (Coming soon)

---

**Made with ❤️ for the Star Wars: Unlimited community**

*May the Force be with you!*
