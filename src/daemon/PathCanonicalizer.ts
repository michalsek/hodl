import fs from 'node:fs/promises';
import path from 'node:path';

import { DaemonError, isNodeErrorWithCode } from './Errors.js';

export async function canonicalizeAbsoluteFilePath(inputPath: string): Promise<string> {
  if (!path.isAbsolute(inputPath)) {
    throw new DaemonError(400, 'path_must_be_absolute', 'The `path` must be absolute.');
  }

  const normalizedPath = path.normalize(inputPath);

  try {
    const realPath = await fs.realpath(normalizedPath);
    const stats = await fs.stat(realPath);

    if (stats.isDirectory()) {
      throw new DaemonError(400, 'path_is_directory', 'Directories cannot be locked.');
    }

    if (!stats.isFile()) {
      throw new DaemonError(400, 'path_is_not_file', 'Only regular files can be locked.');
    }

    return realPath;
  } catch (error) {
    if (!isNodeErrorWithCode(error) || error.code !== 'ENOENT') {
      throw error;
    }
  }

  const parentPath = path.dirname(normalizedPath);
  const baseName = path.basename(normalizedPath);

  try {
    const realParentPath = await fs.realpath(parentPath);
    const candidatePath = path.join(realParentPath, baseName);

    try {
      const stats = await fs.stat(candidatePath);

      if (stats.isDirectory()) {
        throw new DaemonError(400, 'path_is_directory', 'Directories cannot be locked.');
      }

      if (!stats.isFile()) {
        throw new DaemonError(400, 'path_is_not_file', 'Only regular files can be locked.');
      }
    } catch (error) {
      if (!isNodeErrorWithCode(error) || error.code !== 'ENOENT') {
        throw error;
      }
    }

    return candidatePath;
  } catch (error) {
    if (error instanceof DaemonError) {
      throw error;
    }

    if (isNodeErrorWithCode(error) && error.code === 'ENOENT') {
      throw new DaemonError(
        404,
        'parent_path_missing',
        'The parent directory does not exist for the requested path.'
      );
    }

    throw error;
  }
}

export async function canonicalizeAbsolutePathPrefix(inputPath: string): Promise<string> {
  if (!path.isAbsolute(inputPath)) {
    throw new DaemonError(400, 'prefix_must_be_absolute', 'The `prefix` must be absolute.');
  }

  const normalizedPath = path.normalize(inputPath);

  try {
    return await fs.realpath(normalizedPath);
  } catch (error) {
    if (!isNodeErrorWithCode(error) || error.code !== 'ENOENT') {
      throw error;
    }
  }

  const parentPath = path.dirname(normalizedPath);
  const baseName = path.basename(normalizedPath);

  try {
    const realParentPath = await fs.realpath(parentPath);
    return path.join(realParentPath, baseName);
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === 'ENOENT') {
      throw new DaemonError(
        404,
        'prefix_parent_missing',
        'The parent directory does not exist for the requested prefix.'
      );
    }

    throw error;
  }
}
