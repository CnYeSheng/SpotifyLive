<template>
  <div class="bg-spotify-darkgray rounded-lg p-6 shadow-lg">
    <h3 class="text-xl font-bold mb-4 text-spotify-green">Recent Tracks</h3>
    
    <div v-if="tracks && tracks.length > 0" class="space-y-3">
      <button
        v-for="(track, index) in tracks.slice(0, 10)"
        :key="index"
        @click="selectTrack(track)"
        class="w-full text-left p-3 rounded-lg bg-spotify-black hover:bg-opacity-80 transition group"
      >
        <div class="flex items-center space-x-3">
          <img
            v-if="track.album && track.album.images[0]"
            :src="track.album.images[0].url"
            :alt="track.name"
            class="w-12 h-12 rounded object-cover"
          />
          <div class="flex-1 min-w-0">
            <p class="font-bold text-sm truncate group-hover:text-spotify-green transition">
              {{ track.name }}
            </p>
            <p class="text-spotify-lightgray text-xs truncate">
              {{ track.artists.map((a: any) => a.name).join(', ') }}
            </p>
          </div>
        </div>
      </button>
    </div>

    <div v-else class="text-center text-spotify-lightgray py-8">
      <p>No recent tracks</p>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  tracks: any[]
}>()

const emit = defineEmits<{
  select: [track: any]
}>()

const selectTrack = (track: any) => {
  emit('select', track)
}
</script>

<style scoped>
</style>
