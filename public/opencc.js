// Enhanced Simplified to Traditional Chinese conversion (s2twp)
// Based on common character mappings and Taiwanese idioms

// 使用 opencc-js 库实现简繁转换
let converter = null;

// 检查是否已加载 opencc-js 库
if (typeof OpenCC !== 'undefined') {
    // 创建从简体到繁体（台湾标准）的转换器
    converter = new OpenCC('s2twp.json');
}

function convertToTraditional(text) {
    // 如果没有提供文本或不是字符串，直接返回
    if (!text || typeof text !== 'string') return text;
    
    // 如果有转换器，使用 opencc-js 进行转换
    if (converter) {
        try {
            return converter.convert(text);
        } catch (e) {
            console.warn('OpenCC转换失败，使用原始文本:', e);
            return text;
        }
    }
    
    // 如果没有转换器，返回原始文本
    return text;
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { convertToTraditional };
} else if (typeof window !== 'undefined') {
    window.convertToTraditional = convertToTraditional;
}