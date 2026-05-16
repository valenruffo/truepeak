import sqlite3
conn = sqlite3.connect('backend-dev/data/database.db')
print("Dory:", conn.execute("SELECT id, slug, plan, owner_email FROM label WHERE slug = 'dory'").fetchall())
print("All users:", conn.execute("SELECT slug, owner_email FROM label").fetchall())
