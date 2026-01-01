import { Router, Request, Response } from 'express'
import axios from 'axios'

const router = Router()

const clientId = process.env.SPOTIFY_CLIENT_ID
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET
const redirectUri = process.env.REDIRECT_URI || 'http://localhost:3000/callback'

interface AuthCallbackBody {
  code: string
}

router.post('/callback', async (req: Request<{}, {}, AuthCallbackBody>, res: Response) => {
  try {
    const { code } = req.body

    if (!code) {
      return res.status(400).json({ error: 'Authorization code is required' })
    }

    const response = await axios.post(
      'https://accounts.spotify.com/api/token',
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      },
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    )

    const { access_token, refresh_token, expires_in } = response.data

    res.json({
      access_token,
      refresh_token,
      expires_in,
    })
  } catch (error) {
    console.error('Authentication error:', error)
    res.status(500).json({ error: 'Failed to authenticate' })
  }
})

router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refresh_token } = req.body

    if (!refresh_token) {
      return res.status(400).json({ error: 'Refresh token is required' })
    }

    const response = await axios.post(
      'https://accounts.spotify.com/api/token',
      {
        grant_type: 'refresh_token',
        refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
      },
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    )

    const { access_token, expires_in } = response.data

    res.json({
      access_token,
      expires_in,
    })
  } catch (error) {
    console.error('Token refresh error:', error)
    res.status(500).json({ error: 'Failed to refresh token' })
  }
})

export default router
