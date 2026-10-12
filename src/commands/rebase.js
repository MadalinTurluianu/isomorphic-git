// @ts-check
import '../typedefs.js'

import { _checkout } from '../commands/checkout.js'
import { _commit } from '../commands/commit.js'
import { _currentBranch } from '../commands/currentBranch.js'
import { _findMergeBase } from '../commands/findMergeBase.js'
import { _readCommit } from '../commands/readCommit.js'
import { AlreadyExistsError } from '../errors/AlreadyExistsError.js'
import { EmptyCommitError } from '../errors/EmptyCommitError.js'
import { MergeConflictError } from '../errors/MergeConflictError.js'
import { MergeNotSupportedError } from '../errors/MergeNotSupportedError.js'
import { MissingParameterError } from '../errors/MissingParameterError.js'
import { NotFoundError } from '../errors/NotFoundError.js'
import { RebaseLocalChangesError } from '../errors/RebaseLocalChangesError.js'
import { GitIndexManager } from '../managers/GitIndexManager.js'
import { GitRefManager } from '../managers/GitRefManager.js'
import { GitShallowManager } from '../managers/GitShallowManager.js'
import { findLocalChanges } from '../utils/findLocalChanges.js'
import {
  clearMergeState,
  formatMergeMessage,
  stripConflictsComment,
} from '../utils/mergeState.js'
import { mergeTree } from '../utils/mergeTree.js'
import { resolveCommit } from '../utils/resolveCommit.js'

const EMPTY_TREE_OID = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/**
 * @typedef {Object} RebaseResult
 * @property {string} oid - The commit the rebased branch now points to
 * @property {boolean} [alreadyUpToDate] - True if the branch was already based on `upstream`, so nothing was done
 */

/**
 * @typedef {Object} RebaseState - What `.git/rebase-merge` remembers between stops
 * @property {string} headName - The branch being rebased, e.g. `refs/heads/topic`
 * @property {string} onto - The commit the branch is replayed onto
 * @property {string} origHead - Where the branch was before the rebase
 * @property {Array<{oid: string, subject: string}>} todo - The commits still to replay
 * @property {Array<{oid: string, subject: string}>} done - The commits already handled
 * @property {string} [stoppedSha] - The commit whose replay stopped on conflicts
 */

/**
 * @param {object} args
 * @param {import('../models/FileSystem.js').FileSystem} args.fs
 * @param {object} args.cache
 * @param {string} [args.dir]
 * @param {string} args.gitdir
 * @param {string} args.upstream
 * @param {string} [args.onto]
 * @param {string} [args.branch]
 * @param {Object} args.committer
 * @param {boolean} args.abortOnConflict
 * @param {MergeDriverCallback} [args.mergeDriver]
 *
 * @returns {Promise<RebaseResult>}
 */
export async function _rebase({
  fs,
  cache,
  dir,
  gitdir,
  upstream,
  onto = upstream,
  branch,
  committer,
  abortOnConflict = true,
  mergeDriver,
}) {
  if (await fs.exists(`${gitdir}/rebase-merge`)) {
    throw new AlreadyExistsError('rebase', `${gitdir}/rebase-merge`, false)
  }
  if (branch === undefined) {
    branch = await _currentBranch({ fs, gitdir, fullname: true })
    if (!branch) throw new MissingParameterError('branch')
  }
  const headName = await GitRefManager.expand({ fs, gitdir, ref: branch })
  const origHead = await GitRefManager.resolve({ fs, gitdir, ref: headName })
  const upstreamOid = await resolveCommitish({
    fs,
    cache,
    gitdir,
    ref: upstream,
  })
  const ontoOid = await resolveCommitish({ fs, cache, gitdir, ref: onto })

  // Like git, nothing to do when the branch already sits on top of upstream.
  if (ontoOid === upstreamOid) {
    const bases = await _findMergeBase({
      fs,
      cache,
      gitdir,
      oids: [origHead, upstreamOid],
    })
    if (origHead === upstreamOid || bases.includes(upstreamOid)) {
      return { oid: origHead, alreadyUpToDate: true }
    }
  }

  if (dir) await assertCleanWorkTree({ fs, cache, dir, gitdir })

  const picks = await listPicks({
    fs,
    cache,
    gitdir,
    tip: origHead,
    upstream: upstreamOid,
  })
  const state = {
    headName,
    onto: ontoOid,
    origHead,
    todo: picks.map(pick => ({ oid: pick.oid, subject: subjectOf(pick) })),
    done: [],
  }
  return replay({
    fs,
    cache,
    dir,
    gitdir,
    state,
    head: ontoOid,
    committer,
    stopOnConflict: !abortOnConflict,
    mergeDriver,
  })
}

