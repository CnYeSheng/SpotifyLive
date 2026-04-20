// 歌詞搜尋功能擴展
// 為 SpotifyLyricsPlayer 類添加歌詞搜尋和覆蓋功能

// 等待 SpotifyLyricsPlayer 類加载完成
document.addEventListener('DOMContentLoaded', function() {
    // 確保 SpotifyLyricsPlayer 已定義後再擴展
    if (typeof SpotifyLyricsPlayer !== 'undefined') {
        initLyricsSearchFeature();
    } else {
        // 如果還沒有定義，等待一下再試
        setTimeout(() => {
            if (typeof SpotifyLyricsPlayer !== 'undefined') {
                initLyricsSearchFeature();
            }
        }, 1000);
    }
});

function initLyricsSearchFeature() {
    // 擴展 SpotifyLyricsPlayer 類的原型，添加歌詞搜尋方法
    SpotifyLyricsPlayer.prototype.showLyricsSearchModal = function() {
    const modal = document.getElementById('lyrics-search-modal');
    const currentTrackInfo = document.getElementById('current-track-info');
    const currentTrackText = document.getElementById('current-track-text');
    const searchInput = document.getElementById('lyrics-search-input');
    
    // 如果有當前播放的歌曲，顯示當前歌曲信息
    if (this.currentTrack && this.currentTrack.name) {
        currentTrackInfo.style.display = 'block';
        currentTrackText.textContent = `${this.currentTrack.artist} - ${this.currentTrack.name}`;
        searchInput.value = `${this.currentTrack.artist} ${this.currentTrack.name}`;
    } else {
        currentTrackInfo.style.display = 'none';
        searchInput.value = '';
    }
    
    // 隱藏搜尋結果
    document.getElementById('search-results').style.display = 'none';
    document.getElementById('search-loading').style.display = 'none';
    
    modal.style.display = 'flex';
    searchInput.focus();
    this.log('🔍 顯示歌詞搜尋模態框');
};

SpotifyLyricsPlayer.prototype.hideLyricsSearchModal = function() {
    const modal = document.getElementById('lyrics-search-modal');
    modal.style.display = 'none';
    this.log('❌ 隱藏歌詞搜尋模態框');
};

SpotifyLyricsPlayer.prototype.performLyricsSearch = async function() {
    const searchInput = document.getElementById('lyrics-search-input');
    const query = searchInput.value.trim();
    
    if (!query) {
        this.showErrorMessage('請輸入搜尋內容');
        return;
    }

    // 解析 artist 和 title
    let artist = '', title = '';
    
    // 優先嘗試用破折號分隔 (常見格式: 歌手 - 歌名)
    if (query.includes(' - ')) {
        const parts = query.split(' - ');
        artist = parts[0].trim();
        title = parts.slice(1).join(' - ').trim();
    } else if (query.includes('-')) {
        const parts = query.split('-');
        artist = parts[0].trim();
        title = parts.slice(1).join('-').trim();
    } else {
        // 如果沒有破折號，嘗試按空格分割
        const parts = query.split(/\s+/);
        if (parts.length >= 2) {
            // 這是一個粗略的猜測，通常第一部分是歌手
            artist = parts[0].trim();
            title = parts.slice(1).join(' ').trim();
        } else {
            title = query;
        }
    }

    // 如果提供了當前播放歌曲，且搜尋框內容包含當前歌曲信息，優先使用當前歌曲的準確信息
    if (this.currentTrack && (query.includes(this.currentTrack.name) || query.includes(this.currentTrack.artist))) {
        // 如果搜尋內容與當前歌曲高度匹配，使用精確的元數據
        // ✨ 優化：只取第一位歌手
        artist = this.currentTrack.artist.split(/[,;/\\]|\s+&\s+/)[0].trim();
        title = this.currentTrack.name;
    }
    
    // 如果仍然為空（解析失敗），則回退到使用原始 query
    if (!title && query) {
        title = query;
    }

    this.log(`🔍 開始搜尋歌詞: ${artist} - ${title}`);
    
    document.getElementById('search-loading').style.display = 'flex';
    document.getElementById('search-results').style.display = 'none';
    
    try {
        const isWbw = document.getElementById('wbw-checkbox')?.checked;
        const provider = document.getElementById('search-provider-select')?.value || 'auto';
        const wbwParam = isWbw ? '?wbw' : '';
        
        let response;
        if (provider === 'auto') {
            // ✅ 改用多供應商端點 (原本的邏輯)
            response = await fetch(
                `${this.apiBase}/api/lyrics-search-multi/${encodeURIComponent(artist)}/${encodeURIComponent(title)}${wbwParam}`
            );
        } else {
            // ✅ 使用指定供應商端點
            const url = `${this.apiBase}/api/lyrics/${encodeURIComponent(artist)}/${encodeURIComponent(title)}?p=${provider}${isWbw ? '&wbw' : ''}`;
            response = await fetch(url);
        }
        
        if (!response.ok) {
            // 處理 404 情況，這通常表示該供應商未找到歌詞
            if (response.status === 404) {
                this.displayNoResults();
                return;
            }
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();

        if (data.success) {
            if (provider === 'auto') {
                this.displaySearchResults(data.results);
            } else {
                // 如果是單一供應商返回的數據結構與 search-multi 不同，需要包裝一下
                this.displaySearchResults([{
                    provider: provider,
                    success: true,
                    lyrics: data.lyrics,
                    type: data.type,
                    artist: artist,
                    title: title,
                    source: data.provider || provider
                }]);
            }
        } else {
            this.displayNoResults();
        }
    } catch (error) {
        this.log(`❌ 搜尋歌詞失敗: ${error.message}`);
        this.showErrorMessage('搜尋失敗，請稍後重試');
    } finally {
        document.getElementById('search-loading').style.display = 'none';
    }
};

SpotifyLyricsPlayer.prototype.searchCurrentTrackLyrics = function() {
    if (this.currentTrack && this.currentTrack.name) {
        const searchInput = document.getElementById('lyrics-search-input');
        searchInput.value = `${this.currentTrack.artist} ${this.currentTrack.name}`;
        this.performLyricsSearch();
    }
};

SpotifyLyricsPlayer.prototype.displaySearchResults = function(results) {
    const searchResults = document.getElementById('search-results');
    const resultsContainer = document.getElementById('results-container');
    
    // 注入自定義樣式
    if (!document.getElementById('lyrics-search-styles')) {
        const style = document.createElement('style');
        style.id = 'lyrics-search-styles';
        style.textContent = `
            .result-item {
                background: rgba(255, 255, 255, 0.05);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 12px;
                padding: 16px;
                margin-bottom: 12px;
                transition: all 0.2s ease;
                display: flex;
                flex-direction: column;
                gap: 12px;
            }
            .result-item:hover {
                background: rgba(255, 255, 255, 0.1);
                border-color: var(--accent-color, #1db954);
                transform: translateY(-2px);
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
            }
            .result-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .provider-badge {
                display: flex;
                align-items: center;
                gap: 6px;
                font-size: 12px;
                font-weight: 600;
                padding: 4px 8px;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 4px;
                color: #ddd;
            }
            .type-badge {
                font-size: 11px;
                padding: 2px 8px;
                border-radius: 10px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .type-synced {
                background: rgba(29, 185, 84, 0.2);
                color: #1db954;
                border: 1px solid rgba(29, 185, 84, 0.3);
            }
            .type-plain {
                background: rgba(255, 255, 255, 0.1);
                color: #ccc;
            }
            .result-content {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            .result-title {
                font-size: 16px;
                font-weight: 700;
                color: white;
            }
            .result-artist {
                font-size: 14px;
                color: #bbb;
            }
            .result-preview {
                font-size: 13px;
                color: #888;
                font-style: italic;
                margin-top: 8px;
                padding: 8px;
                background: rgba(0, 0, 0, 0.2);
                border-radius: 6px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .result-actions {
                display: flex;
                gap: 10px;
                margin-top: 4px;
            }
            .action-btn {
                flex: 1;
                padding: 8px;
                border: none;
                border-radius: 6px;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                transition: background 0.2s;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
            }
            .use-btn {
                background: var(--accent-color, #1db954);
                color: white;
            }
            .use-btn:hover {
                background: #1ed760;
            }
            .lock-btn {
                background: rgba(255, 255, 255, 0.1);
                color: white;
            }
            .lock-btn:hover {
                background: rgba(255, 255, 255, 0.2);
            }
            .failed-section {
                margin-top: 20px;
                border-top: 1px solid rgba(255, 255, 255, 0.1);
                padding-top: 15px;
            }
            .failed-item {
                opacity: 0.6;
                font-size: 13px;
                color: #ff6b6b;
                padding: 8px 0;
            }
        `;
        document.head.appendChild(style);
    }
    
    resultsContainer.innerHTML = '';
    
    // 分離成功和失敗的結果
    const successResults = results.filter(r => r.success !== false);
    const failedResults = results.filter(r => r.success === false);
    
    if (successResults.length === 0 && failedResults.length === 0) {
        this.displayNoResults();
        return;
    }

    // 將成功結果分為 逐字歌詞 和 非逐字歌詞
    // 判斷方式：如果 lyrics[0].words 存在，或者 type 為 'wordbyword' 等
    // 根據外部 API，逐字歌詞通常帶有 words 數組
    const wbwResults = successResults.filter(r => 
        r.lyrics && r.lyrics.some(line => line.words && line.words.length > 0)
    );
    const nonWbwResults = successResults.filter(r => 
        !r.lyrics || !r.lyrics.some(line => line.words && line.words.length > 0)
    );

    const renderResult = (result, index, listOffset) => {
        const resultElement = document.createElement('div');
        resultElement.className = 'result-item';
        
        // 生成歌詞預覽
        let preview = result.lyricsPreview || '點擊查看歌詞';
        if (!result.lyricsPreview && result.lyrics && result.lyrics.length > 0) {
            const firstFewLines = result.lyrics.slice(0, 2)
                .map(line => typeof line === 'string' ? line : line.text || '')
                .filter(line => line.trim() !== '')
                .join(' / ');
            preview = firstFewLines.length > 80 ? firstFewLines.substring(0, 80) + '...' : firstFewLines;
        }

        // 供應商圖標/名稱
        const providerName = result.provider || result.source || 'Unknown';
        const isWbw = result.lyrics && result.lyrics.some(line => line.words && line.words.length > 0);
        const isSynced = result.type === 'synced' || (result.lyrics && result.lyrics[0] && result.lyrics[0].time);
        
        let typeLabel = '📄 純文本';
        if (isWbw) typeLabel = '✨ 逐字歌詞';
        else if (isSynced) typeLabel = '⚡ 同步歌詞';

        resultElement.innerHTML = `
            <div class="result-header">
                <div class="provider-badge">
                    <span>${this.getProviderIcon(providerName)}</span>
                    ${this.escapeHtml(providerName)}
                </div>
                <div class="type-badge ${isWbw ? 'type-synced' : (isSynced ? 'type-synced' : 'type-plain')}" style="${isWbw ? 'background: rgba(255, 215, 0, 0.2); color: #ffd700; border: 1px solid rgba(255, 215, 0, 0.3);' : ''}">
                    ${typeLabel}
                </div>
            </div>
            
            <div class="result-content">
                <div class="result-title">${this.escapeHtml(result.title || result.artist)}</div>
                <div class="result-artist">${this.escapeHtml(result.artist || '未知歌手')}</div>
            </div>
            
            <div class="result-preview">"${this.escapeHtml(preview)}"</div>
            
            <div class="result-actions">
                <button class="action-btn use-btn" data-type="${isWbw ? 'wbw' : 'normal'}" data-index="${index}">
                    <span>▶</span> 使用此歌詞
                </button>
                <button class="action-btn lock-btn" data-provider="${result.provider}" data-artist="${result.artist}" data-title="${result.title}">
                    <span>🔒</span> 鎖定來源
                </button>
            </div>
        `;
        return resultElement;
    };

    // 顯示 逐字歌詞 區域
    if (wbwResults.length > 0) {
        const header = document.createElement('h4');
        header.style.cssText = 'color: #ffd700; margin: 15px 0 10px 0; font-size: 14px; display: flex; align-items: center; gap: 5px;';
        header.innerHTML = '<span>✨</span> 逐字歌詞';
        resultsContainer.appendChild(header);
        
        wbwResults.forEach((result, idx) => {
            resultsContainer.appendChild(renderResult(result, idx, 0));
        });
    }

    // 顯示 非逐字歌詞 區域
    if (nonWbwResults.length > 0) {
        const header = document.createElement('h4');
        header.style.cssText = 'color: #1db954; margin: 20px 0 10px 0; font-size: 14px; display: flex; align-items: center; gap: 5px;';
        header.innerHTML = '<span>📄</span> 非逐字歌詞';
        resultsContainer.appendChild(header);
        
        nonWbwResults.forEach((result, idx) => {
            resultsContainer.appendChild(renderResult(result, idx, 0));
        });
    }
    
    // 顯示失敗的結果 (摺疊式或簡化顯示)
    if (failedResults.length > 0) {
        const failedSection = document.createElement('div');
        failedSection.className = 'failed-section';
        failedSection.innerHTML = '<h4 style="color: #888; font-size: 13px; margin-bottom: 10px; font-weight: 500;">未找到歌詞的來源:</h4>';
        
        failedResults.forEach(result => {
            const failedElement = document.createElement('div');
            failedElement.className = 'failed-item';
            failedElement.innerHTML = `
                <span style="display:inline-block; width: 100px;">❌ ${this.escapeHtml(result.provider || 'Unknown')}</span>
                <span>${this.escapeHtml(result.error || '無法獲取')}</span>
            `;
            failedSection.appendChild(failedElement);
        });
        
        resultsContainer.appendChild(failedSection);
    }
    
    // 綁定按鈕事件
    resultsContainer.querySelectorAll('.use-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const type = e.currentTarget.dataset.type;
            const index = parseInt(e.currentTarget.dataset.index);
            const targetList = type === 'wbw' ? wbwResults : nonWbwResults;
            this.selectLyricsResult(targetList[index]);
        });
    });
    
    resultsContainer.querySelectorAll('.lock-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const target = e.currentTarget;
            const provider = target.dataset.provider;
            const artist = target.dataset.artist;
            const title = target.dataset.title;
            this.lockProvider(provider, artist, title, target);
        });
    });
    
    searchResults.style.display = 'block';
};

