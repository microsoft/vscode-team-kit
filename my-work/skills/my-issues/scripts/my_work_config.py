"""Per-user My Work settings shared by my_issues.py, refresh_my_issues.py and the My Work canvas.

Users override any field in <COPILOT_HOME>/project-boards/my-work.config.json. Keep the defaults in
sync with com.github.copilot/extensions/my-work/lib/config.mjs.
"""
import json, os, shutil, subprocess, sys

# Every script reads and prints JSON as UTF-8, whatever the platform's default (cp1252 on Windows).
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8")


def _gh_dirs():
    if os.name == "nt":
        env = os.environ
        return [d for d in (
            env.get("ProgramFiles") and os.path.join(env["ProgramFiles"], "GitHub CLI"),
            env.get("ProgramFiles(x86)") and os.path.join(env["ProgramFiles(x86)"], "GitHub CLI"),
            env.get("LOCALAPPDATA") and os.path.join(env["LOCALAPPDATA"], "Programs", "GitHub CLI"),
            env.get("LOCALAPPDATA") and os.path.join(env["LOCALAPPDATA"], "Microsoft", "WinGet", "Links"),
        ) if d]
    return ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/home/linuxbrew/.linuxbrew/bin", os.path.expanduser("~/.local/bin")]


def ensure_gh_on_path(dirs=None):
    """Add gh's install folder to PATH when gh is installed but not on PATH (a chat started before gh was installed)."""
    if shutil.which("gh"):
        return True
    exe = "gh.exe" if os.name == "nt" else "gh"
    for d in _gh_dirs() if dirs is None else dirs:
        if os.path.isfile(os.path.join(d, exe)):
            os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")
            return True
    return False


ensure_gh_on_path()

COPILOT_HOME = os.environ.get("COPILOT_HOME") or os.path.expanduser("~/.copilot")
BOARD = os.path.join(COPILOT_HOME, "project-boards")
CONFIG_FILE = os.path.join(BOARD, "my-work.config.json")
CACHE_DIR = os.path.join(BOARD, ".cache", "my-work")

DEFAULTS = {
    "org": "microsoft",
    "planRepo": "microsoft/vscode",
    "repoPaths": {"microsoft/vscode": "~/work/vscode"},
    # Optional local clone of the Sweeper state repo: a faster, offline source for review records.
    "sweeperRepo": "~/work/vscodesweeper-state",
    # The Sweeper's published state repo (index and records); empty turns Sweeper data off.
    "sweeperStateRepo": "egamma/vscodesweeper-state",
    "rulesFile": os.path.join(COPILOT_HOME, "github-inbox-rules.md"),
    "memoryFile": os.path.join(COPILOT_HOME, "github-inbox-memory.md"),
    "login": None,
    "dataDir": "~/.agents/data/my-work",
}


def load_config():
    cfg = dict(DEFAULTS)
    try:
        with open(CONFIG_FILE, encoding="utf-8") as f:
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
MEMORY_FILE = CFG["memoryFile"]
DATA_DIR = os.path.expanduser(CFG["dataDir"] or DEFAULTS["dataDir"])
PRINCIPLES_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "triage-principles.md")
SWEEPER_REPO = os.path.expanduser(CFG["sweeperRepo"] or "")
SWEEPER_STATE_REPO = CFG.get("sweeperStateRepo") or ""
# The index and records used here are microsoft/vscode's.
SWEEPER_SCOPE = "microsoft/vscode"
_clone = CFG["repoPaths"].get(PLAN_REPO)
# Missing defaults are ignored, so judges are told to ask instead of reading a path that isn't there.
REPO_CLONE = _clone if _clone and os.path.isdir(os.path.expanduser(_clone)) else f"<your local clone of {PLAN_REPO} (ask the user where it is)>"

_login = None


def login():
    """The GitHub login whose issues are indexed: config `login`, else the gh CLI's signed-in user."""
    global _login
    if _login is None:
        _login = CFG.get("login") or ""
        if not _login:
            try:
                r = subprocess.run(["gh", "api", "user", "--jq", ".login"], capture_output=True, text=True, encoding="utf-8", timeout=30)
                _login = r.stdout.strip() if r.returncode == 0 else ""
            except (OSError, subprocess.TimeoutExpired):
                _login = ""
    return _login


def has_sweeper():
    """Sweeper data is on unless sweeperStateRepo is emptied; it is read through the gh CLI."""
    return bool(SWEEPER_STATE_REPO)


def has_sweeper_clone():
    return bool(SWEEPER_REPO) and os.path.isdir(os.path.join(SWEEPER_REPO, ".git"))
