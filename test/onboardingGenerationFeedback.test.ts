import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string): string => readFileSync(`src/renderer/src/${path}`, 'utf8')

test('background card generation surfaces the actual error to the user', () => {
  const source = read('components/notebook/anki/AnkiConfigDialog.tsx')
  assert.match(source, /toast\.error\(/)
  assert.match(source, /error instanceof Error \? error\.message : String\(error\)/)
  for (const locale of ['zh-CN', 'en-US']) {
    const messages = JSON.parse(read(`locales/${locale}/anki.json`))
    assert.ok(messages.generateFailed.includes('{{error}}'))
  }
})

test('quiz and mind map background failures are caught and surfaced', () => {
  const source = read('components/notebook/NotePanel.tsx')
  assert.equal((source.match(/if \(!result.success\) throw new Error/g) || []).length, 2)
  assert.equal((source.match(/\.catch\(\(error\) =>/g) || []).length, 2)
  assert.ok(source.includes("t('ui:generationFailed'"))
})

test('question entry points and recovery actions surface rejected calls', () => {
  for (const path of [
    'components/notebook/ProcessPanel.tsx',
    'components/notebook/mindmap/NodeDetailPanel.tsx',
    'components/notebook/chat/MessageItem.tsx'
  ]) {
    const source = read(path)
    assert.match(source, /toast\.error\(/)
    assert.match(source, /error instanceof Error \? error.message : String\(error\)/)
  }
  const store = read('store/chatStore.ts')
  assert.ok(store.includes("throw new Error(result.error || 'Failed to retry the answer')"))
  assert.ok(store.includes("throw new Error(result.error || 'Failed to continue the answer')"))
})

test('onboarding offers embedding and chat setup with an explicit skip path', () => {
  const source = read('components/pages/OnboardingPage.tsx')
  assert.match(source, /capability=\{step === 1 \? 'embedding' : 'chat'\}/)
  assert.match(source, /handleNext\(true\)/)
  assert.match(source, /else if \(!skip && connections\)/)
  assert.match(source, /role="alert"/)
  for (const locale of ['zh-CN', 'en-US']) {
    const messages = JSON.parse(read(`locales/${locale}/ui.json`))
    for (const key of ['onboardingEmbeddingHint', 'onboardingChatHint', 'onboardingSkip']) {
      assert.ok(messages[key])
    }
  }
})
