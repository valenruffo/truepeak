"""Test Polar API access and cancel subscription."""
import urllib.request
import urllib.parse
import json

BASE = "http://localhost:8000"

def api(url, data=None, token=None, method=None):
    body = json.dumps(data).encode() if data else b""
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    m = method or ("POST" if data is not None else "GET")
    req = urllib.request.Request(url, data=body if body else None, headers=headers, method=m)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
    except Exception as e:
        return 0, str(e)

# 1. Login
status, resp = api(f"{BASE}/api/labels/login", {"identifier": "fede", "password": "admin123"})
if isinstance(resp, dict):
    token = resp.get("token") or resp.get("access_token")
    print(f"Login OK, token: {str(token)[:40]}...")
else:
    print(f"Login FAILED {status}: {resp}")
    token = None

# 2. Test cancel endpoint
if token:
    print("\n--- CANCEL ---")
    status, resp = api(f"{BASE}/api/labels/fede/cancel-subscription", data={}, token=token, method="POST")
    print(f"Status: {status}")
    print(f"Response: {resp}")

# 3. Test Polar API directly
print("\n--- POLAR API ---")
import os
polar_token = "polar_oat_DbwYw1d85au26rcFoonMyOunonLiFDfPdTtAU0pmvXl"
polar_org = "2c074a1d-a013-4d40-bc73-82157dcaaa74"

# Try v1/subscriptions
for url in [
    f"https://api.polar.sh/v1/subscriptions/?organization_id={polar_org}&limit=5",
    "https://api.polar.sh/v1/subscriptions/?limit=5",
    "https://api.polar.sh/v1/users/me",
]:
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {polar_token}"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
            print(f"OK {url}: {json.dumps(data)[:200]}")
    except urllib.error.HTTPError as e:
        print(f"ERR {e.code} {url}: {e.read().decode()[:200]}")
    except Exception as e:
        print(f"ERR {url}: {e}")
