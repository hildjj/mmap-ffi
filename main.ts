import { assert } from '@std/assert';
import { fromFileUrl } from '@std/path/from-file-url';

const libCnames: Record<string, string> = {
  'darwin': 'libSystem.dylib',
  'linux': 'libc.so.6',
};

const O_RDONLY = 0;
const O_RDWR = 2;
const PROT_READ = 1;
const PROT_WRITE = 2;
const MAP_SHARED = 1;
const MAP_FAILED = Deno.UnsafePointer.create(-1n);

const LIBC_LAYOUT = {
  open: { parameters: ['buffer', 'i32', 'i32'], result: 'i32' },
  mmap: {
    parameters: ['pointer', 'usize', 'i32', 'i32', 'i32', 'i64'],
    result: 'pointer',
  },
  madvise: { parameters: ['pointer', 'usize', 'i32'], result: 'i32' },
  munmap: { parameters: ['pointer', 'usize'], result: 'i32' },
  close: { parameters: ['i32'], result: 'i32' },
  strerror: { parameters: ['i32'], result: 'pointer' },
  errno: { type: 'pointer' },
} as const;

export enum MmapFlags {
  ReadOnly,
  WriteOnly,
  ReadWrite,
}

export interface MMapOptions {
  /**
   * Read, write, or both?
   *
   * @default MmapFlags.ReadOnly
   */
  flags?: MmapFlags;
  /**
   * Offset to start reading from in file.  On some OSes, this must be a multiple
   * of the page size, often 4096.
   *
   * @default 0n
   */
  offset?: bigint;
  /**
   * Amount of file to read.  -1n, the default, asks for the full file to be
   * mapped.
   * @default -1
   */
  size?: bigint;
  /**
   * Override the selection of libSystem.dylib on MacOs or libc.so.6 on linux
   * by supplying a libc name that works on your system.
   */
  libCname?: string;
}

const TE = new TextEncoder();

/**
 * What kind of advice to give the kernel?  These should match the
 * POSIX definitions.
 */
export enum Advice {
  NORMAL = 0,
  RANDOM = 1,
  SEQUENTIAL = 2,
  WILLNEED = 3,
  DONTNEED = 4,
}

export class MMap {
  #fileName: string;
  #fd = -1;
  #size: bigint;
  #ptr = Deno.UnsafePointer.create(-1n);
  #prot = 0;
  #libc: Deno.DynamicLibrary<typeof LIBC_LAYOUT> | undefined;
  #opts: Required<MMapOptions>;

  public constructor(fileName: string | URL, opts: MMapOptions = {}) {
    const { os } = Deno.build;
    this.#opts = {
      flags: MmapFlags.ReadOnly,
      offset: 0n,
      size: -1n,
      libCname: libCnames[os],
      ...opts,
    };

    if ((fileName instanceof URL) || fileName.startsWith('file:')) {
      fileName = fromFileUrl(fileName.toString());
    }
    this.#fileName = fileName;
    this.#size = this.#opts.size;
    this.#libc = Deno.dlopen(this.#opts.libCname, LIBC_LAYOUT);
  }

  public async map(): Promise<Uint8Array> {
    if (!this.#libc) {
      throw new Error('Already closed');
    }
    await this.#ensureOpen();

    if (this.#mapped) {
      throw new Error('Already mapped');
    }

    if (this.#size < 0n) {
      this.#size = await this.#fileSize();
    }

    this.#ptr = this.#libc.symbols.mmap(
      null,
      this.#size,
      this.#prot,
      MAP_SHARED,
      this.#fd,
      this.#opts.offset,
    );
    if (!this.#mapped) {
      this.#perror('mmap');
    }
    assert(this.#ptr);
    const buf = new Uint8Array(Deno.UnsafePointerView.getArrayBuffer(
      this.#ptr,
      Number(this.#size),
    ));

    // @ts-expect-error For testing only.
    if (typeof this.#opts.RESET_SIZE === 'bigint') {
      // @ts-expect-error For testing only.
      this.#size = this.#opts.RESET_SIZE;
    }
    return buf;
  }

  advise(advice: Advice): void {
    if (!this.#libc) {
      throw new Error('Already closed');
    }
    if (!this.#mapped) {
      throw new Error('Must call map before advise');
    }

    if (this.#libc.symbols.madvise(this.#ptr, this.#size, advice) !== 0) {
      this.#perror('madvise');
    }
  }

  [Symbol.dispose](): void {
    this.close();
  }

  close(): void {
    if (this.#mapped) {
      assert(this.#libc);
      const munmapRes = this.#libc.symbols.munmap(this.#ptr, this.#size);
      this.#ptr = MAP_FAILED;
      if (munmapRes !== 0) {
        this.#perror('munmap');
      }
    }

    if (this.#fd >= 0) {
      assert(this.#libc);
      const ret = this.#libc.symbols.close(this.#fd);
      this.#fd = -1;
      if (ret !== 0) {
        this.#perror('close');
      }
    }

    if (this.#libc) {
      this.#libc.close();
      this.#libc = undefined;
    }
  }

  get #mapped(): boolean {
    return !Deno.UnsafePointer.equals(this.#ptr, MAP_FAILED);
  }

  async #ensureOpen(): Promise<void> {
    if (this.#fd >= 0) {
      return;
    }
    assert(this.#libc);

    let flags = 0;
    switch (this.#opts.flags) {
      case MmapFlags.ReadOnly:
        this.#prot = PROT_READ;
        flags = O_RDONLY;
        await this.#permit({ name: 'read', path: this.#fileName });
        break;
      case MmapFlags.ReadWrite:
        this.#prot = PROT_READ | PROT_WRITE;
        flags = O_RDWR;
        await this.#permit({ name: 'read', path: this.#fileName });
        await this.#permit({ name: 'write', path: this.#fileName });
        break;
      case MmapFlags.WriteOnly:
        this.#prot = PROT_WRITE;
        // Required for mmap to work.
        flags = O_RDWR;
        await this.#permit({ name: 'write', path: this.#fileName });
        break;
      default:
        throw new Error(`Invalid flags: ${this.#opts.flags}`);
    }
    const fn = TE.encode(`${this.#fileName}\0`);
    this.#fd = this.#libc.symbols.open(fn, flags, 0);
    if (this.#fd < 0) {
      this.#perror(`open "this.#fileName"`);
    }
  }

  async #fileSize(): Promise<bigint> {
    const stat = await Deno.stat(this.#fileName);
    return BigInt(stat.size);
  }

  async #permit(desc: Deno.PermissionDescriptor): Promise<void> {
    // We are going around the Deno permissions, so let's add them back in.
    const rd = await Deno.permissions.request(desc);
    if (rd.state !== 'granted') {
      throw new Deno.errors.PermissionDenied(
        `Need ${desc.name} permission for ${this.#fileName}, but state is "${rd.state}".`,
      );
    }
  }

  #perror(where: string): void {
    assert(this.#libc?.symbols.errno);
    const errnoPtr = new Deno.UnsafePointerView(this.#libc.symbols.errno);
    const errno = errnoPtr.getInt32();
    const msgPtrValue = this.#libc.symbols.strerror(errno);
    assert(msgPtrValue);
    const msgView = new Deno.UnsafePointerView(msgPtrValue);
    const msg = msgView.getCString();

    try {
      // Could be called multiple times, be careful of resetting state before
      // calling perror.
      this.close();
    } catch (_ignored) {
      // Ignored.
    }

    throw new Error(`Error in ${where}(${errno}): ${msg}`);
  }
}
