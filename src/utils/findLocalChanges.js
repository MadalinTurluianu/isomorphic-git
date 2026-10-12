// @ts-check
import '../typedefs.js'

import { STAGE } from '../commands/STAGE.js'
import { TREE } from '../commands/TREE.js'
import { WORKDIR } from '../commands/WORKDIR.js'
import { _walk } from '../commands/walk.js'
import { GitIgnoreManager } from '../managers/GitIgnoreManager.js'
import { GitIndexManager } from '../managers/GitIndexManager.js'

import { modified } from './modified.js'
import { worthWalking } from './worthWalking.js'

/**
 * Lists the local changes that writing the result of a three-way merge of
 * `headTree`, `baseTree` and `theirTree` into the working tree would destroy,
 * following git's rules: any staged change (the index differs from
 * `headTree`), plus unstaged edits, untracked files and directories at the
 * paths that differ between `baseTree` and `theirTree`. Untracked files that
 * `.gitignore` ignores are expendable, as in git, and are not reported. A
 * working tree that was never checked out (empty index) has nothing staged.
 *
 * Throws `UnmergedPathsError` if the index still has unmerged paths.
 *
 * @param {object} args
 * @param {import('../models/FileSystem.js').FileSystem} args.fs
 * @param {object} args.cache
 * @param {string} args.dir
 * @param {string} args.gitdir
 * @param {string} args.headTree
 * @param {string} args.baseTree
 * @param {string} args.theirTree
 * @param {string[]} [args.ignored] - receives the ignored untracked files that
 * writing the merge would overwrite, for callers that remove them first
 *
 * @returns {Promise<string[]>}
 */
export async function findLocalChanges({
  fs,
  cache,
  dir,
  gitdir,
  headTree,
  baseTree,
  theirTree,
  ignored,
}) {
  // Unmerged paths mean a previous merge is still unresolved. An empty index
  // means nothing was checked out yet, so nothing is staged either.
  const checkedOut = await GitIndexManager.acquire(
    { fs, gitdir, cache, allowUnmerged: false },
    async index => index.entriesMap.size > 0
  )

  /** @type {string[]} */
  const staged = !checkedOut
    ? []
    : await _walk({
        fs,
        cache,
        dir,
        gitdir,
        trees: [TREE({ ref: headTree }), STAGE()],
        map: async (filepath, [head, stage]) => {
          if (filepath === '.') return
          // Directories are reported through the files inside them.
          if (
            (!head || (await head.type()) === 'tree') &&
            (!stage || (await stage.type()) === 'tree')
          ) {
            return
          }
          if (await modified(stage, head)) return filepath
        },
      })

  /** @type {string[]} */
  const changed = await _walk({
    fs,
    cache,
    dir,
    gitdir,
    trees: [
      TREE({ ref: baseTree }),
      TREE({ ref: theirTree }),
      TREE({ ref: headTree }),
    ],
    map: async (filepath, [base, their, head]) => {
      if (filepath === '.') return
      const same = async (x, y) =>
        x &&
        y &&
        (await x.oid()) === (await y.oid()) &&
        (await x.mode()) === (await y.mode())
      // Nothing is written where theirs did not change, where ours already
      // has their version, or where both sides deleted the file.
      if (
        (await same(base, their)) ||
        (await same(their, head)) ||
        (!their && !head)
      ) {
        return null
      }
      const types = [
        base ? await base.type() : undefined,
        their ? await their.type() : undefined,
      ]
      if (types.includes('blob')) return filepath
    },
  })
  if (changed.length === 0) return staged

  /** @type {string[]} */
  const unstaged = await _walk({
    fs,
    cache,
    dir,
    gitdir,
    trees: [TREE({ ref: headTree }), WORKDIR()],
    map: async (filepath, [head, workdir]) => {
      if (filepath === '.') return
      if (!changed.some(path => worthWalking(filepath, path))) return null
      const headOid =
        head && (await head.type()) === 'blob' ? await head.oid() : undefined
      // Like git, an untracked file that .gitignore ignores may be overwritten.
      const expendable = async () => {
        const yes =
          (await workdir.type()) === 'blob' &&
          (await GitIgnoreManager.isIgnored({ fs, dir, gitdir, filepath }))
        if (yes && ignored) ignored.push(filepath)
        return yes
      }
      // A tracked directory where the merge wants a file is judged through
      // the files inside it.
      if (
        head &&
        workdir &&
        (await head.type()) === 'tree' &&
        (await workdir.type()) === 'tree'
      ) {
        return
      }
      if (!changed.includes(filepath)) {
        // An untracked file where the merge needs a directory, or inside a
        // directory the merge replaces with a file.
        if (
          !headOid &&
          workdir &&
          (await workdir.type()) === 'blob' &&
          changed.some(
            path =>
              path.startsWith(`${filepath}/`) || filepath.startsWith(`${path}/`)
          ) &&
          !(await expendable())
        ) {
          return filepath
        }
        return
      }
      // A file missing from the working tree has nothing to lose.
      if (!workdir) return
      // Untracked files and directories in the way.
      if (!headOid) return (await expendable()) ? undefined : filepath
      // Unstaged edits, and a directory where a tracked file was.
      if (
        (await workdir.type()) !== 'blob' ||
        (await workdir.oid()) !== headOid
      ) {
        return filepath
      }
    },
  })
  return [...new Set([...staged, ...unstaged])]
}
