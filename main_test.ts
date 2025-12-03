import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert';
import { Advice, MmapFlags, MMap } from './main.ts';

const TD = new TextDecoder();

Deno.test('MMap defaults', async () => {
  const mmap = new MMap(new URL(import.meta.url));
  assertThrows(() => mmap.advise(Advice.SEQUENTIAL), Error, 'Must call map before advise');
  const buf = await mmap.map();
  await assertRejects(() => mmap.map(), Error, 'Already mapped');
  mmap.advise(Advice.SEQUENTIAL);
  assertThrows(() => mmap.advise(100 as Advice), Error, 'Invalid advice');
  assertEquals(TD.decode(buf.subarray(0, 6)), 'import');
  mmap.advise(Advice.WILLNEED);
  mmap.advise(Advice.DONTNEED);
  mmap.advise(Advice.NORMAL);
  mmap.advise(Advice.RANDOM);
  mmap.close();
  await assertRejects(() => mmap.map());
  assertThrows(() => mmap.advise(Advice.SEQUENTIAL), Error, 'Already closed');
});

Deno.test('MMap bad flags', async () => {
  const mmap = new MMap(import.meta.url, {flags: 100 as MmapFlags});
  assertRejects(() => mmap.map(), Error, 'Invalid flags');
  mmap.close();
  mmap.close();
});
