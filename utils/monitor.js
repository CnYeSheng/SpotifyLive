/**
 * 監控和警報模塊
 * 提供系統健康監控、性能指標收集和警報通知
 */

const logger = require('./logger');
const os = require('os');

// 監控指標存儲
let metrics = {
  startTime: Date.now(),
  requests: {
    total: 0,
    successful: 0,
    failed: 0,
    avgResponseTime: 0
  },
  memory: {
    heapUsed: 0,
    heapTotal: 0,
    external: 0,
    rss: 0
  },
  cpu: {
    usage: 0
  },
  errors: {
    total: 0,
    byType: {}
  },
  alerts: {
    triggered: 0,
    lastAlert: null
  }
};

// 警報閾值配置
const ALERT_THRESHOLDS = {
  memoryUsagePercent: 80, // 記憶體使用率超過 80%
  errorRatePercent: 5,    // 錯誤率超過 5%
  responseTimeMs: 1000,   // 平均響應時間超過 1000ms
  cpuUsagePercent: 80     // CPU 使用率超過 80%
};

// 警報處理器
let alertHandlers = [];

/**
 * 註冊警報處理器
 */
function registerAlertHandler(handler) {
  alertHandlers.push(handler);
  logger.info('Alert handler registered', { handler: handler.name });
}

/**
 * 觸發警報
 */
function triggerAlert(type, severity, data = {}) {
  const alert = {
    type,
    severity, // 'warning' | 'critical'
    message: getAlertMessage(type, data),
    timestamp: new Date().toISOString(),
    data
  };
  
  metrics.alerts.triggered++;
  metrics.alerts.lastAlert = alert;
  
  logger.warn(`ALERT [${severity.toUpperCase()}] ${alert.message}`, {
    type,
    ...data
  });
  
  // 通知所有處理器
  alertHandlers.forEach(handler => {
    try {
      handler(alert);
    } catch (e) {
      logger.error('Alert handler execution failed', { error: e.message });
    }
  });
  
  return alert;
}

/**
 * 獲取警報消息
 */
function getAlertMessage(type, data) {
  const messages = {
    HIGH_MEMORY: `記憶體使用率過高：${data.percent}%`,
    HIGH_CPU: `CPU 使用率過高：${data.percent}%`,
    HIGH_ERROR_RATE: `錯誤率過高：${data.rate}%`,
    SLOW_RESPONSE: `平均響應時間過長：${data.avgTime}ms`,
    PROCESS_RESTART: '進程重啟檢測',
    DISK_SPACE_LOW: `磁盤空間不足：${data.free}GB 可用`
  };
  return messages[type] || `未知警報：${type}`;
}

/**
 * 記錄請求指標
 */
function recordRequest(responseTime, success = true) {
  metrics.requests.total++;
  
  if (success) {
    metrics.requests.successful++;
  } else {
    metrics.requests.failed++;
  }
  
  // 計算移動平均響應時間
  const alpha = 0.1; // 平滑係數
  metrics.requests.avgResponseTime = 
    metrics.requests.avgResponseTime * (1 - alpha) + responseTime * alpha;
}

/**
 * 記錄錯誤
 */
function recordError(errorType, details = {}) {
  metrics.errors.total++;
  metrics.errors.byType[errorType] = (metrics.errors.byType[errorType] || 0) + 1;
  
  logger.error('Error recorded', {
    type: errorType,
    ...details
  });
  
  // 檢查錯誤率是否超過閾值
  checkErrorRate();
}

/**
 * 收集系統指標
 */
function collectSystemMetrics() {
  const memUsage = process.memoryUsage();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const memoryUsagePercent = ((totalMemory - freeMemory) / totalMemory) * 100;
  
  metrics.memory = {
    heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
    heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
    external: Math.round(memUsage.external / 1024 / 1024), // MB
    rss: Math.round(memUsage.rss / 1024 / 1024), // MB
    usagePercent: memoryUsagePercent.toFixed(2)
  };
  
  // CPU 使用率（簡化版本）
  const cpus = os.cpus();
  const totalIdle = cpus.reduce((acc, cpu) => acc + cpu.times.idle, 0);
  const total = cpus.reduce((acc, cpu) => 
    acc + Object.values(cpu.times).reduce((sum, time) => sum + time, 0), 0);
  
  const cpuUsage = 100 - (totalIdle / total) * 100;
  metrics.cpu.usage = cpuUsage.toFixed(2);
  
  // 檢查閾值
  checkThresholds();
  
  return metrics;
}

