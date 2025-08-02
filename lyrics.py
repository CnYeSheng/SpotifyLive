# 在文件开头添加编码声明
#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
os.environ['PYTHONIOENCODING'] = 'utf-8'

import syncedlyrics
import sys
import json
import urllib.parse as ul
import re

# 强制标准输出和错误输出使用UTF-8编码
sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf8', buffering=1)
sys.stderr = open(sys.stderr.fileno(), mode='w', encoding='utf8', buffering=1)

artist = ul.unquote_plus(sys.argv[1])
title = ul.unquote_plus(sys.argv[2])

def convert_to_traditional(text):
    """Convert simplified Chinese to traditional Chinese using OpenCC"""
    try:
        import opencc
        converter = opencc.OpenCC('s2twp')
        return converter.convert(text)
    except ImportError:
        # If OpenCC is not available, return original text
        return text

def clean_artist_name(artist):
    """Clean artist name by removing extra artists and converting to simplified Chinese"""
    # Remove everything after comma, "feat", "ft", etc.
    cleaned = re.split(r'[,，]|feat\.?|ft\.?|\s+&\s+', artist, flags=re.IGNORECASE)[0].strip()
    return cleaned

try:
    # 統一使用 "歌名 歌手" 格式，就像命令行 syncedlyrics "歌名 歌手"
    search_query = f"{title} {artist}"
    print(f"Search query: {search_query}", file=sys.stderr)
    
    # 只使用可靠的提供商，避免 Musixmatch 401 錯誤
    lrc = syncedlyrics.search(search_query, providers=["lrclib", "netease"])
    
    # 如果沒找到，嘗試清理後的藝術家名稱
    if not lrc:
        cleaned_artist = clean_artist_name(artist)
        if cleaned_artist != artist:
            search_query_cleaned = f"{title} {cleaned_artist}"
            print(f"Trying cleaned search: {search_query_cleaned}", file=sys.stderr)
            lrc = syncedlyrics.search(search_query_cleaned, providers=["lrclib", "netease"])
    
    if not lrc:
        print(f"No lyrics found: {search_query}", file=sys.stderr)
        print(json.dumps({"success": False, "error": "查不到歌詞"}))
        sys.exit(0)
    
    print(f"Found lyrics: {search_query}", file=sys.stderr)

    lines = []
    for line in lrc.split('\n'):
        if line.startswith('[') and ']' in line:
            try:
                time_part = line[line.find('[') + 1:line.find(']')]
                text_part = line[line.find(']') + 1:].strip()
                if ':' in time_part and text_part:
                    mins, rest = time_part.split(':')
                    secs, ms = (rest + '.0').split('.')[:2]
                    time_ms = int(mins) * 60000 + int(secs) * 1000 + int(ms[:2]) * 10
                    # Convert simplified Chinese to traditional Chinese
                    converted_text = convert_to_traditional(text_part)
                    lines.append({ "time": time_ms, "text": converted_text })
            except:
                continue

    print(json.dumps({ "success": True, "lyrics": lines, "type": "synced" }, ensure_ascii=False))
    sys.stdout.flush()

except Exception as e:
    print(f"Exception: {str(e)}", file=sys.stderr)
    print(json.dumps({ "success": False, "error": "查不到歌詞" }))
    sys.stdout.flush()