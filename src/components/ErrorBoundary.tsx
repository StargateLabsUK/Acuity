import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log to console in development only — no PII exposure
    console.error('ErrorBoundary caught:', error.message);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="flex flex-col items-center justify-center min-h-screen px-4"
          style={{ background: '#F5F5F0' }}
        >
          <h1
            className="text-xl font-bold tracking-[0.08em] text-center mb-4"
            style={{ fontFamily: "'Manrope', sans-serif", color: '#1A1A1A' }}
          >
            ACUITY
          </h1>
          <p style={{ color: '#666666', fontSize: 14, textAlign: 'center', marginBottom: 24 }}>
            Something went wrong. Please refresh the page.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 24px',
              background: 'transparent',
              border: '1px solid rgba(0,0,0,0.15)',
              color: '#1A1A1A',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 14,
              cursor: 'pointer',
              borderRadius: 3,
            }}
          >
            RELOAD
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
