import sys, os, sqlite3, json, datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
CUSTOM_TITLES_PATH = os.path.join(DATA_DIR, "custom_titles.json")
DB_PATH = os.path.expanduser("~/.gemini/antigravity-cli/conversation_summaries.db")

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

def rename_session(cid, new_title):
    if not cid or len(cid) < 2:
        return False, "Invalid CID or session name"
    cleaned_title = new_title.strip()
    if not cleaned_title:
        return False, "Title cannot be empty"

    # 1. Save to persistent custom_titles.json (Guarantees permanence against LS background reconciliation)
    try:
        save_custom_title(cid, cleaned_title)
    except Exception as e:
        return False, f"Failed to save persistent title: {e}"

    # 2. Sync to conversation_summaries.db for compatibility
    if os.path.exists(DB_PATH):
        try:
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute("UPDATE conversation_summaries SET title = ? WHERE conversation_id = ?", (cleaned_title, cid))
            rowcount = c.rowcount
            conn.commit()
            if rowcount == 0:
                # If row was not present in summaries DB, insert a minimal record with non-null workspace_uris
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
