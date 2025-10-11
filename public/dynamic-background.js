/**
 * 🎵 Dynamic Background System - Apple Music Style
 * 动态背景系统，根据音乐和专辑封面创建动态效果
 */

class DynamicBackground {
    constructor() {
        this.backgroundContainer = document.querySelector('.dynamic-background');
        this.gradientLayer = document.querySelector('.bg-gradient-layer');
        this.particleLayer = document.querySelector('.bg-particles');
        this.shapesLayer = document.querySelector('.bg-shapes');
        this.rippleLayer = document.querySelector('.bg-ripple');
        this.glowElements = document.querySelectorAll('.bg-glow');
        this.gridLayer = document.querySelector('.bg-grid');
        
        this.isPlaying = false;
        this.currentColors = ['#667eea', '#764ba2', '#f093fb', '#4facfe'];
        this.rippleTimer = null;
        this.beatTimer = null;
        
        this.init();
    }

    init() {
        this.log('🎨 Dynamic Background System initialized');
        this.setDefaultColors();
        this.startIdleAnimations();
    }

    log(message) {
        console.log(`[Dynamic Background] ${message}`);
    }

    /**
     * 从专辑封面提取颜色
     */
    async extractColorsFromImage(imageUrl) {
        try {
            this.log(`🎨 正在提取专辑封面颜色: ${imageUrl}`);
            
            // 创建临时canvas来分析图片
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const img = new Image();
            
            // 设置跨域
            img.crossOrigin = 'anonymous';
            
            return new Promise((resolve) => {
                img.onload = () => {
                    canvas.width = 100;
                    canvas.height = 100;
                    ctx.drawImage(img, 0, 0, 100, 100);
                    
                    const colors = this.analyzeImageColors(ctx, canvas);
                    this.log(`✅ 成功提取颜色: ${colors.join(', ')}`);
                    resolve(colors);
                };
                
                img.onerror = () => {
                    this.log('❌ 专辑封面加载失败，使用默认颜色');
                    resolve(this.getRandomColors());
                };
                
                img.src = imageUrl;
            });
        } catch (error) {
            this.log(`❌ 颜色提取错误: ${error.message}`);
            return this.getRandomColors();
        }
    }

    /**
     * 分析图片颜色
     */
    analyzeImageColors(ctx, canvas) {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        const colorMap = new Map();
        
        // 采样像素点
        for (let i = 0; i < data.length; i += 16) { // 每4个像素采样一次
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3];
            
            // 跳过透明或太暗的像素
            if (a < 128 || (r + g + b) < 100) continue;
            
            const color = `${Math.floor(r/32)*32},${Math.floor(g/32)*32},${Math.floor(b/32)*32}`;
            colorMap.set(color, (colorMap.get(color) || 0) + 1);
        }
        
        // 获取最常见的颜色
        const sortedColors = Array.from(colorMap.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([color]) => {
                const [r, g, b] = color.split(',').map(Number);
                return this.enhanceColor(r, g, b);
            });
        
        // 确保至少有4种颜色
        while (sortedColors.length < 4) {
            sortedColors.push(this.getRandomColor());
        }
        
