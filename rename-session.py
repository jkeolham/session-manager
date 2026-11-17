import sys, os, sqlite3, json, datetime, re, urllib.request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
CUSTOM_TITLES_PATH = os.path.join(DATA_DIR, "custom_titles.json")
DB_PATH = os.path.expanduser("~/.gemini/antigravity-cli/conversation_summaries.db")
ANNOTATIONS_DIR = os.path.expanduser("~/.gemini/antigravity-cli/annotations")
BRIDGE_ENDPOINT = os.path.join(BASE_DIR, "bridge", "data", "endpoint.json")

def save_custom_title(cid_or_session, new_title):
    os.makedirs(DATA_DIR, exist_ok=True)
    titles = {}
    if os.path.exists(CUSTOM_TITLES_PATH):
        try:
            with open(CUSTOM_TITLES_PATH, "r", encoding="utf-8") as f:
                titles = json.load(f)
                if not isinstance(titles, dict):
                    titles = {}
        except Exception:
            titles = {}

    titles[cid_or_session] = {
        "title": new_title,
        "updatedAt": int(datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000)
    }

    tmp_path = f"{CUSTOM_TITLES_PATH}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(titles, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, CUSTOM_TITLES_PATH)

def sync_pbtxt_annotation(cid, new_title):
    """Directly update or create the Antigravity annotations/<cid>.pbtxt file."""
    try:
        os.makedirs(ANNOTATIONS_DIR, exist_ok=True)
        pbtxt_path = os.path.join(ANNOTATIONS_DIR, f"{cid}.pbtxt")
        escaped_title = new_title.replace('\\', '\\\\').replace('"', '\\"')
        title_entry = f'title:"{escaped_title}"'

        if os.path.exists(pbtxt_path):
            with open(pbtxt_path, "r", encoding="utf-8") as f:
                content = f.read()
            if re.search(r'title\s*:\s*"(?:\\.|[^"\\])*"', content):
                new_content = re.sub(r'title\s*:\s*"(?:\\.|[^"\\])*"', title_entry, content, count=1)
            else:
                new_content = f"{title_entry} {content}".strip()
        else:
            now_sec = int(datetime.datetime.now(datetime.timezone.utc).timestamp())
            new_content = f'{title_entry} last_user_view_time:{{seconds:{now_sec} nanos:0}}'

        tmp_path = f"{pbtxt_path}.tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            f.write(new_content)
        os.replace(tmp_path, pbtxt_path)
    except Exception:
        pass

def sync_bridge_rpc(cid, new_title):
    """Notify Language Server via bridge RPC to sync Antigravity cloud dashboard in real-time."""
    if not os.path.exists(BRIDGE_ENDPOINT):
        return
    try:
        with open(BRIDGE_ENDPOINT, "r", encoding="utf-8") as f:
            ep = json.load(f)
        port = ep.get("port")
        if not port:
            return
        payload = json.dumps({"cid": cid, "title": new_title}).encode("utf-8")
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/rename",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            pass
    except Exception:
        pass

def rename_session(cid, new_title):
    if not cid or len(cid) < 2:
        return False, "Invalid CID or session name"
    cleaned_title = new_title.strip()
    if not cleaned_title:
        return False, "Title cannot be empty"

    # 1. Save to persistent custom_titles.json (Guarantees permanence for Session Manager UI)
    try:
        save_custom_title(cid, cleaned_title)
    except Exception as e:
        return False, f"Failed to save persistent title: {e}"

    # 2. Sync to Antigravity annotations pbtxt file (Disk source of truth for dashboard)
    sync_pbtxt_annotation(cid, cleaned_title)

    # 3. Real-time RPC sync to Language Server & Antigravity dashboard
    sync_bridge_rpc(cid, cleaned_title)

    # 4. Sync to conversation_summaries.db for legacy compatibility
    if os.path.exists(DB_PATH):
        try:
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute("UPDATE conversation_summaries SET title = ? WHERE conversation_id = ?", (cleaned_title, cid))
            rowcount = c.rowcount
            conn.commit()
            if rowcount == 0:
                try:
                    now_iso = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
                    c.execute(
                        "INSERT OR REPLACE INTO conversation_summaries (conversation_id, title, last_modified_time, last_user_input_time, workspace_uris) VALUES (?, ?, ?, ?, ?)",
                        (cid, cleaned_title, now_iso, now_iso, "")
                    )
                    conn.commit()
                except Exception:
                    pass
            conn.close()
        except Exception:
            pass

    return True, "Renamed successfully"

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 rename-session.py <conversation_id_or_session> <new_title>", file=sys.stderr)
        sys.exit(1)
    cid = sys.argv[1].strip()
    new_title = sys.argv[2].strip()
    success, msg = rename_session(cid, new_title)
    print(msg)
    sys.exit(0 if success else 1)
