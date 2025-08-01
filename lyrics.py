# 在文件开头添加编码声明
#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
os.environ['PYTHONIOENCODING'] = 'utf-8'

import syncedlyrics
import sys
import json
import urllib.parse as ul

# 强制标准输出使用UTF-8编码
sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf8', buffering=1)

artist = ul.unquote_plus(sys.argv[1])
title = ul.unquote_plus(sys.argv[2])

try:
    lrc = syncedlyrics.search(f"{title} {artist}", providers=["musixmatch", "lrclib", "netease"])
    if not lrc:
        print(json.dumps({"success": False, "error": "No lyrics found"}))
        sys.exit(0)

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
                    lines.append({ "time": time_ms, "text": text_part })
            except:
                continue

    print(json.dumps({ "success": True, "lyrics": lines, "type": "synced" }, ensure_ascii=False))
    sys.stdout.flush()

except Exception as e:
    print(json.dumps({ "success": False, "error": str(e) }))
    sys.stdout.flush()