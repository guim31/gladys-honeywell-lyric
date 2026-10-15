// -----------------------------------------------------------------------------
// The Resideo tokens, under /data (the only writable path of the container),
// so a restart does not ask the user to sign in again. The file is readable
// by the container user only. Losing it is harmless: the user clicks
// "Connect" again.
// (Write pattern adapted from guim31/gladys-pihole.)
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'lyric-store' });
const FILE_NAME = 'resideo-tokens.json';

export class TokenStore {
  constructor(directory = process.env.LYRIC_DATA_DIR || '/data') {
    this.directory = directory;
    this.path = join(directory, FILE_NAME);
    this.writing = Promise.resolve();
  }

  async load() {
    try {
      const data = JSON.parse(await readFile(this.path, 'utf8'));
      return data && typeof data === 'object' ? data : null;
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // The message names the file, never its content.
        logger.warn(`Cannot read ${this.path}: ${err.code ?? 'invalid content'}`);
      }
      return null;
    }
  }

  // One writer at a time, atomic (temporary file + rename): a crash never
  // leaves half a JSON file behind.
  save(data) {
    this.writing = this.writing.then(async () => {
      try {
        await mkdir(this.directory, { recursive: true });
        const temporary = `${this.path}.tmp`;
        await writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
        await rename(temporary, this.path);
      } catch (err) {
        logger.warn(`Cannot write ${this.path}: ${err.code ?? err.message}`);
      }
    });
    return this.writing;
  }

  clear() {
    this.writing = this.writing.then(() => rm(this.path, { force: true }).catch(() => {}));
    return this.writing;
  }

  /** Resolves once every write requested so far is on disk. */
  flush() {
    return this.writing;
  }
}
