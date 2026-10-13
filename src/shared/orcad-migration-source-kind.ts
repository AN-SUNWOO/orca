/**
 * Which kind of source a migration manifest moves state out of.
 *
 * The relay-era SSH target is encoded by the ABSENCE of `source.kind`, so its manifests stay
 * byte-identical (and digest-identical) for destinations that predate the field. Every other kind
 * sets `kind` and must never carry `sshTargetId`: an older destination strips unknown fields, so a
 * non-SSH source without it fails that destination's parse instead of importing as an SSH host.
 */
import { ORCAD_MIGRATION_LOCAL_WSL_SOURCE_RUNTIME_CAPABILITY } from './orcad-runtime-capabilities'

export const ORCAD_MIGRATION_SSH_RELAY_SOURCE_KIND = 'ssh-relay' as const

/** Non-SSH kinds and the destination capability that proves a destination parses each one. */
export const ORCAD_MIGRATION_SOURCE_KIND_CAPABILITIES = {
  'local-wsl': ORCAD_MIGRATION_LOCAL_WSL_SOURCE_RUNTIME_CAPABILITY
} as const

export type OrcadMigrationNonSshSourceKind = keyof typeof ORCAD_MIGRATION_SOURCE_KIND_CAPABILITIES
export type OrcadMigrationSourceKind =
  | typeof ORCAD_MIGRATION_SSH_RELAY_SOURCE_KIND
  | OrcadMigrationNonSshSourceKind

export const ORCAD_MIGRATION_SOURCE_KIND_UNKNOWN = 'orcad_migration_source_kind_unknown'

/** A manifest source as it travels: this build may not know every field a newer peer signed. */
export type OrcadMigrationWireSource = Readonly<Record<string, unknown>>

/** Reads the wire discriminator; a source without one is the relay-era SSH source. */
export function orcadMigrationManifestSourceKind(
  source: OrcadMigrationWireSource
): OrcadMigrationSourceKind {
  if (source.kind === undefined) {
    return ORCAD_MIGRATION_SSH_RELAY_SOURCE_KIND
  }
  // An explicit 'ssh-relay' is refused too: SSH has exactly one encoding, so one digest.
  if (isNonSshSourceKind(source.kind)) {
    return source.kind
  }
  throw new Error(ORCAD_MIGRATION_SOURCE_KIND_UNKNOWN)
}

function isNonSshSourceKind(kind: unknown): kind is OrcadMigrationNonSshSourceKind {
  return typeof kind === 'string' && Object.hasOwn(ORCAD_MIGRATION_SOURCE_KIND_CAPABILITIES, kind)
}

/** The capability a destination must advertise before it may see this source; null for SSH. */
export function requiredOrcadMigrationSourceCapability(
  source: OrcadMigrationWireSource
): string | null {
  const kind = orcadMigrationManifestSourceKind(source)
  return kind === ORCAD_MIGRATION_SSH_RELAY_SOURCE_KIND
    ? null
    : ORCAD_MIGRATION_SOURCE_KIND_CAPABILITIES[kind]
}
