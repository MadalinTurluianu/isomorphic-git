/* eslint-env node, browser, jasmine */
import {
  Errors,
  merge,
  readBlob,
  resolveRef,
  abortMerge,
  add,
  listFiles,
  STAGE,
  TREE,
  WORKDIR,
  walk,
  init,
  commit,
  branch,
  checkout,
  statusMatrix,
} from 'isomorphic-git'
import { GitIndexManager, modified } from 'isomorphic-git/internal-apis'

import { makeFixture } from './__helpers__/FixtureFS.js'

describe('abortMerge', () => {
  it('write conflicted files to index at different stages', async () => {
    // Setup
    const { gitdir, dir, fs } = await makeFixture('test-abortMerge')

    const branchA = await resolveRef({ fs, gitdir, ref: 'a' })
    const branchB = await resolveRef({ fs, gitdir, ref: 'b' })
    const ancestor = '2d7b1a9b82e52bd8648cf156aa559eff3a27a678' // common ancestor, hard coded, not ideal

    const fileAVersions = [
      await readBlob({ fs, gitdir, oid: ancestor, filepath: 'a' }),
      await readBlob({ fs, gitdir, oid: branchA, filepath: 'a' }),
      await readBlob({ fs, gitdir, oid: branchB, filepath: 'a' }),
    ]

    const fileBVersions = [
      await readBlob({ fs, gitdir, oid: ancestor, filepath: 'b' }),
      await readBlob({ fs, gitdir, oid: branchA, filepath: 'b' }),
      await readBlob({ fs, gitdir, oid: branchB, filepath: 'b' }),
    ]

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
    expect(error.code).toBe(Errors.MergeConflictError.code)

    await GitIndexManager.acquire(
      { fs, gitdir, cache: {} },
      async function (index) {
        expect(index.unmergedPaths.length).toEqual(2)
        expect(index.entriesFlat.length).toBe(7)
        expect(index.unmergedPaths).toContain('a')
        expect(index.unmergedPaths).toContain('b')
        expect(index.entriesMap.get('a').stages.length).toBe(4)
        expect(index.entriesMap.get('b').stages.length).toBe(4)
        expect(index.entriesMap.get('c').stages.length).toBe(1)
        const fileAStages = [
          await readBlob({
            fs,
            gitdir,
            oid: index.entriesMap.get('a').stages[1].oid,
          }),
          await readBlob({
            fs,
            gitdir,
            oid: index.entriesMap.get('a').stages[2].oid,
          }),
          await readBlob({
            fs,
            gitdir,
            oid: index.entriesMap.get('a').stages[3].oid,
          }),
        ]
        const fileBStages = [
          await readBlob({
            fs,
            gitdir,
            oid: index.entriesMap.get('b').stages[1].oid,
          }),
          await readBlob({
            fs,
            gitdir,
            oid: index.entriesMap.get('b').stages[2].oid,
          }),
          await readBlob({
            fs,
            gitdir,
            oid: index.entriesMap.get('b').stages[3].oid,
          }),
        ]
        expect(fileAVersions).toEqual(fileAStages)
        expect(fileBVersions).toEqual(fileBStages)
      }
    )
  })

  it('abort merge without touching anything', async () => {
    // Setup
    const { fs, gitdir, dir } = await makeFixture('test-abortMerge')

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
    expect(error.code).toBe(Errors.MergeConflictError.code)

    await abortMerge({ fs, dir, gitdir })

    const trees = [TREE({ ref: 'HEAD' }), WORKDIR(), STAGE()]
    await walk({
      fs,
      dir,
      gitdir,
      trees,
      map: async function (path, [head, workdir, index]) {
        if (path === '.') return

        if (head && index) {
          expect([path, await head.mode()]).toEqual([path, await index.mode()])
          expect([path, await head.oid()]).toEqual([path, await index.oid()])
        }

        expect(await modified(index, head)).toBe(false)

        // only since we didn't touch anything
        expect(await modified(workdir, head)).toBe(false)

        expect(await modified(index, workdir)).toBe(false)
      },
    })
  })

  it('abort merge after modifying files in a directory', async () => {
    // Setup
    const { fs, gitdir, dir } = await makeFixture('test-abortMerge')

    // Test
    let error = null
    try {
      await merge({
        fs,
        dir,
        gitdir,
        ours: 'c',
        theirs: 'd',
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
    expect(error.code).toBe(Errors.MergeConflictError.code)

    await fs.rm(`${dir}/a/a`)
    await fs.rmdir(`${dir}/a`)
    await fs.write(`${dir}/b/b`, 'new text for file b')
    await fs.write(`${dir}/c/c`, 'new text for file c')

    await abortMerge({ fs, dir, gitdir, commit: 'c' })

    const trees = [TREE({ ref: 'c' }), WORKDIR(), STAGE()]
    await walk({
      fs,
      dir,
      gitdir,
      trees,
      map: async function (path, [head, workdir, index]) {
        if (head && (await head.type()) === 'tree') return

        if (path === 'b') {
          expect(await modified(workdir, head)).toBe(false)
          expect(await modified(workdir, index)).toBe(false)
        }

        if (head && index) {
          expect([path, await head.mode()]).toEqual([path, await index.mode()])
          expect([path, await head.oid()]).toEqual([path, await index.oid()])
        }

        expect(await modified(index, head)).toBe(false)
      },
    })
    const fileCContent = new TextDecoder().decode(await fs.read(`${dir}/c/c`))
    const fileBContent = new TextDecoder().decode(await fs.read(`${dir}/b/b`))
    expect(fileCContent).toEqual('new text for file c')
    expect(fileBContent).not.toEqual('new text for file b')
  })

  it('abort merge after modifying files', async () => {
    // Setup
    const { fs, gitdir, dir } = await makeFixture('test-abortMerge')

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
    expect(error.code).toBe(Errors.MergeConflictError.code)

    await fs.rm(`${dir}/a`)
    await fs.write(`${dir}/b`, 'new text for file b')
    await fs.write(`${dir}/c`, 'new text for file c')

    await abortMerge({ fs, dir, gitdir })

    const trees = [TREE({ ref: 'HEAD' }), WORKDIR(), STAGE()]
    await walk({
      fs,
      dir,
      gitdir,
      trees,
      map: async function (path, [head, workdir, index]) {
        if (path === '.') return

        if (path === 'b') {
          expect(await modified(workdir, head)).toBe(false)
          expect(await modified(workdir, index)).toBe(false)
        }

        if (head && index) {
          expect([path, await head.mode()]).toEqual([path, await index.mode()])
          expect([path, await head.oid()]).toEqual([path, await index.oid()])
        }

        expect(await modified(index, head)).toBe(false)
      },
    })
    const fileCContent = new TextDecoder().decode(await fs.read(`${dir}/c`))
    const fileBContent = new TextDecoder().decode(await fs.read(`${dir}/b`))
    expect(fileCContent).toEqual('new text for file c')
    expect(fileBContent).not.toEqual('new text for file b')
  })

  it('uncache a file that has changes in the workdir (throw an error)', async () => {
    // Setup
    const { fs, gitdir, dir } = await makeFixture('test-abortMerge')

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
    expect(error.code).toBe(Errors.MergeConflictError.code)

    fs.write(`${dir}/c`, 'new changes to file c')
    await GitIndexManager.acquire(
      { fs, gitdir, cache: {} },
      async function (index) {
        index.delete({ filepath: 'c' })
      }
    )

    const fileAWorkdirVersion = await fs.read(`${dir}/a`).then(buffer => {
      return buffer.toString()
    })
    const fileBWorkdirVersion = await fs.read(`${dir}/b`).then(buffer => {
      return buffer.toString()
    })
    const fileCWorkdirVersion = await fs.read(`${dir}/c`).then(buffer => {
      return buffer.toString()
    })

    try {
      await abortMerge({ fs, dir, gitdir })
    } catch (e) {
      error = e
    }

    expect(error).not.toBeNull()
    expect(error.code).toBe(Errors.IndexResetError.code)

    const fileAContent = await fs.read(`${dir}/a`).then(buffer => {
      return buffer.toString()
    })
    const fileBContent = await fs.read(`${dir}/b`).then(buffer => {
      return buffer.toString()
    })
    const fileCContent = await fs.read(`${dir}/c`).then(buffer => {
      return buffer.toString()
    })

    const dirContents = await fs.readdir(dir)

    expect(dirContents.length).toBe(3)
    expect(fileAContent).toEqual(fileAWorkdirVersion)
    expect(fileBContent).toEqual(fileBWorkdirVersion)
    expect(fileCContent).toEqual(fileCWorkdirVersion)
  })

  it('workdir != index && index != head [stage a file and them modify in workdir] (throw an error)', async () => {
    // Setup
    const { fs, gitdir, dir } = await makeFixture('test-abortMerge')

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
    expect(error.code).toBe(Errors.MergeConflictError.code)

    await fs.write(`${dir}/a`, 'text that is in the index')
    await add({ fs, dir, gitdir, filepath: 'a' })
    await fs.write(`${dir}/a`, 'text that is in the workdir')

    const fileBWorkdirVersion = await fs.read(`${dir}/b`).then(buffer => {
      return buffer.toString()
    })
    const fileCWorkdirVersion = await fs.read(`${dir}/c`).then(buffer => {
      return buffer.toString()
    })

    try {
      await abortMerge({ fs, dir, gitdir })
    } catch (e) {
      error = e
    }

    expect(error).not.toBeNull()
    expect(error.code).toBe(Errors.IndexResetError.code)

    const fileAContent = await fs.read(`${dir}/a`).then(buffer => {
      return buffer.toString()
    })
    const fileBContent = await fs.read(`${dir}/b`).then(buffer => {
      return buffer.toString()
    })
    const fileCContent = await fs.read(`${dir}/c`).then(buffer => {
      return buffer.toString()
    })

    const dirContents = await fs.readdir(dir)

    expect(dirContents.length).toBe(3)
    expect(fileAContent).toEqual('text that is in the workdir')
    expect(fileBContent).toEqual(fileBWorkdirVersion)
    expect(fileCContent).toEqual(fileCWorkdirVersion)
  })

  it('workdir != index && index === head (keep our changes)', async () => {
    // Setup
    const { fs, gitdir, dir } = await makeFixture('test-abortMerge')

    const head = await resolveRef({ fs, gitdir, ref: 'HEAD' })

    const fileAHeadVersion = await readBlob({
      fs,
      gitdir,
      oid: head,
      filepath: 'a',
    }).then(result => {
      return new TextDecoder().decode(result.blob)
    })
    const fileBHeadVersion = await readBlob({
      fs,
      gitdir,
      oid: head,
      filepath: 'b',
    }).then(result => {
      return new TextDecoder().decode(result.blob)
    })

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
    expect(error.code).toBe(Errors.MergeConflictError.code)

    await fs.write(`${dir}/c`, 'new text for file c')
    await abortMerge({ fs, dir, gitdir })

    const fileAContent = await fs.read(`${dir}/a`).then(buffer => {
      return buffer.toString()
    })
    const fileBContent = await fs.read(`${dir}/b`).then(buffer => {
      return buffer.toString()
    })
    const fileCContent = await fs.read(`${dir}/c`).then(buffer => {
      return buffer.toString()
    })

    const dirContents = await fs.readdir(dir)

    expect(dirContents.length).toBe(3)
    expect(fileAContent).toEqual(fileAHeadVersion)
    expect(fileBContent).toEqual(fileBHeadVersion)
    expect(fileCContent).toEqual('new text for file c')
  })

  it('drops files added to the index during the merge', async () => {
    const { fs, gitdir, dir } = await makeFixture('test-abortMerge')
    const author = {
      name: 'Mr. Test',
      email: 'mrtest@example.com',
      timestamp: 1262356920,
      timezoneOffset: -0,
    }
    let error = null
    try {
      await merge({
        fs,
        dir,
        gitdir,
        ours: 'a',
        theirs: 'b',
        abortOnConflict: false,
        author,
      })
    } catch (e) {
      error = e
    }
    expect(error.code).toBe(Errors.MergeConflictError.code)

    // A file staged during the merge, and one left only in the index.
    await fs.write(`${dir}/added`, 'added during the merge')
    await add({ fs, dir, gitdir, filepath: 'added' })
    await fs.write(`${dir}/index-only`, 'only in the index')
    await add({ fs, dir, gitdir, filepath: 'index-only' })
    await fs.rm(`${dir}/index-only`)

    await abortMerge({ fs, dir, gitdir })

    expect(await fs.exists(`${dir}/added`)).toBe(false)
    expect(await listFiles({ fs, dir, gitdir })).toEqual(['a', 'b', 'c'])
    expect(await fs.read(`${dir}/a`, 'utf8')).not.toContain('<<<<<<<')
  })
  it('restores executable files with their mode', async () => {
    const { fs, gitdir, dir } = await makeFixture('tmp-abort-exec')
    const author = {
      name: 'Mr. Test',
      email: 'mrtest@example.com',
      timestamp: 1262356920,
      timezoneOffset: -0,
    }
    await init({ fs, dir, gitdir })
    await fs.write(`${dir}/c.txt`, '1\n2\n3\n')
    await fs.write(`${dir}/run.sh`, 'a\n', { mode: 0o777 })
    await fs.write(`${dir}/mode.sh`, 'm\n', { mode: 0o777 })
    await add({ fs, dir, gitdir, filepath: '.' })
    await commit({ fs, dir, gitdir, message: 'base', author })
    await branch({ fs, dir, gitdir, ref: 'feature', checkout: true })
    await fs.write(`${dir}/c.txt`, '1\nfeature\n3\n')
    await fs.rm(`${dir}/run.sh`)
    await fs.write(`${dir}/run.sh`, 'b\n', { mode: 0o777 })
    // feature also makes mode.sh a plain file
    await fs.rm(`${dir}/mode.sh`)
    await fs.write(`${dir}/mode.sh`, 'm\n')
    await add({ fs, dir, gitdir, filepath: '.' })
    await commit({ fs, dir, gitdir, message: 'feature', author })
    await checkout({ fs, dir, gitdir, ref: 'master' })
    await fs.write(`${dir}/c.txt`, '1\nmaster\n3\n')
    await add({ fs, dir, gitdir, filepath: 'c.txt' })
    await commit({ fs, dir, gitdir, message: 'master', author })
    let error = null
    try {
      await merge({
        fs,
        dir,
        gitdir,
        theirs: 'feature',
        abortOnConflict: false,
        author,
      })
    } catch (e) {
      error = e
    }
    expect(error.code).toBe(Errors.MergeConflictError.code)

    await abortMerge({ fs, dir, gitdir })

    // Read before statusMatrix, which refreshes index entries from disk:
    // the index itself must have the modes.
    const modes = await GitIndexManager.acquire(
      { fs, gitdir, cache: {} },
      async index => ({
        run: index.entriesMap.get('run.sh').mode,
        mode: index.entriesMap.get('mode.sh').mode,
      })
    )
    expect(modes).toEqual({ run: 0o100755, mode: 0o100755 })
    expect(await fs.read(`${dir}/run.sh`, 'utf8')).toBe('a\n')
    const matrix = await statusMatrix({ fs, dir, gitdir })
    expect(matrix.every(row => row.slice(1).join() === '1,1,1')).toBe(true)
  })
})
