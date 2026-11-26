#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const asciidoctor = require('asciidoctor')();

const rootDir = path.resolve(__dirname, '..', '..');
const srcDir = path.join(rootDir, 'src');
const versionFile = path.join(rootDir, 'VERSION');
const publishedFiles = [
  'README.adoc',
  'asciireq-specification.adoc',
];

/**
 * Hides the `ifdef::env-github[]` / `ifndef::env-github[]` blocks of the given
 * content from the preprocessor, by replacing each of them with a placeholder
 * comment line. This keeps the GitHub rendering hack unevaluated, so that it
 * remains active in the published file.
 *
 * There may be several locations to protect in the `content`: each placeholder
 * contains the index of its protected block, e.g. `// asciireq-publish:keep-index:0`.
 *
 * @param {string} content - the AsciiDoc source content to protect
 * @returns {{protectedContent: string, conditionals: string[]}} the protected
 *   content, and the replaced conditional blocks in placeholder order
 */
function protectEnvGithubConditionals(content) {
  const conditionals = [];
  const protectedContent = content.replace(
    /^(?:ifdef|ifndef)::env-github\[\]\n[\s\S]*?^endif::\[\]\n?/gm,
    (match) => {
      const placeholder = `// asciireq-publish:keep-index:${conditionals.length}\n`;
      conditionals.push(match);
      return placeholder;
    }
  );
  return { protectedContent, conditionals };
}

/**
 * Restores into the resolved content the `env-github` conditional blocks hidden
 * by {@link protectEnvGithubConditionals} (reverse operation), replacing each
 * placeholder comment line (which contains the index of its protected block)
 * with that original conditional block.
 *
 * @param {string} resolved - the resolved content containing the placeholders
 * @param {string[]} conditionals - the conditional blocks in placeholder order
 * @returns {string} the resolved content with the conditional blocks restored
 */
function restoreEnvGithubConditionals(resolved, conditionals) {
  conditionals.forEach((conditional, index) => {
    resolved = resolved.replace(`// asciireq-publish:keep-index:${index}\n`, conditional);
  });
  return resolved;
}

/**
 * Resolves the include directives of the given source file into a
 * self-contained AsciiDoc document: the `env-github` conditional blocks are
 * kept unevaluated (see {@link protectEnvGithubConditionals}), includes are
 * resolved with asciidoctor's `PreprocessorReader`, and the `leveloffset`
 * markers are applied to the section titles (see {@link applyLevelOffsets}).
 *
 * @param {string} fileName - the source file name, relative to `src/`
 * @returns {string} the published, self-contained content
 * @throws {Error} if an include directive could not be resolved
 */
function resolveIncludes(fileName) {
  const docfile = path.join(srcDir, fileName);
  const { protectedContent, conditionals } = protectEnvGithubConditionals(
    fs.readFileSync(docfile, 'utf8')
  );
  const doc = asciidoctor.load('= placeholder\n', {
    safe: 'safe',
    base_dir: srcDir,
  });
  const cursor = asciidoctor.Reader.Cursor.$new(docfile, srcDir);
  const reader = asciidoctor.PreprocessorReader.$new(doc, protectedContent, cursor);
  const lines = [];
  while (reader.hasMoreLines()) {
    lines.push(reader.readLine());
  }
  // readLine() strips line terminators, so the join has no final newline:
  // add it back so that the published file ends with exactly one newline.
  let resolved = applyLevelOffsets(lines).join('\n') + '\n';
  resolved = restoreEnvGithubConditionals(resolved, conditionals);
  if (/^include::/m.test(resolved)) {
    throw new Error(`Unresolved include directive left in ${fileName}`);
  }
  return resolved;
}

/**
 * Applies the `:leveloffset:` markers emitted by the preprocessor around
 * included files to the section titles, so that the published file is
 * self-contained with the final title levels (and contains no marker).
 *
 * @param {string[]} lines - the preprocessed lines, with `:leveloffset:` markers
 * @returns {string[]} the lines with final title levels, without markers
 */
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

