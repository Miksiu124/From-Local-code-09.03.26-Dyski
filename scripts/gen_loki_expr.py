import json


def line_filter(cat: str) -> str:
    return (
        '{service_name="content-api"} |= "'
        + "\\"
        + '"'
        + "log_category"
        + "\\"
        + '"'
        + ":"
        + "\\"
        + '"'
        + cat
        + "\\"
        + '"'
        + '"'
    )


for cat in ("user", "server", "misc"):
    s = line_filter(cat)
    print(cat, s)
    print("  json:", json.dumps(s))

# Regex: match "status":5xx in JSON body
heur = (
    '{service_name="content-api"} |~ "(?i)(error|fatal|panic|'
    + "\\"
    + '"'
    + "status"
    + "\\"
    + '"'
    + r":5[0-9][0-9])"
    + '"'
)
print("heur", heur)
print("  json:", json.dumps(heur))
