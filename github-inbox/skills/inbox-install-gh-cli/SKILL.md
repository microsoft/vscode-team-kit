---
name: inbox-install-gh-cli
description: Install the GitHub CLI (gh) if not already installed
tools:
  - execute
---

# Install GitHub CLI

Before using any `gh` commands, check if `gh` is installed by running:

```
gh --version
```

If `gh` is not found, install it based on the operating system:

## macOS

```
brew install gh
```

## Linux (Debian/Ubuntu)

```
(type -p wget >/dev/null || (sudo apt update && sudo apt-get install wget -y)) && sudo mkdir -p -m 755 /etc/apt/keyrings && out=$(mktemp) && wget -nv -O$out https://cli.github.com/packages/githubcli-archive-keyring.gpg && cat $out | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null && sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null && sudo apt update && sudo apt install gh -y
```

## Windows

```
winget install --id GitHub.cli
```

## After installation

Authenticate with GitHub:

```
gh auth login
```

If the user needs notifications access, ensure the token has the `notifications` scope:

```
gh auth refresh -s notifications
```

Disable the pager to prevent terminal buffer issues:

```
gh config set pager cat
```
