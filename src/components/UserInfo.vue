<template>
  <div v-if="user" class="bg-spotify-darkgray rounded-lg p-6 shadow-lg">
    <h3 class="text-xl font-bold mb-4 text-spotify-green">User Profile</h3>
    
    <div class="flex items-center space-x-4 mb-6">
      <img
        v-if="user.images && user.images[0]"
        :src="user.images[0].url"
        :alt="user.display_name"
        class="w-16 h-16 rounded-full"
      />
      <div class="flex-1">
        <h4 class="font-bold text-lg">{{ user.display_name }}</h4>
        <p class="text-spotify-lightgray text-sm">{{ user.product }}</p>
      </div>
    </div>

    <div class="space-y-3 text-sm">
      <div class="flex justify-between">
        <span class="text-spotify-lightgray">Email</span>
        <span class="font-bold">{{ user.email }}</span>
      </div>
      <div class="flex justify-between">
        <span class="text-spotify-lightgray">Followers</span>
        <span class="font-bold">{{ user.followers.total }}</span>
      </div>
      <div class="flex justify-between">
        <span class="text-spotify-lightgray">Country</span>
        <span class="font-bold">{{ user.country }}</span>
      </div>
      <div class="flex justify-between">
        <span class="text-spotify-lightgray">Plan</span>
        <span class="font-bold uppercase">{{ user.product }}</span>
      </div>
    </div>

    <a
      v-if="user.external_urls.spotify"
      :href="user.external_urls.spotify"
      target="_blank"
      rel="noopener noreferrer"
      class="mt-4 block w-full text-center px-4 py-2 bg-spotify-green text-black font-bold rounded hover:bg-opacity-90 transition"
    >
      View Profile
    </a>
  </div>
</template>

<script setup lang="ts">
interface Props {
  user: any
}

defineProps<Props>()
</script>

<style scoped>
</style>
