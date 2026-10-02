/**
 * `state.ts` 的回归：**"最近用过的卡"与"本会话用过哪些卡"**，以及改写记录的向后兼容。
 *
 * 这两样是本次新加的、有直接用途的状态：
 *  - `lastCardId` —— 新会话自动预选它（"换会话不换角色"，优先级 显式绑定 > lastCardId > defaultCardId）；
 *  - `cardsSeen`  —— 判断"本会话换过卡"，据此给出"旧口吻还在历史里"的诚实提示。
 *
 * 还要保证**旧 state.json 不许把插件读崩**（缺字段是常态：用户升级插件时文件里就是旧形状）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CARD_SEEN_LIMIT, createState, parseState } from '../lib/state.js'

/** 建一个临时目录（只在自己名下，退出时删掉）。 */
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'cosplay-state-'))
  return {
    dir,
    file: join(dir, 'state.json'),
    done: () => rmSync(dir, { recursive: true, force: true }),
  }
}

test('选卡会更新 lastCardId 与 cardsSeen（最近在前）', () => {
  const box = sandbox()
  try {
    const state = createState(box.file, () => 1000)
    state.setBinding('s1', { cardId: 'catgirl' })
    assert.equal(state.lastCardId(), 'catgirl')
    assert.deepEqual(state.binding('s1').cardsSeen, ['catgirl'])

    state.setBinding('s1', { cardId: 'hardcore' })
    assert.equal(state.lastCardId(), 'hardcore')
    assert.deepEqual(state.binding('s1').cardsSeen, ['hardcore', 'catgirl'])

    // 再选回旧的：去重并挪到最前（不重复占位）。
    state.setBinding('s1', { cardId: 'catgirl' })
    assert.deepEqual(state.binding('s1').cardsSeen, ['catgirl', 'hardcore'])
  } finally {
    box.done()
  }
})

test('停用 / 清空不改变 lastCardId 与 cardsSeen（它们记的是"选过什么"）', () => {
  const box = sandbox()
  try {
    const state = createState(box.file, () => 1000)
    state.setBinding('s1', { cardId: 'catgirl' })
    state.setBinding('s1', { enabled: false })
    state.setBinding('s1', { cardId: null })
    assert.equal(state.lastCardId(), 'catgirl')
    assert.deepEqual(state.binding('s1').cardsSeen, ['catgirl'])
  } finally {
    box.done()
  }
})

test('cardsSeen 有界（只留最近几张）', () => {
  const box = sandbox()
  try {
    const state = createState(box.file, () => 1000)
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) state.setBinding('s1', { cardId: id })
    const seen = state.binding('s1').cardsSeen
    assert.equal(seen.length, CARD_SEEN_LIMIT)
    assert.deepEqual(seen, ['f', 'e', 'd', 'c'])
  } finally {
    box.done()
  }
})

test('落盘再读：lastCardId 与 cardsSeen 都还在', () => {
  const box = sandbox()
  try {
    const first = createState(box.file, () => 1000)
    first.setBinding('s1', { cardId: 'catgirl' })
    first.setBinding('s1', { cardId: 'hardcore' })
    first.recordRewrite('s1', {
      messageId: 'm1',
      turn: 2,
      at: 5,
      cardId: 'hardcore',
      model: 'p/m',
      ok: true,
      ms: 12,
      inChars: 54,
      outChars: 691,
      original: '把这个提交到我的仓库吧',
      contextTurns: 2,
      contextChars: 220,
      preview: '老哥们…',
    })

    const second = createState(box.file, () => 2000)
    assert.equal(second.lastCardId(), 'hardcore')
    assert.deepEqual(second.binding('s1').cardsSeen, ['hardcore', 'catgirl'])
    const record = second.rewritesOf('s1')[0]
    assert.equal(record.original, '把这个提交到我的仓库吧')
    assert.equal(record.contextTurns, 2)
    assert.equal(record.contextChars, 220)
    // 落盘内容是合法 JSON 且带缩进（人可读、便于排障）。
    assert.match(readFileSync(box.file, 'utf8'), /"lastCardId": "hardcore"/)
  } finally {
    box.done()
  }
})

test('旧 state.json（缺 lastCardId / cardsSeen / original）不许读崩', () => {
  const box = sandbox()
  try {
    const legacy = {
      version: 1,
      sessions: { s1: { cardId: 'catgirl', enabled: true, updatedAt: 7 } },
      rewrites: { s1: [{ messageId: 'm1', turn: 1, at: 1, cardId: 'catgirl', model: 'p/m', ok: true, ms: 3, inChars: 3, outChars: 9, preview: '喵' }] },
      global: {},
    }
    writeFileSync(box.file, JSON.stringify(legacy), 'utf8')
    const state = createState(box.file, () => 1000)
    assert.equal(state.lastCardId(), '')
    assert.equal(state.binding('s1').cardsSeen, undefined)
    assert.equal(state.rewritesOf('s1')[0].original, undefined)
    // 之后再选卡就能正常补上。
    state.setBinding('s1', { cardId: 'hardcore' })
    assert.equal(state.lastCardId(), 'hardcore')
    assert.deepEqual(state.binding('s1').cardsSeen, ['hardcore'])
  } finally {
    box.done()
  }
})

test('坏文件一律当空状态；脏 cardsSeen 值会被过滤', () => {
  const box = sandbox()
  try {
    writeFileSync(box.file, '{ this is not json', 'utf8')
    assert.deepEqual(createState(box.file, () => 1).binding('s1'), undefined)

    const parsed = parseState({
      version: 1,
      sessions: { s1: { cardId: 'x', enabled: true, updatedAt: 1, cardsSeen: ['a', '', 42, 'b'] } },
      rewrites: {},
      global: { lastCardId: 7 },
    })
    assert.deepEqual(parsed.sessions.s1.cardsSeen, ['a', 'b'])
    assert.equal(createState(box.file, () => 1).lastCardId(), '')
  } finally {
    box.done()
  }
})
