<template>
  <div id="app" class="min-h-screen bg-spotify-black text-white flex flex-col">
    <!-- Navigation -->
    <nav class="bg-spotify-darkgray border-b border-spotify-lightgray border-opacity-20 sticky top-0 z-50">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex justify-between items-center h-16">
          <div class="flex items-center space-x-3">
            <div class="w-8 h-8 bg-spotify-green rounded-full flex items-center justify-center">
              <span class="text-black font-bold text-sm">♪</span>
            </div>
            <h1 class="text-2xl font-bold text-spotify-green hidden sm:block">Spotify Lyrics</h1>
            <h1 class="text-xl font-bold text-spotify-green sm:hidden">Lyrics</h1>
          </div>
          <div class="flex items-center space-x-4">
            <span v-if="isAuthenticated" class="text-sm text-spotify-lightgray hidden sm:inline">
              {{ userInfo?.display_name || 'User' }}
            </span>
            <button
              v-if="!isAuthenticated"
              @click="login"
              class="px-6 py-2 bg-spotify-green text-black font-bold rounded-full hover:bg-opacity-90 transition text-sm sm:text-base"
            >
              Login
            </button>
            <button
              v-else
              @click="logout"
              class="px-4 sm:px-6 py-2 bg-red-600 text-white font-bold rounded-full hover:bg-red-700 transition text-sm sm:text-base"
            >
              Logout
            </button>
          </div>
        </div>
      </div>
    </nav>

    <!-- Main Content -->
    <main class="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <!-- Authentication Required -->
      <div v-if="!isAuthenticated" class="text-center py-20">
        <div class="mb-8">
          <div class="inline-block w-20 h-20 bg-spotify-green rounded-full flex items-center justify-center mb-6">
            <span class="text-4xl">♪</span>
          </div>
        </div>
        <h2 class="text-4xl sm:text-5xl font-bold mb-4">Enhanced Spotify Lyrics</h2>
        <p class="text-spotify-lightgray text-lg mb-2">
          Real-time lyrics sync with advanced playback controls
        </p>
        <p class="text-spotify-lightgray text-base mb-8 max-w-2xl mx-auto">
          Connect your Spotify account to view lyrics for your currently playing track and explore your music history.
        </p>
        <button
          @click="login"
          class="px-8 py-3 bg-spotify-green text-black font-bold rounded-full hover:bg-opacity-90 transition text-lg"
        >
          Connect with Spotify
        </button>
      </div>

      <!-- Authenticated View -->
      <div v-else>
        <div v-if="error" class="mb-6 p-4 bg-red-600 bg-opacity-20 border border-red-600 rounded-lg">
          <p class="text-red-400">{{ error }}</p>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <!-- Main Content -->
          <div class="lg:col-span-2">
            <NowPlaying
              :track="currentTrack"
              :lyrics="currentLyrics"
              @refresh="refreshCurrentTrack"
            />
          </div>

          <!-- Sidebar -->
          <div class="space-y-6">
            <UserInfo :user="userInfo" />
            <RecentTracks :tracks="recentTracks" @select="selectTrack" />
          </div>
        </div>
      </div>
    </main>

    <!-- Loading State -->
    <div
      v-if="isLoading"
      class="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50"
    >
      <div class="text-center">
        <div class="animate-spin w-16 h-16 border-4 border-spotify-green border-t-transparent rounded-full mb-4 mx-auto"></div>
        <p class="text-spotify-lightgray text-lg">{{ loadingMessage }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import NowPlaying from './components/NowPlaying.vue'
import UserInfo from './components/UserInfo.vue'
import RecentTracks from './components/RecentTracks.vue'
import { useSpotifyAuth } from './composables/useSpotifyAuth'
import { useSpotifyAPI } from './composables/useSpotifyAPI'

const { isAuthenticated, login, logout, getAccessToken } = useSpotifyAuth()
const { getCurrentTrack, getLyrics, getRecentTracks, getUserProfile } = useSpotifyAPI()

const isLoading = ref(false)
const error = ref<string | null>(null)
const loadingMessage = ref('Loading...')
const currentTrack = ref(null)
const currentLyrics = ref('')
const userInfo = ref(null)
const recentTracks = ref([])

const displayError = computed(() => error.value)

onMounted(async () => {
  // Check for callback parameter
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  
  if (code) {
    try {
      isLoading.value = true
      loadingMessage.value = 'Authenticating with Spotify...'
      const { handleCallback } = useSpotifyAuth()
      await handleCallback(code)
      window.history.replaceState({}, document.title, window.location.pathname)
      await fetchUserData()
    } catch (err) {
      error.value = 'Failed to authenticate with Spotify'
      console.error('Authentication error:', err)
    } finally {
      isLoading.value = false
    }
  } else if (isAuthenticated.value) {
    await fetchUserData()
  }
})

async function fetchUserData() {
  try {
    isLoading.value = true
    loadingMessage.value = 'Loading your profile...'
    
    const token = await getAccessToken()
    
    loadingMessage.value = 'Fetching user profile...'
    userInfo.value = await getUserProfile(token)
    
    loadingMessage.value = 'Getting current track...'
    currentTrack.value = await getCurrentTrack(token)
    
    loadingMessage.value = 'Loading recent tracks...'
    recentTracks.value = await getRecentTracks(token)
    
    if (currentTrack.value) {
      loadingMessage.value = 'Searching for lyrics...'
      currentLyrics.value = await getLyrics(currentTrack.value.name, currentTrack.value.artists[0].name)
    }
    
    error.value = null
  } catch (err: any) {
    const message = err?.message || 'Failed to load user data'
    error.value = message
    console.error('Error fetching user data:', err)
  } finally {
    isLoading.value = false
  }
}

async function refreshCurrentTrack() {
  try {
    isLoading.value = true
    loadingMessage.value = 'Refreshing current track...'
    
    const token = await getAccessToken()
    currentTrack.value = await getCurrentTrack(token)
    
    if (currentTrack.value) {
      loadingMessage.value = 'Searching for lyrics...'
      currentLyrics.value = await getLyrics(currentTrack.value.name, currentTrack.value.artists[0].name)
    } else {
      currentLyrics.value = ''
    }
    
    error.value = null
  } catch (err: any) {
    error.value = 'Failed to refresh track'
    console.error('Error refreshing track:', err)
  } finally {
    isLoading.value = false
  }
}

async function selectTrack(track: any) {
  try {
    currentTrack.value = track
    isLoading.value = true
    loadingMessage.value = 'Searching for lyrics...'
    
    currentLyrics.value = await getLyrics(track.name, track.artists[0].name)
    error.value = null
  } catch (err: any) {
    error.value = 'Failed to fetch lyrics'
    console.error('Error fetching lyrics:', err)
  } finally {
    isLoading.value = false
  }
}
</script>

<style scoped>
</style>
