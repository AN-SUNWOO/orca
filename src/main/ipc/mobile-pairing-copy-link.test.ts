import { describe, expect, it, vi } from 'vitest'

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>()
}))

vi.mock('electron', () => ({
  app: { isPackaged: false },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      handlers.set(channel, handler)
  },
  shell: { openExternal: vi.fn() }
}))

import { registerMobileHandlers } from './mobile'

describe('mobile pairing copy link', () => {
  it('copies a verified https link while the QR keeps the custom scheme older phones scan', async () => {
    const createMobilePairingOffer = vi.fn().mockResolvedValue({
      available: true,
      pairingUrl: 'orca://pair?code=secret-code',
      endpoint: 'ws://192.168.1.24:6768',
      deviceId: 'mobile-1',
      connectionMode: 'local-only'
    })
    const encodePairingQr = vi
      .fn()
      .mockResolvedValue({ ok: true, qrDataUrl: 'data:image/png;base64,qr', qrSize: 58 })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: getPairingQR with an explicit address calls only createMobilePairingOffer.
    registerMobileHandlers({ createMobilePairingOffer } as never, { encodePairingQr })

    await expect(
      handlers.get('mobile:getPairingQR')?.(null, { address: '192.168.1.24' })
    ).resolves.toMatchObject({ pairingUrl: 'https://www.onorca.dev/pair#secret-code' })
    expect(encodePairingQr).toHaveBeenCalledWith('orca://pair?code=secret-code')
  })
})
