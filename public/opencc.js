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
                // 使用 s2twp 配置：簡體中文轉繁體中文（台灣用詞）
                converter = OpenCC.Converter({ from: 's', to: 'twp' });
                console.log('OpenCC 初始化成功 (s2twp)');
                return true;
            } else if (retries < maxRetries) {
                retries++;
                setTimeout(tryInit, 100); // 100ms 後重試
                return false;
            } else {
                console.warn('OpenCC 載入超時，將不進行簡繁轉換');
                return false;
            }
        } catch (error) {
            console.error('OpenCC s2twp 初始化失敗:', error);
            // 如果 s2twp 失敗，嘗試使用基本的簡繁轉換
            try {
                if (typeof OpenCC !== 'undefined' && OpenCC.Converter) {
                    converter = OpenCC.Converter({ from: 'cn', to: 'tw' });
                    console.log('OpenCC 初始化成功 (cn2tw 備用)');
                    return true;
                }
            } catch (fallbackError) {
                console.error('OpenCC 備用初始化也失敗:', fallbackError);
                console.log('將使用原始文本，不進行簡繁轉換');
            }
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