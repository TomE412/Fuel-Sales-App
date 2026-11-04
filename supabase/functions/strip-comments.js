// Produces a comment-free copy of an Edge Function for pasting into the
// Supabase editor. Generated from the real file so the two cannot drift.
//
// Walks the source character by character tracking whether it is inside a
// string, a template literal or a comment. A naive regex would wreck any
// "//" that appears inside a string - a URL, for instance - and the damage
// would not show until the function was live.
const fs = require('fs');

function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let state = 'code';   // code | line | block | single | double | tick
  let depth = 0;        // ${ } nesting inside a template literal

  while (i < n) {
    const c = src[i], d = src[i + 1];

    if (state === 'code') {
      if (c === '/' && d === '/') { state = 'line'; i += 2; continue; }
      if (c === '/' && d === '*') { state = 'block'; i += 2; continue; }
      if (c === "'") { state = 'single'; out += c; i++; continue; }
      if (c === '"') { state = 'double'; out += c; i++; continue; }
      if (c === '`') { state = 'tick'; out += c; i++; continue; }
      out += c; i++; continue;
    }

    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += c; }
      i++; continue;
    }

    if (state === 'block') {
      if (c === '*' && d === '/') { state = 'code'; i += 2; continue; }
      // Keep newlines so line numbers in any error still roughly line up.
      if (c === '\n') out += c;
      i++; continue;
    }

    // Inside a string of some kind: copy verbatim, honouring escapes.
    if (c === '\\') { out += c + (d ?? ''); i += 2; continue; }
    if (state === 'single' && c === "'") state = 'code';
    else if (state === 'double' && c === '"') state = 'code';
    else if (state === 'tick') {
      if (c === '`' && depth === 0) state = 'code';
      else if (c === '$' && d === '{') { depth++; out += c + d; i += 2; continue; }
      else if (c === '}' && depth > 0) depth--;
    }
    out += c; i++;
  }
  return out;
}

function tidy(src) {
  return src
    .split(/\r?\n/)
    // A line that held nothing but a comment is now whitespace: drop it.
    .filter((l, idx, arr) => !(l.trim() === '' && (arr[idx - 1] ?? '').trim() === ''))
    .map(l => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .trimEnd() + '\n';
}

const [, , inPath, outPath] = process.argv;
const src = fs.readFileSync(inPath, 'utf8');
const stripped = tidy(stripComments(src));
fs.writeFileSync(outPath, stripped);

// Rough proof nothing structural was lost: the brackets must still balance,
// and every one of these must still be present exactly as often as before.
const countOutside = (s, ch) => (stripComments(s).match(new RegExp('\\' + ch, 'g')) || []).length;
const checks = ['{', '}', '(', ')', '[', ']'];
let bad = 0;
for (const ch of checks) {
  const a = countOutside(src, ch), b = (stripped.match(new RegExp('\\' + ch, 'g')) || []).length;
  if (a !== b) { console.log(`MISMATCH ${ch}: ${a} -> ${b}`); bad++; }
}
for (const word of ['Deno.serve', 'createClient', 'case "list"', 'case "set_password"',
                    'case "create_person"', 'case "set_active"', 'MIN_PASSWORD', 'FOREVER']) {
  if (!stripped.includes(word)) { console.log('LOST: ' + word); bad++; }
}
console.log(`${src.split(/\r?\n/).length} lines in -> ${stripped.split('\n').length} lines out`);
console.log(bad ? `${bad} PROBLEM(S)` : 'brackets balance, all landmarks present');
