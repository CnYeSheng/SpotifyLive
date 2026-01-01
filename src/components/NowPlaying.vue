<template>
  <div class="bg-spotify-darkgray rounded-lg p-8 shadow-lg">
    <h2 class="text-3xl font-bold mb-6 text-spotify-green">Now Playing</h2>
    
    <div v-if="track" class="space-y-6">
      <!-- Album Art -->
      <div class="flex justify-center">
        <img
          v-if="track.album.images[0]"
          :src="track.album.images[0].url"
          :alt="track.album.name"
          class="w-64 h-64 rounded-lg shadow-xl object-cover"
        />
        <div v-else class="w-64 h-64 bg-spotify-darkgray rounded-lg flex items-center justify-center">
          <span class="text-spotify-lightgray">No image</span>
        </div>
      </div>

      <!-- Track Info -->
      <div class="text-center">
        <h3 class="text-2xl font-bold mb-2">{{ track.name }}</h3>
        <p class="text-spotify-lightgray mb-4">
          {{ track.artists.map((a: any) => a.name).join(', ') }}
        </p>
        <p class="text-spotify-lightgray text-sm mb-4">{{ track.album.name }}</p>
      </div>

      <!-- Lyrics -->
      <div class="bg-spotify-black rounded-lg p-6 max-h-96 overflow-y-auto">
        <h4 class="text-xl font-bold mb-4 text-spotify-green">Lyrics</h4>
        <div v-if="lyrics" class="space-y-2 text-center">
          <p
            v-for="(line, index) in lyrics.split('\n')"
            :key="index"
            class="text-spotify-lightgray leading-relaxed hover:text-spotify-green transition"
          >
            {{ line }}
          </p>
        </div>
        <div v-else class="text-center text-spotify-lightgray py-8">
          <p>Lyrics not available</p>
        </div>
      </div>

      <!-- Controls -->
      <div class="flex justify-center gap-4">
        <button
          @click="refresh"
          class="px-6 py-2 bg-spotify-green text-black font-bold rounded-full hover:bg-opacity-90 transition"
        >
          Refresh
        </button>
        <a
          v-if="track.external_urls.spotify"
          :href="track.external_urls.spotify"
          target="_blank"
          rel="noopener noreferrer"
          class="px-6 py-2 bg-spotify-lightgray text-black font-bold rounded-full hover:bg-opacity-90 transition"
        >
          Open in Spotify
        </a>
      </div>

      <!-- Track Details -->
      <div class="grid grid-cols-2 gap-4 text-sm">
        <div class="bg-spotify-black rounded-lg p-4">
          <p class="text-spotify-lightgray">Duration</p>
          <p class="font-bold">{{ formatDuration(track.duration_ms) }}</p>
        </div>
        <div class="bg-spotify-black rounded-lg p-4">
          <p class="text-spotify-lightgray">Popularity</p>
          <p class="font-bold">{{ track.popularity }}%</p>
        </div>
        <div class="bg-spotify-black rounded-lg p-4">
          <p class="text-spotify-lightgray">Explicit</p>
          <p class="font-bold">{{ track.explicit ? 'Yes' : 'No' }}</p>
        </div>
        <div class="bg-spotify-black rounded-lg p-4">
          <p class="text-spotify-lightgray">Release Date</p>
          <p class="font-bold">{{ track.album.release_date }}</p>
        </div>
      </div>
    </div>

    <div v-else class="text-center py-12">
      <p class="text-spotify-lightgray">No track currently playing</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  track: any
  lyrics: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  refresh: []
}>()

const formatDuration = (ms: number) => {
  const minutes = Math.floor(ms / 60000)
  const seconds = ((ms % 60000) / 1000).toFixed(0)
  return `${minutes}:${parseInt(seconds) < 10 ? '0' : ''}${seconds}`
}

const refresh = () => {
  emit('refresh')
}
</script>

<style scoped>
</style>
