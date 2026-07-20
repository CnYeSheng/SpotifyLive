# Spotify Lyrics Player — 歌词系统架构文档

> 基于 folia-major 设计理念，记录当前系统的完整歌词处理流程。

---

## 1. 歌词查询流程

### 1.1 查询优先级

```
用户点击歌曲 / 切歌
  │
  ├─ [P1] 本地存储 (lyricsStorageManager)
  │   └─ IndexedDB + 云端同步的用户自定义歌词
  │
  ├─ [P2] 预加载缓存 (nextSongLyrics)
  │   └─ 队列中下一首歌的歌词预取
  │
  ├─ [P3] 内存缓存 (this.lyrics + currentLyricsTrackId)
  │   └─ 当前歌曲已加载的歌词
  │
  └─ [P4] API 加载 (最后手段)
      └─ /api/lyrics/:artist/:title → 外部 Python API
```

### 1.2 多供应商搜索

**服务端自动模式** (`/api/lyrics/:artist/:title` 无 `?p=` 参数):

| 优先级 | 供应商 | 逐字支持 | 说明 |
|--------|--------|---------|------|
| 1 | QQMusic | QRC | QQ 音乐，需解密 |
| 2 | Kugou | KRC | 酷狗音乐，需解密 |
| 3 | NetEase | YRC | 网易云音乐 |
| 4 | Lrclib | LRC | 开源歌词库 |
| 5 | Musixmatch | LRC | Musixmatch |

**评分机制**:
- 逐字歌词 (words array) → 分数 3
- 时间同步歌词 (time field) → 分数 2
- 普通歌词 → 分数 1
- 选择最高分的供应商结果

**回退搜索**: 如果所有供应商失败，尝试 `/api/search/` 搜索 → 取第一个结果的歌词

### 1.3 供应商评分详情

```
score = titleMatch(45) + artistMatch(25) + albumMatch(30) × durationMultiplier

标题匹配:
  - Jaccard 字符相似度
  - 繁体→简体 (OpenCC)
  - 日文→罗马字 (wanakana)
  - 移除 feat/remix/version 等标记

艺术家匹配:
  - 按 [,&、\/] feat. ft. 分割
  - 逐个比较，主艺术家加权

时长匹配:
  ≤ 1s → ×1.0
  ≤ 3s → ×0.95
  ≤ 5s → ×0.75
  ≤ 10s → ×0.35
  > 10s → ×0.1

最低接受分数: 75
```

---

## 2. 歌词解析流程

### 2.1 格式检测优先级

```
输入文本
  │
  ├─ SRT: /^\d+\s*\n\d{1,2}:\d{2}:\d{2}[,\.]\d{3}\s*-->/
  │
  ├─ TTML: /<tt/ + (http://www.w3.org/ns/ttml | itunes:timing=)
  │
  ├─ VTT: WEBVTT 开头 或 /-->/
  │
  ├─ Enhanced LRC: /<\d{2}:\d{2}[.:]\d{2,3}>/ 或同行多个时间戳
  │
  ├─ ASS/SSA: "Dialogue:" 开头
  │
  └─ LRC (默认): /^\[(\d{2}):(\d{2})[.:](\d{2,3})\]/
```

### 2.2 支持的格式

| 格式 | 逐字 Timing | 时间戳类型 | 解析方式 |
|------|------------|-----------|---------|
| **LRC** | 无（均匀分配） | 行级 | `buildTimedWords` 按字符权重分配 |
| **Enhanced LRC** | 有 | 绝对秒 | `<MM:SS.xx>word` 或 `[MM:SS.xx]word` |
| **YRC** (网易云) | 有 | 绝对毫秒 | `[startMs,durationMs](startMs,durationMs)text` |
| **QRC** (QQ音乐) | 有 | 绝对毫秒 | `[startMs,durationMs](startMs,durationMs)text` |
| **KRC** (酷狗) | 有 | 相对毫秒 | `[startMs,durationMs]<offsetMs,durationMs>text` |
| **VTT** | 无（均匀分配） | 行级 | `HH:MM:SS.mmm --> HH:MM:SS.mmm` |
| **SRT** | 无（行级） | 行级 | `HH:MM:SS,mmm --> HH:MM:SS,mmm` |
| **ASS/SSA** | 有（karaoke 标签） | 行级 | `{\\kFF}word` 格式 |
| **TTML** | 有（音节级） | 毫秒→秒 | 外部库解析 |

### 2.3 逐字时间分配算法

当格式没有逐字 timing 时（LRC/VTT），均匀分配时间:

