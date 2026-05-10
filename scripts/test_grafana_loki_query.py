import json
import urllib.request

# Same LogQL as decoded from dyskiof-control-room.json panel 27
expr = '{service_name="content-api"} |~ "\\"log_category\\":\\"user\\""'
body = {
    "queries": [
        {
            "refId": "A",
            "datasource": {"type": "loki", "uid": "loki"},
            "expr": expr,
            "queryType": "range",
            "maxLines": 500,
        }
    ],
    "from": "now-6h",
    "to": "now",
}
data = json.dumps(body).encode("utf-8")
req = urllib.request.Request(
    "http://127.0.0.1:3000/api/ds/query",
    data=data,
    headers={"Content-Type": "application/json"},
    method="POST",
)
req.add_header("Authorization", "Basic " + __import__("base64").b64encode(b"admin:admin").decode())