// 輔助方法：獲取供應商圖標
SpotifyLyricsPlayer.prototype.getProviderIcon = function(provider) {
    const p = provider.toLowerCase();
    if (p.includes('spotify')) return '🟢';
    if (p.includes('apple') || p.includes('music')) return '🍎';
    if (p.includes('musixmatch')) return '🟧';
    if (p.includes('netease') || p.includes('163')) return '🔴';
    if (p.includes('qq') || p.includes('kugou')) return '🔵';
    if (p.includes('lrclib')) return '📚';
    return '🎵';
};

SpotifyLyricsPlayer.prototype.displayNoResults = function() {
    const searchResults = document.getElementById('search-results');
    const resultsContainer = document.getElementById('results-container');
    
    resultsContainer.innerHTML = `
        <div class="no-results">
            <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
            </svg>
            <div>沒有找到相關歌詞</div>
            <div style="font-size: 14px; margin-top: 8px;">請嘗試其他關鍵字</div>
        </div>
    `;
    
    searchResults.style.display = 'block';
};

SpotifyLyricsPlayer.prototype.selectLyricsResult = async function(result) {
    this.log(`✅ 選擇歌詞: ${result.artist} - ${result.title}`);
    
    // 顯示載入狀態
    document.getElementById('search-loading').style.display = 'flex';
    document.getElementById('search-results').style.display = 'none';
    
    try {
        if (result.lyrics && result.lyrics.length > 0) {
            // 直接使用搜尋結果中的歌詞數據
            this.overrideLyrics(result.lyrics, result.type || 'plain', result);
            this.hideLyricsSearchModal();
            this.showSuccessMessage(`✅ 已載入歌詞: ${result.artist} - ${result.title}`);
        } else {
            this.showErrorMessage('歌詞數據無效');
            document.getElementById('search-results').style.display = 'block';
        }
    } catch (error) {
        this.log(`❌ 載入歌詞失敗: ${error.message}`);
        this.showErrorMessage('載入歌詞失敗，請稍後重試');
        document.getElementById('search-results').style.display = 'block';
    } finally {
        document.getElementById('search-loading').style.display = 'none';
    }
};

