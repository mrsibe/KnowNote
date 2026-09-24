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
        // Only things rollup CANNOT inline may stay external. Every entry in
        // package.json `dependencies` is already externalized automatically
        // (electron-vite's build.externalizeDeps defaults to true); the two
        // below are restated as documentation of why they can never be bundled.
        //
        // better-sqlite3 (binding) and sqlite-vec (loadable extension) are real
        // binaries: rollup cannot inline .node or .dylib, so they must resolve
        // from node_modules at runtime. They therefore also have to stay in
        // `dependencies` so electron-builder packages them, and in `asarUnpack`
        // so they are not trapped inside the archive.
        //
        // jsdom, pdfjs-dist, anki-apkg-export and @mixmark-io/domino are also
        // external, purely because they live in `dependencies` - it is required,
        // not optional. See the `//dependencies` note in package.json for what
        // breaks when rollup inlines each one. Note that pdfjs-dist in
        // particular does NOT degrade gracefully without its optional peer
        // @napi-rs/canvas: it polyfills DOMMatrix from it and then evaluates
        // `new DOMMatrix()` at module scope, so the two have to ship together.
        external: ['better-sqlite3', 'sqlite-vec']
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
