"""Read-only access to the VS Code Sweeper's published data, shared by refresh_my_issues.py and my_issues.py.

Two sources, as documented by the vscode repo's sweeper-query skill (.github/skills/sweeper-query, section 6):
- The published index `index-vscode.json` on the state repo's `main` branch: one row per issue with the verdict,
  readiness, value score and lifecycle stamps. Cached, re-downloaded only when its latest commit changes.
- One review record per issue, `records/microsoft/vscode/items/<n>.md` on the `state` branch: the review text and
  the few fields the index drops (Fixed by, breadth, ...). Read only for the issues that need them, from the
  optional local clone when it is current, else with `gh api`, and cached until Sweeper reviews the issue again.
"""
import json, os, re, subprocess, sys, tempfile, time
from concurrent.futures import ThreadPoolExecutor

from my_work_config import CACHE_DIR, SWEEPER_REPO, SWEEPER_SCOPE, SWEEPER_STATE_REPO, has_sweeper_clone

INDEX_NAME = "vscode"
INDEX_FILE = f"index-{INDEX_NAME}.json"
INDEX_SCHEMA_MAJOR = 2
CACHE = os.path.join(CACHE_DIR, "sweeper")
RECORDS_CACHE = os.path.join(CACHE, "records")


class SweeperUnavailable(RuntimeError):
    pass


def record_path(number):
    return f"records/{SWEEPER_SCOPE}/items/{number}.md"


def _gh(args, timeout=120):
    r = subprocess.run(["gh", *args], capture_output=True, timeout=timeout)
    return r.returncode, r.stdout, r.stderr.decode(errors="replace")


def _write_atomic(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".tmp-")
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


def load_index():
    """The published index as {"sha", "generatedAt", "rows": {number: row}}. Raises SweeperUnavailable rather than
    answering from a cache it could not validate."""
    if not SWEEPER_STATE_REPO:
        raise SweeperUnavailable("no sweeperStateRepo configured")
    code, out, err = _gh(["api", f"repos/{SWEEPER_STATE_REPO}/commits?path={INDEX_FILE}&sha=main&per_page=1", "--jq", ".[0].sha"])
    sha = out.decode().strip()
    if code != 0 or not sha:
        raise SweeperUnavailable(f"cannot check {SWEEPER_STATE_REPO}:{INDEX_FILE}: {err.strip() or 'no commit'}")
    cached = os.path.join(CACHE, INDEX_FILE)
    try:
        with open(cached + ".sha") as f:
            fresh = f.read().strip() == sha and os.path.getsize(cached) > 0
    except OSError:
        fresh = False
    if not fresh:
        code, out, err = _gh(["api", f"repos/{SWEEPER_STATE_REPO}/contents/{INDEX_FILE}?ref=main",
                              "-H", "Accept: application/vnd.github.raw"], timeout=300)
        if code != 0 or not out:
            raise SweeperUnavailable(f"download of {INDEX_FILE} failed: {err.strip()}")
        _write_atomic(cached, out)
        _write_atomic(cached + ".sha", sha.encode())
    with open(cached) as f:
        data = json.load(f)
    if str(data.get("schema", "")).split(".")[0] != str(INDEX_SCHEMA_MAJOR):
        raise SweeperUnavailable(f"{INDEX_FILE} has schema {data.get('schema')}, expected {INDEX_SCHEMA_MAJOR}.x")
    if data.get("target") != SWEEPER_SCOPE:
        raise SweeperUnavailable(f"{INDEX_FILE} is for {data.get('target')}, expected {SWEEPER_SCOPE}")
    return {"sha": sha, "generatedAt": data.get("generatedAt"), "rows": {r["number"]: r for r in data.get("rows", [])}}


def fetch_clone():
    """Best effort: bring the optional local clone's origin/state up to date, so records can be read locally."""
    if has_sweeper_clone():
        subprocess.run(["git", "-C", SWEEPER_REPO, "fetch", "-q", "origin", "state"], capture_output=True, timeout=300)


def reviewed_at(text):
    m = re.search(r'^reviewedAt: ?"?([^"\n]+)"?$', text.partition("\n---\n")[0], re.M)
    return m.group(1).strip() if m else None


def _clone_texts(numbers):
    with tempfile.TemporaryFile() as f:
        # Feed stdin from a file: piping a large `input=` while capturing output can hang (seen on Python 3.14).
        f.write("".join(f"origin/state:{record_path(n)}\n" for n in numbers).encode())
        f.seek(0)
        r = subprocess.run(["git", "-C", SWEEPER_REPO, "cat-file", "--batch"], stdin=f, capture_output=True, timeout=300)
    if r.returncode != 0:
        return {}
    out, pos, result = r.stdout, 0, {}
    for n in numbers:
        nl = out.index(b"\n", pos)
        header = out[pos:nl].decode(errors="replace").split()
        pos = nl + 1
        if len(header) == 3 and header[1] == "blob":
            size = int(header[2])
            result[n] = out[pos:pos + size].decode("utf-8", errors="replace")
            pos += size + 1
    return result


