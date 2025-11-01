// 用户自定义歌词管理系统
// User Custom Lyrics Management System

// 等待主脚本载入完成
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
    console.log('🔧 初始化用户自定义歌词管理系统');

    // =================
    // 用户歌词存储管理
    // =================
    
    // 生成歌曲唯一标识符
    SpotifyLyricsPlayer.prototype.generateTrackKey = function(trackInfo) {
        const artist = trackInfo.artist || trackInfo.artists?.[0]?.name || '';
        const name = trackInfo.name || trackInfo.title || '';
        const id = trackInfo.id || '';
        
        // 使用多种标识符确保唯一性
        return `${id}-${artist}-${name}`.toLowerCase()
            .replace(/\s+/g, '_')
            .replace(/[^\w\-_]/g, '');
    };

    // 保存用户自定义歌词
    SpotifyLyricsPlayer.prototype.saveUserCustomLyrics = function(trackInfo, lyrics, lyricsType, source) {
        const trackKey = this.generateTrackKey(trackInfo);
        
        const customLyricsData = {
            trackKey: trackKey,
            trackInfo: {
                id: trackInfo.id,
                name: trackInfo.name,
                artist: trackInfo.artist,
                album: trackInfo.album
            },
            lyrics: lyrics,
            lyricsType: lyricsType || 'plain',
            source: source || 'user_custom',
            timestamp: Date.now(),
            lastUsed: Date.now()
        };

        try {
            // 获取现有的自定义歌词数据
            const existingData = JSON.parse(localStorage.getItem('user_custom_lyrics') || '{}');
            
            // 保存新的歌词数据
            existingData[trackKey] = customLyricsData;
            
            localStorage.setItem('user_custom_lyrics', JSON.stringify(existingData));
            
            this.log(`💾 已保存用户自定义歌词: ${trackInfo.artist} - ${trackInfo.name}`);
            
            return true;
        } catch (error) {
            this.log(`❌ 保存用户自定义歌词失败: ${error.message}`);
            return false;
        }
    };

    // 获取用户自定义歌词
    SpotifyLyricsPlayer.prototype.getUserCustomLyrics = function(trackInfo) {
        const trackKey = this.generateTrackKey(trackInfo);
        
        try {
            const customLyricsData = JSON.parse(localStorage.getItem('user_custom_lyrics') || '{}');
            const userData = customLyricsData[trackKey];
            
            if (userData) {
                // 更新最后使用时间
                userData.lastUsed = Date.now();
                customLyricsData[trackKey] = userData;
                localStorage.setItem('user_custom_lyrics', JSON.stringify(customLyricsData));
                
                this.log(`🎯 找到用户自定义歌词: ${trackInfo.artist} - ${trackInfo.name}`);
                return userData;
            }
            
            return null;
        } catch (error) {
            this.log(`❌ 获取用户自定义歌词失败: ${error.message}`);
            return null;
        }
    };

    // 保存用户指定的歌词供应商
    SpotifyLyricsPlayer.prototype.saveUserLyricsProvider = function(trackInfo, provider) {
        const trackKey = this.generateTrackKey(trackInfo);
        
        const providerData = {
            trackKey: trackKey,
            trackInfo: {
                id: trackInfo.id,
                name: trackInfo.name,
                artist: trackInfo.artist
            },
            provider: provider,
            timestamp: Date.now(),
            lastUsed: Date.now()
        };

        try {
            const existingData = JSON.parse(localStorage.getItem('user_lyrics_providers') || '{}');
            existingData[trackKey] = providerData;
            localStorage.setItem('user_lyrics_providers', JSON.stringify(existingData));
            
            this.log(`🔒 已保存用户指定供应商: ${provider} for ${trackInfo.artist} - ${trackInfo.name}`);
            return true;
        } catch (error) {
            this.log(`❌ 保存用户指定供应商失败: ${error.message}`);
            return false;
        }
    };

    // 获取用户指定的歌词供应商
    SpotifyLyricsPlayer.prototype.getUserLyricsProvider = function(trackInfo) {
        const trackKey = this.generateTrackKey(trackInfo);
        
        try {
            const providerData = JSON.parse(localStorage.getItem('user_lyrics_providers') || '{}');
            const userData = providerData[trackKey];
            
            if (userData) {
                // 更新最后使用时间
                userData.lastUsed = Date.now();
                providerData[trackKey] = userData;
                localStorage.setItem('user_lyrics_providers', JSON.stringify(providerData));
                
                this.log(`🎯 找到用户指定供应商: ${userData.provider} for ${trackInfo.artist} - ${trackInfo.name}`);
                return userData.provider;
            }
            
            return null;
        } catch (error) {
            this.log(`❌ 获取用户指定供应商失败: ${error.message}`);
            return null;
        }
    };

    // =================
    // 自动应用用户设置
    // =================
    
    // 重写 overrideLyrics 方法，添加自动保存功能
    const originalOverrideLyrics = SpotifyLyricsPlayer.prototype.overrideLyrics;
    SpotifyLyricsPlayer.prototype.overrideLyrics = function(lyrics, lyricsType, source) {
        // 调用原始方法
        originalOverrideLyrics.call(this, lyrics, lyricsType, source);
        
        // 如果有当前歌曲信息，保存为用户自定义歌词
        if (this.currentTrack && source && source.source !== 'auto_applied') {
            this.saveUserCustomLyrics(this.currentTrack, lyrics, lyricsType, {
                ...source,
                appliedAt: Date.now(),
                appliedBy: 'manual_override'
            });
        }
    };

    // 自动应用用户自定义设置的主要方法
    SpotifyLyricsPlayer.prototype.autoApplyUserLyricsSettings = async function(trackInfo) {
        if (!trackInfo) {
            return false;
        }

        this.log(`🔍 检查用户自定义设置: ${trackInfo.artist} - ${trackInfo.name}`);

        // 1. 首先检查是否有用户自定义歌词
        const customLyrics = this.getUserCustomLyrics(trackInfo);
        if (customLyrics && customLyrics.lyrics && customLyrics.lyrics.length > 0) {
            this.log(`🎯 应用用户自定义歌词: ${trackInfo.artist} - ${trackInfo.name}`);
            
            // 应用自定义歌词
            this.overrideLyrics(
                customLyrics.lyrics, 
                customLyrics.lyricsType, 
                {
                    ...customLyrics.source,
                    source: 'auto_applied',
                    title: `${trackInfo.artist} - ${trackInfo.name} (用户自定义)`,
                    appliedAt: Date.now()
                }
            );
            
            this.showSuccessMessage(`✅ 已自动应用用户自定义歌词`);
            return true;
        }

        // 2. 检查是否有用户指定的歌词供应商
        const preferredProvider = this.getUserLyricsProvider(trackInfo);
        if (preferredProvider) {
            this.log(`🎯 使用用户指定供应商搜索: ${preferredProvider} for ${trackInfo.artist} - ${trackInfo.name}`);
            
            try {
                // 使用指定供应商搜索歌词
                const success = await this.loadLyricsFromSpecificProvider(trackInfo, preferredProvider);
                if (success) {
                    this.showSuccessMessage(`✅ 已使用指定供应商 ${preferredProvider} 加载歌词`);
                    return true;
                }
            } catch (error) {
                this.log(`❌ 使用指定供应商失败: ${error.message}`);
            }
        }

        return false;
    };

    // 从指定供应商加载歌词
    SpotifyLyricsPlayer.prototype.loadLyricsFromSpecificProvider = async function(trackInfo, provider) {
        try {
            const artist = encodeURIComponent(trackInfo.artist || '');
            const title = encodeURIComponent(trackInfo.name || '');
            
            // 使用后端API搜索指定供应商的歌词
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
            this.log(`❌ 从供应商 ${provider} 加载歌词失败: ${error.message}`);
            return false;
        }
    };

    // =================
    // 集成到现有的歌词加载流程
    // =================
    
    // 重写 loadLyrics 方法，添加自动应用用户设置
    const originalLoadLyrics = SpotifyLyricsPlayer.prototype.loadLyrics;
    SpotifyLyricsPlayer.prototype.loadLyrics = async function() {
        // 首先尝试自动应用用户设置
        if (this.currentTrack) {
            const userSettingsApplied = await this.autoApplyUserLyricsSettings(this.currentTrack);
            if (userSettingsApplied) {
                // 用户设置已应用，不需要继续默认的歌词加载流程
                return;
            }
        }
        
        // 如果没有用户设置，继续原始的歌词加载流程
        return originalLoadLyrics.call(this);
    };

    // =================
    // 用户界面增强
    // =================
    
    // 添加保存当前歌词为自定义的功能
    SpotifyLyricsPlayer.prototype.saveCurrentLyricsAsCustom = function() {
        if (!this.currentTrack) {
            this.showErrorMessage('没有当前播放的歌曲');
            return;
        }
        
        if (!this.lyrics || this.lyrics.length === 0) {
            this.showErrorMessage('没有可保存的歌词');
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
            this.showSuccessMessage('✅ 当前歌词已保存为自定义歌词');
        } else {
            this.showErrorMessage('保存失败，请稍后重试');
        }
    };

    // 清除特定歌曲的用户设置
    SpotifyLyricsPlayer.prototype.clearUserSettingsForTrack = function(trackInfo) {
        if (!trackInfo) {
            trackInfo = this.currentTrack;
        }
        
        if (!trackInfo) {
            this.showErrorMessage('没有指定的歌曲');
            return;
        }
        
        const trackKey = this.generateTrackKey(trackInfo);
        
        try {
            // 清除自定义歌词
            const customLyrics = JSON.parse(localStorage.getItem('user_custom_lyrics') || '{}');
            if (customLyrics[trackKey]) {
                delete customLyrics[trackKey];
                localStorage.setItem('user_custom_lyrics', JSON.stringify(customLyrics));
            }
            
            // 清除指定供应商
            const providers = JSON.parse(localStorage.getItem('user_lyrics_providers') || '{}');
            if (providers[trackKey]) {
                delete providers[trackKey];
                localStorage.setItem('user_lyrics_providers', JSON.stringify(providers));
            }
            
            this.showSuccessMessage('✅ 已清除该歌曲的用户设置');
            this.log(`🧹 已清除用户设置: ${trackInfo.artist} - ${trackInfo.name}`);
        } catch (error) {
            this.log(`❌ 清除用户设置失败: ${error.message}`);
            this.showErrorMessage('清除失败，请稍后重试');
        }
    };

    // =================
    // 扩展歌词搜索功能，添加保存供应商选择
    // =================
    
    // 重写 selectLyricsResult 方法，添加保存供应商选择
    const originalSelectLyricsResult = SpotifyLyricsPlayer.prototype.selectLyricsResult;
    SpotifyLyricsPlayer.prototype.selectLyricsResult = async function(result) {
        // 调用原始方法
        await originalSelectLyricsResult.call(this, result);
        
        // 如果有provider信息且当前有歌曲，保存供应商选择
        if (result.provider && this.currentTrack) {
            this.saveUserLyricsProvider(this.currentTrack, result.provider);
        }
    };

    // =================
    // 管理界面
    // =================
    
    // 显示用户自定义歌词管理界面
    SpotifyLyricsPlayer.prototype.showUserLyricsManager = function() {
        // 创建管理界面的模态框
        let modal = document.getElementById('user-lyrics-manager-modal');
        if (!modal) {
            modal = this.createUserLyricsManagerModal();
        }
        
        this.populateUserLyricsManagerContent();
        modal.style.display = 'flex';
    };

    // 创建用户歌词管理模态框
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
                    <h2>用户自定义歌词管理</h2>
                    <span class="close" id="close-user-lyrics-manager" style="
                        font-size: 28px;
                        font-weight: bold;
                        cursor: pointer;
                        color: var(--text-color, #ccc);
                    ">&times;</span>
                </div>
                <div id="user-lyrics-manager-content">
                    <!-- 内容将由 JS 填充 -->
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // 绑定关闭事件
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

    // 填充用户歌词管理内容
    SpotifyLyricsPlayer.prototype.populateUserLyricsManagerContent = function() {
        const content = document.getElementById('user-lyrics-manager-content');
        if (!content) return;
        
        try {
            const customLyrics = JSON.parse(localStorage.getItem('user_custom_lyrics') || '{}');
            const providers = JSON.parse(localStorage.getItem('user_lyrics_providers') || '{}');
            
            let html = '';
            
            // 自定义歌词部分
            html += '<h3 style="color: var(--accent-color, #1db954); margin-bottom: 15px;">🎵 自定义歌词</h3>';
            
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
                                            ${entry.lyricsType === 'synced' ? '同步歌词' : '普通歌词'} • 
                                            ${entry.lyrics.length} 行 • 
                                            最后使用: ${new Date(entry.lastUsed).toLocaleDateString()}
                                        </small>
                                    </div>
                                    <button onclick="window.player.deleteUserCustomLyrics('${entry.trackKey}')" style="
                                        background: #dc3545;
                                        color: white;
                                        border: none;
                                        padding: 8px 12px;
                                        border-radius: 4px;
                                        cursor: pointer;
                                    ">删除</button>
                                </div>
                            </div>
                        `;
                    });
            } else {
                html += '<p style="color: #888; text-align: center; padding: 20px;">暂无自定义歌词</p>';
            }
            
            // 指定供应商部分
            html += '<h3 style="color: var(--accent-color, #1db954); margin: 30px 0 15px 0;">🔒 指定供应商</h3>';
            
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
                                            供应商: ${this.escapeHtml(entry.provider)} • 
                                            最后使用: ${new Date(entry.lastUsed).toLocaleDateString()}
                                        </small>
                                    </div>
                                    <button onclick="window.player.deleteUserLyricsProvider('${entry.trackKey}')" style="
                                        background: #dc3545;
                                        color: white;
                                        border: none;
                                        padding: 8px 12px;
                                        border-radius: 4px;
                                        cursor: pointer;
                                    ">删除</button>
                                </div>
                            </div>
                        `;
                    });
            } else {
                html += '<p style="color: #888; text-align: center; padding: 20px;">暂无指定供应商</p>';
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
                        ">保存当前歌词</button>
                        <button onclick="window.player.clearUserSettingsForTrack()" style="
                            background: #ffc107;
                            color: #000;
                            border: none;
                            padding: 10px 15px;
                            border-radius: 6px;
                            cursor: pointer;
                        ">清除当前歌曲设置</button>
                        <button onclick="window.player.clearAllUserLyricsSettings()" style="
                            background: #dc3545;
                            color: white;
                            border: none;
                            padding: 10px 15px;
                            border-radius: 6px;
                            cursor: pointer;
                        ">清除所有设置</button>
                    </div>
                </div>
            `;
            
            content.innerHTML = html;
            
        } catch (error) {
            content.innerHTML = `<p style="color: #dc3545;">加载数据失败: ${error.message}</p>`;
        }
    };

    // 删除特定的用户自定义歌词
    SpotifyLyricsPlayer.prototype.deleteUserCustomLyrics = function(trackKey) {
        try {
            const customLyrics = JSON.parse(localStorage.getItem('user_custom_lyrics') || '{}');
            if (customLyrics[trackKey]) {
                delete customLyrics[trackKey];
                localStorage.setItem('user_custom_lyrics', JSON.stringify(customLyrics));
                this.populateUserLyricsManagerContent(); // 重新加载内容
                this.showSuccessMessage('✅ 自定义歌词已删除');
            }
        } catch (error) {
            this.showErrorMessage('删除失败: ' + error.message);
        }
    };

    // 删除特定的用户指定供应商
    SpotifyLyricsPlayer.prototype.deleteUserLyricsProvider = function(trackKey) {
        try {
            const providers = JSON.parse(localStorage.getItem('user_lyrics_providers') || '{}');
            if (providers[trackKey]) {
                delete providers[trackKey];
                localStorage.setItem('user_lyrics_providers', JSON.stringify(providers));
                this.populateUserLyricsManagerContent(); // 重新加载内容
                this.showSuccessMessage('✅ 指定供应商已删除');
            }
        } catch (error) {
            this.showErrorMessage('删除失败: ' + error.message);
        }
    };

    // 清除所有用户歌词设置
    SpotifyLyricsPlayer.prototype.clearAllUserLyricsSettings = function() {
        if (confirm('确定要清除所有用户自定义歌词和供应商设置吗？此操作不可恢复。')) {
            try {
                localStorage.removeItem('user_custom_lyrics');
                localStorage.removeItem('user_lyrics_providers');
                this.populateUserLyricsManagerContent(); // 重新加载内容
                this.showSuccessMessage('✅ 所有用户设置已清除');
                this.log('🧹 所有用户歌词设置已清除');
            } catch (error) {
                this.showErrorMessage('清除失败: ' + error.message);
            }
        }
    };

    // =================
    // 绑定事件
    // =================
    
    // 绑定用户歌词管理按钮事件
    document.getElementById('user-lyrics-manager-btn')?.addEventListener('click', () => {
        if (window.player) {
            window.player.showUserLyricsManager();
        }
    });

    console.log('✅ 用户自定义歌词管理系统已加载完成');
}