```
1. 按空格分词
2. CJK/日文/韩文: 拆成单字符，标点权重=0，其他权重=1
3. 拉丁文: 权重 = 1 + (词长度 × 0.15)
4. 活跃时长 = 总时长 × 90%（留 10% 缓冲）
5. 每个 token 的显示时间 = token权重 × (活跃时长 / 总权重)
6. 最小词时长 = 30ms
```

### 2.4 翻译匹配

| 格式 | 翻译来源 | 匹配方式 |
|------|---------|---------|
| LRC/Enhanced LRC | 独立翻译字符串 | 最近时间戳匹配（容差 1.0s） |
| YRC/QRC | 独立翻译字符串 | 最近时间戳匹配 |
| KRC | 内嵌 `[language:base64]` 或外部 | 内嵌: 同索引; 外部: 最近时间戳 |
| TTML | 每行内嵌 `translations` 数组 | 直接关联 |
| ASS/SSA | 无 | 不支持 |

### 2.5 间奏检测

```
1. 第一行开始 > 5s → 在开头插入间奏
2. 相邻行间隔 > 5s → 在中间插入间奏
3. 间奏标记: { text: '......', isInterlude: true }
4. 间奏行在显示时使用特殊样式
```

### 2.6 Render Hints

每行根据持续时间分类:

| 分类 | 阈值 | 行过渡模式 | 词揭示模式 |
|------|------|-----------|-----------|
| `micro` | < 100ms | `none`（无动画） | `instant` |
| `short` | < 180ms | `fast` | `fast` |
| `normal` | ≥ 180ms | `normal` | `normal` |

---

## 3. 歌词显示流程

### 3.1 三态模型

```
waiting → active → passed
  │         │        │
  │         │        └─ 已播放: 低透明度
  │         └─ 当前激活: 全亮 + 逐字高亮
  └─ 未播放: 半透明 + 模糊
```

### 3.2 逐字高亮

```
对当前行的每个词:
  if (currentTime >= wordEndTime):
    → passed: 绿色，完成状态
  else if (currentTime >= wordTime):
    → active: 绿色渐变填充 (--word-progress)
  else:
    → waiting: 半透明
```

### 3.3 渲染层次

```
VisualizerShell (壳层)
  ├─ 背景层: VisualBackground (专辑模糊 + 渐变 + 几何形状)
  ├─ 歌词层: lyrics-content (三态模型 + 逐字高亮)
  └─ 字幕层: lyrics-subtitle (翻译 + 下一句预览)
```

---

## 4. 背景系统

### 4.1 通用 (Common)

```
专辑封面模糊 (blur 60px) + 饱和度增强
  + 径向渐变叠加
  + 暗角效果
  + 3 个浮动几何圆形
```

### 4.2 莫奈 (Monet)

```
专辑封面作为背景
  + 高斯模糊 (blur 40px)
  + 灰度/饱和度调整
  + 颜色洗涤 (wash)
  + 半透明叠加
```

### 4.3 漫游 (Nomand)

```
像素化抖动效果
  + 可配置网格大小 (2x2, 4x4, 8x8)
  + 颜色步数控制
  + 可选原始颜色/反转
```

### 4.4 隐现 (Latent)

```
着色器动态背景
  + dithering 速度控制
  + mesh 扭曲/漩涡
  + 音频响应
  + 混合显示模式
```

### 4.5 嵌入 (URL)

```
用户自定义图片/视频
  + 可配置多个 URL
  + 选择当前使用的
```

### 4.6 空 (None)

```
纯色背景 (theme.backgroundColor)
  无额外效果
```

---

## 5. 歌词动画模式

### 5.1 流光 (Classic)

```
DOM + Framer Motion (CSS 动画替代)
  - 散点词布局 (确定性随机)
  - waiting → active → passed 三态
  - 逐字 glow 效果 (textShadow)
  - 呼吸浮动 (y/scale 振荡)
  - 副歌 ripple 效果
```

### 5.2 心象 (Cadenza)

```
Canvas + DOM overlay
  - 重型排版引擎
  - glow/beam 特效
  - 字体缩放适配
```

### 5.3 云阶 (Partita)

```
分列/分块布局
  - 先定结构再动词
  - 布局缓存
  - stagger 延迟
```

### 5.4 浮名 (Fume)

```
文章式整页排版
  - 摄影机追焦效果
  - glyph 级 reveal
  - 多轮 measurement
```

### 5.5 倾诉 (Tilt)

```
倾斜排版
  - 强调片段
  - 文字重心变化
  - 颜色方案切换
```

### 5.6 迴环 (Claddagh)

