import { assert } from '@std/assert';
import { getPortability, type Portability } from './portability.ts';
import { fromFileUrl } from '@std/path/from-file-url';

export type {
  Portability,
};

// TODO(hildjj): Fill this out for every supported OS
const PORTABILITY: Record<string, Portability> = {
  'aarch64-apple-darwin': {
    statOffset: 96,
    statSize: 144,
    O_RDONLY: 0,
    O_WRONLY: 1,
    O_RDWR: 2,
    PROT_READ: 1,
    PROT_WRITE: 2,
    MADV_NORMAL: 0,
    MADV_RANDOM: 1,
    MADV_SEQUENTIAL: 2,
    MADV_WILLNEED: 3,
    MADV_DONTNEED: 4,
    MAP_FAILED: -1,
    MAP_SHARED: 1,
  },
  'aarch64-unknown-linux-gnu': {
    statOffset: 48,
    statSize: 128,
    O_RDONLY: 0,
    O_WRONLY: 1,
    O_RDWR: 2,
    PROT_READ: 1,
    PROT_WRITE: 2,
    MADV_NORMAL: 0,
    MADV_RANDOM: 1,
    MADV_SEQUENTIAL: 2,
    MADV_WILLNEED: 3,
    MADV_DONTNEED: 4,
    MAP_FAILED: -1,
    MAP_SHARED: 1,
  },
  'x86_64-unknown-linux-gnu': {
    statOffset: 48, statSize: 144,
    O_RDONLY: 0, O_WRONLY: 1, O_RDWR: 2,
    PROT_READ: 1, PROT_WRITE: 2,
    MADV_NORMAL: 0, MADV_RANDOM: 1, MADV_SEQUENTIAL: 2, MADV_WILLNEED: 3, MADV_DONTNEED: 4,
    MAP_FAILED: -1, MAP_SHARED: 1,
  }
};

const libCnames: Record<string, string> = {
  'darwin': 'libSystem.dylib',
  'linux': 'libc.so.6',
};

const LIBC_LAYOUT = {
  open: { parameters: ['buffer', 'i32', 'i32'], result: 'i32' },
  mmap: {
    parameters: ['pointer', 'usize', 'i32', 'i32', 'i32', 'i64'],
    result: 'pointer',
  },
  madvise: { parameters: ['pointer', 'usize', 'i32'], result: 'i32' },
  munmap: { parameters: ['pointer', 'usize'], result: 'i32' },
  close: { parameters: ['i32'], result: 'i32' },
  fstat: { parameters: ['i32', 'pointer'], result: 'i32' },
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
   * Set of portability parameters, discovered with offset.c.  If your system
   * is not supported out of the box, and you don't want offset.c to be compiled
   * and run on your target system, supply an object here consisting of
   * `{[Deno.build.target]: {...}}`.  If supplied, this map will *replace*
   * the existing set of known targets, which can be accessed from
   * MMap.PORTABILITY if needed.
   */
  portability?: Record<string, Portability>;
  /**
   * Override the selection of libSystem.dylib on MacOs or libc.so.6 on linux
   * by supplying a libc name that works on your system.
   */
  libCname?: string;
  /**
   * This option is only for testing.  It can be used to override
   *
   * @default Deno.build.target
   */
  target?: string;
  /**
   * Which C compiler to use, if needed?
   *
   * @default Deno.env.get('CC') ?? 'gcc'
   */
  CC?: string;
}

const TE = new TextEncoder();

export enum Advice {
  NORMAL,
  RANDOM,
  SEQUENTIAL,
  WILLNEED,
  DONTNEED,
}

export class MMap {
  public static PORTABILITY = PORTABILITY;
  #fileName: string;
  #fd = -1;
  #size: bigint;
  #ptr = Deno.UnsafePointer.create(-1n);
  #prot = 0;
  #libc: Deno.DynamicLibrary<typeof LIBC_LAYOUT> | undefined;
  #mapFailed = Deno.UnsafePointer.create(-1n);
  #port: Portability | undefined;
  #opts: Required<MMapOptions>;

