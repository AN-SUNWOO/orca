import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { classifyUnenvelopedCredential } from '../../shared/secret-at-rest-protection'
import { _resetSecretStoreForTests, setSecretStore } from '../../shared/secret-store'
import { readStoredCredentialToken, writeEncryptedCredential } from '../integration-credential-file'
import type { OrcadKeyringLookup, OrcadOsKeyring } from './orcad-os-keyring'
import { orcadSecretStateFileName } from './orcad-secret-key-record'
import { createOrcadSecretStore } from './orcad-secret-store'

const MACHINE_A = '0123456789abcdef0123456789abcdef'
const MACHINE_B = 'fedcba9876543210fedcba9876543210'
const STATE_A = orcadSecretStateFileName(MACHINE_A)

type FakeKeyring = OrcadOsKeyring & {
  items: Map<string, string>
  failure: OrcadKeyringLookup | null
  storeWorks: boolean
}

function fakeKeyring(): FakeKeyring {
  const items = new Map<string, string>()
  const keyring: FakeKeyring = {
    label: 'the test keyring',
    items,
    failure: null,
    storeWorks: true,
    async lookup(account: string): Promise<OrcadKeyringLookup> {
      if (keyring.failure) {
        return keyring.failure
      }
      const value = items.get(account)
      return value ? { kind: 'found', value } : { kind: 'missing' }
    },
    async store(account: string, value: string): Promise<boolean> {
      if (keyring.storeWorks) {
        items.set(account, value)
      }
      return keyring.storeWorks
    }
  }
  return keyring
}

