// utils/sessionManager.js
// 統一的會話管理模組，解決記憶體洩漏和代碼重複問題

const storage = require('../api/storage-facade');

class SessionManager {
    constructor() {
        this.sessions = new Map();
        this.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
        this.cleanupInterval = null;
    }

    async init() {
        // 啟動定期清理，每 5 分鐘清理一次過期會話
        this.cleanupInterval = setInterval(() => {
            this.cleanupExpiredSessions();
        }, 5 * 60 * 1000);
        
        console.log('✅ SessionManager initialized with auto-cleanup');
    }

    async getSession(sessionId) {
        if (!sessionId) return null;

        // 優先檢查內存緩存
        if (this.sessions.has(sessionId)) {
            const session = this.sessions.get(sessionId);
            
            // 檢查是否過期
            if (session.expiresAt && session.expiresAt < Date.now()) {
                await this.deleteSession(sessionId);
                return null;
            }
            
            return session;
        }

        // 從 KV 存儲中恢復
        try {
            const session = await storage.getSession(sessionId);
            if (session) {
                // 檢查是否過期
                if (session.expiresAt && session.expiresAt < Date.now()) {
                    await this.deleteSession(sessionId);
                    return null;
                }
                
                this.sessions.set(sessionId, session);
                return session;
            }
        } catch (error) {
            console.error('[SessionManager] 從 KV 恢復 Session 失敗:', error.message);
        }

        return null;
    }

    async saveSession(sessionId, sessionData) {
        if (!sessionId || !sessionData) return false;

        // 清除缓存的轨道信息，强制下次请求获取最新状态
        if (sessionData.currentTrackCache) {
            delete sessionData.currentTrackCache;
        }

        // 設置過期時間（如果還沒有）
        if (!sessionData.expiresAt && sessionData.accessToken) {
            // 預設 1 小時過期
            sessionData.expiresAt = Date.now() + (60 * 60 * 1000);
        }

        // 保存到內存
        this.sessions.set(sessionId, sessionData);

        // 保存到 KV
        try {
            await storage.saveSession(sessionId, sessionData);
            return true;
        } catch (error) {
            console.error('[SessionManager] 保存 Session 到 KV 失敗:', error.message);
            return false;
        }
    }

    async deleteSession(sessionId) {
        if (!sessionId) return false;

        // 從內存中刪除
        this.sessions.delete(sessionId);

        // 從 KV 中刪除
        try {
            await storage.deleteSession(sessionId);
            return true;
        } catch (error) {
            console.error('[SessionManager] 刪除 Session 失敗:', error.message);
            return false;
        }
    }

    async cleanupExpiredSessions() {
        const now = Date.now();
        let cleaned = 0;

        for (const [sessionId, session] of this.sessions.entries()) {
            if (session.expiresAt && session.expiresAt < now) {
                await this.deleteSession(sessionId);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            console.log(`🧹 Cleaned up ${cleaned} expired session(s)`);
        }
    }

    async clearAll() {
        // 清空所有會話（用於維護或測試）
        const sessionIds = Array.from(this.sessions.keys());
        for (const sessionId of sessionIds) {
            await this.deleteSession(sessionId);
        }
        console.log(`🗑️ Cleared all ${sessionIds.length} sessions`);
    }

    destroy() {
        // 停止清理定時器
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }
}

// 創建單例實例
const sessionManager = new SessionManager();

module.exports = sessionManager;
