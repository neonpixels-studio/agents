import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

// The directory of the node running the tests, so run.sh's config validator
// finds the same node on PATH locally (nvm) and in CI (setup-node).
const NODE_DIR = dirname(process.execPath);

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
    limitedBin: join(root, 'limited-bin'),
  };

  mkdirSync(join(sandbox.home, 'Library', 'Logs'), { recursive: true });
  mkdirSync(sandbox.workspace);
  mkdirSync(sandbox.bin);
  mkdirSync(sandbox.limitedBin);
  mkdirSync(join(sandbox.workspace, 'scripts'));
  copyFileSync(repoPath('run.sh'), join(sandbox.workspace, 'run.sh'));
  copyFileSync(
    repoPath('scripts/validate-config.mjs'),
    join(sandbox.workspace, 'scripts', 'validate-config.mjs'),
  );
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

// A PATH holding only the named commands, for "tool is missing" cases.
export function limitedPath(sandbox, commands) {
  commands.forEach((command) => {
    const which = spawnSync('bash', ['-c', `command -v ${command}`], {
      encoding: 'utf8',
      env: { PATH: `${NODE_DIR}:/usr/bin:/bin` },
    });
    symlinkSync(which.stdout.trim(), join(sandbox.limitedBin, command));
  });
  return sandbox.limitedBin;
}

// Runs from `/` on purpose: run.sh must cd into its own workspace.
export function runRunSh(sandbox, stub = {}, path = undefined) {
  return spawnSync('/bin/bash', [join(sandbox.workspace, 'run.sh')], {
    cwd: '/',
    encoding: 'utf8',
    env: {
      HOME: sandbox.home,
      PATH: path ?? `${sandbox.bin}:${NODE_DIR}:/usr/bin:/bin`,
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