/**
 * 檢查系統閾值
 */
function checkThresholds() {
  // 記憶體檢查
  if (parseFloat(metrics.memory.usagePercent) > ALERT_THRESHOLDS.memoryUsagePercent) {
    triggerAlert('HIGH_MEMORY', 'warning', {
      percent: metrics.memory.usagePercent,
      threshold: ALERT_THRESHOLDS.memoryUsagePercent
    });
  }
  
  // CPU 檢查
  if (parseFloat(metrics.cpu.usage) > ALERT_THRESHOLDS.cpuUsagePercent) {
    triggerAlert('HIGH_CPU', 'warning', {
      percent: metrics.cpu.usage,
      threshold: ALERT_THRESHOLDS.cpuUsagePercent
    });
  }
  
  // 響應時間檢查
  if (metrics.requests.avgResponseTime > ALERT_THRESHOLDS.responseTimeMs) {
    triggerAlert('SLOW_RESPONSE', 'warning', {
      avgTime: metrics.requests.avgResponseTime.toFixed(0),
      threshold: ALERT_THRESHOLDS.responseTimeMs
    });
  }
}

/**
 * 檢查錯誤率
 */
function checkErrorRate() {
  if (metrics.requests.total === 0) return;
  
  const errorRate = (metrics.errors.total / metrics.requests.total) * 100;
  
  if (errorRate > ALERT_THRESHOLDS.errorRatePercent) {
    triggerAlert('HIGH_ERROR_RATE', 'critical', {
      rate: errorRate.toFixed(2),
      threshold: ALERT_THRESHOLDS.errorRatePercent,
      totalErrors: metrics.errors.total,
      totalRequests: metrics.requests.total
    });
  }
}

/**
 * 獲取當前指標
 */
function getMetrics() {
  return {
    ...metrics,
    uptime: Math.floor((Date.now() - metrics.startTime) / 1000), // seconds
    uptimeFormatted: formatUptime(Date.now() - metrics.startTime)
  };
}

/**
 * 格式化運行時間
 */
function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * 重置指標
 */
function resetMetrics() {
  metrics = {
    startTime: Date.now(),
    requests: {
      total: 0,
      successful: 0,
      failed: 0,
      avgResponseTime: 0
    },
    memory: {
      heapUsed: 0,
      heapTotal: 0,
      external: 0,
      rss: 0
    },
    cpu: {
      usage: 0
    },
    errors: {
      total: 0,
      byType: {}
    },
    alerts: {
      triggered: 0,
      lastAlert: null
    }
  };
  
  logger.info('Metrics reset');
}

/**
 * 導出指標為 JSON
 */
function exportMetrics() {
  return JSON.stringify(getMetrics(), null, 2);
}

/**
 * 創建 Express 中間件用於監控
 */
function createMonitoringMiddleware() {
  return (req, res, next) => {
    const startTime = Date.now();
    
    // 監聽響應結束
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const success = res.statusCode >= 200 && res.statusCode < 400;
      
      recordRequest(duration, success);
      
      // 記錄慢請求
      if (duration > 500) {
        logger.warn('Slow request detected', {
          method: req.method,
          url: req.url,
          duration,
          statusCode: res.statusCode
        });
      }
    });
    
    next();
  };
}

// 啟動定時指標收集（每 30 秒）
let metricsInterval = null;

function startMetricsCollection(intervalMs = 30000) {
  if (metricsInterval) {
    clearInterval(metricsInterval);
  }
  
  collectSystemMetrics(); // 立即執行一次
  
  metricsInterval = setInterval(() => {
    collectSystemMetrics();
  }, intervalMs);
  
  logger.info('Metrics collection started', { interval: intervalMs });
}

function stopMetricsCollection() {
  if (metricsInterval) {
    clearInterval(metricsInterval);
    metricsInterval = null;
    logger.info('Metrics collection stopped');
  }
}

module.exports = {
  ALERT_THRESHOLDS,
  registerAlertHandler,
  triggerAlert,
  recordRequest,
  recordError,
  collectSystemMetrics,
  getMetrics,
  resetMetrics,
  exportMetrics,
  createMonitoringMiddleware,
  startMetricsCollection,
  stopMetricsCollection
};
