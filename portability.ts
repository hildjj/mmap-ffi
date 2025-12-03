import { fromFileUrl } from '@std/path/from-file-url';

export type Portability = {
  statOffset: number;
  statSize: number;
  O_RDONLY: number;
  O_WRONLY: number;
  O_RDWR: number;
  PROT_READ: number;
  PROT_WRITE: number;
  MADV_NORMAL: number;
  MADV_RANDOM: number;
  MADV_SEQUENTIAL: number;
  MADV_WILLNEED: number;
  MADV_DONTNEED: number;
  MAP_FAILED: number;
  MAP_SHARED: number;
};

export async function getPortability(opts: {CC: string}): Promise<Portability> {
  console.error(`Portability constants not found for ${Deno.build.target},
attempting to compile a small C program to detect them.`);
  const out = fromFileUrl(new URL('offset', import.meta.url));
  const gcc = new Deno.Command(opts.CC, {
    args: [
      fromFileUrl(new URL('offset.c', import.meta.url)),
      '-o',
      out,
    ],
  });
  await gcc.spawn().status;

  const outCmd = new Deno.Command(out, {
    stdout: 'piped',
  });
  const process = outCmd.spawn();
  const stdout = await process.stdout.text();
  await process.status;

  await Deno.remove(out);

  console.error(`\
Add the following to ${import.meta.url} in PORTABILITY:

  "${Deno.build.target}": ${stdout.trim()},
`);
  return JSON.parse(stdout);
}
