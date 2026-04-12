/**
 * 日誌聚合和分析模塊
 * 提供結構化日誌記錄、聚合和簡單分析功能
 */

const fs = require('fs');
const path = require('path');

// 日誌級別
const LogLevel = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  CRITICAL: 'CRITICAL'
};

// 日誌存儲目錄
const LOG_DIR = path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');
const ANALYSIS_FILE = path.join(LOG_DIR, 'analysis.json');

// 確保日誌目錄存在
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// 日誌緩存（用於聚合）
let logCache = [];
const MAX_CACHE_SIZE = 100;

/**
 * 格式化日誌條目
 */
function formatLogEntry(level, message, context = {}) {
  return {
    timestamp: new Date().toISOString(),
    level,
    message,
    context: {
      ...context,
      pid: process.pid,
      hostname: require('os').hostname()
    }
  };
}

/**
 * 寫入日誌到文件
 */
function writeLog(entry) {
  const logLine = JSON.stringify(entry) + '\n';
  
  // 異步寫入，不阻塞主流程
  fs.appendFile(LOG_FILE, logLine, (err) => {
    if (err) {
      console.error('Failed to write log:', err);
    }
  });
}

/**
 * 記錄日誌
 */
function log(level, message, context = {}) {
  const entry = formatLogEntry(level, message, context);
  
  // 添加到緩存
  logCache.push(entry);
  if (logCache.length > MAX_CACHE_SIZE) {
    logCache.shift();
  }
  
  // 寫入文件
  writeLog(entry);
  
  // 控制台輸出（開發環境）
  if (process.env.NODE_ENV !== 'production') {
    const color = getColorForLevel(level);
    console.log(`${color}[${level}]${'\x1b[0m'} ${message}`, context);
  }
  
  // 錯誤和嚴重級別觸發警報
  if (level === LogLevel.ERROR || level === LogLevel.CRITICAL) {
    triggerAlert(entry);
  }
  
  return entry;
}

/**
 * 獲取日誌級別對應的控制台顏色
 */
function getColorForLevel(level) {
  const colors = {
    [LogLevel.DEBUG]: '\x1b[36m',    // 青色
    [LogLevel.INFO]: '\x1b[32m',     // 綠色
    [LogLevel.WARN]: '\x1b[33m',     // 黃色
    [LogLevel.ERROR]: '\x1b[31m',    // 紅色
    [LogLevel.CRITICAL]: '\x1b[35m'  // 紫色
  };
  return colors[level] || '\x1b[0m';
}

/**
 * 便捷方法
 */
const debug = (msg, ctx) => log(LogLevel.DEBUG, msg, ctx);
const info = (msg, ctx) => log(LogLevel.INFO, msg, ctx);
const warn = (msg, ctx) => log(LogLevel.WARN, msg, ctx);
const error = (msg, ctx) => log(LogLevel.ERROR, msg, ctx);
const critical = (msg, ctx) => log(LogLevel.CRITICAL, msg, ctx);

/**
 * 警報系統
 */
let alertHandlers = [];
let alertCount = 0;
let lastAlertTime = null;
const ALERT_COOLDOWN = 5 * 60 * 1000; // 5 分鐘冷卻時間

/**
 * 註冊警報處理器
 */
function registerAlertHandler(handler) {
  alertHandlers.push(handler);
}

/**
 * 觸發警報
 */
function triggerAlert(logEntry) {
  alertCount++;
  lastAlertTime = Date.now();
  
  const alertData = {
    count: alertCount,
    lastAlert: logEntry,
    timestamp: new Date().toISOString()
  };
  
  // 通知所有處理器
  alertHandlers.forEach(handler => {
    try {
      handler(alertData);
    } catch (e) {
      console.error('Alert handler error:', e);
    }
  });
  
  // 保存警報狀態
  saveAnalysis();
}

/**
 * 日誌分析功能
 */
function analyzeLogs(timeRange = '1h') {
  const now = Date.now();
  const timeRanges = {
    '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000
  };
  
  const rangeMs = timeRanges[timeRange] || timeRanges['1h'];
  const cutoff = now - rangeMs;
  
  const analysis = {
    generatedAt: new Date().toISOString(),
    timeRange,
    totalLogs: 0,
    byLevel: {},
    errorRate: 0,
    topMessages: [],
    alerts: {
      count: alertCount,
      lastAlertTime: lastAlertTime
    }
  };
  
  // 從緩存中分析
  const recentLogs = logCache.filter(log => 
    new Date(log.timestamp).getTime() > cutoff
  );
  
  analysis.totalLogs = recentLogs.length;
  
  // 按級別統計
  recentLogs.forEach(log => {
    analysis.byLevel[log.level] = (analysis.byLevel[log.level] || 0) + 1;
  });
  
  // 計算錯誤率
  const errorCount = (analysis.byLevel[LogLevel.ERROR] || 0) + 
                     (analysis.byLevel[LogLevel.CRITICAL] || 0);
  analysis.errorRate = analysis.totalLogs > 0 
    ? ((errorCount / analysis.totalLogs) * 100).toFixed(2) + '%'
    : '0%';
  
  // 找出最常見的錯誤消息
  const messageCounts = {};
  recentLogs
    .filter(log => log.level === LogLevel.ERROR || log.level === LogLevel.CRITICAL)
    .forEach(log => {
      messageCounts[log.message] = (messageCounts[log.message] || 0) + 1;
    });
  
  analysis.topMessages = Object.entries(messageCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([message, count]) => ({ message, count }));
  
  return analysis;
}

/**
 * 保存分析結果
 */
function saveAnalysis() {
  const analysis = {
    lastUpdated: new Date().toISOString(),
    alertCount,
    lastAlertTime,
    recentLogs: logCache.slice(-50) // 保留最近 50 條
  };
  
  fs.writeFile(ANALYSIS_FILE, JSON.stringify(analysis, null, 2), (err) => {
    if (err) {
      console.error('Failed to save analysis:', err);
    }
  });
}

/**
 * 獲取最近的日誌
 */
function getRecentLogs(count = 100) {
  return logCache.slice(-count);
}

/**
 * 清空日誌緩存
 */
function clearCache() {
  logCache = [];
}

/**
 * 導出日誌為 JSON
 */
function exportLogs(options = {}) {
  const { 
    level = null, 
    startTime = null, 
    endTime = null,
    limit = 1000 
  } = options;
  
  let logs = [...logCache];
  
  if (level) {
    logs = logs.filter(log => log.level === level);
  }
  
  if (startTime) {
    logs = logs.filter(log => new Date(log.timestamp) >= new Date(startTime));
  }
  
  if (endTime) {
    logs = logs.filter(log => new Date(log.timestamp) <= new Date(endTime));
  }
  
  return logs.slice(-limit);
}

module.exports = {
  LogLevel,
  log,
  debug,
  info,
  warn,
  error,
  critical,
  registerAlertHandler,
  analyzeLogs,
  getRecentLogs,
  exportLogs,
  clearCache,
  saveAnalysis
};
