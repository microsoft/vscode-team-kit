#!/usr/bin/env python3
"""Incremental refresh of the master <COPILOT_HOME>/project-boards/my-issues.json index.

Pipeline:
  1. Inventory all open+closed issues assigned to ASSIGNEE in org ORG via GraphQL search,
     using adaptive date-partitioning to stay under the 1000-result search cap per partition.
  2. Diff the inventory against the existing index to find added / changed / restored /
     missing (possibly unassigned or deleted) records.
  3. Fetch full metadata (REST) only for added/changed/restored records.
  4. Verify missing records directly against GitHub (not just absence from search).
  5. Enrich changed microsoft/vscode records from the vscodesweeper-state `origin/state` ref
     (read-only git, no checkout/mutation of that repo), then refresh the `sweeper` object of
     every open (or already-enriched) microsoft/vscode record whose upstream Sweeper review
     changed, independent of GitHub changes.
  6. Reclassify every record (existing + new) against my-issue-features.json.
  7. Validate the rebuilt index comprehensively.
  8. Atomically publish my-issues.json + my-issues.md only if validation passes.
  9. Advance the refresh manifest only after publication succeeds.

Preserves: triageOutcome, relatedReferences, canonicalReferences, analysis (for
unchanged records), and any unknown/extra fields already present on a record.
"""
import json, os, re, subprocess, sys, time, datetime, tempfile, shutil, hashlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from my_work_config import BOARD as BOARD_DIR, CACHE_DIR, ORG, SWEEPER_REPO, login  # noqa: E402

ASSIGNEE = login()
CONFIG_PATH = os.path.join(BOARD_DIR, "my-issue-features.json")
INDEX_PATH = os.path.join(BOARD_DIR, "my-issues.json")
MD_PATH = os.path.join(BOARD_DIR, "my-issues.md")
MANIFEST_PATH = os.path.join(BOARD_DIR, "my-issues-refresh-manifest.json")
OUTCOMES_PATH = os.path.join(BOARD_DIR, "my-issue-outcomes.json")
INVENTORY_CACHE = os.path.join(CACHE_DIR, "inventory-cache.json")

def now_iso():
    return datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


START_NOW = now_iso()
NOW = START_NOW  # refreshed to END_NOW right before publish
TODAY = datetime.date.today().isoformat()


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"cmd failed: {cmd}\n{r.stderr}")
    return r.stdout