/**
 * @param {object} args
 * @param {import('../models/FileSystem.js').FileSystem} args.fs
 * @param {object} args.cache
 * @param {string} args.dir
 * @param {string} args.gitdir
 * @param {Object} args.committer
 * @param {boolean} args.skip
 * @param {MergeDriverCallback} [args.mergeDriver]
 *
 * @returns {Promise<RebaseResult>}
 */
export async function _continueRebase({
  fs,
  cache,
  dir,
  gitdir,
  committer,
  skip = false,
  mergeDriver,
}) {
  const state = await readState({ fs, gitdir })
  const head = await GitRefManager.resolve({ fs, gitdir, ref: 'HEAD' })

  if (skip) {
    // Drop whatever the stopped commit left in the index and working tree.
    await _checkout({ fs, cache, dir, gitdir, ref: head, force: true })
  } else if (state.stoppedSha) {
    // Unresolved conflicts stop here with an UnmergedPathsError.
    await GitIndexManager.acquire(
      { fs, gitdir, cache, allowUnmerged: false },
      async () => {}
    )
    // Commit the resolution, unless the user already did (or nothing is
    // left of the commit).
    const { commit } = await _readCommit({
      fs,
      cache,
      gitdir,
      oid: state.stoppedSha,
    })
    const message =
      (await fs.read(`${gitdir}/rebase-merge/message`, { encoding: 'utf8' })) ||
      commit.message
    try {
      await _commit({
        fs,
        cache,
        gitdir,
        message: stripConflictsComment(/** @type {string} */ (message)),
        author: commit.author,
        committer,
        disallowEmpty: true,
      })
    } catch (err) {
      if (err.code !== EmptyCommitError.code) throw err
    }
  }
  for (const file of ['stopped-sha', 'message', 'author-script']) {
    await fs.rm(`${gitdir}/rebase-merge/${file}`)
  }
  await fs.rm(`${gitdir}/REBASE_HEAD`)
  await clearMergeState({ fs, gitdir })

  return replay({
    fs,
    cache,
    dir,
    gitdir,
    state,
    head: await GitRefManager.resolve({ fs, gitdir, ref: 'HEAD' }),
    committer,
    stopOnConflict: true,
    mergeDriver,
  })
}

/**
 * @param {object} args
 * @param {import('../models/FileSystem.js').FileSystem} args.fs
 * @param {object} args.cache
 * @param {string} args.dir
 * @param {string} args.gitdir
 */
export async function _abortRebase({ fs, cache, dir, gitdir }) {
  const state = await readState({ fs, gitdir })
  // The branch itself never moved; putting it back in the working tree and
  // under HEAD is all there is to undo.
  await _checkout({ fs, cache, dir, gitdir, ref: state.headName, force: true })
  await clearRebaseState({ fs, gitdir })
}

/**
 * Replay `state.todo` on top of `head`, then move the branch there. A commit
 * that conflicts either throws right away or, with `stopOnConflict`, is left
 * in the working tree the way git leaves it, with the rebase state recorded
 * for `continueRebase`, `abortRebase` or `git rebase --continue`.
 */
async function replay({
  fs,
  cache,
  dir,
  gitdir,
  state,
  head,
  committer,
  stopOnConflict,
  mergeDriver,
}) {
  while (state.todo.length) {
    const pick = state.todo.shift()
    state.done.push(pick)
    const { commit } = await _readCommit({ fs, cache, gitdir, oid: pick.oid })
    const baseTree = commit.parent.length
      ? (await _readCommit({ fs, cache, gitdir, oid: commit.parent[0] })).commit
          .tree
      : EMPTY_TREE_OID
    const headTree = (await _readCommit({ fs, cache, gitdir, oid: head }))
      .commit.tree

    let tree = headTree
    if (commit.tree !== baseTree) {
      // Work out the merge first without touching the working tree, so a
      // conflict can still be reported with nothing changed.
      const merge = args =>
        GitIndexManager.acquire({ fs, gitdir, cache }, index =>
          mergeTree({
            fs,
            cache,
            gitdir,
            index,
            ourOid: headTree,
            baseOid: baseTree,
            theirOid: commit.tree,
            ourName: 'HEAD',
            baseName: `parent of ${pick.oid.slice(0, 7)}`,
            theirName: `${pick.oid.slice(0, 7)} (${pick.subject})`,
            abortOnConflict: true,
            mergeDriver,
            ...args,
          })
        )
      const result = await merge({})
      if (result instanceof MergeConflictError) {
        if (!stopOnConflict || !dir) throw result
        await checkoutOver({ fs, cache, dir, gitdir, oid: head })
        const conflict = await merge({ dir, abortOnConflict: false })
        await writeStop({ fs, gitdir, state, pick, commit, conflict })
        throw conflict
      }
      tree = result
      // A commit that has nothing left to add is dropped, like git does.
      if (tree === headTree) continue
    }
    head = await _commit({
      fs,
      cache,
      gitdir,
      message: commit.message,
      tree,
      parent: [head],
      author: commit.author,
      committer,
      noUpdateBranch: true,
    })
  }

  if (dir) await checkoutOver({ fs, cache, dir, gitdir, oid: head })
  await GitRefManager.writeRef({ fs, gitdir, ref: state.headName, value: head })
  await GitRefManager.writeSymbolicRef({
    fs,
    gitdir,
    ref: 'HEAD',
    value: state.headName,
  })
  await fs.write(`${gitdir}/ORIG_HEAD`, `${state.origHead}\n`)
  await clearRebaseState({ fs, gitdir })
  return { oid: head }
}