  public constructor(fileName: string | URL, opts: MMapOptions = {}) {
    const { target, os } = Deno.build;
    this.#opts = {
      flags: MmapFlags.ReadOnly,
      offset: 0n,
      size: -1n,
      target,
      portability: MMap.PORTABILITY,
      libCname: libCnames[os],
      CC: Deno.env.get('CC') ?? 'gcc',
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
    await this.#init();
    assert(this.#port);

    if (this.#mapped) {
      throw new Error('Already mapped');
    }

    if (this.#size < 0n) {
      this.#size = this.#fileSize();
    }

    this.#ptr = this.#libc.symbols.mmap(
      null,
      this.#size,
      this.#prot,
      this.#port.MAP_SHARED,
      this.#fd,
      this.#opts.offset,
    );
    if (!this.#mapped) {
      this.#perror('mmap');
    }
    assert(this.#ptr);
    return new Uint8Array(Deno.UnsafePointerView.getArrayBuffer(
      this.#ptr,
      Number(this.#size),
    ));
  }

  advise(advice: Advice): void {
    if (!this.#libc) {
      throw new Error('Already closed');
    }
    if (!this.#mapped) {
      throw new Error('Must call map before advise');
    }
    assert(this.#port);

    let ad = 0;
    switch (advice) {
      case Advice.NORMAL:
        ad = this.#port.MADV_NORMAL;
        break;
      case Advice.RANDOM:
        ad = this.#port.MADV_RANDOM;
        break;
      case Advice.SEQUENTIAL:
        ad = this.#port.MADV_SEQUENTIAL;
        break;
      case Advice.WILLNEED:
        ad = this.#port.MADV_WILLNEED;
        break;
      case Advice.DONTNEED:
        ad = this.#port.MADV_DONTNEED;
        break;
      default:
        throw new Error(`Invalid advice: ${advice}`);
    }
    if (this.#libc.symbols.madvise(this.#ptr, this.#size, ad) !== 0) {
      this.#perror('madvise');
    }
  }

  close(): void {
    if (this.#mapped) {
      assert(this.#libc);
      const munmapRes = this.#libc.symbols.munmap(this.#ptr, this.#size);
      this.#ptr = this.#mapFailed;
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
    return !Deno.UnsafePointer.equals(this.#ptr, this.#mapFailed);
  }

  async #init(): Promise<void> {
    assert(this.#libc);
    if (this.#port) {
      return;
    }

    const { target, portability } = this.#opts;
    this.#port = portability[target];
    if (!this.#port) {
      this.#port = await getPortability(this.#opts);
      MMap.PORTABILITY[target] = this.#port; // Cache
    }

    this.#mapFailed = Deno.UnsafePointer.create(BigInt(this.#port.MAP_FAILED));
    this.#ptr = this.#mapFailed;

    let flags = 0;
    switch (this.#opts.flags) {
      case MmapFlags.ReadOnly:
        this.#prot = this.#port.PROT_READ;
        flags = this.#port.O_RDONLY;
        await this.#permit({name: 'read', path: this.#fileName});
        break;
      case MmapFlags.ReadWrite:
        this.#prot = this.#port.PROT_READ | this.#port.PROT_WRITE;
        flags = this.#port.O_RDWR;
        await this.#permit({name: 'read', path: this.#fileName});
        await this.#permit({name: 'write', path: this.#fileName});
        break;
      case MmapFlags.WriteOnly:
        this.#prot = this.#port.PROT_WRITE;
        flags = this.#port.O_WRONLY;
        await this.#permit({name: 'write', path: this.#fileName});
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

  #fileSize(): bigint {
    assert(this.#libc);
    assert(this.#port);
    const statBuf = new Uint8Array(this.#port.statSize);
    const statPtr = Deno.UnsafePointer.of(statBuf);
    if (this.#libc.symbols.fstat(this.#fd, statPtr) !== 0) {
      this.#perror('fstat');
    }
    return new DataView(statBuf.buffer).getBigUint64(
      this.#port.statOffset,
      true,
    );
  }

  async #permit(desc: Deno.PermissionDescriptor): Promise<void> {
    // We are going around the Deno permissions, so let's add them back in.
    const rd = await Deno.permissions.request(desc);
    if (rd.state !== 'granted') {
      throw new Deno.errors.PermissionDenied(`Need ${desc.name} permission for ${this.#fileName}`);
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
