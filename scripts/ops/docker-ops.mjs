import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { finished } from 'node:stream/promises';

const backupDir = resolve('../voucher-ledger-backups');
const composeBaseArgs = ['compose', '--env-file', 'deploy/.env.docker', '-f', 'deploy/docker-compose.yml'];

const command = process.argv[2];
const backupPath = process.argv[3];

switch (command) {
  case 'status':
    await runDocker(['ps']);
    await runDocker(['--profile', 'tools', 'run', '--rm', 'migrate', 'status']);
    break;
  case 'backup':
    await backup({ failedState: false });
    break;
  case 'failed-backup':
    await backup({ failedState: true });
    break;
  case 'verify-backup':
    if (!backupPath) usage('verify-backup requires a dump path.');
    await verifyBackup(resolve(backupPath));
    break;
  case 'restore':
    if (!backupPath) usage('restore requires a dump path.');
    if (process.env.CONFIRM_RESTORE !== 'voucher-ledger') {
      usage('restore requires CONFIRM_RESTORE=voucher-ledger.');
    }
    await restore(resolve(backupPath));
    break;
  default:
    usage(`Unknown ops command: ${command ?? '(missing)'}.`);
}

async function backup({ failedState }) {
  mkdirSync(backupDir, { recursive: true });
  const filename = `voucher_ledger_${failedState ? 'failed_' : ''}${timestamp()}.dump`;
  const destination = resolve(backupDir, filename);
  const output = createWriteStream(destination, { flags: 'wx' });

  await runDocker(
    [
      'exec',
      '-T',
      'db',
      'sh',
      '-c',
      'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-acl',
    ],
    { stdout: output },
  );
  await finished(output);

  await verifyBackup(destination);
  console.log(`Backup written: ${destination}`);
}

async function restore(dumpPath) {
  assertReadableFile(dumpPath);
  await runDocker(['stop', 'app']);
  await runDocker([
    'exec',
    '-T',
    'db',
    'sh',
    '-c',
    'dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"',
  ]);
  await runDocker(
    [
      'exec',
      '-T',
      'db',
      'sh',
      '-c',
      `${copyStdinToTempSql('restore')} pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-acl "$archive"; status=$?; rm -f "$archive"; exit "$status"`,
    ],
    { stdinFile: dumpPath },
  );
  await runDocker(['up', '-d', 'app']);
  await runDocker(['--profile', 'tools', 'run', '--rm', 'migrate', 'status']);
}

async function verifyBackup(dumpPath) {
  assertReadableFile(dumpPath);
  await runDocker(
    [
      'exec',
      '-T',
      'db',
      'sh',
      '-c',
      `${copyStdinToTempSql('verify')} pg_restore --list "$archive" > "$manifest"; status=$?; rm -f "$archive" "$manifest"; exit "$status"`,
    ],
    { stdinFile: dumpPath },
  );
  console.log(`Backup verified: ${dumpPath}`);
}

function runDocker(args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('docker', [...composeBaseArgs, ...args], {
      cwd: process.cwd(),
      stdio: [
        options.stdinFile ? 'pipe' : 'inherit',
        options.stdout ? 'pipe' : 'inherit',
        'inherit',
      ],
    });

    if (options.stdinFile) {
      const input = createReadStreamForChild(options.stdinFile, child);
      input.on('error', reject);
      child.stdin.on('error', (error) => {
        if (error.code !== 'EPIPE') reject(error);
      });
    }
    if (options.stdout) child.stdout.pipe(options.stdout);

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`docker ${args.join(' ')} exited with ${code}`));
    });
  });
}

function createReadStreamForChild(path, child) {
  const input = createReadStream(path);
  input.pipe(child.stdin);
  return input;
}

function assertReadableFile(path) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`Backup file does not exist: ${path}`);
  }
}

function timestamp() {
  return new Date().toISOString().replaceAll('-', '').replaceAll(':', '').replace(/\..+/, '').replace('T', '_');
}

function shellQuote(value) {
  return value.replace(/[^A-Za-z0-9_.-]/g, '_');
}

function copyStdinToTempSql(prefix) {
  const safePrefix = shellQuote(prefix);
  return `archive="/tmp/voucher_ledger_${safePrefix}_$$.dump"; manifest="/tmp/voucher_ledger_${safePrefix}_$$.manifest"; cat > "$archive" &&`;
}

function usage(message) {
  console.error(message);
  console.error('Usage:');
  console.error('  node scripts/ops/docker-ops.mjs status');
  console.error('  node scripts/ops/docker-ops.mjs backup');
  console.error('  node scripts/ops/docker-ops.mjs failed-backup');
  console.error('  node scripts/ops/docker-ops.mjs verify-backup <dump>');
  console.error('  CONFIRM_RESTORE=voucher-ledger node scripts/ops/docker-ops.mjs restore <dump>');
  process.exit(1);
}
