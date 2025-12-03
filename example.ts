import { Advice, MMap } from './main.ts';

async function main(): Promise<void> {
  using m = new MMap('deno.jsonc');
  const u8 = await m.map();
  m.advise(Advice.SEQUENTIAL);
  console.log(new TextDecoder().decode(u8.subarray(0, -1)));
}

if (import.meta.main) {
  main().catch(console.error);
}
