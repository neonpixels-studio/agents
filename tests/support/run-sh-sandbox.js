import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repoPath } from './repo-files.js';

// `direnv exec <dir> <command...>` only loads .envrc; the stub just runs the command.
const DIRENV_STUB = '#!/bin/bash\nshift 2\nexec "$@"\n';

// Stands in for `claude -p`: records that it ran (and from where), then emits
// whatever output and exit code the test asked for.
const CLAUDE_STUB = `#!/bin/bash
pwd > "$HOME/claude-cwd"
printf '%s' "\${STUB_STDOUT:-}"
printf '%s' "\${STUB_STDERR:-}" >&2
exit "\${STUB_EXIT:-0}"
`;

function writeExecutable(path, contents) {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

export function createSandbox({ config } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'agents-run-sh-'));
  const sandbox = {
    root,
    home: join(root, 'home'),
    workspace: join(root, 'workspace'),
    bin: join(root, 'bin'),
  };

  mkdirSync(join(sandbox.home, 'Library', 'Logs'), { recursive: true });
  mkdirSync(sandbox.workspace);
  mkdirSync(sandbox.bin);
  copyFileSync(repoPath('run.sh'), join(sandbox.workspace, 'run.sh'));
  copyFileSync(
    repoPath('trim_logs.py'),
    join(sandbox.workspace, 'trim_logs.py'),
  );
  writeExecutable(join(sandbox.bin, 'direnv'), DIRENV_STUB);
  writeExecutable(join(sandbox.bin, 'claude'), CLAUDE_STUB);

  if (config !== undefined) {
    const contents =
      typeof config === 'string' ? config : JSON.stringify(config);
    writeFileSync(join(sandbox.workspace, 'agents.config.json'), contents);
  }

  return sandbox;
}

export function removeSandbox(sandbox) {
  rmSync(sandbox.root, { recursive: true, force: true });
}

// Runs from `/` on purpose: run.sh must cd into its own workspace.
export function runRunSh(sandbox, stub = {}) {
  return spawnSync('bash', [join(sandbox.workspace, 'run.sh')], {
    cwd: '/',
    encoding: 'utf8',
    env: {
      HOME: sandbox.home,
      PATH: `${sandbox.bin}:/usr/bin:/bin`,
      STUB_STDOUT: stub.stdout ?? '',
      STUB_STDERR: stub.stderr ?? '',
      STUB_EXIT: String(stub.exitCode ?? 0),
    },
  });
}

export function sandboxFile(sandbox, ...segments) {
  return join(sandbox.home, ...segments);
}

export function readSandboxFile(sandbox, ...segments) {
  const path = sandboxFile(sandbox, ...segments);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

export function lockDir(sandbox) {
  return sandboxFile(sandbox, 'Library', 'Logs', '.agents-run.lock');
}
