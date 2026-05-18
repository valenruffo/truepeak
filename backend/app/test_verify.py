import inspect
from polar_sdk.webhooks import validate_event

try:
    print(inspect.getsource(validate_event))
except Exception as e:
    print(f"Error: {e}")

