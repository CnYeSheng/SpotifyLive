# Testing Guide - Spotify Lyrics Player 2.0

## Pre-Testing Checklist

- [ ] Node.js 18+ installed
- [ ] pnpm installed
- [ ] Spotify Developer credentials configured
- [ ] `.env` file populated correctly
- [ ] All dependencies installed (`pnpm install`)
- [ ] No TypeScript errors (`pnpm run typecheck`)

## Manual Testing

### 1. Authentication Flow

#### Test Login
1. Start the application: `pnpm run dev`
2. Navigate to `http://localhost:3000`
3. Click "Connect with Spotify"
4. You should be redirected to Spotify login page
5. Log in with your Spotify account
6. Authorize the application
7. You should be redirected back to the app with your profile loaded

**Expected Results**:
- [ ] Login button redirects to Spotify
- [ ] Authorization prompt appears
- [ ] User is redirected back to app
- [ ] User profile displays
- [ ] No console errors

#### Test Logout
1. Click "Logout" button
2. You should be redirected to login screen
3. localStorage should be cleared

**Expected Results**:
- [ ] Logout button works
- [ ] User returns to login page
- [ ] Tokens are cleared from storage

### 2. User Profile Display

1. After successful authentication
2. Check the "User Profile" sidebar

**Expected Results**:
- [ ] User avatar displays
- [ ] Display name shows
- [ ] Email is visible
- [ ] Follower count is correct
- [ ] Account type (free/premium) displays
- [ ] "View Profile" link works

### 3. Current Track Display

#### Test Now Playing
1. Play a track in your Spotify app
2. Wait for the app to fetch the current track
3. Check the "Now Playing" section

**Expected Results**:
- [ ] Album art displays correctly
- [ ] Track name is accurate
- [ ] Artist name(s) display
- [ ] Album name shows
- [ ] Duration displays in MM:SS format
- [ ] Popularity percentage shows
- [ ] Release date displays

#### Test No Track Playing
1. Stop all music in Spotify
2. Wait for refresh
3. Check "Now Playing" section

**Expected Results**:
- [ ] Shows "No track currently playing"
- [ ] No errors in console

### 4. Lyrics Functionality

#### Test Lyrics Fetch
1. Play a popular song (e.g., "Bohemian Rhapsody" by Queen)
2. Wait for lyrics to load

**Expected Results**:
- [ ] Lyrics message displays
- [ ] Genius URL provided
- [ ] Song metadata shows
- [ ] No 404 errors

#### Test Lyrics Caching
1. Play the same song again
2. Check response headers for "cache" indicator

**Expected Results**:
- [ ] Lyrics load faster on second request
- [ ] Cached response indicated

#### Test Lyrics Not Found
1. Play an obscure or very new song
2. Wait for lyrics response

**Expected Results**:
- [ ] Shows "Lyrics not found" message
- [ ] No errors in console

### 5. Recent Tracks Display

1. After authentication
2. Scroll to "Recent Tracks" sidebar

**Expected Results**:
- [ ] List of 10 tracks displays
- [ ] Each track shows thumbnail
- [ ] Artist names display
- [ ] Hover effect works (highlight on green)
- [ ] Tracks clickable

### 6. Track Selection

1. Click on a track in "Recent Tracks"
2. Main display should update

**Expected Results**:
- [ ] Selected track displays in "Now Playing"
- [ ] Album art updates
- [ ] Track info updates
- [ ] Lyrics fetch for new track
- [ ] No console errors

### 7. Refresh Button

1. Click "Refresh" button in Now Playing section
2. Current track should refresh

**Expected Results**:
- [ ] New data fetches from Spotify
- [ ] Display updates
- [ ] Loading state shows briefly
- [ ] No errors

### 8. Error Handling

#### Test Network Error
1. Disconnect internet
2. Try to play a track or refresh

**Expected Results**:
- [ ] Error message displays to user
- [ ] App doesn't crash
- [ ] Can reconnect and retry

#### Test Invalid Credentials
1. Change Spotify credentials in `.env`
2. Restart development server
3. Try to login

**Expected Results**:
- [ ] Authentication fails gracefully
- [ ] Error message displays
- [ ] App recovers properly

### 9. Responsive Design

#### Desktop (1920x1080)
- [ ] Layout displays correctly
- [ ] Sidebar visible
- [ ] All controls accessible
- [ ] No overflow

#### Tablet (768x1024)
- [ ] Layout adjusts properly
- [ ] Sidebar below main content
- [ ] Touch targets are large enough

#### Mobile (375x667)
- [ ] Single column layout
- [ ] Navigation is accessible
- [ ] Text is readable
- [ ] No horizontal scroll

### 10. Performance

#### Load Time
1. Open DevTools Network tab
2. Reload page
3. Check load time

**Expected Results**:
- [ ] Page loads in < 3 seconds
- [ ] Initial render < 1 second
- [ ] No blocking scripts

#### API Response Time
1. Open DevTools Network tab
2. Click Refresh on Now Playing
3. Check request duration

