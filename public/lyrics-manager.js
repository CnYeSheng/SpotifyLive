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

    // 檢查是否為 SRT 格式
    SpotifyLyricsPlayer.prototype.isSrtFormat = function(content) {
        const srtPattern = /^\d+\s*\n\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/m;
        return srtPattern.test(content);
    };

    // 解析 SRT 歌詞
    SpotifyLyricsPlayer.prototype.parseSrtLyrics = function(content) {
        const lines = content.split(/\r?\n/);
        const lyrics = [];
        let currentEntry = null;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            if (!line) {
                if (currentEntry && currentEntry.startTime !== undefined && currentEntry.text) {
                    lyrics.push({
                        time: currentEntry.startTime,
                        text: currentEntry.text.trim()
                    });
                }
                currentEntry = null;
                continue;
            }
            
            // 檢查序號行
            if (/^\d+$/.test(line)) {
                if (currentEntry && currentEntry.startTime !== undefined && currentEntry.text) {
                    lyrics.push({
                        time: currentEntry.startTime,
                        text: currentEntry.text.trim()
                    });
                }
                currentEntry = { index: parseInt(line) };
                continue;
            }
            
            // 檢查時間軸行
            const timeMatch = line.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
            if (timeMatch && currentEntry) {
                const startHours = parseInt(timeMatch[1]);
                const startMinutes = parseInt(timeMatch[2]);
                const startSeconds = parseInt(timeMatch[3]);
                const startMs = parseInt(timeMatch[4]);
                
                currentEntry.startTime = (startHours * 3600 + startMinutes * 60 + startSeconds) * 1000 + startMs;
                continue;
            }
            
            // 歌詞內容
            if (currentEntry && currentEntry.startTime !== undefined) {
                if (!currentEntry.text) {
                    currentEntry.text = line;
                } else {
                    currentEntry.text += '\n' + line;
                }
            }
        }
        
        // 處理最後一筆
        if (currentEntry && currentEntry.startTime !== undefined && currentEntry.text) {
            lyrics.push({
                time: currentEntry.startTime,
                text: currentEntry.text.trim()
            });
        }
        
        return {
            type: lyrics.length > 0 ? 'synced' : 'plain',
            lyrics: lyrics
        };
    };

    // 解析歌詞內容（LRC、ASS 等格式）
    SpotifyLyricsPlayer.prototype.parseLyricsContent = function(content) {
        // 先檢查是否為 SRT 格式
        if (this.isSrtFormat(content)) {
            return this.parseSrtLyrics(content);
        }
        
        const lines = content.split('\n');
        const lyrics = [];
        let isSynced = false;
        
        for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;
            
            // 1. 檢查 ASS/SSA 格式
            if (trimmedLine.startsWith('Dialogue:')) {
                const assParsed = this.parseAssLine(trimmedLine);
                if (assParsed) {
                    lyrics.push(assParsed);
                    isSynced = true;
                }
                continue;
            }

            // 2. 檢查 LRC 格式 (包含標準、[] 增強版、<> 增強版)
            // 允許時間戳周圍有空格，允許 . 或 : 作為秒和毫秒的分隔符
            const timeMatch = trimmedLine.match(/^\[\s*(\d{1,2})\s*:\s*(\d{2})\s*(?:[\.:\]\s*(\d{1,3}))?\s*\]/);
            
            if (timeMatch) {
                const minutes = parseInt(timeMatch[1]);
                const seconds = parseInt(timeMatch[2]);
                const milliseconds = timeMatch[3] ? parseInt(timeMatch[3].padEnd(3, '0')) : 0;
                const timeMs = minutes * 60000 + seconds * 1000 + milliseconds;
                
                // 移除行首時間戳，獲取剩餘內容
                const textContent = trimmedLine.replace(/^\[\s*\d{1,2}\s*:\s*\d{2}\s*(?:[\.:\]\s*\d{1,3})?\s*\]/, '').trim();
                
                let words = [];
                let hasInternalTimestamps = false;

                // 2a. 檢查 [] 增強版：[mm:ss.xx]Word
                const bracketMatches = Array.from(textContent.matchAll(/\[\s*(\d{1,2})\s*:\s*(\d{2})\s*(?:[\.:\]\s*(\d{1,3}))?\s*\]([^\[]*)/g));
                
                // 2b. 檢查 <> 增強版：<mm:ss.xx>Word
                const angleMatches = Array.from(textContent.matchAll(/<\s*(\d{1,2})\s*:\s*(\d{2})\s*(?:[\.:\]\s*(\d{1,3}))?\s*>([^<]*)/g));

                if (bracketMatches.length > 0) {
                    hasInternalTimestamps = true;
                    const firstMatchIndex = textContent.indexOf(bracketMatches[0][0]);
                    if (firstMatchIndex > 0) {
                         words.push({
                            time: timeMs,
                            text: textContent.substring(0, firstMatchIndex)
                         });
                    }
                    bracketMatches.forEach(match => {
                        words.push({
                            time: this.parseTimeParts(match[1], match[2], match[3]),
                            text: match[4]
                        });
                    });
                } else if (angleMatches.length > 0) {
                    hasInternalTimestamps = true;
                    const firstMatchIndex = textContent.indexOf(angleMatches[0][0]);
                    if (firstMatchIndex > 0) {
                         words.push({
                            time: timeMs,
                            text: textContent.substring(0, firstMatchIndex)
                         });
                    }
                    angleMatches.forEach(match => {
                        words.push({
                            time: this.parseTimeParts(match[1], match[2], match[3]),
                            text: match[4]
                        });
                    });
                }

                // 計算單詞持續時間 (Duration)
                if (hasInternalTimestamps && words.length > 0) {
                    for (let i = 0; i < words.length; i++) {
                        if (i < words.length - 1) {
                            words[i].duration = words[i+1].time - words[i].time;
                        } else {
                            // 最後一個字的持續時間
                            words[i].duration = 0; 
                        }
                    }
                }

                if (hasInternalTimestamps) {
                    isSynced = true;
                    lyrics.push({
                        time: timeMs,
                        text: words.map(w => w.text).join(''),
                        words: words
                    });
                } else if (textContent) {
                    isSynced = true;
                    lyrics.push({
                        time: timeMs,
                        text: textContent
                    });
                }
            } else if (!isSynced && trimmedLine) {
                // 純文本 (只有在確認不是同步歌詞時才當作純文本)
                lyrics.push({
                    text: trimmedLine
                });
            }
        }
        
        return {
            type: isSynced ? 'synced' : 'plain',
            lyrics: lyrics
        };
    };
        };
    };

    // 輔助函數：解析時間部分
    SpotifyLyricsPlayer.prototype.parseTimeParts = function(minStr, secStr, msStr) {
        const minutes = parseInt(minStr);
        const seconds = parseInt(secStr);
        const milliseconds = msStr ? parseInt(msStr.padEnd(3, '0')) : 0;
        return minutes * 60000 + seconds * 1000 + milliseconds;
    };

    // 輔助函數：解析 ASS/SSA 行
    SpotifyLyricsPlayer.prototype.parseAssLine = function(line) {
        // Dialogue: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
        const parts = line.split(',');
        if (parts.length < 10) return null;

        const startTimeStr = parts[1];
        const textPart = parts.slice(9).join(',');

        const timeParts = startTimeStr.match(/(\d+):(\d{2}):(\d{2})[\.:](\d{2})/);
        if (!timeParts) return null;

        const startH = parseInt(timeParts[1]);
        const startM = parseInt(timeParts[2]);
        const startS = parseInt(timeParts[3]);
        const startCs = parseInt(timeParts[4]);
        
        const startTimeMs = startH * 3600000 + startM * 60000 + startS * 1000 + startCs * 10;
        
        const words = [];
        let currentTime = startTimeMs;
        let cleanText = '';
        
        const tagRegex = /{\\k[fF]?(\d+)}([^{]*)/g;
        let match;
        let hasKaraoke = false;

        const firstTagIndex = textPart.indexOf('{');
        if (firstTagIndex > 0) {
            const preText = textPart.substring(0, firstTagIndex);
            words.push({
                time: currentTime,
                text: preText,
                duration: 0 // 行首無標籤文本，持續時間未知
            });
            cleanText += preText;
        }

        while ((match = tagRegex.exec(textPart)) !== null) {
            hasKaraoke = true;
            const durationCs = parseInt(match[1]);
            const durationMs = durationCs * 10;
            const wordText = match[2];
            
            if (wordText) {
                words.push({
                    time: currentTime,
                    text: wordText,
                    duration: durationMs
                });
                cleanText += wordText;
            } else {
                // 空文本標籤通常只佔用時間，或作為前一個字的延長? 
                // 在 ASS 中 {\k10} 表示接下來的時間流逝。如果沒有文字，通常不顯示。
            }
            
            currentTime += durationMs;
        }
        
        if (!hasKaraoke) {
            cleanText = textPart.replace(/{[^}]*}/g, '');
            return {
                time: startTimeMs,
                text: cleanText
            };
        }

        return {
            time: startTimeMs,
            text: cleanText,
            words: words
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

    // 批量調整歌詞時間
    SpotifyLyricsPlayer.prototype.shiftLyrics = function(offsetMs) {
        const toggle = document.getElementById('edit-mode-toggle');
        const currentMode = toggle.dataset.mode; // 'visual' or 'text'
        
        if (currentMode === 'visual') {
            // 視覺模式調整
            const lines = document.querySelectorAll('.lyric-line-editor');
            lines.forEach(line => {
                const timeInput = line.querySelector('.timestamp-input');
                if (timeInput && timeInput.value) {
                    let time = this.parseTimeString(timeInput.value);
                    if (time !== undefined) {
                        time = Math.max(0, time + offsetMs);
                        timeInput.value = this.formatTime(time);
                    }
                }
            });
        } else {
            // 文本模式調整
            const textEditor = document.getElementById('text-lyrics-editor');
            if (!textEditor) return;
            
            const content = textEditor.value;
            const lines = content.split('\n');
            const newLines = lines.map(line => {
                // 匹配 [mm:ss.xx] 格式
                return line.replace(/\[(\d{1,2}):(\d{2})(?:[\.:](\d{1,3}))?\]/g, (match, m, s, ms) => {
                    const minutes = parseInt(m);
                    const seconds = parseInt(s);
                    const milliseconds = ms ? parseInt(ms.padEnd(3, '0')) : 0;
                    let timeMs = minutes * 60000 + seconds * 1000 + milliseconds;
                    
                    timeMs = Math.max(0, timeMs + offsetMs);
                    
                    const newMin = Math.floor(timeMs / 60000);
                    const newSec = Math.floor((timeMs % 60000) / 1000);
                    const newMs = Math.floor((timeMs % 1000) / 10);
                    
                    return `[${newMin.toString().padStart(2, '0')}:${newSec.toString().padStart(2, '0')}.${newMs.toString().padStart(2, '0')}]`;
                });
            });
            
            textEditor.value = newLines.join('\n');
        }
        
        this.showSuccessMessage(`已將所有時間戳${offsetMs > 0 ? '延後' : '提前'} ${Math.abs(offsetMs/1000)}秒`);
    };

    // 事件綁定 (續)
    document.getElementById('shift-lyrics-back')?.addEventListener('click', () => {
        if (window.player) window.player.shiftLyrics(-500);
    });

    document.getElementById('shift-lyrics-forward')?.addEventListener('click', () => {
        if (window.player) window.player.shiftLyrics(500);
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
