import json

# Correct LogQL (what Loki must receive)
correct = '{service_name="content-api"} |~ "\\"log_category\\":\\"user\\""'
# Wait that's wrong too. Loki needs regex matching literal quotes in log line.
# Log line contains: "log_category":"user"  (ASCII 0x22 quotes, no backslashes)
# In LogQL: |~ "\"log_category\":\"user\""  means regex pattern is quote log_category quote colon quote user quote

correct2 = '{service_name="content-api"} |~ "\\"log_category\\":\\"user\\""'
# In Python to represent LogQL |~ "\"log..." we need:
correct3 = '{service_name="content-api"} |~ "' + '\\"' + 'log_category' + '\\"' + ':' + '\\"' + 'user' + '\\"' + '"'

# Simpler: use bytes
logql = '{service_name="content-api"} |~ "' + chr(92) + '"' + "log_category" + chr(92) + '"' + ":" + chr(92) + '"' + "user" + chr(92) + '"' + '"'

from pathlib import Path

p = Path(__file__).resolve().parents[1] / "lgtm/grafana/dashboards/dyskiof-control-room.json"
d = json.loads(p.read_text(encoding="utf-8"))
file_expr = [x for x in d["panels"] if x.get("id") == 27][0]["targets"][0]["expr"]

print("logql wanted:", repr(logql))
print("from file:  ", repr(file_expr))
print("equal?", logql == file_expr)

# What Loki regex engine sees (inside outer |~ quotes): extract manually
idx = file_expr.index("|~ ")
inner = file_expr[idx + 4 :]  # after |~ "
if inner.endswith('"'):
    inner = inner[:-1]
print("regex pattern from file (inside delimiters):", repr(inner))

idx2 = logql.index("|~ ")
inner2 = logql[idx2 + 4 : -1]
print("regex pattern wanted:", repr(inner2))

# Correct JSON "expr" value for dashboard file (must decode to LogQL with real quote-chars in regex)
correct_json_expr = '{service_name="content-api"} |~ "\\"log_category\\":\\"user\\""'
# That is WRONG - produces backslashes in regex

# LogQL: regex must match literal quotes in JSON log line (no backslash before " in log)
L = '{service_name="content-api"} |~ "' + '\\"' + "log_category" + '\\"' + ":" + '\\"' + "user" + '\\"' + '"'
print("L repr:", repr(L))
inner_L = L[L.index("|~ ") + 4 : -1]
print("inner L (regex):", repr(inner_L))
print("json.dumps(L) for expr field:", json.dumps(L))