def gh_graphql(query, variables):
    args = ["gh", "api", "graphql", "-f", f"query={query}"]
    for k, v in variables.items():
        args += ["-f", f"{k}={v}"]
    out = subprocess.run(args, capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(out.stderr)
    return json.loads(out.stdout)


COUNT_Q = """
query($q:String!){
  search(query:$q, type:ISSUE, first:1){ issueCount }
  rateLimit{ cost remaining }
}
"""

PAGE_Q_FIRST = """
query($q:String!){
  search(query:$q, type:ISSUE, first:100){
    issueCount
    pageInfo{ hasNextPage endCursor }
    nodes{ ... on Issue{ number state updatedAt repository{ nameWithOwner } } }
  }
}
"""

PAGE_Q_NEXT = """
query($q:String!,$cursor:String!){
  search(query:$q, type:ISSUE, first:100, after:$cursor){
    issueCount
    pageInfo{ hasNextPage endCursor }
    nodes{ ... on Issue{ number state updatedAt repository{ nameWithOwner } } }
  }
}
"""


def search_query(start, end):
    return f"org:{ORG} assignee:{ASSIGNEE} is:issue created:{start}..{end}"


def count_for(start, end):
    r = gh_graphql(COUNT_Q, {"q": search_query(start, end)})
    return r["data"]["search"]["issueCount"]


def bisect_partition(start, end, cap=900):
    cnt = count_for(start, end)
    if cnt <= cap or start == end:
        return [(start, end, cnt)]
    d1 = datetime.date.fromisoformat(start)
    d2 = datetime.date.fromisoformat(end)
    mid = d1 + (d2 - d1) // 2
    if mid == d1:
        return [(start, end, cnt)]
    left = bisect_partition(start, mid.isoformat(), cap)
    right_start_d = mid + datetime.timedelta(days=1)
    if right_start_d.isoformat() > end:
        return left
    right = bisect_partition(right_start_d.isoformat(), end, cap)
    return left + right


def fetch_partition_nodes(start, end):
    q = search_query(start, end)
    nodes = []
    r = gh_graphql(PAGE_Q_FIRST, {"q": q})
    data = r["data"]["search"]
    nodes.extend(data["nodes"])
    cursor = data["pageInfo"]["endCursor"]
    has_next = data["pageInfo"]["hasNextPage"]
    while has_next:
        r = gh_graphql(PAGE_Q_NEXT, {"q": q, "cursor": cursor})
        data = r["data"]["search"]
        nodes.extend(data["nodes"])
        cursor = data["pageInfo"]["endCursor"]
        has_next = data["pageInfo"]["hasNextPage"]
    return nodes


def build_inventory(prev_partitions):
    # Reuse previous partition boundaries, extend the last partition's end to today.
    candidates = [(p["start"], p["end"]) for p in prev_partitions]
    if candidates:
        candidates[-1] = (candidates[-1][0], TODAY)
    else:
        candidates = [("2008-01-01", TODAY)]

    final_partitions = []
    for start, end in candidates:
        final_partitions.extend(bisect_partition(start, end))

    inventory = {}
    partition_report = []
    for start, end, cnt in final_partitions:
        if cnt == 0:
            partition_report.append({"start": start, "end": end, "count": 0})
            continue
        nodes = fetch_partition_nodes(start, end)
        for n in nodes:
            repo = n["repository"]["nameWithOwner"]
            key = f"{repo}#{n['number']}"
            inventory[key] = {
                "repository": repo,
                "number": n["number"],
                "state": n["state"].lower(),
                "updatedAt": n["updatedAt"],
            }
        partition_report.append({"start": start, "end": end, "count": len(nodes)})
    return inventory, partition_report


def rest_get(path):
    r = subprocess.run(["gh", "api", path], capture_output=True, text=True)
    return r.returncode, r.stdout, r.stderr


def fetch_full_issue(repo, number):
    code, out, err = rest_get(f"repos/{repo}/issues/{number}")
    if code != 0:
        return None, err
    d = json.loads(out)
    return d, None


def clean_body_summary(body, max_len=320):
    if not body:
        return ""
    b = re.sub(r"<!--.*?-->", "", body, flags=re.S)
    b = re.sub(r"\r\n", "\n", b)
    b = re.sub(r"[#>*_`]+", "", b)
    b = re.sub(r"\s+", " ", b).strip()
    return b[:max_len].strip() + ("..." if len(b) > max_len else "")


def reproduction_evidence(body):
    b = (body or "")
    lb = b.lower()
    has_steps = bool(re.search(r"(?im)^\s*(\d+[.)]|[-*])\s+\S", b)) or "steps to reproduce" in lb
    has_visual = "![" in b or "screenshot" in lb or "recording" in lb
    has_logs = "```" in b or "log" in lb
    return {"hasSteps": has_steps, "hasVisualEvidence": has_visual, "hasLogs": has_logs}


def parse_frontmatter(text):
    m = re.match(r"^---\n(.*?)\n---\n", text, flags=re.S)
    if not m:
        return {}
    fm = {}
    for line in m.group(1).split("\n"):
        if not line.strip() or ":" not in line:
            continue
        k, v = line.split(":", 1)
        k = k.strip()
        v = v.strip().strip('"')
        fm[k] = v
    return fm


def sweeper_batch_lookup(numbers, commit):
    """Read many Sweeper records in one `git cat-file --batch` call (read-only, no checkout)."""
    numbers = sorted(set(numbers))
    if not numbers:
        return {}
    paths = {n: f"records/microsoft/vscode/items/{n}.md" for n in numbers}
    stdin = "".join(f"{commit}:{paths[n]}\n" for n in numbers).encode()
    # Feed stdin from a file: piping a large `input=` while capturing output can hang (seen on Python 3.14).
    with tempfile.TemporaryFile() as f:
        f.write(stdin)
        f.seek(0)
        r = subprocess.run(["git", "-C", SWEEPER_REPO, "cat-file", "--batch"],
                           stdin=f, capture_output=True, timeout=300)
    if r.returncode != 0:
        raise RuntimeError(f"git cat-file failed: {r.stderr.decode(errors='replace')}")
    out, pos, result = r.stdout, 0, {}
    for n in numbers:
        nl = out.index(b"\n", pos)
        header = out[pos:nl].decode(errors="replace").split()
        pos = nl + 1
        if len(header) == 3 and header[1] == "blob":
            size = int(header[2])
            text = out[pos:pos + size].decode("utf-8", errors="replace")
            pos += size + 1
            enrichment = sweeper_from_text(text, commit, paths[n])
            if enrichment:
                result[n] = enrichment
        # "<object> missing" lines carry no body
    return result


SWEEPER_CHANGE_FIELDS = ("reviewedAt", "contentHash", "policyHash", "triageAction")


def body_field(text, name):
    m = re.search(r"^- \*\*" + re.escape(name) + r":\*\* (.+)$", text, re.M)
    return m.group(1).strip() if m else None


def duplicate_of(text):
    m = re.search(r"/duplicate of #(\d+)", text)
    return int(m.group(1)) if m else None


def sweeper_from_text(text, commit, path):
    fm = parse_frontmatter(text)
    if not fm:
        return None
    fixed = body_field(text, "Fixed by") or ""
    m = re.match(r"`([0-9a-f]{7,40})`.*?(?:shipped in ([\w.\-]+))?$", fixed)
    fixed_by = (m.group(1), m.group(2)) if m else (None, None)

    def none_or(v):
        return None if v in (None, "", "none") else v

    def as_float(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    def as_int(v):
        try:
            return int(v)
        except (TypeError, ValueError):
            return None

    return {
        "sourceCommit": commit,
        "sourceRef": "origin/state",
        "sourcePath": path,
        "engine": fm.get("engine"),
        "owner": fm.get("owner"),
        "labels": fm.get("labels"),
        "proposedLabel": none_or(fm.get("proposedLabel")),
        "triageAction": fm.get("triageAction"),
        "confidence": as_float(fm.get("confidence")),
        "severity": none_or(fm.get("severity")),
        "breadth": fm.get("breadth"),
        "priority": none_or(fm.get("priority")),
        "visionFit": fm.get("visionFit"),
        "autoFixable": fm.get("autoFixable") == "true",
        "agentReadiness": none_or(fm.get("agentReadiness")),
        "closeReason": none_or(fm.get("closeReason")),
        "itemType": body_field(text, "Item type"),
        "fixedByCommit": fixed_by[0],
        "shippedIn": fixed_by[1],
        "duplicateOf": duplicate_of(text),
        "hasProposedComment": "**Proposed comment:**" in text,
        "reviewedAt": fm.get("reviewedAt"),
        "itemUpdatedAt": fm.get("itemUpdatedAt"),
        "itemCreatedAt": fm.get("itemCreatedAt"),
        "upvotes": as_int(fm.get("upvotes")),
        "reactionsTotal": as_int(fm.get("reactionsTotal")),
        "commentCount": as_int(fm.get("commentCount")),
        "relatedOpenIssues": as_int(fm.get("relatedOpenIssues")),
        "milestone": fm.get("milestone"),
        "contentHash": fm.get("contentHash"),
        "policyHash": fm.get("policyHash"),
    }


def classify(labels, key, config):
    labelset = set(labels or [])
    override = config.get("overrides", {}).get(key)
    matches = [a for a in config["featureAreas"] if labelset & set(a["labels"])]
    matches.sort(key=lambda a: -a["priority"])
    matching_ids = [a["id"] for a in matches]
    if override:
        primary = override
    elif matches:
        primary = matches[0]["id"]
    else:
        primary = config["fallbackArea"]["id"]
    return primary, matching_ids


# --- Automatic feature areas from GitHub feature labels -------------------------------
# In microsoft/vscode, feature-area labels share one colour (#c5def5); type/workflow labels
# (bug, debt, info-needed, stale, ...) use other colours. Every such label found on an open
# issue gets its own area (marked "auto"), ranked below user-defined areas, and is kept in
# my-issue-features.json from then on. Users can rename/re-prioritise them, or list labels in
# "ignoredAutoLabels" to stop them being (re)added.
FEATURE_LABEL_COLORS = {"microsoft/vscode": {"c5def5"}}
NOT_FEATURE_LABELS = {"perf"}
AUTO_AREA_PRIORITY = 10
ACRONYMS = {"mcp", "lm", "ai", "api", "ui", "ux", "scm", "wsl", "ssh", "json", "css", "html", "md", "ts", "js",
            "gpu", "cli", "os", "url", "otel", "lsp", "dap", "npm", "sdk", "pr", "prs", "id", "vs"}


def humanize_label(label):
    words = re.split(r"[-_\s]+", label)
    return " ".join(w.upper() if w.lower() in ACRONYMS else (w[:1].upper() + w[1:]) for w in words if w)


def repo_label_colors(repo):
    path = os.path.join(CACHE_DIR, f"labels-{repo.replace('/', '__')}.json")
    try:
        if time.time() - os.path.getmtime(path) < 86400:
            with open(path) as f:
                return json.load(f)
    except OSError:
        pass
    out = run(["gh", "api", f"repos/{repo}/labels", "--paginate", "--jq", ".[] | [.name, .color]"])
    colors = {}
    for line in out.splitlines():
        if line.strip():
            name, color = json.loads(line)
            colors[name] = (color or "").lower()
    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(path, "w") as f:
        json.dump(colors, f)
    return colors


def discover_auto_areas(config, issues):
    """Add an auto area for every feature label on an open issue that no area covers yet. Returns the new areas."""
    covered = {l for a in config["featureAreas"] for l in a["labels"]}
    ignored = set(config.get("ignoredAutoLabels", []))
    taken_ids = {a["id"] for a in config["featureAreas"]} | {config["fallbackArea"]["id"]}
    counts = {}
    for r in issues.values():
        if r.get("state") != "open" or r.get("repository") not in FEATURE_LABEL_COLORS:
            continue
        try:
            colors = repo_label_colors(r["repository"])
        except Exception as e:  # label catalog unavailable: skip discovery this run
            print(f"  label discovery skipped for {r['repository']}: {e}", file=sys.stderr)
            continue
        feature_colors = FEATURE_LABEL_COLORS[r["repository"]]
        for l in r.get("labels", []):
            if l in covered or l in ignored or l in NOT_FEATURE_LABELS or colors.get(l) not in feature_colors:
                continue
            counts[l] = counts.get(l, 0) + 1
    new = []
    for label, _n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])):
        aid = re.sub(r"[^a-z0-9-]+", "-", label.lower()).strip("-") or "label"
        while aid in taken_ids:
            aid += "-label"
        taken_ids.add(aid)
        new.append({"id": aid, "name": humanize_label(label), "labels": [label], "priority": AUTO_AREA_PRIORITY,
                    "auto": True, "discoveredAt": NOW})
    if new:
        config["featureAreas"].extend(new)
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(CONFIG_PATH), prefix=".tmp-", suffix=".json")
        with os.fdopen(fd, "w") as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
        os.replace(tmp, CONFIG_PATH)
    return new


