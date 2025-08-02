// Apple Music 風格增強功能
class AppleMusicEnhancements {
    constructor() {
        this.init();
    }

    init() {
        this.createDynamicBackground();
        this.setupAlbumColorExtraction();
        this.addDynamicAnimations();
    }

    // 創建動態背景元素
    createDynamicBackground() {
        if (!document.querySelector('.dynamic-background')) {
            const dynamicBg = document.createElement('div');
            dynamicBg.className = 'dynamic-background';
            document.body.appendChild(dynamicBg);
        }
    }

    // 從專輯封面提取顏色並應用到背景
    setupAlbumColorExtraction() {
        const albumImage = document.getElementById('album-image');
        if (albumImage) {
            albumImage.addEventListener('load', () => {
                this.extractColorsFromImage(albumImage);
            });
        }
    }

    // 提取圖片主色調
    extractColorsFromImage(img) {
        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = img.width;
            canvas.height = img.height;
            
            ctx.drawImage(img, 0, 0);
            
            // 簡化的顏色提取 - 取樣幾個點
            const colors = [];
            const samplePoints = [
                [canvas.width * 0.2, canvas.height * 0.2],
                [canvas.width * 0.8, canvas.height * 0.2],
                [canvas.width * 0.5, canvas.height * 0.5],
                [canvas.width * 0.2, canvas.height * 0.8],
                [canvas.width * 0.8, canvas.height * 0.8]
            ];

            samplePoints.forEach(([x, y]) => {
                const pixel = ctx.getImageData(x, y, 1, 1).data;
                colors.push({
                    r: pixel[0],
                    g: pixel[1],
                    b: pixel[2]
                });
            });

            // 計算平均色調
            const avgColor = this.calculateAverageColor(colors);
            const complementaryColor = this.getComplementaryColor(avgColor);
            
            // 應用動態背景
            this.applyDynamicBackground(avgColor, complementaryColor);
            
        } catch (error) {
            console.log('無法提取顏色，使用預設配色');
            this.applyDefaultColors();
        }
    }

    // 計算平均顏色
    calculateAverageColor(colors) {
        const avg = colors.reduce((acc, color) => ({
            r: acc.r + color.r,
            g: acc.g + color.g,
            b: acc.b + color.b
        }), { r: 0, g: 0, b: 0 });

        return {
            r: Math.round(avg.r / colors.length),
            g: Math.round(avg.g / colors.length),
            b: Math.round(avg.b / colors.length)
        };
    }

    // 獲取互補色
    getComplementaryColor(color) {
        return {
            r: 255 - color.r,
            g: 255 - color.g,
            b: 255 - color.b
        };
    }

    // 應用動態背景 - 使用專輯封面作為背景
    applyDynamicBackground(color1, color2) {
        const albumImage = document.getElementById('album-image');
        if (albumImage && albumImage.src) {
            // 創建動態背景元素
            let dynamicBg = document.querySelector('.album-dynamic-bg');
            if (!dynamicBg) {
                dynamicBg = document.createElement('div');
                dynamicBg.className = 'album-dynamic-bg';
                document.body.appendChild(dynamicBg);
            }
            
            // 設置專輯封面作為背景
            dynamicBg.style.cssText = `
                position: fixed;
                top: -50%;
                left: -50%;
                width: 200%;
                height: 200%;
                z-index: -2;
                background-image: url('${albumImage.src}');
                background-size: cover;
                background-position: center;
                background-repeat: no-repeat;
                filter: blur(60px) brightness(0.3) saturate(1.5);
                opacity: 0.8;
                animation: albumBackgroundMove 30s ease-in-out infinite;
                transition: all 2s ease-in-out;
            `;
        }
        
        // 保留原有的漸變背景作為備用
        const root = document.documentElement;
        const darkColor1 = this.adjustColorForDarkTheme(color1);
        const darkColor2 = this.adjustColorForDarkTheme(color2);
        
        root.style.setProperty('--album-color-1', `rgb(${darkColor1.r}, ${darkColor1.g}, ${darkColor1.b})`);
        root.style.setProperty('--album-color-2', `rgb(${darkColor2.r}, ${darkColor2.g}, ${darkColor2.b})`);
    }

    // 調整顏色以適合深色主題
    adjustColorForDarkTheme(color) {
        // 降低亮度並增加飽和度
        const factor = 0.6;
        return {
            r: Math.round(color.r * factor),
            g: Math.round(color.g * factor),
            b: Math.round(color.b * factor)
        };
    }

    // 應用預設顏色
    applyDefaultColors() {
        const root = document.documentElement;
        root.style.setProperty('--album-color-1', '#667eea');
        root.style.setProperty('--album-color-2', '#764ba2');
    }

    // 添加動態背景動畫 CSS
    addDynamicAnimations() {
        const style = document.createElement('style');
        style.textContent = `
            @keyframes albumBackgroundMove {
                0%, 100% {
                    transform: scale(1) rotate(0deg);
                }
                25% {
                    transform: scale(1.1) rotate(1deg);
                }
                50% {
                    transform: scale(1.05) rotate(-0.5deg);
                }
                75% {
                    transform: scale(1.08) rotate(0.8deg);
                }
            }
            
            .album-dynamic-bg {
                will-change: transform, filter;
            }
        `;
        document.head.appendChild(style);
    }
}

// 當 DOM 載入完成後初始化
document.addEventListener('DOMContentLoaded', () => {
    new AppleMusicEnhancements();
});

// 匯出以便在主腳本中使用
window.AppleMusicEnhancements = AppleMusicEnhancements;