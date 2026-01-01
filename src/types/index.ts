export interface Track {
  id: string
  name: string
  artists: Artist[]
  album: Album
  duration_ms: number
  popularity: number
  explicit: boolean
  external_urls: {
    spotify: string
  }
}

export interface Artist {
  id: string
  name: string
  external_urls: {
    spotify: string
  }
}

export interface Album {
  id: string
  name: string
  release_date: string
  images: Image[]
}

export interface Image {
  url: string
  height?: number
  width?: number
}

export interface UserProfile {
  id: string
  display_name: string
  email: string
  external_urls: {
    spotify: string
  }
  followers: {
    total: number
  }
  images: Image[]
  country: string
  product: string
}

export interface AuthResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
}

export interface LyricsResponse {
  lyrics: string | null
  message?: string
  url?: string
  title?: string
  artist?: string
}
