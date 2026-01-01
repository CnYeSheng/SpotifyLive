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

// Middleware
app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Error:', err)
  res.status(500).json({ error: err.message || 'Internal server error' })
})

// API Routes
app.use('/api/auth', authRoutes)
app.use('/api/lyrics', lyricsRoutes)
app.use('/api/spotify', spotifyRoutes)

// Serve static files
app.use(express.static(path.join(__dirname, '..', 'public')))

// SPA fallback
app.get('*', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'))
})

// Start server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`)
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`)
})

export default app
