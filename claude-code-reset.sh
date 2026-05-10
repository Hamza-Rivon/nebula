#!/usr/bin/env bash
# ==============================================================================
# claude-code-reset.sh — switch Claude Code between Sentisec demo mode and OAuth.
# ------------------------------------------------------------------------------
# Why this exists: Claude Code can run in two useful local modes:
#
#   1. Sentisec demo/proxy mode:
#      ANTHROPIC_BASE_URL points at the local Sentisec proxy and
#      ANTHROPIC_API_KEY is a sk_sentisec_... workspace key.
#
#   2. Normal Claude Code OAuth mode:
#      no Sentisec ANTHROPIC_* client env vars are set, then `claude /login`
#      uses the browser OAuth flow for Claude / Claude Max.
#
# The old version of this script only forced mode 1 by purging stored OAuth
# credentials. That is useful for the monitored demo, but it makes it too easy
# to forget how to get back to normal OAuth login afterwards.
#
# For Sentisec demo mode, Claude Code's credential precedence is
#
#   1. CLAUDE_CODE_OAUTH_TOKEN env var (rarely set)
#   2. Stored OAuth token (macOS Keychain / ~/.claude/.credentials.json)
#   3. ANTHROPIC_API_KEY env var (this is what Sentisec demo mode wants)
#
# If you ever picked "Anthropic Console account · API usage billing" at
# the login selector, Claude Code stored an OAuth Access Token
# (sk-ant-oat01-…) in macOS Keychain and wrote credential files under
# ~/.claude/. From that point on, `claude` sends the stored OAuth token
# on every request — bypassing your ANTHROPIC_API_KEY env var and our
# Sentisec proxy. `claude /logout` claims to clear this but in practice
# leaves behind enough state that `claude` picks it back up on next
# launch.
#
# `--sentisec-proxy` purges ALL of it:
#
#   - Keychain entries under the "Claude Code-credentials" and
#     "Claude Code" services
#   - ~/.claude/.credentials.json (legacy location)
#   - ~/.claude.json OAuth fields (if present)
#   - Claude Desktop / shared app config OAuth token cache
#     (~/Library/Application Support/Claude/config.json)
#   - Nested local-agent .claude.json OAuth fields under Claude app support
#   - Current Claude/Anthropic env-var values, with secrets truncated
#
# After running this + opening a fresh shell + sourcing your Sentisec
# client env (.env.client), `claude` will finally fall through to
# ANTHROPIC_API_KEY and route through the Sentisec proxy.
#
# Usage:
#   # Return to normal Claude Code OAuth login after the demo.
#   # Use `source` so the unset commands affect your current terminal.
#   source deploy/compose/claude-code-reset.sh --oauth-login
#
#   # Force the monitored Sentisec proxy demo path.
#   bash deploy/compose/claude-code-reset.sh --sentisec-proxy
#
# Backward compatible default:
#   bash deploy/compose/claude-code-reset.sh
#
# Or make it executable once and then:
#   chmod +x deploy/compose/claude-code-reset.sh
#   deploy/compose/claude-code-reset.sh --sentisec-proxy
#
# Safe to re-run — every step is idempotent.
# ==============================================================================

SCRIPT_SOURCED=0
(return 0 2>/dev/null) && SCRIPT_SOURCED=1

SCRIPT_HAD_NOUNSET=0
case "$-" in
  *u*) SCRIPT_HAD_NOUNSET=1 ;;
esac

set -u

GREEN=$'\033[0;32m'
YELLOW=$'\033[0;33m'
RED=$'\033[0;31m'
BOLD=$'\033[1m'
NC=$'\033[0m'

step() {
  printf "${BOLD}${GREEN}==>${NC} ${BOLD}%s${NC}\n" "$*"
}
warn() {
  printf "${BOLD}${YELLOW}!!${NC} %s\n" "$*"
}
err() {
  printf "${BOLD}${RED}!!${NC} %s\n" "$*"
}

restore_parent_shell_options() {
  if [[ "${SCRIPT_SOURCED}" -eq 1 && "${SCRIPT_HAD_NOUNSET}" -eq 0 ]]; then
    set +u
  fi
}

usage() {
  cat <<EOF
Usage:
  source deploy/compose/claude-code-reset.sh --oauth-login
      Return this terminal to normal Claude Code OAuth login.

  bash deploy/compose/claude-code-reset.sh --sentisec-proxy
      Purge Claude Code OAuth/API credentials so the Sentisec proxy demo
      can use ANTHROPIC_BASE_URL + ANTHROPIC_API_KEY from .env.client.

  bash deploy/compose/claude-code-reset.sh
      Backward-compatible alias for --sentisec-proxy.
EOF
}

