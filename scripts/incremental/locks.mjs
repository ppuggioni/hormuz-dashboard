import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import os from 'node:os';
import { ensureStateLayout, resolveStateLayout } from './state-layout.mjs';

export class PipelineLockConflictError extends Error {
  constructor(message, lockInfo) {
    super(message);
    this.name = 'PipelineLockConflictError';
    this.lockInfo = lockInfo;
  }
}

async function readLockFile(lockPath) {
  try {
    const raw = await fs.readFile(lockPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

export async function readPipelineLock(options = {}) {
  const layout = resolveStateLayout(options);
  return readLockFile(layout.pipelineLockPath);
}

export async function acquirePipelineLock(mode, options = {}) {
  if (!['hot', 'cold'].includes(mode)) {
    throw new TypeError(`Unsupported pipeline lock mode: ${mode}`);
  }

  const layout = await ensureStateLayout(options);
  const lockInfo = {
    lockId: crypto.randomUUID(),
    mode,
    pid: process.pid,
    hostname: os.hostname(),
    createdAt: new Date().toISOString(),
  };

  try {
    const handle = await fs.open(layout.pipelineLockPath, 'wx');
    try {
      await handle.writeFile(`${JSON.stringify(lockInfo, null, 2)}\n`, 'utf8');
    } finally {
      await handle.close();
    }
    return lockInfo;
  } catch (err) {
    if (err?.code !== 'EEXIST') throw err;
    const existingLock = await readLockFile(layout.pipelineLockPath);
    throw new PipelineLockConflictError(
      `Cannot acquire ${mode} pipeline lock; another pipeline writer is active`,
      existingLock,
    );
  }
}

export async function releasePipelineLock(lockInfo, options = {}) {
  const layout = resolveStateLayout(options);
  const existingLock = await readLockFile(layout.pipelineLockPath);
  if (!existingLock) return false;
  if (lockInfo?.lockId && existingLock.lockId !== lockInfo.lockId) {
    throw new PipelineLockConflictError('Refusing to release a pipeline lock owned by another run', existingLock);
  }
  await fs.unlink(layout.pipelineLockPath);
  return true;
}

export async function withPipelineLock(mode, fn, options = {}) {
  const lockInfo = await acquirePipelineLock(mode, options);
  try {
    return await fn(lockInfo);
  } finally {
    await releasePipelineLock(lockInfo, options);
  }
}
