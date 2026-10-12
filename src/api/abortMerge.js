// @ts-check
import '../typedefs.js'

import { STAGE } from '../commands/STAGE.js'
import { TREE } from '../commands/TREE.js'
import { WORKDIR } from '../commands/WORKDIR.js'
import { _walk } from '../commands/walk.js'
import { IndexResetError } from '../errors/IndexResetError.js'
import { GitIndexManager } from '../managers/GitIndexManager.js'
import { FileSystem } from '../models/FileSystem.js'
import { assertParameter } from '../utils/assertParameter.js'
import { discoverGitdir } from '../utils/discoverGitdir.js'
import { join } from '../utils/join.js'
import { modified } from '../utils/modified.js'

/**
 * Abort a merge in progress.
 *
 * Based on the behavior of git reset --merge, i.e.  "Resets the index and updates the files in the working tree that are different between <commit> and HEAD, but keeps those which are different between the index and working tree (i.e. which have changes which have not been added). If a file that is different between <commit> and the index has unstaged changes, reset is aborted."
 *
 * Essentially, abortMerge will reset any files affected by merge conflicts to their last known good version at HEAD.
 * Any unstaged changes are saved and any staged changes are reset as well.
 *
 * Like `git merge --abort`, it removes files that were added to the index by or during the merge, and refuses with an `IndexResetError` to touch a file that was staged and then modified again.
 *
 * **WARNING:** Running git merge with non-trivial uncommitted changes is discouraged: while possible, it may leave you in a state that is hard to back out of in the case of a conflict.
 * If there were uncommitted changes when the merge started (and especially if those changes were further modified after the merge was started), `git.abortMerge` will in some cases be unable to reconstruct the original (pre-merge) changes.
 *
 * @param {object} args
 * @param {FsClient} args.fs - a file system implementation
 * @param {string} args.dir - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir, '.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} [args.commit='HEAD'] - commit to reset the index and worktree to, defaults to HEAD
 * @param {object} [args.cache] - a [cache](cache.md) object
 *
 * @returns {Promise<void>} Resolves successfully once the git index has been updated
 *
 */
export async function abortMerge({
  fs: _fs,
  dir,
  gitdir = join(dir, '.git'),
  commit = 'HEAD',
  cache = {},
}) {
  try {
    assertParameter('fs', _fs)
    assertParameter('dir', dir)
    assertParameter('gitdir', gitdir)

    const fs = new FileSystem(_fs)
    const trees = [TREE({ ref: commit }), WORKDIR(), STAGE()]
    let unmergedPaths = []

    const updatedGitdir = await discoverGitdir({ fsp: fs, dotgit: gitdir })
    await GitIndexManager.acquire(
      { fs, gitdir: updatedGitdir, cache },
      async function (index) {
        unmergedPaths = index.unmergedPaths
      }
    )

    const results = await _walk({
      fs,
      cache,
      dir,
      gitdir: updatedGitdir,
      trees,
      map: async function (path, [head, workdir, index]) {
        const staged = !(await modified(workdir, index))
        const unmerged = unmergedPaths.includes(path)
        const unmodified = !(await modified(index, head))

        if (staged || unmerged) {
          if (head) {
            return {
              path,
              mode: await head.mode(),
              oid: await head.oid(),
              type: await head.type(),
              content: await head.content(),
            }
          }
          // Added by the merge or staged during it: git drops it. A directory
          // is handled through the files in it.
          if (workdir && (await workdir.type()) === 'tree') return
          return { path, type: 'delete' }
        }
        // Only in the index: git drops it and carries on.
        if (!head && !workdir) return { path, type: 'delete' }

        if (unmodified) return false
        else throw new IndexResetError(path)
      },
    })

    await GitIndexManager.acquire(
      { fs, gitdir: updatedGitdir, cache },
      async function (index) {
        // Reset paths in index and worktree, this can't be done in _walk because the
        // STAGE walker acquires its own index lock.

        for (const entry of results) {
          if (entry === false) continue

          if (entry.type === 'delete') {
            await fs.rm(`${dir}/${entry.path}`)
            index.delete({ filepath: entry.path })
            continue
          }

          if (entry.type === 'blob') {
            // Written the way checkout writes files: a fresh file, so that
            // its mode is right, and a symlink as a link.
            const fullpath = `${dir}/${entry.path}`
            await fs.rm(fullpath)
            if (entry.mode === 0o120000) {
              await fs.writelink(fullpath, Buffer.from(entry.content))
            } else {
              await fs.write(
                fullpath,
                entry.content,
                entry.mode === 0o100755 ? { mode: 0o777 } : {}
              )
            }
            const stats = await fs.lstat(fullpath)
            // The executable bit from lstat cannot be trusted on Windows.
            if (entry.mode === 0o100755) stats.mode = 0o755
            index.insert({ filepath: entry.path, stats, oid: entry.oid })
          }
        }
      }
    )
  } catch (err) {
    err.caller = 'git.abortMerge'
    throw err
  }
}
