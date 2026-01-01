import { Router, Request, Response } from 'express'
import axios from 'axios'

const router = Router()

interface LyricsRequestBody {
  trackName: string
  artistName: string
}

// Using genius.com API as a free lyrics source
router.post('/', async (req: Request<{}, {}, LyricsRequestBody>, res: Response) => {
  try {
    const { trackName, artistName } = req.body

    if (!trackName || !artistName) {
      return res.status(400).json({ error: 'Track name and artist name are required' })
    }

    // Search for lyrics using genius API
    const geniusToken = process.env.GENIUS_API_TOKEN
    if (!geniusToken) {
      return res.status(500).json({ error: 'Genius API token not configured' })
    }

    const searchResponse = await axios.get(
      'https://api.genius.com/search',
      {
        params: {
          q: `${trackName} ${artistName}`,
        },
        headers: {
          Authorization: `Bearer ${geniusToken}`,
        },
      }
    )

    const hits = searchResponse.data?.response?.hits || []
    if (hits.length === 0) {
      return res.json({ lyrics: null, message: 'Lyrics not found' })
    }

    const song = hits[0].result
    // Note: Genius doesn't provide lyrics via API, only links
    // For production, you'd need to scrape or use another service

    res.json({
      lyrics: null,
      message: 'Lyrics not available via API',
      url: song.url,
      title: song.title,
      artist: song.primary_artist.name,
    })
  } catch (error) {
    console.error('Lyrics error:', error)
    res.status(500).json({ error: 'Failed to fetch lyrics' })
  }
})

export default router
