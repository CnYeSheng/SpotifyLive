// middleware/validator.js
// 輸入驗證中間件，防止無效數據和注入攻擊

const { ValidationError } = require('./errorHandler');

// 驗證會話 ID 格式
function validateSessionId(sessionId) {
    if (!sessionId || typeof sessionId !== 'string') {
        throw new ValidationError('Invalid session ID');
    }
    
    // 會話 ID 應該是字母數字組合，長度在 10-50 之間
    const sessionIdRegex = /^[a-zA-Z0-9]{10,50}$/;
    if (!sessionIdRegex.test(sessionId)) {
        throw new ValidationError('Session ID format is invalid');
    }
    
    return true;
}

// 驗證 Spotify Token
function validateToken(token) {
    if (!token || typeof token !== 'string') {
        throw new ValidationError('Invalid token');
    }
    
    // Token 應該是非空字符串
    if (token.trim().length < 10) {
        throw new ValidationError('Token is too short');
    }
    
    return true;
}

// 驗證播放控制參數
function validatePlaybackParams(params) {
    const errors = [];
    
    if (params.volume !== undefined) {
        const volume = parseInt(params.volume);
        if (isNaN(volume) || volume < 0 || volume > 100) {
            errors.push('Volume must be between 0 and 100');
        }
    }
    
    if (params.position_ms !== undefined) {
        const position = parseInt(params.position_ms);
        if (isNaN(position) || position < 0) {
            errors.push('Position must be a non-negative number');
        }
    }
    
    if (params.offset !== undefined) {
        const offset = parseInt(params.offset);
        if (isNaN(offset)) {
            errors.push('Offset must be a number');
        }
    }
    
    if (errors.length > 0) {
        throw new ValidationError(errors.join(', '));
    }
    
    return true;
}

// 驗證歌詞偏移量
function validateLyricsOffset(offset) {
    const offsetNum = parseInt(offset);
    if (isNaN(offsetNum) || offsetNum < -5000 || offsetNum > 5000) {
        throw new ValidationError('Lyrics offset must be between -5000 and 5000 ms');
    }
    return offsetNum;
}

// 驗證設備 ID
function validateDeviceId(deviceId) {
    if (!deviceId || typeof deviceId !== 'string') {
        throw new ValidationError('Device ID is required');
    }
    
    if (deviceId.length > 100) {
        throw new ValidationError('Device ID is too long');
    }
    
    return true;
}

// Express 中間件工廠函數
function createValidator(validatorFn, paramPath = 'body') {
    return (req, res, next) => {
        try {
            const data = req[paramPath];
            validatorFn(data);
            next();
        } catch (error) {
            next(error);
        }
    };
}

module.exports = {
    validateSessionId,
    validateToken,
    validatePlaybackParams,
    validateLyricsOffset,
    validateDeviceId,
    createValidator
};
