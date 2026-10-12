import type { ClientChannel, SFTPWrapper } from 'ssh2'
import type { SshRemoteFileOptions } from './ssh-connection-file-transfers'
import type { SshExecOptions } from './ssh-connection-utils'

type RemoteFileWriteOptions = SshRemoteFileOptions & { signal?: AbortSignal }

/** What remote install, lock, GC and host-probe code uses from a host connection. */
export type RemoteInstallTransport = {
  exec(command: string, options?: SshExecOptions): Promise<ClientChannel>
  usesSystemSshTransport(): boolean
  /** Changes whenever the underlying transport is replaced; scopes per-transport verdicts. */
  getConnectGeneration(): number
  sftp(options?: AbortSignal | { signal?: AbortSignal }): Promise<SFTPWrapper>
  writeFile(remotePath: string, contents: string, options?: RemoteFileWriteOptions): Promise<void>
  uploadDirectory(
    localDir: string,
    remoteDir: string,
    options?: RemoteFileWriteOptions
  ): Promise<void>
}