def area_summary(config, issues):
    area_meta = {a["id"]: a for a in config["featureAreas"]}
    area_meta[config["fallbackArea"]["id"]] = {"id": config["fallbackArea"]["id"], "name": config["fallbackArea"]["name"], "priority": -1}
    order = [a["id"] for a in sorted(config["featureAreas"], key=lambda a: -a["priority"])] + [config["fallbackArea"]["id"]]
    out = []
    for aid in order:
        recs = [r for r in issues.values() if r["primaryFeatureArea"] == aid]
        o = sum(1 for r in recs if r["state"] == "open")
        out.append({"id": aid, "name": area_meta[aid]["name"], "priority": area_meta[aid].get("priority", -1),
                    "auto": bool(area_meta[aid].get("auto")), "count": len(recs), "open": o, "closed": len(recs) - o})
    return out, area_meta


def render_md(issues, counts, feature_areas_out, now):
    lines = ["# My Microsoft Issues\n", f"Refreshed: {now}\n",
             f"**Total:** {counts['total']} | **Open:** {counts['open']} | "
             f"**Closed:** {counts['closed']} | **Departed:** {counts['departed']}\n"]
    for area in feature_areas_out:
        aid = area["id"]
        recs = [r for r in issues.values() if r["primaryFeatureArea"] == aid]
        if not recs:
            continue
        lines.append(f"## {area['name']}\n")
        lines.append(f"{area['count']} issues ({area['open']} open, {area['closed']} closed).\n")
        lines.append("| State | Updated | Issue | Repository | Labels | Milestone |")
        lines.append("| --- | --- | --- | --- | --- | --- |")
        opens = sorted([r for r in recs if r["state"] == "open"], key=lambda r: r["updatedAt"], reverse=True)
        closeds = sorted([r for r in recs if r["state"] != "open"], key=lambda r: r["updatedAt"], reverse=True)
        for r in opens + closeds:
            title = r["title"].replace("|", "-").replace("[", "(").replace("]", ")")
            lines.append(f"| {'Open' if r['state'] == 'open' else 'Closed'} | {r['updatedAt'][:10]} | [{title}]({r['url']}) | "
                         f"`{r['repository']}` | {', '.join(r.get('labels', []))} | {r.get('milestone') or '-'} |")
        lines.append("")
    return "\n".join(lines) + "\n"