/**
 * Loads the AsciiReq reference definitions (`.req-ref` items) from
 * `src/references.adoc`, as a map of anchor to `{ url, title }`, where `url`
 * is the first URL found in the reference body and `title` its title.
 *
 * @returns {Object<string, {url: string, title: string}>} the references by anchor
 */
function loadReferences() {
  const content = fs.readFileSync(path.join(srcDir, 'references.adoc'), 'utf8');
  const references = {};
  const referenceRe = /\[#([A-Z0-9-]+), reftext="[^"]*", \.req-ref\]\n[A-Z0-9-]+:: _([^_]+)_\n\+\n--\n([\s\S]*?)\n--/g;
  let m;
  while ((m = referenceRe.exec(content)) !== null) {
    const urlMatch = m[3].match(/https?:\/\/[^\s]+/);
    references[m[1]] = {
      url: urlMatch ? urlMatch[0].replace(/[.,;:)]+$/, '') : '',
      title: m[2],
    };
  }
  return references;
}

/**
 * Replaces the AsciiReq cross-references (`<<ANCHOR>>` or `<<ANCHOR, text>>`)
 * of the given content with AsciiDoc `link:...` directives, using the
 * reference definitions loaded from `references.adoc`. Cross-references to
 * unknown anchors are left unchanged.
 *
 * @param {string} content - the resolved AsciiDoc content
 * @param {Object<string, {url: string, title: string}>} references - the references by anchor
 * @returns {string} the content with resolved cross-references
 */
function resolveAsciiReqReferences(content, references) {
  return content.replace(/<<([A-Z0-9-]+)(?:,([^>]+))?>>/g, (match, anchor, text) => {
    const reference = references[anchor];
    if (!reference || !reference.url) {
      return match;
    }
    const label = text !== undefined ? text.trim() : reference.title;
    return `link:${reference.url}[${label}]`;
  });
}

/**
 * Reads the AsciiReq specification version from the `VERSION` file at the
 * repository root: the single source of truth for the document version, so
 * that the `src/` files never hardcode it.
 *
 * @returns {string} the trimmed version, e.g. `0.1.1`
 */
function loadVersion() {
  return fs.readFileSync(versionFile, 'utf8').trim();
}

/**
 * Returns the current date in ISO `YYYY-MM-DD` format, used as the `:revdate:`
 * value of the published documents.
 *
 * @returns {string} the current date
 */
function currentDate() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Stamps the revision information into the header of a published document:
 * drops any existing `:revnumber:` / `:revdate:` attribute entries from the
 * given content, then inserts `:revnumber: <version>` and `:revdate: <date>`
 * right after the document title. The published file thus always carries the
 * version of the `VERSION` file and the date of the publication run.
 *
 * @param {string} content - the resolved AsciiDoc content
 * @param {string} version - the version read from the `VERSION` file
 * @param {string} revdate - the current date, in ISO `YYYY-MM-DD` format
 * @returns {string} the content with the revision attributes set in the header
 * @throws {Error} if the content has no document title
 */
function applyRevisionInfo(content, version, revdate) {
  const lines = content
    .split('\n')
    .filter((line) => !/^:(?:revnumber|revdate):/.test(line));
  const titleIndex = lines.findIndex((line) => /^= /.test(line));
  if (titleIndex === -1) {
    throw new Error('No document title found to attach the revision attributes to');
  }
  lines.splice(titleIndex + 1, 0, `:revnumber: ${version}`, `:revdate: ${revdate}`);
  return lines.join('\n');
}

const references = loadReferences();
const version = loadVersion();
const revdate = currentDate();

for (const fileName of publishedFiles) {
  let content = resolveIncludes(fileName);
  // README.adoc does not include references.adoc: resolve its AsciiReq
  // cross-references into link:... directives so that it renders standalone.
  if (fileName === 'README.adoc') {
    content = resolveAsciiReqReferences(content, references);
  }
  content = applyRevisionInfo(content, version, revdate);
  fs.writeFileSync(path.join(rootDir, fileName), content);
  console.log(`published ${fileName} (version ${version}, date ${revdate})`);
}