restore_oauth_login() {
  step "Switching this terminal back to normal Claude Code OAuth login."

  # In a script, `unset` only affects the child process. When this file is
  # sourced, it affects the user's current shell, which is what OAuth needs.
  if [[ "${SCRIPT_SOURCED}" -eq 1 ]]; then
    for var in CLAUDE_CODE_OAUTH_TOKEN CLAUDE_API_KEY ANTHROPIC_API_KEY ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN; do
      unset "${var}"
      printf "    unset %s\n" "${var}"
    done
    cat <<EOF

${BOLD}${GREEN}Done.${NC} This shell no longer points Claude Code at the Sentisec proxy.

Now run:
  claude /logout
  claude /login
  claude

Choose the Claude subscription / Claude Max browser login path. Do not source
deploy/compose/.env.client in this terminal unless you want to route Claude Code
through Sentisec again.

If \`claude\` still says ${BOLD}ConnectionRefused${NC}, a shell startup file is
re-exporting the Sentisec demo env vars. Check and remove/comment lines like:
  source .../sentisec/deploy/compose/.env.client

Common files to check:
  ~/.zshrc
  ~/.zprofile
  ~/.bashrc
  ~/.bash_profile

EOF

restore_parent_shell_options
  else
    warn "This script was executed, not sourced, so it cannot unset variables in your current terminal."
    cat <<EOF

Run this exact command instead:
  source deploy/compose/claude-code-reset.sh --oauth-login

Or manually run:
  unset CLAUDE_CODE_OAUTH_TOKEN CLAUDE_API_KEY ANTHROPIC_API_KEY ANTHROPIC_BASE_URL ANTHROPIC_AUTH_TOKEN
  claude /logout
  claude /login
  claude

For a one-command OAuth login test without changing the current shell:
  env -u CLAUDE_CODE_OAUTH_TOKEN -u CLAUDE_API_KEY -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u ANTHROPIC_AUTH_TOKEN claude /login

EOF
  fi
}

mode="${1:---sentisec-proxy}"
case "${mode}" in
  --oauth-login|oauth-login|oauth|--oauth)
    restore_oauth_login
    if [[ "${SCRIPT_SOURCED}" -eq 1 ]]; then
      restore_parent_shell_options
      return 0
    else
      exit 0
    fi
    ;;
  --sentisec-proxy|sentisec-proxy|proxy|--proxy|"")
    ;;
  -h|--help|help)
    usage
    if [[ "${SCRIPT_SOURCED}" -eq 1 ]]; then
      restore_parent_shell_options
      return 0
    else
      exit 0
    fi
    ;;
  *)
    err "Unknown mode: ${mode}"
    usage
    if [[ "${SCRIPT_SOURCED}" -eq 1 ]]; then
      restore_parent_shell_options
      return 2
    else
      exit 2
    fi
    ;;
esac

step "Claude Code credential purge starting."

timestamp="$(date +%Y%m%d_%H%M%S)"
export timestamp

# ------------------------------------------------------------------------------
# 1. macOS Keychain entries
# ------------------------------------------------------------------------------
if [[ "$(uname -s)" == "Darwin" ]]; then
  step "[1/4] Purging macOS Keychain entries for Claude Code services."
  # `security` returns 44 if the item does not exist; that's fine.
  # We loop because multiple Keychain entries sometimes exist (one per
  # account / one per `claude /login` attempt).
  keychain_services=(
    "Claude Code-credentials"
    "Claude Code"
  )
  for service in "${keychain_services[@]}"; do
    purged=0
    while security delete-generic-password -s "${service}" >/dev/null 2>&1; do
      purged=$((purged + 1))
    done
    if [[ $purged -gt 0 ]]; then
      echo "    Deleted ${purged} Keychain entry/entries for service='${service}'."
    else
      echo "    No '${service}' Keychain entries found in default keychain (already clean)."
    fi
  done

  # Some macOS installs have more than one user keychain in the search
  # list. The plain command above targets the default keychain; this
  # sweep catches login/iCloud/custom keychains without printing secrets.
  extra_purged=0
  while IFS= read -r keychain; do
    [[ -z "${keychain}" ]] && continue
    for service in "${keychain_services[@]}"; do
      while security delete-generic-password -s "${service}" "${keychain}" >/dev/null 2>&1; do
        extra_purged=$((extra_purged + 1))
      done
    done
  done < <(security list-keychains -d user 2>/dev/null | tr -d '"')
  if [[ $extra_purged -gt 0 ]]; then
    echo "    Deleted ${extra_purged} additional entry/entries from explicit user keychains."
  fi
else
  step "[1/4] Skipping Keychain purge (not macOS)."
  echo "    On Linux, Claude Code uses libsecret / gnome-keyring. Check manually:"
  echo "      secret-tool search --all 'service' 'Claude Code-credentials'"
fi

# ------------------------------------------------------------------------------
# 2. ~/.claude/.credentials.json (legacy credential file)
# ------------------------------------------------------------------------------
step "[2/4] Purging ~/.claude/.credentials.json (if present)."
if [[ -f "${HOME}/.claude/.credentials.json" ]]; then
  # Back it up before removing so the user can recover if they actually
  # wanted those credentials.
  backup="${HOME}/.claude/.credentials.json.bak.${timestamp}"
  mv "${HOME}/.claude/.credentials.json" "${backup}"
  echo "    Moved to ${backup}"
else
  echo "    No ~/.claude/.credentials.json found (already clean)."
fi

# ------------------------------------------------------------------------------
# 3. ~/.claude.json — remove Claude credential fields only (keep user settings)
# ------------------------------------------------------------------------------
step "[3/4] Checking ~/.claude.json for stored Claude credential fields."
if [[ -f "${HOME}/.claude.json" ]]; then
  # Back up before editing.
  backup="${HOME}/.claude.json.bak.${timestamp}"
  cp "${HOME}/.claude.json" "${backup}"
  # Strip any OAuth / API key sub-objects with python (jq isn't
  # guaranteed to be installed).
  python3 - <<'PY'
import json
import os
import pathlib

p = pathlib.Path(os.path.expanduser("~/.claude.json"))
try:
    data = json.loads(p.read_text())
except Exception as exc:
    print(f"    WARN: ~/.claude.json is not valid JSON ({exc}); leaving untouched.")
    raise SystemExit(0)

removed = []
for key in list(data.keys()):
    lower = key.lower()
    if "oauth" in lower or "auth" in lower or lower in (
        "accesstoken",
        "refreshtoken",
        "authtoken",
        "apikey",
        "api_key",
        "anthropicapikey",
        "anthropic_api_key",
    ):
        removed.append(key)
        del data[key]

# Also scrub nested structures (some Claude versions nest credentials
# under an account / credentials object).
def scrub(obj):
    if isinstance(obj, dict):
        for k in list(obj.keys()):
            lower = k.lower()
            if "oauth" in lower or lower in (
                "accesstoken",
                "refreshtoken",
                "authtoken",
                "apikey",
                "api_key",
                "anthropicapikey",
                "anthropic_api_key",
            ):
                removed.append(f"nested:{k}")
                del obj[k]
            else:
                scrub(obj[k])
    elif isinstance(obj, list):
        for item in obj:
            scrub(item)

scrub(data)

p.write_text(json.dumps(data, indent=2) + "\n")
if removed:
    print(f"    Removed {len(removed)} Claude credential field(s): {', '.join(sorted(set(removed)))}")
else:
    print("    No Claude credential fields found in ~/.claude.json (already clean).")
PY
  echo "    Backup kept at ${backup}"
else
  echo "    No ~/.claude.json found (already clean)."
fi

# ------------------------------------------------------------------------------
# 3b. Claude Desktop / shared app-support credential caches
# ------------------------------------------------------------------------------
step "[3b/4] Scrubbing Claude app-support credential caches."
python3 - <<'PY'
import json
import os
import pathlib
import shutil

timestamp = os.environ.get("timestamp") or "unknown"
home = pathlib.Path.home()
targets = [
    home / "Library/Application Support/Claude/config.json",
]
support_root = home / "Library/Application Support/Claude"
if support_root.exists():
    targets.extend(support_root.glob("local-agent-mode-sessions/**/.claude.json"))

def should_remove(key: str) -> bool:
    lower = key.lower()
    return (
        "oauth" in lower
        or lower in (
            "accesstoken",
            "refreshtoken",
            "authtoken",
            "apikey",
            "api_key",
            "anthropicapikey",
            "anthropic_api_key",
        )
        or key == "claudeAiOauth"
    )

def scrub(obj, removed, path=""):
    if isinstance(obj, dict):
        for key in list(obj.keys()):
            if should_remove(key):
                removed.append(f"{path}/{key}")
                del obj[key]
            else:
                scrub(obj[key], removed, f"{path}/{key}")
    elif isinstance(obj, list):
        for index, item in enumerate(obj):
            scrub(item, removed, f"{path}[{index}]")

seen = set()
changed_files = 0
for path in targets:
    path = path.expanduser()
    if path in seen or not path.exists() or not path.is_file():
        continue
    seen.add(path)
    try:
        data = json.loads(path.read_text())
    except Exception as exc:
        print(f"    WARN: {path} is not valid JSON ({exc}); leaving untouched.")
        continue
    removed = []
    scrub(data, removed)
    if not removed:
        continue
    backup = path.with_name(path.name + f".bak.{timestamp}")
    shutil.copy2(path, backup)
    path.write_text(json.dumps(data, indent=2) + "\n")
    rel = str(path).replace(str(home), "~", 1)
    print(f"    Scrubbed {len(removed)} Claude credential field(s) from {rel}")
    print(f"      Backup: {backup}")
    changed_files += 1

if changed_files == 0:
    print("    No Claude app-support credential JSON fields found (already clean).")
PY

# ------------------------------------------------------------------------------
# 4. Show current env + next steps
# ------------------------------------------------------------------------------
step "[4/4] Current env snapshot (run this script AGAIN in a fresh shell if any are set):"
for var in CLAUDE_CODE_OAUTH_TOKEN CLAUDE_API_KEY ANTHROPIC_API_KEY ANTHROPIC_BASE_URL; do
  val="${!var:-}"
  if [[ -z "${val}" ]]; then
    printf "    %-32s = ${YELLOW}<unset>${NC}\n" "${var}"
  else
    # Show prefix only — never the full value.
    prefix="${val:0:20}"
    printf "    %-32s = %s…\n" "${var}" "${prefix}"
  fi
done

if command -v pgrep >/dev/null 2>&1; then
  live_pids="$(pgrep -f 'claude|Claude' 2>/dev/null | tr '\n' ' ' || true)"
  if [[ -n "${live_pids}" ]]; then
    warn "Claude-related processes are still running: ${live_pids}"
    echo "    Quit Claude Code / Claude Desktop completely before retrying."
    echo "    A process that already loaded sk-ant-oat01 or sk-ant-api03 can keep sending it until it exits."
  fi
fi

if [[ "$(uname -s)" == "Darwin" ]]; then
  for service in "Claude Code-credentials" "Claude Code"; do
    if security find-generic-password -s "${service}" >/dev/null 2>&1; then
      warn "A '${service}' Keychain item is STILL present after purge."
      echo "    Open Keychain Access.app, search '${service}', and delete it manually."
    else
      echo "    Verified: no default-keychain '${service}' item remains."
    fi
  done
fi

cat <<EOF

${BOLD}${GREEN}Done.${NC} To complete the reset:

  1. Quit every running Claude Code / Claude Desktop process.
     If needed:
       pkill -f 'claude|Claude'
  2. Close this terminal.
  3. Open a FRESH terminal window (new tab is fine on macOS).
  4. Source your Sentisec client env:
       source $(cd "$(dirname "$0")" && pwd)/.env.client
  5. Verify the right values are live:
       echo \$ANTHROPIC_API_KEY   # should start with sk_sentisec_
       echo \$ANTHROPIC_BASE_URL  # should start with http://localhost:8080/ws/
  6. Run:
       claude
     At the login selector (if it appears), press Ctrl+C.
     At the "Use API key from env?" prompt, answer YES.

If after this you STILL see ${BOLD}event=bearer_reject_oauth_token${NC} in
the proxy log with an ${BOLD}sk-ant-oat01-${NC} prefix, a stored OAuth token
survived the purge. Look in:
  - macOS Keychain Access.app → search "Claude Code"
  - ~/.claude/ (any *.json file still referencing oauth)
  - ~/.claude-code/ (older install layout)
  - \$HOME/Library/Application Support/Claude/ (some versions cache here)

If you see ${BOLD}event=bearer_reject_console_key${NC} with an
${BOLD}sk-ant-api03-${NC} prefix, Claude Code is still using a real
Anthropic Console API key. Look for:
  - macOS Keychain Access.app → "Claude Code"
  - any project .env/.env.local file setting ANTHROPIC_API_KEY=sk-ant-...
  - a shell startup file exporting ANTHROPIC_API_KEY=sk-ant-...

EOF
