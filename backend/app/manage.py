"""Admin command line (run inside the container / server shell).

    python -m app.manage list-users
    python -m app.manage create-user you@example.com
    python -m app.manage reset-password you@example.com
    python -m app.manage delete-user someone@example.com

There is no email-based password reset, so admins reset passwords from here.
"""

from __future__ import annotations

import argparse
import getpass
import sys
import uuid
from datetime import datetime, timezone

from .auth import hash_password
from .db import get_db


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def _ask_password() -> str:
    pw = getpass.getpass("New password (min 8 chars): ")
    if len(pw) < 8 or pw != getpass.getpass("Repeat: "):
        sys.exit("Passwords too short or don't match.")
    return pw


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="python -m app.manage")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list-users")
    for name in ("create-user", "reset-password", "delete-user"):
        sub.add_parser(name).add_argument("email")
    args = p.parse_args(argv)

    with get_db().tx() as c:
        if args.cmd == "list-users":
            rows = c.all(
                "SELECT u.email, u.created_at, u.last_login_at, "
                "(SELECT COUNT(*) FROM cvs WHERE cvs.user_id = u.id) AS cvs FROM users u ORDER BY u.created_at"
            )
            for r in rows:
                print(f"{r['email']:<40} cvs={r['cvs']:<4} created={r['created_at'][:10]} last_login={(r['last_login_at'] or '-')[:10]}")
            print(f"{len(rows)} user(s)")
            return

        email = args.email.strip().lower()
        row = c.one("SELECT id FROM users WHERE email = ?", (email,))
        if args.cmd == "create-user":
            if row:
                sys.exit("User already exists.")
            c.execute(
                "INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, '', ?, ?)",
                (uuid.uuid4().hex, email, hash_password(_ask_password()), _now()),
            )
            print("Created", email)
            return
        if not row:
            sys.exit("No such user.")
        if args.cmd == "reset-password":
            c.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(_ask_password()), row["id"]))
            c.execute("DELETE FROM sessions WHERE user_id = ?", (row["id"],))
            print("Password reset; existing sessions signed out.")
        elif args.cmd == "delete-user":
            if input(f"Delete {email} and all their CVs? Type the email to confirm: ").strip().lower() != email:
                sys.exit("Cancelled.")
            for sql in ("DELETE FROM cvs WHERE user_id = ?", "DELETE FROM sessions WHERE user_id = ?",
                        "DELETE FROM ai_usage WHERE user_id = ?", "DELETE FROM ai_keys WHERE user_id = ?",
                        "DELETE FROM users WHERE id = ?"):
                c.execute(sql, (row["id"],))
            print("Deleted", email)


if __name__ == "__main__":
    main()
