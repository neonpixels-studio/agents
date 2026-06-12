# Moving the Agents LaunchAgent to Mac Mini

## On this machine — stop the job

```
launchctl unload ~/Library/LaunchAgents/me.danholloran.agents.plist
```

You can leave the plist file in place — it won't run once unloaded.

---

## On the Mac Mini — prerequisites

Install the tools the job depends on:

```
brew install direnv gh
```

Install the Claude CLI:

```
npm install -g @anthropic-ai/claude-code
# or whatever the current install method is — check https://claude.ai/code
```

Authenticate both:

```
gh auth login
claude login
```

---

## Clone the repo

```
git clone https://github.com/grimicorn/agents /path/to/agents
cd /path/to/agents
```

Copy your `.envrc` from the old machine (it contains API keys — don't commit it):

```
# on old machine
scp /Volumes/External/Development/agents/.envrc macmini:/path/to/agents/.envrc
```

Then allow direnv on the Mac Mini:

```
direnv allow /path/to/agents
```

---

## Install the plist

Copy the plist to the Mac Mini's LaunchAgents directory:

```
cp /Volumes/External/Development/agents/me.danholloran.agents.plist \
   ~/Library/LaunchAgents/me.danholloran.agents.plist
```

**Update the paths in the plist** — open it and replace every occurrence of
`/Volumes/External/Development/agents` with the actual path on the Mac Mini:

```
sed -i '' 's|/Volumes/External/Development/agents|/path/to/agents|g' \
    ~/Library/LaunchAgents/me.danholloran.agents.plist
```

---

## Full Disk Access (only needed if repo is on an external drive)

If the repo lives on an external drive on the Mac Mini, you'll hit the same TCC
block as on this machine. Fix it the same way:

System Settings → Privacy & Security → Full Disk Access → `+` → `⌘⇧G` → `/bin/bash`

If the repo is on the internal drive you can skip this.

---

## Load and test

```
launchctl load ~/Library/LaunchAgents/me.danholloran.agents.plist
launchctl kickstart -k gui/$(id -u)/me.danholloran.agents
tail -f ~/Library/Logs/agents.log
```

You should see `=== Run started: ... ===` within a few seconds. If you see nothing
and `launchctl list me.danholloran.agents` shows `LastExitStatus = 32256` (exit 126),
the Full Disk Access step above was needed.
