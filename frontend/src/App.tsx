import { useState, useEffect } from 'react'
import axios from 'axios'
import './App.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1'

interface HealthStatus {
  status: string
  service: string
  timestamp: string
  uptime: number
  dependencies: {
    kafka: string
  }
  environment: string
}

function App() {
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchHealth = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await axios.get(`${API_URL}/health`)
      setHealth(response.data)
    } catch (err: any) {
      setError(err.message || 'Failed to connect to API Gateway')
      console.error('Health check failed:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchHealth()
    // Refresh health every 10 seconds
    const interval = setInterval(fetchHealth, 10000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="App">
      <header>
        <h1>🏢 Procurement System</h1>
        <p className="subtitle">API Gateway Status Dashboard</p>
      </header>

      <main>
        <div className="status-card">
          <h2>System Status</h2>
          
          {loading && <div className="loading">Loading...</div>}
          
          {error && (
            <div className="error">
              <strong>❌ Connection Error:</strong>
              <p>{error}</p>
              <button onClick={fetchHealth}>Retry</button>
            </div>
          )}

          {health && (
            <div className="health-info">
              <div className="status-badge">
                <span className={`badge ${health.status === 'healthy' ? 'success' : 'error'}`}>
                  {health.status === 'healthy' ? '✅ Healthy' : '❌ Unhealthy'}
                </span>
              </div>

              <div className="info-grid">
                <div className="info-item">
                  <label>Service:</label>
                  <span>{health.service}</span>
                </div>

                <div className="info-item">
                  <label>Environment:</label>
                  <span>{health.environment}</span>
                </div>

                <div className="info-item">
                  <label>Uptime:</label>
                  <span>{Math.floor(health.uptime)} seconds</span>
                </div>

                <div className="info-item">
                  <label>Last Updated:</label>
                  <span>{new Date(health.timestamp).toLocaleTimeString()}</span>
                </div>
              </div>

              <div className="dependencies">
                <h3>Dependencies</h3>
                <div className="dependency-item">
                  <span>Kafka:</span>
                  <span className={`status ${health.dependencies.kafka === 'connected' ? 'connected' : 'disconnected'}`}>
                    {health.dependencies.kafka === 'connected' ? '🟢 Connected' : '🔴 Disconnected'}
                  </span>
                </div>
              </div>

              <button onClick={fetchHealth} className="refresh-btn">
                🔄 Refresh
              </button>
            </div>
          )}
        </div>

        <div className="info-card">
          <h3>📡 API Endpoints</h3>
          <ul className="endpoint-list">
            <li>
              <code>GET {API_URL}/health</code>
              <span className="badge success">Active</span>
            </li>
            <li>
              <code>GET {API_URL}/</code>
              <span className="badge success">Active</span>
            </li>
          </ul>
        </div>

        <div className="info-card">
          <h3>🚀 Next Steps</h3>
          <ol className="next-steps">
            <li>✅ API Gateway is running</li>
            <li>✅ Frontend connected to backend</li>
            <li>✅ Kafka integration ready</li>
            <li>⏳ Add Budget Service (next)</li>
            <li>⏳ Add Request Service</li>
          </ol>
        </div>
      </main>

      <footer>
        <p>Procurement System v1.0.0 | Built with React + NestJS</p>
      </footer>
    </div>
  )
}

export default App
