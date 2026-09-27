"""Mock hematology-center database backing the agent's tools.

Replace this SQLite stand-in with the real HemCenter database connection
once one exists - the tool functions in tools.py are the integration seam.
"""

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "hemcenter.db"


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    conn = get_connection()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS patients (
            id TEXT PRIMARY KEY,
            full_name TEXT NOT NULL,
            birth_date TEXT NOT NULL,
            diagnosis TEXT
        );

        CREATE TABLE IF NOT EXISTS lab_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id TEXT NOT NULL REFERENCES patients(id),
            test_name TEXT NOT NULL,
            value REAL NOT NULL,
            unit TEXT NOT NULL,
            taken_at TEXT NOT NULL
        );
        """
    )
    if conn.execute("SELECT COUNT(*) FROM patients").fetchone()[0] == 0:
        conn.executemany(
            "INSERT INTO patients (id, full_name, birth_date, diagnosis) VALUES (?, ?, ?, ?)",
            [
                ("p1", "Иванов Иван Иванович", "1985-03-12", "Железодефицитная анемия"),
                ("p2", "Петрова Мария Сергеевна", "1990-07-22", "Тромбоцитопения"),
            ],
        )
        conn.executemany(
            "INSERT INTO lab_results (patient_id, test_name, value, unit, taken_at) VALUES (?, ?, ?, ?, ?)",
            [
                ("p1", "Гемоглобин", 98.0, "g/L", "2026-09-01"),
                ("p1", "Ферритин", 8.5, "ng/mL", "2026-09-01"),
                ("p2", "Тромбоциты", 85.0, "10^9/L", "2026-09-10"),
            ],
        )
        conn.commit()
    conn.close()
