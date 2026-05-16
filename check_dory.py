import sqlite3
conn = sqlite3.connect('backend-dev/data/database.db')
row = conn.execute("SELECT plan FROM label WHERE slug = 'dory'").fetchone()
print("Dory plan:", row[0] if row else "not found")