// Check out a commit the way git's rebase does: refuse when an untracked file
// is in the way, but replace untracked files that .gitignore ignores.
async function checkoutOver({ fs, cache, dir, gitdir, oid }) {
  const treeOf = async ref =>
    (
      await _readCommit({
        fs,
        cache,
        gitdir,
        oid: await GitRefManager.resolve({ fs, gitdir, ref }),
      })
    ).commit.tree
  const from = await treeOf('HEAD')
  const ignored = []
  const filepaths = await findLocalChanges({
    fs,
    cache,
    dir,
    gitdir,
    headTree: from,
    baseTree: from,
    theirTree: await treeOf(oid),
    ignored,
  })
  if (filepaths.length > 0) throw new RebaseLocalChangesError(filepaths)
  for (const filepath of ignored) await fs.rm(`${dir}/${filepath}`)
  await _checkout({ fs, cache, dir, gitdir, ref: oid })
}

// Record the stopped rebase the way git does, so git can take over.
async function writeStop({ fs, gitdir, state, pick, commit, conflict }) {
  const message = formatMergeMessage(commit.message, conflict.data.filepaths)
  const line = ({ oid, subject }) => `pick ${oid} ${subject}\n`
  const files = {
    'head-name': `${state.headName}\n`,
    onto: `${state.onto}\n`,
    'orig-head': `${state.origHead}\n`,
    'git-rebase-todo': state.todo.map(line).join(''),
    done: state.done.map(line).join(''),
    end: `${state.todo.length + state.done.length}\n`,
    msgnum: `${state.done.length}\n`,
    'stopped-sha': `${pick.oid}\n`,
    message,
    'author-script': authorScript(commit.author),
    interactive: '',
  }
  for (const [name, content] of Object.entries(files)) {
    await fs.write(`${gitdir}/rebase-merge/${name}`, content)
  }
  await fs.write(`${gitdir}/REBASE_HEAD`, `${pick.oid}\n`)
  await fs.write(`${gitdir}/MERGE_MSG`, message)
  await fs.write(`${gitdir}/ORIG_HEAD`, `${state.origHead}\n`)
}

/** @returns {Promise<RebaseState>} */
async function readState({ fs, gitdir }) {
  const read = async name =>
    /** @type {string|null} */ (
      await fs.read(`${gitdir}/rebase-merge/${name}`, { encoding: 'utf8' })
    )
  const headName = await read('head-name')
  if (!headName) throw new NotFoundError('a rebase in progress')
  // Only picks are understood; anything else in the to-do list is refused,
  // while the list of what is done is just read for its count.
  const picks = (text, strict) =>
    (text || '')
      .split('\n')
      .filter(line => line && !line.startsWith('#'))
      .map(line => {
        const [command, oid, ...subject] = line.split(' ')
        if (strict && command !== 'pick' && command !== 'p') {
          throw new MergeNotSupportedError(`rebase todo command '${command}'`)
        }
        return { oid, subject: subject.join(' ') }
      })
  const stoppedSha = await read('stopped-sha')
  return {
    headName: headName.trim(),
    onto: /** @type {string} */ (await read('onto')).trim(),
    origHead: /** @type {string} */ (await read('orig-head')).trim(),
    todo: picks(await read('git-rebase-todo'), true),
    done: picks(await read('done'), false),
    stoppedSha: stoppedSha ? stoppedSha.trim() : undefined,
  }
}

async function clearRebaseState({ fs, gitdir }) {
  await fs.rmdir(`${gitdir}/rebase-merge`, { recursive: true })
  await fs.rm(`${gitdir}/REBASE_HEAD`)
  await clearMergeState({ fs, gitdir })
}

