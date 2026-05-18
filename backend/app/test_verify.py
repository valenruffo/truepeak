import base64
from standardwebhooks import Webhook
from datetime import datetime, timezone

secret = "polar_whs_KHpOkuVNwMtiER6ncWc6yLLTpJlUhBDYiKtMx0FboGA"
normalized_secret = base64.b64encode(secret.encode()).decode()

headers = {
    "webhook-id": "83835aa2-9c5c-4449-aa11-9765348122f2",
    "webhook-timestamp": "1779053129",
    "webhook-signature": "v1,tF1UTd2y1wscgwOzVMRpo3VOVN4a5gzoPi+E5VvRE74="
}

data = '{"type":"benefit_grant.revoked","timestamp":"2026-05-17T21:03:16.669134Z","data":{"created_at":"2026-05-17T20:58:06.167427Z","modified_at":"2026-05-17T21:03:16.651430Z","id":"9570c226-bd94-41b3-819f-2a234af00b2f","granted_at":null,"is_granted":false,"revoked_at":"2026-05-17T21:03:16.650479Z","is_revoked":true,"subscription_id":"5d761f18-c3b4-42f7-a422-718e200dd5e0","order_id":null,"customer_id":"6046cacd-f1f4-4d43-8b49-ef93bd827348","member_id":"28090dcf-87ed-4696-b741-453cbde3e7e7","benefit_id":"ec95df0a-47ab-4665-9c45-c34fb0cd9884","error":null,"customer":{"id":"6046cacd-f1f4-4d43-8b49-ef93bd827348","created_at":"2026-05-17T20:58:04.795348Z","modified_at":"2026-05-17T21:03:16.055156Z","metadata":{},"external_id":null,"email":"kiko@gmail.com","email_verified":false,"type":"individual","name":null,"billing_address":{"line1":null,"line2":null,"postal_code":null,"city":null,"state":null,"country":"AR"},"tax_id":null,"locale":"en","organization_id":"2c074a1d-a013-4d40-bc73-82157dcaaa74","deleted_at":"2026-05-17T21:03:16.054414Z","avatar_url":"https://www.gravatar.com/avatar/efa3166dba1c8eeb2cb2c09cad50bf77fc91d145dd8c75caf81c23842fd7b658?d=404"},"member":{"id":"28090dcf-87ed-4696-b741-453cbde3e7e7","created_at":"2026-05-17T20:58:04.795348Z","modified_at":"2026-05-17T21:03:16.036568Z","customer_id":"6046cacd-f1f4-4d43-8b49-ef93bd827348","email":"kiko@gmail.com","name":null,"external_id":null,"role":"owner"},"benefit":{"id":"ec95df0a-47ab-4665-9c45-c34fb0cd9884","created_at":"2026-05-11T21:52:20.103125Z","modified_at":null,"type":"custom","description":"Detection of rhythmic errors (off-beat)","selectable":true,"deletable":true,"is_deleted":false,"organization_id":"2c074a1d-a013-4d40-bc73-82157dcaaa74","metadata":{},"properties":{"note":null},"is_tax_applicable":true},"properties":{},"previous_properties":{},"user_id":"6046cacd-f1f4-4d43-8b49-ef93bd827348"}}'

try:
    wh = Webhook(normalized_secret)
    def custom_verify_timestamp(timestamp_header):
        return datetime.fromtimestamp(float(timestamp_header), tz=timezone.utc)
    wh._Webhook__verify_timestamp = custom_verify_timestamp

    wh.verify(data, headers)
    print("Verification passed successfully!")
except Exception as e:
    print(f"Verification failed: {e}")