def _gh_record(number):
    code, out, err = _gh(["api", f"repos/{SWEEPER_STATE_REPO}/contents/{record_path(number)}?ref=state",
                          "-H", "Accept: application/vnd.github.raw"], timeout=60)
    if code == 0:
        return out.decode("utf-8", errors="replace"), None
    return None, None if "404" in err or "Not Found" in err else err.strip()


def record_texts(numbers, expected=None):
    """{number: record text} for the given issues; issues Sweeper has no record for are left out.

    `expected` maps a number to the review time the caller knows (the index row's `reviewedAt`). A cached or cloned
    record from that review is used as is; anything older is fetched again. Without an expected time, a cached record
    is used only if it is less than a day old.
    """
    expected = expected or {}
    numbers = sorted(set(numbers))
    result, missing = {}, []
    for n in numbers:
        path = os.path.join(RECORDS_CACHE, f"{n}.md")
        try:
            with open(path, encoding="utf-8") as f:
                text = f.read()
        except OSError:
            missing.append(n)
            continue
        want = expected.get(n)
        if (want and reviewed_at(text) == want) or (not want and time.time() - os.path.getmtime(path) < 86400):
            result[n] = text
        else:
            missing.append(n)
    if missing and has_sweeper_clone():
        for n, text in _clone_texts(missing).items():
            if not expected.get(n) or reviewed_at(text) == expected[n]:
                result[n] = text
                _write_atomic(os.path.join(RECORDS_CACHE, f"{n}.md"), text.encode())
        missing = [n for n in missing if n not in result]
    if missing and SWEEPER_STATE_REPO:
        with ThreadPoolExecutor(max_workers=8) as pool:
            for n, (text, err) in zip(missing, pool.map(_gh_record, missing)):
                if text:
                    result[n] = text
                    _write_atomic(os.path.join(RECORDS_CACHE, f"{n}.md"), text.encode())
                elif err:
                    print(f"WARN: Sweeper record #{n}: {err}", file=sys.stderr)
    return result


def record_sections(text):
    body = text.split("\n---\n", 1)[-1]
    return {m.group(1).strip(): m.group(2).strip() for m in re.finditer(r"^## (.+?)\n(.*?)(?=^## |\Z)", body, re.S | re.M)}


def record_extras(text):
    """The record fields the index does not carry: Fixed by (commit, shipped-in release), breadth, priority."""
    fm = {k: v.strip().strip('"') for k, v in re.findall(r"^(\w+): ?(.*)$", text.partition("\n---\n")[0], re.M)}
    m = re.search(r"^- \*\*Fixed by:\*\* (.+)$", text, re.M)
    fixed = re.match(r"`([0-9a-f]{7,40})`.*?(?:shipped in ([\w.\-]+))?$", m.group(1).strip()) if m else None
    none_or = lambda v: None if v in (None, "", "none") else v
    return {
        "fixedByCommit": fixed.group(1) if fixed else None,
        "shippedIn": fixed.group(2) if fixed else None,
        "breadth": none_or(fm.get("breadth")),
        "priority": none_or(fm.get("priority")),
    }


# Index row fields kept on an issue's `sweeper` object, under the same names unless mapped.
ROW_FIELDS = ("owner", "labels", "proposedLabel", "confidence", "severity", "agentReadiness", "closeReason", "itemType",
              "canonical", "verification", "reviewedAt", "upvotes", "lane", "valueRaw", "signal", "verifyVerdict",
              "verifyStale", "contentStale", "dismissed", "infoRequestedAt", "infoAnsweredAt", "lastCommentAt",
              "lastCommentBy", "assigneeActedAt", "linkedPr", "skillPr", "skillPrState", "autoClosedAt",
              "autoObjectedAt", "previousTriageAction", "currentState")
# Bookkeeping that changes without the review changing; ignored when deciding whether a record changed.
SOURCE_FIELDS = ("source", "sourceCommit", "sourceRef")
RECORD_FIELDS = ("fixedByCommit", "shippedIn", "breadth", "priority")


def sweeper_from_row(row, sha):
    s = {k: row[k] for k in ROW_FIELDS if row.get(k) not in (None, "", "none")}
    s["triageAction"] = row.get("triageAction") or "keep-open"
    s["autoFixable"] = row.get("agentReadiness") == "implement"
    s["hasProposedComment"] = bool(row.get("proposedComment"))
    if row.get("comments") is not None:
        s["commentCount"] = row["comments"]
    if row.get("createdAt"):
        s["itemCreatedAt"] = row["createdAt"]
    canonical = str(row.get("canonical") or "")
    if canonical.isdigit():
        s["duplicateOf"] = int(canonical)
    s.update({"source": "index", "sourceCommit": sha, "sourceRef": f"{SWEEPER_STATE_REPO}@main:{INDEX_FILE}"})
    return s


def needs_record(s):
    """Open close and needs-info proposals: Cleanup shows their review (summary, evidence, Fixed by), so the daily
    refresh warms the record cache for them."""
    return s.get("triageAction") in ("propose-close", "needs-info") and not s.get("currentState")


def ready_to_implement(s):
    """The sweeper-query skill's ready-to-implement predicate (a review-time snapshot; re-check live before acting)."""
    return (s.get("agentReadiness") == "implement" and not s.get("linkedPr") and not s.get("skillPr")
            and not s.get("dismissed") and not s.get("currentState"))