```
椭圆轨道排版
  - grapheme timing 驱动
  - 字符间距缓存
  - 焦点缩放
```

### 5.7 莫奈 (Monet)

```
海报式布局
  - 右侧肖像支持
  - 关键词着色
  - 音频条可视化
```

### 5.8 群唱 (Cappella)

```
聊天气泡/表情包叙事
  - 离线文本测量
  - 自定义 emoji/头像
  - 气泡稳定布局
```

### 5.9 镜臺 (Diorama)

```
3D 点云 + 飞行动画
  - Three.js 渲染
  - 粒子系统
  - 音频响应
  - 灵魂出窍效果
```

---

## 6. 数据结构

### 6.1 核心类型

```typescript
interface LyricLine {
  time: number;           // 行开始时间 (ms)
  endTime?: number;       // 行结束时间 (ms)
  text: string;           // 完整文本
  words?: LyricWord[];    // 逐词 timing
  translation?: string;   // 翻译
  isInterlude?: boolean;  // 是否间奏
  isChorus?: boolean;     // 是否副歌
  renderHints?: RenderHints;  // 渲染提示
}

interface LyricWord {
  time: number;           // 词开始时间 (ms)
  text: string;           // 词文本
  duration?: number;      // 持续时间 (ms)
}

interface RenderHints {
  timingClass: 'micro' | 'short' | 'normal';
  transitionMode: 'none' | 'fast' | 'normal';
  wordRevealMode: 'instant' | 'fast' | 'normal';
  duration: number;       // 行持续时间 (秒)
}
```

### 6.2 API 响应格式

```json
{
  "success": true,
  "lyrics": [
    {
      "time": 15000,
      "text": "Hello World",
      "words": [
        { "time": 15000, "text": "Hello", "duration": 500 },
        { "time": 15500, "text": " ", "duration": 0 },
        { "time": 15500, "text": "World", "duration": 500 }
      ]
    }
  ],
  "type": "synced",
  "provider": "NetEase"
}
```

---

## 7. 缓存策略

| 层级 | 位置 | TTL | 说明 |
|------|------|-----|------|
| 内存 | `this.lyrics` | 会话 | 当前歌曲歌词 |
| 预加载 | `this.nextSongLyrics` | 切歌时清除 | 队列下一首 |
| localStorage | `userLyrics[trackId]` | 永久 | 用户自定义歌词 |
| 服务端内存 | `lyricsCache` Map | 30 分钟 | 外部 API 结果缓存 |
| 服务端 KV | enhancedStorage | 永久 | 用户设置 + 歌词 |

---

## 8. 文件结构

```
public/
├── js/modules/
│   ├── enhanced-lyrics-parser.js    # 增强歌词解析器
│   └── visual-background.js         # 视觉背景系统
├── script.js                        # 主逻辑 (SpotifyLyricsPlayer)
├── lyrics-manager.js                # 歌词上传/下载/编辑
├── lyrics-search.js                 # 歌词搜索 UI
├── user-lyrics-manager.js           # 用户歌词管理
├── enhanced-lyrics-caching.js       # 歌词缓存增强
├── styles.css                       # 所有样式
└── index.html                       # 主页面

server.js                            # Express 服务端
├── /api/lyrics/:artist/:title       # 歌词查询 (多供应商)
├── /api/lyrics-search-multi/        # 多供应商并行搜索
├── /api/current-track               # 当前播放状态
├── /api/control/offset              # 歌词时间偏移
└── /api/control/manual-lyrics       # 手动歌词覆盖

api/
├── enhanced-lyrics-endpoints.js     # 歌词增强 API
├── kv-storage.js                    # KV 存储
└── storage-enhanced.js              # 增强存储
```

---

## 9. 未来扩展点

### 9.1 新增歌词供应商

在 `server.js` 的 `/api/lyrics/:artist/:title` 端点中:
1. 在 `providers` 数组中添加新供应商名
2. 确保外部 Python API 支持该供应商
3. 评分逻辑自动适配

### 9.2 新增歌词格式

在 `enhanced-lyrics-parser.js` 中:
1. 添加格式检测正则
2. 实现解析函数
3. 在 `parse()` 方法中添加分支

### 9.3 新增视觉模式

在 `styles.css` 中:
1. 添加模式 CSS 类
2. 在 `script.js` 中添加模式切换逻辑
3. 更新模式选择器 UI

### 9.4 新增背景模式

在 `visual-background.js` 中:
1. 添加背景渲染方法
2. 在 `updateBackground()` 中添加模式分支
3. 更新背景选择器 UI
