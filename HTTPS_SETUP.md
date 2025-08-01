# 🔒 HTTPS 設定指南

由於 Spotify Web API 和現代瀏覽器的安全要求，此應用程式必須使用 HTTPS 運行。

## 🚀 自動 SSL 證書生成

應用程式會自動生成自簽名 SSL 證書，有兩種方式：

### 方法 1: OpenSSL (推薦)
如果系統有 OpenSSL，會自動生成高品質的證書。

### 方法 2: Node.js Forge
如果沒有 OpenSSL，會使用 Node.js 的 `node-forge` 庫生成證書。

## 📁 證書文件位置

證書會自動保存在：
```
certs/
├── key.pem    # 私鑰
└── cert.pem   # 證書
```

## ⚠️ 瀏覽器安全警告

首次訪問 `https://localhost:3000` 時，瀏覽器會顯示安全警告：

### Chrome
1. 點擊 **"進階"**
2. 點擊 **"繼續前往 localhost (不安全)"**

### Firefox
1. 點擊 **"進階"**
2. 點擊 **"接受風險並繼續"**

### Edge
1. 點擊 **"進階"**
2. 點擊 **"繼續前往 localhost (不安全)"**

### Safari
1. 點擊 **"顯示詳細資訊"**
2. 點擊 **"造訪此網站"**

## 🔧 Spotify 開發者設定

在 Spotify Developer Dashboard 中，確保設定：

```
Redirect URI: https://localhost:3000/callback
```

**重要**: 必須使用 `https://` 而不是 `http://`

## 🛠️ 故障排除

### 問題: "無法生成 SSL 證書"
**解決方案**:
1. 確保已安裝 `node-forge` 依賴：`npm install`
2. 檢查文件系統權限
3. 手動創建 `certs` 目錄

### 問題: "端口已被使用"
**解決方案**:
1. 修改 `.env` 中的 `PORT=3001`
2. 同時更新 Spotify 設定中的 Redirect URI

### 問題: "證書不受信任"
**解決方案**:
這是正常的，因為使用自簽名證書。在生產環境中應使用正式的 SSL 證書。

## 🌐 生產環境部署

對於生產環境，建議：

1. **使用正式 SSL 證書**
   - Let's Encrypt (免費)
   - CloudFlare
   - 其他 CA 機構

2. **使用反向代理**
   - Nginx
   - Apache
   - Cloudflare

3. **環境變數設定**
   ```env
   REDIRECT_URI=https://yourdomain.com/callback
   PORT=443
   ```

## 📱 本地開發最佳實踐

1. **信任本地證書** (可選)
   - 將生成的證書添加到系統信任列表
   - 避免每次都看到安全警告

2. **使用固定端口**
   - 避免頻繁更改 Spotify 設定

3. **定期更新證書**
   - 刪除 `certs` 目錄重新生成

## 🔐 安全注意事項

- 自簽名證書僅適用於開發環境
- 不要在生產環境使用自簽名證書
- 保護好你的 Spotify Client Secret
- 定期更新依賴套件

---

現在你可以安全地使用 HTTPS 運行 Spotify 歌詞播放器了！🎵✨