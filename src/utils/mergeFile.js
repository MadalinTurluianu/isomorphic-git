import diff3Merge from 'diff3'

// Lines with their endings. Only LF ends a line, as in git: a lone CR is an
// ordinary byte and has to survive the merge.
const LINEBREAKS = /[^\n]*\n|[^\n]+$/g
const lines = text => text.match(LINEBREAKS) || ['']

export function mergeFile({ branches, contents }) {
  const ourName = branches[1]
  const theirName = branches[2]

  const baseContent = contents[0]
  const ourContent = contents[1]
  const theirContent = contents[2]

  const ours = lines(ourContent)
  const base = lines(baseContent)
  const theirs = lines(theirContent)

  // Here we let the diff3 library do the heavy lifting.
  const result = diff3Merge(ours, base, theirs)

  const markerSize = 7

  // Here we note whether there are conflicts and format the results
  let mergedText = ''
  let cleanMerge = true

  for (const item of result) {
    if (item.ok) {
      mergedText += item.ok.join('')
    }
    if (item.conflict) {
      cleanMerge = false
      mergedText += `${'<'.repeat(markerSize)} ${ourName}\n`
      mergedText += item.conflict.a.join('')

      mergedText += `${'='.repeat(markerSize)}\n`
      mergedText += item.conflict.b.join('')
      mergedText += `${'>'.repeat(markerSize)} ${theirName}\n`
    }
  }
  return { cleanMerge, mergedText }
}
