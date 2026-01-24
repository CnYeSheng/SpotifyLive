# 安裝 syncedlyrics 以獲得同步歌詞

為了獲得更好的歌詞體驗，建議安裝 syncedlyrics Python 包：

## 安裝步驟

### 1. 確保已安裝 Python
```bash
python --version
# 或
python3 --version
```

### 2. 安裝 syncedlyrics
```bash
pip install syncedlyrics
# 或
pip3 install syncedlyrics
```

### 3. 測試安裝
```bash
python -c "import syncedlyrics; print('syncedlyrics 安裝成功！')"
```

## 功能說明

- **有 syncedlyrics**: 獲得帶時間戳的同步歌詞，支援精確的歌詞高亮
- **沒有 syncedlyrics**: 降級使用 lyrics.ovh API，提供基本的純文字歌詞

## 注意事項

- syncedlyrics 會自動從多個來源搜索歌詞
- 支援多種語言的歌詞
- 提供更準確的歌詞匹配

如果不想安裝 Python 依賴，系統會自動使用備用的歌詞源。