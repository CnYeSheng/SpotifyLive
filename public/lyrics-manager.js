// 歌詞管理功能 - 下載、上傳、編輯
// Lyrics Manager - Download, Upload, Edit functionality

// 等待主腳本載入完成
document.addEventListener('DOMContentLoaded', function() {
    if (typeof SpotifyLyricsPlayer !== 'undefined') {
        initLyricsManager();
    } else {
        setTimeout(() => {
            if (typeof SpotifyLyricsPlayer !== 'undefined') {
                initLyricsManager();
            }
        }, 1000);
    }
});

function initLyricsManager() {
    console.log('🎼 初始化歌詞管理功能');

    // =================
    // 歌詞下載功能
    // =================
    SpotifyLyricsPlayer.prototype.downloadLyrics = function() {
        if (!this.lyrics || this.lyrics.length === 0) {
            this.showErrorMessage('沒有可下載的歌詞');
            return;
        }

        const trackInfo = this.currentTrack;
        const filename = trackInfo ? `${trackInfo.artist} - ${trackInfo.name}.lrc` : 'lyrics.lrc';
        
        let lyricsContent = '';
        
        // 檢查是否有同步歌詞
        if (this.lyricsType === 'synced' && this.lyrics[0].time !== undefined) {
            // 生成 LRC 格式
            this.lyrics.forEach(line => {
                if (line.time !== undefined) {
                    const minutes = Math.floor(line.time / 60000);
                    const seconds = Math.floor((line.time % 60000) / 1000);
                    const centiseconds = Math.floor(((line.time % 1000) / 10));
                    const timeStr = `[${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}]`;
                    lyricsContent += `${timeStr}${line.text}\n`;
                } else {
                    lyricsContent += `${line.text}\n`;
                }
            });
        } else {
            // 普通文本格式
            this.lyrics.forEach(line => {
                lyricsContent += `${line.text || line}\n`;
            });
        }

        // 創建並觸發下載
        const blob = new Blob([lyricsContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        this.showSuccessMessage(`✅ 歌詞已下載: ${filename}`);
        this.log(`📥 歌詞下載完成: ${filename}`);
    };

    // =================
    // 歌詞上傳功能
    // =================
    SpotifyLyricsPlayer.prototype.showLyricsUploadModal = function() {
        const modal = document.getElementById('lyrics-upload-modal');
        const fileInput = document.getElementById('lyrics-file-input');
        const textInput = document.getElementById('lyrics-text-input');
        const preview = document.getElementById('upload-preview');
        
        // 重置輸入
        fileInput.value = '';
        textInput.value = '';
        preview.style.display = 'none';
        
        modal.style.display = 'flex';
        this.log('📤 顯示歌詞上傳模態框');
    };

    SpotifyLyricsPlayer.prototype.hideLyricsUploadModal = function() {
        const modal = document.getElementById('lyrics-upload-modal');
        modal.style.display = 'none';
        this.log('❌ 隱藏歌詞上傳模態框');
    };

    SpotifyLyricsPlayer.prototype.previewUploadedLyrics = function() {
        const fileInput = document.getElementById('lyrics-file-input');
        const textInput = document.getElementById('lyrics-text-input');
        const preview = document.getElementById('upload-preview');
        const previewContent = document.getElementById('upload-preview-content');
        
        let content = '';
        
        if (fileInput.files.length > 0) {
            const file = fileInput.files[0];
            const reader = new FileReader();
            reader.onload = (e) => {
                content = e.target.result;
                this.displayLyricsPreview(content, previewContent, preview);
            };
            reader.readAsText(file);
        } else if (textInput.value.trim()) {
            content = textInput.value.trim();
            this.displayLyricsPreview(content, previewContent, preview);
        } else {
            this.showErrorMessage('請選擇文件或輸入歌詞內容');
        }
    };

    SpotifyLyricsPlayer.prototype.displayLyricsPreview = function(content, previewElement, containerElement) {
        const parsed = this.parseLyricsContent(content);
        
        let previewHtml = '';
        if (parsed.type === 'synced') {
            previewHtml = '<div style="color: #1db954; font-weight: bold;">🎵 同步歌詞</div>';
            parsed.lyrics.forEach(line => {
                const timeStr = this.formatTime(line.time);
                previewHtml += `<div style="margin: 5px 0;"><span style="color: #666;">[${timeStr}]</span> ${this.escapeHtml(line.text)}</div>`;
            });
        } else {
            previewHtml = '<div style="color: #666; font-weight: bold;">📝 普通歌詞</div>';
            parsed.lyrics.forEach(line => {
                previewHtml += `<div style="margin: 5px 0;">${this.escapeHtml(line.text || line)}</div>`;
            });
        }
        
        previewElement.innerHTML = previewHtml;
        containerElement.style.display = 'block';
    };

    SpotifyLyricsPlayer.prototype.applyUploadedLyrics = function() {
        const fileInput = document.getElementById('lyrics-file-input');
        const textInput = document.getElementById('lyrics-text-input');
        
        let content = '';
        
        if (fileInput.files.length > 0) {
            const file = fileInput.files[0];
            const reader = new FileReader();
            reader.onload = (e) => {
                content = e.target.result;
                this.processUploadedLyrics(content);
            };
            reader.readAsText(file);
        } else if (textInput.value.trim()) {
            content = textInput.value.trim();
            this.processUploadedLyrics(content);
        } else {
            this.showErrorMessage('請選擇文件或輸入歌詞內容');
        }
    };

    SpotifyLyricsPlayer.prototype.processUploadedLyrics = function(content) {
        const parsed = this.parseLyricsContent(content);
        
        // 套用新歌詞
        this.overrideLyrics(parsed.lyrics, parsed.type, { 
            source: 'uploaded',
            title: '已上傳的歌詞',
            artist: '用戶上傳'
        });
        
        this.hideLyricsUploadModal();
        this.showSuccessMessage(`✅ 歌詞已套用 (${parsed.type === 'synced' ? '同步' : '普通'}歌詞)`);
        this.log(`📤 上傳歌詞已套用: ${parsed.lyrics.length} 行`);
    };

    // =================
    // 歌詞編輯功能
    // =================
    SpotifyLyricsPlayer.prototype.showLyricsEditModal = function() {
        if (!this.lyrics || this.lyrics.length === 0) {
            this.showErrorMessage('沒有可編輯的歌詞');
            return;
        }

        const modal = document.getElementById('lyrics-edit-modal');
        const visualEditor = document.getElementById('visual-lyrics-editor');
        const textEditor = document.getElementById('text-lyrics-editor');
        
        // 初始化編輯器內容
        this.initializeEditors();
        
        modal.style.display = 'flex';
        this.log('✏️ 顯示歌詞編輯模態框');
    };

    SpotifyLyricsPlayer.prototype.hideLyricsEditModal = function() {
        const modal = document.getElementById('lyrics-edit-modal');
        modal.style.display = 'none';
        this.log('❌ 隱藏歌詞編輯模態框');
    };

    SpotifyLyricsPlayer.prototype.initializeEditors = function() {
        const visualEditor = document.getElementById('visual-lyrics-editor');
        const textEditor = document.getElementById('text-lyrics-editor');
        
        // 初始化視覺編輯器
        this.populateVisualEditor(visualEditor);
        
        // 初始化文本編輯器
        this.populateTextEditor(textEditor);
    };

    SpotifyLyricsPlayer.prototype.populateVisualEditor = function(container) {
        container.innerHTML = '';
        
        this.lyrics.forEach((line, index) => {
            const lineDiv = document.createElement('div');
            lineDiv.className = 'lyric-line-editor';
            lineDiv.dataset.index = index;
            
            const timeInput = document.createElement('input');
            timeInput.type = 'text';
            timeInput.className = 'timestamp-input';
            timeInput.placeholder = '00:00.00';
            if (line.time !== undefined) {
                timeInput.value = this.formatTime(line.time);
            }
            
            const textInput = document.createElement('input');
            textInput.type = 'text';
            textInput.className = 'lyric-text-input';
            textInput.value = line.text || line;
            
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'line-actions';
            
            const addBtn = document.createElement('button');
            addBtn.className = 'line-action-btn';
            addBtn.innerHTML = '+';
            addBtn.title = '添加新行';
            addBtn.onclick = () => this.addLyricLine(index);
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'line-action-btn';
            deleteBtn.innerHTML = '×';
            deleteBtn.title = '刪除此行';
            deleteBtn.onclick = () => this.deleteLyricLine(index);
            
            actionsDiv.appendChild(addBtn);
            actionsDiv.appendChild(deleteBtn);
            
            lineDiv.appendChild(timeInput);
            lineDiv.appendChild(textInput);
            lineDiv.appendChild(actionsDiv);
            
            container.appendChild(lineDiv);
        });
    };

    SpotifyLyricsPlayer.prototype.populateTextEditor = function(textarea) {
        let content = '';
        
        this.lyrics.forEach(line => {
            if (line.time !== undefined) {
                const timeStr = this.formatTimeForLRC(line.time);
                content += `[${timeStr}]${line.text}\n`;
            } else {
                content += `${line.text || line}\n`;
            }
        });
        
        textarea.value = content;
    };

    SpotifyLyricsPlayer.prototype.toggleEditMode = function() {
        const toggle = document.getElementById('edit-mode-toggle');
        const visualContainer = document.getElementById('visual-edit-container');
        const textContainer = document.getElementById('text-edit-container');
        
        const currentMode = toggle.dataset.mode;
        
        if (currentMode === 'visual') {
            // 切換到文本模式
            visualContainer.style.display = 'none';
            textContainer.style.display = 'block';
            toggle.textContent = '文本編輯';
            toggle.dataset.mode = 'text';
            toggle.classList.add('active');
        } else {
            // 切換到視覺模式
            textContainer.style.display = 'none';
            visualContainer.style.display = 'block';
            toggle.textContent = '視覺編輯';
            toggle.dataset.mode = 'visual';
            toggle.classList.remove('active');
        }
    };

    SpotifyLyricsPlayer.prototype.saveEditedLyrics = function() {
        const toggle = document.getElementById('edit-mode-toggle');
        const currentMode = toggle.dataset.mode;
        
        let newLyrics = [];
        
        if (currentMode === 'visual') {
            // 從視覺編輯器收集數據
            const lines = document.querySelectorAll('.lyric-line-editor');
            lines.forEach(line => {
                const timeInput = line.querySelector('.timestamp-input');
                const textInput = line.querySelector('.lyric-text-input');
                
                const text = textInput.value.trim();
                if (text) {
                    const lineData = { text };
                    if (timeInput.value.trim()) {
                        lineData.time = this.parseTimeString(timeInput.value);
                    }
                    newLyrics.push(lineData);
                }
            });
        } else {
            // 從文本編輯器解析
            const textEditor = document.getElementById('text-lyrics-editor');
            const parsed = this.parseLyricsContent(textEditor.value);
            newLyrics = parsed.lyrics;
        }
        
        if (newLyrics.length === 0) {
            this.showErrorMessage('編輯後的歌詞不能為空');
            return;
        }
        
        // 套用編輯後的歌詞
        const type = newLyrics.some(line => line.time !== undefined) ? 'synced' : 'plain';
        this.overrideLyrics(newLyrics, type, {
            source: 'edited',
            title: '已編輯的歌詞',
            artist: '用戶編輯'
        });
        
        this.hideLyricsEditModal();
        this.showSuccessMessage(`✅ 歌詞編輯已保存 (${newLyrics.length} 行)`);
        this.log(`✏️ 歌詞編輯完成: ${newLyrics.length} 行`);
    };

    SpotifyLyricsPlayer.prototype.exportEditedLyrics = function() {
        const toggle = document.getElementById('edit-mode-toggle');
        const currentMode = toggle.dataset.mode;
        
        let content = '';
        
        if (currentMode === 'text') {
            const textEditor = document.getElementById('text-lyrics-editor');
            content = textEditor.value;
        } else {
            // 從視覺編輯器生成內容
            const lines = document.querySelectorAll('.lyric-line-editor');
            lines.forEach(line => {
                const timeInput = line.querySelector('.timestamp-input');
                const textInput = line.querySelector('.lyric-text-input');
                
                const text = textInput.value.trim();
                if (text) {
                    if (timeInput.value.trim()) {
                        content += `[${timeInput.value}]${text}\n`;
                    } else {
                        content += `${text}\n`;
                    }
                }
            });
        }
        
        // 下載編輯後的歌詞
        const trackInfo = this.currentTrack;
        const filename = trackInfo ? `${trackInfo.artist} - ${trackInfo.name} (edited).lrc` : 'edited_lyrics.lrc';
        
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        this.showSuccessMessage(`✅ 編輯後的歌詞已導出: ${filename}`);
    };

    // =================
    // 工具函數
    // =================
    SpotifyLyricsPlayer.prototype.parseLyricsContent = function(content) {
        const lines = content.split('\n');
        const lyrics = [];
        let isLrc = false;
        
        for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;
            
            // 檢查 LRC 時間戳格式 [mm:ss.xx]
            const timeMatch = trimmedLine.match(/^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/);
            if (timeMatch) {
                isLrc = true;
                const minutes = parseInt(timeMatch[1]);
                const seconds = parseInt(timeMatch[2]);
                const milliseconds = timeMatch[3] ? parseInt(timeMatch[3].padEnd(3, '0')) : 0;
                
                const timeMs = minutes * 60000 + seconds * 1000 + milliseconds;
                const textContent = trimmedLine.replace(/^\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/, '').trim();
                
                // 檢查是否包含逐字歌詞時間戳
                const wordMatches = Array.from(textContent.matchAll(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]([^\[]*)/g));
                
                if (wordMatches.length > 0) {
                    // 處理逐字歌詞
                    const words = [];
                    // 處理行首文字 (如果有，且在第一個內部時間戳之前)
                    const firstMatchIndex = textContent.indexOf(wordMatches[0][0]);
                    if (firstMatchIndex > 0) {
                         words.push({
                            time: timeMs,
                            text: textContent.substring(0, firstMatchIndex)
                         });
                    }

                    wordMatches.forEach(match => {
                        const wMin = parseInt(match[1]);
                        const wSec = parseInt(match[2]);
                        const wMs = match[3] ? parseInt(match[3].padEnd(3, '0')) : 0;
                        const wTime = wMin * 60000 + wSec * 1000 + wMs;
                        const wText = match[4]; // 時間戳後的文字
                        
                        if (wText) { // 即使是空字串也可能代表一個時間點(例如結尾)，但通常我們只需要顯示有文字的部分，或者處理空文字作為結束標記
                            words.push({
                                time: wTime,
                                text: wText
                            });
                        }
                    });
                    
                    // 組合純文本用於顯示（移除所有標籤）
                    const cleanText = words.map(w => w.text).join('');
                    
                    lyrics.push({
                        time: timeMs,
                        text: cleanText,
                        words: words
                    });
                } else if (textContent) {
                    // 普通同步歌詞
                    lyrics.push({
                        time: timeMs,
                        text: textContent
                    });
                }
            } else if (!isLrc && trimmedLine) {
                lyrics.push({
                    text: trimmedLine
                });
            }
        }
        
        return {
            type: isLrc ? 'synced' : 'plain',
            lyrics: lyrics
        };
    };

    SpotifyLyricsPlayer.prototype.formatTime = function(timeMs) {
        const minutes = Math.floor(timeMs / 60000);
        const seconds = Math.floor((timeMs % 60000) / 1000);
        const centiseconds = Math.floor(((timeMs % 1000) / 10));
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
    };

    SpotifyLyricsPlayer.prototype.formatTimeForLRC = function(timeMs) {
        const minutes = Math.floor(timeMs / 60000);
        const seconds = Math.floor((timeMs % 60000) / 1000);
        const centiseconds = Math.floor(((timeMs % 1000) / 10));
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
    };

    SpotifyLyricsPlayer.prototype.parseTimeString = function(timeStr) {
        const match = timeStr.match(/(\d{1,2}):(\d{2})(?:\.(\d{1,2}))?/);
        if (!match) return undefined;
        
        const minutes = parseInt(match[1]);
        const seconds = parseInt(match[2]);
        const centiseconds = match[3] ? parseInt(match[3]) : 0;
        
        return minutes * 60000 + seconds * 1000 + centiseconds * 10;
    };

    // =================
    // 事件綁定
    // =================
    
    // 下載按鈕
    document.getElementById('download-lyrics-btn')?.addEventListener('click', () => {
        if (window.player) {
            window.player.downloadLyrics();
        }
    });

    // 上傳按鈕
    document.getElementById('upload-lyrics-btn')?.addEventListener('click', () => {
        if (window.player) {
            window.player.showLyricsUploadModal();
        }
    });

    // 編輯按鈕
    document.getElementById('edit-lyrics-btn')?.addEventListener('click', () => {
        if (window.player) {
            window.player.showLyricsEditModal();
        }
    });

    // 上傳模態框事件
    document.getElementById('close-lyrics-upload-modal')?.addEventListener('click', () => {
        if (window.player) {
            window.player.hideLyricsUploadModal();
        }
    });

    document.getElementById('preview-uploaded-lyrics')?.addEventListener('click', () => {
        if (window.player) {
            window.player.previewUploadedLyrics();
        }
    });

    document.getElementById('apply-uploaded-lyrics')?.addEventListener('click', () => {
        if (window.player) {
            window.player.applyUploadedLyrics();
        }
    });

    // 編輯模態框事件
    document.getElementById('close-lyrics-edit-modal')?.addEventListener('click', () => {
        if (window.player) {
            window.player.hideLyricsEditModal();
        }
    });

    document.getElementById('edit-mode-toggle')?.addEventListener('click', () => {
        if (window.player) {
            window.player.toggleEditMode();
        }
    });

    document.getElementById('save-edited-lyrics')?.addEventListener('click', () => {
        if (window.player) {
            window.player.saveEditedLyrics();
        }
    });

    document.getElementById('export-edited-lyrics')?.addEventListener('click', () => {
        if (window.player) {
            window.player.exportEditedLyrics();
        }
    });

    document.getElementById('reset-lyrics-edit')?.addEventListener('click', () => {
        if (window.player) {
            window.player.initializeEditors();
            window.player.showSuccessMessage('✅ 編輯器已重置');
        }
    });

    // 模態框背景點擊關閉
    document.getElementById('lyrics-upload-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'lyrics-upload-modal' && window.player) {
            window.player.hideLyricsUploadModal();
        }
    });

    document.getElementById('lyrics-edit-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'lyrics-edit-modal' && window.player) {
            window.player.hideLyricsEditModal();
        }
    });

    console.log('✅ 歌詞管理功能已加載完成');
}