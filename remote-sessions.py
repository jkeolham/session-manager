import os, glob, sqlite3, datetime, json, sys, time

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CUSTOM_TITLES_PATH = os.path.join(BASE_DIR, "data", "custom_titles.json")
CONV_DIR = os.path.expanduser("~/.gemini/antigravity-cli/conversations")
DB_PATH = os.path.expanduser("~/.gemini/antigravity-cli/conversation_summaries.db")

def format_time_ago(ts):
    if not ts:
        return ""
    now = time.time()
    diff = int(now - ts)
    if diff < 0:
        return "방금"
    if diff < 60:
        return "방금"
    diff_min = diff // 60
    if diff_min < 60:
        return f"{diff_min}m"
    diff_hour = diff_min // 60
    if diff_hour < 24:
        return f"{diff_hour}h"
    diff_day = diff_hour // 24
    if diff_day < 30:
        return f"{diff_day}d"
    diff_month = diff_day // 30
    return f"{diff_month}mo"

def load_custom_titles():
    if not os.path.exists(CUSTOM_TITLES_PATH):
        return {}
    try:
        with open(CUSTOM_TITLES_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, dict):
                result = {}
                for k, v in data.items():
                    if isinstance(v, dict) and v.get("title"):
                        result[k] = v["title"]
                    elif isinstance(v, str) and v.strip():
                        result[k] = v.strip()
                return result
    except Exception:
        pass
    return {}

def get_all_titles():
    titles = {}
    if os.path.exists(DB_PATH):
        try:
            conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
            c = conn.cursor()
            for cid, title, status, steps, not_idle, ltime in c.execute(
                "SELECT conversation_id, title, status, step_count, not_fully_idle, last_modified_time FROM conversation_summaries"
            ):
                if title:
                    is_running = (status == "CASCADE_RUN_STATUS_RUNNING") or bool(not_idle)
                    titles[cid] = {
                        "title": title,
                        "status": status,
                        "steps": steps,
                        "isRunning": is_running,
                        "lastModified": ltime
                    }
            conn.close()
        except Exception:
            pass

    # Persistent custom title priority override
    custom_titles = load_custom_titles()
    for cid, ctitle in custom_titles.items():
        if cid in titles:
            titles[cid]["title"] = ctitle
        else:
            titles[cid] = {
                "title": ctitle,
                "status": "CASCADE_RUN_STATUS_IDLE",
                "steps": 0,
                "isRunning": False,
                "lastModified": None
            }

    return titles

def get_sessions():
    if not os.path.exists(CONV_DIR):
        return []

    titles = get_all_titles()
    sessions = []
    now = time.time()
    for fpath in glob.glob(f"{CONV_DIR}/*.db"):
        fname = os.path.basename(fpath)
        cid = fname[:-3]
        try:
            mtime = os.path.getmtime(fpath)
            size_kb = os.path.getsize(fpath) // 1024
        except OSError:
            continue

        t_info = titles.get(cid, {})
        title = t_info.get("title") or "Unnamed Session"
        if not t_info.get("title") and size_kb < 500:
            continue

        dt = datetime.datetime.fromtimestamp(mtime).strftime("%m-%d %H:%M")
        time_ago = format_time_ago(mtime)
        is_running = t_info.get("isRunning", False)
        # Recent if modified within 12 hours or today
        is_recent = (now - mtime) < 43200

        sessions.append({
            "cid": cid,
            "title": title,
            "mtime": mtime,
            "time_str": dt,
            "timeAgo": time_ago,
            "isRunning": is_running,
            "isRecent": is_recent,
            "status": t_info.get("status", "CASCADE_RUN_STATUS_IDLE"),
            "size_kb": size_kb,
            "steps": t_info.get("steps", 0)
        })

    sessions.sort(key=lambda x: x["mtime"], reverse=True)
    return sessions[:30]

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--titles":
        print(json.dumps(get_all_titles(), ensure_ascii=False))
    else:
        print(json.dumps(get_sessions(), ensure_ascii=False))
