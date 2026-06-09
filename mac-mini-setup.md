# Mac Mini — Multi-Agent Claude Code Runner Setup

A reference guide for setting up a self-hosted GitHub Actions runner on the Mac Mini to run autonomous Claude Code agent workflows remotely, without screen sharing.

---

## Concept

```
You (anywhere)
  → Trigger workflow_dispatch on GitHub
    → Mac Mini picks up the job (self-hosted runner)
      → Lead Claude Code agent reads workspace CLAUDE.md + tasks.md
        → Spawns subagents across local repo clones
          → Subagents open PRs
            → You review and merge from anywhere
```

No screen sharing. No SSH required for day-to-day use. PRs are the output.

---

## Prerequisites

- Mac Mini is on, awake, and connected to the internet
- Xcode Command Line Tools installed: `xcode-select --install`
- Node.js installed (required for Claude Code): https://nodejs.org
- Claude Code installed: `npm install -g @anthropic-ai/claude-code`
- Authenticated with Anthropic: `claude login`
- Git configured with your GitHub credentials

---

## Part 1 — Workspace Setup

Create a parent directory on the Mac Mini that holds everything:

```bash
mkdir ~/agent-workspace && cd ~/agent-workspace
```

Clone each repo you want agents to work on as separate directories:

```bash
git clone https://github.com/grimicorn/<repo-a> repo-a
git clone https://github.com/grimicorn/<repo-b> repo-b
git clone https://github.com/grimicorn/<repo-c> repo-c
git clone https://github.com/grimicorn/<repo-d> repo-d
```

Add `CLAUDE.md` and `tasks.md` to the workspace root:

```
~/agent-workspace/
  CLAUDE.md       ← lead agent instructions
  tasks.md        ← task queue
  repo-a/
  repo-b/
  repo-c/
  repo-d/
```

> See `CLAUDE.md` in this repo for the lead agent instruction template.

---

## Part 2 — GitHub Actions Self-Hosted Runner

### 2a. Add the Runner to Your Repo (or Org)

1. Go to your GitHub repo → **Settings** → **Actions** → **Runners**
2. Click **"New self-hosted runner"**
3. Select **macOS** as the OS and your architecture (Apple Silicon = ARM64)
4. GitHub generates a set of commands — run them on the Mac Mini:

```bash
# Create a directory for the runner
mkdir ~/actions-runner && cd ~/actions-runner

# Download the runner package (use the URL GitHub provides — it's version-specific)
curl -o actions-runner-osx-arm64.tar.gz -L https://github.com/actions/runner/releases/download/v<version>/actions-runner-osx-arm64-<version>.tar.gz

# Extract
tar xzf ./actions-runner-osx-arm64.tar.gz

# Configure (use the token GitHub provides — it expires after 1 hour)
./config.sh --url https://github.com/grimicorn/<repo> --token <GITHUB_PROVIDED_TOKEN>
```

### 2b. Install as a Persistent Background Service

So the runner survives reboots and runs without a logged-in terminal:

```bash
cd ~/actions-runner
./svc.sh install
./svc.sh start
```

Check status anytime:

```bash
./svc.sh status
```

To stop or uninstall:

```bash
./svc.sh stop
./svc.sh uninstall
```

### 2c. Verify It's Online

Go back to **Settings → Actions → Runners** in GitHub. The runner should show as **"Idle"** (green). If it shows as offline, check the service:

```bash
cd ~/actions-runner
./svc.sh status
```

---

## Part 3 — Multiple Runner Instances (Parallel Agents)

You can run multiple runner instances on a single Mac Mini to support parallel agent jobs. Each instance needs its own directory:

```bash
mkdir ~/actions-runner-2 && cd ~/actions-runner-2
# Repeat the download + config.sh steps with a new token from GitHub
./svc.sh install
./svc.sh start
```

Repeat for as many parallel slots as you want (one per agent is a reasonable starting point). Each will appear as a separate runner in GitHub's UI.

---

## Part 4 — GitHub Actions Workflow

Create `.github/workflows/agent-run.yml` in your orchestration repo:

