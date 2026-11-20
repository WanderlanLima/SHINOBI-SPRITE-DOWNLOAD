import { Component, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

declare global {
  interface Window {
    __SHINOBI_MOUNTED__?: boolean;
  }
}

class RootErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Shinobi Vault runtime error:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: '100vh',
            backgroundColor: '#0B0D12',
            color: '#E6E9F0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <div
            style={{
              maxWidth: '520px',
              width: '100%',
              backgroundColor: '#13161F',
              border: '1px solid #4C1D24',
              borderRadius: '12px',
              padding: '20px',
            }}
          >
            <h1 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 8px' }}>
              Erro ao renderizar o Shinobi Vault
            </h1>
            <p style={{ fontSize: '13px', color: '#FCA5A5', margin: '0 0 16px', wordBreak: 'break-word' }}>
              {this.state.error.message || String(this.state.error)}
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                backgroundColor: '#EA580C',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: '8px',
                padding: '10px 16px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Recarregar página
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

window.__SHINOBI_MOUNTED__ = true;

createRoot(document.getElementById('root')!).render(
  <RootErrorBoundary>
    <App />
  </RootErrorBoundary>
);
