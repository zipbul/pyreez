/**
 * Report module types — file I/O abstraction and call recording.
 */

/**
 * Abstraction over file system I/O for testability.
 */
export interface FileIO {
  /** Append data to a file, creating it if it doesn't exist. */
  appendFile(path: string, data: string): Promise<void>;
  /** Read entire file as string. */
  readFile(path: string): Promise<string>;
  /** Write entire file as string (overwrites). */
  writeFile(path: string, data: string): Promise<void>;
  /** Create directory recursively. */
  mkdir(path: string): Promise<void>;
  /** Return file paths matching a glob pattern. Sorted ascending. */
  glob(pattern: string): Promise<string[]>;
  /** Rename/move a file (used for atomic write-then-swap). */
  rename(from: string, to: string): Promise<void>;
}
