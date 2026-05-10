# Spotify 即時歌詞播放器 - 專案設計規範 (Design Specification)

本文件定義了本專案的視覺語言與 UI/UX 標準，確保所有功能模組（如播放器、統計儀表板、分享卡片）保持一致的高質感視覺體驗。

## 1. 核心設計主題：Premium Glassmorphism (高級感毛玻璃)

本專案採用現代化的毛玻璃設計語言，結合深色模式與鮮豔的品牌色調，營造出通透、立體且具備未來感的介面。

### 核心視覺元素
- **背景層次**：使用深色背景 (`#121212`)，並疊加多層微弱的徑向漸層 (`radial-gradient`) 以營造光源感。
- **毛玻璃面板**：
    - `background`: `rgba(18, 18, 18, 0.7)` 或更淺的 `rgba(255, 255, 255, 0.05)`。
    - `backdrop-filter`: `blur(25px)` 至 `blur(30px)`。
    - `border`: `1px solid rgba(255, 255, 255, 0.1)` (極細半透明邊框)。
    - `border-radius`: 核心容器使用 `32px`，元件使用 `16px` 或 `24px`。

## 2. 色彩規範 (Color Palette)

| 顏色名稱 | 色碼 / 值 | 用途 |
| :--- | :--- | :--- |
| **Spotify Green** | `#1db954` | 主要品牌色、強調文字、主要按鈕 |
| **Green Hover** | `#1ed760` | 按鈕懸停狀態 |
| **Background Dark** | `#121212` | 基礎背景色 |
| **Text Main** | `#ffffff` | 主要標題、數值 |
| **Text Dim** | `#b3b3b3` | 次要資訊、標籤文字 |
| **Accent Glow** | `rgba(29, 185, 84, 0.1)` | 裝飾性光暈、狀態標籤背景 |

## 3. 字體與排版 (Typography)

- **首選字體**：`'Spotify Mix'` (品牌自定義字體)。
- **備用字體**：`'Inter'`, `sans-serif`。
- **規範細則**：
    - **大標題**：`font-weight: 800`, `letter-spacing: -0.02em`。
    - **統計數值**：`font-weight: 700`, `font-family: 'Inter'` (確保數字清晰)。
    - **標籤文字**：`text-transform: uppercase`, `letter-spacing: 0.05em`, `font-size: 14px`。
    - **章節間距**：內容區塊 (`.top-songs-section` 等) 頂部間距應為 `60px`，標題下方間距為 `28px`。

## 4. UI 元件規範 (Components)

### 按鈕 (Buttons)
- **風格**：膠囊型 (Pill-shaped, `border-radius: 100px`)。
- **動態效果**：
    - 懸停時 `transform: translateY(-2px) scale(1.02)`。
    - 增加 `box-shadow` 以強化視覺反饋。

### 互動選擇器 (Animated Selectors / Sliding Pill)
- **結構**：容器需設置 `position: relative` 與 `isolation: isolate`。內部包含一個 `.selector-pill` 裝飾層。
- **滑塊樣式**：`background: var(--spotify-green)`，具備 `100px` 圓角與外陰影。
- **交互邏輯**：點擊選項時，透過 JS 動態計算目標按鈕的 `offsetLeft` 與 `offsetWidth` 並同步更新至 `.selector-pill`。
- **動畫曲線**：使用 `all 0.4s cubic-bezier(0.16, 1, 0.3, 1)` 實現高品質的位移與縮放感。

### 統計卡片 (Stat Cards)
- **背景**：固定使用 `rgba(255, 255, 255, 0.055)` 背景與內陰影 `box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04)`。
- **裝飾**：右上角必須包含一個 `110x110` 的半透明圓形氣泡 (`::after`)，且圓心必須與 `stat-icon` 中心完全重合。
- **數據精確度**：時間類數據必須精確到 **「秒」** (格式如：`1h 23m 45s`)。
- **互動**：懸停時 `transform: translateY(-5px)`，且背景氣泡應有縮放效果 (`scale(1.1)`)。

### 分享卡片 (Share Cards)
- **裝飾**：必須包含三個模糊的裝飾氣泡 (`.share-card-bg-blob`) 位於背景層。
- **頁尾**：
    - 左側：應用程式名稱 (Spotify 即時歌詞播放器)。
    - 右側：日期標籤 (使用綠色膠囊狀 `.footer-date-tag` 樣式)。

## 5. 動畫規範 (Animations)

- **過渡曲線**：優先使用 `cubic-bezier(0.16, 1, 0.3, 1)` (Quartic Out)，營造平滑且具質感的彈出感。
- **持續時間**：
    - 簡單交互：`0.2s` - `0.3s`。
    - 模態框/大型容器：`0.4s`。
