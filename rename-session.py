import sys, os, sqlite3

DB_PATH = os.path.expanduser("~/.gemini/antigravity-cli/conversation_summaries.db")

def rename_session(cid, new_title):
    if not cid or len(cid) < 10:
        return False, "Invalid CID"
    cleaned_title = new_title.strip()
    if not cleaned_title:
        return False, "Title cannot be empty"

    if os.path.exists(DB_PATH):
        try:
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute("UPDATE conversation_summaries SET title = ? WHERE conversation_id = ?", (cleaned_title, cid))
            rowcount = c.rowcount
            conn.commit()
            conn.close()
            if rowcount == 0:
                # If row was not present in summaries DB, insert a minimal summary record so it appears
                try:
                    conn = sqlite3.connect(DB_PATH)
                    c = conn.cursor()
                    now_iso = sqlite3.datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
                    c.execute(
                        "INSERT OR REPLACE INTO conversation_summaries (conversation_id, title, last_modified_time, last_user_input_time) VALUES (?, ?, ?, ?)",
                        (cid, cleaned_title, now_iso, now_iso)
                    )
                    conn.commit()
                    conn.close()
                except Exception:
                    pass
            return True, "Renamed successfully"
        except Exception as e:
            return False, f"DB Error: {e}"
    return False, "Database not found"

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 rename-session.py <conversation_id> <new_title>", file=sys.stderr)
        sys.exit(1)
    cid = sys.argv[1].strip()
    new_title = sys.argv[2].strip()
    success, msg = rename_session(cid, new_title)
    print(msg)
    sys.exit(0 if success else 1)
