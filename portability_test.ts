import { assert, assertEquals } from '@std/assert';
import { getPortability } from './portability.ts';
import { stub } from 'jsr:@std/testing@1.0.16/mock';

Deno.test('portability', async () => {
  const s = stub(console, 'error', () => {});
  try {
    const port = await getPortability({CC: 'gcc'});
    assert(port);
    assertEquals(s.calls.length, 2);
  } finally {
    s.restore();
  }
});
