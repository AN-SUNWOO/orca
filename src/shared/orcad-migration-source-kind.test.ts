import { describe, expect, it } from 'vitest'
import {
  ORCAD_MIGRATION_MANIFEST_VERSION,
  normalizeOrcadMigrationImportReceipts,
  parseOrcadMigrationManifest
} from './orcad-migration-manifest'
import {
  ORCAD_MIGRATION_SOURCE_KIND_UNKNOWN,
  orcadMigrationManifestSourceKind,
  requiredOrcadMigrationSourceCapability
} from './orcad-migration-source-kind'
import {
  ORCAD_MIGRATION_LOCAL_WSL_SOURCE_RUNTIME_CAPABILITY,
  ORCAD_RUNTIME_CAPABILITIES
} from './orcad-runtime-capabilities'

const SSH_SOURCE = { sshTargetId: 'ssh-1', sshTargetGeneration: 2, targetLabel: 'Prod' }

/** Exactly what a desktop that predates `source.kind` sends. */
function manifestWithSource(source: unknown) {
  return {
    version: ORCAD_MIGRATION_MANIFEST_VERSION,
    migrationId: 'migration-kind',
    createdAt: '2026-10-01T00:00:00.000Z',
    source,
    payload: { repositories: [], projectGroups: [], folderWorkspaces: [] },
    manifestSha256: 'a'.repeat(64)
  }
}

describe('orcad migration source kind', () => {
  it('reads an absent kind as the relay-era SSH source, which needs no extra capability', () => {
    expect(orcadMigrationManifestSourceKind(SSH_SOURCE)).toBe('ssh-relay')
    expect(orcadMigrationManifestSourceKind({ ...SSH_SOURCE, kind: undefined })).toBe('ssh-relay')
    expect(requiredOrcadMigrationSourceCapability(SSH_SOURCE)).toBeNull()
  })

  it('gates a WSL source on its own capability, which no destination advertises yet', () => {
    expect(requiredOrcadMigrationSourceCapability({ kind: 'local-wsl' })).toBe(
      ORCAD_MIGRATION_LOCAL_WSL_SOURCE_RUNTIME_CAPABILITY
    )
    expect(ORCAD_RUNTIME_CAPABILITIES).not.toContain(
      ORCAD_MIGRATION_LOCAL_WSL_SOURCE_RUNTIME_CAPABILITY
    )
  })

  it.each(['ssh-relay', 'toString', 'wsl', 7, null])('refuses unregistered kind %j', (kind) => {
    expect(() => orcadMigrationManifestSourceKind({ kind })).toThrow(
      ORCAD_MIGRATION_SOURCE_KIND_UNKNOWN
    )
  })
})

describe('orcad migration manifest source on the destination', () => {
  it('accepts an older desktop manifest and its receipt unchanged', () => {
    expect(parseOrcadMigrationManifest(manifestWithSource(SSH_SOURCE)).source).toEqual(SSH_SOURCE)
    const receipt = {
      version: ORCAD_MIGRATION_MANIFEST_VERSION,
      migrationId: 'migration-kind',
      manifestSha256: 'a'.repeat(64),
      source: SSH_SOURCE,
      importedAt: '2026-10-01T00:00:00.000Z',
      repositoryIds: [],
      projectGroupIds: [],
      folderWorkspaceIds: []
    }
    expect(normalizeOrcadMigrationImportReceipts([receipt])).toEqual([receipt])
  })

  it('refuses any source kind until it ships the parser for that kind', () => {
    for (const source of [
      { ...SSH_SOURCE, kind: 'local-wsl' },
      { kind: 'local-wsl', distro: 'Ubuntu', targetLabel: 'Ubuntu' },
      { ...SSH_SOURCE, kind: 'ssh-relay' }
    ]) {
      expect(() => parseOrcadMigrationManifest(manifestWithSource(source))).toThrow(
        'orcad_migration_manifest_source_kind_unsupported'
      )
    }
  })

  it('fails a WSL source closed on a destination that drops the kind', () => {
    // Without the SSH fields, even a parser that ignores `kind` cannot read it as an SSH source.
    const { kind: _kind, ...asOlderDestinationSeesIt } = {
      kind: 'local-wsl',
      distro: 'Ubuntu',
      targetLabel: 'Ubuntu'
    }
    expect(() => parseOrcadMigrationManifest(manifestWithSource(asOlderDestinationSeesIt))).toThrow(
      /^orcad_migration_manifest_source/
    )
  })
})
