<template>
  <div id="app" class="min-h-screen bg-spotify-black text-white">
    <!-- Navigation -->
    <nav class="bg-spotify-darkgray border-b border-spotify-lightgray border-opacity-20">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex justify-between items-center h-16">
          <div class="flex items-center space-x-2">
            <div class="w-8 h-8 bg-spotify-green rounded-full"></div>
            <h1 class="text-2xl font-bold text-spotify-green">Spotify Lyrics</h1>
          </div>
          <button
            v-if="!isAuthenticated"
            @click="login"
            class="px-6 py-2 bg-spotify-green text-black font-bold rounded-full hover:bg-opacity-90 transition"
          >
            Login with Spotify
          </button>
          <button
            v-else
            @click="logout"
            class="px-6 py-2 bg-spotify-green text-black font-bold rounded-full hover:bg-opacity-90 transition"
          >
            Logout
          </button>
        </div>
      </div>
    </nav>

    <!-- Main Content -->
    <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div v-if="!isAuthenticated" class="text-center py-12">
        <h2 class="text-4xl font-bold mb-4">Enhanced Spotify Lyrics Player</h2>
        <p class="text-spotify-lightgray text-lg mb-8">
          Real-time lyrics sync with advanced playback controls
        </p>
        <button
          @click="login"
          class="px-8 py-3 bg-spotify-green text-black font-bold rounded-full hover:bg-opacity-90 transition text-lg"
        >
          Get Started
        </button>
      </div>

      <div v-else class="grid grid-cols-1 md:grid-cols-3 gap-8">
        <!-- Now Playing -->
        <div class="md:col-span-2">
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
    </main>

    <!-- Loading State -->
    <div v-if="isLoading" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
      <div class="text-center">
        <div class="animate-spin w-12 h-12 border-4 border-spotify-green border-t-transparent rounded-full mb-4"></div>
        <p class="text-spotify-lightgray">Loading...</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import NowPlaying from './components/NowPlaying.vue'
import UserInfo from './components/UserInfo.vue'
import RecentTracks from './components/RecentTracks.vue'
import { useSpotifyAuth } from './composables/useSpotifyAuth'
import { useSpotifyAPI } from './composables/useSpotifyAPI'

const { isAuthenticated, login, logout, getAccessToken } = useSpotifyAuth()
const { getCurrentTrack, getLyrics, getRecentTracks, getUserProfile } = useSpotifyAPI()

const isLoading = ref(false)
const currentTrack = ref(null)
const currentLyrics = ref('')
const userInfo = ref(null)
const recentTracks = ref([])

onMounted(async () => {
  if (isAuthenticated.value) {
    await fetchUserData()
  }
})

async function fetchUserData() {
  try {
    isLoading.value = true
    const token = await getAccessToken()
    
    userInfo.value = await getUserProfile(token)
    currentTrack.value = await getCurrentTrack(token)
    recentTracks.value = await getRecentTracks(token)
    
    if (currentTrack.value) {
      currentLyrics.value = await getLyrics(currentTrack.value.name, currentTrack.value.artists[0].name)
    }
  } catch (error) {
    console.error('Error fetching user data:', error)
  } finally {
    isLoading.value = false
  }
}

async function refreshCurrentTrack() {
  try {
    const token = await getAccessToken()
    currentTrack.value = await getCurrentTrack(token)
    if (currentTrack.value) {
      currentLyrics.value = await getLyrics(currentTrack.value.name, currentTrack.value.artists[0].name)
    }
  } catch (error) {
    console.error('Error refreshing track:', error)
  }
}

async function selectTrack(track: any) {
  currentTrack.value = track
  try {
    currentLyrics.value = await getLyrics(track.name, track.artists[0].name)
  } catch (error) {
    console.error('Error fetching lyrics:', error)
  }
}
</script>

<style scoped>
</style>