describe('createOrcadSecretStore', () => {
  let keyDir: string

  beforeEach(() => {
    keyDir = mkdtempSync(join(tmpdir(), 'orcad-secret-store-'))
  })

  afterEach(() => {
    _resetSecretStoreForTests()
    rmSync(keyDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  const prepare = async (
    options: {
      keyring?: OrcadOsKeyring | null
      machine?: string | null
      env?: NodeJS.ProcessEnv
      temporaryProfile?: boolean
      claimSettleMs?: number
    } = {}
  ) => {
    const store = createOrcadSecretStore()
    const ready = await store.prepare({
      keyDir,
      platform: 'linux',
      env: options.env ?? {},
      keyring: options.keyring ?? null,
      machineIdentity: () => (options.machine === undefined ? MACHINE_A : options.machine),
      isTemporaryKeyDir: () => options.temporaryProfile ?? false,
      claimSettleMs: options.claimSettleMs ?? 0
    })
    return { store, ready }
  }

  it('seals with a host-bound profile key when no keyring is reachable', async () => {
    const { store, ready } = await prepare()
    expect(ready).toBe(true)
    expect(store.isEncryptionAvailable()).toBe(true)
    const sealed = store.encryptString('lin_api_secret')
    expect(sealed.includes(Buffer.from('lin_api_secret'))).toBe(false)
    expect(classifyUnenvelopedCredential(sealed)).toBe('sealed')
    expect(store.decryptString(sealed)).toBe('lin_api_secret')
    expect(store.describeProtectionGap()).toContain('mixed with this machine ID')

    const statePath = join(keyDir, STATE_A)
    if (process.platform !== 'win32') {
      expect(statSync(statePath).mode & 0o777).toBe(0o600)
    }
    const reopened = (await prepare()).store
    expect(reopened.decryptString(sealed)).toBe('lin_api_secret')
  })

  it('gives another machine sharing the home its own key, leaving this one intact', async () => {
    const sealed = (await prepare()).store.encryptString('lin_api_secret')
    const stateBefore = readFileSync(join(keyDir, STATE_A))

    const { store, ready } = await prepare({ machine: MACHINE_B })
    expect(ready).toBe(true)
    expect(() => store.decryptString(sealed)).toThrow()
    expect(readFileSync(join(keyDir, STATE_A))).toEqual(stateBefore)
    expect((await prepare()).store.decryptString(sealed)).toBe('lin_api_secret')
  })

  it('refuses to seal or unseal when its record was bound to a different machine ID', async () => {
    const sealed = (await prepare()).store.encryptString('lin_api_secret')
    // A record copied in under this machine's name from another host.
    renameSync(join(keyDir, STATE_A), join(keyDir, orcadSecretStateFileName(MACHINE_B)))
    const moved = await prepare({ machine: MACHINE_B })
    expect(moved.ready).toBe(false)
    expect(() => moved.store.encryptString('new')).toThrow(/different machine ID/)
    expect(() => moved.store.decryptString(sealed)).toThrow(/different machine ID/)
    expect(moved.store.isEncryptionAvailable()).toBe(true)
  })

  it('keeps the master key in the OS keyring when one is reachable', async () => {
    const keyring = fakeKeyring()
    const { store, ready } = await prepare({ keyring })
    expect(ready).toBe(true)
    expect(store.describeProtectionGap()).toBeNull()
    expect(keyring.items.size).toBe(1)
    const [masterKey] = [...keyring.items.values()]
    expect(readFileSync(join(keyDir, STATE_A), 'utf8')).not.toContain(masterKey)
    const sealed = store.encryptString('lin_api_secret')
    expect((await prepare({ keyring })).store.decryptString(sealed)).toBe('lin_api_secret')
  })

  it.each([
    ['locked', { kind: 'unreachable', reason: 'exited 1: Cannot unlock' }],
    ['timing out', { kind: 'unreachable', reason: 'timed out after 5s' }],
    ['missing its item', { kind: 'missing' }]
  ] as const)('fails closed when the recorded keyring is %s', async (_label, failure) => {
    const keyring = fakeKeyring()
    const sealed = (await prepare({ keyring })).store.encryptString('lin_api_secret')
    keyring.failure = failure

    const { store, ready } = await prepare({ keyring })
    expect(ready).toBe(false)
    expect(() => store.encryptString('x')).toThrow(/cannot unseal/)
    expect(() => store.decryptString(sealed)).toThrow(/cannot unseal/)
    expect(store.describeProtectionGap()).toContain('test keyring')

    keyring.failure = null
    expect((await prepare({ keyring })).store.decryptString(sealed)).toBe('lin_api_secret')
  })

  it('never creates a keyring item for a temporary profile or when told to use the file', async () => {
    const keyring = fakeKeyring()
    const temporary = await prepare({ keyring, temporaryProfile: true })
    expect(temporary.store.describeProtectionGap()).toContain('private credential directory')
    expect(keyring.items.size).toBe(0)
    rmSync(join(keyDir, STATE_A))
    await prepare({ keyring, env: { ORCA_HEADLESS_SECRET_STORE: 'file' } })
    expect(keyring.items.size).toBe(0)
  })

  it.skipIf(process.platform === 'win32')(
    'treats /tmp and the OS temp dir as disposable, by either spelling',
    async () => {
      const keyring = fakeKeyring()
      for (const dir of [
        mkdtempSync('/tmp/orcad-key-'),
        realpathSync(mkdtempSync('/tmp/orcad-key-')),
        keyDir
      ]) {
        await createOrcadSecretStore().prepare({
          keyDir: dir,
          env: {},
          keyring,
          machineIdentity: () => MACHINE_A
        })
        if (dir !== keyDir) {
          rmSync(dir, { recursive: true, force: true })
        }
      }
      expect(keyring.items.size).toBe(0)
    }
  )

  it('keeps its claim and fails closed when the keyring store result is uncertain', async () => {
    const keyring = fakeKeyring()
    const realStore = keyring.store.bind(keyring)
    // Stores the value, then reports a timeout; the read-back is unreachable too.
    keyring.store = async (account, value) => {
      await realStore(account, value)
      keyring.failure = { kind: 'unreachable', reason: 'timed out after 5s' }
      return false
    }
    const uncertain = await prepare({ keyring })
    expect(uncertain.ready).toBe(false)
    expect(keyring.items.size).toBe(1)

    keyring.failure = null
    const recovered = await prepare({ keyring })
    expect(recovered.ready).toBe(true)
    expect(recovered.store.describeProtectionGap()).toBeNull()
  })

  it('falls back to the profile key when the keyring cannot store one', async () => {
    const keyring = fakeKeyring()
    keyring.storeWorks = false
    const { store, ready } = await prepare({ keyring })
    expect(ready).toBe(true)
    expect(store.describeProtectionGap()).toContain('private credential directory')
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'treats a record it cannot read as unavailable, never as missing',
    async () => {
      const sealed = (await prepare()).store.encryptString('lin_api_secret')
      const statePath = join(keyDir, STATE_A)
      const before = readFileSync(statePath)
      chmodSync(statePath, 0o000)
      try {
        const { store, ready } = await prepare()
        expect(ready).toBe(false)
        expect(() => store.decryptString(sealed)).toThrow(/could not be read/)
      } finally {
        chmodSync(statePath, 0o600)
      }
      expect(readFileSync(statePath)).toEqual(before)
    }
  )

  it('agrees on one key when two servers start against the same home at once', async () => {
    const keyring = fakeKeyring()
    const [first, second] = await Promise.all([prepare({ keyring }), prepare({ keyring })])
    expect(first.ready && second.ready).toBe(true)
    expect(keyring.items.size).toBe(1)
    expect(second.store.decryptString(first.store.encryptString('a'))).toBe('a')
    expect((await prepare({ keyring })).store.decryptString(second.store.encryptString('b'))).toBe(
      'b'
    )

    // A slow keyring write: the losing start must wait for it rather than give up.
    rmSync(join(keyDir, STATE_A))
    keyring.items.clear()
    const slowStore = keyring.store.bind(keyring)
    keyring.store = async (account, value) => {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_500))
      return slowStore(account, value)
    }
    const slow = await Promise.all([
      prepare({ keyring, claimSettleMs: 12_000 }),
      prepare({ keyring, claimSettleMs: 12_000 })
    ])
    expect(slow.map(({ ready }) => ready)).toEqual([true, true])
    expect(slow[1].store.decryptString(slow[0].store.encryptString('s'))).toBe('s')

    const [fileA, fileB] = await Promise.all([
      prepare({ machine: MACHINE_B }),
      prepare({ machine: MACHINE_B })
    ])
    expect(fileB.store.decryptString(fileA.store.encryptString('c'))).toBe('c')
  })

  it('never regenerates over an unreadable key record', async () => {
    const statePath = join(keyDir, STATE_A)
    writeFileSync(statePath, '{"version":1,"backend":"host-file"', 'utf8')
    const { store, ready } = await prepare()
    expect(ready).toBe(false)
    expect(() => store.encryptString('x')).toThrow(/not valid/)
    expect(readFileSync(statePath, 'utf8')).toBe('{"version":1,"backend":"host-file"')
  })

  it('records an unbound key when the host has no machine ID', async () => {
    const { store } = await prepare({ machine: null })
    expect(store.describeProtectionGap()).not.toContain('machine ID')
    const sealed = store.encryptString('t')
    expect((await prepare({ machine: null })).store.decryptString(sealed)).toBe('t')
  })

  it('leaves the persistent credential home alone for a temporary profile', async () => {
    const keyring = fakeKeyring()
    const store = createOrcadSecretStore()
    const ready = await store.prepare({
      keyDir,
      userDataPath: '/tmp/orcad-smoke-profile',
      env: {},
      keyring,
      machineIdentity: () => MACHINE_A
    })
    expect(ready).toBe(false)
    expect(store.isEncryptionAvailable()).toBe(false)
    expect(store.describeProtectionGap()).toContain('temporary profile')
    expect(keyring.items.size).toBe(0)
    expect(readdirSync(keyDir)).toEqual([])
  })

  it('keeps the explicit plaintext opt-out for shared homes', async () => {
    const { store, ready } = await prepare({ env: { ORCA_HEADLESS_SECRET_STORE: 'plaintext' } })
    expect(ready).toBe(false)
    expect(store.isEncryptionAvailable()).toBe(false)
    expect(store.describeProtectionGap()).toContain('ORCA_HEADLESS_SECRET_STORE=plaintext')
  })

  it('makes integration credential saves seal, and still reads legacy plaintext', async () => {
    const { store } = await prepare()
    setSecretStore(store)
    const legacy = join(keyDir, 'legacy.enc')
    writeFileSync(legacy, 'lin_api_legacy', 'utf8')
    expect(readStoredCredentialToken('Linear', readFileSync(legacy))).toBe('lin_api_legacy')

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const saved = join(keyDir, 'saved.enc')
    writeEncryptedCredential('Linear', saved, 'lin_api_new')
    expect(warn).not.toHaveBeenCalled()
    expect(readFileSync(saved).includes(Buffer.from('lin_api_new'))).toBe(false)
    expect(readStoredCredentialToken('Linear', readFileSync(saved))).toBe('lin_api_new')
  })

  it('fails a save closed when the key cannot load, keeping the sealed file', async () => {
    const saved = join(keyDir, 'saved.enc')
    const keyring = fakeKeyring()
    setSecretStore((await prepare({ keyring })).store)
    writeEncryptedCredential('Linear', saved, 'lin_api_original')
    const before = readFileSync(saved)

    keyring.failure = { kind: 'unreachable', reason: 'locked' }
    setSecretStore((await prepare({ keyring })).store)
    expect(() => writeEncryptedCredential('Linear', saved, 'lin_api_replacement')).toThrow()
    expect(readFileSync(saved)).toEqual(before)
  })
})
