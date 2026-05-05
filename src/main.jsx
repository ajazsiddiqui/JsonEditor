import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ background:"#111", color:"#ccc", fontFamily:"monospace", fontSize:13, height:"100vh", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:12 }}>
          <span style={{ color:"#e06060", fontSize:12 }}>render error — {this.state.error.message}</span>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ background:"#1c1c1c", border:"0.5px solid #333", color:"#aaa", padding:"4px 16px", borderRadius:3, cursor:"pointer", fontFamily:"monospace", fontSize:12 }}
          >retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
