"""
scripts/seed_user.py — idempotent local user creation (US-0.7)

Usage:
    uv run python scripts/seed_user.py [--password <PWD>]
    make seed-user
    make seed-user PASSWORD=foo
"""
from __future__ import annotations

import argparse
import getpass
import os
import sys

import bcrypt
import psycopg

USERNAME = "aishop_local"
WORK_FACTOR = 12


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed the local aishop user")
    parser.add_argument("--password", help="Plaintext password (omit to be prompted)")
    return parser.parse_args()


def get_password(args: argparse.Namespace) -> str:
    if args.password:
        return str(args.password)
    return getpass.getpass("Password for aishop_local: ")


def hash_password(plaintext: str) -> str:
    salt = bcrypt.gensalt(rounds=WORK_FACTOR)
    return bcrypt.hashpw(plaintext.encode(), salt).decode()


def main() -> None:
    args = parse_args()

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("ERROR: DATABASE_URL environment variable is not set", file=sys.stderr)
        sys.exit(1)

    password = get_password(args)
    if not password:
        print("ERROR: password must not be empty", file=sys.stderr)
        sys.exit(1)

    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            # Critic OD-5 strict predicate
            cur.execute(
                "SELECT EXISTS ("
                "  SELECT 1 FROM users"
                "  WHERE password_hash IS NOT NULL AND length(password_hash) > 0"
                ")"
            )
            row = cur.fetchone()
            exists = row[0] if row else False

        if exists:
            print(
                "user already exists; use `make reset-password` to change credentials",
                file=sys.stderr,
            )
            sys.exit(1)

        hashed = hash_password(password)

        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO users (username, password_hash)"
                " VALUES (%s, %s)"
                " RETURNING id",
                (USERNAME, hashed),
            )
            inserted = cur.fetchone()
            user_id = inserted[0] if inserted else None
        conn.commit()

    print(f"✓ seeded user (id={user_id}, work_factor={WORK_FACTOR})")
    sys.exit(0)


if __name__ == "__main__":
    main()