SpotifyLyricsPlayer.prototype.overrideLyrics = function(lyrics, lyricsType, source) {
    this.log(`🔄 覆蓋歌詞: ${lyrics.length} 行，類型: ${lyricsType}`);
    
    // 更新歌詞數據
    this.lyrics = lyrics;
    this.lyricsType = lyricsType || 'plain';
    this.currentLyricIndex = 0;
    
    // 標記為手動覆蓋
    this.isLyricsOverridden = true;
    this.overriddenLyricsSource = source;

    // 廣播歌詞數據給其他分頁
    if (this.controlChannel) {
        this.controlChannel.postMessage({
            type: 'lyrics-sync',
            lyrics: this.lyrics,
            lyricsType: this.lyricsType,
            trackId: this.currentTrack?.id
        });
    }
    
    // 重新顯示歌詞
    this.displayLyrics();
    this.updateStatus('lyrics', true);
    
    // 🚀 關鍵修正：立即更新高亮位置，防止上傳後不滾動/不亮
    if (this.currentTrack) {
        this.updateLyricsHighlight(this.currentTrack.progress);
    }
    
    // 添加覆蓋提示
    this.addLyricsOverrideIndicator(source);
};

SpotifyLyricsPlayer.prototype.addLyricsOverrideIndicator = function(source) {
    // 在歌詞區域顯示覆蓋提示
    const lyricsHeader = document.querySelector('.lyrics-header h3');
    if (lyricsHeader && !lyricsHeader.querySelector('.override-indicator')) {
        const indicator = document.createElement('span');
        indicator.className = 'override-indicator';
        indicator.innerHTML = `<small style="color: var(--accent-color); margin-left: 8px;">🔄 已覆蓋</small>`;
        indicator.title = `歌詞來源: ${source.artist} - ${source.title}`;
        lyricsHeader.appendChild(indicator);
        
        // 5秒後自動移除提示
        setTimeout(() => {
            if (indicator.parentNode) {
                indicator.parentNode.removeChild(indicator);
            }
        }, 5000);
    }
};