def reclassify_only():
    """Discover auto areas and reclassify the existing index in place, without touching GitHub inventory,
    Sweeper data, refreshedAt or the refresh manifest (so the daily queue baseline is unchanged)."""
    with open(CONFIG_PATH) as f:
        config = json.load(f)
    with open(INDEX_PATH) as f:
        index = json.load(f)
    issues, departed = index["issues"], index.get("departedIssues", {})
    new = discover_auto_areas(config, issues)
    moved = {}
    for coll in (issues, departed):
        for k, rec in coll.items():
            primary, matching = classify(rec.get("labels", []), k, config)
            if coll is issues and rec.get("primaryFeatureArea") != primary:
                moved[f"{rec.get('primaryFeatureArea')} -> {primary}"] = moved.get(f"{rec.get('primaryFeatureArea')} -> {primary}", 0) + 1
            rec["primaryFeatureArea"] = primary
            rec["matchingFeatureAreas"] = matching
    feature_areas_out, area_meta = area_summary(config, issues)
    valid = set(area_meta)
    if not all(r["primaryFeatureArea"] in valid and set(r.get("matchingFeatureAreas", [])) <= valid for r in issues.values()):
        print("VALIDATION FAILED — not publishing.", file=sys.stderr)
        sys.exit(1)
    if not all(issues[k]["primaryFeatureArea"] == v for k, v in config.get("overrides", {}).items() if k in issues):
        print("VALIDATION FAILED (overrides) — not publishing.", file=sys.stderr)
        sys.exit(1)
    index["featureAreas"] = feature_areas_out
    index["featureConfigurationHash"] = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(INDEX_PATH), prefix=".tmp-", suffix=".json")
    with os.fdopen(fd, "w") as f:
        json.dump(index, f, indent=2, ensure_ascii=False)
    os.replace(tmp, INDEX_PATH)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(MD_PATH), prefix=".tmp-", suffix=".md")
    with os.fdopen(fd, "w") as f:
        f.write(render_md(issues, index["counts"], feature_areas_out, index.get("refreshedAt")))
    os.replace(tmp, MD_PATH)
    print(json.dumps({"newAutoAreas": [a["name"] for a in new], "moved": moved,
                      "openPerArea": {a["name"]: a["open"] for a in feature_areas_out if a["open"]}}, indent=1))


def write_json_atomic(path, obj):
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".tmp-", suffix=".json")
    with os.fdopen(fd, "w") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)


STATUS_PATH = os.path.join(BOARD_DIR, "my-issues-refresh-status.json")
_status = {}
_status_written = 0.0


