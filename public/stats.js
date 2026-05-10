// public/stats.js

document.addEventListener('DOMContentLoaded', () => {
    const loading = document.getElementById('loading');
    const rangeBtns = document.querySelectorAll('.time-range-selector .range-btn');
    const totalTimeEl = document.getElementById('total-time');
    const totalSongsEl = document.getElementById('total-songs');
    const uniqueSongsEl = document.getElementById('unique-songs');
    const topSongsList = document.getElementById('top-songs-list');
    const topPlaylistsList = document.getElementById('top-playlists-list');
    const historyList = document.getElementById('history-list');
    const dateRangeDisplay = document.getElementById('date-range-display');

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
    let sessionManager = null;

    // 初始化 Session 管理器
    const playerMock = {
        get sessionId() { return localStorage.getItem('spotify_session_id'); },
        set sessionId(val) { 
            if (val) localStorage.setItem('spotify_session_id', val);
            else localStorage.removeItem('spotify_session_id');
        },
        handle401Error: async () => {
            console.log('Session expired, redirecting to auth...');
            window.location.href = '/api/auth';
        }
    };

    if (typeof EnhancedSessionManager !== 'undefined') {
        sessionManager = new EnhancedSessionManager(playerMock);
        console.log('✅ Stats 頁面 Session 管理器已啟動');
        
        // 如果沒有 sessionId，延遲一下觸發自動登入
        if (!playerMock.sessionId) {
            setTimeout(() => {
                console.log('No session ID found, triggering auto-login...');
                window.location.href = '/api/auth';
            }, 2000);
        }
    }

    // Fetch stats on load
    fetchStats(currentDays);
    startAutoRefresh();
    
    // 初始化選擇器滑塊位置
    setTimeout(() => {
        document.querySelectorAll('.time-range-selector, .ratio-selector').forEach(selector => {
            updateSelectorPill(selector);
        });
    }, 100);

    // Range selector click handler
    rangeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            rangeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentDays = parseInt(btn.dataset.days);
            fetchStats(currentDays);
            
            // 更新滑塊
            updateSelectorPill(btn.parentElement);
            
            // 平滑滾動到選擇項 (行動版)
            btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });

            // Restart auto-refresh to sync with the manual click
            stopAutoRefresh();
            startAutoRefresh();
        });
    });

    // 分享按鈕點擊事件
    shareBtn?.addEventListener('click', () => {
        if (currentStatsData) {
            sharePreview.classList.add('show');
            requestAnimationFrame(() => renderShareCard(currentStatsData));
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
            
            // 更新滑塊
            updateSelectorPill(btn.parentElement);
            
            // 平滑滾動到選擇項 (行動版)
            btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });

            if (currentStatsData) {
                renderShareCard(currentStatsData);
            }
        });
    });

    // 輔助函數：更新選擇器滑塊位置
    function updateSelectorPill(selectorContainer) {
        const activeBtn = selectorContainer.querySelector('.active');
        const pill = selectorContainer.querySelector('.selector-pill');
        if (!activeBtn || !pill) return;

        pill.style.width = `${activeBtn.offsetWidth}px`;
        pill.style.left = `${activeBtn.offsetLeft}px`;
    }

    // 清理重複紀錄按鈕
    const deduplicateBtn = document.getElementById('deduplicate-btn');
    deduplicateBtn?.addEventListener('click', async () => {
        if (!confirm('確定要執行自動修復並清理重複的播放紀錄嗎？')) return;
        
        try {
            deduplicateBtn.disabled = true;
            deduplicateBtn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2v4l3-3-3-1zm0 20v-4l-3 3 3 1zm8.49-13.49l-2.83 2.83 4.24.01-1.41-2.84zM2.1 12.65l1.41 2.84 2.83-2.83-4.24-.01zm16.38 5.83l-2.83-2.83-.01 4.24 2.84-1.41zM5.52 5.52l2.83 2.83.01-4.24-2.84 1.41z"/>
                </svg>
                <span>清理中...</span>
            `;
            
            const sessionId = localStorage.getItem('spotify_session_id');
            const response = await fetch('/api/history/deduplicate', {
                headers: sessionId ? { 'X-Session-Id': sessionId } : {}
            });
            
            const result = await response.json();
            
            if (result.success) {
                alert(result.message || '清理完成！');
                fetchStats(currentDays); // 刷新數據
            } else {
                alert('清理失敗: ' + (result.error || '未知錯誤'));
            }
        } catch (error) {
            console.error('Deduplication failed:', error);
            alert('無法連接到伺服器，請稍後再試。');
        } finally {
            deduplicateBtn.disabled = false;
            deduplicateBtn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M9 3L5 6.99h3V14h2V6.99h3L9 3zm7 14.01V10h-2v7.01h-3L15 21l4-3.99h-3z"/>
                </svg>
                <span>清理重複</span>
            `;
        }
    });

    // 下載分享圖片
    downloadShareImage?.addEventListener('click', async () => {
        if (!shareCardPreview) return;
        
        try {
            const originalText = downloadShareImage.innerHTML;
            downloadShareImage.innerHTML = '生成中...';
            downloadShareImage.disabled = true;
            
            // 重置縮放以確保捕捉到完整尺寸
            const originalTransform = shareCardPreview.style.transform;
            shareCardPreview.style.transform = 'none';
            
            // 給瀏覽器一點時間重繪（處理 transform 切換）
            await new Promise(resolve => setTimeout(resolve, 100));
            
            const canvas = await html2canvas(shareCardPreview, {
                backgroundColor: null,
                scale: 1, // 已經是高解析度尺寸了
                useCORS: true,
                logging: false,
                width: shareCardPreview.offsetWidth,
                height: shareCardPreview.offsetHeight
            });
            
            // 恢復縮放
            shareCardPreview.style.transform = originalTransform;
            
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
        }, 10000); // 10 秒檢查一次
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
            
            if (response.status === 401) {
                console.error('Fetch stats failed: Session expired');
                if (sessionManager) {
                    sessionManager.onSessionExpired('api-401-error');
                } else {
                    window.location.href = '/api/auth';
                }
                return;
            }

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();

            if (data.success) {
                updateUI(data);
                updateDateRangeDisplay();
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

    function updateDateRangeDisplay() {
        if (!dateRangeDisplay) return;
        
        const now = new Date();
        const endDate = new Date(now);
        const startDate = new Date(now);
        
        if (currentDays === 1) {
            // 今日
            dateRangeDisplay.textContent = `📅 統計範圍: ${now.toLocaleDateString('zh-TW')}`;
        } else if (currentDays === 2) {
            // 昨天
            startDate.setDate(now.getDate() - 1);
            dateRangeDisplay.textContent = `📅 統計範圍: ${startDate.toLocaleDateString('zh-TW')} (昨日)`;
        } else {
            // 過去 X 天
            startDate.setDate(now.getDate() - currentDays + 1);
            dateRangeDisplay.textContent = `📅 統計範圍: ${startDate.toLocaleDateString('zh-TW')} - ${endDate.toLocaleDateString('zh-TW')}`;
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
        
        // 優化顯示：包含秒數
        totalTimeEl.textContent = hours > 0 ? `${hours}h ${minutes}m ${seconds}s` : `${minutes}m ${seconds}s`;
        totalSongsEl.textContent = data.songCount.toLocaleString();
        uniqueSongsEl.textContent = (data.uniqueSongCount ?? data.topSongs.length).toLocaleString();

        // Update Top Songs List
        topSongsList.innerHTML = data.topSongs.map((song, index) => `
            <li class="song-item">
                <div style="display: flex; align-items: center; gap: 20px; flex: 1;">
                    <div style="font-size: 18px; font-weight: 800; color: var(--spotify-green); width: 30px; text-align: center; opacity: 0.8;">${index + 1}</div>
                    <div class="song-info">
                        <span class="song-name">${escapeHtml(song.trackName)}</span>
                        <span class="song-artist">${escapeHtml(song.artistName)}</span>
                    </div>
                </div>
                <div class="song-count">${song.count} 次</div>
            </li>
        `).join('') || '<li class="song-item">暫無數據</li>';

        // Update Top Playlists List
        if (topPlaylistsList && data.topPlaylists) {
            // 保存當前展開的歌單 ID 和內容
            const expandedPlaylists = new Map();
            document.querySelectorAll('.playlist-item.expanded').forEach(item => {
                const playlistId = item.dataset.playlistId;
                const expandedDiv = document.getElementById(`playlist-${playlistId}`);
                if (expandedDiv && expandedDiv.dataset.loaded) {
                    expandedPlaylists.set(playlistId, {
                        html: expandedDiv.innerHTML,
                        loaded: true
                    });
                } else {
                    expandedPlaylists.set(playlistId, { loaded: false });
                }
            });
            
            topPlaylistsList.innerHTML = data.topPlaylists.map((playlist, index) => {
                let playlistId = null;
                let displayName = escapeHtml(playlist.name);
                
                if (playlist.name.startsWith('Playlist:')) {
                    playlistId = playlist.name.split(':')[1];
                    displayName = '載入中...';
                } else if (playlist.uri) {
                    playlistId = playlist.uri.split(':')[2];
                }
                
                return `
                    <div class="playlist-group">
                        <div class="song-item playlist-item" data-playlist-id="${playlistId || ''}" data-playlist-name="${escapeHtml(playlist.name)}">
                            <div style="display: flex; align-items: center; gap: 20px; flex: 1;">
                                <div style="font-size: 18px; font-weight: 800; color: var(--spotify-green); width: 30px; text-align: center; opacity: 0.8;">${index + 1}</div>
                                <div class="song-info">
                                    <span class="song-name">${displayName}</span>
                                    <span class="song-artist">${playlist.uniqueTracks} 首歌曲 · ${playlist.count} 次播放</span>
                                </div>
                            </div>
                            <svg class="expand-icon" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
                            </svg>
                        </div>
                        <div class="playlist-tracks-expanded" id="playlist-${playlistId}" style="display: none;">
                            <div class="loading-tracks">載入中...</div>
                        </div>
                    </div>
                `;
            }).join('') || '<div class="no-playlists">暫無歌單數據</div>';
            
            // ... rest of the logic remains same ...
            
            // 恢復之前展開的歌單狀態和內容
            expandedPlaylists.forEach((savedData, id) => {
                const item = document.querySelector(`.playlist-item[data-playlist-id="${id}"]`);
                const expandedDiv = document.getElementById(`playlist-${id}`);
                if (item && expandedDiv) {
                    item.classList.add('expanded');
                    expandedDiv.style.display = 'block';
                    const icon = item.querySelector('.expand-icon');
                    if (icon) icon.style.transform = 'rotate(180deg)';
                    
                    // 如果之前已載入內容，恢復它
                    if (savedData.loaded && savedData.html) {
                        expandedDiv.innerHTML = savedData.html;
                        expandedDiv.dataset.loaded = 'true';
                    }
                }
            });
            
            // 添加點擊事件 - 展開/收起
            document.querySelectorAll('.playlist-item').forEach(item => {
                const playlistId = item.dataset.playlistId;
                const playlistName = item.dataset.playlistName;
                const expandedDiv = document.getElementById(`playlist-${playlistId}`);
                const icon = item.querySelector('.expand-icon');
                const nameSpan = item.querySelector('.song-name');

                // 如果名稱是 "載入中..."，自動觸發名稱獲取
                if (nameSpan && nameSpan.textContent === '載入中...' && playlistId) {
                    fetch(`/api/playlist/${playlistId}?days=${currentDays}`)
                        .then(res => res.json())
                        .then(pData => {
                            if (pData.success && pData.playlist) {
                                nameSpan.textContent = pData.playlist.name;
                                item.dataset.playlistName = pData.playlist.name;
                                // 同步更新分享數據中的名稱
                                if (currentStatsData && currentStatsData.topPlaylists) {
                                    const p = currentStatsData.topPlaylists.find(pl => 
                                        pl.uri?.includes(playlistId) || pl.name.includes(playlistId) || pl.id === playlistId
                                    );
                                    if (p) p.name = pData.playlist.name;
                                }
                            }
                        }).catch(err => console.error('Failed to auto-fetch playlist name:', err));
                }
                
                item.addEventListener('click', async () => {
                    const playlistId = item.dataset.playlistId;
                    const playlistName = item.dataset.playlistName;
                    const expandedDiv = document.getElementById(`playlist-${playlistId}`);
                    const icon = item.querySelector('.expand-icon');
                    
                    if (!playlistId || !expandedDiv) return;
                    
                    // 如果已經展開，則收起
                    if (expandedDiv.style.display !== 'none' && expandedDiv.style.display !== '') {
                        expandedDiv.style.display = 'none';
                        icon.style.transform = 'rotate(0deg)';
                        item.classList.remove('expanded');
                        return;
                    }
                    
                    // 展開並載入歌曲
                    expandedDiv.style.display = 'block';
                    icon.style.transform = 'rotate(180deg)';
                    item.classList.add('expanded');
                    
                    // 如果還沒有載入過，或者 timeframe 變了，則 fetch
                    if (!expandedDiv.dataset.loaded || expandedDiv.dataset.loadedDays != currentDays) {
                        await loadPlaylistTracks(playlistId, expandedDiv);
                    }
                });
                
                // 雙擊強制刷新歌單數據
                item.addEventListener('dblclick', async (e) => {
                    e.stopPropagation(); // 防止觸發單擊事件
                    const playlistId = item.dataset.playlistId;
                    const expandedDiv = document.getElementById(`playlist-${playlistId}`);
                    
                    if (!playlistId || !expandedDiv) return;
                    
                    // 清除 loaded 標記並重新載入
                    delete expandedDiv.dataset.loaded;
                    expandedDiv.innerHTML = '<div class="loading-tracks">重新載入中...</div>';
                    await loadPlaylistTracks(playlistId, expandedDiv);
                });
            });
        }

        // 輔助函數：載入歌單歌曲
        async function loadPlaylistTracks(playlistId, expandedDiv) {
            try {
                console.log('🔍 Fetching tracks for playlist:', playlistId);
                const response = await fetch(`/api/playlist/${playlistId}`);
                const data = await response.json();
                
                if (data.success && data.tracks && data.tracks.length > 0) {
                    expandedDiv.innerHTML = `
                        <div class="tracks-header">
                            <span>${data.tracks.length} 首播放過的歌曲</span>
                        </div>
                        <ul class="expanded-track-list">
                            ${data.tracks.map((track, index) => `
                                <li class="expanded-track-item">
                                    <span class="track-num">${index + 1}</span>
                                    <div class="expanded-track-info">
                                        <div class="expanded-track-name">${escapeHtml(track.name)}</div>
                                        <div class="expanded-track-artist">${escapeHtml(track.artist || '未知歌手')}</div>
                                    </div>
                                    <div class="expanded-track-count">${track.playCount} 次</div>
                                </li>
                            `).join('')}
                        </ul>
                    `;
                    expandedDiv.dataset.loaded = 'true';
                } else {
                    expandedDiv.innerHTML = '<div class="no-tracks">這個歌單還沒有播放過任何歌曲</div>';
                }
            } catch (error) {
                console.error('Failed to fetch playlist tracks:', error);
                expandedDiv.innerHTML = '<div class="error-tracks">載入失敗，請稍後再試</div>';
            }
        }

        // Update History List
        historyList.innerHTML = data.history.map(item => {
            const date = new Date(item.playedAt);
            const timeStr = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
            const dateStr = `${date.getFullYear()}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}`;
            
            const dMs = item.durationMs || 0;
            const dMin = Math.floor(dMs / 60000);
            const dSec = Math.floor((dMs % 60000) / 1000);
            const durationStr = `${dMin}:${dSec.toString().padStart(2, '0')}`;
            
            return `
                <li class="song-item">
                    <div class="song-info">
                        <span class="song-name">${escapeHtml(item.trackName)}</span>
                        <span class="song-artist">${escapeHtml(item.artistName)}</span>
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
        const seconds = Math.floor((data.totalDurationMs % (1000 * 60)) / 1000);
        const totalTimeText = `${hours}h ${minutes}m ${seconds}s`;
        const songCount = data.songCount;
        const uniqueCount = data.uniqueSongCount ?? data.topSongs.length;

        // 根據比例設定卡片尺寸 (使用用戶指定的像素值)
        let cardWidth, cardHeight;
        let ratioClass = '';
        let isLandscape = false;

        switch (currentRatio) {
            case '16:9':
                cardWidth = 1920;
                cardHeight = 1080;
                ratioClass = 'ratio-16-9';
                isLandscape = true;
                break;
            case '9:16':
                cardWidth = 1080;
                cardHeight = 1920;
                ratioClass = 'ratio-9-16';
                isLandscape = false;
                break;
            case '1:1':
                cardWidth = 1080;
                cardHeight = 1080;
                ratioClass = 'ratio-1-1';
                isLandscape = true;
                break;
            case '4:3':
                cardWidth = 1350;
                cardHeight = 1012;
                ratioClass = 'ratio-4-3';
                isLandscape = true;
                break;
            case '4:5':
                cardWidth = 1080;
                cardHeight = 1350;
                ratioClass = 'ratio-4-5';
                isLandscape = false; // 恢復垂直佈局
                break;
            case '3:4':
                cardWidth = 1012;
                cardHeight = 1350;
                ratioClass = 'ratio-3-4';
                isLandscape = false; // 恢復垂直佈局
                break;
            case '5:4':
                cardWidth = 1350;
                cardHeight = 1080;
                ratioClass = 'ratio-5-4';
                isLandscape = true;
                break;
            default:
                cardWidth = 1920;
                cardHeight = 1080;
                ratioClass = 'ratio-16-9';
                isLandscape = true;
        }

        shareCardPreview.style.width = `${cardWidth}px`;
        shareCardPreview.style.height = `${cardHeight}px`;
        shareCardPreview.className = `share-card ${ratioClass}`;

        // 預覽縮放處理
        const wrapper = document.querySelector('.share-preview-wrapper');
        if (wrapper) {
            // 如果容器寬度為 0 (可能尚未完全渲染)，則嘗試從父容器取得
            const maxWidth = wrapper.offsetWidth || (window.innerWidth * 0.8);
            const maxHeight = window.innerHeight * 0.6;
            const scale = Math.min(maxWidth / cardWidth, maxHeight / cardHeight) || 0.5;
            
            shareCardPreview.style.transform = `scale(${scale})`;
            shareCardPreview.style.transformOrigin = 'center center';
            
            // 調整容器高度以匹配縮放後的卡片
            wrapper.style.height = `${cardHeight * scale}px`;
        }

        // 取得前 5 首歌曲和前 5 個歌單
        const top5 = data.topSongs.slice(0, 5);
        const topPlaylists = (data.topPlaylists || []).slice(0, 5);


        // 格式化時間範圍標籤與具體日期
        const rangeLabel = getRangeLabel(currentDays);
        let detailedDate = '';
        const now = new Date();
        const startDate = new Date(now);
        
        if (currentDays === 1) {
            detailedDate = now.toLocaleDateString('zh-TW');
        } else if (currentDays === 2) {
            startDate.setDate(now.getDate() - 1);
            detailedDate = startDate.toLocaleDateString('zh-TW');
        } else {
            startDate.setDate(now.getDate() - currentDays + 1);
            detailedDate = `${startDate.getMonth() + 1}/${startDate.getDate()} - ${now.getMonth() + 1}/${now.getDate()}`;
        }

        // 生成卡片 HTML
        shareCardPreview.innerHTML = `
            <!-- 裝飾性背景元素 -->
            <div class="share-card-bg-blob blob-1"></div>
            <div class="share-card-bg-blob blob-2"></div>
            <div class="share-card-bg-blob blob-3"></div>
            
            <div class="share-card-header">
                <svg class="share-card-logo" viewBox="0 0 24 24" fill="#1db954">
                    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                </svg>
                <span class="share-card-title">Spotify 聽歌回顧</span>
            </div>
            
            <div class="share-card-stats">
                <div class="share-stat-item">
                    <div class="share-stat-value time-value">${totalTimeText}</div>
                    <div class="share-stat-label">聽歌時長</div>
                </div>
                <div class="share-stat-item">
                    <div class="share-stat-value">${songCount}</div>
                    <div class="share-stat-label">聽歌次數</div>
                </div>
                <div class="share-stat-item">
                    <div class="share-stat-value">${uniqueCount}</div>
                    <div class="share-stat-label">不重複</div>
                </div>
                <div class="share-stat-item">
                    <div class="share-stat-value" style="font-size: ${detailedDate.length > 10 ? '24px' : '32px'}">${detailedDate}</div>
                    <div class="share-stat-label">${rangeLabel}</div>
                </div>
            </div>

            <div class="share-card-body ${isLandscape ? 'landscape' : ''}">
                <div class="share-card-section">
                    <div class="share-card-top5-title">熱門歌曲</div>
                    <ul class="share-top5-list">
                        ${top5.length > 0 ? top5.map((song, index) => `
                            <li class="share-top5-item">
                                <div class="share-top5-rank">${index + 1}</div>
                                <div class="share-top5-info">
                                    <div class="share-top5-name">${escapeHtml(song.trackName)}</div>
                                    <div class="share-top5-artist">${escapeHtml(song.artistName)}</div>
                                </div>
                                <div class="share-top5-count">${song.count} 次</div>
                            </li>
                        `).join('') : '<li class="share-top5-item">暫無數據</li>'}
                    </ul>
                </div>

                ${(topPlaylists.length > 0 || isLandscape) ? `
                <div class="share-card-section">
                    <div class="share-card-top5-title">熱門歌單</div>
                    <ul class="share-top5-list">
                        ${topPlaylists.length > 0 ? topPlaylists.map((playlist, index) => `
                            <li class="share-top5-item">
                                <div class="share-top5-rank">${index + 1}</div>
                                <div class="share-top5-info">
                                    <div class="share-top5-name">${escapeHtml(playlist.name)}</div>
                                    <div class="share-top5-artist">${playlist.uniqueTracks} 首歌曲</div>
                                </div>
                                <div class="share-top5-count">${playlist.count} 次</div>
                            </li>
                        `).join('') : '<li class="share-top5-item">暫無數據</li>'}
                    </ul>
                </div>
                ` : ''}
            </div>

            <div class="share-card-footer">
                <div class="footer-brand">
                    <span class="footer-app-name">Spotify 即時歌詞播放器</span>
                </div>
                <div class="footer-date-tag">${new Date().toLocaleDateString('zh-TW')}</div>
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

    // 格式化時間（毫秒轉為 M:SS）
    function formatDuration(ms) {
        if (!ms) return '0:00';
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
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

    // --- 歌單詳情模態框相關邏輯 ---
    const playlistModal = document.getElementById('playlist-modal');
    const closeModal = document.getElementById('close-modal');
    const modalPlaylistName = document.getElementById('modal-playlist-name');
    const modalPlaylistDetails = document.getElementById('modal-playlist-details');
    const modalTrackList = document.getElementById('modal-track-list');

    // 關閉模態框
    closeModal?.addEventListener('click', () => {
        playlistModal.style.display = 'none';
        document.body.style.overflow = 'auto';
    });

    // 點擊背景關閉
    window.addEventListener('click', (e) => {
        if (e.target === playlistModal) {
            playlistModal.style.display = 'none';
            document.body.style.overflow = 'auto';
        }
    });

    // 顯示歌單詳情（此函數可被外部調用或未來擴展使用）
    window.showPlaylistDetails = async function(playlistId, playlistName) {
        if (!playlistModal) return;

        modalPlaylistName.textContent = playlistName || '歌單詳情';
        modalTrackList.innerHTML = '<div class="loading-tracks">載入中...</div>';
        modalPlaylistDetails.innerHTML = '';
        
        playlistModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';

        try {
            const response = await fetch(`/api/playlist/${playlistId}`);
            const data = await response.json();

            if (data.success && data.tracks) {
                // 渲染歌曲列表
                modalTrackList.innerHTML = data.tracks.map((track, index) => `
                    <li class="playlist-track-item">
                        <span class="track-number">${index + 1}</span>
                        <div class="track-info">
                            <div class="track-name">${escapeHtml(track.name)}</div>
                            <div class="track-artist">${escapeHtml(track.artist || '未知歌手')}</div>
                        </div>
                        <div class="track-duration">${track.playCount} 次</div>
                    </li>
                `).join('');

                // 如果有歌單資訊，渲染概覽
                if (data.playlistInfo) {
                    modalPlaylistDetails.innerHTML = `
                        <div class="playlist-info-card">
                            <img src="${data.playlistInfo.image || ''}" class="playlist-cover" alt="Cover">
                            <div class="playlist-meta">
                                <div class="playlist-name-large">${escapeHtml(data.playlistInfo.name)}</div>
                                <div class="playlist-description">${escapeHtml(data.playlistInfo.description || '')}</div>
                                <div class="playlist-stats">
                                    <span>${data.tracks.length} 首播放歌曲</span>
                                    <span>建立者: ${escapeHtml(data.playlistInfo.owner || '')}</span>
                                </div>
                            </div>
                        </div>
                    `;
                }
            } else {
                modalTrackList.innerHTML = '<div class="no-tracks">暫無歌曲數據</div>';
            }
        } catch (error) {
            console.error('Failed to fetch playlist details:', error);
            modalTrackList.innerHTML = '<div class="error-tracks">載入失敗</div>';
        }
    };
});