**Expected Results**:
- [ ] API responds in < 1 second
- [ ] Lyrics API responds in < 5 seconds

## Automated Testing

### Run Tests
```bash
pnpm run test
```

### Write New Tests
```bash
# Example test file: src/components/__tests__/NowPlaying.test.ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import NowPlaying from '../NowPlaying.vue'

describe('NowPlaying Component', () => {
  it('displays track information', () => {
    const track = {
      name: 'Test Track',
      artists: [{ name: 'Test Artist' }],
      album: { name: 'Test Album' },
      duration_ms: 180000,
    }
    
    const wrapper = mount(NowPlaying, {
      props: {
        track,
        lyrics: 'Test lyrics',
      },
    })
    
    expect(wrapper.text()).toContain('Test Track')
  })
})
```

## TypeScript Validation

### Check for Type Errors
```bash
pnpm run typecheck
```

**Expected Results**:
- [ ] No TypeScript errors
- [ ] All types are properly defined

## ESLint Validation

### Run Linter
```bash
pnpm run lint
```

**Expected Results**:
- [ ] No critical errors
- [ ] Code follows style guide
- [ ] Fix suggestions if any

## Build Validation

### Build for Production
```bash
pnpm run build
```

**Expected Results**:
- [ ] Build completes successfully
- [ ] No errors or warnings
- [ ] dist/ folder created
- [ ] Files optimized and minified

### Test Production Build
```bash
pnpm run preview
```

Then visit `http://localhost:4173`

**Expected Results**:
- [ ] App loads and works correctly
- [ ] All features functional
- [ ] Performance is good

## Security Testing

### Check for Vulnerabilities
```bash
pnpm audit
```

**Expected Results**:
- [ ] No critical vulnerabilities
- [ ] Address any high-risk issues

### Test Sensitive Data Handling
1. Open DevTools Console
2. Type `localStorage.getItem('spotify_access_token')`
3. Token should be present but only in localStorage

**Expected Results**:
- [ ] Token not exposed in network requests (except headers)
- [ ] No credentials in URL or cookies
- [ ] HTTPS used in production

## API Testing

### Test Auth Endpoint
```bash
curl -X POST http://localhost:3000/api/auth/callback \
  -H "Content-Type: application/json" \
  -d '{"code":"test_code"}'
```

**Expected Results**:
- [ ] Returns 400 for invalid code
- [ ] Proper error messages

### Test Lyrics Endpoint
```bash
curl -X POST http://localhost:3000/api/lyrics \
  -H "Content-Type: application/json" \
  -d '{"trackName":"Bohemian Rhapsody","artistName":"Queen"}'
```

**Expected Results**:
- [ ] Returns lyrics or link
- [ ] Proper error handling

### Test Health Endpoints
```bash
curl http://localhost:3000/health
curl http://localhost:3000/api/lyrics/health
curl http://localhost:3000/api/spotify/health
```

**Expected Results**:
- [ ] All return status: "ok"
- [ ] Timestamps are current

## Testing Matrix

| Feature | Desktop | Tablet | Mobile | Status |
|---------|---------|--------|--------|--------|
| Login | ✓ | ✓ | ✓ | |
| Logout | ✓ | ✓ | ✓ | |
| Profile Display | ✓ | ✓ | ✓ | |
| Current Track | ✓ | ✓ | ✓ | |
| Lyrics | ✓ | ✓ | ✓ | |
| Recent Tracks | ✓ | ✓ | ✓ | |
| Track Selection | ✓ | ✓ | ✓ | |
| Refresh | ✓ | ✓ | ✓ | |
| Error Handling | ✓ | ✓ | ✓ | |
| Performance | ✓ | ✓ | ✓ | |

## Regression Testing Checklist

Before each release, verify:
- [ ] Authentication flow works
- [ ] User profile displays
- [ ] Current track fetches correctly
- [ ] Lyrics search functions
- [ ] Recent tracks list populates
- [ ] Track selection works
- [ ] Refresh fetches new data
- [ ] Error messages display properly
- [ ] Responsive design works
- [ ] No console errors
- [ ] No memory leaks
- [ ] Performance acceptable

## Known Issues / Limitations

- Lyrics API may not have all songs
- Genius API requires token configuration
- Some Spotify data may not be available for all users
- Real-time sync requires active Spotify playback
- Rate limiting may occur with high API usage

## Future Testing Improvements

- [ ] Unit tests for composables
- [ ] E2E tests with Cypress
- [ ] Performance benchmarks
- [ ] Visual regression tests
- [ ] Accessibility testing
- [ ] Load testing
- [ ] Security penetration testing

## Testing Resources

- [Vue Test Utils](https://test-utils.vuejs.org/)
- [Vitest](https://vitest.dev/)
- [Spotify API Documentation](https://developer.spotify.com/documentation/web-api)
- [Genius API Documentation](https://docs.genius.com/)

## Questions or Issues?

If you encounter issues during testing:
1. Check `.env` configuration
2. Verify API credentials
3. Check console for error messages
4. Review API response in Network tab
5. Create an issue with details
