/* eslint-env node, browser, jasmine */
import {
  Errors,
  abortRebase,
  add,
  branch,
  checkout,
  commit as gitCommit,
  continueRebase,
  init,
  log,
  merge,
  readCommit,
  rebase,
  resolveRef,
  status,
  statusMatrix,
} from 'isomorphic-git'
import { GitIndexManager } from 'isomorphic-git/internal-apis'

import { makeFixture } from './__helpers__/FixtureFS.js'

describe('rebase', () => {
  const author = {
    name: 'Original Author',
    email: 'original@example.com',
    timestamp: 1600000000,
    timezoneOffset: 0,
  }
  const committer = {
    name: 'Committer',
    email: 'committer@example.com',
    timestamp: 1700000000,
    timezoneOffset: 0,
  }

  // base:   f.txt, keep.txt
  // topic:  "topic 1" edits f.txt, "topic 2" adds g.txt
  // master: edits f.txt too unless told otherwise (so "topic 1" conflicts),
  //         and adds m.txt
  async function setup(name, { conflict = true } = {}) {
    const { fs, dir, gitdir } = await makeFixture(name)
    await init({ fs, dir, gitdir })
    await fs.write(`${dir}/f.txt`, 'a\nb\nc\n')
    await fs.write(`${dir}/keep.txt`, 'keep\n')
    await add({ fs, dir, gitdir, filepath: '.' })
    const baseOid = await gitCommit({
      fs,
      dir,
      gitdir,
      message: 'base',
      author,
    })

    await branch({ fs, dir, gitdir, ref: 'topic', checkout: true })
    await fs.write(`${dir}/f.txt`, 'a\nTOPIC\nc\n')
    await add({ fs, dir, gitdir, filepath: 'f.txt' })
    const topic1 = await gitCommit({
      fs,
      dir,
      gitdir,
      message: 'topic 1',
      author,
    })
    await fs.write(`${dir}/g.txt`, 'g\n')
    await add({ fs, dir, gitdir, filepath: 'g.txt' })
    const topic2 = await gitCommit({
      fs,
      dir,
      gitdir,
      message: 'topic 2\n\nbody line\n',
      author,
    })

    await checkout({ fs, dir, gitdir, ref: 'master' })
    if (conflict) await fs.write(`${dir}/f.txt`, 'a\nMASTER\nc\n')
    await fs.write(`${dir}/m.txt`, 'm\n')
    await add({ fs, dir, gitdir, filepath: '.' })
    const masterOid = await gitCommit({
      fs,
      dir,
      gitdir,
      message: 'master 1',
      author,
    })
    await checkout({ fs, dir, gitdir, ref: 'topic' })
    return { fs, dir, gitdir, baseOid, topic1, topic2, masterOid }
  }

  async function history(fs, gitdir, ref) {
    const commits = await log({ fs, gitdir, ref })
    return commits.map(({ commit }) => commit.message.split('\n')[0])
  }

  async function expectClean(fs, dir, gitdir) {
    const matrix = await statusMatrix({ fs, dir, gitdir })
    expect(matrix.every(row => row.slice(1).join() === '1,1,1')).toBe(true)
  }

  it('replays the branch on top of upstream and checks it out', async () => {
    const { fs, dir, gitdir, topic2, masterOid } = await setup(
      'tmp-rebase-clean',
      { conflict: false }
    )

    const { oid } = await rebase({
      fs,
      dir,
      gitdir,
      upstream: 'master',
      committer,
    })

    expect(await resolveRef({ fs, gitdir, ref: 'topic' })).toBe(oid)
    expect(await resolveRef({ fs, gitdir, ref: 'HEAD' })).toBe(oid)
    expect(await fs.read(`${gitdir}/HEAD`, 'utf8')).toBe(
      'ref: refs/heads/topic\n'
    )
    expect(await history(fs, gitdir, 'topic')).toEqual([
      'topic 2',
      'topic 1',
      'master 1',
      'base',
    ])
    const { commit } = await readCommit({ fs, gitdir, oid })
    expect(commit.author).toEqual(author)
    expect(commit.committer).toEqual(committer)
    expect(commit.message).toBe('topic 2\n\nbody line\n')
    const { commit: first } = await readCommit({
      fs,
      gitdir,
      oid: commit.parent[0],
    })
    expect(first.parent).toEqual([masterOid])
    // The working tree now has everything, and remembers where topic was.
    expect(await fs.read(`${dir}/m.txt`, 'utf8')).toBe('m\n')
    expect(await fs.read(`${dir}/f.txt`, 'utf8')).toBe('a\nTOPIC\nc\n')
    await expectClean(fs, dir, gitdir)
    expect(await fs.read(`${gitdir}/ORIG_HEAD`, 'utf8')).toBe(`${topic2}\n`)
  })

  it('does nothing when the branch is already up to date', async () => {
    const { fs, dir, gitdir, baseOid, topic2 } = await setup(
      'tmp-rebase-uptodate'
    )
    for (const upstream of [baseOid, 'topic']) {
      expect(await rebase({ fs, dir, gitdir, upstream, committer })).toEqual({
        oid: topic2,
        alreadyUpToDate: true,
      })
    }
    expect(await resolveRef({ fs, gitdir, ref: 'topic' })).toBe(topic2)
  })

  it('fast-forwards a branch that is behind upstream', async () => {
    const { fs, dir, gitdir, baseOid, topic2 } = await setup('tmp-rebase-ff')
    await branch({ fs, dir, gitdir, ref: 'behind', object: baseOid })

    const { oid } = await rebase({
      fs,
      dir,
      gitdir,
      upstream: 'topic',
      branch: 'behind',
      committer,
    })
    expect(oid).toBe(topic2)
    expect(await resolveRef({ fs, gitdir, ref: 'behind' })).toBe(topic2)
    expect(await fs.read(`${gitdir}/HEAD`, 'utf8')).toBe(
      'ref: refs/heads/behind\n'
    )
    expect(await fs.read(`${dir}/g.txt`, 'utf8')).toBe('g\n')
  })

  it('leaves out merge commits and drops commits that add nothing', async () => {
    const { fs, dir, gitdir, masterOid } = await setup('tmp-rebase-drop', {
      conflict: false,
    })
    // topic merges master, then adds m.txt exactly as master has it.
    await merge({ fs, dir, gitdir, theirs: 'master', author, committer })
    await checkout({ fs, dir, gitdir, ref: 'topic', force: true })
    await fs.write(`${dir}/f.txt`, 'a\nTOPIC\nc\nmore\n')
    await add({ fs, dir, gitdir, filepath: 'f.txt' })
    await gitCommit({ fs, dir, gitdir, message: 'topic 3', author })
    await checkout({ fs, dir, gitdir, ref: 'master' })
    await fs.write(`${dir}/m.txt`, 'm2\n')
    await add({ fs, dir, gitdir, filepath: 'm.txt' })
    await gitCommit({ fs, dir, gitdir, message: 'master 2', author })
    await checkout({ fs, dir, gitdir, ref: 'topic' })
    await fs.write(`${dir}/m.txt`, 'm2\n')
    await add({ fs, dir, gitdir, filepath: 'm.txt' })
    await gitCommit({ fs, dir, gitdir, message: 'same as master 2', author })

    await rebase({ fs, dir, gitdir, upstream: 'master', committer })

    expect(await history(fs, gitdir, 'topic')).toEqual([
      'topic 3',
      'topic 2',
      'topic 1',
      'master 2',
      'master 1',
      'base',
    ])
    expect(await fs.read(`${dir}/m.txt`, 'utf8')).toBe('m2\n')
    await expectClean(fs, dir, gitdir)
    expect(masterOid).toBeDefined()
  })

  it('throws and changes nothing on a conflict by default', async () => {
    const { fs, dir, gitdir, topic2 } = await setup('tmp-rebase-conflict')
    let error = null
    try {
      await rebase({ fs, dir, gitdir, upstream: 'master', committer })
    } catch (e) {
      error = e
    }
    expect(error).not.toBeNull()
    expect(error.code).toBe(Errors.MergeConflictError.code)
    expect(error.data.filepaths).toEqual(['f.txt'])
    expect(await resolveRef({ fs, gitdir, ref: 'topic' })).toBe(topic2)
    expect(await fs.read(`${gitdir}/HEAD`, 'utf8')).toBe(
      'ref: refs/heads/topic\n'
    )
    expect(await fs.read(`${dir}/f.txt`, 'utf8')).toBe('a\nTOPIC\nc\n')
    expect(await fs.exists(`${gitdir}/rebase-merge`)).toBe(false)
    await expectClean(fs, dir, gitdir)
  })

  it('refuses to start over local changes', async () => {
    const { fs, dir, gitdir, topic2 } = await setup('tmp-rebase-dirty', {
      conflict: false,
    })
    await fs.write(`${dir}/keep.txt`, 'edited\n')
    let error = null
    try {
      await rebase({ fs, dir, gitdir, upstream: 'master', committer })
    } catch (e) {
      error = e
    }
    expect(error).not.toBeNull()
    expect(error.code).toBe(Errors.RebaseLocalChangesError.code)
    expect(error.data.filepaths).toEqual(['keep.txt'])
    expect(await resolveRef({ fs, gitdir, ref: 'topic' })).toBe(topic2)
    expect(await fs.read(`${dir}/keep.txt`, 'utf8')).toBe('edited\n')
  })

  describe('untracked files where upstream has a file', () => {
    // master tracks .local/folder.lock; topic has it as an untracked file.
    async function lockSetup(name, { ignore, conflict }) {
      const { fs, dir, gitdir } = await makeFixture(name)
      await init({ fs, dir, gitdir })
      await fs.write(`${dir}/.gitignore`, ignore ? '.local\n' : '')
      await fs.write(`${dir}/f.txt`, 'one\ntwo\nthree\n')
      await add({ fs, dir, gitdir, filepath: '.gitignore' })
      await add({ fs, dir, gitdir, filepath: 'f.txt' })
      await gitCommit({ fs, dir, gitdir, message: 'base', author, committer })
      await branch({ fs, dir, gitdir, ref: 'topic', checkout: true })
      await fs.write(
        `${dir}/f.txt`,
        conflict ? 'one\ntopic\nthree\n' : 'one\ntwo\nthree\ntopic\n'
      )
      await add({ fs, dir, gitdir, filepath: 'f.txt' })
      const topicOid = await gitCommit({
        fs,
        dir,
        gitdir,
        message: 'topic 1',
        author,
        committer,
      })
      await checkout({ fs, dir, gitdir, ref: 'master' })
      await fs.write(`${dir}/.local/folder.lock`, 'theirs\n')
      await add({
        fs,
        dir,
        gitdir,
        filepath: '.local/folder.lock',
        force: true,
      })
      if (conflict) {
        await fs.write(`${dir}/f.txt`, 'one\nmaster\nthree\n')
        await add({ fs, dir, gitdir, filepath: 'f.txt' })
      }
      await gitCommit({ fs, dir, gitdir, message: 'master', author, committer })
      await checkout({ fs, dir, gitdir, ref: 'topic' })
      await fs.write(`${dir}/.local/folder.lock`, 'mine\n')
      return { fs, dir, gitdir, topicOid }
    }

    it('overwrites an untracked file that .gitignore ignores, like git', async () => {
      for (const conflict of [false, true]) {
        const { fs, dir, gitdir } = await lockSetup(
          `tmp-rebase-ignored-${conflict}`,
          { ignore: true, conflict }
        )
        let error = null
        try {
          await rebase({
            fs,
            dir,
            gitdir,
            upstream: 'master',
            committer,
            abortOnConflict: false,
          })
        } catch (e) {
          error = e
        }
        if (conflict) {
          expect(error && error.code).toBe(Errors.MergeConflictError.code)
        } else {
          expect(error).toBeNull()
        }
        expect(await fs.read(`${dir}/.local/folder.lock`, 'utf8')).toBe(
          'theirs\n'
        )
        expect(
          await status({ fs, dir, gitdir, filepath: '.local/folder.lock' })
        ).toBe('unmodified')
      }
    })

    it('refuses an untracked file that is not ignored, like git', async () => {
      const { fs, dir, gitdir, topicOid } = await lockSetup(
        'tmp-rebase-untracked',
        { ignore: false, conflict: false }
      )
      let error = null
      try {
        await rebase({ fs, dir, gitdir, upstream: 'master', committer })
      } catch (e) {
        error = e
      }
      expect(error).not.toBeNull()
      expect(error.code).toBe(Errors.RebaseLocalChangesError.code)
      expect(error.data.filepaths).toEqual(['.local/folder.lock'])
      expect(await resolveRef({ fs, gitdir, ref: 'topic' })).toBe(topicOid)
      expect(await resolveRef({ fs, gitdir, ref: 'HEAD' })).toBe(topicOid)
      expect(await fs.read(`${dir}/.local/folder.lock`, 'utf8')).toBe('mine\n')
      expect(await fs.exists(`${gitdir}/rebase-merge`)).toBe(false)
    })
  })

  describe('stopped on a conflict', () => {
    async function stop(name) {
      const repo = await setup(name)
      const { fs, dir, gitdir } = repo
      let error = null
      try {
        await rebase({
          fs,
          dir,
          gitdir,
          upstream: 'master',
          committer,
          abortOnConflict: false,
        })
      } catch (e) {
        error = e
      }
      expect(error).not.toBeNull()
      expect(error.code).toBe(Errors.MergeConflictError.code)
      return repo
    }

    it("leaves git's state behind and continues after the resolution", async () => {
      const repo = await stop('tmp-rebase-stop')
      const { fs, dir, gitdir, topic1, topic2, masterOid } = repo

      // HEAD is detached at the last commit that applied (none yet).
      expect(await fs.read(`${gitdir}/HEAD`, 'utf8')).toBe(`${masterOid}\n`)
      expect(await resolveRef({ fs, gitdir, ref: 'topic' })).toBe(topic2)
      expect(await fs.read(`${dir}/f.txt`, 'utf8')).toBe(
        `a\n<<<<<<< HEAD\nMASTER\n=======\nTOPIC\n>>>>>>> ${topic1.slice(
          0,
          7
        )} (topic 1)\nc\n`
      )
      expect(await fs.read(`${dir}/m.txt`, 'utf8')).toBe('m\n')
      const unmerged = await GitIndexManager.acquire(
        { fs, gitdir, cache: {} },
        async index => index.unmergedPaths
      )
      expect(unmerged).toEqual(['f.txt'])

      // The files git keeps for a stopped rebase.
      const read = async name => fs.read(`${gitdir}/${name}`, 'utf8')
      const message = 'topic 1\n\n# Conflicts:\n#\tf.txt\n'
      expect(await read('rebase-merge/head-name')).toBe('refs/heads/topic\n')
      expect(await read('rebase-merge/onto')).toBe(`${masterOid}\n`)
      expect(await read('rebase-merge/orig-head')).toBe(`${topic2}\n`)
      expect(await read('rebase-merge/git-rebase-todo')).toBe(
        `pick ${topic2} topic 2\n`
      )
      expect(await read('rebase-merge/done')).toBe(`pick ${topic1} topic 1\n`)
      expect(await read('rebase-merge/msgnum')).toBe('1\n')
      expect(await read('rebase-merge/end')).toBe('2\n')
      expect(await read('rebase-merge/stopped-sha')).toBe(`${topic1}\n`)
      expect(await read('rebase-merge/message')).toBe(message)
      expect(await read('rebase-merge/author-script')).toBe(
        "GIT_AUTHOR_NAME='Original Author'\nGIT_AUTHOR_EMAIL='original@example.com'\nGIT_AUTHOR_DATE='@1600000000 +0000'\n"
      )
      expect(await read('REBASE_HEAD')).toBe(`${topic1}\n`)
      expect(await read('MERGE_MSG')).toBe(message)
      expect(await read('ORIG_HEAD')).toBe(`${topic2}\n`)

      // Continuing before resolving is refused.
      let error = null
      try {
        await continueRebase({ fs, dir, gitdir, committer })
      } catch (e) {
        error = e
      }
      expect(error.code).toBe(Errors.UnmergedPathsError.code)

      await fs.write(`${dir}/f.txt`, 'a\nRESOLVED\nc\n')
      await add({ fs, dir, gitdir, filepath: 'f.txt' })
      const { oid } = await continueRebase({ fs, dir, gitdir, committer })

      expect(await resolveRef({ fs, gitdir, ref: 'topic' })).toBe(oid)
      expect(await fs.read(`${gitdir}/HEAD`, 'utf8')).toBe(
        'ref: refs/heads/topic\n'
      )
      expect(await history(fs, gitdir, 'topic')).toEqual([
        'topic 2',
        'topic 1',
        'master 1',
        'base',
      ])
      const { commit } = await readCommit({ fs, gitdir, oid })
      const { commit: resolved } = await readCommit({
        fs,
        gitdir,
        oid: commit.parent[0],
      })
      expect(resolved.author).toEqual(author)
      expect(resolved.committer).toEqual(committer)
      expect(resolved.message).toBe('topic 1\n')
      expect(await fs.read(`${dir}/f.txt`, 'utf8')).toBe('a\nRESOLVED\nc\n')
      expect(await fs.read(`${dir}/g.txt`, 'utf8')).toBe('g\n')
      await expectClean(fs, dir, gitdir)
      expect(await fs.exists(`${gitdir}/rebase-merge`)).toBe(false)
      expect(await read('REBASE_HEAD')).toBe(null)
      expect(await read('MERGE_MSG')).toBe(null)
    })

    it('accepts a commit made by hand before continuing', async () => {
      const repo = await stop('tmp-rebase-stop-commit')
      const { fs, dir, gitdir } = repo
      await fs.write(`${dir}/f.txt`, 'a\nRESOLVED\nc\n')
      await add({ fs, dir, gitdir, filepath: 'f.txt' })
      // Like `git commit`: the original author and message are kept.
      const byHand = await gitCommit({ fs, dir, gitdir, committer })
      const { commit } = await readCommit({ fs, gitdir, oid: byHand })
      expect(commit.author).toEqual(author)
      expect(commit.message).toBe('topic 1\n')

      const { oid } = await continueRebase({ fs, dir, gitdir, committer })
      const { commit: last } = await readCommit({ fs, gitdir, oid })
      expect(last.parent).toEqual([byHand])
      expect(await history(fs, gitdir, 'topic')).toEqual([
        'topic 2',
        'topic 1',
        'master 1',
        'base',
      ])
      await expectClean(fs, dir, gitdir)
    })

    it('can skip the stopped commit', async () => {
      const repo = await stop('tmp-rebase-skip')
      const { fs, dir, gitdir } = repo
      const { oid } = await continueRebase({
        fs,
        dir,
        gitdir,
        committer,
        skip: true,
      })
      expect(await resolveRef({ fs, gitdir, ref: 'topic' })).toBe(oid)
      expect(await history(fs, gitdir, 'topic')).toEqual([
        'topic 2',
        'master 1',
        'base',
      ])
      expect(await fs.read(`${dir}/f.txt`, 'utf8')).toBe('a\nMASTER\nc\n')
      expect(await fs.read(`${dir}/g.txt`, 'utf8')).toBe('g\n')
      await expectClean(fs, dir, gitdir)
    })

    it('can be aborted', async () => {
      const repo = await stop('tmp-rebase-abort')
      const { fs, dir, gitdir, topic2 } = repo
      await abortRebase({ fs, dir, gitdir })

      expect(await resolveRef({ fs, gitdir, ref: 'topic' })).toBe(topic2)
      expect(await fs.read(`${gitdir}/HEAD`, 'utf8')).toBe(
        'ref: refs/heads/topic\n'
      )
      expect(await fs.read(`${dir}/f.txt`, 'utf8')).toBe('a\nTOPIC\nc\n')
      expect(await fs.exists(`${dir}/m.txt`)).toBe(false)
      expect(await status({ fs, dir, gitdir, filepath: 'f.txt' })).toBe(
        'unmodified'
      )
      expect(await fs.exists(`${gitdir}/rebase-merge`)).toBe(false)
      expect(await fs.read(`${gitdir}/REBASE_HEAD`, 'utf8')).toBe(null)

      let error = null
      try {
        await abortRebase({ fs, dir, gitdir })
      } catch (e) {
        error = e
      }
      expect(error.code).toBe(Errors.NotFoundError.code)
    })

    it('stops again at the next conflict', async () => {
      const repo = await stop('tmp-rebase-twice')
      const { fs, dir, gitdir, topic2 } = repo
      // Make "topic 2" conflict too: master also has a g.txt.
      await fs.write(`${dir}/f.txt`, 'a\nRESOLVED\nc\n')
      await fs.write(`${dir}/g.txt`, 'from master\n')
      await add({ fs, dir, gitdir, filepath: ['f.txt', 'g.txt'] })

      let error = null
      try {
        await continueRebase({ fs, dir, gitdir, committer })
      } catch (e) {
        error = e
      }
      expect(error.code).toBe(Errors.MergeConflictError.code)
      expect(error.data.filepaths).toEqual(['g.txt'])
      expect(await fs.read(`${gitdir}/rebase-merge/stopped-sha`, 'utf8')).toBe(
        `${topic2}\n`
      )
      expect(
        await fs.read(`${gitdir}/rebase-merge/git-rebase-todo`, 'utf8')
      ).toBe('')
      expect(await fs.read(`${gitdir}/rebase-merge/msgnum`, 'utf8')).toBe('2\n')
      expect(await history(fs, gitdir, 'HEAD')).toEqual([
        'topic 1',
        'master 1',
        'base',
      ])
    })
  })
})
