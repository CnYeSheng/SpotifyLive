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
        const customLyrics = this.getUserCustomLyrics(trackInfo);
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
        const preferredProvider = this.getUserLyricsProvider(trackInfo);
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
    SpotifyLyricsPlayer.prototype.saveCurrentLyricsAsCustom = function() {
        if (!this.currentTrack) {
            this.showErrorMessage('沒有當前播放的歌曲');
            return;
        }
        
        if (!this.lyrics || this.lyrics.length === 0) {
            this.showErrorMessage('沒有可保存的歌詞');
            return;
        }
        
        const success = this.saveUserCustomLyrics(
            this.currentTrack,
            this.lyrics,
            this.lyricsType,
            {
                source: 'manual_save',
                title: `${this.currentTrack.artist} - ${this.currentTrack.name}`,
                artist: this.currentTrack.artist,
                savedAt: Date.now()
            }
        );
        
        if (success) {
            this.showSuccessMessage('✅ 當前歌詞已保存為自定義歌詞');
        } else {
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
        modal.querySelector('#close-user-lyrics-manager').addEventListener('click', () => {
            modal.style.display = 'none';
        });
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
        
        return modal;
    };

    // 填充用戶歌詞管理內容
    SpotifyLyricsPlayer.prototype.populateUserLyricsManagerContent = function() {
        const content = document.getElementById('user-lyrics-manager-content');
        if (!content) return;
        
        try {
            const customLyrics = JSON.parse(localStorage.getItem('user_custom_lyrics') || '{}');
            const providers = JSON.parse(localStorage.getItem('user_lyrics_providers') || '{}');
            
            let html = '';
            
            // 自定義歌詞部分
            html += '<h3 style="color: var(--accent-color, #1db954); margin-bottom: 15px;">🎵 自定義歌詞</h3>';
            
            const customEntries = Object.values(customLyrics);
            if (customEntries.length > 0) {
                customEntries
                    .sort((a, b) => b.lastUsed - a.lastUsed)
                    .forEach(entry => {
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
                                        <strong>${this.escapeHtml(entry.trackInfo.artist)} - ${this.escapeHtml(entry.trackInfo.name)}</strong>
                                        <br>
                                        <small style="color: #888;">
                                            ${entry.lyricsType === 'synced' ? '同步歌詞' : '普通歌詞'} • 
                                            ${entry.lyrics.length} 行 • 
                                            最後使用: ${new Date(entry.lastUsed).toLocaleDateString()}
                                        </small>
                                    </div>
                                    <button onclick="window.player.deleteUserCustomLyrics('${entry.trackKey}')" style="
                                        background: #dc3545;
                                        color: white;
                                        border: none;
                                        padding: 8px 12px;
                                        border-radius: 4px;
                                        cursor: pointer;
                                    ">刪除</button>
                                </div>
                            </div>
                        `;
                    });
            } else {
                html += '<p style="color: #888; text-align: center; padding: 20px;">暫無自定義歌詞</p>';
            }
            
            // 指定供應商部分
            html += '<h3 style="color: var(--accent-color, #1db954); margin: 30px 0 15px 0;">🔒 指定供應商</h3>';
            
            const providerEntries = Object.values(providers);
            if (providerEntries.length > 0) {
                providerEntries
                    .sort((a, b) => b.lastUsed - a.lastUsed)
                    .forEach(entry => {
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
                                        <strong>${this.escapeHtml(entry.trackInfo.artist)} - ${this.escapeHtml(entry.trackInfo.name)}</strong>
                                        <br>
                                        <small style="color: #888;">
                                            供應商: ${this.escapeHtml(entry.provider)} • 
                                            最後使用: ${new Date(entry.lastUsed).toLocaleDateString()}
                                        </small>
                                    </div>
                                    <button onclick="window.player.deleteUserLyricsProvider('${entry.trackKey}')" style="
                                        background: #dc3545;
                                        color: white;
                                        border: none;
                                        padding: 8px 12px;
                                        border-radius: 4px;
                                        cursor: pointer;
                                    ">刪除</button>
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