// public/stats.js

document.addEventListener('DOMContentLoaded', () => {
    const loading = document.getElementById('loading');
    const rangeBtns = document.querySelectorAll('.range-btn');
    const totalTimeEl = document.getElementById('total-time');
    const totalSongsEl = document.getElementById('total-songs');
    const uniqueSongsEl = document.getElementById('unique-songs');
    const topSongsList = document.getElementById('top-songs-list');
    const historyList = document.getElementById('history-list');

    // 分享功能相關元素
    const shareBtn = document.getElementById('share-btn');
    const ratioBtns = document.querySelectorAll('.ratio-btn');
    const sharePreview = document.getElementById('share-preview');
    const closePreview = document.getElementById('close-preview');
    const downloadShareImage = document.getElementById('download-share-image');
    const shareCardPreview = document.getElementById('share-card-preview');

    let currentDays = 1;
    let refreshInterval;
    let currentRatio = '16:9';
    let currentStatsData = null;

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

    // 分享按鈕點擊事件
    shareBtn?.addEventListener('click', () => {
        if (currentStatsData) {
            renderShareCard(currentStatsData);
            sharePreview.classList.add('show');
        }
    });

    // 關閉預覽
    closePreview?.addEventListener('click', () => {
        sharePreview.classList.remove('show');
    });

    // 點擊背景關閉
    sharePreview?.addEventListener('click', (e) => {
        if (e.target === sharePreview) {
            sharePreview.classList.remove('show');
        }
    });

    // 比例選擇器
    ratioBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            ratioBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentRatio = btn.dataset.ratio;
            if (currentStatsData) {
                renderShareCard(currentStatsData);
            }
        });
    });

    // 下載分享圖片
    downloadShareImage?.addEventListener('click', async () => {
        if (!shareCardPreview) return;
        
        try {
            const originalText = downloadShareImage.innerHTML;
            downloadShareImage.innerHTML = '生成中...';
            downloadShareImage.disabled = true;
            
            const canvas = await html2canvas(shareCardPreview, {
                backgroundColor: null,
                scale: 2,
                useCORS: true,
                logging: false
            });
            
            const link = document.createElement('a');
            link.download = `spotify-stats-${currentRatio}-${new Date().toISOString().split('T')[0]}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
            
            downloadShareImage.innerHTML = originalText;
            downloadShareImage.disabled = false;
        } catch (error) {
            console.error('生成圖片失敗:', error);
            alert('生成圖片失敗，請稍後再試');
            downloadShareImage.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: middle; margin-right: 6px;">
                    <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                </svg>
                下載圖片
            `;
            downloadShareImage.disabled = false;
        }
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
        // 保存當前數據供分享使用
        currentStatsData = data;

        // Update summary cards
        const hours = Math.floor(data.totalDurationMs / (1000 * 60 * 60));
        const minutes = Math.floor((data.totalDurationMs % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((data.totalDurationMs % (1000 * 60)) / 1000);
        
        totalTimeEl.textContent = `${hours} 時 ${minutes} 分 ${seconds} 秒`;
        totalSongsEl.textContent = data.songCount;
        uniqueSongsEl.textContent = data.topSongs.length;

        // Update Top Songs List
        topSongsList.innerHTML = data.topSongs.map(song => `
            <li class="song-item">
                <div class="song-info">
                    <span class="song-name">${escapeHtml(song.trackName)}</span>
                    <span class="song-artist">${escapeHtml(song.artistName)}</span>
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

    // 渲染分享卡片
    function renderShareCard(data) {
        if (!shareCardPreview) return;

        const hours = Math.floor(data.totalDurationMs / (1000 * 60 * 60));
        const minutes = Math.floor((data.totalDurationMs % (1000 * 60 * 60)) / (1000 * 60));
        const songCount = data.songCount;
        const uniqueCount = data.topSongs.length;

        // 根據比例設定卡片尺寸
        let cardWidth, cardHeight;
        switch (currentRatio) {
            case '16:9':
                cardWidth = 800;
                cardHeight = 450;
                break;
            case '9:16':
                cardWidth = 450;
                cardHeight = 800;
                break;
            case '1:1':
                cardWidth = 600;
                cardHeight = 600;
                break;
            case '4:3':
                cardWidth = 800;
                cardHeight = 600;
                break;
            default:
                cardWidth = 800;
                cardHeight = 450;
        }

        shareCardPreview.style.width = `${cardWidth}px`;
        shareCardPreview.style.minHeight = `${cardHeight}px`;

        // 取得前 5 首歌曲
        const top5 = data.topSongs.slice(0, 5);

        // 格式化時間範圍標籤
        const rangeLabel = getRangeLabel(currentDays);

        // 生成卡片 HTML
        shareCardPreview.innerHTML = `
            <div class="share-card-header">
                <svg class="share-card-logo" viewBox="0 0 24 24" fill="#1db954">
                    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                </svg>
                <span class="share-card-title">Spotify 聽歌統計</span>
            </div>
            
            <div class="share-card-stats">
                <div class="share-stat-item">
                    <div class="share-stat-value">${hours}h ${minutes}m</div>
                    <div class="share-stat-label">總聽歌時長</div>
                </div>
                <div class="share-stat-item">
                    <div class="share-stat-value">${songCount}</div>
                    <div class="share-stat-label">聽歌次數</div>
                </div>
                <div class="share-stat-item">
                    <div class="share-stat-value">${uniqueCount}</div>
                    <div class="share-stat-label">不重複歌曲</div>
                </div>
                <div class="share-stat-item">
                    <div class="share-stat-value">${rangeLabel}</div>
                    <div class="share-stat-label">統計期間</div>
                </div>
            </div>

            ${top5.length > 0 ? `
            <div class="share-card-top5">
                <div class="share-card-top5-title">🔥 Top 5 最常聽</div>
                <ul class="share-top5-list">
                    ${top5.map((song, index) => {
                        return `
                            <li class="share-top5-item">
                                <div class="share-top5-rank">${index + 1}</div>
                                <div class="share-top5-info">
                                    <div class="share-top5-name">${escapeHtml(song.trackName)}</div>
                                    <div class="share-top5-artist">${escapeHtml(song.artistName)}</div>
                                </div>
                                <div class="share-top5-count">${song.count} 次</div>
                            </li>
                        `;
                    }).join('')}
                </ul>
            </div>
            ` : ''}

            <div class="share-card-footer">
                <span>Spotify 即時歌詞播放器</span>
                <span>${new Date().toLocaleDateString('zh-TW')}</span>
            </div>
        `;
    }

    // 獲取時間範圍標籤
    function getRangeLabel(days) {
        switch (days) {
            case 1: return '今日';
            case 2: return '昨天';
            case 7: return '7天';
            case 30: return '30天';
            case 60: return '60天';
            case 90: return '90天';
            default: return `${days}天`;
        }
    }

    // HTML 轉義函數
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
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
