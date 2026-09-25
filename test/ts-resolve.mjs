/**
 * Node test loader: resolve extensionless relative imports to `.ts`.
 *
 * The main/renderer sources are written with extensionless relative imports and
 * bundled by electron-vite, so `node --test` cannot resolve them directly. This
 * hook adds `.ts` resolution for relative specifiers so tests can import
 * main-process modules as-is, without rewriting the source conventions. Both
 * shapes the sources use are covered: `./logger` -> `logger.ts` and
 * `../../shared/types` -> `shared/types/index.ts`.
 */

import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      (specifier.startsWith('./') || specifier.startsWith('../')) &&
      !/\.[a-zA-Z0-9]+$/.test(specifier) &&
      context.parentURL?.startsWith('file:')
    ) {
      const base = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier)
      for (const candidate of [`${base}.ts`, resolvePath(base, 'index.ts')]) {
        if (existsSync(candidate)) {
          return nextResolve(pathToFileURL(candidate).href, context)
        }
      }
    }
    return nextResolve(specifier, context)
  }
})