        return sortedColors.slice(0, 4);
    }

    /**
     * 增强颜色饱和度和亮度
     */
    enhanceColor(r, g, b) {
        // 转换为HSL进行调整
        const [h, s, l] = this.rgbToHsl(r, g, b);
        
        // 增强饱和度和亮度
        const newS = Math.min(s + 0.2, 1);
        const newL = Math.max(0.3, Math.min(l + 0.1, 0.7));
        
        const [newR, newG, newB] = this.hslToRgb(h, newS, newL);
        return `rgb(${newR}, ${newG}, ${newB})`;
    }

    /**
     * RGB转HSL
     */
    rgbToHsl(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;

        if (max === min) {
            h = s = 0;
        } else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }
        return [h, s, l];
    }

    /**
     * HSL转RGB
     */
    hslToRgb(h, s, l) {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };

        let r, g, b;
        if (s === 0) {
            r = g = b = l;
        } else {
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }
        return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    }

    /**
     * 获取随机颜色组合
     */
    getRandomColors() {
        const colorSets = [
            ['#667eea', '#764ba2', '#f093fb', '#4facfe'],
            ['#ff9a9e', '#fecfef', '#fecfef', '#ff6b6b'],
            ['#a8edea', '#fed6e3', '#ffecd2', '#fcb69f'],
            ['#667eea', '#764ba2', '#ee9ca7', '#ffdde1'],
            ['#89f7fe', '#66a6ff', '#667eea', '#764ba2'],
            ['#fdbb2d', '#22c1c3', '#fdbb2d', '#ee9ca7']
        ];
        return colorSets[Math.floor(Math.random() * colorSets.length)];
    }

    getRandomColor() {
        const colors = ['#667eea', '#764ba2', '#f093fb', '#4facfe', '#ff9a9e', '#fecfef', '#a8edea', '#fed6e3'];
        return colors[Math.floor(Math.random() * colors.length)];
    }

    /**
     * 设置默认颜色
     */
    setDefaultColors() {
        this.updateColors(this.currentColors);
    }

    /**
     * 更新背景颜色 - 适配专辑封面背景
     */
    updateColors(colors) {
        this.currentColors = colors;
        
        if (this.gradientLayer) {
            // 将颜色转换为适度的叠加效果
            const overlayColors = colors.map(color => {
                return color.replace('rgb', 'rgba').replace(')', ', 0.3)');
            });
            
            this.gradientLayer.style.setProperty('--color-1', overlayColors[0]);
            this.gradientLayer.style.setProperty('--color-2', overlayColors[1]);
            this.gradientLayer.style.setProperty('--color-3', overlayColors[2]);
            this.gradientLayer.style.setProperty('--color-4', overlayColors[3]);
            
            // 添加调试日志
            console.log('🎨 动态背景颜色已更新:', overlayColors);
        }

        // 更新粒子颜色
        if (this.particleLayer) {
            const particleColors = colors.map((color, index) => {
                const opacity = [0.08, 0.06, 0.05, 0.04][index] || 0.03;
                return color.replace('rgb', 'rgba').replace(')', `, ${opacity})`);
            });
            
            this.particleLayer.style.setProperty('--particle-color-1', particleColors[0]);
            this.particleLayer.style.setProperty('--particle-color-2', particleColors[1]);
            this.particleLayer.style.setProperty('--particle-color-3', particleColors[2]);
            this.particleLayer.style.setProperty('--particle-color-4', particleColors[3]);
        }

        // 更新光晕颜色
        this.glowElements.forEach((glow, index) => {
            if (colors[index]) {
                glow.style.setProperty('--glow-color', colors[index].replace('rgb', 'rgba').replace(')', ', 0.15)'));
            }
        });

        this.log(`🎨 叠加颜色已更新: ${colors.join(', ')}`);
    }

    /**
     * 当歌曲变化时更新背景
     */
    async onSongChange(albumArtUrl) {
        this.log('🎵 歌曲变化，更新背景');
        
        // 添加歌曲切换特效
        this.gradientLayer?.classList.add('song-change');
        setTimeout(() => {
            this.gradientLayer?.classList.remove('song-change');
        }, 2000);

        // 如果有专辑封面，提取颜色
        if (albumArtUrl) {
            const colors = await this.extractColorsFromImage(albumArtUrl);
            this.updateColors(colors);
        } else {
            // 使用随机颜色
            const colors = this.getRandomColors();
            this.updateColors(colors);
        }

        // 触发波纹效果
        this.triggerRipple();
    }

    /**
     * 播放状态改变
     */
    onPlayStateChange(isPlaying) {
        this.isPlaying = isPlaying;
        this.log(`🎵 播放状态: ${isPlaying ? '播放' : '暂停'}`);

        // 添加或移除播放状态类
        const playingClass = 'playing';
        if (isPlaying) {
            this.gradientLayer?.classList.add(playingClass);
            this.particleLayer?.classList.add(playingClass);
            this.glowElements.forEach(el => el.classList.add(playingClass));
            this.startBeatSync();
        } else {
            this.gradientLayer?.classList.remove(playingClass);
            this.particleLayer?.classList.remove(playingClass);
            this.glowElements.forEach(el => el.classList.remove(playingClass));
            this.stopBeatSync();
        }
    }

    /**
     * 触发波纹效果
     */
    triggerRipple(x = 50, y = 50) {
        if (!this.rippleLayer) return;

        // 设置波纹位置
        this.rippleLayer.style.setProperty('--ripple-x', `${x}%`);
        this.rippleLayer.style.setProperty('--ripple-y', `${y}%`);
        
        // 触发动画
        this.rippleLayer.classList.remove('active');
        setTimeout(() => {
            this.rippleLayer.classList.add('active');
        }, 10);

        // 清除定时器
        if (this.rippleTimer) {
            clearTimeout(this.rippleTimer);
        }
        
        this.rippleTimer = setTimeout(() => {
            this.rippleLayer?.classList.remove('active');
        }, 3000);
    }

    /**
     * 开始节拍同步动画
     */
    startBeatSync() {
        this.stopBeatSync();
        
        // 模拟音乐节拍 (约120 BPM) - 更频繁更明显
        this.beatTimer = setInterval(() => {
            if (this.isPlaying) {
                this.gradientLayer?.classList.add('bg-beat-sync');
                setTimeout(() => {
                    this.gradientLayer?.classList.remove('bg-beat-sync');
                }, 800);
                
                // 随机位置触发波纹 - 更大范围
                const x = 10 + Math.random() * 80;
                const y = 10 + Math.random() * 80;
                this.triggerRipple(x, y);
                
                // 额外的颜色脉冲效果
                if (this.gradientLayer) {
                    this.gradientLayer.style.transform = 'scale(1.02)';
                    setTimeout(() => {
                        this.gradientLayer.style.transform = 'scale(1)';
                    }, 300);
                }
            }
        }, 1500); // 每1.5秒一次节拍效果 - 更频繁
    }

    /**
     * 停止节拍同步
     */
    stopBeatSync() {
        if (this.beatTimer) {
            clearInterval(this.beatTimer);
            this.beatTimer = null;
        }
    }

    /**
     * 开始空闲动画
     */
    startIdleAnimations() {
        // 定期随机触发波纹（空闲时） - 更频繁更明显
        setInterval(() => {
            if (!this.isPlaying && Math.random() < 0.6) {
                const x = 15 + Math.random() * 70;
                const y = 15 + Math.random() * 70;
                this.triggerRipple(x, y);
            }
            
            // 空闲时也要有轻微的颜色变化
            if (!this.isPlaying && this.gradientLayer) {
                const colors = this.getRandomColors();
                this.updateColors(colors);
            }
        }, 8000); // 每8秒 - 更频繁
        
        // 每10秒强制颜色变化以展示效果 - 更频繁测试
        setInterval(() => {
            this.log('🎨 强制颜色变化展示动态效果');
            const colors = this.getRandomColors();
            this.updateColors(colors);
            this.triggerRipple(50, 50); // 中心波纹
            
            // 临时调试：强制高对比度颜色
            if (this.gradientLayer) {
                this.gradientLayer.style.setProperty('--color-1', 'rgba(255, 0, 0, 0.6)');
                this.gradientLayer.style.setProperty('--color-2', 'rgba(0, 255, 0, 0.6)');
                this.gradientLayer.style.setProperty('--color-3', 'rgba(0, 0, 255, 0.6)');
                this.gradientLayer.style.setProperty('--color-4', 'rgba(255, 255, 0, 0.6)');
                console.log('🔴 临时调试：使用高对比度颜色');
            }
        }, 10000);
    }

    /**
     * 手动触发节拍效果（可以由音频分析触发）
     */
    triggerBeat() {
        this.gradientLayer?.classList.add('bg-beat-sync');
        setTimeout(() => {
            this.gradientLayer?.classList.remove('bg-beat-sync');
        }, 800);
        
        // 触发波纹
        const x = 30 + Math.random() * 40;
        const y = 30 + Math.random() * 40;
        this.triggerRipple(x, y);
    }

    /**
     * 销毁背景系统
     */
    destroy() {
        this.stopBeatSync();
        if (this.rippleTimer) {
            clearTimeout(this.rippleTimer);
        }
        this.log('🎨 Dynamic Background System destroyed');
    }
}

// 导出给window使用
window.DynamicBackground = DynamicBackground;