// 輔助方法
SpotifyLyricsPlayer.prototype.escapeHtml = function(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
};

// 鎖定供應商功能
SpotifyLyricsPlayer.prototype.lockProvider = function(provider, artist, title, buttonElement) {
    const key = `${artist}-${title}`.toLowerCase();
    
    // 保存到 localStorage
    const saved = JSON.parse(localStorage.getItem('lockedLyricsProviders') || '{}');
    saved[key] = provider;
    localStorage.setItem('lockedLyricsProviders', JSON.stringify(saved));

    // 更新按鈕狀態
    buttonElement.textContent = '✅ 已鎖定';
    buttonElement.style.background = '#1db954';
    buttonElement.disabled = true;

    this.showSuccessMessage(`已鎖定 ${provider} 為 "${artist} - ${title}" 的歌詞供應商`);
    this.log(`🔒 已鎖定供應商: ${provider} for ${artist} - ${title}`);
};

// 檢查鎖定的供應商
SpotifyLyricsPlayer.prototype.getLockedProvider = function(artist, title) {
    const key = `${artist}-${title}`.toLowerCase();
    const saved = JSON.parse(localStorage.getItem('lockedLyricsProviders') || '{}');
    return saved[key] || null;
};

// 顯示成功訊息
SpotifyLyricsPlayer.prototype.showSuccessMessage = function(message) {
    const successDiv = document.createElement('div');
    successDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(135deg, #1db954, #1ed760);
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(29, 185, 84, 0.3);
        z-index: 10000;
        font-size: 14px;
        font-weight: 500;
        animation: slideIn 0.3s ease;
    `;
    successDiv.textContent = message;
    
    document.body.appendChild(successDiv);
    
    setTimeout(() => {
        if (successDiv.parentNode) {
            successDiv.parentNode.removeChild(successDiv);
        }
    }, 3000);
};

SpotifyLyricsPlayer.prototype.showErrorMessage = function(message) {
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(135deg, #dc3545, #e74c3c);
        color: white;
        padding: 16px 24px;
        border-radius: 12px;
        box-shadow: 0 8px 20px rgba(220, 53, 69, 0.3);
        z-index: 1001;
        font-weight: 600;
        animation: slideIn 0.3s ease;
        max-width: 300px;
    `;
    errorDiv.textContent = message;
    
    document.body.appendChild(errorDiv);
    
    setTimeout(() => {
        errorDiv.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => {
            if (errorDiv.parentNode) {
                errorDiv.parentNode.removeChild(errorDiv);
            }
        }, 300);
    }, 4000);
};

    console.log('✅ 歌詞搜尋功能已加載');
}