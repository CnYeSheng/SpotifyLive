class SpotifyLyricsPlayer {
    constructor() {}

    parseLyricsContent(content) {
        const lines = content.split('\n');
        const lyrics = [];
        let isSynced = false;
        
        for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;
            
            console.log('Line start char code:', trimmedLine.charCodeAt(0));
            console.log('Line chars:', trimmedLine.split('').map(c => c.charCodeAt(0)).slice(0, 10));

            // 2. 檢查 LRC 格式 (包含標準、[] 增強版、<> 增強版)
            const timeMatch = trimmedLine.match(/^\<(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\>/);
            
            if (timeMatch) {
                const minutes = parseInt(timeMatch[1]);
                const seconds = parseInt(timeMatch[2]);
                const milliseconds = timeMatch[3] ? parseInt(timeMatch[3].padEnd(3, '0')) : 0;
                const timeMs = minutes * 60000 + seconds * 1000 + milliseconds;
                
                const textContent = trimmedLine.replace(/^\<\d{1,2}:\d{2}(?:\.\d{1,3})?\>/, '').trim();
                
                let words = [];
                let hasInternalTimestamps = false;

                const bracketMatches = Array.from(textContent.matchAll(/\<(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\>([^\<]*)/g));
                
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
                } 
                else {
                    const angleMatches = Array.from(textContent.matchAll(/\<(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\>([^\<]*)/g));
                    
                    if (angleMatches.length > 0) {
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
                lyrics.push({
                    text: trimmedLine
                });
            }
        }
        
        return {
            type: isSynced ? 'synced' : 'plain',
            lyrics: lyrics
        };
    }

    parseTimeParts(minStr, secStr, msStr) {
        const minutes = parseInt(minStr);
        const seconds = parseInt(secStr);
        const milliseconds = msStr ? parseInt(msStr.padEnd(3, '0')) : 0;
        return minutes * 60000 + seconds * 1000 + milliseconds;
    }
    
    parseAssLine(line) { return null; }
}

const player = new SpotifyLyricsPlayer();
const testLine = '[00:34.028]<00:34.028>大<00:34.413>展<00:34.801>鸿<00:35.132>图<00:35.661>大<00:35.849>师<00:36.007>亲<00:36.181>手<00:36.344>提<00:36.515>笔<00:36.690>字<00:37.053>';

console.log('Testing line:', testLine);
const result = player.parseLyricsContent(testLine);
console.log('Result:', JSON.stringify(result, null, 2));