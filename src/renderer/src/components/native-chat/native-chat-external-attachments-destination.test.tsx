// @vitest-environment happy-dom
import { act, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as AttachmentUploadModule from './native-chat-attachment-upload'
import type { NativeChatAttachmentOwner } from './native-chat-attachment-upload'
import { nativeChatPendingAttachmentSnapshot } from './native-chat-pending-attachment-cache'
import { nativeChatImagesHoldSend } from './native-chat-image-reattach'
import { readNativeChatDraftCache } from './native-chat-draft-cache'
import { useNativeChatExternalAttachments } from './use-native-chat-external-attachments'
import {
  clearNativeChatAttachmentCacheForTests,
  useNativeChatComposerAttachments
} from './use-native-chat-composer-attachments'

const mocks = vi.hoisted(() => {
  const state: {
    owner: NativeChatAttachmentOwner
    remoteTarget: boolean
    stat: ReturnType<typeof vi.fn>
    tabsByWorktree: Record<string, { id: string }[]>
  } = {
    owner: { kind: 'local' },
    remoteTarget: false,
    stat: vi.fn(),
    tabsByWorktree: { 'workspace-1': [{ id: 'tab-1' }] }
  }
  return state
})
vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({ tabsByWorktree: mocks.tabsByWorktree }) }
}))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('@/runtime/runtime-terminal-inspection', () => ({
  isRemoteRuntimePtyId: () => mocks.remoteTarget
}))
vi.mock('./native-chat-attachment-upload', async (importOriginal) => ({
  ...(await importOriginal<typeof AttachmentUploadModule>()),
  resolveNativeChatAttachmentOwner: () => mocks.owner,
  resolveNativeChatAttachmentOwnerForWorktree: () => mocks.owner
}))

type Api = ReturnType<typeof useNativeChatExternalAttachments> &
  ReturnType<typeof useNativeChatComposerAttachments>
let api: Api | undefined
let root: Root
let container: HTMLDivElement
let composing = true

function Probe({
  worktreeId,
  acceptsImages = true,
  disabled = false
}: {
  worktreeId?: string
  acceptsImages?: boolean
  disabled?: boolean
}): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const [caret, setCaret] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const attachments = useNativeChatComposerAttachments({
    attachmentScopeKey: 'drop-test',
    acceptsImages,
    caret,
    disabled,
    isComposing: () => composing,
    resolveTarget: () => ({ ptyId: 'pty-1', settings: { activeRuntimeEnvironmentId: null } }),
    textareaRef,
    setCaret,
    setDraft,
    setNotice
  })
  const external = useNativeChatExternalAttachments({
    terminalTabId: 'tab-1',
    structuredWorktreeId: worktreeId,
    disabled,
    attachResolvedPaths: attachments.attachResolvedPaths,
    pendingChips: attachments.pendingChips,
    setNotice
  })
  api = { ...attachments, ...external }
  return (
    <>
      <textarea ref={textareaRef} />
      <output data-draft>{draft}</output>
      <output data-notice>{notice}</output>
    </>
  )
}

function latest(): Api {
  if (!api) {
    throw new Error('Attachment probe did not render')
  }
  return api
}

async function render(worktreeId?: string, acceptsImages = true, disabled = false): Promise<void> {
  await act(async () =>
    root.render(<Probe worktreeId={worktreeId} acceptsImages={acceptsImages} disabled={disabled} />)
  )
}

beforeEach(() => {
  api = undefined
  composing = true
  mocks.owner = { kind: 'local' }
  mocks.remoteTarget = false
  mocks.stat.mockReset().mockResolvedValue(undefined)
  mocks.tabsByWorktree = { 'workspace-1': [{ id: 'tab-1' }] }
  vi.stubGlobal('api', { fs: { stat: mocks.stat } })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  clearNativeChatAttachmentCacheForTests()
  vi.unstubAllGlobals()
})

