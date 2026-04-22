import json, urllib.parse

# Grafana Explore ?panes= — ${__from}/${__to} wstrzykują się przy kliknięciu w linku (wspólny przedział z dashboardu).

loki = {
    "a": {
        "datasource": "loki",
        "queries": [
            {
                "refId": "A",
                "expr": '{service_name="content-api"} | json',
                "queryType": "range",
                "datasource": {"type": "loki", "uid": "loki"},
                "editorMode": "code",
            }
        ],
        "range": {"from": "${__from}", "to": "${__to}"},
    }
}
tempo = {
    "a": {
        "datasource": "tempo",
        "queries": [
            {
                "refId": "A",
                "datasource": {"type": "tempo", "uid": "tempo"},
                "query": '{ resource.service.name = "content-api" }',
                "queryType": "traceql",
            }
        ],
        "range": {"from": "${__from}", "to": "${__to}"},
    }
}
loki_no_range = {
    "a": {
        "datasource": "loki",
        "queries": [
            {
                "refId": "A",
                "expr": '{service_name="content-api"} | json',
                "queryType": "range",
                "datasource": {"type": "loki", "uid": "loki"},
                "editorMode": "code",
            }
        ],
    }
}
tempo_no_range = {
    "a": {
        "datasource": "tempo",
        "queries": [
            {
                "refId": "A",
                "datasource": {"type": "tempo", "uid": "tempo"},
                "query": '{ resource.service.name = "content-api" }',
                "queryType": "traceql",
            }
        ],
    }
}
out_links = [
    {
        "title": "Explore: Loki (logi HTTP, ten przedział)",
        "url": "",
        "targetBlank": True,
    },
    {
        "title": "Explore: Tempo (ślady, TraceQL content-api)",
        "url": "",
        "targetBlank": True,
    },
]
for name, p in [
    ("Loki", loki),
    ("Tempo", tempo),
    ("Loki_no_range", loki_no_range),
    ("Tempo_no_range", tempo_no_range),
]:
    j = json.dumps(p, separators=(",", ":"))
    enc = urllib.parse.quote(j, safe="")
    print(f"\n=== {name} ===")
    print("url suffix: panes=" + enc[:80] + "...")
    print("full: /explore?from=${__from}&to=${__to}&schemaVersion=1&panes=" + enc)

# Fragment do wklejki w fieldConfig.defaults: "links": [...]
loki_j = json.dumps(loki_no_range, separators=(",", ":"))
tempo_j = json.dumps(tempo_no_range, separators=(",", ":"))
loki_e = urllib.parse.quote(loki_j, safe="")
tempo_e = urllib.parse.quote(tempo_j, safe="")
out_links[0][
    "url"
] = f"/explore?from=${{__from}}&to=${{__to}}&schemaVersion=1&panes={loki_e}"
out_links[1][
    "url"
] = f"/explore?from=${{__from}}&to=${{__to}}&schemaVersion=1&panes={tempo_e}"
for o in out_links:
    o["type"] = "link"
print("\nData links (wklej do fieldConfig.defaults):")
print(json.dumps(out_links, ensure_ascii=False, indent=2))
