# Spotify Lyrics Player 2.0 - Setup Guide

## Quick Start

### Prerequisites
- Node.js 18.0.0 or higher
- pnpm 8.0.0 or higher
- Spotify Developer Account
- Genius API Token (optional, for lyrics search)

### Step 1: Install pnpm

If you don't have pnpm installed:
```bash
npm install -g pnpm
```

### Step 2: Spotify Developer Setup

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Log in or create an account
3. Click "Create an App"
4. Accept the terms and create the application
5. You'll see your **Client ID** and **Client Secret**
6. Click "Edit Settings"
7. Add Redirect URI: `http://localhost:3000/callback`
8. Save

### Step 3: Genius API Setup (Optional)

1. Go to [Genius API Clients](https://genius.com/api-clients)
2. Create or sign in to your Genius account
3. Click "Generate Access Token"
4. Copy your API token

### Step 4: Configure Environment

Copy the example environment file:
```bash
cp .env.example .env
```

Edit `.env` with your credentials:
```env
VITE_SPOTIFY_CLIENT_ID=your_client_id_here
SPOTIFY_CLIENT_ID=your_client_id_here
SPOTIFY_CLIENT_SECRET=your_client_secret_here
REDIRECT_URI=http://localhost:3000/callback
VITE_SPOTIFY_REDIRECT_URI=http://localhost:3000/callback
GENIUS_API_TOKEN=your_genius_token_here
```

### Step 5: Install Dependencies

```bash
pnpm install
```

### Step 6: Start Development

Start both frontend and backend:
```bash
pnpm run dev
```

Or start them separately:
```bash
# Terminal 1: Frontend (Vite dev server on port 5173)
pnpm run dev:frontend

# Terminal 2: Backend (Express on port 3000)
pnpm run dev:backend
```

### Step 7: Access the Application

Open your browser and go to:
```
http://localhost:3000
```

Click "Connect with Spotify" to authenticate.

## Project Structure

```
Spotify/
├── src/
│   ├── components/           # Vue components
│   │   ├── NowPlaying.vue   # Current track display with lyrics
│   │   ├── UserInfo.vue     # User profile information
│   │   └── RecentTracks.vue # List of recent tracks
│   ├── composables/          # Vue composition API utilities
│   │   ├── useSpotifyAuth.ts # Authentication logic
│   │   └── useSpotifyAPI.ts  # Spotify API integration
│   ├── routes/               # Express API routes
│   │   ├── auth.ts           # OAuth callback handling
│   │   ├── lyrics.ts         # Lyrics search endpoint
│   │   └── spotify.ts        # Additional Spotify endpoints
│   ├── types/                # TypeScript type definitions
│   ├── styles/               # Global CSS/Tailwind
│   ├── App.vue               # Root Vue component
│   ├── main.ts               # Vue app entry point
│   └── server.ts             # Express server entry point
├── public/                   # Static assets
├── index.html                # HTML template
├── vite.config.ts            # Vite build configuration
├── tailwind.config.js        # Tailwind CSS configuration
├── postcss.config.js         # PostCSS configuration
├── tsconfig.json             # TypeScript configuration
├── package.json              # Dependencies and scripts
└── README.md                 # Project documentation
```

## Available Commands

### Development
```bash
pnpm run dev              # Start both frontend and backend
pnpm run dev:frontend     # Start Vite dev server (port 5173)
pnpm run dev:backend      # Start Express with hot reload (port 3000)
```

### Building
```bash
pnpm run build            # Build frontend and compile backend
pnpm run build:frontend   # Build frontend only
pnpm run build:backend    # Compile backend only
```

### Production
```bash
pnpm run preview          # Preview production build locally
pnpm run start            # Start production server
```

### Quality Assurance
```bash
pnpm run typecheck        # Check TypeScript errors
pnpm run lint             # Run ESLint
pnpm run test             # Run unit tests (with Vitest)
```

## Architecture

### Frontend (Vue 3 + Vite)
- **Framework**: Vue 3 Composition API
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **HTTP Client**: Axios
- **Build Tool**: Vite

### Backend (Express + TypeScript)
- **Framework**: Express.js
- **Language**: TypeScript
- **Runtime**: Node.js
- **API Style**: RESTful

### Authentication Flow
1. User clicks "Connect with Spotify"
2. Redirected to Spotify OAuth authorization page
3. User authorizes the application
4. Redirected back to `http://localhost:3000/callback?code=...`
5. Frontend sends authorization code to `/api/auth/callback`
6. Backend exchanges code for access token
7. Access token stored securely in localStorage
8. Frontend uses token to access Spotify API

## API Endpoints

### Authentication
- `POST /api/auth/callback` - Exchange authorization code for access token
- `POST /api/auth/refresh` - Refresh expired access token

### Lyrics
- `POST /api/lyrics` - Search for song lyrics
- `GET /api/lyrics/health` - Check lyrics service status

### Spotify
- `GET /api/spotify/health` - Check Spotify service status

## Troubleshooting

### Port Already in Use
If port 3000 or 5173 is already in use:
```bash
# Set custom port
PORT=3001 pnpm run dev:backend
VITE_PORT=5174 pnpm run dev:frontend
```

### Authentication Errors
- Verify Spotify credentials in `.env`
- Check redirect URI matches in Spotify Developer Dashboard
- Clear browser cache and localStorage

### Lyrics Not Showing
- Ensure `GENIUS_API_TOKEN` is set in `.env`
- Check that the track name and artist are correct
- Lyrics may not be available for all songs

### TypeScript Errors
```bash
# Run type checking
pnpm run typecheck
```

## Technology Decisions

### Why These Technologies?

**Vue 3**: Modern, progressive framework with excellent TypeScript support and great developer experience.

**TypeScript**: Provides type safety, better IDE support, and catches errors at compile time.

**Tailwind CSS**: Utility-first CSS framework for rapid UI development with consistent styling.

**Vite**: Lightning-fast build tool with instant HMR (Hot Module Replacement) for excellent DX.

**pnpm**: Faster and more efficient package manager compared to npm/yarn.

**Express**: Lightweight, flexible Node.js framework perfect for APIs and server-side rendering.

## Performance Optimization

- **Code Splitting**: Vite automatically splits components for optimal loading
- **Caching**: Lyrics are cached server-side (24 hours TTL)
- **Lazy Loading**: Vue components are lazily loaded
- **CSS Purging**: Tailwind only includes used styles

## Security Considerations

- **Access Tokens**: Never stored on the server, only in secure browser storage
- **CORS**: Configured to prevent unauthorized cross-origin requests
- **Environment Variables**: Sensitive data kept in `.env` (never committed to git)
- **API Rate Limiting**: Consider implementing for production

## Deployment

### Vercel (Recommended)
```bash
# Push to GitHub
git push origin 2.0

# Connect repository to Vercel
# Set environment variables in Vercel dashboard
# Deployment happens automatically on push
```

### Other Platforms
See `DEPLOYMENT.md` for detailed deployment guides.

## Support

For issues or questions:
1. Check the README.md for more details
2. Review the API documentation
3. Check existing issues on GitHub
4. Create a new issue with detailed information

## License

MIT
