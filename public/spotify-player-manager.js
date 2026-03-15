/**
 * Spotify Player Manager - Shared Interface
 * A unified manager for session, authentication, and track state
 * Used by /, /lyrics-text, /control, /pre, /next
 */

class SpotifyPlayerManager {
    constructor() {
        this.API_BASE = window.location.origin + '/api';
        this.sessionId = new URLSearchParams(window.location.search).get('sessionId');
        this.currentTrack = null;
        this.isPlaying = false;
        this.trackDuration = 0;
        this.lastProgress = 0;
        this.lastUpdate = Date.now();
        this.isRefreshing = false;
        
        // Broadcast Channels for cross-tab sync
        this.controlChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('spotify_control') : null;
        this.authChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('spotify_auth') : null;
        
        this.initChannels();
    }

    initChannels() {
        if (this.authChannel) {
            this.authChannel.onmessage = (ev) => {
                const d = ev.data || {};
                if (d.type === 'session-update' && d.sessionId) {
                    console.log('🔑 Received session ID from broadcast:', d.sessionId.substring(0, 8) + '...');
                    this.sessionId = d.sessionId;
                    this.onSessionUpdate && this.onSessionUpdate(d.sessionId);
                }
            };
        }

        if (this.controlChannel) {
            this.controlChannel.onmessage = (ev) => {
                const d = ev.data || {};
                if (d.type === 'playback-sync' && d.isPlaying !== undefined) {
                    this.isPlaying = d.isPlaying;
                    if (d.lastProgress !== undefined) this.lastProgress = d.lastProgress;
                    this.lastUpdate = d.timestamp || Date.now();
                }
                if (d.type === 'seek-sync' && d.position_ms !== undefined) {
                    this.lastProgress = d.position_ms;
                    this.lastUpdate = d.timestamp || Date.now();
                }
                // Custom listeners can be added via onControlMessage
                this.onControlMessage && this.onControlMessage(d);
            };
        }
    }

    async fetchSessionId(force = false) {
        if (this.sessionId && !force) return this.sessionId;
        try {
            const response = await fetch(`${this.API_BASE}/auth-status`, {
                credentials: 'include'
            });
            if (response.ok) {
                const data = await response.json();
                if (data.sessionId) {
                    this.sessionId = data.sessionId;
                    console.log('🔑 Retrieved session ID from server:', this.sessionId.substring(0, 8) + '...');
                    return this.sessionId;
                } else if (force) {
                    this.sessionId = null;
                }
            }
        } catch (e) {
            console.warn('⚠️ Could not fetch session ID from server:', e.message);
        }
        return this.sessionId;
    }

    async attemptTokenRefresh() {
        if (this.isRefreshing) return false;
        this.isRefreshing = true;
        try {
            console.log('🔄 Attempting token refresh...');
            const res = await fetch(`${this.API_BASE}/refresh-token`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'x-session-id': this.sessionId || ''
                }
            });
            const data = await res.json();
            this.isRefreshing = false;
            return !!data.success;
        } catch (e) {
            console.error('❌ Refresh failed', e);
        }
        this.isRefreshing = false;
        return false;
    }

    async fetchCurrentTrack() {
        if (!this.sessionId) {
            await this.fetchSessionId();
        }

        try {
            let url = `${this.API_BASE}/current-track`;
            const params = new URLSearchParams();
            if (this.sessionId) params.set('sessionId', this.sessionId);
            if (params.toString()) url += '?' + params.toString();

            const response = await fetch(url, {
                credentials: 'include',
                headers: {
                    'X-Session-Id': this.sessionId || ''
                }
            });
            
            if (response.status === 401) {
                const refreshed = await this.attemptTokenRefresh();
                if (refreshed) return this.fetchCurrentTrack(); // Retry
                return { error: 'unauthorized' };
            }
            
            if (!response.ok) return null;
            
            const data = await response.json();
            if (data && (data.isPlaying || data.name)) {
                this.updateLocalState(data);
            } else {
                this.isPlaying = false;
            }
            return data;
        } catch (e) {
            console.error('❌ fetchCurrentTrack error:', e);
            return null;
        }
    }

    updateLocalState(data) {
        this.currentTrack = data;
        this.isPlaying = data.isPlaying;
        this.trackDuration = data.duration;
        this.lastProgress = data.progress;
        this.lastUpdate = Date.now();
    }

    getProjectedProgress() {
        if (!this.isPlaying) return this.lastProgress;
        const now = Date.now();
        const dt = now - this.lastUpdate;
        return Math.min(this.trackDuration, this.lastProgress + dt);
    }

    // Helper for sending control commands
    async sendControl(endpoint, body = {}) {
        try {
            const res = await fetch(`${this.API_BASE}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...body, sessionId: this.sessionId })
            });
            return await res.json();
        } catch (e) {
            console.error(`❌ sendControl error (${endpoint}):`, e);
            return { success: false, error: e.message };
        }
    }

    broadcast(type, data) {
        if (this.controlChannel) {
            this.controlChannel.postMessage({ type, ...data });
        }
    }
}

// Export for global use
window.spotifyManager = new SpotifyPlayerManager();