// Like `git rebase`, refuse to start over any staged or unstaged change.
async function assertCleanWorkTree({ fs, cache, dir, gitdir }) {
  const { commit } = await _readCommit({
    fs,
    cache,
    gitdir,
    oid: await GitRefManager.resolve({ fs, gitdir, ref: 'HEAD' }),
  })
  // With the empty tree as "theirs", every tracked file counts as touched.
  const filepaths = await findLocalChanges({
    fs,
    cache,
    dir,
    gitdir,
    headTree: commit.tree,
    baseTree: commit.tree,
    theirTree: EMPTY_TREE_OID,
  })
  if (filepaths.length > 0) throw new RebaseLocalChangesError(filepaths)
}

// How far back in time the upstream side keeps being painted once no commit
// from the tip side is left to look at, to cope with commits whose dates are
// out of order (git uses a small count of commits for the same purpose).
const DATE_SLOP = 24 * 60 * 60

/**
 * The commits reachable from `tip` but not from `upstream`, oldest first and
 * parents before children, leaving out merge commits: what
 * `git rev-list --reverse --topo-order --no-merges upstream..tip` lists.
 * Commits are visited newest first, upstream's side first on equal dates, so
 * the ones on the upstream side are recognised before they are reached from
 * the tip.
 */
async function listPicks({ fs, cache, gitdir, tip, upstream }) {
  const shallows = await GitShallowManager.read({ fs, gitdir })
  const seen = new Map()
  const queue = []
  const date = entry => entry.commit.committer.timestamp
  const goesBefore = (a, b) =>
    date(a) > date(b) ||
    (date(a) === date(b) && a.uninteresting && !b.uninteresting)
  const add = async (oid, uninteresting) => {
    const entry = seen.get(oid)
    if (entry) {
      if (uninteresting) markUninteresting(entry)
      return
    }
    const { commit } = await _readCommit({ fs, cache, gitdir, oid })
    const parents = shallows.has(oid) ? [] : commit.parent
    const added = { oid, commit, parents, uninteresting }
    seen.set(oid, added)
    const at = queue.findIndex(other => goesBefore(added, other))
    queue.splice(at === -1 ? queue.length : at, 0, added)
  }
  const markUninteresting = entry => {
    if (entry.uninteresting) return
    entry.uninteresting = true
    for (const parent of entry.parents) {
      const parentEntry = seen.get(parent)
      if (parentEntry) markUninteresting(parentEntry)
    }
  }
  await add(tip, false)
  await add(upstream, true)
  const collected = []
  let oldest = Infinity
  while (queue.length) {
    const entry = queue[0]
    if (
      entry.uninteresting &&
      date(entry) < oldest - DATE_SLOP &&
      queue.every(other => other.uninteresting)
    ) {
      break
    }
    queue.shift()
    for (const parent of entry.parents) await add(parent, entry.uninteresting)
    if (!entry.uninteresting) {
      collected.push(entry)
      oldest = Math.min(oldest, date(entry))
    }
  }
  // Parents before children, keeping the date order where it does not matter.
  const ordered = []
  const visited = new Set()
  for (const start of collected.reverse()) {
    const stack = [start]
    while (stack.length) {
      const entry = stack[stack.length - 1]
      if (visited.has(entry.oid)) {
        stack.pop()
        continue
      }
      const pending = entry.parents
        .map(oid => seen.get(oid))
        .filter(
          parent => parent && !parent.uninteresting && !visited.has(parent.oid)
        )
      if (pending.length) {
        stack.push(...pending)
      } else {
        visited.add(entry.oid)
        stack.pop()
        if (!entry.uninteresting) ordered.push(entry)
      }
    }
  }
  return ordered.filter(entry => entry.commit.parent.length <= 1)
}

async function resolveCommitish({ fs, cache, gitdir, ref }) {
  const oid = await GitRefManager.resolve({ fs, gitdir, ref })
  return (await resolveCommit({ fs, cache, gitdir, oid })).oid
}

function subjectOf({ commit }) {
  return commit.message.split('\n')[0]
}

function authorScript({ name, email, timestamp, timezoneOffset }) {
  const quote = value => `'${String(value).replace(/'/g, `'\\''`)}'`
  const sign = timezoneOffset > 0 ? '-' : '+'
  const minutes = Math.abs(timezoneOffset)
  const zone = `${sign}${String(Math.floor(minutes / 60)).padStart(
    2,
    '0'
  )}${String(minutes % 60).padStart(2, '0')}`
  return (
    `GIT_AUTHOR_NAME=${quote(name)}\n` +
    `GIT_AUTHOR_EMAIL=${quote(email)}\n` +
    `GIT_AUTHOR_DATE=${quote(`@${timestamp} ${zone}`)}\n`
  )
}
