// @ts-check
import '../typedefs.js'

// The files git keeps in the git directory while a merge or cherry-pick that
// stopped on conflicts waits to be committed or aborted.
const MERGE_STATE_FILES = [
  'MERGE_HEAD',
  'MERGE_MSG',
  'MERGE_MODE',
  'CHERRY_PICK_HEAD',
  'AUTO_MERGE',
]

/**
 * The contents of MERGE_MSG: the prepared message followed by the list of
 * conflicted files as comment lines, the way git writes it.
 *
 * @param {string} message
 * @param {string[]} conflicts
 * @returns {string}
 */
export function formatMergeMessage(message, conflicts) {
  return `${message.replace(/\n*$/, '\n')}\n# Conflicts:\n${[...conflicts]
    .sort()
    .map(filepath => `#\t${filepath}\n`)
    .join('')}`
}

/**
 * The message from MERGE_MSG without the conflict list `formatMergeMessage`
 * appended. Every other line is kept as written, so a picked commit's
 * message survives untouched even where it looks like a comment.
 *
 * @param {string} message
 * @returns {string}
 */
export function stripConflictsComment(message) {
  const stripped = message.replace(/\n*# Conflicts:\n(?:#\t[^\n]*\n?)*$/, '\n')
  return stripped.trim() ? stripped : ''
}

/**
 * Forget the merge or cherry-pick in progress. ORIG_HEAD stays, as in git.
 *
 * @param {object} args
 * @param {import('../models/FileSystem.js').FileSystem} args.fs
 * @param {string} args.gitdir
 */
export async function clearMergeState({ fs, gitdir }) {
  for (const file of MERGE_STATE_FILES) {
    await fs.rm(`${gitdir}/${file}`)
  }
}