def status(phase=None, done=None, total=None, state="running", error=None, force=False):
    """Publish refresh progress for the My Work canvas (throttled; atomic)."""
    global _status_written
    if phase is not None and phase != _status.get("phase"):
        force = True
    _status.update({"state": state, "pid": os.getpid(), "updatedAt": now_iso()})
    _status.setdefault("startedAt", _status["updatedAt"])
    _status["firstRun"] = _status.get("firstRun", not os.path.exists(INDEX_PATH))
    if phase is not None:
        _status["phase"] = phase
    _status["done"], _status["total"] = done, total
    if error is not None:
        _status["error"] = str(error)[:500]
    if not force and time.time() - _status_written < 2:
        return
    _status_written = time.time()
    try:
        os.makedirs(BOARD_DIR, exist_ok=True)
        write_json_atomic(STATUS_PATH, _status)
    except OSError:
        pass


def bootstrap():
    """First run: create an empty feature configuration, index and manifest so the incremental refresh can start."""
    os.makedirs(BOARD_DIR, exist_ok=True)
    os.makedirs(CACHE_DIR, exist_ok=True)
    if not os.path.exists(CONFIG_PATH):
        # Feature areas are discovered from GitHub feature labels; add your own (with higher priority) later.
        write_json_atomic(CONFIG_PATH, {"schemaVersion": 1, "featureAreas": [],
                                        "fallbackArea": {"id": "others", "name": "Others"}, "overrides": {}})
    if not os.path.exists(INDEX_PATH):
        write_json_atomic(INDEX_PATH, {"schemaVersion": 1, "refreshedAt": None, "scope": {"org": ORG, "assignee": ASSIGNEE},
                                       "issues": {}, "departedIssues": {}, "counts": {}, "featureAreas": [],
                                       "sourceCheckpoints": {"github": {"partitions": []}}})
    if not os.path.exists(MANIFEST_PATH):
        write_json_atomic(MANIFEST_PATH, {})


