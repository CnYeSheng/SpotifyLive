# Spotify Lyrics Player - 優化版本

一個增強版的 Spotify 歌詞播放器，具有實時同步和高級控制功能。

## 🚀 主要改進

### 安全性提升
- ✅ 移除敏感數據文件（sessions.json, queue.json, lyrics-storage.json）
- ✅ 統一的會話管理，防止記憶體洩漏
- ✅ 自動清理過期會話（每 5 分鐘）
- ✅ 輸入驗證中間件，防止注入攻擊
- ✅ 生產環境隱藏堆棧追蹤

### 代碼質量改進
- ✅ 消除 server.js 和 api/index.js 的重複代碼
- ✅ 統一的錯誤處理機制
- ✅ 模塊化架構，易於維護
- ✅ 配置中心化管理

### 性能優化
- ✅ 智能速率限制
- ✅ 緩存優化
- ✅ 動態輪詢間隔

## 📁 專案結構

```
spotify-lyrics-player/
├── api/                    # API 路由和存儲
│   ├── index.js           # Vercel 無服務器函數
│   ├── kv-storage.js      # KV 存儲管理
│   ├── storage-facade.js  # 存儲外觀模式
│   ├── storage-enhanced.js # 增強存儲
│   └── enhanced-lyrics-endpoints.js # 歌詞端點
├── config/                 # 配置文件
│   └── app.js             # 應用配置中心
├── middleware/            # 中間件
│   ├── errorHandler.js    # 統一錯誤處理
│   └── validator.js       # 輸入驗證
├── utils/                 # 工具函數
│   └── sessionManager.js  # 會話管理（單例）
├── public/                # 前端資源
│   ├── index.html
│   ├── script.js          # 主邏輯（建議拆分）
│   └── ...其他 JS 模組
├── server.js              # 主服務器（建議重構）
├── package.json
├── .env.example
└── vercel.json
```

## 🔧 安裝與設置

### 1. 安裝依賴
```bash
npm install
```

### 2. 環境變量配置
複製 `.env.example` 到 `.env` 並填寫你的 Spotify API 憑證：

```env
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
REDIRECT_URI=http://localhost:3000/callback
PORT=3000
NODE_ENV=development
```

### 3. 啟動服務
```bash
# 開發模式
npm run dev

# 生產模式
npm start
```

## 🌐 部署到 Vercel

1. 在 Vercel 環境變量中設置：
   - `SPOTIFY_CLIENT_ID`
   - `SPOTIFY_CLIENT_SECRET`
   - `REDIRECT_URI`
   - `KV_URL` (可選，用於持久化會話)

2. 推送代碼到 Git 倉庫並連接 Vercel

## 📝 待改進項目

### 高優先級
- [ ] 將 server.js 拆分為獨立的路由模組
- [ ] 前端 script.js 模組化（目前 8000+ 行）
- [ ] 添加單元測試和集成測試
- [ ] 實現完整的 API 文檔

### 中優先級
- [ ] 遷移到 TypeScript
- [ ] 添加健康檢查端點 `/api/health`
- [ ] 實現日誌聚合和分析
- [ ] 添加監控和警報

### 低優先級
- [ ] 支持多語言界面
- [ ] 添加主題切換功能
- [ ] 優化移動端體驗

## 🛠️ 技術棧

- **後端**: Node.js, Express
- **前端**: Vanilla JavaScript
- **存儲**: Vercel KV / Redis
- **API**: Spotify Web API
- **部署**: Vercel

## 📄 License

MIT
