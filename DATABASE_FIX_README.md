# 資料庫錯誤修復指南

## 問題說明

如果您遇到以下錯誤：
```
DB write error: value too long for type character varying(255)
DB write error: value too long for type character varying(1000)
```

這表示資料庫中的 `user_id`、`track_id`、`manual_lyrics_id` 或其他欄位的值超過了字元長度限制。

Apple Music 的 track ID 可能非常長（特別是完整的 URL 格式），某些情況下甚至會超過 1000 字元。

## 解決方案

我們已經將這些欄位改為 **`TEXT` 類型（無長度限制）**，可以儲存任意長度的資料：
- `user_id`: VARCHAR → **TEXT**
- `track_id`: VARCHAR → **TEXT**
- `manual_lyrics_id`: VARCHAR → **TEXT**
- `manual_lyrics_title`: VARCHAR(500) → **TEXT**
- `manual_lyrics_artist`: VARCHAR(500) → **TEXT**

## 如何修復

### 方法 1：自動遷移腳本（推薦）

1. 確保您的 `.env` 文件中已設定 `DB_TYPE` 和 `DATABASE_URL`：
   ```env
   DB_TYPE=postgres  # 或 mysql、mariadb
   DATABASE_URL=your_database_connection_string
   ```

2. 執行遷移腳本：
   ```bash
   node migrate-database.js
   ```

3. 腳本會自動：
   - 檢查當前的欄位類型
   - 將欄位升級到 TEXT（無長度限制）
   - 驗證遷移是否成功

### 方法 2：手動 SQL 執行

如果您偏好手動執行，可以使用 `migrate-database.sql` 文件中的 SQL 語句。

#### PostgreSQL
```sql
ALTER TABLE song_settings ALTER COLUMN user_id TYPE TEXT;
ALTER TABLE song_settings ALTER COLUMN track_id TYPE TEXT;
ALTER TABLE song_settings ALTER COLUMN manual_lyrics_id TYPE TEXT;
ALTER TABLE song_settings ALTER COLUMN manual_lyrics_title TYPE TEXT;
ALTER TABLE song_settings ALTER COLUMN manual_lyrics_artist TYPE TEXT;
```

#### MySQL/MariaDB
```sql
ALTER TABLE song_settings MODIFY COLUMN user_id TEXT NOT NULL;
ALTER TABLE song_settings MODIFY COLUMN track_id TEXT NOT NULL;
ALTER TABLE song_settings MODIFY COLUMN manual_lyrics_id TEXT;
ALTER TABLE song_settings MODIFY COLUMN manual_lyrics_title TEXT;
ALTER TABLE song_settings MODIFY COLUMN manual_lyrics_artist TEXT;
```

### 方法 3：重新建立表（如果資料不重要）

如果您的資料庫是新建立的或資料不重要，可以：

1. 刪除現有的表：
   ```sql
   DROP TABLE song_settings;
   ```

2. 重新啟動應用程式，它會自動使用新的結構建立表。

## 新部署

對於新部署的應用程式，不需要執行遷移。應用程式會自動使用新的表結構（TEXT 類型，無長度限制）。

## 驗證修復

### PostgreSQL
```sql
SELECT column_name, data_type, character_maximum_length 
FROM information_schema.columns 
WHERE table_name = 'song_settings' 
AND column_name IN ('user_id', 'track_id', 'manual_lyrics_id');
```

### MySQL/MariaDB
```sql
DESCRIBE song_settings;
```

您應該看到這些欄位的類型都是 `text`（無長度限制）。

## 相關文件

- `api/storage-enhanced.js` - 包含更新後的表結構定義
- `migrate-database.js` - 自動遷移腳本
- `migrate-database.sql` - SQL 遷移語句

## 常見問題

**Q: 遷移會影響現有資料嗎？**  
A: 不會。ALTER COLUMN/MODIFY COLUMN 操作只會更改欄位的類型，不會影響現有資料。

**Q: 遷移需要多長時間？**  
A: 通常只需要幾秒鐘，除非您的表中有大量資料。

**Q: 如果遷移失敗怎麼辦？**  
A: 檢查資料庫連線設定，確保您有足夠的權限執行 ALTER TABLE 操作。

**Q: MongoDB 需要遷移嗎？**  
A: 不需要。MongoDB 是文件型資料庫，沒有固定的字元長度限制。

**Q: 使用 JSON 文件儲存需要遷移嗎？**  
A: 不需要。JSON 文件儲存沒有字元長度限制。

**Q: TEXT 類型會影響效能嗎？**  
A: 不會。對於我們的使用場景（儲存 ID 和名稱），TEXT 和 VARCHAR 的效能差異可以忽略不計。

**Q: 可以在主鍵中使用 TEXT 類型嗎？**  
A: 可以。PostgreSQL 和 MySQL 都支援 TEXT 類型作為主鍵的一部分。

## 技術細節

### 為什麼使用 TEXT 而不是 VARCHAR？

- **TEXT**: 無長度限制，可以儲存最多 1GB 的文字資料（PostgreSQL）或 64KB（MySQL）
- **VARCHAR(n)**: 有固定的字元數限制，超過就會報錯
- **效能影響**: 對於索引欄位（如 user_id, track_id），TEXT 和 VARCHAR 的效能差異在現代資料庫中幾乎可以忽略不計

### 關於主鍵（Primary Key）

PostgreSQL 和 MySQL 都支援 TEXT 類型作為主鍵的一部分。雖然某些舊版資料庫可能有限制，但在我們的應用場景中完全可行。

## 🎉 修復完成

現在您的應用程式可以：
- ✅ 處理**任意長度**的 Apple Music track ID
- ✅ 儲存超長 URL 格式的識別碼
- ✅ 支援超長的歌曲名稱和藝人名稱
- ✅ **永遠不會**再出現 "value too long" 錯誤
