import assert from 'node:assert/strict'
import test from 'node:test'

import { extractGitHubRepoSlug } from './repoSlug.ts'

test('keeps owner/repo input as-is', () => {
  assert.equal(extractGitHubRepoSlug('HIMAVARASAGAR/Soteria'), 'HIMAVARASAGAR/Soteria')
})

test('extracts slug from https GitHub URLs', () => {
  assert.equal(
    extractGitHubRepoSlug('https://github.com/HIMAVARASAGAR/Soteria'),
    'HIMAVARASAGAR/Soteria',
  )
  assert.equal(
    extractGitHubRepoSlug('https://www.github.com/HIMAVARASAGAR/Soteria.git'),
    'HIMAVARASAGAR/Soteria',
  )
})

test('extracts slug from ssh GitHub URLs', () => {
  assert.equal(
    extractGitHubRepoSlug('git@github.com:HIMAVARASAGAR/Soteria.git'),
    'HIMAVARASAGAR/Soteria',
  )
  assert.equal(
    extractGitHubRepoSlug('ssh://git@github.com/HIMAVARASAGAR/Soteria'),
    'HIMAVARASAGAR/Soteria',
  )
})

test('rejects malformed or non-GitHub URLs', () => {
  assert.equal(extractGitHubRepoSlug('https://gitlab.com/HIMAVARASAGAR/Soteria'), null)
  assert.equal(extractGitHubRepoSlug('https://github.com/Gitlawb'), null)
  assert.equal(extractGitHubRepoSlug('not actually github.com/HIMAVARASAGAR/Soteria'), null)
  assert.equal(
    extractGitHubRepoSlug('https://evil.example/?next=github.com/HIMAVARASAGAR/Soteria'),
    null,
  )
  assert.equal(
    extractGitHubRepoSlug('https://github.com.evil.example/HIMAVARASAGAR/Soteria'),
    null,
  )
  assert.equal(
    extractGitHubRepoSlug('https://example.com/github.com/HIMAVARASAGAR/Soteria'),
    null,
  )
})
