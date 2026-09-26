import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import PublicDeckView from './components/PublicDeckView.jsx'
import './index.css'
import { AuthProvider } from './contexts/AuthContext.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

function Root() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts.length >= 1 && parts[0] === 'deck' && parts[1]) {
    return (
      <ErrorBoundary label="the shared deck">
        <PublicDeckView slug={parts[1]} />
      </ErrorBoundary>
    );
  }
  // The outermost net. App.jsx wraps each view, so this only catches what breaks
  // above them: the auth provider, the header, the set picker.
  return (
    <ErrorBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ErrorBoundary>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
