"""Per-user My Work settings shared by my_issues.py, refresh_my_issues.py and the My Work canvas.

Users override any field in <COPILOT_HOME>/project-boards/my-work.config.json. Keep the defaults in
sync with com.github.copilot/extensions/my-work/lib/config.mjs.
"""
import json, os, subprocess

COPILOT_HOME = os.environ.get("COPILOT_HOME") or os.path.expanduser("~/.copilot")
BOARD = os.path.join(COPILOT_HOME, "project-boards")
CONFIG_FILE = os.path.join(BOARD, "my-work.config.json")
CACHE_DIR = os.path.join(BOARD, ".cache", "my-work")

DEFAULTS = {
    "org": "microsoft",
    "planRepo": "microsoft/vscode",
    "repoPaths": {"microsoft/vscode": "~/work/vscode"},
    "sweeperRepo": "~/work/vscodesweeper-state",
    "rulesFile": os.path.join(COPILOT_HOME, "github-inbox-rules.md"),
    "login": None,
}


def load_config():
    cfg = dict(DEFAULTS)
    try:
        with open(CONFIG_FILE) as f:
            user = json.load(f)
    except (OSError, ValueError):
        user = {}
    cfg.update({k: v for k, v in user.items() if k != "repoPaths"})
    cfg["repoPaths"] = {**DEFAULTS["repoPaths"], **(user.get("repoPaths") or {})}
    return cfg


CFG = load_config()
ORG = CFG["org"]
PLAN_REPO = CFG["planRepo"]
RULES_FILE = CFG["rulesFile"]
SWEEPER_REPO = os.path.expanduser(CFG["sweeperRepo"] or "")
# Sweeper only publishes records for microsoft/vscode.
SWEEPER_SCOPE = "microsoft/vscode"
REPO_CLONE = CFG["repoPaths"].get(PLAN_REPO) or f"<your local clone of {PLAN_REPO}>"

_login = None


def login():
    """The GitHub login whose issues are indexed: config `login`, else the gh CLI's signed-in user."""
    global _login
    if _login is None:
        _login = CFG.get("login") or ""
        if not _login:
            try:
                r = subprocess.run(["gh", "api", "user", "--jq", ".login"], capture_output=True, text=True, timeout=30)
                _login = r.stdout.strip() if r.returncode == 0 else ""
            except (OSError, subprocess.TimeoutExpired):
                _login = ""
    return _login


def has_sweeper():
    return bool(SWEEPER_REPO) and os.path.isdir(os.path.join(SWEEPER_REPO, ".git"))
