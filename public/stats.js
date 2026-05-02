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
    let refreshInterval;

    // Fetch stats on load
    fetchStats(currentDays);
    startAutoRefresh();

    // Range selector click handler
    rangeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            rangeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentDays = parseInt(btn.dataset.days);
            fetchStats(currentDays);
            
            // Restart auto-refresh to sync with the manual click
            stopAutoRefresh();
            startAutoRefresh();
        });
    });

    function startAutoRefresh() {
        refreshInterval = setInterval(() => {
            fetchStats(currentDays, true); // true for silent refresh
        }, 5000); // 5 seconds
    }

    function stopAutoRefresh() {
        if (refreshInterval) {
            clearInterval(refreshInterval);
        }
    }

    async function fetchStats(days, isSilent = false) {
        if (!isSilent) {
            loading.style.display = 'flex';
        }
        try {
            const sessionId = localStorage.getItem('spotify_session_id');
            const response = await fetch(`/api/stats/listening?days=${days}`, {
                headers: sessionId ? { 'X-Session-Id': sessionId } : {}
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();

            if (data.success) {
                updateUI(data);
            } else {
                console.error('Failed to fetch stats:', data.error);
                if (!isSilent) showError('獲取統計數據失敗: ' + data.error);
            }
        } catch (error) {
            console.error('Error fetching stats:', error);
            if (!isSilent) showError('無法連接到伺服器，請檢查網路連線或伺服器狀態。');
        } finally {
            if (!isSilent) loading.style.display = 'none';
        }
    }

    function showError(message) {
        topSongsList.innerHTML = `<li class="song-item error">${message}</li>`;
        historyList.innerHTML = `<li class="song-item error">${message}</li>`;
    }

    function updateUI(data) {
        // Update summary cards
        const hours = Math.floor(data.totalDurationMs / (1000 * 60 * 60));
        const minutes = Math.floor((data.totalDurationMs % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((data.totalDurationMs % (1000 * 60)) / 1000);
        
        totalTimeEl.textContent = `${hours}小時 ${minutes}分 ${seconds}秒`;
        totalSongsEl.textContent = data.songCount;
        uniqueSongsEl.textContent = data.topSongs.length;

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
            const timeStr = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
            const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
            
            const dMs = item.durationMs || 0;
            const dMin = Math.floor(dMs / 60000);
            const dSec = Math.floor((dMs % 60000) / 1000);
            const durationStr = `${dMin}:${dSec.toString().padStart(2, '0')}`;
            
            return `
                <li class="song-item">
                    <div class="song-info">
                        <span class="song-name">${item.trackName}</span>
                        <span class="song-artist">${item.artistName}</span>
                    </div>
                    <div class="song-meta" style="text-align: right;">
                        <div class="song-time">${dateStr} ${timeStr}</div>
                        <div class="song-duration" style="font-size: 0.8rem; opacity: 0.7;">時長: ${durationStr}</div>
                    </div>
                </li>
            `;
        }).join('') || '<li class="song-item">暫無數據</li>';
    }

    // Stop refresh when page is hidden
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopAutoRefresh();
        } else {
            startAutoRefresh();
            fetchStats(currentDays);
        }
    });
});
