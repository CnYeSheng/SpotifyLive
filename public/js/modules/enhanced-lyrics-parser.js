/**
 * Enhanced Lyrics Parser
 * Inspired by folia-major's lyrics parsing system
 * Supports: LRC, Enhanced LRC (word-level timing), SRT, ASS/SSA
 * Features: Interlude detection, render hints, grapheme timing
 */

class EnhancedLyricsParser {
    constructor() {
        // Regex patterns (from folia-major)
        this.LRC_LINE_TIME_REGEX = /^\[\s*(\d{1,2})\s*:\s*(\d{2})\s*(?:[\.:]\s*(\d{1,3}))?\s*\]/;
        this.GLOBAL_LRC_TIME_REGEX = /\[\s*(\d{1,2})\s*:\s*(\d{2})\s*(?:[\.:]\s*(\d{1,3}))?\s*\]/g;
        this.GLOBAL_ANGLE_TIME_REGEX = /<\s*(\d{1,2})\s*:\s*(\d{2})\s*(?:[\.:]\s*(\d{1,3}))?\s*>/g;
        this.LRC_METADATA_REGEX = /^\[(ti|ar|al|by|offset|re):([^\]]*)\]$/i;
        this.INTERLUDE_FULL_TEXT = '......';
        
        // Render hint thresholds (from folia-major)
        this.MICRO_LINE_DURATION_THRESHOLD = 0.10;  // seconds
        this.SHORT_LINE_DURATION_THRESHOLD = 0.18;  // seconds
        this.MICRO_LINE_RENDER_FLOOR = 0.067;       // seconds
    }

    /**
     * Parse any supported lyrics format
     * @param {string} content - Raw lyrics content
     * @returns {{ type: 'synced'|'plain', lyrics: Array, format: string }}
     */
    parse(content) {
        if (!content || !content.trim()) {
            return { type: 'plain', lyrics: [], format: 'empty' };
        }

        // Try SRT first
        if (this.isSrtFormat(content)) {
            return this.parseSrt(content);
        }

        // Try Enhanced LRC (word-level timing)
        const enhancedResult = this.parseEnhancedLrc(content);
        if (enhancedResult.lyrics.length > 0 && enhancedResult.hasWordTiming) {
            return enhancedResult;
        }

        // Try standard LRC
        const lrcResult = this.parseLrc(content);
        if (lrcResult.lyrics.length > 0) {
            // Add interlude detection
            lrcResult.lyrics = this.attachInterludes(lrcResult.lyrics);
            // Add render hints
            lrcResult.lyrics = this.annotateRenderHints(lrcResult.lyrics);
            return lrcResult;
        }

        // Fallback: plain text
        return {
            type: 'plain',
            lyrics: content.split('\n').filter(l => l.trim()).map(text => ({ text: text.trim() })),
            format: 'plain'
        };
    }

    /**
     * Parse standard LRC format
     */
    parseLrc(content) {
        const lyrics = [];
        const metadata = {};
        let isSorted = true;
        let lastStartTime = -Infinity;

        const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);

        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) continue;

            // Check for metadata
            const metaMatch = line.match(this.LRC_METADATA_REGEX);
            if (metaMatch) {
                const key = metaMatch[1].toLowerCase();
                const value = metaMatch[2].trim();
                if (key === 'ti') metadata.title = value;
                else if (key === 'ar') metadata.artist = value;
                else if (key === 'al') metadata.album = value;
                continue;
            }

            // Parse time tag
            const timeMatch = line.match(this.LRC_LINE_TIME_REGEX);
            if (!timeMatch) continue;

            const timeMs = this.parseTimeParts(timeMatch[1], timeMatch[2], timeMatch[3]);
            const text = line.replace(this.LRC_LINE_TIME_REGEX, '').trim();

            if (!text) continue;

            if (timeMs < lastStartTime) isSorted = false;
            lastStartTime = timeMs;

            lyrics.push({ time: timeMs, text });
        }

        // Sort if needed
        if (!isSorted) {
            lyrics.sort((a, b) => a.time - b.time);
        }

        return { type: 'synced', lyrics, format: 'lrc', metadata };
    }

    /**
     * Parse Enhanced LRC with word-level timing
     * Supports both <mm:ss.xx> and [mm:ss.xx] inline timestamps
     */
    parseEnhancedLrc(content) {
        const lyrics = [];
        let hasWordTiming = false;
        let lastStartTime = -Infinity;
        let isSorted = true;

        const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);

        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) continue;

            // Skip metadata
            if (this.LRC_METADATA_REGEX.test(line)) continue;

            // Get line start time
            const lineTimeMatch = line.match(this.LRC_LINE_TIME_REGEX);
            if (!lineTimeMatch) continue;

            const lineStartTime = this.parseTimeParts(lineTimeMatch[1], lineTimeMatch[2], lineTimeMatch[3]);
            const body = line.replace(this.LRC_LINE_TIME_REGEX, '');

            if (lineStartTime < lastStartTime) isSorted = false;
            lastStartTime = lineStartTime;

            // Try angle bracket word timing: <mm:ss.xx>word
            const angleMatches = Array.from(body.matchAll(this.GLOBAL_ANGLE_TIME_REGEX));
            
            // Try inline bracket word timing: [mm:ss.xx]word
            const bracketMatches = Array.from(body.matchAll(/\[\s*(\d{1,2})\s*:\s*(\d{2})\s*(?:[\.:]\s*(\d{1,3}))?\s*\]([^\[]*)/g));

            if (angleMatches.length >= 2) {
                // Enhanced LRC with angle brackets
                hasWordTiming = true;
                const words = this.buildWordsFromAngleBrackets(body, angleMatches);
                const fullText = words.map(w => w.text).join('');
                
                if (fullText.trim()) {
                    lyrics.push({
                        time: lineStartTime,
                        text: fullText,
                        words,
                        endTime: words.length > 0 ? words[words.length - 1].time + (words[words.length - 1].duration || 0) : lineStartTime + 5000
                    });
                }
            } else if (bracketMatches.length >= 2) {
                // Enhanced LRC with inline brackets
                hasWordTiming = true;
                const words = this.buildWordsFromBracketTimestamps(body, bracketMatches);
                const fullText = words.map(w => w.text).join('');
                
                if (fullText.trim()) {
                    lyrics.push({
                        time: lineStartTime,
                        text: fullText,
                        words,
                        endTime: words.length > 0 ? words[words.length - 1].time + (words[words.length - 1].duration || 0) : lineStartTime + 5000
                    });
                }
            } else {
                // Standard LRC line (no word timing)
                const text = body.trim();
                if (text) {
                    lyrics.push({ time: lineStartTime, text });
                }
            }
        }

        if (!isSorted) {
            lyrics.sort((a, b) => a.time - b.time);
        }

        return {
            type: lyrics.length > 0 ? 'synced' : 'plain',
            lyrics,
            format: hasWordTiming ? 'enhanced-lrc' : 'lrc',
            hasWordTiming
        };
    }

    /**
     * Build word timings from angle bracket timestamps
     * Format: <mm:ss.xx>word<mm:ss.xx>word
     */
    buildWordsFromAngleBrackets(body, matches) {
        const words = [];
        let cursor = 0;

        for (let i = 0; i < matches.length; i++) {
            const match = matches[i];
            const wordTime = this.parseTimeParts(match[1], match[2], match[3]);
            const endIndex = match.index + match[0].length;
            
            // Text before this timestamp (if any, between previous word and this one)
            const prevEnd = i > 0 ? matches[i - 1].index + matches[i - 1][0].length : 0;
            const gapText = body.slice(prevEnd, match.index).trim();
            
            // Calculate duration
            let duration = 0;
            if (i < matches.length - 1) {
                const nextTime = this.parseTimeParts(matches[i + 1][1], matches[i + 1][2], matches[i + 1][3]);
                duration = nextTime - wordTime;
            }

            // Get the word text (between this timestamp and the next)
            let wordText = '';
            if (i < matches.length - 1) {
                const nextStart = matches[i + 1].index;
                wordText = body.slice(endIndex, nextStart).trim();
            } else {
                wordText = body.slice(endIndex).trim();
            }

            if (wordText) {
                words.push({
                    time: wordTime,
                    text: wordText,
                    duration: Math.max(duration, 0)
                });
            }
        }

        return words;
    }

    /**
     * Build word timings from inline bracket timestamps
     * Format: [mm:ss.xx]word[mm:ss.xx]word
     */
    buildWordsFromBracketTimestamps(body, matches) {
        const words = [];

        for (let i = 0; i < matches.length; i++) {
            const match = matches[i];
            const wordTime = this.parseTimeParts(match[1], match[2], match[3]);
            const wordText = (match[4] || '').trim();
            
            // Calculate duration
            let duration = 0;
            if (i < matches.length - 1) {
                const nextTime = this.parseTimeParts(matches[i + 1][1], matches[i + 1][2], matches[i + 1][3]);
                duration = nextTime - wordTime;
            }

            if (wordText) {
                words.push({
                    time: wordTime,
                    text: wordText,
                    duration: Math.max(duration, 0)
                });
            }
        }

        return words;
    }

    /**
     * Parse SRT format
     */
    parseSrt(content) {
        const lyrics = [];
        const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);
        let currentEntry = null;

        const pushEntry = () => {
            if (currentEntry && currentEntry.startTime !== undefined && currentEntry.text) {
                lyrics.push({
                    time: currentEntry.startTime,
                    text: currentEntry.text.trim()
                });
            }
            currentEntry = null;
        };

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
                pushEntry();
                continue;
            }

            // Sequence number
            if (/^\d+$/.test(trimmed)) {
                if (currentEntry?.startTime !== undefined) pushEntry();
                currentEntry = { index: parseInt(trimmed) };
                continue;
            }

            // Time line
            const timeMatch = trimmed.match(/(\d{1,2}):(\d{2}):(\d{2})[,\.](\d{3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,\.](\d{3})/);
            if (timeMatch) {
                if (!currentEntry) currentEntry = {};
                currentEntry.startTime = this.parseSrtTime(timeMatch[1], timeMatch[2], timeMatch[3], timeMatch[4]);
                continue;
            }

            // Text line
            if (currentEntry) {
                if (!currentEntry.text) currentEntry.text = trimmed;
                else currentEntry.text += ' ' + trimmed;
            }
        }
        pushEntry();

        if (lyrics.length > 0) {
            lyrics.sort((a, b) => a.time - b.time);
            return { type: 'synced', lyrics, format: 'srt' };
        }

        return { type: 'plain', lyrics: [], format: 'srt' };
    }

    isSrtFormat(content) {
        return /^\d+\s*\n\d{1,2}:\d{2}:\d{2}[,\.]\d{3}\s*-->/m.test(content.trim());
    }

    /**
     * Attach interlude markers in gaps between lines (from folia-major)
     */
    attachInterludes(lyrics) {
        if (lyrics.length === 0) return lyrics;

        const result = [];
        const INTERLUDE_THRESHOLD = 5000; // 5 seconds

        // Check if first line starts late
        if (lyrics[0].time > INTERLUDE_THRESHOLD) {
            result.push({
                time: 500,
                text: this.INTERLUDE_FULL_TEXT,
                isInterlude: true,
                endTime: lyrics[0].time - 500
            });
        }

        for (let i = 0; i < lyrics.length; i++) {
            result.push(lyrics[i]);

            const current = lyrics[i];
            const next = lyrics[i + 1];

            if (next) {
                const gap = next.time - (current.endTime || current.time + 3000);
                if (gap > INTERLUDE_THRESHOLD) {
                    result.push({
                        time: (current.endTime || current.time + 3000) + 50,
                        text: this.INTERLUDE_FULL_TEXT,
                        isInterlude: true,
                        endTime: next.time - 50
                    });
                }
            }
        }

        return result;
    }

    /**
     * Annotate lines with render hints (from folia-major)
     * Determines transition mode based on line duration
     */
    annotateRenderHints(lyrics) {
        return lyrics.map(line => {
            if (line.isInterlude) {
                return { ...line, renderHints: { timingClass: 'normal', transitionMode: 'normal' } };
            }

            const duration = (line.endTime || line.time + 3000) - line.time;
            const durationSec = duration / 1000;

            let timingClass, transitionMode, wordRevealMode;

            if (durationSec < this.MICRO_LINE_DURATION_THRESHOLD) {
                timingClass = 'micro';
                transitionMode = 'none';
                wordRevealMode = 'instant';
            } else if (durationSec < this.SHORT_LINE_DURATION_THRESHOLD) {
                timingClass = 'short';
                transitionMode = 'fast';
                wordRevealMode = 'fast';
            } else {
                timingClass = 'normal';
                transitionMode = 'normal';
                wordRevealMode = 'normal';
            }

            return {
                ...line,
                renderHints: { timingClass, transitionMode, wordRevealMode, duration: durationSec }
            };
        });
    }

    /**
     * Parse time parts to milliseconds
     */
    parseTimeParts(minutes, seconds, fraction) {
        const min = parseInt(minutes, 10) || 0;
        const sec = parseInt(seconds, 10) || 0;
        let ms = 0;
        if (fraction) {
            const fracStr = fraction.padEnd(3, '0').slice(0, 3);
            ms = parseInt(fracStr, 10);
        }
        return min * 60000 + sec * 1000 + ms;
    }

    parseSrtTime(hours, minutes, seconds, ms) {
        return (parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds)) * 1000 + parseInt(ms);
    }

    /**
     * Build word-level timing for lines without explicit word timing
     * Distributes time proportionally across characters (from folia-major)
     */
    buildTimedWords(text, startTime, endTime) {
        if (!text || !text.trim()) return [];

        const duration = Math.max(endTime - startTime, 100);
        const chars = Array.from(text);
        const words = [];
        
        // CJK detection
        const cjkRegex = /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/;
        const punctuationRegex = /[，。！？、：；"'）]/;
        
        // Calculate weights
        let totalWeight = 0;
        const tokens = chars.map(char => {
            let weight = 1;
            if (punctuationRegex.test(char)) {
                weight = 0;
            } else if (cjkRegex.test(char)) {
                weight = 1;
            } else {
                weight = 1.15; // Latin chars slightly longer
            }
            totalWeight += weight;
            return { text: char, weight };
        });

        if (totalWeight === 0) totalWeight = 1;

        // Distribute time
        const activeDuration = duration * 0.9; // 90% for active reveal
        const timePerWeight = activeDuration / totalWeight;
        let currentTime = startTime;

        for (const token of tokens) {
            const wordDuration = token.weight * timePerWeight;
            words.push({
                time: currentTime,
                text: token.text,
                duration: Math.max(wordDuration, 30) // minimum 30ms
            });
            if (token.weight > 0) {
                currentTime += wordDuration;
            } else {
                currentTime += 30;
            }
        }

        return words;
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EnhancedLyricsParser;
} else {
    window.EnhancedLyricsParser = EnhancedLyricsParser;
}
