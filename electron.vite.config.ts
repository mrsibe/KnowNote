import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { copyFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

// 复制迁移文件的插件
function copyMigrationsPlugin() {
  return {
    name: 'copy-migrations',
    closeBundle() {
      const srcDir = resolve('src/main/db/migrations')
      const destDir = resolve('out/main/db/migrations')

      // 递归复制目录
      function copyDir(src: string, dest: string) {
        if (!existsSync(dest)) {
          mkdirSync(dest, { recursive: true })
        }

        const entries = readdirSync(src)
        for (const entry of entries) {
          const srcPath = join(src, entry)
          const destPath = join(dest, entry)

          if (statSync(srcPath).isDirectory()) {
            copyDir(srcPath, destPath)
          } else {
            copyFileSync(srcPath, destPath)
          }
        }
      }

      if (existsSync(srcDir)) {
        copyDir(srcDir, destDir)
        console.log('[Migrations] Copied migration files to', destDir)
      }
    }
  }
}

export default defineConfig({
  main: {
    plugins: [copyMigrationsPlugin()],
    build: {
      rollupOptions: {
        // Only things rollup CANNOT inline may stay external.
        //
        // Native addons: better-sqlite3 (binding) and sqlite-vec (loadable
        // extension) are real binaries. They must be resolved from node_modules
        // at runtime and must therefore also stay in package.json
        // `dependencies` so electron-builder packages them, and in
        // `asarUnpack` so they are not trapped inside the archive.
        //
        // Optional native peers that jsdom and pdfjs-dist reach for lazily:
        // listing them keeps rollup from failing on an unresolvable import.
        // They are intentionally NOT in `dependencies`, so they are simply
        // absent at runtime - both packages degrade gracefully (jsdom without
        // node-canvas, pdfjs without @napi-rs/canvas, which is only used by
        // page.render() and this app never renders).
        external: ['better-sqlite3', 'sqlite-vec', 'canvas', '@napi-rs/canvas']
      }
    }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [tailwindcss(), react()]
  }
})
