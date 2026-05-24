import sqlite3
import sys

def main():
    try:
        conn = sqlite3.connect('/home/ubuntu/truepeak/infra/data/database.db')
        cursor = conn.cursor()
        cursor.execute("UPDATE label SET plan='pro', max_tracks_month=1000, max_emails_month=500, hq_retention_days=14 WHERE slug='feelings-records'")
        conn.commit()
        print("Updated feelings-records to pro")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        if 'conn' in locals():
            conn.close()

if __name__ == '__main__':
    main()
