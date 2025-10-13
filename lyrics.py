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
providers_param = sys.argv[3] if len(sys.argv) > 3 else "lrclib,netease"

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

def search_from_provider(query, provider_name):
    """從單一提供商搜尋歌詞"""
    try:
        # 提供商映射
        provider_map = {
            "musixmatch": ["musixmatch"],
            "lrclib": ["lrclib"], 
            "netease": ["netease"]
        }
        
        if provider_name.lower() not in provider_map:
            return None, None
            
        providers = provider_map[provider_name.lower()]
        lrc = syncedlyrics.search(query, providers=providers)
        
        if lrc:
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
            
            return lines, "synced" if lines else "plain"
        return None, None
    except Exception as e:
        print(f"Error searching from {provider_name}: {str(e)}", file=sys.stderr)
        return None, None

try:
    # 解析提供商參數，處理大括號格式
    if providers_param.startswith('{') and providers_param.endswith('}'):
        providers_param = providers_param[1:-1]  # 移除大括號
    requested_providers = [p.strip().lower() for p in providers_param.split(',')]
    print(f"Requested providers: {requested_providers}", file=sys.stderr)
    
    # 統一使用 "歌名 歌手" 格式
    search_query = f"{title} {artist}"
    print(f"Search query: {search_query}", file=sys.stderr)
    
    results = []
    
    # 搜尋每個提供商
    for provider in requested_providers:
        if provider in ["musixmatch", "lrclib", "netease"]:
            print(f"Searching from {provider}...", file=sys.stderr)
            lyrics, lrc_type = search_from_provider(search_query, provider)
            
            if lyrics:
                results.append({
                    "provider": provider.capitalize(),
                    "lyrics": lyrics,
                    "type": lrc_type,
                    "artist": artist,
                    "title": title
                })
                print(f"Found lyrics from {provider}: {len(lyrics)} lines", file=sys.stderr)
            else:
                print(f"No lyrics found from {provider}", file=sys.stderr)
    
    # 如果沒找到任何結果，嘗試清理後的藝術家名稱
    if not results:
        cleaned_artist = clean_artist_name(artist)
        if cleaned_artist != artist:
            search_query_cleaned = f"{title} {cleaned_artist}"
            print(f"Trying cleaned search: {search_query_cleaned}", file=sys.stderr)
            
            for provider in requested_providers:
                if provider in ["musixmatch", "lrclib", "netease"]:
                    lyrics, lrc_type = search_from_provider(search_query_cleaned, provider)
                    if lyrics:
                        results.append({
                            "provider": provider.capitalize(),
                            "lyrics": lyrics,
                            "type": lrc_type,
                            "artist": cleaned_artist,
                            "title": title
                        })
    
    if results:
        print(json.dumps({
            "success": True,
            "results": results,
            "total": len(results)
        }, ensure_ascii=False))
    else:
        print(json.dumps({
            "success": False, 
            "error": "查不到歌詞",
            "results": [],
            "total": 0
        }))
    sys.stdout.flush()

except Exception as e:
    print(f"Exception: {str(e)}", file=sys.stderr)
    print(json.dumps({ "success": False, "error": "查不到歌詞" }))
    sys.stdout.flush()