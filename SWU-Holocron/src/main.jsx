import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import PublicDeckView from './components/PublicDeckView.jsx'
import './index.css'
import { AuthProvider } from './contexts/AuthContext.jsx'

function Root() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts.length >= 1 && parts[0] === 'deck' && parts[1]) {
    return <PublicDeckView slug={parts[1]} />;
  }
  return (
    <AuthProvider>
      <App />
    </AuthProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
