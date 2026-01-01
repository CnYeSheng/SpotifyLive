import { ref, computed } from 'vue'

const SPOTIFY_CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID
const SPOTIFY_REDIRECT_URI = import.meta.env.VITE_SPOTIFY_REDIRECT_URI || window.location.origin + '/callback'
const SPOTIFY_SCOPES = [
  'user-read-private',
  'user-read-email',
  'user-read-playback-state',
  'user-read-currently-playing',
  'user-read-recently-played',
  'user-library-read',
  'user-top-read',
]

const accessToken = ref<string | null>(localStorage.getItem('spotify_access_token'))
const refreshToken = ref<string | null>(localStorage.getItem('spotify_refresh_token'))

export function useSpotifyAuth() {
  const isAuthenticated = computed(() => !!accessToken.value)

  const login = () => {
    const params = new URLSearchParams({
      client_id: SPOTIFY_CLIENT_ID,
      response_type: 'code',
      redirect_uri: SPOTIFY_REDIRECT_URI,
      scope: SPOTIFY_SCOPES.join(' '),
      state: generateRandomString(16),
    })
    window.location.href = `https://accounts.spotify.com/authorize?${params}`
  }

  const logout = () => {
    accessToken.value = null
    refreshToken.value = null
    localStorage.removeItem('spotify_access_token')
    localStorage.removeItem('spotify_refresh_token')
    localStorage.removeItem('token_expiry')
  }

  const setAccessToken = (token: string, expiresIn?: number) => {
    accessToken.value = token
    localStorage.setItem('spotify_access_token', token)
    if (expiresIn) {
      const expiry = new Date().getTime() + expiresIn * 1000
      localStorage.setItem('token_expiry', expiry.toString())
    }
  }

  const setRefreshToken = (token: string) => {
    refreshToken.value = token
    localStorage.setItem('spotify_refresh_token', token)
  }

  const getAccessToken = async (): Promise<string> => {
    if (!accessToken.value) {
      throw new Error('Not authenticated')
    }

    const expiry = localStorage.getItem('token_expiry')
    if (expiry && new Date().getTime() > parseInt(expiry)) {
      if (!refreshToken.value) {
        throw new Error('Token expired and no refresh token available')
      }
      // TODO: Implement token refresh
    }

    return accessToken.value
  }

  const handleCallback = async (code: string) => {
    try {
      const response = await fetch('/api/auth/callback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code }),
      })

      if (!response.ok) {
        throw new Error('Failed to authenticate')
      }

      const data = await response.json()
      setAccessToken(data.access_token, data.expires_in)
      if (data.refresh_token) {
        setRefreshToken(data.refresh_token)
      }
    } catch (error) {
      console.error('Authentication error:', error)
      throw error
    }
  }

  return {
    isAuthenticated,
    accessToken: computed(() => accessToken.value),
    refreshToken: computed(() => refreshToken.value),
    login,
    logout,
    setAccessToken,
    setRefreshToken,
    getAccessToken,
    handleCallback,
  }
}

function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}
