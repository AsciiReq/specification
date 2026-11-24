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
  const resolved = lines.join('\n') + '\n';
  if (/^include::/m.test(resolved)) {
    throw new Error(`Unresolved include directive left in ${fileName}`);
  }
  return resolved;
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
