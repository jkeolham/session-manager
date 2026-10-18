import os, glob, sqlite3, datetime, json

CONV_DIR = os.path.expanduser("~/.gemini/antigravity-cli/conversations")
DB_PATH = os.path.expanduser("~/.gemini/antigravity-cli/conversation_summaries.db")

def get_sessions():
    if not os.path.exists(DB_PATH) or not os.path.exists(CONV_DIR):
        return []
    try:
        conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
        c = conn.cursor()
        titles = {}
        for cid, title, status, steps in c.execute("SELECT conversation_id, title, status, step_count FROM conversation_summaries"):
            titles[cid] = {"title": title, "status": status, "steps": steps}
    except Exception:
        titles = {}

    sessions = []
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
        sessions.append({
            "cid": cid,
            "title": title,
            "mtime": mtime,
            "time_str": dt,
            "size_kb": size_kb,
            "steps": t_info.get("steps", 0)
        })

    sessions.sort(key=lambda x: x["mtime"], reverse=True)
    return sessions[:30]

if __name__ == "__main__":
    print(json.dumps(get_sessions(), ensure_ascii=False))
