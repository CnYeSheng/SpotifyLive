// middleware/errorHandler.js
// 統一的錯誤處理中間件，避免空 catch 塊和未處理的錯誤

class AppError extends Error {
    constructor(message, statusCode = 500, isOperational = true) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        this.status = statusCode;
        
        Error.captureStackTrace(this, this.constructor);
    }
}

class ValidationError extends AppError {
    constructor(message) {
        super(message, 400);
    }
}

class UnauthorizedError extends AppError {
    constructor(message = 'Unauthorized') {
        super(message, 401);
    }
}

class NotFoundError extends AppError {
    constructor(message = 'Resource not found') {
        super(message, 404);
    }
}

class RateLimitError extends AppError {
    constructor(message = 'Too many requests', retryAfter = 5000) {
        super(message, 429);
        this.retryAfter = retryAfter;
    }
}

// 錯誤日誌記錄器
function logError(error, context = {}) {
    const errorInfo = {
        timestamp: new Date().toISOString(),
        name: error.name,
        message: error.message,
        statusCode: error.statusCode || 500,
        stack: error.stack,
        ...context
    };

    // 生產環境不記錄堆棧追蹤到控制台（避免洩露敏感信息）
    if (process.env.NODE_ENV === 'production') {
        console.error(JSON.stringify({
            timestamp: errorInfo.timestamp,
            name: errorInfo.name,
            message: errorInfo.message,
            statusCode: errorInfo.statusCode
        }));
    } else {
        console.error('❌ Error:', errorInfo);
    }

    return errorInfo;
}

// Express 錯誤處理中間件
function errorHandler(err, req, res, next) {
    let statusCode = err.statusCode || 500;
    let message = err.message || 'Internal Server Error';

    // 生產環境隱藏詳細錯誤信息
    if (process.env.NODE_ENV === 'production' && !err.isOperational) {
        message = 'Something went wrong';
    }

    // 記錄錯誤
    logError(err, {
        path: req.path,
        method: req.method,
        userAgent: req.get('User-Agent')
    });

    // Mongoose 驗證錯誤
    if (err.name === 'ValidationError') {
        statusCode = 400;
        const messages = Object.values(err.errors).map(val => val.message);
        message = messages.join(', ');
    }

    // Mongoose 鑄造錯誤
    if (err.name === 'CastError') {
        statusCode = 400;
        message = 'Invalid ID format';
    }

    // JSON 解析錯誤
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        statusCode = 400;
        message = 'Invalid JSON';
    }

    res.status(statusCode).json({
        success: false,
        error: {
            message,
            code: err.code || 'INTERNAL_ERROR',
            ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
        }
    });
}

// 非同步錯誤處理器
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

// 安全地執行非同步操作（不會中斷主流程）
async function safeAsync(promise, defaultValue = null, onError = null) {
    try {
        return await promise;
    } catch (error) {
        if (onError) {
            onError(error);
        } else {
            console.warn('⚠️ Safe async operation failed:', error.message);
        }
        return defaultValue;
    }
}

module.exports = {
    AppError,
    ValidationError,
    UnauthorizedError,
    NotFoundError,
    RateLimitError,
    errorHandler,
    asyncHandler,
    safeAsync,
    logError
};
