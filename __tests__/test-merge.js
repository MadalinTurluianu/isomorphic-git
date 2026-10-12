/* eslint-env node, browser, jasmine */

import diff3Merge from 'diff3'
import {
  Errors,
  merge,
  add,
  branch,
  checkout,
  init,
  readBlob,
  readCommit,
  readTree,
  remove,
  resolveRef,
  log,
  status,
  statusMatrix,
  commit as gitCommit,
  annotatedTag,
  writeBlob,
  writeTree,
} from 'isomorphic-git'
import { GitIndexManager } from 'isomorphic-git/internal-apis'

import { makeFixture } from './__helpers__/FixtureFS.js'

describe('merge', () => {
  it('prevent merge if index has unmerged paths', async () => {
    // Setup
    const { gitdir, dir, fs } = await makeFixture('test-GitIndex-unmerged')

    // Test
    let error = null
    try {
      await merge({
        fs,
        dir,
        gitdir,
        ours: 'a',
        theirs: 'b',
        abortOnConflict: false,
        author: {
          name: 'Mr. Test',
          email: 'mrtest@example.com',
          timestamp: 1262356920,
          timezoneOffset: -0,
        },
      })
    } catch (e) {
      error = e
    }
    expect(error).not.toBeNull()
    expect(error.code).toBe(Errors.UnmergedPathsError.code)
  })
  it('merge master into master', async () => {
    // Setup
    const { fs, gitdir } = await makeFixture('test-merge')
    // Test
    const desiredOid = await resolveRef({
      fs,
      gitdir,
      ref: 'master',
    })
    const m = await merge({
      fs,
      gitdir,
      ours: 'master',
      theirs: 'master',
      fastForwardOnly: true,
    })
    expect(m.oid).toEqual(desiredOid)
    expect(m.alreadyMerged).toBeTruthy()
    expect(m.fastForward).toBeFalsy()
    const oid = await resolveRef({
      fs,
      gitdir,
      ref: 'master',
    })
    expect(oid).toEqual(desiredOid)
  })

  it('merge medium into master', async () => {
    // Setup
    const { fs, gitdir } = await makeFixture('test-merge')
    // Test
    const desiredOid = await resolveRef({
      fs,
      gitdir,
      ref: 'medium',
    })
    const m = await merge({
      fs,
      gitdir,
      ours: 'master',
      theirs: 'medium',
      fastForwardOnly: true,
    })
    expect(m.oid).toEqual(desiredOid)
    expect(m.alreadyMerged).toBeTruthy()
    expect(m.fastForward).toBeFalsy()
    const oid = await resolveRef({
      fs,
      gitdir,
      ref: 'master',
    })
    expect(oid).toEqual(desiredOid)
  })

  it('merge oldest into master', async () => {
    // Setup
    const { fs, gitdir } = await makeFixture('test-merge')
    // Test
    const desiredOid = await resolveRef({
      fs,
      gitdir,
      ref: 'master',
    })
    const m = await merge({
      fs,
      gitdir,
      ours: 'master',
      theirs: 'oldest',
      fastForwardOnly: true,
    })
    expect(m.oid).toEqual(desiredOid)
    expect(m.alreadyMerged).toBeTruthy()
    expect(m.fastForward).toBeFalsy()
    const oid = await resolveRef({
      fs,
      gitdir,
      ref: 'master',
    })
    expect(oid).toEqual(desiredOid)
  })

  it('merge newest into master', async () => {
    // Setup
    const { fs, gitdir } = await makeFixture('test-merge')
    // Test
    const desiredOid = await resolveRef({
      fs,
      gitdir,
      ref: 'newest',
    })
    const m = await merge({
      fs,
      gitdir,
      ours: 'master',
      theirs: 'newest',
      fastForwardOnly: true,
    })
    expect(m.oid).toEqual(desiredOid)
    expect(m.alreadyMerged).toBeFalsy()
    expect(m.fastForward).toBeTruthy()
    const oid = await resolveRef({
      fs,
      gitdir,
      ref: 'master',
    })
    expect(oid).toEqual(desiredOid)
  })

  it('merge annotated tag of newest into master', async () => {
    // Setup
    const { fs, gitdir } = await makeFixture('test-merge')
    await annotatedTag({
      fs,
      gitdir,
      ref: 'newest-tag',
      object: 'newest',
      message: 'annotated tag',
      tagger: {
        name: 'Mr. Test',
        email: 'mrtest@example.com',
        timestamp: 1262356920,
        timezoneOffset: -0,
      },
    })
    // Test
    const desiredOid = await resolveRef({
      fs,
      gitdir,
      ref: 'newest',
    })
    const m = await merge({
      fs,
      gitdir,
      ours: 'master',
      theirs: 'newest-tag',
      fastForwardOnly: true,
    })
    expect(m.oid).toEqual(desiredOid)
    expect(m.fastForward).toBeTruthy()
    const oid = await resolveRef({
      fs,
      gitdir,
      ref: 'master',
    })
    expect(oid).toEqual(desiredOid)
  })

  it('merge annotated tag oid of newest into master', async () => {
    // Setup
    const { fs, gitdir } = await makeFixture('test-merge')
    await annotatedTag({
      fs,
      gitdir,
      ref: 'newest-tag',
      object: 'newest',
      message: 'annotated tag',
      tagger: {
        name: 'Mr. Test',
        email: 'mrtest@example.com',
        timestamp: 1262356920,
        timezoneOffset: -0,
      },
    })
    const tagOid = await resolveRef({ fs, gitdir, ref: 'newest-tag' })
    // Test
    const desiredOid = await resolveRef({
      fs,
      gitdir,
      ref: 'newest',
    })
    const m = await merge({
      fs,
      gitdir,
      ours: 'master',
      theirs: tagOid,
      fastForwardOnly: true,
    })
    expect(m.oid).toEqual(desiredOid)
    expect(m.fastForward).toBeTruthy()
    const oid = await resolveRef({
      fs,
      gitdir,
      ref: 'master',
    })
    expect(oid).toEqual(desiredOid)
  })

  it('merge no fast-forward', async () => {
    // Setup
    const { fs, gitdir } = await makeFixture('test-merge-no-ff')
    // Test
    const m = await merge({
      fs,
      gitdir,
      ours: 'main',
      theirs: 'add-files',
      fastForward: false,
      author: {
        name: 'Mr. Test',
        email: 'mrtest@example.com',
        timestamp: 1262356920,
        timezoneOffset: -0,
      },
    })
    expect(m.oid).toBeTruthy()
    expect(m.tree).toBeTruthy()
    expect(m.alreadyMerged).toBeFalsy()
    expect(m.fastForward).toBeFalsy()
    expect(m.mergeCommit).toBeTruthy()
  })

  it('merge newest into master --dryRun (no author needed since fastForward)', async () => {
    // Setup
    const { fs, gitdir } = await makeFixture('test-merge')
    // Test
    const originalOid = await resolveRef({
      fs,
      gitdir,
      ref: 'master',
    })
    const desiredOid = await resolveRef({
      fs,
      gitdir,
      ref: 'newest',
    })
    const m = await merge({
      fs,
      gitdir,
      ours: 'master',
      theirs: 'newest',
      fastForwardOnly: true,
      dryRun: true,
    })
    expect(m.oid).toEqual(desiredOid)
    expect(m.alreadyMerged).toBeFalsy()
    expect(m.fastForward).toBeTruthy()
    const oid = await resolveRef({
      fs,
      gitdir,
      ref: 'master',
    })
    expect(oid).toEqual(originalOid)
  })

  it('merge newest into master --noUpdateBranch', async () => {
    // Setup
    const { fs, gitdir } = await makeFixture('test-merge')
    // Test
    const originalOid = await resolveRef({
      fs,
      gitdir,
      ref: 'master',
    })
    const desiredOid = await resolveRef({
      fs,
      gitdir,
      ref: 'newest',
    })
    const m = await merge({
      fs,
      gitdir,
      ours: 'master',
      theirs: 'newest',
      fastForwardOnly: true,
      dryRun: true,
    })
    expect(m.oid).toEqual(desiredOid)
    expect(m.alreadyMerged).toBeFalsy()
    expect(m.fastForward).toBeTruthy()
    const oid = await resolveRef({
      fs,
      gitdir,
      ref: 'master',
    })
    expect(oid).toEqual(originalOid)
  })

  it("merge 'add-files' and 'remove-files'", async () => {
    // Setup
    const { fs, gitdir } = await makeFixture('test-merge')
    const commit = (
      await log({
        fs,
        gitdir,
        depth: 1,
        ref: 'add-files-merge-remove-files',
      })
    )[0].commit
    // Test
    const report = await merge({
      fs,
      gitdir,
      ours: 'add-files',
      theirs: 'remove-files',
      author: {
        name: 'Mr. Test',
        email: 'mrtest@example.com',
        timestamp: 1262356920,
        timezoneOffset: -0,
      },
    })
    const mergeCommit = (
      await log({
        fs,
        gitdir,
        ref: 'add-files',
        depth: 1,
      })
    )[0].commit
    expect(report.tree).toBe(commit.tree)
    expect(mergeCommit.tree).toEqual(commit.tree)
    expect(mergeCommit.message).toEqual(commit.message)
    expect(mergeCommit.parent).toEqual(commit.parent)
  })

  it("merge 'remove-files' and 'add-files'", async () => {
    // Setup
    const { fs, gitdir } = await makeFixture('test-merge')
    const commit = (
      await log({
        fs,
        gitdir,
        depth: 1,
        ref: 'remove-files-merge-add-files',
      })
    )[0].commit
    // TestTest
    const report = await merge({
      fs,
      gitdir,
      ours: 'remove-files',
      theirs: 'add-files',
      author: {
        name: 'Mr. Test',
        email: 'mrtest@example.com',
        timestamp: 1262356920,
        timezoneOffset: -0,
      },
    })
    const mergeCommit = (
      await log({
        fs,
        gitdir,
        ref: 'remove-files',
        depth: 1,
      })
    )[0].commit
    expect(report.tree).toBe(commit.tree)
    expect(mergeCommit.tree).toEqual(commit.tree)
    expect(mergeCommit.message).toEqual(commit.message)
    expect(mergeCommit.parent).toEqual(commit.parent)
  })

  it("merge 'delete-first-half' and 'delete-second-half' (dryRun, missing author)", async () => {
    // Setup
    const { fs, gitdir } = await makeFixture('test-merge')
    // Test
    let error = null
    try {
      await merge({
        fs,
        gitdir,
        ours: 'delete-first-half',
        theirs: 'delete-second-half',
        dryRun: true,
      })
    } catch (e) {
      error = e
    }
    expect(error).not.toBe(null)
    expect(error.code).toBe(Errors.MissingNameError.code)
  })

  it("merge 'delete-first-half' and 'delete-second-half' (dryRun)", async () => {
    // Setup
    const { fs, gitdir } = await makeFixture('test-merge')
    const commit = (
      await log({
        fs,
        gitdir,
        depth: 1,
        ref: 'delete-first-half-merge-delete-second-half',
      })
    )[0]
    const originalCommit = (
      await log({
        fs,
        gitdir,
        ref: 'delete-first-half',
        depth: 1,
      })
    )[0]
    // Test
    const report = await merge({
      fs,
      gitdir,
      ours: 'delete-first-half',
      theirs: 'delete-second-half',
      author: {
        name: 'Mr. Test',
        email: 'mrtest@example.com',
        timestamp: 1262356920,
        timezoneOffset: -0,
      },
      dryRun: true,
    })
    expect(report.tree).toBe(commit.commit.tree)
    // make sure branch hasn't been moved
    const notMergeCommit = (
      await log({
        fs,
        gitdir,
        ref: 'delete-first-half',
        depth: 1,
      })
    )[0]
    expect(notMergeCommit.oid).toEqual(originalCommit.oid)
    if (!report.oid) throw new Error('type error')
    // make sure no commit object was created
    expect(
      await fs.exists(
        `${gitdir}/objects/${report.oid.slice(0, 2)}/${report.oid.slice(2)}`
      )
    ).toBe(false)
  })

  it("merge 'delete-first-half' and 'delete-second-half' (noUpdateBranch)", async () => {
    // Setup
    const { fs, gitdir } = await makeFixture('test-merge')
    const commit = (
      await log({
        fs,
        gitdir,
        depth: 1,
        ref: 'delete-first-half-merge-delete-second-half',
      })
    )[0]
    const originalCommit = (
      await log({
        fs,
        gitdir,
        ref: 'delete-first-half',
        depth: 1,
      })
    )[0]
    // Test
    const report = await merge({
      fs,
      gitdir,
      ours: 'delete-first-half',
      theirs: 'delete-second-half',
      author: {
        name: 'Mr. Test',
        email: 'mrtest@example.com',
        timestamp: 1262356920,
        timezoneOffset: -0,
      },
      noUpdateBranch: true,
    })
    expect(report.tree).toBe(commit.commit.tree)
    // make sure branch hasn't been moved
    const notMergeCommit = (
      await log({
        fs,
        gitdir,
        ref: 'delete-first-half',
        depth: 1,
      })
    )[0]
    expect(notMergeCommit.oid).toEqual(originalCommit.oid)
    if (!report.oid) throw new Error('type error')
    // but make sure the commit object exists
    expect(
      await fs.exists(
        `${gitdir}/objects/${report.oid.slice(0, 2)}/${report.oid.slice(2)}`
      )
    ).toBe(true)
  })

  it("merge 'delete-first-half' and 'delete-second-half'", async () => {
    // Setup
    const { fs, gitdir } = await makeFixture('test-merge')
    const commit = (
      await log({
        fs,
        gitdir,
        depth: 1,
        ref: 'delete-first-half-merge-delete-second-half',
      })
    )[0].commit
    // Test
    const report = await merge({
      fs,
      gitdir,
      ours: 'delete-first-half',
      theirs: 'delete-second-half',
      author: {
        name: 'Mr. Test',
        email: 'mrtest@example.com',
        timestamp: 1262356920,
        timezoneOffset: -0,
      },
    })
    const mergeCommit = (
      await log({
        fs,
        gitdir,
        ref: 'delete-first-half',
        depth: 1,
      })
    )[0].commit
    expect(report.tree).toBe(commit.tree)
    expect(mergeCommit.tree).toEqual(commit.tree)
    expect(mergeCommit.message).toEqual(commit.message)
    expect(mergeCommit.parent).toEqual(commit.parent)
  })

  it("merge 'a-file' and 'a-folder'", async () => {
    // Setup
    const { fs, gitdir } = await makeFixture('test-merge')
    // Test
    let error = null
    try {
      await merge({
        fs,
        gitdir,
        ours: 'a-file',
        theirs: 'a-folder',
        author: {
          name: 'Mr. Test',
          email: 'mrtest@example.com',
          timestamp: 1262356920,
          timezoneOffset: -0,
        },
      })
    } catch (e) {
      error = e
    }
    expect(error).not.toBeNull()
    expect(error.code).toBe(Errors.MergeNotSupportedError.code)
  })

  it("merge 'g' and 'g-delete-file' (delete by theirs)", async () => {
    // Setup
    const { fs, gitdir } = await makeFixture('test-merge')
    // Test
    let error = null
    try {
      await merge({
        fs,
        gitdir,
        ours: 'g',
        theirs: 'g-delete-file',
        author: {
          name: 'Mr. Test',
          email: 'mrtest@example.com',
          timestamp: 1262356920,
          timezoneOffset: -0,
        },
      })
    } catch (e) {
      error = e
    }
    expect(error).not.toBeNull()
    expect(error.code).toBe(Errors.MergeConflictError.code)
  })

  it("merge 'g-delete-file' and 'g' (delete by us)", async () => {
    // Setup
    const { fs, gitdir } = await makeFixture('test-merge')
    // Test
    let error = null
    try {
      await merge({
        fs,
        gitdir,
        ours: 'g-delete-file',
        theirs: 'g',
        author: {
          name: 'Mr. Test',
          email: 'mrtest@example.com',
          timestamp: 1262356920,
          timezoneOffset: -0,
        },
      })
    } catch (e) {
      error = e
    }
    expect(error).not.toBeNull()
    expect(error.code).toBe(Errors.MergeConflictError.code)
  })

  it("merge 'i' and 'i-delete-both' (delete by both)", async () => {
    // Setup
    const { fs, gitdir, dir } = await makeFixture('test-merge')
    const deletedFile = `${dir}/o.txt`
    // Test
    const mergeResult = await merge({
      fs,
      gitdir,
      ours: 'i',
      theirs: 'i-delete-both',
      author: {
        name: 'Mr. Test',
        email: 'mrtest@example.com',
        timestamp: 1262356920,
        timezoneOffset: -0,
      },
    })
    expect(mergeResult).toBeTruthy()
    expect(await fs.exists(deletedFile)).toBeFalsy()
  })

  it("merge two branches that modified the same file (no conflict)'", async () => {
    // Setup
    const { fs, gitdir } = await makeFixture('test-merge')
    const commit = (
      await log({
        fs,
        gitdir,
        depth: 1,
        ref: 'a-merge-b',
      })
    )[0].commit
    // Test
    const report = await merge({
      fs,
      gitdir,
      ours: 'a',
      theirs: 'b',
      author: {
        name: 'Mr. Test',
        email: 'mrtest@example.com',
        timestamp: 1262356920,
        timezoneOffset: -0,
      },
    })
    const mergeCommit = (
      await log({
        fs,
        gitdir,
        ref: 'a',
        depth: 1,
      })
    )[0].commit
    expect(report.tree).toBe(commit.tree)
    expect(mergeCommit.tree).toEqual(commit.tree)
    expect(mergeCommit.message).toEqual(commit.message)
    expect(mergeCommit.parent).toEqual(commit.parent)
  })

  it("merge two branches where one modified file and the other modified file mode'", async () => {
    // Setup
    const { fs, gitdir } = await makeFixture('test-merge')
    const commit = (
      await log({
        fs,
        gitdir,
        depth: 1,
        ref: 'a-merge-d',
      })
    )[0].commit
    // Test
    const report = await merge({
      fs,
      gitdir,
      ours: 'a',
      theirs: 'd',
      author: {
        name: 'Mr. Test',
        email: 'mrtest@example.com',
        timestamp: 1262356920,
        timezoneOffset: -0,
      },
    })
    const mergeCommit = (
      await log({
        fs,
        gitdir,
        ref: 'a',
        depth: 1,
      })
    )[0].commit
    expect(report.tree).toBe(commit.tree)
    expect(mergeCommit.tree).toEqual(commit.tree)
    expect(mergeCommit.message).toEqual(commit.message)
    expect(mergeCommit.parent).toEqual(commit.parent)
  })

  it("merge two branches that modified the same file, no conflict resolver (should conflict)'", async () => {
    // Setup
    const { fs, gitdir, dir } = await makeFixture('test-merge')
    // Test
    const testFile = `${gitdir}/o.conflict.example`
    const outFile = `${dir}/o.txt`
    const cache = {}

    let error = null
    try {
      await merge({
        fs,
        dir,
        gitdir,
        ours: 'a',
        theirs: 'c',
        abortOnConflict: false,
        author: {
          name: 'Mr. Test',
          email: 'mrtest@example.com',
          timestamp: 1262356920,
          timezoneOffset: -0,
        },
        cache,
      })
    } catch (e) {
      error = e
    }

    expect(await fs.read(outFile, 'utf-8')).toBe(
      await fs.read(testFile, 'utf-8')
    )
    expect(error).not.toBeNull()
    expect(error.code).toBe(Errors.MergeConflictError.code)
  })

  it("merge two branches that modified the same file, no conflict resolver, don't update worktree'", async () => {
    // Setup
    const { fs, gitdir, dir } = await makeFixture('test-merge')
    // Test
    const outFile = `${dir}/o.txt`

    let error = null
    try {
      await merge({
        fs,
        dir,
        gitdir,
        ours: 'a',
        theirs: 'c',
        abortOnConflict: true,
        author: {
          name: 'Mr. Test',
          email: 'mrtest@example.com',
          timestamp: 1262356920,
          timezoneOffset: -0,
        },
      })
    } catch (e) {
      error = e
    }
    expect(await fs.read(outFile, 'utf-8')).toBeNull()
    expect(await fs.readdir(dir)).toEqual([])
    expect(error).not.toBeNull()
    expect(error.code).toBe(Errors.MergeConflictError.code)
  })

  it("merge two branches that modified the same file, custom conflict resolver (prefer our changes)'", async () => {
    // Setup
    const { fs, gitdir } = await makeFixture('test-merge')

    const commit = (
      await log({
        fs,
        gitdir,
        depth: 1,
        ref: 'a-merge-c-recursive-ours',
      })
    )[0].commit
    // Test
    const report = await merge({
      fs,
      gitdir,
      ours: 'a',
      theirs: 'c',
      author: {
        name: 'Mr. Test',
        email: 'mrtest@example.com',
        timestamp: 1262356920,
        timezoneOffset: -0,
      },
      mergeDriver: ({ branches, contents }) => {
        const baseContent = contents[0]
        const ourContent = contents[1]
        const theirContent = contents[2]

        const LINEBREAKS = /^.*(\r?\n|$)/gm
        const ours = ourContent.match(LINEBREAKS)
        const base = baseContent.match(LINEBREAKS)
        const theirs = theirContent.match(LINEBREAKS)
        const result = diff3Merge(ours, base, theirs)
        let mergedText = ''
        for (const item of result) {
          if (item.ok) {
            mergedText += item.ok.join('')
          }
          if (item.conflict) {
            mergedText += item.conflict.a.join('')
          }
        }
        return { cleanMerge: true, mergedText }
      },
    })
    const mergeCommit = (
      await log({
        fs,
        gitdir,
        ref: 'a',
        depth: 1,
      })
    )[0].commit
    expect(report.tree).toBe(commit.tree)
    expect(mergeCommit.tree).toEqual(commit.tree)
    expect(mergeCommit.message).toEqual(commit.message)
    expect(mergeCommit.parent).toEqual(commit.parent)
  })
  it("merge two branches that modified the same file, custom conflict resolver (prefer their changes)'", async () => {
    // Setup
    const { fs, gitdir } = await makeFixture('test-merge')

    const commit = (
      await log({
        fs,
        gitdir,
        depth: 1,
        ref: 'a-merge-c-recursive-theirs',
      })
    )[0].commit
    // Test
    const report = await merge({
      fs,
      gitdir,
      ours: 'a',
      theirs: 'c',
      author: {
        name: 'Mr. Test',
        email: 'mrtest@example.com',
        timestamp: 1262356920,
        timezoneOffset: -0,
      },
      mergeDriver: ({ branches, contents }) => {
        const baseContent = contents[0]
        const ourContent = contents[1]
        const theirContent = contents[2]

        const LINEBREAKS = /^.*(\r?\n|$)/gm
        const ours = ourContent.match(LINEBREAKS)
        const base = baseContent.match(LINEBREAKS)
        const theirs = theirContent.match(LINEBREAKS)
        const result = diff3Merge(ours, base, theirs)
        let mergedText = ''
        for (const item of result) {
          if (item.ok) {
            mergedText += item.ok.join('')
          }
          if (item.conflict) {
            mergedText += item.conflict.b.join('')
          }
        }
        return { cleanMerge: true, mergedText }
      },
    })
    const mergeCommit = (
      await log({
        fs,
        gitdir,
        ref: 'a',
        depth: 1,
      })
    )[0].commit
    expect(report.tree).toBe(commit.tree)
    expect(mergeCommit.tree).toEqual(commit.tree)
    expect(mergeCommit.message).toEqual(commit.message)
    expect(mergeCommit.parent).toEqual(commit.parent)
  })
  it("merge two branches that modified the same file, custom conflict resolver (prefer our file)'", async () => {
    // Setup
    const { fs, gitdir } = await makeFixture('test-merge')

    const commit = (
      await log({
        fs,
        gitdir,
        depth: 1,
        ref: 'a-merge-c-use-ours',
      })
    )[0].commit
    // Test
    const report = await merge({
      fs,
      gitdir,
      ours: 'a',
      theirs: 'c',
      author: {
        name: 'Mr. Test',
        email: 'mrtest@example.com',
        timestamp: 1262356920,
        timezoneOffset: -0,
      },
      mergeDriver: ({ branches, contents }) => {
        const mergedText = contents[1]
        return { cleanMerge: true, mergedText }
      },
    })
    const mergeCommit = (
      await log({
        fs,
        gitdir,
        ref: 'a',
        depth: 1,
      })
    )[0].commit
    expect(report.tree).toBe(commit.tree)
    expect(mergeCommit.tree).toEqual(commit.tree)
    expect(mergeCommit.message).toEqual(commit.message)
    expect(mergeCommit.parent).toEqual(commit.parent)
  })
  it("merge two branches that modified the same file, custom conflict resolver (prefer their file)'", async () => {
    // Setup
    const { fs, gitdir } = await makeFixture('test-merge')

    const commit = (
      await log({
        fs,
        gitdir,
        depth: 1,
        ref: 'a-merge-c-use-theirs',
      })
    )[0].commit
    // Test
    const report = await merge({
      fs,
      gitdir,
      ours: 'a',
      theirs: 'c',
      author: {
        name: 'Mr. Test',
        email: 'mrtest@example.com',
        timestamp: 1262356920,
        timezoneOffset: -0,
      },
      mergeDriver: ({ branches, contents }) => {
        const mergedText = contents[2]
        return { cleanMerge: true, mergedText }
      },
    })
    const mergeCommit = (
      await log({
        fs,
        gitdir,
        ref: 'a',
        depth: 1,
      })
    )[0].commit
    expect(report.tree).toBe(commit.tree)
    expect(mergeCommit.tree).toEqual(commit.tree)
    expect(mergeCommit.message).toEqual(commit.message)
    expect(mergeCommit.parent).toEqual(commit.parent)
  })
  it("merge two branches that modified the same file, custom conflict resolver (prefer base file)'", async () => {
    // Setup
    const { fs, gitdir } = await makeFixture('test-merge')

    const commit = (
      await log({
        fs,
        gitdir,
        depth: 1,
        ref: 'a-merge-c-use-base',
      })
    )[0].commit
    // Test
    const report = await merge({
      fs,
      gitdir,
      ours: 'a',
      theirs: 'c',
      author: {
        name: 'Mr. Test',
        email: 'mrtest@example.com',
        timestamp: 1262356920,
        timezoneOffset: -0,
      },
      mergeDriver: ({ branches, contents }) => {
        const baseContent = contents[0]
        const ourContent = contents[1]
        const theirContent = contents[2]
        const mergedText = baseContent || ourContent || theirContent
        return { cleanMerge: true, mergedText }
      },
    })
    const mergeCommit = (
      await log({
        fs,
        gitdir,
        ref: 'a',
        depth: 1,
      })
    )[0].commit
    expect(report.tree).toBe(commit.tree)
    expect(mergeCommit.tree).toEqual(commit.tree)
    expect(mergeCommit.message).toEqual(commit.message)
    expect(mergeCommit.parent).toEqual(commit.parent)
  })
  it("merge two branches that modified the same file, manual conflict resolution'", async () => {
    // Setup
    const { fs, gitdir, dir } = await makeFixture('test-merge')

    const commit = (
      await log({
        fs,
        gitdir,
        depth: 1,
        ref: 'a-merge-c-manual-resolve',
      })
    )[0].commit
    // Test
    await merge({
      fs,
      dir,
      gitdir,
      ours: 'a',
      theirs: 'c',
      author: {
        name: 'Mr. Test',
        email: 'mrtest@example.com',
        timestamp: 1262356920,
        timezoneOffset: -0,
      },
      abortOnConflict: false,
    }).catch(e => {
      if (!(e instanceof Errors.MergeConflictError)) throw e
    })
    await add({
      fs,
      dir,
      gitdir,
      filepath: '.',
    })
    await gitCommit({
      fs,
      gitdir,
      author: {
        name: 'Mr. Test',
        email: 'mrtest@example.com',
        timestamp: 1262356920,
        timezoneOffset: -0,
      },
      ref: 'a',
      message: "Merge branch 'c' into a",
      parent: ['a', 'c'],
    })
    const mergeCommit = (
      await log({
        fs,
        gitdir,
        ref: 'a',
        depth: 1,
      })
    )[0].commit

    expect(mergeCommit.tree).toEqual(commit.tree)
    expect(mergeCommit.message).toEqual(commit.message)
    expect(mergeCommit.parent).toEqual(commit.parent)
  })
  it('merge two branches where ours adds a new file and theirs deletes a file', async () => {
    // Setup
    const { fs, gitdir } = await makeFixture('test-merge-file-deletion')

    const commit = (
      await log({
        fs,
        gitdir,
        depth: 1,
        ref: 'a-merge-b-reference',
      })
    )[0].commit
    // Test
    const report = await merge({
      fs,
      gitdir,
      ours: 'a',
      theirs: 'b',
      author: {
        name: 'Mr. Test',
        email: 'mrtest@example.com',
        timestamp: 1262356920,
        timezoneOffset: -0,
      },
    })
    const mergeCommit = (
      await log({
        fs,
        gitdir,
        ref: 'a',
        depth: 1,
      })
    )[0].commit

    expect(report.tree).toBe(commit.tree)
    expect(mergeCommit.tree).toEqual(commit.tree)
    expect(mergeCommit.message).toEqual(commit.message)
    expect(mergeCommit.parent).toEqual(commit.parent)
  })
  it('merge two branches where ours deletes a file and theirs adds a new file', async () => {
    // Setup
    const { fs, gitdir } = await makeFixture('test-merge-file-deletion')

    const commit = (
      await log({
        fs,
        gitdir,
        depth: 1,
        ref: 'c-merge-d-reference',
      })
    )[0].commit
    // Test
    const report = await merge({
      fs,
      gitdir,
      ours: 'c',
      theirs: 'd',
      author: {
        name: 'Mr. Test',
        email: 'mrtest@example.com',
        timestamp: 1262356920,
        timezoneOffset: -0,
      },
    })
    const mergeCommit = (
      await log({
        fs,
        gitdir,
        ref: 'c',
        depth: 1,
      })
    )[0].commit

    expect(report.tree).toBe(commit.tree)
    expect(mergeCommit.tree).toEqual(commit.tree)
    expect(mergeCommit.message).toEqual(commit.message)
    expect(mergeCommit.parent).toEqual(commit.parent)
  })
  it('merge preserves nested directory structure when combining unrelated changes', async () => {
    // Setup
    const { fs, gitdir } = await makeFixture('test-merge-file-deletion')

    const commit = (
      await log({
        fs,
        gitdir,
        depth: 1,
        ref: 'e-merge-f-reference',
      })
    )[0].commit
    // Test
    const report = await merge({
      fs,
      gitdir,
      ours: 'e',
      theirs: 'f',
      author: {
        name: 'Mr. Test',
        email: 'mrtest@example.com',
        timestamp: 1262356920,
        timezoneOffset: -0,
      },
    })
    const mergeCommit = (
      await log({
        fs,
        gitdir,
        ref: 'e',
        depth: 1,
      })
    )[0].commit

    expect(report.tree).toBe(commit.tree)
    expect(mergeCommit.tree).toEqual(commit.tree)
    expect(mergeCommit.message).toEqual(commit.message)
    expect(mergeCommit.parent).toEqual(commit.parent)
  })
  it('merge two branches where both ours and theirs delete the same file', async () => {
    // Setup
    const { fs, gitdir } = await makeFixture('test-merge-file-deletion')

    const commit = (
      await log({
        fs,
        gitdir,
        depth: 1,
        ref: 'g-merge-h-reference',
      })
    )[0].commit
    // Test
    const report = await merge({
      fs,
      gitdir,
      ours: 'g',
      theirs: 'h',
      author: {
        name: 'Mr. Test',
        email: 'mrtest@example.com',
        timestamp: 1262356920,
        timezoneOffset: -0,
      },
    })
    const mergeCommit = (
      await log({
        fs,
        gitdir,
        ref: 'g',
        depth: 1,
      })
    )[0].commit

    expect(report.tree).toBe(commit.tree)
    expect(mergeCommit.tree).toEqual(commit.tree)
    expect(mergeCommit.message).toEqual(commit.message)
    expect(mergeCommit.parent).toEqual(commit.parent)
  })
  it('merge two branches with unrelated histories where they add 2 files having different name', async () => {
    const { fs, dir, gitdir } = await makeFixture('test-empty')

    const author = {
      name: 'Mr. Test',
      email: 'mrtest@example.com',
      timestamp: 1262356920,
      timezoneOffset: -0,
    }

    // First root commit on 'master'
    await fs.write(`${dir}/a.txt`, 'hello a')
    await add({ fs, dir, gitdir, filepath: 'a.txt' })
    await gitCommit({
      fs,
      dir,
      gitdir,
      ref: 'master',
      message: 'Add a.txt',
      author,
    })

    // Second root commit on unrelated branch 'other'
    await fs.write(`${dir}/b.txt`, 'hello b')
    await add({ fs, dir, gitdir, filepath: 'b.txt' })
    await gitCommit({
      fs,
      dir,
      gitdir,
      ref: 'other',
      message: 'Add b.txt',
      author,
    })

    const report = await merge({
      fs,
      gitdir,
      ours: 'master',
      theirs: 'other',
      abortOnConflict: false,
      allowUnrelatedHistories: true,
      author,
    })

    expect(report).toBeTruthy()
    expect(report.mergeCommit).toBeTruthy()
    const mergeHead = (await log({ fs, gitdir, ref: 'master', depth: 1 }))[0]
      .commit
    expect(mergeHead.parent.length).toBe(2)

    const matrix = await statusMatrix({ fs, dir, gitdir })
    const trackedFiles = matrix.map(row => row[0])
    expect(trackedFiles.join()).toEqual(['a.txt', 'b.txt'].join())

    const history = await log({ fs, gitdir, ref: 'master', depth: 3 })
    const messages = history.map(entry =>
      entry.commit.message.replace('\n', '')
    )
    expect(messages.join()).toEqual(
      [`Merge branch 'other'`, 'Add b.txt', 'Add a.txt'].join()
    )
  })

  it('merge two branches with unrelated histories where they add 2 files having same name', async () => {
    const { fs, dir, gitdir } = await makeFixture('test-empty')
    const author = {
      name: 'Mr. Test',
      email: 'mrtest@example.com',
      timestamp: 1262356920,
      timezoneOffset: -0,
    }

    // First root commit on master adding same.txt
    await fs.write(`${dir}/same.txt`, 'content from master')
    await add({ fs, dir, gitdir, filepath: 'same.txt' })
    await gitCommit({
      fs,
      dir,
      gitdir,
      ref: 'master',
      message: 'Add same.txt on master',
      author,
    })

    // Second unrelated root commit on branch 'other' adding same.txt with different content
    await fs.write(`${dir}/same.txt`, 'content from other')
    await add({ fs, dir, gitdir, filepath: 'same.txt' })
    await gitCommit({
      fs,
      dir,
      gitdir,
      ref: 'other',
      parent: [],
      message: 'Add same.txt on other',
      author,
    })

    // Back on master's version before merging, as a user would be.
    await checkout({ fs, dir, gitdir, ref: 'master', force: true })

    let error = null
    try {
      await merge({
        fs,
        dir,
        gitdir,
        ours: 'master',
        theirs: 'other',
        abortOnConflict: false,
        allowUnrelatedHistories: true,
        author,
      })
    } catch (e) {
      error = e
    }
    expect(error).not.toBeNull()
    expect(error.code).toBe(Errors.MergeConflictError.code)
    const resultText = await fs.read(`${dir}/same.txt`, 'utf8')
    expect(resultText).toContain('<<<<<<<')

    const matrix = await statusMatrix({ fs, dir, gitdir })
    const trackedFiles = matrix.map(row => row[0])
    expect(trackedFiles.join()).toEqual(['same.txt'].join())

    const history = await log({ fs, gitdir, ref: 'master', depth: 3 })
    const messages = history.map(entry =>
      entry.commit.message.replace('\n', '')
    )
    expect(messages.join()).toEqual(['Add same.txt on master'].join())
  })

  it('merge two branches with unrelated histories where they add files in nested directories', async () => {
    const { fs, dir, gitdir } = await makeFixture('test-empty')

    const author = {
      name: 'Mr. Test',
      email: 'mrtest@example.com',
      timestamp: 1262356920,
      timezoneOffset: -0,
    }

    // First root commit on 'master' with nested directory
    await fs.mkdir(`${dir}/dir1`)
    await fs.mkdir(`${dir}/dir1/subdir1`)
    await fs.write(`${dir}/dir1/subdir1/file1.txt`, 'content from master')
    await add({ fs, dir, gitdir, filepath: 'dir1/subdir1/file1.txt' })
    await gitCommit({
      fs,
      dir,
      gitdir,
      ref: 'master',
      message: 'Add file in nested directory on master',
      author,
    })

    // Second root commit on unrelated branch 'other' with different nested directory
    await fs.mkdir(`${dir}/dir2`)
    await fs.mkdir(`${dir}/dir2/subdir2`)
    await fs.write(`${dir}/dir2/subdir2/file2.txt`, 'content from other')
    await add({ fs, dir, gitdir, filepath: 'dir2/subdir2/file2.txt' })
    await gitCommit({
      fs,
      dir,
      gitdir,
      ref: 'other',
      message: 'Add file in different nested directory on other',
      author,
    })

    const report = await merge({
      fs,
      gitdir,
      ours: 'master',
      theirs: 'other',
      abortOnConflict: false,
      allowUnrelatedHistories: true,
      author,
    })

    expect(report).toBeTruthy()
    expect(report.mergeCommit).toBeTruthy()
    const mergeHead = (await log({ fs, gitdir, ref: 'master', depth: 1 }))[0]
      .commit
    expect(mergeHead.parent.length).toBe(2)

    const matrix = await statusMatrix({ fs, dir, gitdir })
    const trackedFiles = matrix.map(row => row[0])
    expect(trackedFiles.join()).toEqual(
      ['dir1/subdir1/file1.txt', 'dir2/subdir2/file2.txt'].join()
    )

    const history = await log({ fs, gitdir, ref: 'master', depth: 3 })
    const messages = history.map(entry =>
      entry.commit.message.replace('\n', '')
    )
    expect(messages.join()).toEqual(
      [
        `Merge branch 'other'`,
        'Add file in different nested directory on other',
        'Add file in nested directory on master',
      ].join()
    )
  })

  it('merge two branches with unrelated histories where they add files with same path in nested directories', async () => {
    const { fs, dir, gitdir } = await makeFixture('test-empty')
    const author = {
      name: 'Mr. Test',
      email: 'mrtest@example.com',
      timestamp: 1262356920,
      timezoneOffset: -0,
    }

    // First root commit on master adding nested file
    await fs.mkdir(`${dir}/shared`)
    await fs.mkdir(`${dir}/shared/path`)
    await fs.write(`${dir}/shared/path/conflict.txt`, 'content from master')
    await add({ fs, dir, gitdir, filepath: 'shared/path/conflict.txt' })
    await gitCommit({
      fs,
      dir,
      gitdir,
      ref: 'master',
      message: 'Add nested file on master',
      author,
    })

    // Second unrelated root commit on branch 'other' adding same nested file with different content
    await fs.mkdir(`${dir}/shared`)
    await fs.mkdir(`${dir}/shared/path`)
    await fs.write(`${dir}/shared/path/conflict.txt`, 'content from other')
    await add({ fs, dir, gitdir, filepath: 'shared/path/conflict.txt' })
    await gitCommit({
      fs,
      dir,
      gitdir,
      ref: 'other',
      parent: [],
      message: 'Add nested file on other',
      author,
    })

    // Back on master's version before merging, as a user would be.
    await checkout({ fs, dir, gitdir, ref: 'master', force: true })

    let error = null
    try {
      await merge({
        fs,
        dir,
        gitdir,
        ours: 'master',
        theirs: 'other',
        abortOnConflict: false,
        allowUnrelatedHistories: true,
        author,
      })
    } catch (e) {
      error = e
    }
    expect(error).not.toBeNull()
    expect(error.code).toBe(Errors.MergeConflictError.code)
    const resultText = await fs.read(`${dir}/shared/path/conflict.txt`, 'utf8')
    expect(resultText).toContain('<<<<<<<')

    const matrix = await statusMatrix({ fs, dir, gitdir })
    const trackedFiles = matrix.map(row => row[0])
    expect(trackedFiles.join()).toEqual(['shared/path/conflict.txt'].join())

    const history = await log({ fs, gitdir, ref: 'master', depth: 3 })
    const messages = history.map(entry =>
      entry.commit.message.replace('\n', '')
    )
    expect(messages.join()).toEqual(['Add nested file on master'].join())
  })

  it('merge conflict does not corrupt binary files in the working directory', async () => {
    const { fs, dir, gitdir } = await makeFixture('test-empty')
    const author = {
      name: 'Mr. Test',
      email: 'mrtest@example.com',
      timestamp: 1262356920,
      timezoneOffset: -0,
    }

    // Every possible byte value, so the file is not valid UTF-8 text. It only
    // survives if working directory contents are written verbatim.
    const binary = Uint8Array.from({ length: 256 }, (_, i) => i)

    // Multibyte UTF-8, to catch a text file being re-encoded rather than copied.
    const unicodeText = 'Ünicode: αβγδ 日本語 🎉\n'

    // Base commit: the file that will conflict, plus a text file and a binary
    // file that neither branch touches.
    await fs.write(`${dir}/doc.txt`, 'base content\n')
    await fs.write(`${dir}/notes.md`, unicodeText)
    await fs.write(`${dir}/image.bin`, binary)
    await add({ fs, dir, gitdir, filepath: 'doc.txt' })
    await add({ fs, dir, gitdir, filepath: 'notes.md' })
    await add({ fs, dir, gitdir, filepath: 'image.bin' })
    const base = await gitCommit({
      fs,
      dir,
      gitdir,
      ref: 'master',
      message: 'Add a text file and a binary file',
      author,
    })

    // master edits only the text file.
    await fs.write(`${dir}/doc.txt`, 'master content\n')
    await add({ fs, dir, gitdir, filepath: 'doc.txt' })
    await gitCommit({
      fs,
      dir,
      gitdir,
      ref: 'master',
      message: 'Edit the text file on master',
      author,
    })

    // other edits only the text file, from the same base, so the two conflict.
    await fs.write(`${dir}/doc.txt`, 'other content\n')
    await add({ fs, dir, gitdir, filepath: 'doc.txt' })
    await gitCommit({
      fs,
      dir,
      gitdir,
      ref: 'other',
      parent: [base],
      message: 'Edit the text file on other',
      author,
    })

    // Back on master's version before merging, as a user would be.
    await checkout({ fs, dir, gitdir, ref: 'master', force: true })

    let error = null
    try {
      await merge({
        fs,
        dir,
        gitdir,
        ours: 'master',
        theirs: 'other',
        abortOnConflict: false,
        author,
      })
    } catch (e) {
      error = e
    }

    expect(error).not.toBeNull()
    expect(error.code).toBe(Errors.MergeConflictError.code)

    // The conflict is in doc.txt. Both image.bin and notes.md are identical on
    // both branches and are not part of the merge, so they must survive
    // untouched even though the conflicted merge rewrites the whole tree.
    const binaryAfterMerge = await fs.read(`${dir}/image.bin`)
    expect(Array.from(binaryAfterMerge)).toEqual(Array.from(binary))

    expect(await fs.read(`${dir}/notes.md`, 'utf8')).toBe(unicodeText)

    // The text conflict still materialises in the working directory.
    expect(await fs.read(`${dir}/doc.txt`, 'utf8')).toContain('<<<<<<<')
  })

  describe('ORIG_HEAD', () => {
    const author = {
      name: 'Mr. Test',
      email: 'mrtest@example.com',
      timestamp: 1262356920,
      timezoneOffset: -0,
    }

    it('remembers where the branch was when a merge moves it, like git', async () => {
      for (const kind of ['fast-forward', 'merge commit']) {
        const { fs, dir, gitdir } = await makeFixture(
          `tmp-merge-orig-head-${kind.replace(' ', '-')}`
        )
        await init({ fs, dir, gitdir })
        await fs.write(`${dir}/a.txt`, 'a\n')
        await add({ fs, dir, gitdir, filepath: 'a.txt' })
        const base = await gitCommit({
          fs,
          dir,
          gitdir,
          message: 'base',
          author,
        })
        await branch({ fs, dir, gitdir, ref: 'feature', checkout: true })
        await fs.write(`${dir}/b.txt`, 'b\n')
        await add({ fs, dir, gitdir, filepath: 'b.txt' })
        await gitCommit({ fs, dir, gitdir, message: 'feature', author })
        await checkout({ fs, dir, gitdir, ref: 'master' })
        let before = base
        if (kind === 'merge commit') {
          await fs.write(`${dir}/c.txt`, 'c\n')
          await add({ fs, dir, gitdir, filepath: 'c.txt' })
          before = await gitCommit({
            fs,
            dir,
            gitdir,
            message: 'master',
            author,
          })
        }

        await merge({ fs, dir, gitdir, theirs: 'feature', author })

        expect(await fs.read(`${gitdir}/ORIG_HEAD`, 'utf8')).toBe(`${before}\n`)
      }
    })
  })

  describe('conflicts written to the working tree', () => {
    const author = {
      name: 'Mr. Test',
      email: 'mrtest@example.com',
      timestamp: 1262356920,
      timezoneOffset: -0,
    }

    // base:    conflict.txt, theirs.txt, ours.txt, both.txt, gone.txt,
    //          same.txt, run.sh (executable), sub/nested.txt
    // feature: edits conflict.txt, theirs.txt, both.txt (end), run.sh and
    //          sub/nested.txt, deletes gone.txt, adds added.txt
    // master:  edits conflict.txt, ours.txt and both.txt (start)
    async function setup(name) {
      const { fs, dir, gitdir } = await makeFixture(name)
      await init({ fs, dir, gitdir })
      await fs.write(`${dir}/conflict.txt`, 'one\ntwo\nthree\n')
      await fs.write(`${dir}/theirs.txt`, 'base\n')
      await fs.write(`${dir}/ours.txt`, 'base\n')
      await fs.write(`${dir}/both.txt`, 'start\nmiddle\nend\n')
      await fs.write(`${dir}/gone.txt`, 'gone\n')
      await fs.write(`${dir}/same.txt`, 'same\n')
      await fs.write(`${dir}/run.sh`, '#!/bin/sh\n', { mode: 0o777 })
      await fs.write(`${dir}/sub/nested.txt`, 'base\n')
      await add({ fs, dir, gitdir, filepath: '.' })
      const baseOid = await gitCommit({
        fs,
        dir,
        gitdir,
        message: 'base',
        author,
      })

      await branch({ fs, dir, gitdir, ref: 'feature', checkout: true })
      await fs.write(`${dir}/conflict.txt`, 'one\nfeature\nthree\n')
      await fs.write(`${dir}/theirs.txt`, 'feature\n')
      await fs.write(`${dir}/both.txt`, 'start\nmiddle\nfeature end\n')
      await fs.write(`${dir}/run.sh`, '#!/bin/sh\necho feature\n')
      await fs.write(`${dir}/sub/nested.txt`, 'feature\n')
      await fs.write(`${dir}/added.txt`, 'added\n')
      await fs.rm(`${dir}/gone.txt`)
      await add({ fs, dir, gitdir, filepath: '.' })
      await remove({ fs, dir, gitdir, filepath: 'gone.txt' })
      const featureOid = await gitCommit({
        fs,
        dir,
        gitdir,
        message: 'feature',
        author,
      })

      await checkout({ fs, dir, gitdir, ref: 'master' })
      await fs.write(`${dir}/conflict.txt`, 'one\nmaster\nthree\n')
      await fs.write(`${dir}/ours.txt`, 'master\n')
      await fs.write(`${dir}/both.txt`, 'master start\nmiddle\nend\n')
      await add({ fs, dir, gitdir, filepath: '.' })
      const masterOid = await gitCommit({
        fs,
        dir,
        gitdir,
        message: 'master',
        author,
      })
      return { fs, dir, gitdir, baseOid, featureOid, masterOid }
    }

    async function mergeFeature(repo, options = {}) {
      const { fs, dir, gitdir } = repo
      let error = null
      try {
        await merge({
          fs,
          dir,
          gitdir,
          ours: 'master',
          theirs: 'feature',
          abortOnConflict: false,
          author,
          ...options,
        })
      } catch (e) {
        error = e
      }
      expect(error).not.toBeNull()
      return error
    }

    async function readIndex(repo) {
      const { fs, gitdir } = repo
      return GitIndexManager.acquire(
        { fs, gitdir, cache: {} },
        async index => ({
          unmergedPaths: index.unmergedPaths,
          entries: new Map(
            index.entriesFlat.map(e => [`${e.path}:${e.flags.stage}`, e])
          ),
        })
      )
    }

    it('leaves the working tree and index the way git does', async () => {
      const repo = await setup('tmp-merge-conflict-state')
      const { fs, dir, gitdir, baseOid, featureOid, masterOid } = repo

      const error = await mergeFeature(repo)
      expect(error.code).toBe(Errors.MergeConflictError.code)
      expect(error.data.filepaths).toEqual(['conflict.txt'])

      // Only the conflicted file is unmerged, with all three versions.
      const index = await readIndex(repo)
      expect(index.unmergedPaths).toEqual(['conflict.txt'])
      expect(await fs.read(`${dir}/conflict.txt`, 'utf8')).toBe(
        'one\n<<<<<<< HEAD\nmaster\n=======\nfeature\n>>>>>>> feature\nthree\n'
      )
      const stageOids = [1, 2, 3].map(
        stage => index.entries.get(`conflict.txt:${stage}`).oid
      )
      const blob = async (oid, filepath) =>
        (await readBlob({ fs, gitdir, oid, filepath })).oid
      expect(stageOids).toEqual([
        await blob(baseOid, 'conflict.txt'),
        await blob(masterOid, 'conflict.txt'),
        await blob(featureOid, 'conflict.txt'),
      ])

      // Everything else the merge changed is written and staged.
      expect(await fs.read(`${dir}/theirs.txt`, 'utf8')).toBe('feature\n')
      expect(await status({ fs, dir, gitdir, filepath: 'theirs.txt' })).toBe(
        'modified'
      )
      expect(await fs.read(`${dir}/both.txt`, 'utf8')).toBe(
        'master start\nmiddle\nfeature end\n'
      )
      expect(await status({ fs, dir, gitdir, filepath: 'both.txt' })).toBe(
        'modified'
      )
      expect(
        await status({ fs, dir, gitdir, filepath: 'sub/nested.txt' })
      ).toBe('modified')
      expect(await fs.read(`${dir}/added.txt`, 'utf8')).toBe('added\n')
      expect(await status({ fs, dir, gitdir, filepath: 'added.txt' })).toBe(
        'added'
      )
      expect(await fs.exists(`${dir}/gone.txt`)).toBe(false)
      expect(await status({ fs, dir, gitdir, filepath: 'gone.txt' })).toBe(
        'deleted'
      )
      expect(await status({ fs, dir, gitdir, filepath: 'ours.txt' })).toBe(
        'unmodified'
      )
      expect(await status({ fs, dir, gitdir, filepath: 'same.txt' })).toBe(
        'unmodified'
      )
      // The mode recorded for a rewritten file is the one from the tree.
      const { tree } = await readTree({ fs, gitdir, oid: featureOid })
      const treeModes = tree.map(entry => [entry.path, entry.mode])
      expect(treeModes).toContainEqual([
        'run.sh',
        index.entries.get('run.sh:0').mode.toString(8),
      ])

      // Resolving, adding and committing finishes the merge with their
      // changes included, exactly like `git commit` would.
      await fs.write(`${dir}/conflict.txt`, 'one\nresolved\nthree\n')
      await add({ fs, dir, gitdir, filepath: 'conflict.txt' })
      const mergeOid = await gitCommit({
        fs,
        dir,
        gitdir,
        message: 'merge',
        author,
        parent: [masterOid, featureOid],
      })
      const read = async filepath =>
        Buffer.from(
          (await readBlob({ fs, gitdir, oid: mergeOid, filepath })).blob
        ).toString('utf8')
      expect(await read('conflict.txt')).toBe('one\nresolved\nthree\n')
      expect(await read('theirs.txt')).toBe('feature\n')
      expect(await read('both.txt')).toBe('master start\nmiddle\nfeature end\n')
      expect(await read('added.txt')).toBe('added\n')
      expect(await read('ours.txt')).toBe('master\n')
      await expect(read('gone.txt')).rejects.toMatchObject({
        code: Errors.NotFoundError.code,
      })
      const matrix = await statusMatrix({ fs, dir, gitdir })
      expect(matrix.every(row => row.slice(1).join() === '1,1,1')).toBe(true)
    })

    it('keeps local changes in files the merge does not touch', async () => {
      const repo = await setup('tmp-merge-conflict-untouched')
      const { fs, dir, gitdir } = repo
      await fs.write(`${dir}/same.txt`, 'local\n')
      await fs.write(`${dir}/untracked.txt`, 'untracked\n')

      const error = await mergeFeature(repo)
      expect(error.code).toBe(Errors.MergeConflictError.code)

      expect(await fs.read(`${dir}/same.txt`, 'utf8')).toBe('local\n')
      expect(await status({ fs, dir, gitdir, filepath: 'same.txt' })).toBe(
        '*modified'
      )
      expect(await fs.read(`${dir}/untracked.txt`, 'utf8')).toBe('untracked\n')
      expect(await fs.read(`${dir}/conflict.txt`, 'utf8')).toContain('<<<<<<<')
    })

    describe('local changes', () => {
      async function expectRejected(repo, filepaths) {
        const { fs, dir, gitdir, masterOid } = repo
        const error = await mergeFeature(repo)
        expect(error.code).toBe(Errors.MergeLocalChangesError.code)
        expect(error.data.filepaths).toEqual(filepaths)
        // Nothing was written.
        expect(await resolveRef({ fs, gitdir, ref: 'master' })).toBe(masterOid)
        expect(await fs.read(`${dir}/conflict.txt`, 'utf8')).toBe(
          'one\nmaster\nthree\n'
        )
        expect(await fs.exists(`${dir}/added.txt`)).toBe(
          filepaths.includes('added.txt')
        )
      }

      it('rejects a staged change, even in a file the merge does not touch', async () => {
        const repo = await setup('tmp-merge-dirty-staged')
        const { fs, dir, gitdir } = repo
        await fs.write(`${dir}/same.txt`, 'staged\n')
        await add({ fs, dir, gitdir, filepath: 'same.txt' })

        await expectRejected(repo, ['same.txt'])
        expect(await status({ fs, dir, gitdir, filepath: 'same.txt' })).toBe(
          'modified'
        )
      })

      it('rejects an unstaged edit to a file the merge changes', async () => {
        const repo = await setup('tmp-merge-dirty-unstaged')
        const { fs, dir } = repo
        await fs.write(`${dir}/theirs.txt`, 'local\n')

        await expectRejected(repo, ['theirs.txt'])
        expect(await fs.read(`${dir}/theirs.txt`, 'utf8')).toBe('local\n')
      })

      it('rejects an untracked file where the merge adds one', async () => {
        const repo = await setup('tmp-merge-dirty-untracked')
        const { fs, dir } = repo
        await fs.write(`${dir}/added.txt`, 'untracked\n')

        await expectRejected(repo, ['added.txt'])
        expect(await fs.read(`${dir}/added.txt`, 'utf8')).toBe('untracked\n')
      })

      it('keeps an unstaged edit in a file both sides changed the same way', async () => {
        const repo = await setup('tmp-merge-dirty-same-change')
        const { fs, dir, gitdir } = repo
        for (const ref of ['feature', 'master']) {
          await checkout({ fs, dir, gitdir, ref })
          await fs.write(`${dir}/twin.txt`, 'both\n')
          await add({ fs, dir, gitdir, filepath: 'twin.txt' })
          await gitCommit({
            fs,
            dir,
            gitdir,
            message: `twin on ${ref}`,
            author,
          })
        }
        await fs.write(`${dir}/twin.txt`, 'local edit\n')

        // The merge does not write twin.txt, so git lets it through.
        const error = await mergeFeature(repo)
        expect(error.code).toBe(Errors.MergeConflictError.code)
        expect(await fs.read(`${dir}/twin.txt`, 'utf8')).toBe('local edit\n')
      })

      it('does not look for local changes when nothing is written', async () => {
        const repo = await setup('tmp-merge-dirty-abort')
        const { fs, dir, gitdir } = repo
        await fs.write(`${dir}/theirs.txt`, 'local\n')

        for (const options of [{ abortOnConflict: true }, { dryRun: true }]) {
          const error = await mergeFeature(repo, options)
          expect(error.code).toBe(Errors.MergeConflictError.code)
          expect(await fs.read(`${dir}/theirs.txt`, 'utf8')).toBe('local\n')
          expect(await fs.read(`${dir}/conflict.txt`, 'utf8')).toBe(
            'one\nmaster\nthree\n'
          )
          expect(
            await status({ fs, dir, gitdir, filepath: 'conflict.txt' })
          ).toBe('unmodified')
        }
      })
    })

    describe('files that .gitignore ignores', () => {
      // master ignores .local and has an untracked .local/folder.lock; other
      // tracks that file. Both change f.txt, so the merge stops on a conflict.
      async function ignoredRepo(
        name,
        { ignore = '.local\n', tracked = '' } = {}
      ) {
        const { fs, dir, gitdir } = await makeFixture(name)
        await init({ fs, dir, gitdir })
        await fs.write(`${dir}/.gitignore`, ignore)
        await fs.write(`${dir}/f.txt`, 'one\ntwo\nthree\n')
        await add({ fs, dir, gitdir, filepath: '.' })
        if (tracked) {
          await fs.write(`${dir}/${tracked}`, 'base\n')
          await add({ fs, dir, gitdir, filepath: tracked, force: true })
        }
        await gitCommit({ fs, dir, gitdir, message: 'base', author })
        await branch({ fs, dir, gitdir, ref: 'other', checkout: true })
        await fs.write(`${dir}/.local/folder.lock`, 'theirs\n')
        await add({
          fs,
          dir,
          gitdir,
          filepath: '.local/folder.lock',
          force: true,
        })
        await fs.write(`${dir}/f.txt`, 'one\nother\nthree\n')
        await add({ fs, dir, gitdir, filepath: 'f.txt' })
        if (tracked) {
          await fs.write(`${dir}/${tracked}`, 'theirs\n')
          await add({ fs, dir, gitdir, filepath: tracked, force: true })
        }
        await gitCommit({ fs, dir, gitdir, message: 'other', author })
        await checkout({ fs, dir, gitdir, ref: 'master' })
        await fs.write(`${dir}/f.txt`, 'one\nmaster\nthree\n')
        await add({ fs, dir, gitdir, filepath: 'f.txt' })
        await gitCommit({ fs, dir, gitdir, message: 'master', author })
        await fs.write(`${dir}/.local/folder.lock`, 'mine\n')
        return { fs, dir, gitdir }
      }

      async function mergeOther({ fs, dir, gitdir }) {
        let error = null
        try {
          await merge({
            fs,
            dir,
            gitdir,
            ours: 'master',
            theirs: 'other',
            abortOnConflict: false,
            author,
          })
        } catch (e) {
          error = e
        }
        expect(error).not.toBeNull()
        return error
      }

      it('overwrites an untracked file that .gitignore ignores, like git', async () => {
        const repo = await ignoredRepo('tmp-merge-ignored')
        const { fs, dir, gitdir } = repo

        const error = await mergeOther(repo)
        expect(error.code).toBe(Errors.MergeConflictError.code)
        expect(error.data.filepaths).toEqual(['f.txt'])
        expect(await fs.read(`${dir}/.local/folder.lock`, 'utf8')).toBe(
          'theirs\n'
        )
        expect(
          await status({ fs, dir, gitdir, filepath: '.local/folder.lock' })
        ).toBe('added')
      })

      it('still refuses to overwrite an untracked file that is not ignored', async () => {
        const repo = await ignoredRepo('tmp-merge-ignored-not', { ignore: '' })
        const { fs, dir } = repo

        const error = await mergeOther(repo)
        expect(error.code).toBe(Errors.MergeLocalChangesError.code)
        expect(error.data.filepaths).toEqual(['.local/folder.lock'])
        expect(await fs.read(`${dir}/.local/folder.lock`, 'utf8')).toBe(
          'mine\n'
        )
      })

      it('still refuses to overwrite an edit to a tracked file that .gitignore ignores', async () => {
        const repo = await ignoredRepo('tmp-merge-ignored-tracked', {
          tracked: '.local/tracked.txt',
        })
        const { fs, dir } = repo
        await fs.rm(`${dir}/.local/folder.lock`)
        await fs.write(`${dir}/.local/tracked.txt`, 'local edit\n')

        const error = await mergeOther(repo)
        expect(error.code).toBe(Errors.MergeLocalChangesError.code)
        expect(error.data.filepaths).toEqual(['.local/tracked.txt'])
        expect(await fs.read(`${dir}/.local/tracked.txt`, 'utf8')).toBe(
          'local edit\n'
        )
      })

      it('removes an ignored file where the merge needs a directory', async () => {
        const repo = await ignoredRepo('tmp-merge-ignored-dir', {
          ignore: '.local\n',
        })
        const { fs, dir } = repo
        // .local itself is an ignored file now, where other has a directory.
        await fs.rm(`${dir}/.local/folder.lock`)
        await fs.rmdir(`${dir}/.local`)
        await fs.write(`${dir}/.local`, 'an ignored file\n')

        const error = await mergeOther(repo)
        expect(error.code).toBe(Errors.MergeConflictError.code)
        expect(await fs.read(`${dir}/.local/folder.lock`, 'utf8')).toBe(
          'theirs\n'
        )
      })
    })

    it('replaces a directory with a file the way git does', async () => {
      const { fs, dir, gitdir } = await makeFixture('tmp-merge-dir-to-file')
      await init({ fs, dir, gitdir })
      await fs.write(`${dir}/conflict.txt`, 'one\ntwo\nthree\n')
      await fs.write(`${dir}/sub/nested.txt`, 'base\n')
      await add({ fs, dir, gitdir, filepath: '.' })
      const baseOid = await gitCommit({
        fs,
        dir,
        gitdir,
        message: 'base',
        author,
      })
      // feature turns the directory into a file. Built from objects, since
      // checkout does not make that change.
      const blob = async content => ({
        mode: '100644',
        type: 'blob',
        oid: await writeBlob({ fs, gitdir, blob: Buffer.from(content) }),
      })
      await gitCommit({
        fs,
        dir,
        gitdir,
        ref: 'refs/heads/feature',
        parent: [baseOid],
        tree: await writeTree({
          fs,
          gitdir,
          tree: [
            { path: 'conflict.txt', ...(await blob('one\nfeature\nthree\n')) },
            { path: 'sub', ...(await blob('now a file\n')) },
          ],
        }),
        message: 'feature',
        author,
      })
      await fs.write(`${dir}/conflict.txt`, 'one\nmaster\nthree\n')
      await add({ fs, dir, gitdir, filepath: 'conflict.txt' })
      await gitCommit({ fs, dir, gitdir, message: 'master', author })
      const repo = { fs, dir, gitdir }

      // An untracked file inside the directory would be lost: refused.
      await fs.write(`${dir}/sub/untracked.txt`, 'untracked\n')
      let error = await mergeFeature(repo)
      expect(error.code).toBe(Errors.MergeLocalChangesError.code)
      expect(error.data.filepaths).toEqual(['sub/untracked.txt'])
      expect(await fs.read(`${dir}/sub/nested.txt`, 'utf8')).toBe('base\n')
      await fs.rm(`${dir}/sub/untracked.txt`)

      error = await mergeFeature(repo)
      expect(error.code).toBe(Errors.MergeConflictError.code)
      expect(error.data.filepaths).toEqual(['conflict.txt'])
      expect(await fs.read(`${dir}/sub`, 'utf8')).toBe('now a file\n')
      expect(await statusMatrix({ fs, dir, gitdir })).toEqual([
        ['conflict.txt', 1, 2, 3],
        ['sub', 0, 2, 2],
        ['sub/nested.txt', 1, 0, 0],
      ])
    })

    it('records the merge in progress so commit can finish it', async () => {
      const repo = await setup('tmp-merge-state')
      const { fs, dir, gitdir, featureOid, masterOid } = repo

      await mergeFeature(repo)
      expect(await fs.read(`${gitdir}/MERGE_HEAD`, 'utf8')).toBe(
        `${featureOid}\n`
      )
      expect(await fs.read(`${gitdir}/ORIG_HEAD`, 'utf8')).toBe(
        `${masterOid}\n`
      )
      expect(await fs.read(`${gitdir}/MERGE_MSG`, 'utf8')).toBe(
        "Merge branch 'feature'\n\n# Conflicts:\n#\tconflict.txt\n"
      )

      // Resolving and committing, with no parents or message given,
      // finishes the merge like `git commit` does.
      await fs.write(`${dir}/conflict.txt`, 'one\nresolved\nthree\n')
      await add({ fs, dir, gitdir, filepath: 'conflict.txt' })
      const mergeOid = await gitCommit({ fs, dir, gitdir, author })
      const { commit } = await readCommit({ fs, gitdir, oid: mergeOid })
      expect(commit.parent).toEqual([masterOid, featureOid])
      expect(commit.message).toBe("Merge branch 'feature'\n")
      expect(await resolveRef({ fs, gitdir, ref: 'master' })).toBe(mergeOid)
      expect(await fs.exists(`${gitdir}/MERGE_HEAD`)).toBe(false)
      expect(await fs.exists(`${gitdir}/MERGE_MSG`)).toBe(false)
      expect(await fs.exists(`${gitdir}/ORIG_HEAD`)).toBe(true)
    })

    it('names the branch merged into unless it is main or master', async () => {
      const repo = await setup('tmp-merge-state-into')
      const { fs, dir, gitdir } = repo
      await branch({ fs, dir, gitdir, ref: 'topic', checkout: true })

      await mergeFeature(repo, { ours: 'topic' })
      expect(await fs.read(`${gitdir}/MERGE_MSG`, 'utf8')).toBe(
        "Merge branch 'feature' into topic\n\n# Conflicts:\n#\tconflict.txt\n"
      )
    })
  })

  describe('binary files and other bytes', () => {
    const author = {
      name: 'Mr. Test',
      email: 'mrtest@example.com',
      timestamp: 1262356920,
      timezoneOffset: -0,
    }

    it('does not merge binary files and keeps other bytes intact', async () => {
      const { fs, dir, gitdir } = await makeFixture('tmp-merge-binary')
      await init({ fs, dir, gitdir })
      // A NUL byte in the first 8000 bytes makes a file binary, like in git.
      const binary = {
        base: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00, 1, 2, 3]),
        feature: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00, 1, 2, 4]),
        master: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00, 1, 2, 5]),
      }
      // Latin-1 text with a lone CR inside a line: not valid UTF-8 and not a
      // line ending git knows, but still text.
      const latin1 = {
        base: Buffer.from('caf\xe9\rcr\nmiddle\nend\n', 'latin1'),
        feature: Buffer.from('caf\xe9\rcr\nmiddle\nfeature\n', 'latin1'),
        master: Buffer.from('master caf\xe9\rcr\nmiddle\nend\n', 'latin1'),
        merged: Buffer.from('master caf\xe9\rcr\nmiddle\nfeature\n', 'latin1'),
      }
      const commitBoth = async (version, message) => {
        await fs.write(`${dir}/image.bin`, binary[version])
        await fs.write(`${dir}/latin1.txt`, latin1[version])
        await add({ fs, dir, gitdir, filepath: '.' })
        return gitCommit({ fs, dir, gitdir, message, author })
      }
      const baseOid = await commitBoth('base', 'base')
      await branch({ fs, dir, gitdir, ref: 'feature', checkout: true })
      const featureOid = await commitBoth('feature', 'feature')
      await checkout({ fs, dir, gitdir, ref: 'master' })
      const masterOid = await commitBoth('master', 'master')

      let error = null
      try {
        await merge({
          fs,
          dir,
          gitdir,
          ours: 'master',
          theirs: 'feature',
          abortOnConflict: false,
          author,
        })
      } catch (e) {
        error = e
      }
      expect(error).not.toBeNull()
      expect(error.code).toBe(Errors.MergeConflictError.code)
      expect(error.data.filepaths).toEqual(['image.bin'])

      // Ours stays in the working tree, all three versions are in the index.
      expect(Array.from(await fs.read(`${dir}/image.bin`))).toEqual(
        Array.from(binary.master)
      )
      const index = await GitIndexManager.acquire(
        { fs, gitdir, cache: {} },
        async index => index.entriesMap.get('image.bin').stages
      )
      const blob = async oid =>
        (await readBlob({ fs, gitdir, oid, filepath: 'image.bin' })).oid
      expect(index.slice(1).map(entry => entry.oid)).toEqual([
        await blob(baseOid),
        await blob(masterOid),
        await blob(featureOid),
      ])

      // The text file merged cleanly, byte for byte.
      expect(Array.from(await fs.read(`${dir}/latin1.txt`))).toEqual(
        Array.from(latin1.merged)
      )
      expect(await status({ fs, dir, gitdir, filepath: 'latin1.txt' })).toBe(
        'modified'
      )
    })
  })

  describe('conflict markers', () => {
    const author = {
      name: 'Mr. Test',
      email: 'mrtest@example.com',
      timestamp: 1262356920,
      timezoneOffset: -0,
    }

    it('labels our side HEAD when ours is the checked-out branch, like git', async () => {
      for (const ours of [undefined, 'master']) {
        const { fs, dir, gitdir } = await makeFixture(
          `tmp-merge-label-${ours || 'default'}`
        )
        await init({ fs, dir, gitdir })
        await fs.write(`${dir}/file.txt`, 'base\n')
        await add({ fs, dir, gitdir, filepath: 'file.txt' })
        await gitCommit({ fs, dir, gitdir, message: 'base', author })
        await branch({ fs, dir, gitdir, ref: 'feature', checkout: true })
        await fs.write(`${dir}/file.txt`, 'feature change\n')
        await add({ fs, dir, gitdir, filepath: 'file.txt' })
        await gitCommit({ fs, dir, gitdir, message: 'feature', author })
        await checkout({ fs, dir, gitdir, ref: 'master' })
        await fs.write(`${dir}/file.txt`, 'master change\n')
        await add({ fs, dir, gitdir, filepath: 'file.txt' })
        await gitCommit({ fs, dir, gitdir, message: 'master change', author })

        let error = null
        try {
          await merge({
            fs,
            dir,
            gitdir,
            ours,
            theirs: 'feature',
            abortOnConflict: false,
            author,
          })
        } catch (e) {
          error = e
        }
        expect(error).not.toBeNull()
        expect(error.code).toBe(Errors.MergeConflictError.code)
        expect(await fs.read(`${dir}/file.txt`, 'utf8')).toBe(
          '<<<<<<< HEAD\nmaster change\n=======\nfeature change\n>>>>>>> feature\n'
        )
      }
    })
  })
})
