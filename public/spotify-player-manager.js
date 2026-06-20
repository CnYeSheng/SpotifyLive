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
        this.settingsVersion = 0;
        this.sseSource = null;
        this.sseReconnectTimer = null;
        
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

    connectSSE() {
        if (this.sseSource) {
            this.sseSource.close();
        }
        clearTimeout(this.sseReconnectTimer);

        try {
            this.sseSource = new EventSource(`${this.API_BASE}/events?sessionId=${this.sessionId || ''}`);
            
            this.sseSource.onmessage = (ev) => {
                try {
                    const data = JSON.parse(ev.data);
                    if (data.type === 'connected') {
                        this.settingsVersion = data.version || 0;
                        console.log(`📡 SSE connected, version: ${this.settingsVersion}`);
                    }
                    if (data.type === 'settings-changed') {
                        console.log(`📡 SSE: settings changed (v${data.version})`);
                        this.settingsVersion = data.version;
                        // Broadcast to other tabs/pages via BroadcastChannel
                        this.broadcast('settings-sync', { version: data.version });
                        this.onSettingsChanged && this.onSettingsChanged(data.version);
                    }
                    if (data.type === 'sync-event') {
                        const event = data.event;
                        if (event && event.senderSessionId !== this.sessionId) {
                            console.log(`📡 SSE: received sync event:`, event);
                            // Broadcast to other tabs/pages via BroadcastChannel
                            this.broadcast(event.type, event);
                            // Notify locally registered listener
                            this.onSyncEvent && this.onSyncEvent(event);
                        }
                    }
                } catch (e) {}
            };

            this.sseSource.onerror = () => {
                console.log('📡 SSE disconnected, reconnecting in 5s...');
                this.sseSource.close();
                this.sseReconnectTimer = setTimeout(() => this.connectSSE(), 5000);
            };
        } catch (e) {
            console.warn('⚠️ SSE not supported or failed:', e.message);
        }
    }

    disconnectSSE() {
        if (this.sseSource) {
            this.sseSource.close();
            this.sseSource = null;
        }
        clearTimeout(this.sseReconnectTimer);
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
                    const oldSessionId = this.sessionId;
                    this.sessionId = data.sessionId;
                    console.log('🔑 Retrieved session ID from server:', this.sessionId.substring(0, 8) + '...');
                    
                    // Broadcast session update to other tabs if it changed
                    if (oldSessionId !== this.sessionId) {
                        this.broadcastSession(this.sessionId);
                    }
                    
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
        // Store Spotify's raw timestamp for accurate cross-device projection
        if (data.timestamp && data.progress !== undefined) {
            this.spotifyProgress = data.progress;
            this.spotifyTimestamp = data.timestamp;
        }
    }

    getProjectedProgress() {
        if (!this.isPlaying) return this.lastProgress;
        // Use Spotify's absolute timestamp for accurate cross-device timing
        if (this.spotifyTimestamp > 0) {
            const drift = Date.now() - this.spotifyTimestamp;
            return Math.min(this.trackDuration, this.spotifyProgress + drift);
        }
        // Fallback to local estimation
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

    broadcastSession(sessionId) {
        if (this.authChannel) {
            this.authChannel.postMessage({ type: 'session-update', sessionId });
        }
    }
}

// Export for global use
window.spotifyManager = new SpotifyPlayerManager();
