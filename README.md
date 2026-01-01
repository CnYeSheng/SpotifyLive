# Spotify Lyrics Player 2.0

A modern, feature-rich Spotify lyrics player built with Vue 3, TypeScript, Tailwind CSS, and Vite.

## Features

- 🎵 Real-time lyrics synchronization with Spotify
- 🎨 Modern UI with Tailwind CSS
- ⚡ Lightning-fast development with Vite
- 📱 Fully responsive design
- 🔐 Secure Spotify OAuth authentication
- 🌙 Dark theme optimized for music viewing
- 🔍 Search and browse your recent tracks
- 👤 User profile integration
- 📊 Track popularity and details display

## Tech Stack

### Frontend
- **Vue 3**: Progressive JavaScript framework
- **TypeScript**: Type-safe JavaScript
- **Vite**: Next-generation build tool
- **Tailwind CSS**: Utility-first CSS framework
- **Axios**: HTTP client

### Backend
- **Express.js**: Minimal and flexible Node.js framework
- **TypeScript**: Type-safe backend code
- **CORS**: Cross-origin resource sharing
- **Axios**: Server-side HTTP requests

### Tools
- **pnpm**: Fast, disk space efficient package manager
- **ESLint**: JavaScript/TypeScript linter
- **Vitest**: Unit testing framework

## Prerequisites

- Node.js >= 18.0.0
- pnpm >= 8.0.0
- Spotify Developer Account

## Setup

### 1. Create Spotify Application

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Create a new application
3. Accept the terms and create the app
4. Copy your Client ID and Client Secret
5. Add a Redirect URI: `http://localhost:3000/callback`

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Configure Environment

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env`:

```env
VITE_SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
REDIRECT_URI=http://localhost:3000/callback
VITE_SPOTIFY_REDIRECT_URI=http://localhost:3000/callback
```

## Development

### Start Development Servers

```bash
pnpm run dev
```

This will start:
- Frontend: http://localhost:5173
- Backend: http://localhost:3000

### Frontend Only

```bash
pnpm run dev:frontend
```

### Backend Only

```bash
pnpm run dev:backend
```

## Build

### Build for Production

```bash
pnpm run build
```

This will:
1. Build the frontend with Vite
2. Compile the backend TypeScript

### Preview Production Build

```bash
pnpm run preview
```

## Production

### Start Production Server

```bash
pnpm run start
```

The server will serve the built frontend files along with the API.

## Project Structure

```
Spotify/
├── src/
│   ├── components/          # Vue components
│   │   ├── NowPlaying.vue
│   │   ├── UserInfo.vue
│   │   └── RecentTracks.vue
│   ├── composables/         # Vue composables
│   │   ├── useSpotifyAuth.ts
│   │   └── useSpotifyAPI.ts
│   ├── routes/              # Express routes
│   │   ├── auth.ts
│   │   ├── lyrics.ts
│   │   └── spotify.ts
│   ├── types/               # TypeScript types
│   ├── styles/              # CSS stylesheets
│   │   └── main.css
│   ├── App.vue              # Root Vue component
│   ├── main.ts              # Frontend entry point
│   └── server.ts            # Backend entry point
├── public/                  # Static assets
├── index.html               # HTML template
├── vite.config.ts           # Vite configuration
├── tailwind.config.js       # Tailwind configuration
├── tsconfig.json            # TypeScript configuration
└── package.json             # Project dependencies
```

## Available Scripts

- `pnpm run dev` - Start development servers
- `pnpm run dev:frontend` - Start Vite dev server
- `pnpm run dev:backend` - Start backend with hot reload
- `pnpm run build` - Build for production
- `pnpm run build:frontend` - Build frontend only
- `pnpm run build:backend` - Compile backend only
- `pnpm run preview` - Preview production build
- `pnpm run start` - Start production server
- `pnpm run typecheck` - Check TypeScript types
- `pnpm run lint` - Run ESLint

## API Endpoints

### Authentication

- `POST /api/auth/callback` - Handle Spotify OAuth callback
- `POST /api/auth/refresh` - Refresh access token

### Lyrics

- `POST /api/lyrics` - Search for song lyrics

### Spotify

- `GET /api/spotify/health` - Health check

## Authentication Flow

1. User clicks "Login with Spotify"
2. Redirected to Spotify OAuth page
3. After authorization, redirected back to `/callback`
4. Frontend sends authorization code to backend
5. Backend exchanges code for access token
6. Access token stored in localStorage
7. Frontend uses token to access Spotify API

## Notes

- Lyrics are fetched from the Genius API
- Genius API token is required in environment variables
- Tokens are stored securely in localStorage
- Implement token refresh for long sessions

## License

MIT

## Version History

- **v2.0.0** - Complete rewrite with Vue 3, TypeScript, Tailwind CSS, and Vite
- **v1.0.0** - Original version with Express.js and vanilla JavaScript
