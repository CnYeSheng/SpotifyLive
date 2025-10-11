// 🔧 測試單首歌曲數據映射
const testTrack = {
    "album": {
        "images": [
            {
                "height": 640,
                "url": "https://i.scdn.co/image/ab67616d0000b273e78e011c3e8eb1b6b923ae66",
                "width": 640
            }
        ],
        "name": "SIN CITY 萬惡城市"
    },
    "artists": [
        {
            "name": "187INC"
        },
        {
            "name": "頑童Mj116"
        }
    ],
    "id": "6Q59P3EK6dM6TUrjDsT6ug",
    "name": "每天都是生日 (feat. 頑童MJ116)",
    "duration_ms": 304875
};

console.log('🔍 測試數據映射:');
console.log('原始track:', {
    name: testTrack.name,
    artists: testTrack.artists.map(a => a.name),
    albumImage: testTrack.album.images[0]?.url
});

// 後端映射邏輯測試
const trackData = {
    id: testTrack.id,
    name: testTrack.name,
    artist: testTrack.artists?.map(a => a.name).join(', ') || '未知歌手',
    image: testTrack.album?.images?.[0]?.url || null,
    duration: testTrack.duration_ms
};

console.log('映射後數據:', trackData);

console.log('驗證結果:', {
    hasName: !!trackData.name,
    hasArtist: !!trackData.artist && trackData.artist !== '未知歌手',
    hasImage: !!trackData.image,
    artistCorrect: trackData.artist === "187INC, 頑童Mj116",
    imageCorrect: trackData.image === "https://i.scdn.co/image/ab67616d0000b273e78e011c3e8eb1b6b923ae66"
});
