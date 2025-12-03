import { assertEquals, assertRejects, assertThrows } from '@std/assert';
import { Advice, MMap, MmapFlags } from './main.ts';

const TD = new TextDecoder();

Deno.test('MMap defaults', async () => {
  const mmap = new MMap(new URL(import.meta.url));
  assertThrows(
    () => mmap.advise(Advice.SEQUENTIAL),
    Error,
    'Must call map before advise',
  );
  const buf = await mmap.map();
  await assertRejects(() => mmap.map(), Error, 'Already mapped');
  mmap.advise(Advice.SEQUENTIAL);
  assertEquals(TD.decode(buf.subarray(0, 6)), 'import');
  assertThrows(() => mmap.advise(100 as Advice));
  mmap.close();
  await assertRejects(() => mmap.map());
  assertThrows(() => mmap.advise(Advice.SEQUENTIAL), Error, 'Already closed');
});

Deno.test('MMap bad flags', async () => {
  const mmap = new MMap(import.meta.url, { flags: 100 as MmapFlags });
  await assertRejects(() => mmap.map(), Error, 'Invalid flags');
  mmap.close();
  mmap.close();
});

Deno.test('MMap bad offset', async () => {
  // Must be an offset of pagesize, which is 16384 on my machine.
  const mmap = new MMap(import.meta.url, { offset: 1n });
  await assertRejects(() => mmap.map(), Error, 'Error in mmap');
  mmap.close();
});

Deno.test('MMap checks permissions: Read', async () => {
  using mmap = new MMap(new URL('main.ts', import.meta.url), {
    flags: MmapFlags.ReadWrite,
  });
  await assertRejects(() => mmap.map(), Error, 'Need read permission');
});

Deno.test('MMap checks permissions: Write', async () => {
  using mmap = new MMap(import.meta.url, {
    flags: MmapFlags.WriteOnly,
  });
  await assertRejects(() => mmap.map(), Error, 'Need write permission');
});

Deno.test('MMap checks permissions: ReadWrite (read)', async () => {
  using mmap = new MMap(new URL('main.ts', import.meta.url), {
    flags: MmapFlags.ReadWrite,
  });
  await assertRejects(() => mmap.map(), Error, 'Need read permission');
});

Deno.test('MMap checks permissions: ReadWrite (write)', async () => {
  using mmap = new MMap(import.meta.url, {
    flags: MmapFlags.ReadWrite,
  });
  await assertRejects(() => mmap.map(), Error, 'Need write permission');
});

Deno.test('Unknown file', async () => {
  using mmap = new MMap(new URL('__UNKNOWN___FILE__BAD', import.meta.url));
  await assertRejects(() => mmap.map());
});

Deno.test('munmap fail', async () => {
  // @ts-expect-error Hack to get munmap to fail.
  const mmap = new MMap(import.meta.url, { RESET_SIZE: -1n });
  await mmap.map();
  assertThrows(() => mmap.close());
});

Deno.test('readWrite', async () => {
  using mmap = new MMap(new URL('deno.jsonc', import.meta.url), {
    flags: MmapFlags.ReadWrite,
  });
  const buf = await mmap.map();
  assertEquals(buf[0], '{'.charCodeAt(0));
});

Deno.test('writeOnly', async () => {
  const fn = new URL('__UNKNOWN___FILE__GOOD', import.meta.url);
  await Deno.writeTextFile(fn, '012345');
  const mmap = new MMap(fn, {
    flags: MmapFlags.WriteOnly,
  });
  const buf = await mmap.map();
  buf[0] = 10;
  mmap.close();
  const res = await Deno.readTextFile(fn);
  assertEquals(res, '\n12345');
  await Deno.remove(fn);
});
