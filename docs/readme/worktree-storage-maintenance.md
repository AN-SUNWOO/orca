# Worktree storage maintenance

Run from the repository to preview maintenance across its locally registered Git worktrees:

```sh
pnpm run reclaim:worktree-space
```

Apply the previewed operations with:

```sh
pnpm run reclaim:worktree-space --apply
```

The command reuses the existing Electron distribution migration and dev bundle cleanup scripts.
It shares complete Electron distributions through the repository cache and removes idle
`out/electron-dev` bundles, which development rebuilds on demand. It leaves source files,
dependency installs, worktree registrations, and other build output alone. Reported sizes are
logical file data; APFS clones and hardlinks mean actual disk savings can be smaller.

Use `--repo DIRECTORY` to choose another local repository. Git's worktree list determines scope,
including registered worktrees outside Orca's workspace directory. Folder workspaces without Git
have no repository-wide sweep. These commands run on the local host: they do not inspect or delete
anything on SSH hosts. Run maintenance on the execution host when maintaining remote repositories.

## Keeping installs shared

Healthy Electron installs join the shared distribution cache during native dependency setup,
without waiting for an Electron upgrade. The manual command migrates older installs immediately.

Cleanup runs only when explicitly requested. Starting `pnpm dev` does not trigger a sweep.
The repository lock prevents competing cleanup commands. Dev bundle removal checks active
processes and recent unfinished builds, then rechecks eligibility immediately before deletion.
An unreadable process table prevents removal.

To retain older bundles during a manual sweep, run the underlying command with an age limit:

```sh
node config/scripts/reclaim-dev-electron-bundles.mjs --min-age-days 7 --apply
```

That limit uses the bundle directory's modification time. The underlying command also accepts
`--exclude-worktree DIRECTORY` to protect an entire worktree. A missing exclusion path is an error;
filesystem aliases resolve to the same worktree. Neither option schedules cleanup.