```yaml
name: Run Claude Agents

on:
  workflow_dispatch:
    inputs:
      task_description:
        description: "Optional: override task or add context for the lead agent"
        required: false
        default: "Process tasks.md and delegate work to subagents"

jobs:
  run-agents:
    runs-on: self-hosted
    timeout-minutes: 60

    steps:
      - name: Checkout orchestration repo
        uses: actions/checkout@v4

      - name: Pull latest on all agent repos
        working-directory: ~/agent-workspace
        run: |
          for dir in repo-a repo-b repo-c repo-d; do
            echo "Pulling $dir..."
            git -C $dir pull origin main
          done

      - name: Run lead agent
        working-directory: ~/agent-workspace
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          claude -p "${{ github.event.inputs.task_description }}" \
            --dangerously-skip-permissions \
            --output-format stream-json
```

### Triggering Manually

From GitHub's UI:

1. Go to your repo → **Actions** → **Run Claude Agents**
2. Click **"Run workflow"**
3. Optionally add context or override the task description
4. Click **"Run workflow"** — Mac Mini picks it up within seconds

Via GitHub CLI (from anywhere):

```bash
gh workflow run agent-run.yml \
  --repo grimicorn/<repo> \
  --field task_description="Work on the RSS feed feature in the reader repo"
```

Via GitHub API:

```bash
curl -X POST \
  -H "Authorization: Bearer <your_pat>" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/grimicorn/<repo>/actions/workflows/agent-run.yml/dispatches \
  -d '{"ref":"main","inputs":{"task_description":"Process tasks.md"}}'
```

---

## Part 5 — Permissions (Skip Approvals)

For headless agent runs, you need to bypass Claude Code's interactive permission prompts since there's no one at the terminal. There are two options:

### Option A: `--dangerously-skip-permissions` (Recommended for CI)

Skips all permission prompts. Subagents inherit the same bypass. Use this in your workflow YAML:

```bash
claude -p "your prompt" --dangerously-skip-permissions
```

Equivalent to:

```bash
claude -p "your prompt" --permission-mode bypassPermissions
```

### Option B: Auto Mode (Smarter, but newer)

Uses an LLM classifier to decide what to approve/block automatically. Less friction than manual approval, more guardrails than full bypass. Enable it with:

```bash
claude --permission-mode auto
```

> **Note:** The VS Code extension may ignore `settings.json` permission configuration. Always pass the flag directly in your workflow run command when running headless.

---

## Part 6 — Secrets

Store your Anthropic API key as a GitHub Actions secret so it's available to the workflow:

1. Go to repo → **Settings** → **Secrets and variables** → **Actions**
2. Click **"New repository secret"**
3. Name: `ANTHROPIC_API_KEY`
4. Value: your key from https://console.anthropic.com

Reference it in your workflow as `${{ secrets.ANTHROPIC_API_KEY }}`.

---

## Part 7 — Mac Mini Reliability

A few settings to make sure the Mac Mini stays available:

### Prevent Sleep

System Settings → Battery → Options:

- Enable **"Prevent automatic sleeping when the display is off"**
- Or via terminal: `sudo pmset -a sleep 0 disksleep 0`

### Keep Network Active During Sleep

```bash
sudo pmset -a womp 1     # Wake on network access
sudo pmset -a powernap 1 # Allow background network activity
```

### Auto-Login (Optional)

System Settings → Users & Groups → enable automatic login for your user account. The runner service starts at boot, but the user session needs to be active for some tools.

---

## Workflow Summary

| Step                              | Where                         |
| --------------------------------- | ----------------------------- |
| Add tasks to `tasks.md`           | Locally or edit on GitHub     |
| Trigger `workflow_dispatch`       | GitHub UI, GitHub CLI, or API |
| Runner picks up job               | Mac Mini (background service) |
| Lead agent delegates to subagents | `~/agent-workspace/`          |
| Subagents open PRs                | GitHub                        |
| Review and merge                  | GitHub UI from anywhere       |

---

## Troubleshooting

**Runner shows as offline in GitHub**

```bash
cd ~/actions-runner && ./svc.sh status
./svc.sh start
```

**Claude Code not found in workflow**
Ensure Claude Code is installed system-wide and on the runner's PATH:

```bash
npm install -g @anthropic-ai/claude-code
which claude  # Should return a path
```

**Agent repos out of date**
Add a `git pull` step at the start of your workflow (see Part 4 above).

**Workflow times out**
Increase `timeout-minutes` in the workflow YAML, or break large task batches into smaller runs.
