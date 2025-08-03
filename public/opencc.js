// OpenCC 簡繁轉換功能 (s2twp)
let converter = null;

// 初始化 OpenCC
async function initOpenCC() {
    // 等待 OpenCC 庫完全載入
    let retries = 0;
    const maxRetries = 10;
    
    const tryInit = () => {
        try {
            if (typeof OpenCC !== 'undefined' && OpenCC.Converter) {
                // 嘗試不同的配置，從最簡單的開始
                const configs = [
                    { from: 'cn', to: 'tw', name: 'cn2tw (簡體到繁體)' },
                    { from: 's', to: 't', name: 's2t (簡體到繁體)' },
                    { from: 'cn', to: 'twp', name: 'cn2twp (簡體到台灣)' }
                ];
                
                for (const config of configs) {
                    try {
                        converter = OpenCC.Converter(config);
                        console.log(`OpenCC 初始化成功 (${config.name})`);
                        return true;
                    } catch (configError) {
                        console.warn(`OpenCC ${config.name} 配置失敗:`, configError.message);
                        continue;
                    }
                }
                
                // 如果所有配置都失敗，記錄錯誤
                console.error('所有 OpenCC 配置都失敗');
                return false;
                
            } else if (retries < maxRetries) {
                retries++;
                setTimeout(tryInit, 100); // 100ms 後重試
                return false;
            } else {
                console.warn('OpenCC 載入超時，將不進行簡繁轉換');
                return false;
            }
        } catch (error) {
            console.error('OpenCC 初始化失敗:', error);
            return false;
        }
    };
    
    tryInit();
}

// 轉換簡體字為繁體字
function convertToTraditional(text) {
    if (!text || typeof text !== 'string') return text;
    
    try {
        if (converter) {
            const result = converter(text);
            // 只在有實際轉換時才記錄
            if (result !== text) {
                console.log(`轉換: "${text}" → "${result}"`);
            }
            return result;
        }
        return text;
    } catch (error) {
        console.error('文字轉換失敗:', error);
        return text;
    }
}

// 頁面載入時初始化
document.addEventListener('DOMContentLoaded', initOpenCC);

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { convertToTraditional };
} else if (typeof window !== 'undefined') {
    window.convertToTraditional = convertToTraditional;
}