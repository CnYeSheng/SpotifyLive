import express, { Express, Request, Response, NextFunction } from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import authRoutes from './routes/auth.js'
import lyricsRoutes from './routes/lyrics.js'
import spotifyRoutes from './routes/spotify.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app: Express = express()
const port = process.env.PORT || 3000
const isDev = process.env.NODE_ENV !== 'production'

// Middleware
app.use(cors({
  origin: isDev ? '*' : process.env.DOMAIN || 'localhost',
  credentials: true,
}))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// Logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now()
  res.on('finish', () => {
    const duration = Date.now() - start
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`)
  })
  next()
})

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// API Routes
app.use('/api/auth', authRoutes)
app.use('/api/lyrics', lyricsRoutes)
app.use('/api/spotify', spotifyRoutes)

// Serve static files from dist/public in production, public in development
const publicDir = isDev 
  ? path.join(__dirname, '..', 'public')
  : path.join(__dirname, '..', 'public')

app.use(express.static(publicDir, {
  maxAge: isDev ? 0 : '1d',
  etag: false,
}))

// SPA fallback - serve index.html for all routes that don't match API or static files
app.get('*', (req: Request, res: Response) => {
  const indexPath = path.join(publicDir, 'index.html')
  res.sendFile(indexPath, (err) => {
    if (err) {
      console.error('Error sending index.html:', err)
      res.status(404).json({ error: 'Not found' })
    }
  })
})

// Error handling middleware - must be last
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('[ERROR]', err.message || err)
  
  const statusCode = err.statusCode || err.status || 500
  const message = isDev ? err.message : 'Internal server error'
  
  res.status(statusCode).json({
    error: message,
    ...(isDev && { stack: err.stack }),
  })
})

// Start server
const server = app.listen(port, () => {
  console.log(`
╔════════════════════════════════════════╗
║   Spotify Lyrics Player 2.0            ║
║   ✓ Server running successfully        ║
╚════════════════════════════════════════╝

🎵 Application URLs:
   Frontend: http://localhost:${port}
   Backend:  http://localhost:${port}/api

📝 Environment: ${process.env.NODE_ENV || 'development'}
🔧 Build: ${isDev ? 'Development' : 'Production'}

Press Ctrl+C to stop the server.
  `)
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...')
  server.close(() => {
    console.log('Server closed')
    process.exit(0)
  })
})

export default app
