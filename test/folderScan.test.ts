import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanFolder } from '../src/main/services/ingestion/folderScan.ts'

/**
 * Folder import is a **snapshot, not a watch** (#98). These pin what "a snapshot"
 * means: supported extensions only, recursion into real subdirectories, hidden
 * directories skipped, and a deterministic order so two imports of the same folder
 * produce the same list.
 */

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'knownote-scan-'))
  mkdirSync(join(root, 'nested'))
  mkdirSync(join(root, '.hidden'))
  mkdirSync(join(root, 'sub', '.git'), { recursive: true })

  writeFileSync(join(root, 'a.pdf'), 'pdf')
  writeFileSync(join(root, 'b.md'), 'md')
  writeFileSync(join(root, 'c.txt'), 'txt')
  writeFileSync(join(root, 'nested', 'd.pptx'), 'pptx')
  writeFileSync(join(root, '.hidden', 'e.pdf'), 'pdf')
  writeFileSync(join(root, 'sub', '.git', 'f.pdf'), 'pdf')

  return root
}

test('a scan finds supported files recursively and skips the rest', async () => {
  const root = fixture()
  try {
    const files = await scanFolder(root, ['pdf', 'md', 'pptx'])
    const relative = files.map((file) => file.relativePath)

    // `c.txt` is not a supported extension, and both hidden trees are skipped.
    assert.deepEqual(relative, ['a.pdf', 'b.md', join('nested', 'd.pptx')])
    for (const file of files) assert.ok(file.path.startsWith(root))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the scan is deterministic regardless of directory order', async () => {
  const root = fixture()
  try {
    const first = await scanFolder(root, ['pdf', 'md', 'pptx'])
    const second = await scanFolder(root, ['pdf', 'md', 'pptx'])
    assert.deepEqual(
      first.map((file) => file.relativePath),
      second.map((file) => file.relativePath)
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an extension is matched case-insensitively', async () => {
  const root = mkdtempSync(join(tmpdir(), 'knownote-scan-'))
  try {
    writeFileSync(join(root, 'SHOUTY.PDF'), 'pdf')
    const files = await scanFolder(root, ['pdf'])
    assert.deepEqual(
      files.map((file) => file.relativePath),
      ['SHOUTY.PDF']
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
