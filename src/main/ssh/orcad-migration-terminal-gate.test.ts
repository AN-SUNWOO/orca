import { describe, expect, it, vi } from 'vitest'
import type { SshRemotePtyLease } from '../../shared/ssh-types'
import {
  assessOrcadMigrationTerminals,
  confirmOrcadMigrationTerminalsUnderFence,
  retireProvenExitedLeases
} from './orcad-migration-terminal-gate'

type LeaseRow = Pick<SshRemotePtyLease, 'ptyId' | 'state'>

function store(leases: LeaseRow[]) {
  const full = leases.map((lease) => ({ ...lease, targetId: 'ssh-1', createdAt: 1, updatedAt: 1 }))
  return { getSshRemotePtyLeases: () => full }
}

const MIXED: LeaseRow[] = [
  { ptyId: 'att', state: 'attached' },
  { ptyId: 'det', state: 'detached' },
  { ptyId: 'exp', state: 'expired' },
  { ptyId: 'ter', state: 'terminated' }
]
const UNRESOLVED: LeaseRow[] = [
  { ptyId: 'det', state: 'detached' },
  { ptyId: 'exp', state: 'expired' },
  { ptyId: 'ter', state: 'terminated' }
]
const CENSUS_STILL_RUNS = "the host's relays still run or may run terminals"

describe('terminal gate characterization: census-only verdicts', () => {
  it.each([
    ['no leases', [], { verdict: 'exited', provenPtyIds: [] }],
    ['mixed leases', MIXED, { verdict: 'exited', provenPtyIds: ['att', 'det', 'exp', 'ter'] }]
  ] as const)('an idle census proves %s exited', async (_label, leases, expected) => {
    await expect(
      assessOrcadMigrationTerminals(store([...leases]), 'ssh-1', async () => ({
        verdict: 'exited',
        count: 0
      }))
    ).resolves.toEqual(expected)
  })

  it.each([['live' as const], ['unverifiable' as const]])(
    'a %s census decides over any lease, without ids',
    async (verdict) => {
      for (const leases of [[], MIXED, UNRESOLVED]) {
        await expect(
          assessOrcadMigrationTerminals(store(leases), 'ssh-1', async () => ({
            verdict,
            count: 2
          }))
        ).resolves.toEqual({ verdict, ptyIds: [], reason: CENSUS_STILL_RUNS, hostTerminals: 2 })
      }
    }
  )

  it('a census that throws is unverifiable, never exited', async () => {
    await expect(
      assessOrcadMigrationTerminals(store(MIXED), 'ssh-1', async () => {
        throw new Error('connect refused')
      })
    ).resolves.toEqual({
      verdict: 'unverifiable',
      ptyIds: [],
      reason: CENSUS_STILL_RUNS,
      hostTerminals: 0
    })
  })

  it.each([
    [
      'an attached lease',
      MIXED,
      { verdict: 'live', ptyIds: ['att'], reason: 'terminals on this host are still running' }
    ],
    [
      'detached or expired leases',
      UNRESOLVED,
      {
        verdict: 'unverifiable',
        ptyIds: ['det', 'exp'],
        reason: 'no SSH relay could confirm these terminals exited'
      }
    ],
    [
      'only terminated leases',
      [{ ptyId: 'ter', state: 'terminated' }],
      {
        verdict: 'unverifiable',
        ptyIds: [],
        reason: "no census of every relay on this host's account was taken"
      }
    ],
    [
      'no leases',
      [],
      {
        verdict: 'unverifiable',
        ptyIds: [],
        reason: "no census of every relay on this host's account was taken"
      }
    ]
  ] as const)('without a census, %s blocks', async (_label, leases, expected) => {
    for (const census of [undefined, null]) {
      await expect(
        assessOrcadMigrationTerminals(store([...leases]), 'ssh-1', census)
      ).resolves.toEqual(expected)
    }
  })
})

describe('acting on a terminal proof', () => {
  it('retires only the detached and expired leases an exited proof covers', () => {
    const leases = store(MIXED)
    const markSshRemotePtyLease = vi.fn()
    retireProvenExitedLeases({ ...leases, markSshRemotePtyLease }, 'ssh-1', {
      verdict: 'exited',
      provenPtyIds: ['att', 'det', 'exp', 'ter']
    })
    expect(markSshRemotePtyLease.mock.calls).toEqual([
      ['ssh-1', 'det', 'terminated'],
      ['ssh-1', 'exp', 'terminated']
    ])
  })

  it('confirms under the fence only when no unproven terminal appeared', () => {
    const proof = { verdict: 'exited' as const, provenPtyIds: ['old'] }
    expect(
      confirmOrcadMigrationTerminalsUnderFence(
        store([{ ptyId: 'old', state: 'expired' }]),
        'ssh-1',
        proof
      )
    ).toBe(proof)
    expect(
      confirmOrcadMigrationTerminalsUnderFence(
        store([{ ptyId: 'new', state: 'expired' }]),
        'ssh-1',
        proof
      )
    ).toMatchObject({ verdict: 'unverifiable', ptyIds: ['new'] })
    expect(
      confirmOrcadMigrationTerminalsUnderFence(
        store([{ ptyId: 'old', state: 'attached' }]),
        'ssh-1',
        proof
      )
    ).toMatchObject({ verdict: 'live' })
    expect(
      confirmOrcadMigrationTerminalsUnderFence(
        store([{ ptyId: 'new', state: 'terminated' }]),
        'ssh-1',
        proof
      )
    ).toBe(proof)
  })
})
