const fs = require('fs');
const path = require('path');
const asciidoctor = require('asciidoctor')();

const rootDir = path.resolve(__dirname);
const srcDir = path.join(rootDir, 'src');
const publishedFiles = ['README.adoc', 'asciireq-specification.adoc'];

function resolveIncludes(fileName) {
  const docfile = path.join(srcDir, fileName);
  const content = fs.readFileSync(docfile, 'utf8');
  const doc = asciidoctor.load('= placeholder\n', {
    safe: 'safe',
    base_dir: srcDir,
    attributes: { 'env-github': '' },
  });
  const cursor = asciidoctor.Reader.Cursor.$new(docfile, srcDir);
  const reader = asciidoctor.PreprocessorReader.$new(doc, content, cursor);
  const lines = [];
  while (reader.hasMoreLines()) lines.push(reader.readLine());
  const resolved = applyLevelOffsets(lines).join('\n') + '\n';
  if (/^include::/m.test(resolved)) {
    throw new Error(`Unresolved include directive left in ${fileName}`);
  }
  return resolved;
}

// The preprocessor marks included files with `:leveloffset:` attribute entries.
// Apply those offsets to the section titles, so that the published file is
// self-contained with the final title levels.
function applyLevelOffsets(lines) {
  const stack = [];
  let offset = 0;
  const out = [];
  for (const line of lines) {
    let m = line.match(/^:leveloffset:\s*\+(\d+)\s*$/);
    if (m) {
      stack.push(offset);
      offset += parseInt(m[1], 10);
      continue;
    }
    if (/^:leveloffset!:\s*$/.test(line)) {
      offset = stack.length > 0 ? stack.pop() : 0;
      continue;
    }
    m = line.match(/^(=+)( .*$)/);
    if (m) {
      out.push('='.repeat(Math.max(1, m[1].length + offset)) + m[2]);
    } else {
      out.push(line);
    }
  }
  return out;
}

for (const fileName of publishedFiles) {
  fs.writeFileSync(path.join(rootDir, fileName), resolveIncludes(fileName));
  console.log(`published ${fileName}`);
}

for (const entry of fs.readdirSync(rootDir)) {
  if (entry.endsWith('.adoc') && !publishedFiles.includes(entry)) {
    fs.unlinkSync(path.join(rootDir, entry));
    console.log(`removed stale ${entry}`);
  }
}
