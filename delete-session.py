import sys, os, sqlite3, shutil

DB_PATH = os.path.expanduser("~/.gemini/antigravity-cli/conversation_summaries.db")
CONV_DIR = os.path.expanduser("~/.gemini/antigravity-cli/conversations")
BRAIN_DIR = os.path.expanduser("~/.gemini/antigravity-cli/brain")
ANNOT_DIR = os.path.expanduser("~/.gemini/antigravity-cli/annotations")

def delete_session(cid):
    if not cid or len(cid) < 10:
        return False, "Invalid CID"

    # 1. Remove from SQLite conversation_summaries
    if os.path.exists(DB_PATH):
        try:
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute("DELETE FROM conversation_summaries WHERE conversation_id = ?", (cid,))
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"DB Error: {e}", file=sys.stderr)

    # 2. Remove files in conversations dir
    for ext in [".db", ".db-wal", ".db-shm"]:
        f = os.path.join(CONV_DIR, f"{cid}{ext}")
        if os.path.exists(f):
            try:
                os.remove(f)
            except OSError:
                pass

    # 3. Remove annotations
    annot = os.path.join(ANNOT_DIR, f"{cid}.pbtxt")
    if os.path.exists(annot):
        try:
            os.remove(annot)
        except OSError:
            pass

    # 4. Remove brain directory
    brain = os.path.join(BRAIN_DIR, cid)
    if os.path.exists(brain) and os.path.isdir(brain):
        try:
            shutil.rmtree(brain)
        except OSError:
            pass

    return True, "Deleted successfully"

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 delete-session.py <conversation_id>", file=sys.stderr)
        sys.exit(1)
    cid = sys.argv[1].strip()
    success, msg = delete_session(cid)
    print(msg)
    sys.exit(0 if success else 1)
