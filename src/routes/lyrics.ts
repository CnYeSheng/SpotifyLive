import { Router, Request, Response } from 'express'
import axios from 'axios'

const router = Router()

interface LyricsRequestBody {
  trackName: string
  artistName: string
}

// Cache for lyrics to avoid repeated requests
const lyricsCache = new Map<string, { lyrics: string; expiry: number }>()
const CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours

function getCacheKey(trackName: string, artistName: string): string {
  return `${trackName}::${artistName}`.toLowerCase()
}

function getFromCache(key: string): string | null {
  const cached = lyricsCache.get(key)
  if (cached && cached.expiry > Date.now()) {
    return cached.lyrics
  }
  lyricsCache.delete(key)
  return null
}

function saveToCache(key: string, lyrics: string): void {
  lyricsCache.set(key, {
    lyrics,
    expiry: Date.now() + CACHE_TTL,
  })
}

// Using Genius API to search for lyrics
router.post('/', async (req: Request<{}, {}, LyricsRequestBody>, res: Response) => {
  try {
    const { trackName, artistName } = req.body

    if (!trackName || !artistName) {
      return res.status(400).json({ error: 'Track name and artist name are required' })
    }

    const cacheKey = getCacheKey(trackName, artistName)
    const cached = getFromCache(cacheKey)

    if (cached) {
      return res.json({ lyrics: cached, source: 'cache' })
    }

    // Search for lyrics using Genius API
    const geniusToken = process.env.GENIUS_API_TOKEN

    if (!geniusToken) {
      return res.json({
        lyrics: null,
        message: 'Genius API token not configured. Please set GENIUS_API_TOKEN.',
      })
    }

    try {
      const searchResponse = await axios.get('https://api.genius.com/search', {
        params: {
          q: `${trackName} ${artistName}`,
        },
        headers: {
          Authorization: `Bearer ${geniusToken}`,
        },
        timeout: 5000,
      })

      const hits = searchResponse.data?.response?.hits || []
      if (hits.length === 0) {
        return res.json({ lyrics: null, message: 'Lyrics not found on Genius' })
      }

      const song = hits[0].result

      // Note: Genius API doesn't provide full lyrics (due to licensing)
      // Return the song URL and metadata for users to view on Genius
      const response = {
        lyrics: null,
        message: 'Full lyrics available on Genius',
        url: song.url,
        title: song.title,
        artist: song.primary_artist.name,
        thumbnail: song.song_art_image_thumbnail_url,
      }

      // Cache the response
      saveToCache(cacheKey, JSON.stringify(response))

      res.json(response)
    } catch (geniusError) {
      console.error('Genius API error:', geniusError)
      res.status(500).json({ error: 'Failed to search for lyrics' })
    }
  } catch (error) {
    console.error('Lyrics endpoint error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Health check for lyrics service
router.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    cacheSize: lyricsCache.size,
  })
})

export default router
