// @ts-check
import '../typedefs.js'

import { _rebase } from '../commands/rebase.js'
import { MissingNameError } from '../errors/MissingNameError.js'
import { FileSystem } from '../models/FileSystem.js'
import { assertParameter } from '../utils/assertParameter.js'
import { discoverGitdir } from '../utils/discoverGitdir.js'
import { join } from '../utils/join.js'
import { normalizeCommitterObject } from '../utils/normalizeCommitterObject.js'

/**
 *
 * @typedef {Object} RebaseResult - Returns an object with a schema like this:
 * @property {string} oid - The commit the rebased branch now points to
 * @property {boolean} [alreadyUpToDate] - True if the branch was already based on `upstream`, so nothing was done
 *
 */

/**
 * Rebase a branch onto another commit
 *
 * Like `git rebase <upstream> [<branch>]`, this replays the commits that are in `branch` but not in `upstream` on top of `upstream` (or `onto`), one cherry-pick at a time, keeping each commit's author and message.
 * Merge commits are left out, and a commit that ends up adding nothing is dropped.
 * The branch is then moved to the result and checked out.
 *
 * Like git, it refuses to start over local changes: any staged or unstaged change throws a `RebaseLocalChangesError`.
 *
 * ## Conflicts
 *
 * By default a commit that does not apply cleanly throws a `MergeConflictError` and leaves the branch, the index and the working tree untouched.
 *
 * With `abortOnConflict: false` the rebase stops where `git rebase` would: HEAD is detached at the last commit that applied, the conflict is written to the working tree and the index (see [merge](./merge.md)), and the rebase is recorded in `.git/rebase-merge` with the files git uses.
 * From there, resolve the conflicts and [add](./add.md) the files, then call [continueRebase](./continueRebase.md) (or run `git rebase --continue`) to go on, or [abortRebase](./abortRebase.md) (or `git rebase --abort`) to put the branch back.
 * [commit](./commit.md) during a stopped rebase keeps the original author and message, like `git commit` does.
 *
 * @param {object} args
 * @param {FsClient} args.fs - a file system client
 * @param {string} [args.dir] - The [working tree](dir-vs-gitdir.md) directory path
 * @param {string} [args.gitdir=join(dir,'.git')] - [required] The [git directory](dir-vs-gitdir.md) path
 * @param {string} args.upstream - The branch or commit to rebase onto; commits already in it are not replayed
 * @param {string} [args.onto=upstream] - Replay the commits onto this commit instead of `upstream`
 * @param {string} [args.branch] - The branch to rebase. Defaults to the current branch.
 * @param {Object} [args.committer] - The committer of the replayed commits. If not specified, uses user.name and user.email config with current timestamp.
 * @param {string} [args.committer.name] - Default is `user.name` config.
 * @param {string} [args.committer.email] - Default is `user.email` config.
 * @param {number} [args.committer.timestamp=Math.floor(Date.now()/1000)] - Set the committer timestamp field. This is the integer number of seconds since the Unix epoch (1970-01-01 00:00:00).
 * @param {number} [args.committer.timezoneOffset] - Set the committer timezone offset field. This is the difference, in minutes, from the current timezone to UTC. Default is `(new Date()).getTimezoneOffset()`.
 * @param {boolean} [args.abortOnConflict=true] - If true, a conflict throws and nothing is changed. If false, the rebase stops with the conflict in the working tree and index, to be continued or aborted.
 * @param {MergeDriverCallback} [args.mergeDriver] - a [merge driver](mergeDriver.md) implementation
 * @param {object} [args.cache] - a [cache](cache.md) object
 *
 * @returns {Promise<RebaseResult>} Resolves successfully once the branch has been rebased
 * @see RebaseResult
 *
 * @example
 * // Rebase the current branch onto main
 * const { oid } = await git.rebase({ fs, dir: '/tutorial', upstream: 'main' })
 * console.log(oid)
 *
 */
export async function rebase({
  fs: _fs,
  dir,
  gitdir = join(dir, '.git'),
  upstream,
  onto,
  branch,
  committer,
  abortOnConflict = true,
  mergeDriver,
  cache = {},
}) {
  try {
    assertParameter('fs', _fs)
    assertParameter('gitdir', gitdir)
    assertParameter('upstream', upstream)

    const fs = new FileSystem(_fs)
    const updatedGitdir = await discoverGitdir({ fsp: fs, dotgit: gitdir })

    const normalizedCommitter = await normalizeCommitterObject({
      fs,
      gitdir: updatedGitdir,
      committer,
    })
    if (!normalizedCommitter) throw new MissingNameError('committer')

    return await _rebase({
      fs,
      cache,
      dir,
      gitdir: updatedGitdir,
      upstream,
      onto,
      branch,
      committer: normalizedCommitter,
      abortOnConflict,
      mergeDriver,
    })
  } catch (err) {
    err.caller = 'git.rebase'
    throw err
  }
}
