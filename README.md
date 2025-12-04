# mmap-ffi

Use [mmap(2)](https://www.man7.org/linux/man-pages/man2/mmap.2.html) and
[madvise(2)](https://www.man7.org/linux/man-pages/man2/madvise.2.html) from
deno, without needing any native code.

## Example

```ts
import { MMap } from '@cto-af/mmap-ffi';

using m = new MMap('myFile');
const buf = await m.map(); // Uint8Array
```

## Required permissions

- `--allow-ffi`, which can be revoked after the constructor runs. If you can
  figure out how to limit this permission just to libc (or libSystem on MacOS),
  please file a GitHub issue.
- `--allow-read=myFile` and/or `--allow-write=myFile` (based on the flags
  option to the constructor), which is enforced by this package during the
  call to `map()`. Explicit enforcement is chosen since this package would
  otherwise allow you to bypass the Deno permissions system.

## Approach

Uses Deno's
[Foreign Function Interface](https://docs.deno.com/api/deno/~/Deno.dlopen)
to open libc at runtime.

## Platform Support

Only tested on Linux and MacOS for now. It should work on other POSIX-based
OSes, but you may need to pass in the `libCname` option.

I will gladly accept patches or issues related to non-Windows OS support.

I will take a good patch for Windows support that includes adequate testing.

## Prior Art

[@riaskov/mmap](https://jsr.io/@riaskov/mmap) came close to what I needed, but
it still required downloading compiled rust code, and did not have binaries
pre-built for my platform.

# License

MIT

[![Test Deno Module](https://github.com/hildjj/mmap-ffi/actions/workflows/deno.yml/badge.svg)](https://github.com/hildjj/mmap-ffi/actions/workflows/deno.yml)
[![codecov](https://codecov.io/gh/hildjj/mmap-ffi/graph/badge.svg?token=TMSJBTO73Z)](https://codecov.io/gh/hildjj/mmap-ffi)
