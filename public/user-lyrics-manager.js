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
    // 自動同步功能
    // =================
    
    // 在頁面加載時自動執行一次雙向同步
    if (typeof SpotifyLyricsPlayer !== 'undefined' && SpotifyLyricsPlayer.prototype) {
        // 延遲執行，確保 player 實例已經創建
        setTimeout(() => {
            if (window.player && window.player.sessionId) {
                console.log('🔄 自動執行雙向同步...');
                window.player.syncAndMergeAllData().catch(err => {
                    console.warn('⚠️ 自動同步失敗:', err.message);
                });
            }
        }, 2000); // 延遲2秒確保所有組件都已初始化
    }

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
            
            // Ensure provider is a string, not a promise or object
            const providerName = (provider && typeof provider === 'object' && provider.then) ? await provider : provider;
            
            if (providerName) {
                this.log(`🎯 找到用戶指定供應商: ${providerName} for ${trackInfo.artist} - ${trackInfo.name}`);
                return providerName;
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
            const source = {
                source: 'manual_save',
                title: `${this.currentTrack.artist} - ${this.currentTrack.name}`,
                artist: this.currentTrack.artist,
                savedAt: Date.now()
            };
            const saved = await this.saveUserCustomLyrics(this.currentTrack, this.lyrics, this.lyricsType, source);

            if (saved) {
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
                    source,
                    lastUsed: Date.now()
                };

                localStorage.setItem('user_custom_lyrics', JSON.stringify(customLyrics));

                this.showSuccessMessage('✅ 當前歌詞已保存為自定義歌詞');
            } else {
                throw new Error('保存失敗');
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

            // 廣播到其他分頁 (控制台)
            if (this.controlChannel) {
                this.controlChannel.postMessage({ 
                    type: 'control-sync', 
                    manualLyrics: { 
                        id: result.id, 
                        source: result.provider, 
                        title: result.title, 
                        artist: result.artist 
                    } 
                });
            }
        }
    };

    // 清除特定歌曲的用戶設置
    const originalClearUserSettingsForTrack = SpotifyLyricsPlayer.prototype.clearUserSettingsForTrack;
    SpotifyLyricsPlayer.prototype.clearUserSettingsForTrack = function(trackInfo) {
        // 先執行廣播 (在數據被刪除前)
        if (this.controlChannel) {
            this.controlChannel.postMessage({ 
                type: 'control-sync', 
                lyricsOffset: 0,
                manualLyrics: null
            });
        }

        // 調用原始邏輯 (如果有的話，如果沒有則手動實現)
        if (typeof originalClearUserSettingsForTrack === 'function') {
            originalClearUserSettingsForTrack.call(this, trackInfo);
        } else {
            // 手動實現 (剛才讀到的邏輯)
            if (!trackInfo) trackInfo = this.currentTrack;
            if (!trackInfo) return;
            const trackKey = this.generateTrackKey(trackInfo);
            try {
                const customLyrics = JSON.parse(localStorage.getItem('user_custom_lyrics') || '{}');
                if (customLyrics[trackKey]) delete customLyrics[trackKey];
                localStorage.setItem('user_custom_lyrics', JSON.stringify(customLyrics));
                
                const providers = JSON.parse(localStorage.getItem('user_lyrics_providers') || '{}');
                if (providers[trackKey]) delete providers[trackKey];
                localStorage.setItem('user_lyrics_providers', JSON.stringify(providers));
                
                this.showSuccessMessage('✅ 已清除該歌曲的用戶設置');
            } catch (e) {}
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
            z-index: 2000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0,0,0,0.75);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            animation: modalFadeIn 0.2s ease-out;
        `;
        
        modal.innerHTML = `
            <div class="modal-content" style="
                background: #282828;
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 16px;
                margin: 5% auto;
                padding: 28px;
                width: 90%;
                max-width: 720px;
                max-height: 85vh;
                overflow-y: auto;
                color: #fff;
                box-shadow: 0 24px 48px rgba(0, 0, 0, 0.4);
                animation: modalSlideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
            ">
                <div style="
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 24px;
                    padding-bottom: 16px;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                ">
                    <h2 style="margin: 0; font-size: 1.25rem; font-weight: 700;">自定義歌詞管理</h2>
                    <button id="close-user-lyrics-manager" style="
                        background: rgba(255, 255, 255, 0.08);
                        border: 1px solid rgba(255, 255, 255, 0.1);
                        color: #b3b3b3;
                        width: 32px;
                        height: 32px;
                        border-radius: 50%;
                        cursor: pointer;
                        font-size: 18px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        transition: all 0.2s;
                    ">&times;</button>
                </div>
                <div id="user-lyrics-manager-content"></div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        const closeBtn = modal.querySelector('#close-user-lyrics-manager');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                modal.style.display = 'none';
            });
            closeBtn.addEventListener('mouseenter', () => {
                closeBtn.style.background = 'rgba(255, 255, 255, 0.15)';
                closeBtn.style.color = '#fff';
            });
            closeBtn.addEventListener('mouseleave', () => {
                closeBtn.style.background = 'rgba(255, 255, 255, 0.08)';
                closeBtn.style.color = '#b3b3b3';
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
                    const lyricsResponse = await fetch('/api/kv/all-lyrics', {
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
            html += '<h3 style="color: var(--primary-color, #1db954); margin: 0 0 16px 0; font-size: 14px; font-weight: 600; letter-spacing: 0.02em;">自定義歌詞</h3>';

            const customEntries = Object.values(allCustomLyrics);
            if (customEntries.length > 0) {
                customEntries
                    .sort((a, b) => (b.lastUsed || b.updated_at || Date.now()) - (a.lastUsed || a.updated_at || Date.now()))
                    .forEach(entry => {
                        const trackInfo = entry.trackInfo || {};
                        const trackKey = entry.trackKey || this.generateTrackCacheKey(trackInfo);
                        const lyricsCount = entry.lyrics ? entry.lyrics.length : 0;
                        const lastUsed = new Date(entry.lastUsed || entry.updated_at || Date.now()).toLocaleDateString();

                        html += `
                            <div style="
                                background: rgba(255, 255, 255, 0.04);
                                border: 1px solid rgba(255, 255, 255, 0.06);
                                padding: 14px 16px;
                                margin-bottom: 8px;
                                border-radius: 10px;
                                transition: all 0.2s;
                            ">
                                <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px;">
                                    <div style="flex: 1; min-width: 0;">
                                        <div style="font-weight: 600; font-size: 14px; color: #fff; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                            ${this.escapeHtml(trackInfo.artist || '未知')} — ${this.escapeHtml(trackInfo.name || '未知')}
                                        </div>
                                        <div style="font-size: 12px; color: #b3b3b3; display: flex; gap: 8px; align-items: center;">
                                            <span style="padding: 2px 6px; background: rgba(29, 185, 84, 0.15); color: #1db954; border-radius: 4px; font-size: 11px;">${entry.lyricsType === 'synced' ? '同步' : '普通'}</span>
                                            <span>${lyricsCount} 行</span>
                                            <span style="color: #727272;">${lastUsed}</span>
                                        </div>
                                    </div>
                                    <div style="display: flex; gap: 6px; flex-shrink: 0;">
                                        <button onclick="window.player.syncSingleLyrics('${trackKey}')" style="
                                            background: rgba(255, 255, 255, 0.08);
                                            color: #fff;
                                            border: 1px solid rgba(255, 255, 255, 0.1);
                                            padding: 6px 12px;
                                            border-radius: 6px;
                                            cursor: pointer;
                                            font-size: 12px;
                                            font-weight: 500;
                                            transition: all 0.2s;
                                        ">同步</button>
                                        <button onclick="window.player.deleteUserCustomLyrics('${trackKey}')" style="
                                            background: rgba(220, 53, 69, 0.12);
                                            color: #ff6b6b;
                                            border: 1px solid rgba(220, 53, 69, 0.25);
                                            padding: 6px 12px;
                                            border-radius: 6px;
                                            cursor: pointer;
                                            font-size: 12px;
                                            font-weight: 500;
                                            transition: all 0.2s;
                                        ">刪除</button>
                                    </div>
                                </div>
                            </div>
                        `;
                    });
            } else {
                html += '<p style="color: #727272; text-align: center; padding: 24px; font-size: 13px;">暫無自定義歌詞</p>';
            }

            // 指定供應商部分
            html += '<h3 style="color: #ffc107; margin: 24px 0 16px 0; font-size: 14px; font-weight: 600; letter-spacing: 0.02em;">指定供應商</h3>';

            const providerEntries = Object.values(allProviders);
            if (providerEntries.length > 0) {
                providerEntries
                    .sort((a, b) => (b.lastUsed || Date.now()) - (a.lastUsed || Date.now()))
                    .forEach(entry => {
                        const trackInfo = entry.trackInfo || {};
                        const trackKey = entry.trackKey || this.generateTrackCacheKey(trackInfo);
                        const lastUsed = new Date(entry.lastUsed || Date.now()).toLocaleDateString();

                        html += `
                            <div style="
                                background: rgba(255, 255, 255, 0.04);
                                border: 1px solid rgba(255, 255, 255, 0.06);
                                padding: 14px 16px;
                                margin-bottom: 8px;
                                border-radius: 10px;
                            ">
                                <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px;">
                                    <div style="flex: 1; min-width: 0;">
                                        <div style="font-weight: 600; font-size: 14px; color: #fff; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                            ${this.escapeHtml(trackInfo.artist || '未知')} — ${this.escapeHtml(trackInfo.name || '未知')}
                                        </div>
                                        <div style="font-size: 12px; color: #b3b3b3;">
                                            <span style="padding: 2px 6px; background: rgba(255, 193, 7, 0.15); color: #ffc107; border-radius: 4px; font-size: 11px;">${this.escapeHtml(entry.provider || '未知')}</span>
                                            <span style="margin-left: 8px; color: #727272;">${lastUsed}</span>
                                        </div>
                                    </div>
                                    <div style="display: flex; gap: 6px; flex-shrink: 0;">
                                        <button onclick="window.player.syncSingleProvider('${trackKey}')" style="
                                            background: rgba(255, 255, 255, 0.08);
                                            color: #fff;
                                            border: 1px solid rgba(255, 255, 255, 0.1);
                                            padding: 6px 12px;
                                            border-radius: 6px;
                                            cursor: pointer;
                                            font-size: 12px;
                                            font-weight: 500;
                                        ">同步</button>
                                        <button onclick="window.player.deleteUserLyricsProvider('${trackKey}')" style="
                                            background: rgba(220, 53, 69, 0.12);
                                            color: #ff6b6b;
                                            border: 1px solid rgba(220, 53, 69, 0.25);
                                            padding: 6px 12px;
                                            border-radius: 6px;
                                            cursor: pointer;
                                            font-size: 12px;
                                            font-weight: 500;
                                        ">刪除</button>
                                    </div>
                                </div>
                            </div>
                        `;
                    });
            } else {
                html += '<p style="color: #727272; text-align: center; padding: 24px; font-size: 13px;">暫無指定供應商</p>';
            }

            // 操作按鈕
            html += `
                <div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid rgba(255, 255, 255, 0.06);">
                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                        <button onclick="window.player.saveCurrentLyricsAsCustom()" style="
                            background: var(--primary-color, #1db954);
                            color: white;
                            border: none;
                            padding: 8px 16px;
                            border-radius: 6px;
                            cursor: pointer;
                            font-size: 13px;
                            font-weight: 600;
                        ">保存當前歌詞</button>
                        <button onclick="window.player.clearUserSettingsForTrack()" style="
                            background: rgba(255, 193, 7, 0.15);
                            color: #ffc107;
                            border: 1px solid rgba(255, 193, 7, 0.25);
                            padding: 8px 16px;
                            border-radius: 6px;
                            cursor: pointer;
                            font-size: 13px;
                            font-weight: 500;
                        ">清除當前歌曲</button>
                        <button onclick="window.player.syncAndMergeAllData()" style="
                            background: rgba(255, 255, 255, 0.08);
                            color: #fff;
                            border: 1px solid rgba(255, 255, 255, 0.1);
                            padding: 8px 16px;
                            border-radius: 6px;
                            cursor: pointer;
                            font-size: 13px;
                            font-weight: 500;
                        ">同步所有</button>
                        <button onclick="window.player.exportAllUserLyrics()" style="
                            background: rgba(255, 255, 255, 0.08);
                            color: #fff;
                            border: 1px solid rgba(255, 255, 255, 0.1);
                            padding: 8px 16px;
                            border-radius: 6px;
                            cursor: pointer;
                            font-size: 13px;
                            font-weight: 500;
                        ">匯出</button>
                        <button onclick="window.player.importUserLyrics()" style="
                            background: rgba(255, 255, 255, 0.08);
                            color: #fff;
                            border: 1px solid rgba(255, 255, 255, 0.1);
                            padding: 8px 16px;
                            border-radius: 6px;
                            cursor: pointer;
                            font-size: 13px;
                            font-weight: 500;
                        ">匯入</button>
                        <button onclick="window.player.clearAllUserLyricsSettings()" style="
                            background: rgba(220, 53, 69, 0.12);
                            color: #ff6b6b;
                            border: 1px solid rgba(220, 53, 69, 0.25);
                            padding: 8px 16px;
                            border-radius: 6px;
                            cursor: pointer;
                            font-size: 13px;
                            font-weight: 500;
                        ">清除全部</button>
                    </div>
                </div>
            `;

            content.innerHTML = html;

        } catch (error) {
            content.innerHTML = `<p style="color: #dc3545;">加載數據失敗: ${error.message}</p>`;
        }
    };

    // 刪除特定的用戶自定義歌詞
    SpotifyLyricsPlayer.prototype.deleteUserCustomLyrics = async function(trackKey) {
        if (!confirm('確定要刪除這首歌的自定義歌詞嗎？此操作將從本地和雲端刪除。')) {
            return;
        }

        try {
            // 1. 從服務器刪除
            if (this.sessionId) {
                this.log(`🗑️ 正在從雲端刪除歌詞: ${trackKey}`);
                const response = await fetch(`/api/kv/user-lyrics/${trackKey}`, {
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Session-Id': this.sessionId
                    }
                });

                if (!response.ok && response.status !== 404) {
                    const errorData = await response.json().catch(() => ({ error: '服務器錯誤' }));
                    throw new Error(errorData.error || `服務器錯誤 (${response.status})`);
                }
                this.log(`✅ 雲端刪除請求完成 (狀態: ${response.status})`);
            }
            
            // 2. 從本地存儲刪除
            const customLyrics = JSON.parse(localStorage.getItem('user_custom_lyrics') || '{}');
            if (customLyrics[trackKey]) {
                delete customLyrics[trackKey];
                localStorage.setItem('user_custom_lyrics', JSON.stringify(customLyrics));
                this.log(`🗑️ 已從本地存儲刪除歌詞: ${trackKey}`);
            }

            // Also remove from memory
            if (this.savedLyrics && this.savedLyrics.has(trackKey)) {
                this.savedLyrics.delete(trackKey);
            }
            
            // 3. 更新UI
            this.populateUserLyricsManagerContent();
            this.showSuccessMessage('✅ 自定義歌詞已刪除');

        } catch (error) {
            this.showErrorMessage('刪除失敗: ' + error.message);
            this.log(`❌ 刪除歌詞時出錯: ${error.message}`);
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

    // 同步並合併所有用戶數據 (雙向同步策略)
    SpotifyLyricsPlayer.prototype.syncAndMergeAllData = async function(silent = false) {
        if (this.isSyncingAll) return;
        this.isSyncingAll = true;

        try {
            this.log('🔄 開始執行全量雙向同步...');
            if (!silent) this.showSyncProgress(0, 0, '正在獲取雲端數據...');

            const parseJson = (key) => {
                try {
                    return JSON.parse(localStorage.getItem(key) || '{}');
                } catch (_) {
                    return {};
                }
            };
            const toTime = (value) => {
                if (!value) return 0;
                if (typeof value === 'number') return value;
                const parsed = new Date(value).getTime();
                return Number.isFinite(parsed) ? parsed : 0;
            };
            const normalizeTrackInfo = (item, fallbackKey = '') => {
                const trackInfo = item?.trackInfo || {};
                const id = trackInfo.id || item?.trackId || item?.id || fallbackKey.split('-')[0];
                if (!id) return null;
                return {
                    id,
                    name: trackInfo.name || item?.trackName || item?.name || '',
                    artist: trackInfo.artist || item?.artistName || item?.artist || ''
                };
            };
            const storageKeyFor = (trackInfo) => {
                if (window.lyricsStorageManager?.generateTrackKey) {
                    return window.lyricsStorageManager.generateTrackKey(trackInfo);
                }
                return this.generateTrackCacheKey(trackInfo).replace(/[^\w\-_]/g, '');
            };
            const newerThan = (a, b) => toTime(a?.lastModified || a?.updatedAt || a?.updated_at || a?.timestamp || a?.savedTime) >
                toTime(b?.lastModified || b?.updatedAt || b?.updated_at || b?.timestamp || b?.savedTime);
            const normalizeLyricEntry = (item, fallbackKey = '') => {
                const trackInfo = normalizeTrackInfo(item, fallbackKey);
                const lyrics = item?.lyrics || item?.lyricsContent;
                if (!trackInfo || !Array.isArray(lyrics) || lyrics.length === 0) return null;
                const meta = item.customLyricsMeta || {};
                const ts = item.lastModified || item.updatedAt || item.updated_at || item.timestamp || Date.now();
                return {
                    trackInfo,
                    lyrics,
                    lyricsType: item.lyricsType || meta.type || 'synced',
                    source: item.source || meta.source || { source: 'custom' },
                    customLyricsMeta: meta,
                    lastModified: ts,
                    timestamp: ts,
                    version: item.version || 2
                };
            };
            const normalizeOffsetEntry = (item, fallbackKey = '') => {
                const trackInfo = normalizeTrackInfo(item, fallbackKey);
                if (!trackInfo) return null;
                const timeOffset = typeof item === 'number' ? item : (item.timeOffset ?? item.offset);
                if (timeOffset === undefined || timeOffset === null) return null;
                const ts = item.lastUpdated || item.lastModified || item.updatedAt || item.updated_at || item.timestamp || item.savedTime || Date.now();
                return { trackInfo, timeOffset, timestamp: ts, lastUpdated: ts };
            };

            // 1. 從 localStorage 獲取本地數據
            const localCustomLyrics = parseJson('user_custom_lyrics');
            const localSavedLyrics = parseJson('saved_lyrics');
            const localLyricsBackup = parseJson('lyrics_backup');
            const localOffsets = parseJson('lyrics_time_adjustments');
            const localLegacyOffsets = parseJson('lyrics_offsets');
            const localProviders = parseJson('user_lyrics_providers');

            // 2. 獲取雲端數據
            let cloudLyrics = [];
            let cloudTimeAdjustments = [];
            let cloudProviders = [];

            if (this.sessionId) {
                try {
                    const response = await fetch('/api/kv/all-lyrics', {
                        headers: { 'X-Session-Id': this.sessionId }
                    });
                    if (response.ok) {
                        const result = await response.json();
                        if (result.success) {
                            cloudLyrics = result.lyrics || result.data || [];
                        }
                    }
                } catch (error) {
                    this.log(`⚠️ 獲取雲端歌詞失敗: ${error.message}`);
                }

                try {
                    const response = await fetch('/api/kv/get-time-offsets', {
                        headers: { 'X-Session-Id': this.sessionId }
                    });
                    if (response.ok) {
                        const result = await response.json();
                        if (Array.isArray(result)) {
                            cloudTimeAdjustments = result;
                        } else if (result.success) {
                            cloudTimeAdjustments = result.data || Object.values(result.offsets || {});
                        }
                    }
                } catch (error) {
                    this.log(`⚠️ 獲取雲端時間調整失敗: ${error.message}`);
                }

                try {
                    const response = await fetch('/api/kv/user-providers', {
                        headers: { 'X-Session-Id': this.sessionId }
                    });
                    if (response.ok) {
                        const result = await response.json();
                        if (result.success) {
                            cloudProviders = result.data || [];
                        }
                    }
                } catch (error) {
                    this.log(`⚠️ 獲取雲端供應商偏好失敗: ${error.message}`);
                }
            }

            // 3. 合併邏輯 (Merge)
            // 合併規則：如果兩邊都有，比較 lastModified，本地優先 (相等或本地較新)
            const mergedCustomLyrics = {};
            const mergedSavedLyrics = {};
            const mergedLyricsBackup = {};
            const addLyric = (entry, keyHint = '') => {
                const normalized = normalizeLyricEntry(entry, keyHint);
                if (!normalized) return;
                const playerKey = this.generateTrackCacheKey(normalized.trackInfo);
                const storageKey = storageKeyFor(normalized.trackInfo);
                const existing = mergedSavedLyrics[playerKey] || mergedCustomLyrics[playerKey] || mergedLyricsBackup[storageKey];
                if (!existing || newerThan(normalized, existing)) {
                    mergedCustomLyrics[playerKey] = normalized;
                    mergedSavedLyrics[playerKey] = normalized;
                    mergedLyricsBackup[storageKey] = normalized;
                }
            };

            Object.entries(localCustomLyrics).forEach(([key, value]) => addLyric(value, key));
            Object.entries(localSavedLyrics).forEach(([key, value]) => addLyric(value, key));
            Object.entries(localLyricsBackup).forEach(([key, value]) => addLyric(value, key));
            cloudLyrics.forEach(item => addLyric(item, item.trackId));

            const mergedOffsets = {};
            const mergedLegacyOffsets = {};
            const addOffset = (entry, keyHint = '') => {
                const normalized = normalizeOffsetEntry(entry, keyHint);
                if (!normalized) return;
                const playerKey = this.generateTrackCacheKey(normalized.trackInfo);
                const storageKey = storageKeyFor(normalized.trackInfo);
                const existing = mergedOffsets[playerKey] || mergedLegacyOffsets[storageKey];
                if (!existing || newerThan(normalized, existing)) {
                    mergedOffsets[playerKey] = normalized;
                    mergedLegacyOffsets[storageKey] = {
                        offset: normalized.timeOffset,
                        savedTime: normalized.lastUpdated || normalized.timestamp
                    };
                }
            };

            Object.entries(localOffsets).forEach(([key, value]) => addOffset(value, key));
            Object.entries(localLegacyOffsets).forEach(([key, value]) => addOffset({ ...value, timeOffset: value.offset }, key));
            cloudTimeAdjustments.forEach(item => addOffset(item, item.key || item.trackId));

            const mergedProviders = { ...localProviders };
            cloudProviders.forEach(item => {
                const trackInfo = normalizeTrackInfo(item, item.key);
                if (!trackInfo || !item.provider) return;
                const key = this.generateTrackCacheKey(trackInfo);
                const providerEntry = {
                    trackInfo,
                    provider: item.provider,
                    settings: item.settings || {},
                    lastUsed: item.lastUsed || Date.now()
                };
                if (!mergedProviders[key] || newerThan(providerEntry, mergedProviders[key])) {
                    mergedProviders[key] = providerEntry;
                }
            });

            // 4. 保存合併後的數據到本地 (帶有空間檢查)
            const safeSetItem = (key, data) => {
                try {
                    localStorage.setItem(key, JSON.stringify(data));
                    return true;
                } catch (error) {
                    if (error.name === 'QuotaExceededError') {
                        this.log(`⚠️ 存儲空間不足，嘗試清理緩存後重試: ${key}`);
                        // 1. 嘗試清理臨時緩存
                        localStorage.removeItem('lyrics_cache');
                        localStorage.removeItem('enhanced_lyrics_cache');
                        
                        try {
                            localStorage.setItem(key, JSON.stringify(data));
                            return true;
                        } catch (retryError) {
                            this.log(`❌ 存儲空間仍然不足，無法保存 ${key}`);
                            return false;
                        }
                    }
                    this.log(`❌ 保存 ${key} 失敗: ${error.message}`);
                    return false;
                }
            };

            safeSetItem('user_custom_lyrics', mergedCustomLyrics);
            safeSetItem('saved_lyrics', mergedSavedLyrics);
            safeSetItem('lyrics_backup', mergedLyricsBackup);
            safeSetItem('lyrics_time_adjustments', mergedOffsets);
            safeSetItem('lyrics_offsets', mergedLegacyOffsets);
            safeSetItem('user_lyrics_providers', mergedProviders);

            this.savedLyrics = new Map(Object.entries(mergedSavedLyrics));
            this.lyricsTimeAdjustments = new Map(Object.entries(mergedOffsets));

            // 檢查是否所有關鍵數據都成功保存
            const isFull = localStorage.getItem('saved_lyrics') === null;
            if (isFull && !silent) {
                this.showErrorMessage('⚠️ 瀏覽器存儲空間已滿，部分數據僅保存在雲端。建議清理舊歌詞或使用雲端同步。');
            }

            // 5. 批次上傳回雲端 (確保雲端也是最新的合併結果)
            const entriesToUpload = Object.values(mergedSavedLyrics).filter(item => item && item.trackInfo && item.trackInfo.id);
            const offsetsToUpload = Object.values(mergedOffsets).filter(item => item && item.trackInfo && item.trackInfo.id);
            const providersToUpload = Object.values(mergedProviders).filter(item => item && item.trackInfo && item.trackInfo.id && (item.provider || item.source));
            const totalToUpload = entriesToUpload.length + offsetsToUpload.length + providersToUpload.length;
            this.log(`📤 開始上傳合併後的數據到雲端: 共 ${totalToUpload} 項`);
            if (!silent) this.showSyncProgress(0, totalToUpload, '正在上傳合併數據...');

            const batchSize = 20;
            let successCount = 0;
            let failedCount = 0;
            let processed = 0;

            for (let i = 0; i < entriesToUpload.length; i += batchSize) {
                const batch = entriesToUpload.slice(i, i + batchSize);
                try {
                    const response = await fetch('/api/kv/sync-lyrics', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Session-Id': this.sessionId
                        },
                        body: JSON.stringify({ lyrics: batch })
                    });

                    if (response.ok) {
                        successCount += batch.length;
                    } else {
                        failedCount += batch.length;
                    }
                } catch (e) {
                    failedCount += batch.length;
                }
                processed += batch.length;
                if (!silent) this.showSyncProgress(processed, totalToUpload, `正在同步歌詞...`);
            }

            for (let i = 0; i < offsetsToUpload.length; i += batchSize) {
                const batch = offsetsToUpload.slice(i, i + batchSize);
                try {
                    const response = await fetch('/api/kv/sync-time-adjustments', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Session-Id': this.sessionId
                        },
                        body: JSON.stringify({ adjustments: batch })
                    });
                    if (response.ok) successCount += batch.length;
                    else failedCount += batch.length;
                } catch (_) {
                    failedCount += batch.length;
                }
                processed += batch.length;
                if (!silent) this.showSyncProgress(processed, totalToUpload, `正在同步時間調整...`);
            }

            for (const item of providersToUpload) {
                try {
                    const response = await fetch('/api/kv/user-provider', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Session-Id': this.sessionId
                        },
                        body: JSON.stringify({
                            trackInfo: item.trackInfo,
                            provider: item.provider || item.source
                        })
                    });
                    if (response.ok) successCount++;
                    else failedCount++;
                } catch (_) {
                    failedCount++;
                }
                processed++;
                if (!silent) this.showSyncProgress(processed, totalToUpload, `正在同步供應商偏好...`);
            }

            if (!silent) {
                this.hideSyncProgress();
                this.showSuccessMessage(`✅ 全量同步完成！成功: ${successCount}, 失敗: ${failedCount}`);
            }
            this.log(`✅ 全量同步完成: ${successCount} 成功, ${failedCount} 失敗`);

            if (typeof this.updateSyncStatus === 'function') {
                this.updateSyncStatus();
            }

        } catch (error) {
            if (!silent) {
                this.hideSyncProgress();
                this.showErrorMessage(`❌ 同步失敗: ${error.message}`);
            }
            this.log(`❌ 同步過程中發生錯誤: ${error.message}`);
        } finally {
            this.isSyncingAll = false;
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
                    const lyricsResponse = await fetch('/api/kv/all-lyrics', {
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