describe('OS attachment destination through input-method composition', () => {
  it.each(['workspace', 'host', 'terminal-workspace'])(
    'refuses queued files after the %s changes',
    async (change) => {
      await render(change === 'terminal-workspace' ? undefined : 'workspace-1')
      await act(async () => latest().attachExternalPaths(['/local/file.txt', '/local/image.png']))
      expect(nativeChatPendingAttachmentSnapshot('drop-test')).toHaveLength(2)
      expect(container.querySelector('[data-draft]')?.textContent).toBe('')
      if (change === 'workspace') {
        await render('workspace-2')
      }
      if (change === 'host') {
        mocks.owner = { kind: 'remote' }
      }
      if (change === 'terminal-workspace') {
        mocks.tabsByWorktree = { 'workspace-1': [] }
      }
      composing = false
      act(() => latest().flushPendingAttachments())
      expect(container.querySelector('[data-draft]')?.textContent).toBe('')
      expect(latest().imageAttachments).toEqual([])
      expect(nativeChatPendingAttachmentSnapshot('drop-test')).toEqual([])
      expect(container.querySelector('[data-notice]')?.textContent).toBe(
        'This workspace changed hosts while attaching — drop the files again.'
      )
    }
  )

  it('attaches an unchanged queued OS destination normally', async () => {
    await render('workspace-1')
    await act(async () => latest().attachExternalPaths(['/local/file.txt']))
    expect(readNativeChatDraftCache('drop-test')).toBe('')
    expect(nativeChatPendingAttachmentSnapshot('drop-test')).toHaveLength(1)
    composing = false
    act(() => latest().flushPendingAttachments())
    expect(container.querySelector('[data-draft]')?.textContent).toBe('@/local/file.txt ')
    expect(nativeChatPendingAttachmentSnapshot('drop-test')).toEqual([])
  })

  it.each([true, false])(
    'uses current image support when queued with acceptsImages=%s',
    async (acceptsImages) => {
      const path = '/local/image.png'
      await render('workspace-1', acceptsImages)
      await act(async () => latest().attachExternalPaths([path]))
      expect(mocks.stat).toHaveBeenCalledOnce()
      expect(nativeChatPendingAttachmentSnapshot('drop-test')).toHaveLength(1)
      expect(latest().imageAttachments.every(({ pending }) => pending)).toBe(true)
      expect(container.querySelector('[data-draft]')?.textContent).toBe('')

      const currentAcceptsImages = !acceptsImages
      await render('workspace-1', currentAcceptsImages)
      composing = false
      act(() => latest().flushPendingAttachments())
      act(() => latest().flushPendingAttachments())

      expect(nativeChatPendingAttachmentSnapshot('drop-test')).toEqual([])
      expect(latest().imageAttachments.map(({ path }) => path)).toEqual(
        currentAcceptsImages ? [path] : []
      )
      expect(nativeChatImagesHoldSend(latest().imageAttachments)).toBe(false)
      expect(container.querySelector('[data-draft]')?.textContent).toBe(
        currentAcceptsImages ? '' : `@${path} `
      )
    }
  )

  it.each([true, false])(
    'keeps the workspace-file exemption off OS drops (queued=$queued)',
    async (queued) => {
      composing = queued
      await render('workspace-1')
      if (!queued) {
        mocks.remoteTarget = true
      }
      await act(async () => latest().attachExternalPaths(['/local/file.txt', '/local/image.png']))
      if (queued) {
        mocks.remoteTarget = true
        composing = false
        act(() => latest().flushPendingAttachments())
      }
      expect(container.querySelector('[data-draft]')?.textContent).toBe('')
      expect(latest().imageAttachments).toEqual([])
      expect(container.querySelector('[data-notice]')?.textContent).toBe(
        'Local attachments are not available for remote sessions.'
      )
    }
  )

  it('reserves before stat and settles the captured scope across removal, failure and remount', async () => {
    let finish = (): void => {}
    mocks.stat
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finish = resolve
        })
      )
      .mockRejectedValueOnce(new Error('unreadable'))
    await render('workspace-1')
    act(() => latest().attachExternalPaths(['/a.png', '/bad.png', '/removed.png', '/notes.txt']))
    expect(nativeChatImagesHoldSend(latest().imageAttachments)).toBe(true)
    expect(nativeChatPendingAttachmentSnapshot('drop-test')).toHaveLength(4)
    const removed = latest().imageAttachments.find(
      ({ pendingName }) => pendingName === 'removed.png'
    )
    if (!removed) {
      throw new Error('Missing reserved chip')
    }
    act(() => latest().removeImageAttachment(removed.id))
    act(() => root.unmount())
    await act(async () => finish())
    expect(nativeChatPendingAttachmentSnapshot('drop-test')).toEqual([])
    root = createRoot(container)
    await render('workspace-1')
    expect(latest().imageAttachments).toMatchObject([{ path: '/a.png' }])
    expect(latest().imageAttachments).toHaveLength(1)
    expect(nativeChatImagesHoldSend(latest().imageAttachments)).toBe(false)
    expect(readNativeChatDraftCache('drop-test')).toBe('@/notes.txt')
  })

  it('settles prepared pending work quietly when composition loses its composer', async () => {
    await render('workspace-1')
    await act(async () => latest().attachExternalPaths(['/a.png', '/notes.txt', '/removed.png']))
    const removed = latest().imageAttachments.find(
      ({ pendingName }) => pendingName === 'removed.png'
    )
    if (!removed) {
      throw new Error('Missing reserved chip')
    }
    act(() => latest().removeImageAttachment(removed.id))
    const other = document.createElement('input')
    document.body.append(other)
    other.focus()
    act(() => root.unmount())
    expect(nativeChatPendingAttachmentSnapshot('drop-test')).toEqual([])
    expect(readNativeChatDraftCache('drop-test')).toBe('@/notes.txt')
    root = createRoot(container)
    await render('workspace-1')
    expect(latest().imageAttachments).toMatchObject([{ path: '/a.png' }])
    expect(latest().imageAttachments).toHaveLength(1)
    await new Promise((resolve) => requestAnimationFrame(resolve))
    expect(document.activeElement).toBe(other)
    other.remove()
  })

  it('releases refused and disabled work, including stat spanning disable and re-enable', async () => {
    await render('workspace-1')
    act(() =>
      latest().attachResolvedPaths(Array.from({ length: 256 }, (_, i) => `/queued/${i}.txt`))
    )
    await act(async () => latest().attachExternalPaths(['/refused.png']))
    expect(nativeChatPendingAttachmentSnapshot('drop-test')).toEqual([])
    let finish = (): void => {}
    mocks.stat.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve
      })
    )
    act(() => latest().attachExternalPaths(['/late.png']))
    await render('workspace-1', true, true)
    await render('workspace-1')
    await act(async () => finish())
    act(() => latest().flushPendingAttachments())
    expect(nativeChatPendingAttachmentSnapshot('drop-test')).toEqual([])
    expect(latest().imageAttachments).toEqual([])
    expect(container.querySelector('[data-draft]')?.textContent).toBe('')
  })
})