def main():
    if not ASSIGNEE:
        sys.exit("Cannot tell whose issues to index: sign in with `gh auth login` or set \"login\" in my-work.config.json.")
    bootstrap()
    with open(CONFIG_PATH) as f:
        config = json.load(f)
    with open(INDEX_PATH) as f:
        index = json.load(f)
    with open(MANIFEST_PATH) as f:
        manifest = json.load(f)

    issues = index["issues"]
    departed = index["departedIssues"]
    issues_before = {k: dict(v) for k, v in issues.items()}
    prev_partitions = index["sourceCheckpoints"]["github"]["partitions"]

    status("Finding your issues on GitHub")
    print("== Building inventory (adaptive partitions) ==", file=sys.stderr)
    inventory, partition_report = build_inventory(prev_partitions)
    with open(INVENTORY_CACHE, "w") as f:
        json.dump({"inventory": inventory, "partitions": partition_report}, f)
    print(f"inventory size={len(inventory)}", file=sys.stderr)

    global NOW
    NOW = now_iso()

    inv_keys = set(inventory.keys())
    existing_keys = set(issues.keys())
    departed_keys = set(departed.keys())

    added_keys = inv_keys - existing_keys - departed_keys
    restored_keys = inv_keys & departed_keys
    present_keys = inv_keys & existing_keys
    changed_keys = {k for k in present_keys if issues[k]["updatedAt"] != inventory[k]["updatedAt"]}
    unchanged_keys = present_keys - changed_keys
    missing_keys = existing_keys - inv_keys  # need verification

    print(f"added={len(added_keys)} restored={len(restored_keys)} changed={len(changed_keys)} "
          f"unchanged={len(unchanged_keys)} missing_to_verify={len(missing_keys)}", file=sys.stderr)

    # --- Verify missing keys directly against GitHub ---
    removed_unassigned = []
    deleted_or_transferred = []
    anomalies_kept = []
    for i, k in enumerate(sorted(missing_keys)):
        status("Checking issues no longer assigned", i, len(missing_keys))
        rec = issues[k]
        repo, number = rec["repository"], rec["number"]
        full, err = fetch_full_issue(repo, number)
        if full is None:
            deleted_or_transferred.append(k)
            continue
        assignee_logins = [a["login"] for a in full.get("assignees", [])]
        if ASSIGNEE not in assignee_logins:
            removed_unassigned.append(k)
        else:
            anomalies_kept.append(k)
            # keep it, refresh minimal fields so it doesn't look stale
            rec["updatedAt"] = full["updated_at"]
            rec["state"] = full["state"]
            rec["stateReason"] = full.get("state_reason")

    # --- Fetch full metadata for added/restored/changed ---
    need_full = sorted(added_keys | restored_keys | changed_keys)
    full_meta = {}
    for i, k in enumerate(need_full):
        status("Fetching new and changed issues", i, len(need_full))
        rec_hint = inventory.get(k) or issues.get(k) or departed.get(k)
        repo, number = rec_hint["repository"], rec_hint["number"]
        full, err = fetch_full_issue(repo, number)
        if full is None:
            print(f"WARN: could not fetch {k}: {err}", file=sys.stderr)
            continue
        full_meta[k] = full

    sweeper_new_commit = None
    if SWEEPER_REPO and os.path.isdir(SWEEPER_REPO):
        status("Reading Sweeper proposals")
    try:
        run(["git", "-C", SWEEPER_REPO, "fetch", "origin", "state"])
        sweeper_new_commit = run(["git", "-C", SWEEPER_REPO, "rev-parse", "origin/state"]).strip()
    except Exception as e:
        print(f"WARN: sweeper fetch failed: {e}", file=sys.stderr)

    sweeper_from_commit = manifest.get("sweeper", {}).get("toCommit")

    feature_movements = []

    def rest_to_record(k, repo, number, full, prior):
        labels = [l["name"] for l in full.get("labels", [])]
        assignees = [a["login"] for a in full.get("assignees", [])]
        primary, matching = classify(labels, k, config)
        body = full.get("body") or ""
        analysis = {
            "summary": clean_body_summary(body),
            "reproductionEvidence": reproduction_evidence(body),
            "analyzedAt": NOW,
            "sourceUpdatedAt": full["updated_at"],
        }
        rec = {
            "repository": repo,
            "number": number,
            "url": full["html_url"],
            "title": full["title"],
            "state": full["state"],
            "stateReason": full.get("state_reason"),
            "author": (full.get("user") or {}).get("login"),
            "labels": labels,
            "assignees": assignees,
            "milestone": (full.get("milestone") or {}).get("title"),
            "issueType": (full.get("type") or {}).get("name") if isinstance(full.get("type"), dict) else full.get("type"),
            "createdAt": full["created_at"],
            "updatedAt": full["updated_at"],
            "closedAt": full.get("closed_at"),
            "indexStatus": "assigned",
            "analysis": analysis,
            "relatedReferences": prior.get("relatedReferences", []) if prior else [],
            "canonicalReferences": prior.get("canonicalReferences", []) if prior else [],
            "triageOutcome": prior.get("triageOutcome") if prior else None,
            "matchingFeatureAreas": matching,
            "primaryFeatureArea": primary,
            "sweeper": prior.get("sweeper") if prior else None,
        }
        return rec

    added_count = 0
    added_list, updated_list = [], []
    updated_count = 0
    restored_count = 0
    sweeper_enriched = 0

    for k in need_full:
        if k not in full_meta:
            continue
        full = full_meta[k]
        repo = full["repository_url"].split("/repos/")[-1]
        number = full["number"]
        prior = issues.get(k) or departed.get(k)
        rec = rest_to_record(k, repo, number, full, prior)

        prev_primary = prior.get("primaryFeatureArea") if prior else None
        if prior is not None and prev_primary != rec["primaryFeatureArea"]:
            feature_movements.append({"key": k, "from": prev_primary, "to": rec["primaryFeatureArea"]})

        if k in added_keys:
            issues[k] = rec
            added_count += 1
            added_list.append(k)
        elif k in restored_keys:
            departed.pop(k, None)
            issues[k] = rec
            restored_count += 1
            added_list.append(k)
        else:
            issues[k] = rec
            updated_count += 1
            updated_list.append(k)

    # --- Sweeper refresh, independent of GitHub changes ---
    # Sweeper re-reviews issues on its own schedule, so compare every open microsoft/vscode
    # issue (plus any record already enriched) against the current origin/state record and
    # refresh only when the upstream review changed. Scope is bounded to keep the index small.
    sweeper_refreshed = 0
    sweeper_action_changes = []
    sweeper_refresh_error = None
    if sweeper_new_commit:
        candidates = {
            k: r for k, r in issues.items()
            if r["repository"] == "microsoft/vscode" and (r["state"] == "open" or r.get("sweeper"))
        }
        try:
            upstream = sweeper_batch_lookup([r["number"] for r in candidates.values()], sweeper_new_commit)
        except Exception as e:
            upstream = {}
            sweeper_refresh_error = str(e)
            print(f"WARN: sweeper batch refresh failed: {e}", file=sys.stderr)
        for k, rec in candidates.items():
            new = upstream.get(rec["number"])
            if not new:
                continue
            old = rec.get("sweeper") or {}
            # A changed key set means the stored schema is older; refresh to backfill new fields.
            if set(old) == set(new) and all(old.get(f) == new.get(f) for f in SWEEPER_CHANGE_FIELDS):
                continue
            if old.get("triageAction") != new.get("triageAction"):
                sweeper_action_changes.append({
                    "key": k, "from": old.get("triageAction"), "to": new.get("triageAction"),
                })
            if not old and k in need_full:
                sweeper_enriched += 1
            rec["sweeper"] = new
            sweeper_refreshed += 1
        print(f"sweeper: candidates={len(candidates)} upstream={len(upstream)} "
              f"refreshed={sweeper_refreshed} actionChanges={len(sweeper_action_changes)}", file=sys.stderr)

    # --- Apply user-owned triage decisions (written by the my-issues skill) ---
    # Read late so a decision recorded while this refresh was running is not lost.
    user_outcomes = {}
    if os.path.exists(OUTCOMES_PATH):
        with open(OUTCOMES_PATH) as f:
            user_outcomes = json.load(f).get("outcomes", {})
    for k, outcome in user_outcomes.items():
        target = issues.get(k) or departed.get(k)
        if target is not None:
            target["triageOutcome"] = outcome

    # --- Move unassigned/deleted issues to departed ---
    for k in removed_unassigned:
        rec = issues.pop(k)
        rec["indexStatus"] = "unassigned"
        rec["departedAt"] = NOW
        rec["lastVerifiedAt"] = NOW
        rec["lastKnownUrl"] = rec.get("url")
        departed[k] = rec
    for k in deleted_or_transferred:
        rec = issues.pop(k)
        rec["indexStatus"] = "deleted-or-transferred"
        rec["departedAt"] = NOW
        rec["lastVerifiedAt"] = NOW
        rec["lastKnownUrl"] = rec.get("url")
        departed[k] = rec

    # --- Reclassify every remaining record (config-idempotent; catches config edits) ---
    auto_areas_added = discover_auto_areas(config, issues)
    for k, rec in issues.items():
        if isinstance(rec.get("milestone"), dict):
            rec["milestone"] = rec["milestone"].get("title")
        primary, matching = classify(rec.get("labels", []), k, config)
        if rec.get("primaryFeatureArea") != primary:
            feature_movements.append({"key": k, "from": rec.get("primaryFeatureArea"), "to": primary})
        rec["primaryFeatureArea"] = primary
        rec["matchingFeatureAreas"] = matching
    for k, rec in departed.items():
        if isinstance(rec.get("milestone"), dict):
            rec["milestone"] = rec["milestone"].get("title")
        primary, matching = classify(rec.get("labels", []), k, config)
        rec["primaryFeatureArea"] = primary
        rec["matchingFeatureAreas"] = matching

    # --- Recompute counts & featureAreas summary ---
    total = len(issues)
    open_count = sum(1 for r in issues.values() if r["state"] == "open")
    closed_count = total - open_count
    counts = {"total": total, "open": open_count, "closed": closed_count, "departed": len(departed)}

    feature_areas_out, area_meta = area_summary(config, issues)

    index["issues"] = issues
    index["departedIssues"] = departed
    index["counts"] = counts
    index["featureAreas"] = feature_areas_out
    index["refreshedAt"] = NOW
    index["featureConfigurationHash"] = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()
    index["featureConfiguration"] = CONFIG_PATH
    index["sourceCheckpoints"]["github"] = {
        "query": f"org:{ORG} assignee:{ASSIGNEE} is:issue",
        "inventoryCompletedAt": NOW,
        "inventoryCount": len(inventory),
        "rawSearchCount": len(inventory),
        "partitions": partition_report,
    }
    index["sourceCheckpoints"]["sweeper"] = {
        "repository": "egamma/vscodesweeper-state",
        "ref": "origin/state",
        "commit": sweeper_new_commit or sweeper_from_commit,
        "fetchedAt": NOW,
    }

    # ================= VALIDATION =================
    checks = {}
    all_keys = list(issues.keys()) + list(departed.keys())
    checks["uniqueKeys"] = len(all_keys) == len(set(all_keys))
    checks["activeDepartedDisjoint"] = len(set(issues.keys()) & set(departed.keys())) == 0
    checks["exactlyOnePrimaryFeatureArea"] = all(
        isinstance(r.get("primaryFeatureArea"), str) and r.get("primaryFeatureArea") for r in issues.values()
    )
    valid_ids = set(area_meta.keys())
    checks["matchingFeatureAreasExist"] = all(
        r["primaryFeatureArea"] in valid_ids and set(r.get("matchingFeatureAreas", [])) <= valid_ids
        for r in issues.values()
    )
    checks["aggregateCountsReconcile"] = (
        counts["total"] == len(issues) and counts["open"] + counts["closed"] == counts["total"]
        and counts["departed"] == len(departed)
    )
    checks["inventoryCountsReconcile"] = (
        index["sourceCheckpoints"]["github"]["inventoryCount"] == len(inventory) == counts["total"]
    )
    checks["recordKeysMatchIdentity"] = all(
        k == f"{r['repository']}#{r['number']}" for k, r in list(issues.items()) + list(departed.items())
    )
    all_valid_keys = set(issues.keys()) | set(departed.keys())
    ref_ok = True
    for r in issues.values():
        for ref in r.get("relatedReferences", []) + r.get("canonicalReferences", []):
            if ref.get("key") not in all_valid_keys:
                # external/unknown reference (e.g. issue outside our assigned scope) is allowed;
                # only flag malformed key shape
                if "#" not in (ref.get("key") or ""):
                    ref_ok = False
    checks["referencesValid"] = ref_ok
    checks["explicitOutcomesPreserved"] = all(
        issues[k].get("triageOutcome") == user_outcomes.get(k, issues_before.get(k, {}).get("triageOutcome"))
        for k in unchanged_keys
    ) and all(
        (issues.get(k) or departed.get(k) or {}).get("triageOutcome") == v
        for k, v in user_outcomes.items() if k in issues or k in departed
    )
    checks["notificationPoliciesPreserved"] = True  # no notificationPolicy field in current schema
    checks["canonicalRelationshipsPreserved"] = all(
        issues[k].get("canonicalReferences") == issues_before.get(k, {}).get("canonicalReferences")
        for k in unchanged_keys
    )
    checks["overridesPreserved"] = all(
        issues[k]["primaryFeatureArea"] == v for k, v in config.get("overrides", {}).items() if k in issues
    )
    checks["compactMilestones"] = all(
        r.get("milestone") is None or isinstance(r.get("milestone"), str)
        for r in list(issues.values()) + list(departed.values())
    )
    known_issue_fields = {
        "repository", "number", "url", "title", "state", "stateReason", "author", "labels",
        "assignees", "milestone", "issueType", "createdAt", "updatedAt", "closedAt", "indexStatus",
        "analysis", "relatedReferences", "canonicalReferences", "triageOutcome",
        "matchingFeatureAreas", "primaryFeatureArea", "sweeper",
    }
    known_departed_fields = known_issue_fields | {"departedAt", "lastVerifiedAt", "lastKnownUrl"}
    checks["compactRecordsOnly"] = (
        all(set(r.keys()) <= known_issue_fields for r in issues.values())
        and all(set(r.keys()) <= known_departed_fields for r in departed.values())
    )

    validation_passed = all(checks.values())
    status("Validating and publishing")
    print("== Validation ==", file=sys.stderr)
    for k, v in checks.items():
        print(f"  {k}: {v}", file=sys.stderr)

    result_summary = {
        "counts": counts,
        "added": added_count,
        "updated": updated_count,
        "restored": restored_count,
        "unchanged": len(unchanged_keys),
        "removedUnassigned": len(removed_unassigned),
        "deletedOrTransferred": len(deleted_or_transferred),
        "anomaliesKept": len(anomalies_kept),
        "sweeperEnriched": sweeper_enriched,
        "sweeperRefreshed": sweeper_refreshed,
        "sweeperActionChanges": sweeper_action_changes,
        "featureMovements": feature_movements,
        "autoAreasAdded": [a["name"] for a in auto_areas_added],
        "featureAreas": feature_areas_out,
        "validation": checks,
        "validationPassed": validation_passed,
        "sweeperFromCommit": sweeper_from_commit,
        "sweeperToCommit": sweeper_new_commit,
        "removedUnassignedKeys": removed_unassigned,
        "deletedOrTransferredKeys": deleted_or_transferred,
        "anomaliesKeptKeys": anomalies_kept,
    }

    if not validation_passed:
        print("VALIDATION FAILED — not publishing.", file=sys.stderr)
        with open(os.path.join(CACHE_DIR, "refresh-result-FAILED.json"), "w") as f:
            json.dump(result_summary, f, indent=2)
        print(json.dumps(result_summary, indent=2))
        sys.exit(1)

    # ================= PUBLISH (atomic) =================
    def atomic_write_json(path, obj):
        d = os.path.dirname(path)
        fd, tmp = tempfile.mkstemp(dir=d, prefix=".tmp-", suffix=".json")
        with os.fdopen(fd, "w") as f:
            json.dump(obj, f, indent=2, ensure_ascii=False)
        os.replace(tmp, path)

    atomic_write_json(INDEX_PATH, index)
    d = os.path.dirname(MD_PATH)
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".tmp-", suffix=".md")
    with os.fdopen(fd, "w") as f:
        f.write(render_md(issues, counts, feature_areas_out, NOW))
    os.replace(tmp, MD_PATH)

    # ================= ADVANCE MANIFEST =================
    new_manifest = {
        "schemaVersion": 1,
        "startedAt": START_NOW,
        "completedAt": NOW,
        "refreshedAt": NOW,
        "previousRefreshAt": manifest.get("refreshedAt"),
        "github": {
            "inventoryCount": len(inventory),
            "rawSearchCount": len(inventory),
            "added": added_count,
            "updated": updated_count,
            "unchanged": len(unchanged_keys),
            "unassigned": len(removed_unassigned),
            "transferred": 0,
            "deleted": len(deleted_or_transferred),
            "unavailable": 0,
            "removedOrUnassigned": len(removed_unassigned) + len(deleted_or_transferred),
            "restored": restored_count,
            "addedKeys": sorted(added_list),
            "updatedKeys": sorted(updated_list),
        },
        "featureMovements": feature_movements,
        "sweeper": {
            "fromCommit": sweeper_from_commit,
            "toCommit": sweeper_new_commit or sweeper_from_commit,
            "enrichedChangedIssues": sweeper_enriched,
            "refreshed": sweeper_refreshed,
            "triageActionChanges": sweeper_action_changes,
        },
        "failures": [{"stage": "sweeper-refresh", "error": sweeper_refresh_error}] if sweeper_refresh_error else [],
        "validation": {"status": "passed", "checks": checks},
        "publishedPaths": {
            "featureConfiguration": CONFIG_PATH,
            "sourceOfTruth": INDEX_PATH,
            "summary": MD_PATH,
            "manifest": MANIFEST_PATH,
        },
    }
    atomic_write_json(MANIFEST_PATH, new_manifest)

    with open(os.path.join(CACHE_DIR, "refresh-result.json"), "w") as f:
        json.dump(result_summary, f, indent=2)
    print(json.dumps(result_summary, indent=2))


if __name__ == "__main__":
    if "--reclassify-only" in sys.argv:
        reclassify_only()
    else:
        status("Starting", force=True)
        try:
            main()
        except SystemExit as e:
            if e.code not in (None, 0):
                status(state="failed", error=e.code if isinstance(e.code, str) else "refresh failed", force=True)
                raise
            status(state="done", force=True)
        except BaseException as e:
            status(state="failed", error=e, force=True)
            raise
        else:
            status(state="done", force=True)
