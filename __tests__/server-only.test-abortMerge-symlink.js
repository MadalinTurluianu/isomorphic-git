/* eslint-env node, jasmine */
import { promises as fsp } from 'fs'
import { join } from 'path'

import * as git from 'isomorphic-git'

import { makeFixture } from './__helpers__/FixtureFS.js'

// abortMerge resets staged files to HEAD. A symlink among them has to be
// restored as a link, not as a file holding the target path. (node-only:
// needs real symlinks.)
describe('abortMerge symlink', () => {
  it('restores a symlink', async () => {
    const { fs, dir, gitdir } = await makeFixture('test-abortMerge-symlink')
    const author = {
      name: 't',
      email: 't@t',
      timestamp: 1000,
      timezoneOffset: 0,
    }
    await git.init({ fs, dir, gitdir })
    await fs.write(join(dir, 'a.txt'), 'a\n')
    await fs.write(join(dir, 'c.txt'), 'c\n')
    await fsp.symlink('a.txt', join(dir, 'link'))
    await git.add({ fs, dir, gitdir, filepath: '.' })
    await git.commit({ fs, dir, gitdir, message: 'base', author })
    // A staged change to the link, as a merge leaves it.
    await fsp.unlink(join(dir, 'link'))
    await fsp.symlink('c.txt', join(dir, 'link'))
    await git.add({ fs, dir, gitdir, filepath: 'link' })

    await git.abortMerge({ fs, dir, gitdir })

    expect((await fsp.lstat(join(dir, 'link'))).isSymbolicLink()).toBe(true)
    expect(await fsp.readlink(join(dir, 'link'))).toBe('a.txt')
    expect(await fs.read(join(dir, 'c.txt'), 'utf8')).toBe('c\n')
    const matrix = await git.statusMatrix({ fs, dir, gitdir })
    expect(matrix.every(row => row.slice(1).join() === '1,1,1')).toBe(true)
  })
})
