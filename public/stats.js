// public/stats.js

document.addEventListener('DOMContentLoaded', () => {
    const loading = document.getElementById('loading');
    const rangeBtns = document.querySelectorAll('.range-btn');
    const totalTimeEl = document.getElementById('total-time');
    const totalSongsEl = document.getElementById('total-songs');
    const uniqueSongsEl = document.getElementById('unique-songs');
    const topSongsList = document.getElementById('top-songs-list');
    const historyList = document.getElementById('history-list');

    let currentDays = 1;

    // Fetch stats on load
    fetchStats(currentDays);

    // Range selector click handler
    rangeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            rangeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentDays = parseInt(btn.dataset.days);
            fetchStats(currentDays);
        });
    });

    async function fetchStats(days) {
        loading.style.display = 'flex';
        try {
            const sessionId = localStorage.getItem('spotify_session_id');
            const response = await fetch(`/api/stats/listening?days=${days}`, {
                headers: sessionId ? { 'X-Session-Id': sessionId } : {}
            });
            const data = await response.json();

            if (data.success) {
                updateUI(data);
            } else {
                console.error('Failed to fetch stats:', data.error);
                alert('獲取統計數據失敗: ' + data.error);
            }
        } catch (error) {
            console.error('Error fetching stats:', error);
        } finally {
            loading.style.display = 'none';
        }
    }

    function updateUI(data) {
        // Update summary cards
        const hours = Math.floor(data.totalDurationMs / (1000 * 60 * 60));
        const minutes = Math.floor((data.totalDurationMs % (1000 * 60 * 60)) / (1000 * 60));
        totalTimeEl.textContent = `${hours}h ${minutes}m`;
        
        totalSongsEl.textContent = data.songCount;
        
        // Calculate unique songs count if not provided by backend
        const uniqueSongs = new Set(data.history.map(item => item.trackId)).size;
        uniqueSongsEl.textContent = data.topSongs.length; // Approximate

        // Update Top Songs List
        topSongsList.innerHTML = data.topSongs.map(song => `
            <li class="song-item">
                <div class="song-info">
                    <span class="song-name">${song.name.split(' - ')[0]}</span>
                    <span class="song-artist">${song.name.split(' - ')[1] || '未知歌手'}</span>
                </div>
                <div class="song-count">${song.count} 次</div>
            </li>
        `).join('') || '<li class="song-item">暫無數據</li>';

        // Update History List
        historyList.innerHTML = data.history.map(item => {
            const date = new Date(item.playedAt);
            const timeStr = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
            const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
            
            return `
                <li class="song-item">
                    <div class="song-info">
                        <span class="song-name">${item.trackName}</span>
                        <span class="song-artist">${item.artistName}</span>
                    </div>
                    <div class="song-time">${dateStr} ${timeStr}</div>
                </li>
            `;
        }).join('') || '<li class="song-item">暫無數據</li>';
    }
});
