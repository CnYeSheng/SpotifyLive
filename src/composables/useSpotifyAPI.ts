import axios from 'axios'

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1'

export function useSpotifyAPI() {
  const createAxiosInstance = (token: string) => {
    return axios.create({
      baseURL: SPOTIFY_API_BASE,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
  }

  const getUserProfile = async (token: string) => {
    try {
      const api = createAxiosInstance(token)
      const response = await api.get('/me')
      return response.data
    } catch (error) {
      console.error('Error fetching user profile:', error)
      throw error
    }
  }

  const getCurrentTrack = async (token: string) => {
    try {
      const api = createAxiosInstance(token)
      const response = await api.get('/me/player/currently-playing')
      return response.data?.item || null
    } catch (error) {
      console.error('Error fetching current track:', error)
      throw error
    }
  }

  const getRecentTracks = async (token: string, limit = 20) => {
    try {
      const api = createAxiosInstance(token)
      const response = await api.get('/me/player/recently-played', {
        params: { limit },
      })
      return response.data?.items?.map((item: any) => item.track) || []
    } catch (error) {
      console.error('Error fetching recent tracks:', error)
      throw error
    }
  }

  const getTopTracks = async (token: string, limit = 20, timeRange = 'medium_term') => {
    try {
      const api = createAxiosInstance(token)
      const response = await api.get('/me/top/tracks', {
        params: { limit, time_range: timeRange },
      })
      return response.data?.items || []
    } catch (error) {
      console.error('Error fetching top tracks:', error)
      throw error
    }
  }

  const getLyrics = async (trackName: string, artistName: string) => {
    try {
      const response = await fetch('/api/lyrics', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ trackName, artistName }),
      })

      if (!response.ok) {
        throw new Error('Failed to fetch lyrics')
      }

      const data = await response.json()
      return data.lyrics || 'Lyrics not available'
    } catch (error) {
      console.error('Error fetching lyrics:', error)
      return 'Lyrics not available'
    }
  }

  const searchTracks = async (token: string, query: string, limit = 20) => {
    try {
      const api = createAxiosInstance(token)
      const response = await api.get('/search', {
        params: {
          q: query,
          type: 'track',
          limit,
        },
      })
      return response.data?.tracks?.items || []
    } catch (error) {
      console.error('Error searching tracks:', error)
      throw error
    }
  }

  const getPlaylists = async (token: string, limit = 20) => {
    try {
      const api = createAxiosInstance(token)
      const response = await api.get('/me/playlists', {
        params: { limit },
      })
      return response.data?.items || []
    } catch (error) {
      console.error('Error fetching playlists:', error)
      throw error
    }
  }

  return {
    getUserProfile,
    getCurrentTrack,
    getRecentTracks,
    getTopTracks,
    getLyrics,
    searchTracks,
    getPlaylists,
  }
}
