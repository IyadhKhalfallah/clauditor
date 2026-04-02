import { defineConfig } from 'tsup'

export default defineConfig([
  // CLI entry — needs shebang for `npx clauditor`
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    target: 'node20',
    splitting: false,
    sourcemap: true,
    clean: true,
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
  // Library + hook entries — no shebang
  {
    entry: {
      index: 'src/index.ts',
      'hooks/stop': 'src/hooks/stop.ts',
      'hooks/post-tool-use': 'src/hooks/post-tool-use.ts',
      'hooks/pre-tool-use': 'src/hooks/pre-tool-use.ts',
      'hooks/pre-compact': 'src/hooks/pre-compact.ts',
      'hooks/user-prompt-submit': 'src/hooks/user-prompt-submit.ts',
      'hooks/session-start': 'src/hooks/session-start.ts',
    },
    format: ['esm'],
    target: 'node20',
    splitting: true,
    sourcemap: true,
    dts: true,
  },
])
