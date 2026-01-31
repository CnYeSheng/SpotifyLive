// 用戶自定義歌詞管理系統
// User Custom Lyrics Management System

// 等待主腳本載入完成
document.addEventListener('DOMContentLoaded', function() {
    if (typeof SpotifyLyricsPlayer !== 'undefined') {
        initUserLyricsManager();
    } else {
        setTimeout(() => {
            if (typeof SpotifyLyricsPlayer !== 'undefined') {
                initUserLyricsManager();
            }
        }, 1000);
    }
});

function initUserLyricsManager() {
    console.log('🔧 初始化用戶自定義歌詞管理系統');

    // =================
    // 用戶歌詞存儲管理
    // =================
    
    // 生成歌曲唯一標識符
    SpotifyLyricsPlayer.prototype.generateTrackKey = function(trackInfo) {
        const artist = trackInfo.artist || trackInfo.artists?.[0]?.name || '';
        const name = trackInfo.name || trackInfo.title || '';
        const id = trackInfo.id || '';
        
        // 使用多種標識符確保唯一性
        return `${id}-${artist}-${name}`.toLowerCase()
            .replace(/\s+/g, '_')
            .replace(/[^\w\-_]/g, '');
    };

    // 保存用戶自定義歌詞 (使用 KV 存儲)
    SpotifyLyricsPlayer.prototype.saveUserCustomLyrics = async function(trackInfo, lyrics, lyricsType, source) {
        try {
            const success = await window.kvStorageManager.saveUserCustomLyrics(trackInfo, lyrics, lyricsType, source);
            
            if (success) {
                this.log(`💾 已保存用戶自定義歌詞: ${trackInfo.artist} - ${trackInfo.name}`);
                return true;
            } else {
                throw new Error('保存失敗');
            }
        } catch (error) {
            this.log(`❌ 保存用戶自定義歌詞失敗: ${error.message}`);
            return false;
        }
    };

    // 獲取用戶自定義歌詞 (使用 KV 存儲)
    SpotifyLyricsPlayer.prototype.getUserCustomLyrics = async function(trackInfo) {
        try {
            const userData = await window.kvStorageManager.getUserCustomLyrics(trackInfo);
            
            if (userData) {
                this.log(`🎯 找到用戶自定義歌詞: ${trackInfo.artist} - ${trackInfo.name}`);
                return userData;
            }
            
            return null;
        } catch (error) {
            this.log(`❌ 獲取用戶自定義歌詞失敗: ${error.message}`);
            return null;
        }
    };

    // 保存用戶指定的歌詞供應商 (使用 KV 存儲)
    SpotifyLyricsPlayer.prototype.saveUserLyricsProvider = async function(trackInfo, provider) {
        try {
            const success = await window.kvStorageManager.saveUserLyricsProvider(trackInfo, provider);
            
            if (success) {
                this.log(`🔒 已保存用戶指定供應商: ${provider} for ${trackInfo.artist} - ${trackInfo.name}`);
                return true;
            } else {
                throw new Error('保存失敗');
            }
        } catch (error) {
            this.log(`❌ 保存用戶指定供應商失敗: ${error.message}`);
            return false;
        }
    };

    // 獲取用戶指定的歌詞供應商 (使用 KV 存儲)
    SpotifyLyricsPlayer.prototype.getUserLyricsProvider = async function(trackInfo) {
        try {
            const provider = await window.kvStorageManager.getUserLyricsProvider(trackInfo);
            
            if (provider) {
                this.log(`🎯 找到用戶指定供應商: ${provider} for ${trackInfo.artist} - ${trackInfo.name}`);
                return provider;
            }
            
            return null;
        } catch (error) {
            this.log(`❌ 獲取用戶指定供應商失敗: ${error.message}`);
            return null;
        }
    };

    // =================
    // 自動應用用戶設置
    // =================
    
    // 重寫 overrideLyrics 方法，添加自動保存功能
    const originalOverrideLyrics = SpotifyLyricsPlayer.prototype.overrideLyrics;
    SpotifyLyricsPlayer.prototype.overrideLyrics = function(lyrics, lyricsType, source) {
        // 調用原始方法
        originalOverrideLyrics.call(this, lyrics, lyricsType, source);
        
        // 如果有當前歌曲信息，保存為用戶自定義歌詞
        if (this.currentTrack && source && source.source !== 'auto_applied') {
            this.saveUserCustomLyrics(this.currentTrack, lyrics, lyricsType, {
                ...source,
                appliedAt: Date.now(),
                appliedBy: 'manual_override'
            });
        }
    };

    // 自動應用用戶自定義設置的主要方法
    SpotifyLyricsPlayer.prototype.autoApplyUserLyricsSettings = async function(trackInfo) {
        if (!trackInfo) {
            return false;
        }

        this.log(`🔍 檢查用戶自定義設置: ${trackInfo.artist} - ${trackInfo.name}`);

        // 1. 首先檢查是否有用戶自定義歌詞
        const customLyrics = await this.getUserCustomLyrics(trackInfo);
        if (customLyrics && customLyrics.lyrics && customLyrics.lyrics.length > 0) {
            this.log(`🎯 應用用戶自定義歌詞: ${trackInfo.artist} - ${trackInfo.name}`);
            
            // 應用自定義歌詞
            this.overrideLyrics(
                customLyrics.lyrics, 
                customLyrics.lyricsType, 
                {
                    ...customLyrics.source,
                    source: 'auto_applied',
                    title: `${trackInfo.artist} - ${trackInfo.name} (用戶自定義)`,
                    appliedAt: Date.now()
                }
            );
            
            this.showSuccessMessage(`✅ 已自動應用用戶自定義歌詞`);
            return true;
        }

        // 2. 檢查是否有用戶指定的歌詞供應商
        const preferredProvider = await this.getUserLyricsProvider(trackInfo);
        if (preferredProvider) {
            this.log(`🎯 使用用戶指定供應商搜索: ${preferredProvider} for ${trackInfo.artist} - ${trackInfo.name}`);
            
            try {
                // 使用指定供應商搜索歌詞
                const success = await this.loadLyricsFromSpecificProvider(trackInfo, preferredProvider);
                if (success) {
                    this.showSuccessMessage(`✅ 已使用指定供應商 ${preferredProvider} 加載歌詞`);
                    return true;
                }
            } catch (error) {
                this.log(`❌ 使用指定供應商失敗: ${error.message}`);
            }
        }

        return false;
    };

    // 從指定供應商加載歌詞
    SpotifyLyricsPlayer.prototype.loadLyricsFromSpecificProvider = async function(trackInfo, provider) {
        try {
            const artist = encodeURIComponent(trackInfo.artist || '');
            const title = encodeURIComponent(trackInfo.name || '');
            
            // 使用後端API搜索指定供應商的歌詞
            const response = await fetch(
                `${this.apiBase}/api/lyrics-search-provider/${provider}/${artist}/${title}`
            );
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.success && data.lyrics && data.lyrics.length > 0) {
                this.overrideLyrics(
                    data.lyrics, 
                    data.type || 'plain', 
                    {
                        provider: provider,
                        title: `${trackInfo.artist} - ${trackInfo.name}`,
                        artist: trackInfo.artist,
                        source: 'auto_applied',
                        appliedAt: Date.now()
                    }
                );
                return true;
            }
            
            return false;
        } catch (error) {
            this.log(`❌ 從供應商 ${provider} 加載歌詞失敗: ${error.message}`);
            return false;
        }
    };

    // =================
    // 集成到現有的歌詞加載流程
    // =================
    
    // 重寫 loadLyrics 方法，添加自動應用用戶設置
    const originalLoadLyrics = SpotifyLyricsPlayer.prototype.loadLyrics;
    SpotifyLyricsPlayer.prototype.loadLyrics = async function() {
        // 首先嚐試自動應用用戶設置
        if (this.currentTrack) {
            const userSettingsApplied = await this.autoApplyUserLyricsSettings(this.currentTrack);
            if (userSettingsApplied) {
                // 用戶設置已應用，不需要繼續默認的歌詞加載流程
                return;
            }
        }
        
        // 如果沒有用戶設置，繼續原始的歌詞加載流程
        return originalLoadLyrics.call(this);
    };

    // =================
    // 用戶界面增強
    // =================
    
    // 添加保存當前歌詞為自定義的功能
    SpotifyLyricsPlayer.prototype.saveCurrentLyricsAsCustom = async function() {
        if (!this.currentTrack) {
            this.showErrorMessage('沒有當前播放的歌曲');
            return;
        }

        if (!this.lyrics || this.lyrics.length === 0) {
            this.showErrorMessage('沒有可保存的歌詞');
            return;
        }

        try {
            // 使用 KV 存儲系統保存
            const response = await fetch('/api/kv/user-lyrics', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-Id': this.sessionId
                },
                body: JSON.stringify({
                    trackInfo: {
                        id: this.currentTrack.id,
                        name: this.currentTrack.name,
                        artist: this.currentTrack.artist,
                        album: this.currentTrack.album,
                        image: this.currentTrack.image
                    },
                    lyrics: this.lyrics,
                    lyricsType: this.lyricsType,
                    source: {
                        source: 'manual_save',
                        title: `${this.currentTrack.artist} - ${this.currentTrack.name}`,
                        artist: this.currentTrack.artist,
                        savedAt: Date.now()
                    }
                })
            });

            if (response.ok) {
                // 同時保存到本地 localStorage
                const customLyrics = JSON.parse(localStorage.getItem('user_custom_lyrics') || '{}');
                const trackKey = this.generateTrackCacheKey(this.currentTrack);

                customLyrics[trackKey] = {
                    trackInfo: {
                        id: this.currentTrack.id,
                        name: this.currentTrack.name,
                        artist: this.currentTrack.artist,
                        album: this.currentTrack.album,
                        image: this.currentTrack.image
                    },
                    lyrics: this.lyrics,
                    lyricsType: this.lyricsType,
                    source: {
                        source: 'manual_save',
                        title: `${this.currentTrack.artist} - ${this.currentTrack.name}`,
                        artist: this.currentTrack.artist,
                        savedAt: Date.now()
                    },
                    lastUsed: Date.now()
                };

                localStorage.setItem('user_custom_lyrics', JSON.stringify(customLyrics));

                this.showSuccessMessage('✅ 當前歌詞已保存為自定義歌詞');
            } else {
                throw new Error(`保存失敗: ${response.status}`);
            }
        } catch (error) {
            console.error('保存當前歌詞失敗:', error);
            this.showErrorMessage('保存失敗，請稍後重試');
        }
    };

    // 清除特定歌曲的用戶設置
    SpotifyLyricsPlayer.prototype.clearUserSettingsForTrack = function(trackInfo) {
        if (!trackInfo) {
            trackInfo = this.currentTrack;
        }
        
        if (!trackInfo) {
            this.showErrorMessage('沒有指定的歌曲');
            return;
        }
        
        const trackKey = this.generateTrackKey(trackInfo);
        
        try {
            // 清除自定義歌詞
            const customLyrics = JSON.parse(localStorage.getItem('user_custom_lyrics') || '{}');
            if (customLyrics[trackKey]) {
                delete customLyrics[trackKey];
                localStorage.setItem('user_custom_lyrics', JSON.stringify(customLyrics));
            }
            
            // 清除指定供應商
            const providers = JSON.parse(localStorage.getItem('user_lyrics_providers') || '{}');
            if (providers[trackKey]) {
                delete providers[trackKey];
                localStorage.setItem('user_lyrics_providers', JSON.stringify(providers));
            }
            
            this.showSuccessMessage('✅ 已清除該歌曲的用戶設置');
            this.log(`🧹 已清除用戶設置: ${trackInfo.artist} - ${trackInfo.name}`);
        } catch (error) {
            this.log(`❌ 清除用戶設置失敗: ${error.message}`);
            this.showErrorMessage('清除失敗，請稍後重試');
        }
    };

    // =================
    // 擴展歌詞搜索功能，添加保存供應商選擇
    // =================
    
    // 重寫 selectLyricsResult 方法，添加保存供應商選擇
    const originalSelectLyricsResult = SpotifyLyricsPlayer.prototype.selectLyricsResult;
    SpotifyLyricsPlayer.prototype.selectLyricsResult = async function(result) {
        // 調用原始方法
        await originalSelectLyricsResult.call(this, result);
        
        // 如果有provider信息且當前有歌曲，保存供應商選擇
        if (result.provider && this.currentTrack) {
            this.saveUserLyricsProvider(this.currentTrack, result.provider);
        }
    };

    // =================
    // 管理界面
    // =================
    
    // 顯示用戶自定義歌詞管理界面
    SpotifyLyricsPlayer.prototype.showUserLyricsManager = function() {
        // 創建管理界面的模態框
        let modal = document.getElementById('user-lyrics-manager-modal');
        if (!modal) {
            modal = this.createUserLyricsManagerModal();
        }

        this.populateUserLyricsManagerContent();
        // 更新同步狀態以反映最新的本地歌詞數量
        if (typeof this.updateSyncStatus === 'function') {
            this.updateSyncStatus();
        }
        modal.style.display = 'flex';
    };

    // 創建用戶歌詞管理模態框
    SpotifyLyricsPlayer.prototype.createUserLyricsManagerModal = function() {
        const modal = document.createElement('div');
        modal.id = 'user-lyrics-manager-modal';
        modal.className = 'modal';
        modal.style.cssText = `
            display: none;
            position: fixed;
            z-index: 1000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0,0,0,0.8);
            backdrop-filter: blur(5px);
        `;
        
        modal.innerHTML = `
            <div class="modal-content" style="
                background: var(--bg-color, #1a1a1a);
                margin: 5% auto;
                padding: 20px;
                border-radius: 12px;
                width: 90%;
                max-width: 800px;
                max-height: 80vh;
                overflow-y: auto;
                color: var(--text-color, white);
            ">
                <div class="modal-header" style="
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 20px;
                    border-bottom: 1px solid var(--border-color, #333);
                    padding-bottom: 10px;
                ">
                    <h2>用戶自定義歌詞管理</h2>
                    <span class="close" id="close-user-lyrics-manager" style="
                        font-size: 28px;
                        font-weight: bold;
                        cursor: pointer;
                        color: var(--text-color, #ccc);
                    ">&times;</span>
                </div>
                <div id="user-lyrics-manager-content">
                    <!-- 內容將由 JS 填充 -->
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // 綁定關閉事件
        const closeBtn = modal.querySelector('#close-user-lyrics-manager');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                modal.style.display = 'none';
            });
        }
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
        
        return modal;
    };

    // 填充用戶歌詞管理內容
    SpotifyLyricsPlayer.prototype.populateUserLyricsManagerContent = async function() {
        const content = document.getElementById('user-lyrics-manager-content');
        if (!content) return;

        try {
            // 顯示加載狀態
            content.innerHTML = '<p style="color: #888; text-align: center; padding: 20px;">🔄 加載中...</p>';

            // 從 localStorage 獲取本地數據
            const localCustomLyrics = JSON.parse(localStorage.getItem('user_custom_lyrics') || '{}');
            const localProviders = JSON.parse(localStorage.getItem('user_lyrics_providers') || '{}');

            // 從服務端獲取雲端數據
            let cloudCustomLyrics = [];
            let cloudProviders = [];

            if (this.sessionId) {
                try {
                    // 獲取雲端自定義歌詞
                    const lyricsResponse = await fetch('/api/kv/get-all-lyrics', {
                        headers: { 'X-Session-Id': this.sessionId }
                    });
                    if (lyricsResponse.ok) {
                        const lyricsData = await lyricsResponse.json();
                        if (lyricsData.success && lyricsData.lyrics) {
                            cloudCustomLyrics = lyricsData.lyrics;
                        }
                    }

                    // 獲取雲端供應商設置（如果有的話）
                    // Note: 供應商設置可能需要另一個端點，或者從歌詞設置中提取
                    // 暫時假設供應商設置也在歌詞設置中
                } catch (error) {
                    console.warn('獲取雲端數據失敗:', error.message);
                }
            }

            // 合併數據，去重
            const allCustomLyrics = {};
            // 添加本地數據
            Object.assign(allCustomLyrics, localCustomLyrics);
            // 添加雲端數據（如果 trackKey 不存在於本地）
            cloudCustomLyrics.forEach(item => {
                const trackKey = this.generateTrackCacheKey(item.trackInfo);
                if (!allCustomLyrics[trackKey]) {
                    allCustomLyrics[trackKey] = {
                        trackInfo: item.trackInfo,
                        trackKey: trackKey,
                        lyrics: item.lyricsContent || item.lyrics,
                        lyricsType: item.lyricsType || 'synced',
                        source: item.source || { source: 'cloud' },
                        lastUsed: item.updated_at || Date.now()
                    };
                }
            });

            // 合併供應商設置
            const allProviders = {};
            Object.assign(allProviders, localProviders);

            let html = '';

            // 自定義歌詞部分
            html += '<h3 style="color: var(--accent-color, #1db954); margin-bottom: 15px;">🎵 自定義歌詞</h3>';

            const customEntries = Object.values(allCustomLyrics);
            if (customEntries.length > 0) {
                customEntries
                    .sort((a, b) => (b.lastUsed || b.updated_at || Date.now()) - (a.lastUsed || a.updated_at || Date.now()))
                    .forEach(entry => {
                        // 確保 trackInfo 存在
                        const trackInfo = entry.trackInfo || {};
                        const trackKey = entry.trackKey || this.generateTrackCacheKey(trackInfo);
                        const lyricsCount = entry.lyrics ? entry.lyrics.length : 0;
                        const lastUsed = new Date(entry.lastUsed || entry.updated_at || Date.now()).toLocaleDateString();

                        html += `
                            <div class="user-lyrics-item" style="
                                background: var(--card-bg, #2a2a2a);
                                padding: 15px;
                                margin-bottom: 10px;
                                border-radius: 8px;
                                border-left: 4px solid var(--accent-color, #1db954);
                            ">
                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                    <div>
                                        <strong>${this.escapeHtml(trackInfo.artist || '未知藝人')} - ${this.escapeHtml(trackInfo.name || '未知歌曲')}</strong>
                                        <br>
                                        <small style="color: #888;">
                                            ${entry.lyricsType === 'synced' ? '同步歌詞' : '普通歌詞'} •
                                            ${lyricsCount} 行 •
                                            最後使用: ${lastUsed}
                                        </small>
                                    </div>
                                    <div style="display: flex; gap: 8px;">
                                        <button onclick="window.player.syncSingleLyrics('${trackKey}')" style="
                                            background: #007bff;
                                            color: white;
                                            border: none;
                                            padding: 6px 10px;
                                            border-radius: 4px;
                                            cursor: pointer;
                                            font-size: 12px;
                                        ">同步</button>
                                        <button onclick="window.player.deleteUserCustomLyrics('${trackKey}')" style="
                                            background: #dc3545;
                                            color: white;
                                            border: none;
                                            padding: 6px 10px;
                                            border-radius: 4px;
                                            cursor: pointer;
                                            font-size: 12px;
                                        ">刪除</button>
                                    </div>
                                </div>
                            </div>
                        `;
                    });
            } else {
                html += '<p style="color: #888; text-align: center; padding: 20px;">暫無自定義歌詞</p>';
            }

            // 指定供應商部分
            html += '<h3 style="color: var(--accent-color, #1db954); margin: 30px 0 15px 0;">🔒 指定供應商</h3>';

            const providerEntries = Object.values(allProviders);
            if (providerEntries.length > 0) {
                providerEntries
                    .sort((a, b) => (b.lastUsed || Date.now()) - (a.lastUsed || Date.now()))
                    .forEach(entry => {
                        // 確保 trackInfo 存在
                        const trackInfo = entry.trackInfo || {};
                        const trackKey = entry.trackKey || this.generateTrackCacheKey(trackInfo);
                        const lastUsed = new Date(entry.lastUsed || Date.now()).toLocaleDateString();

                        html += `
                            <div class="user-provider-item" style="
                                background: var(--card-bg, #2a2a2a);
                                padding: 15px;
                                margin-bottom: 10px;
                                border-radius: 8px;
                                border-left: 4px solid #ffc107;
                            ">
                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                    <div>
                                        <strong>${this.escapeHtml(trackInfo.artist || '未知藝人')} - ${this.escapeHtml(trackInfo.name || '未知歌曲')}</strong>
                                        <br>
                                        <small style="color: #888;">
                                            供應商: ${this.escapeHtml(entry.provider || '未知')} •
                                            最後使用: ${lastUsed}
                                        </small>
                                    </div>
                                    <div style="display: flex; gap: 8px;">
                                        <button onclick="window.player.syncSingleProvider('${trackKey}')" style="
                                            background: #007bff;
                                            color: white;
                                            border: none;
                                            padding: 6px 10px;
                                            border-radius: 4px;
                                            cursor: pointer;
                                            font-size: 12px;
                                        ">同步</button>
                                        <button onclick="window.player.deleteUserLyricsProvider('${trackKey}')" style="
                                            background: #dc3545;
                                            color: white;
                                            border: none;
                                            padding: 6px 10px;
                                            border-radius: 4px;
                                            cursor: pointer;
                                            font-size: 12px;
                                        ">刪除</button>
                                    </div>
                                </div>
                            </div>
                        `;
                    });
            } else {
                html += '<p style="color: #888; text-align: center; padding: 20px;">暫無指定供應商</p>';
            }

            // 管理操作
            html += `
                <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid var(--border-color, #333);">
                    <h3 style="color: var(--accent-color, #1db954); margin-bottom: 15px;">🛠️ 管理操作</h3>
                    <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                        <button onclick="window.player.saveCurrentLyricsAsCustom()" style="
                            background: var(--accent-color, #1db954);
                            color: white;
                            border: none;
                            padding: 10px 15px;
                            border-radius: 6px;
                            cursor: pointer;
                        ">保存當前歌詞</button>
                        <button onclick="window.player.clearUserSettingsForTrack()" style="
                            background: #ffc107;
                            color: #000;
                            border: none;
                            padding: 10px 15px;
                            border-radius: 6px;
                            cursor: pointer;
                        ">清除當前歌曲設置</button>
                        <button onclick="window.player.clearAllUserLyricsSettings()" style="
                            background: #dc3545;
                            color: white;
                            border: none;
                            padding: 10px 15px;
                            border-radius: 6px;
                            cursor: pointer;
                        ">清除所有設置</button>
                    </div>
                </div>

                <!-- 同步操作 -->
                <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--border-color, #333);">
                    <h3 style="color: var(--accent-color, #1db954); margin-bottom: 15px;">🔄 同步操作</h3>
                    <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                        <button onclick="window.player.syncAllUserLyrics()" style="
                            background: #28a745;
                            color: white;
                            border: none;
                            padding: 10px 15px;
                            border-radius: 6px;
                            cursor: pointer;
                        ">同步所有設置</button>
                        <button onclick="window.player.exportAllUserLyrics()" style="
                            background: #17a2b8;
                            color: white;
                            border: none;
                            padding: 10px 15px;
                            border-radius: 6px;
                            cursor: pointer;
                        ">匯出所有設置</button>
                        <button onclick="window.player.importUserLyrics()" style="
                            background: #6f42c1;
                            color: white;
                            border: none;
                            padding: 10px 15px;
                            border-radius: 6px;
                            cursor: pointer;
                        ">匯入設置</button>
                    </div>
                </div>
            `;

            content.innerHTML = html;

        } catch (error) {
            content.innerHTML = `<p style="color: #dc3545;">加載數據失敗: ${error.message}</p>`;
        }
    };

    // 刪除特定的用戶自定義歌詞
    SpotifyLyricsPlayer.prototype.deleteUserCustomLyrics = function(trackKey) {
        try {
            const customLyrics = JSON.parse(localStorage.getItem('user_custom_lyrics') || '{}');
            if (customLyrics[trackKey]) {
                delete customLyrics[trackKey];
                localStorage.setItem('user_custom_lyrics', JSON.stringify(customLyrics));
                this.populateUserLyricsManagerContent(); // 重新加載內容
                this.showSuccessMessage('✅ 自定義歌詞已刪除');
            }
        } catch (error) {
            this.showErrorMessage('刪除失敗: ' + error.message);
        }
    };

    // 刪除特定的用戶指定供應商
    SpotifyLyricsPlayer.prototype.deleteUserLyricsProvider = function(trackKey) {
        try {
            const providers = JSON.parse(localStorage.getItem('user_lyrics_providers') || '{}');
            if (providers[trackKey]) {
                delete providers[trackKey];
                localStorage.setItem('user_lyrics_providers', JSON.stringify(providers));
                this.populateUserLyricsManagerContent(); // 重新加載內容
                this.showSuccessMessage('✅ 指定供應商已刪除');
            }
        } catch (error) {
            this.showErrorMessage('刪除失敗: ' + error.message);
        }
    };

    // 清除所有用戶歌詞設置
    SpotifyLyricsPlayer.prototype.clearAllUserLyricsSettings = function() {
        if (confirm('確定要清除所有用戶自定義歌詞和供應商設置嗎？此操作不可恢復。')) {
            try {
                localStorage.removeItem('user_custom_lyrics');
                localStorage.removeItem('user_lyrics_providers');
                this.populateUserLyricsManagerContent(); // 重新加載內容
                this.showSuccessMessage('✅ 所有用戶設置已清除');
                this.log('🧹 所有用戶歌詞設置已清除');
            } catch (error) {
                this.showErrorMessage('清除失敗: ' + error.message);
            }
        }
    };

    // =================
    // 同步功能方法
    // =================

    // 同步單個歌詞到雲端
    SpotifyLyricsPlayer.prototype.syncSingleLyrics = async function(trackKey) {
        try {
            const customLyrics = JSON.parse(localStorage.getItem('user_custom_lyrics') || '{}');
            const lyricData = customLyrics[trackKey];

            if (!lyricData) {
                this.showErrorMessage('找不到指定的歌詞數據');
                return;
            }

            // 顯示同步進度
            this.showSyncProgress(1, 1);

            const response = await fetch('/api/kv/user-lyrics', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-Id': this.sessionId
                },
                body: JSON.stringify({
                    trackInfo: lyricData.trackInfo,
                    lyrics: lyricData.lyrics,
                    lyricsType: lyricData.lyricsType,
                    source: lyricData.source
                })
            });

            if (response.ok) {
                this.showSuccessMessage(`✅ 歌詞已同步: ${lyricData.trackInfo.artist} - ${lyricData.trackInfo.name}`);
                this.log(`✅ 歌詞同步成功: ${lyricData.trackInfo.artist} - ${lyricData.trackInfo.name}`);

                // 更新同步狀態以反映最新的本地歌詞數量
                if (typeof this.updateSyncStatus === 'function') {
                    this.updateSyncStatus();
                }
            } else {
                throw new Error(`同步失敗: ${response.status}`);
            }

            this.hideSyncProgress();
        } catch (error) {
            this.hideSyncProgress();
            this.showErrorMessage(`❌ 同步失敗: ${error.message}`);
            this.log(`❌ 同步歌詞失敗: ${error.message}`);
        }
    };

    // 同步單個供應商設置到雲端
    SpotifyLyricsPlayer.prototype.syncSingleProvider = async function(trackKey) {
        try {
            const providers = JSON.parse(localStorage.getItem('user_lyrics_providers') || '{}');
            const providerData = providers[trackKey];

            if (!providerData) {
                this.showErrorMessage('找不到指定的供應商數據');
                return;
            }

            // 顯示同步進度
            this.showSyncProgress(1, 1);

            const response = await fetch('/api/kv/save-provider', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-Id': this.sessionId
                },
                body: JSON.stringify({
                    trackInfo: providerData.trackInfo,
                    provider: providerData.provider
                })
            });

            if (response.ok) {
                this.showSuccessMessage(`✅ 供應商設置已同步: ${providerData.trackInfo.artist} - ${providerData.trackInfo.name}`);
                this.log(`✅ 供應商設置同步成功: ${providerData.trackInfo.artist} - ${providerData.trackInfo.name}`);

                // 更新同步狀態以反映最新的本地歌詞數量
                if (typeof this.updateSyncStatus === 'function') {
                    this.updateSyncStatus();
                }
            } else {
                const responseText = await response.text();
                throw new Error(`同步失敗: ${response.status} - ${responseText}`);
            }

            this.hideSyncProgress();
        } catch (error) {
            this.hideSyncProgress();
            this.showErrorMessage(`❌ 同步失敗: ${error.message}`);
            this.log(`❌ 同步供應商設置失敗: ${error.message}`);
        }
    };

    // 同步所有用戶歌詞設置到雲端
    SpotifyLyricsPlayer.prototype.syncAllUserLyrics = async function() {
        try {
            // 從 localStorage 獲取本地數據
            const localCustomLyrics = JSON.parse(localStorage.getItem('user_custom_lyrics') || '{}');
            const localProviders = JSON.parse(localStorage.getItem('user_lyrics_providers') || '{}');

            // 獲取雲端數據以進行比較和同步
            let cloudCustomLyrics = {};
            let cloudProviders = {};

            if (this.sessionId) {
                try {
                    // 獲取雲端自定義歌詞
                    const lyricsResponse = await fetch('/api/kv/get-all-lyrics', {
                        headers: { 'X-Session-Id': this.sessionId }
                    });
                    if (lyricsResponse.ok) {
                        const lyricsData = await lyricsResponse.json();
                        if (lyricsData.success && lyricsData.lyrics) {
                            lyricsData.lyrics.forEach(item => {
                                const trackKey = this.generateTrackCacheKey(item.trackInfo);
                                cloudCustomLyrics[trackKey] = item;
                            });
                        }
                    }
                } catch (error) {
                    console.warn('獲取雲端歌詞數據失敗:', error.message);
                }
            }

            // 準備同步項目 - 只同步本地有但雲端沒有的，或本地更新的
            const allEntries = [];

            // 添加自定義歌詞
            for (const [key, value] of Object.entries(localCustomLyrics)) {
                allEntries.push({ type: 'lyrics', data: value, trackKey: key });
            }

            // 添加供應商設置
            for (const [key, value] of Object.entries(localProviders)) {
                allEntries.push({ type: 'provider', data: value, trackKey: key });
            }

            if (allEntries.length === 0) {
                this.showSuccessMessage('✅ 沒有需要同步的設置');
                return;
            }

            this.log(`🔄 開始同步 ${allEntries.length} 個用戶設置到雲端`);

            // 顯示同步進度
            this.showSyncProgress(0, allEntries.length);

            let syncedCount = 0;
            let failedCount = 0;

            // 分批同步，避免一次性請求太多
            const batchSize = 10;
            for (let i = 0; i < allEntries.length; i += batchSize) {
                const batch = allEntries.slice(i, i + batchSize);

                for (const entry of batch) {
                    try {
                        if (entry.type === 'lyrics') {
                            const response = await fetch('/api/kv/user-lyrics', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'X-Session-Id': this.sessionId
                                },
                                body: JSON.stringify({
                                    trackInfo: entry.data.trackInfo,
                                    lyrics: entry.data.lyrics,
                                    lyricsType: entry.data.lyricsType,
                                    source: entry.data.source
                                })
                            });

                            if (response.ok) {
                                syncedCount++;
                            } else {
                                failedCount++;
                                // Log the response for debugging
                                const responseText = await response.text();
                                this.log(`❌ 歌詞同步失敗: ${response.status} - ${responseText}`);
                            }
                        } else if (entry.type === 'provider') {
                            const response = await fetch('/api/kv/save-provider', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'X-Session-Id': this.sessionId
                                },
                                body: JSON.stringify({
                                    trackInfo: entry.data.trackInfo,
                                    provider: entry.data.provider
                                })
                            });

                            if (response.ok) {
                                syncedCount++;
                            } else {
                                failedCount++;
                                // Log the response for debugging
                                const responseText = await response.text();
                                this.log(`❌ 供應商同步失敗: ${response.status} - ${responseText}`);
                            }
                        }
                    } catch (error) {
                        this.log(`❌ 同步單個項目失敗: ${error.message}`);
                        failedCount++;
                    }

                    // 更新進度顯示
                    this.showSyncProgress(syncedCount + failedCount, allEntries.length);
                }
            }

            // 隱藏進度顯示
            this.hideSyncProgress();

            const successMessage = `✅ 同步完成！成功: ${syncedCount}, 失敗: ${failedCount}`;
            this.showSuccessMessage(successMessage);

            // 更新同步狀態以反映最新的本地歌詞數量
            if (typeof this.updateSyncStatus === 'function') {
                this.updateSyncStatus();
            }

            this.log(`✅ 用戶設置同步完成: 成功 ${syncedCount}, 失敗 ${failedCount}`);
        } catch (error) {
            this.hideSyncProgress();
            this.showErrorMessage(`❌ 同步失敗: ${error.message}`);
            this.log(`❌ 同步過程中發生錯誤: ${error.message}`);
        }
    };

    // 匯出所有用戶歌詞設置
    SpotifyLyricsPlayer.prototype.exportAllUserLyrics = async function() {
        try {
            // 顯示加載狀態
            this.showSyncProgress(0, 0);

            // 從 localStorage 獲取本地數據
            const localCustomLyrics = JSON.parse(localStorage.getItem('user_custom_lyrics') || '{}');
            const localProviders = JSON.parse(localStorage.getItem('user_lyrics_providers') || '{}');

            // 從服務端獲取雲端數據
            let cloudCustomLyrics = {};
            let cloudProviders = {};

            if (this.sessionId) {
                try {
                    // 獲取雲端自定義歌詞
                    const lyricsResponse = await fetch('/api/kv/get-all-lyrics', {
                        headers: { 'X-Session-Id': this.sessionId }
                    });
                    if (lyricsResponse.ok) {
                        const lyricsData = await lyricsResponse.json();
                        if (lyricsData.success && lyricsData.lyrics) {
                            // 將雲端數據轉換為與本地數據相同的格式
                            lyricsData.lyrics.forEach(item => {
                                const trackKey = this.generateTrackCacheKey(item.trackInfo);
                                cloudCustomLyrics[trackKey] = {
                                    trackInfo: item.trackInfo,
                                    trackKey: trackKey,
                                    lyrics: item.lyricsContent || item.lyrics,
                                    lyricsType: item.lyricsType || 'synced',
                                    source: item.source || { source: 'cloud' },
                                    lastUsed: item.updated_at || Date.now()
                                };
                            });
                        }
                    }
                } catch (error) {
                    console.warn('獲取雲端歌詞數據失敗:', error.message);
                }
            }

            // 合併數據，優先使用本地數據（因為本地數據是最新的）
            const allCustomLyrics = {};
            // 首先添加雲端數據
            Object.assign(allCustomLyrics, cloudCustomLyrics);
            // 然後添加本地數據（覆蓋雲端數據）
            Object.assign(allCustomLyrics, localCustomLyrics);

            const allProviders = {};
            // 首先添加雲端供應商數據
            Object.assign(allProviders, cloudProviders);
            // 然後添加本地供應商數據（覆蓋雲端數據）
            Object.assign(allProviders, localProviders);

            const exportData = {
                exportedAt: new Date().toISOString(),
                totalLyrics: Object.keys(allCustomLyrics).length,
                totalProviders: Object.keys(allProviders).length,
                customLyrics: allCustomLyrics,
                providers: allProviders
            };

            // 創建並下載文件
            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = `spotify-user-settings-export-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();

            // 清理
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 100);

            // 隱藏進度
            this.hideSyncProgress();

            this.showSuccessMessage(`✅ 已匯出 ${exportData.totalLyrics + exportData.totalProviders} 個設置`);
            this.log(`✅ 匯出 ${exportData.totalLyrics + exportData.totalProviders} 個用戶設置到文件`);
        } catch (error) {
            // 隱藏進度
            this.hideSyncProgress();
            this.showErrorMessage(`❌ 匯出失敗: ${error.message}`);
            this.log(`❌ 匯出過程中發生錯誤: ${error.message}`);
        }
    };

    // 匯入用戶歌詞設置
    SpotifyLyricsPlayer.prototype.importUserLyrics = async function() {
        try {
            // 創建文件選擇對話框
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.json';
            fileInput.onchange = async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                try {
                    const text = await file.text();
                    const importData = JSON.parse(text);

                    if (!importData.customLyrics || !importData.providers) {
                        throw new Error('無效的匯入檔案格式');
                    }

                    // 顯示匯入進度
                    const totalItems = Object.keys(importData.customLyrics).length + Object.keys(importData.providers).length;
                    this.showSyncProgress(0, totalItems);

                    let importedCount = 0;
                    let failedCount = 0;

                    // 匯入自定義歌詞
                    for (const [key, value] of Object.entries(importData.customLyrics)) {
                        try {
                            const customLyrics = JSON.parse(localStorage.getItem('user_custom_lyrics') || '{}');
                            customLyrics[key] = value;
                            localStorage.setItem('user_custom_lyrics', JSON.stringify(customLyrics));

                            // 同步到雲端 using existing endpoint
                            if (this.sessionId) {
                                try {
                                    const response = await fetch('/api/kv/user-lyrics', {
                                        method: 'POST',
                                        headers: {
                                            'Content-Type': 'application/json',
                                            'X-Session-Id': this.sessionId
                                        },
                                        body: JSON.stringify({
                                            trackInfo: value.trackInfo,
                                            lyrics: value.lyrics,
                                            lyricsType: value.lyricsType,
                                            source: value.source
                                        })
                                    });

                                    if (!response.ok) {
                                        const responseText = await response.text();
                                        console.warn(`同步歌詞到雲端失敗: ${response.status} - ${responseText}`);
                                    }
                                } catch (syncError) {
                                    console.warn(`同步歌詞到雲端失敗: ${syncError.message}`);
                                    // 同步失敗不影響本地匯入
                                }
                            }

                            importedCount++;
                        } catch (error) {
                            failedCount++;
                            this.log(`❌ 匯入自定義歌詞失敗: ${error.message}`);
                        }

                        // 更新進度
                        this.showSyncProgress(importedCount + failedCount, totalItems);
                    }

                    // 匯入供應商設置
                    for (const [key, value] of Object.entries(importData.providers)) {
                        try {
                            const providers = JSON.parse(localStorage.getItem('user_lyrics_providers') || '{}');
                            providers[key] = value;
                            localStorage.setItem('user_lyrics_providers', JSON.stringify(providers));

                            // 同步到雲端 using existing endpoint
                            if (this.sessionId) {
                                try {
                                    const response = await fetch('/api/kv/save-provider', {
                                        method: 'POST',
                                        headers: {
                                            'Content-Type': 'application/json',
                                            'X-Session-Id': this.sessionId
                                        },
                                        body: JSON.stringify({
                                            trackInfo: value.trackInfo,
                                            provider: value.provider
                                        })
                                    });

                                    if (!response.ok) {
                                        const responseText = await response.text();
                                        console.warn(`同步供應商到雲端失敗: ${response.status} - ${responseText}`);
                                    }
                                } catch (syncError) {
                                    console.warn(`同步供應商到雲端失敗: ${syncError.message}`);
                                    // 同步失敗不影響本地匯入
                                }
                            }

                            importedCount++;
                        } catch (error) {
                            failedCount++;
                            this.log(`❌ 匯入供應商設置失敗: ${error.message}`);
                        }

                        // 更新進度
                        this.showSyncProgress(importedCount + failedCount, totalItems);
                    }

                    // 隱藏進度顯示
                    this.hideSyncProgress();

                    const successMessage = `✅ 匯入完成！成功: ${importedCount}, 失敗: ${failedCount}`;
                    this.showSuccessMessage(successMessage);

                    // 重新加載管理界面
                    this.populateUserLyricsManagerContent();

                    this.log(`✅ 匯入完成: 成功 ${importedCount}, 失敗 ${failedCount}`);
                } catch (error) {
                    this.hideSyncProgress();
                    this.showErrorMessage(`❌ 匯入失敗: ${error.message}`);
                    this.log(`❌ 匯入過程中發生錯誤: ${error.message}`);
                }
            };
            fileInput.click();
        } catch (error) {
            this.showErrorMessage(`❌ 匯入過程初始化失敗: ${error.message}`);
            this.log(`❌ 匯入過程初始化失敗: ${error.message}`);
        }
    };

    // 生成歌曲緩存鍵值
    SpotifyLyricsPlayer.prototype.generateTrackCacheKey = function(track) {
        if (!track) return '';
        return `${track.id}-${track.name}-${track.artist}`.toLowerCase().replace(/\s+/g, '_');
    };

    // =================
    // 綁定事件
    // =================

    // 綁定用戶歌詞管理按鈕事件
    document.getElementById('user-lyrics-manager-btn')?.addEventListener('click', () => {
        if (window.player) {
            window.player.showUserLyricsManager();
        }
    });

    console.log('✅ 用戶自定義歌詞管理系統已加載完成');
}