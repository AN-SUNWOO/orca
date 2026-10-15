import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatBlock, NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { RpcClient } from '../transport/rpc-client'
import { firstPageRowId, foldMobileNativeChatMessages } from './mobile-native-chat-render-data'
import { useMobileNativeChatPageHistory } from './use-mobile-native-chat-page-history'
import {
  useMobileNativeChatSession,
  type MobileNativeChatSession
} from './use-mobile-native-chat-session'

const platform = vi.hoisted(() => ({ OS: 'web' }))

vi.mock('react-native', () => ({ Platform: platform }))

type Item = { id: string }
type History = ReturnType<typeof useMobileNativeChatPageHistory<Item>>

const rows = (...ids: string[]): Item[] => ids.map((id) => ({ id }))
const renderRow = vi.fn(({ item, index }: { item: Item; index: number }): ReactElement =>
  createElement('Row', { id: item.id, index })
)

describe('useMobileNativeChatPageHistory', () => {
  let renderer: ReactTestRenderer | null = null
  let history: History | null = null

  function Harness({ items }: { items: Item[] }): null {
    history = useMobileNativeChatPageHistory(items, renderRow)
    return null
  }

  async function show(items: Item[]): Promise<void> {
    await act(async () => {
      if (renderer) {
        renderer.update(createElement(Harness, { items }))
      } else {
        renderer = create(createElement(Harness, { items }))
      }
    })
  }

  /** What the list header draws below the control it was given. */
  function headerRows(): { id: string; index: number }[] {
    const drawn: { header?: ReactTestRenderer } = {}
    act(() => {
      drawn.header = create(
        createElement('Header', null, history?.withHistory(createElement('Control')))
      )
    })
    const found = drawn.header?.root.findAll((node) => typeof node.props.index === 'number') ?? []
    return found.map((row) => ({ id: row.props.id, index: row.props.index }))
  }

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    history = null
    platform.OS = 'web'
  })

  it('draws history that loads above the list in its header, leaving the list its rows', async () => {
    await show(rows('a', 'b'))
    expect(history?.listRows).toEqual(rows('a', 'b'))
    expect(headerRows()).toEqual([])

    await show(rows('x', 'y', 'a', 'b'))

    // RN Web's list draws by index: handing it the new rows would redraw a different set.
    expect(history?.listRows).toEqual(rows('a', 'b'))
    expect(headerRows()).toEqual([
      { id: 'x', index: 0 },
      { id: 'y', index: 1 }
    ])
    // The list's first row is the third row of the chat, and is drawn as that.
    history?.renderListRow({ item: { id: 'a' }, index: 0 })
    expect(renderRow).toHaveBeenLastCalledWith({ item: { id: 'a' }, index: 2 })
  })

  it('gives the list every row again once the row it started at is gone', async () => {
    await show(rows('a', 'b'))
    await show(rows('x', 'a', 'b'))

    await show(rows('p', 'q'))

    expect(history?.listRows).toEqual(rows('p', 'q'))
    expect(headerRows()).toEqual([])
  })

  it('reads one tap past pages of a wordless tool run until a row is drawn, keeping the rows it drew', async () => {
    const message = (
      id: string,
      role: NativeChatMessage['role'],
      ...blocks: NativeChatBlock[]
    ): NativeChatMessage => ({ id, role, blocks, timestamp: null, source: 'transcript' })
    const text = (value: string): NativeChatBlock => ({ type: 'text', text: value })
    const call = (n: number): NativeChatBlock => ({
      type: 'tool-call',
      name: 'Read',
      input: {},
      callId: `c${n}`
    })
    const result = (n: number): NativeChatBlock => ({
      type: 'tool-result',
      output: 'ok',
      callId: `c${n}`
    })
    const chat = Array.from({ length: 60 }, (_unused, n) =>
      message(`old${n}`, n % 2 === 0 ? 'user' : 'assistant', text(`turn ${n}`))
    )
    chat.push(
      message('ask', 'user', text('fix it')),
      message('look', 'assistant', text('Looking.'), call(0))
    )
    // 101 calls and results with no words between them: longer than a 60-message page.
    for (let n = 0; n < 50; n += 1) {
      chat.push(
        message(`r${n}`, 'user', result(n)),
        message(`call${n + 1}`, 'assistant', call(n + 1))
      )
    }
    chat.push(
      message('r50', 'user', result(50)),
      message('done', 'assistant', text('Fixed.')),
      message('thanks', 'user', text('thanks'))
    )
    // The host pages back from where its last page started; each page waits for `answer()`.
    let start = chat.length
    const pageFrom = (
      limit: number
    ): { messages: NativeChatMessage[]; hasMore: boolean; beforeOffset: number } => {
      const end = start
      start = Math.max(0, end - limit)
      return { messages: chat.slice(start, end), hasMore: start > 0, beforeOffset: start }
    }
    const answers: (() => void)[] = []
    const sendRequest = vi.fn<RpcClient['sendRequest']>(
      () =>
        new Promise((resolve) => {
          answers.push(() => resolve({ id: 'page', ok: true, result: pageFrom(60) }))
        })
    )
    const client: RpcClient = {
      sendRequest,
      subscribe: (_method, _params, onData) => {
        onData({ type: 'snapshot', ...pageFrom(40) })
        return () => {}
      },
      updateTerminalSubscriptionViewport: () => {},
      getState: () => 'connected',
      getReconnectAttempt: () => 0,
      getLastConnectedAt: () => 1,
      onStateChange: () => () => {},
      notifyForeground: () => {},
      close: () => {}
    }
    const session: { current: MobileNativeChatSession | null } = { current: null }
    function Chat(): null {
      session.current = useMobileNativeChatSession({
        client,
        sourceIdentity: 'host\0workspace',
        agent: 'claude',
        sessionId: 'session',
        transcriptPath: null
      })
      // What the overlay hands the page's list.
      const folded = foldMobileNativeChatMessages(session.current.messages, session.current.hasMore)
      history = useMobileNativeChatPageHistory(folded, renderRow)
      return null
    }
    async function answer(): Promise<void> {
      await act(async () => {
        answers.shift()?.()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }
    const listIds = (): string[] | undefined => history?.listRows.map((row) => row.id)
    await act(async () => {
      renderer = create(createElement(Chat))
    })
    // The window starts mid-run: the page draws from the run's end until its start loads.
    expect(listIds()).toEqual(['done', 'thanks'])

    act(() => session.current?.loadEarlier(firstPageRowId))
    await answer()

    // That page was all calls and results: nothing new to draw, so the tap reads on, spinner up.
    expect(sendRequest).toHaveBeenCalledTimes(2)
    expect(session.current?.loadingEarlier).toBe(true)
    expect(headerRows()).toEqual([])
    expect(listIds()).toEqual(['done', 'thanks'])

    await answer()

    expect(sendRequest).toHaveBeenCalledTimes(2)
    expect(session.current?.loadingEarlier).toBe(false)
    expect(session.current?.hasMore).toBe(true)
    expect(
      headerRows()
        .slice(-3)
        .map((row) => row.id)
    ).toEqual(['old59', 'ask', 'look'])
    // The place-hold finds the reader's row by id, and the list keeps its rows at their indexes.
    expect(listIds()).toEqual(['done', 'thanks'])

    act(() => session.current?.loadEarlier(firstPageRowId))
    await answer()

    expect(session.current?.hasMore).toBe(false)
    expect(headerRows()[0]?.id).toBe('old0')
    expect(listIds()).toEqual(['done', 'thanks'])
  })

  it('leaves a native list all its rows: it holds its own place', async () => {
    platform.OS = 'ios'
    await show(rows('a', 'b'))
    const all = rows('x', 'y', 'a', 'b')

    await show(all)

    expect(history?.listRows).toBe(all)
    expect(history?.renderListRow).toBe(renderRow)
    expect(headerRows()).toEqual([])
  })
})
