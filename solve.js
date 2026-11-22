// Fast drop-in for makefun-site 1.0.0 (site-generator-speed-01-run-20261122).
// Same answers as the reference, byte for byte; written for speed:
// hand-scanned single-pass Markdown inline rendering, bulk HTML escaping,
// ASCII fast paths for slugs, and templates compiled once per case into
// plain JS render functions. No dependencies, no I/O, no caching across cases.

// ---------------------------------------------------------------- text

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESC_RE = /[&<>"']/g;

/** `text` with & < > " and ' escaped. */
function escapeHtml(text) {
  return text.replace(ESC_RE, (c) => ESCAPES[c]);
}

const SLUG_MAX = 64;
const NON_ASCII = /[^\x00-\x7F]/;
const MARKS = /\p{M}/gu;

/** The slug of `text` (README.md, "Text"). */
function slugify(text) {
  if (!NON_ASCII.test(text)) {
    // ASCII: NFKD is the identity and there are no combining marks.
    let out = '';
    let gap = false;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      let keep = -1;
      if (c >= 65 && c <= 90) keep = c + 32;
      else if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) keep = c;
      if (keep === -1) {
        gap = out.length > 0;
        continue;
      }
      if (gap) out += '-';
      gap = false;
      out += String.fromCharCode(keep);
    }
    out = out.slice(0, SLUG_MAX).replace(/-+$/, '');
    return out === '' ? 'untitled' : out;
  }
  const plain = text.normalize('NFKD').replace(MARKS, '');
  let out = '';
  let gap = false;
  for (const ch of plain) {
    let keep = null;
    if (ch >= 'A' && ch <= 'Z') keep = ch.toLowerCase();
    else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) keep = ch;
    if (keep === null) {
      gap = out.length > 0;
      continue;
    }
    if (gap) out += '-';
    gap = false;
    out += keep;
  }
  out = out.slice(0, SLUG_MAX).replace(/-+$/, '');
  return out === '' ? 'untitled' : out;
}

/** `slug` made unique against `taken` (and added to it). */
function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A YYYY-MM-DD date in words, from the string alone. */
function longDate(date) {
  return `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
}

/** Code-unit order (never the locale's). */
const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/** Whitespace per JavaScript \s, as a table for code units below 256. */
const WS = new Uint8Array(256);
for (const c of [9, 10, 11, 12, 13, 32]) WS[c] = 1;

/** Whether code unit `c` is whitespace (JS \s). */
function isWs(c) {
  if (c < 256) return WS[c] === 1;
  return c === 0xA0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200A) || c === 0x2028 || c === 0x2029 || c === 0x202F || c === 0x205F || c === 0x3000 || c === 0xFEFF;
}

/** The words of a body: its runs of characters other than whitespace. */
function wordsOf(text) {
  let n = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    if (isWs(text.charCodeAt(i))) inWord = false;
    else if (!inWord) {
      inWord = true;
      n++;
    }
  }
  return n;
}

/** `rel` from the directory `dir` of a source, or null when it climbs out of the root. */
function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

// ---------------------------------------------------------------- front matter

const KEYS = ['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary'];
const LINE = /^([a-z_]+):(?: (.*))?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAME = /^[a-z0-9-]+$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG = /^[^"[\]]+$/;

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function stringOf(raw) {
  if (raw.startsWith('"')) {
    if (raw.length < 2 || !raw.endsWith('"')) return { error: 'a quoted string is not closed' };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += n;
        i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw.startsWith('[')) return { error: 'a bare string opens on [' };
  return { value: raw };
}

function valueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return 'error' in s ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date': {
      const m = DATE.exec(raw);
      const y = m ? Number(m[1]) : 0;
      const mo = m ? Number(m[2]) : 0;
      const d = m ? Number(m[3]) : 0;
      if (!m || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      return { value: raw };
    }
    case 'tags': {
      if (!raw.startsWith('[') || !raw.endsWith(']')) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',').map((t) => t.trim());
      if (tags.some((t) => t === '' || !TAG.test(t))) return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout':
      return NAME.test(raw) ? { value: raw } : { error: 'key "layout": not a template name' };
    case 'slug':
      return SLUG.test(raw) && raw.length <= 64 ? { value: raw } : { error: 'key "slug": not a slug' };
    default:
      return { error: `unknown key "${key}"` };
  }
}

/**
 * A source's front matter and body: { data, body }, or { error }.
 * `text` has "\n" line ends. Scanned by line offsets, no whole-text split.
 */
function parseFrontMatter(text) {
  let eol = text.indexOf('\n');
  if (eol === -1) eol = text.length;
  if (text.slice(0, eol) !== '---') return { error: 'no front matter' };
  // Find the closing --- line; collect the lines between.
  let lineStart = eol === text.length ? text.length : eol + 1;
  let idx = 1;
  let closeEnd = -1;
  const fm = [];
  for (;;) {
    let e = text.indexOf('\n', lineStart);
    if (e === -1) e = text.length;
    if (text.slice(lineStart, e) === '---') {
      closeEnd = e;
      break;
    }
    fm.push({ start: lineStart, end: e, idx });
    if (e === text.length) break;
    lineStart = e + 1;
    idx++;
  }
  if (closeEnd === -1) return { error: 'the front matter is not closed' };
  const data = {};
  for (const f of fm) {
    const line = text.slice(f.start, f.end);
    if (/^[ \t]*$/.test(line) || line.startsWith('#')) continue;
    const m = LINE.exec(line);
    if (!m) return { error: `line ${f.idx + 1} is not "key: value"` };
    const key = m[1];
    const raw = (m[2] ?? '').replace(/[ \t]+$/, '');
    if (!KEYS.includes(key)) return { error: `unknown key "${key}"` };
    if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
    if (raw === '') return { error: `key "${key}" has no value` };
    const v = valueOf(key, raw);
    if ('error' in v) return v;
    data[key] = v.value;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  return { data, body: closeEnd === text.length ? '' : text.slice(closeEnd + 1) };
}

// ---------------------------------------------------------------- markdown

/** Char codes a backslash escapes: \ ` * _ [ ] ( ) # + - . ! > */
const ESC_CC = new Uint8Array(128);
for (const c of [92, 96, 42, 95, 91, 93, 40, 41, 35, 43, 45, 46, 33, 62]) ESC_CC[c] = 1;

function isBlank(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** Fence open: the language, or null. /^```([A-Za-z0-9_+-]*)[ \t]*$/ */
function fenceOpen(line) {
  if (line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return null;
  let i = 3;
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 43 || c === 45) i++;
    else break;
  }
  for (let j = i; j < line.length; j++) {
    const c = line.charCodeAt(j);
    if (c !== 32 && c !== 9) return null;
  }
  return line.slice(3, i);
}

/** Fence close: /^```[ \t]*$/ */
function isFenceClose(line) {
  if (line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return false;
  for (let i = 3; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** A heading line's level and text, or null. */
function headingOf(line) {
  let k = 0;
  while (k < 6 && line.charCodeAt(k) === 35) k++;
  if (k === 0) return null;
  const c = line.charCodeAt(k);
  if (c !== 32 && c !== 9) return null;
  let a = k;
  while (a < line.length && (line.charCodeAt(a) === 32 || line.charCodeAt(a) === 9)) a++;
  let b = line.length;
  while (b > a && (line.charCodeAt(b - 1) === 32 || line.charCodeAt(b - 1) === 9)) b--;
  if (b === a) return null;
  return { depth: k, text: line.slice(a, b) };
}

/** Thematic break: /^---|\*\*\*[ \t]*$/ */
function isHr(line) {
  const c0 = line.charCodeAt(0);
  if (c0 !== 45 && c0 !== 42) return false;
  if (line.charCodeAt(1) !== c0 || line.charCodeAt(2) !== c0) return false;
  for (let i = 3; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** Bullet item: /^[-*] (.*)$/ -> the rest, or null. */
function bulletOf(line) {
  const c0 = line.charCodeAt(0);
  if ((c0 === 45 || c0 === 42) && line.charCodeAt(1) === 32) return line.slice(2);
  return null;
}

/** Ordered item: /^(\d{1,9})\. (.*)$/ -> { num, text }, or null. */
function orderedOf(line) {
  let d = 0;
  while (d < 10 && line.charCodeAt(d) >= 48 && line.charCodeAt(d) <= 57) d++;
  if (d === 0 || d > 9) return null;
  if (line.charCodeAt(d) !== 46 || line.charCodeAt(d + 1) !== 32) return null;
  return { num: line.slice(0, d), text: line.slice(d + 2) };
}

/** A list continuation line: /^ {2,}\S/ */
function isContinued(line) {
  if (line.charCodeAt(0) !== 32 || line.charCodeAt(1) !== 32) return false;
  let i = 2;
  while (line.charCodeAt(i) === 32) i++;
  if (i >= line.length) return false;
  const c = line.charCodeAt(i);
  return c !== 32 && c !== 9 && c !== 11 && c !== 12 && c !== 13;
}

/** Whether `line` ends a paragraph. */
function endsParagraph(line) {
  return isBlank(line) || fenceOpen(line) !== null || headingOf(line) !== null || isHr(line);
}

/** A line with spaces and tabs at either end dropped. */
function trimLine(line) {
  let a = 0;
  let b = line.length;
  while (a < b && (line.charCodeAt(a) === 32 || line.charCodeAt(a) === 9)) a++;
  while (b > a && (line.charCodeAt(b - 1) === 32 || line.charCodeAt(b - 1) === 9)) b--;
  return a === 0 && b === line.length ? line : line.slice(a, b);
}

/** The first index from `from` where `s` holds `what` outside a backslash escape, or -1. */
function findUnescaped(s, what, from) {
  const last = s.length - what.length;
  for (let j = from; j <= last; j++) {
    if (s.charCodeAt(j) === 92 && j + 1 < s.length && ESC_CC[s.charCodeAt(j + 1)] === 1) {
      j++;
      continue;
    }
    if (s.startsWith(what, j)) return j;
  }
  return -1;
}

/** The first single * from `from` (one whose run is not **), outside an escape, or -1. */
function findSingleStar(s, from) {
  for (let j = from; j < s.length; j++) {
    const c = s.charCodeAt(j);
    if (c === 92 && j + 1 < s.length && ESC_CC[s.charCodeAt(j + 1)] === 1) {
      j++;
      continue;
    }
    if (c !== 42) continue;
    if (s.charCodeAt(j + 1) === 42) {
      j++;
      continue;
    }
    return j;
  }
  return -1;
}

/**
 * `s` rendered inline into `out` (an array of strings); `link(target)` is a link's href.
 * A single global regex finds the next structural character (\, `, *, [) in C++;
 * the plain text between them is flushed in bulk through escapeHtml, so
 * ordinary text costs regex scans, not one JS step per character.
 */
const STRUCT = /[\\`*\[]/g;

function inlineInto(s, link, out) {
  const n = s.length;
  let i = 0; // scan cursor
  let start = 0; // current plain-run start
  for (;;) {
    STRUCT.lastIndex = i;
    const m = STRUCT.exec(s);
    const j = m === null ? n : m.index;
    if (m === null) {
      if (start < n) out.push(escapeHtml(s.slice(start, n)));
      return;
    }
    const c = s.charCodeAt(j);
    if (c === 92) {
      if (j + 1 < n && ESC_CC[s.charCodeAt(j + 1)] === 1) {
        if (start < j) out.push(escapeHtml(s.slice(start, j)));
        const e = s.charCodeAt(j + 1);
        out.push(e === 62 ? '&gt;' : s[j + 1]);
        i = j + 2;
        start = i;
      } else {
        i = j + 1; // a backslash that escapes nothing stays in the run
      }
      continue;
    }
    if (c === 96) {
      const k = s.indexOf('`', j + 1);
      if (k > j + 1) {
        if (start < j) out.push(escapeHtml(s.slice(start, j)));
        out.push('<code>', escapeHtml(s.slice(j + 1, k)), '</code>');
        i = k + 1;
        start = i;
      } else i = j + 1;
      continue;
    }
    if (c === 42) {
      if (s.charCodeAt(j + 1) === 42) {
        const k = findUnescaped(s, '**', j + 2);
        if (k > j + 2) {
          if (start < j) out.push(escapeHtml(s.slice(start, j)));
          out.push('<strong>');
          inlineInto(s.slice(j + 2, k), link, out);
          out.push('</strong>');
          i = k + 2;
          start = i;
        } else i = j + 2;
        continue;
      }
      const k = findSingleStar(s, j + 1);
      if (k > j + 1) {
        if (start < j) out.push(escapeHtml(s.slice(start, j)));
        out.push('<em>');
        inlineInto(s.slice(j + 1, k), link, out);
        out.push('</em>');
        i = k + 1;
        start = i;
      } else i = j + 1;
      continue;
    }
    // '['
    const k = findUnescaped(s, ']', j + 1);
    const mm = k !== -1 && s.charCodeAt(k + 1) === 40 ? s.indexOf(')', k + 2) : -1;
    const target = mm === -1 ? '' : s.slice(k + 2, mm);
    if (target !== '' && !/\s/.test(target)) {
      if (start < j) out.push(escapeHtml(s.slice(start, j)));
      out.push('<a href="', escapeHtml(link(target)), '">');
      inlineInto(s.slice(j + 1, k), link, out);
      out.push('</a>');
      i = mm + 1;
      start = i;
      continue;
    }
    i = j + 1;
  }
}

/** `src` rendered: its HTML, its table of contents and its excerpt. */
function renderMarkdown(src, link) {
  const lines = src.split('\n');
  const ids = new Set();
  const out = [];
  const toc = [];
  let excerpt = null;
  let i = 0;
  const n = lines.length;
  while (i < n) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    const lang = fenceOpen(line);
    if (lang !== null) {
      const body = [];
      i++;
      while (i < n && !isFenceClose(lines[i])) body.push(lines[i++]);
      i++;
      out.push('<pre><code' + (lang === '' ? '' : ` class="language-${escapeHtml(lang)}"`) + '>');
      if (body.length !== 0) out.push(escapeHtml(body.join('\n')), '\n');
      out.push('</code></pre>\n');
      continue;
    }
    const heading = headingOf(line);
    if (heading !== null) {
      const id = uniqueSlug(slugify(heading.text), ids);
      const inner = [];
      inlineInto(heading.text, link, inner);
      const html = inner.join('');
      out.push(`<h${heading.depth} id="${id}">`, html, `</h${heading.depth}>\n`);
      if (heading.depth === 2 || heading.depth === 3) toc.push({ level: heading.depth, id, html });
      i++;
      continue;
    }
    if (isHr(line)) {
      out.push('<hr>\n');
      i++;
      continue;
    }
    if (line.charCodeAt(0) === 62) {
      const body = [];
      while (i < n && lines[i].charCodeAt(0) === 62) {
        let l = lines[i++];
        l = l.slice(1);
        if (l.charCodeAt(0) === 32) l = l.slice(1);
        body.push(trimLine(l));
      }
      const kept = body.filter((l) => l !== '');
      if (kept.length === 0) out.push('<blockquote>\n</blockquote>\n');
      else {
        const inner = [];
        inlineInto(kept.join('\n'), link, inner);
        out.push('<blockquote>\n<p>', inner.join(''), '</p>\n</blockquote>\n');
      }
      continue;
    }
    const bullet = bulletOf(line);
    const ordered = bullet === null ? orderedOf(line) : null;
    if (bullet !== null || ordered !== null) {
      const isOrdered = ordered !== null;
      const start = isOrdered ? Number(ordered.num) : 1;
      const items = [];
      while (i < n) {
        const l = lines[i];
        if (isOrdered) {
          const m = orderedOf(l);
          if (m !== null) {
            items.push([trimLine(m.text)]);
            i++;
            continue;
          }
        } else {
          const m = bulletOf(l);
          if (m !== null) {
            items.push([trimLine(m)]);
            i++;
            continue;
          }
        }
        if (isContinued(l)) {
          items[items.length - 1].push(trimLine(l));
          i++;
          continue;
        }
        break;
      }
      const tag = isOrdered ? 'ol' : 'ul';
      out.push(isOrdered && start !== 1 ? `<ol start="${start}">\n` : `<${tag}>\n`);
      for (const parts of items) {
        const inner = [];
        inlineInto(parts.join('\n'), link, inner);
        out.push('<li>', inner.join(''), '</li>\n');
      }
      out.push(`</${tag}>\n`);
      continue;
    }
    const body = [trimLine(line)];
    i++;
    while (i < n && !endsParagraph(lines[i])) body.push(trimLine(lines[i++]));
    const inner = [];
    inlineInto(body.join('\n'), link, inner);
    const html = inner.join('');
    if (excerpt === null) excerpt = html;
    out.push('<p>', html, '</p>\n');
  }
  return { html: out.join(''), toc, excerpt: excerpt ?? '' };
}

// ---------------------------------------------------------------- templates

const INCLUDE_DEPTH = 8;
const PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF = /^if (not )?(\S+)$/;
const INCLUDE = /^include "([a-z0-9-]+)"$/;

/** A template that does not parse: its name and why. */
class TemplateError extends Error {}

/** The path `text` names, split at its dots, or a TemplateError. */
function pathOf(name, text) {
  if (!PATH.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

/** `src`'s tokens: text, {{ }}, {{{ }}} and {% %}, a standalone tag's line taken with it. */
function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) {
      text += src.slice(i);
      break;
    }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = /^[ \t]*$/.test(src.slice(lineStart, open)) && /^[ \t]*$/.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

/** `src` parsed into its tree of nodes (a TemplateError when it does not parse). */
function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = FOR.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = IF.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = INCLUDE.exec(tag)) !== null) body.push({ kind: 'include', name: m[1] });
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

/** The value at `path` in the scope chain. */
function L(scope, path) {
  let s = scope;
  while (s !== null && !Object.hasOwn(s.vars, path[0])) s = s.parent;
  if (s === null) return undefined;
  let v = s.vars[path[0]];
  for (let k = 1; k < path.length; k++) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, path[k])) return undefined;
    v = v[path[k]];
  }
  return v;
}

/** A value as text. */
function T(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(T).join(', ');
  return '';
}

/** Whether a value counts as true in an if. */
function U(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

/**
 * The names a template reads from its caller's scope, transitively through
 * includes (names bound by its own fors excluded). Computed to a fixpoint so
 * cyclic includes converge. A name read only inside a for body counts as
 * bound there, not as a dependency.
 */
function collectDeps(nodes, bound, dep, trees, deps) {
  for (const n of nodes) {
    if (n.kind === 'text') continue;
    if (n.kind === 'var' || n.kind === 'raw') {
      if (!bound.has(n.path[0])) dep.add(n.path[0]);
    } else if (n.kind === 'if') {
      if (!bound.has(n.path[0])) dep.add(n.path[0]);
      collectDeps(n.then, bound, dep, trees, deps);
      if (n.else !== null) collectDeps(n.else, bound, dep, trees, deps);
    } else if (n.kind === 'for') {
      if (!bound.has(n.path[0])) dep.add(n.path[0]);
      const b2 = new Set(bound);
      b2.add(n.name);
      b2.add('loop');
      collectDeps(n.body, b2, dep, trees, deps);
    } else if (n.kind === 'include') {
      const d = deps.get(n.name);
      if (d !== undefined) for (const x of d) if (!bound.has(x)) dep.add(x);
    }
  }
}

function computeDeps(trees) {
  const deps = new Map();
  for (const name of trees.keys()) deps.set(name, new Set());
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 64) {
    changed = false;
    for (const [name, nodes] of trees) {
      const dep = deps.get(name);
      const before = dep.size;
      collectDeps(nodes, new Set(), dep, trees, deps);
      if (dep.size !== before) changed = true;
    }
  }
  return deps;
}

/** Every for-variable name (and `loop`) anywhere in the case's templates. */
function collectShadow(trees) {
  const out = new Set(['loop']);
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.kind === 'for') {
        out.add(n.name);
        walk(n.body);
      } else if (n.kind === 'if') {
        walk(n.then);
        if (n.else !== null) walk(n.else);
      }
    }
  };
  for (const nodes of trees.values()) walk(nodes);
  return out;
}

const CONST_NAMES = new Set(['site', 'tags', 'recent']);

/**
 * Compile a parsed template tree into a render function
 * (scope, ctx, depth, out) that appends to `out`. Paths are hoisted as
 * constants; loops and ifs become plain JS control flow.
 *
 * Includes are memoised when provably safe: a template whose dependencies
 * are only the per-case constants (site, tags, recent) renders once per
 * (name, depth); one whose only non-constant dependency is a single name
 * bound by an enclosing for renders once per (name, depth, element).
 * Anything else renders normally.
 */
function compileNodes(nodes, decide) {
  const paths = new Map();
  let code = '';
  let uid = 0;
  const pathVar = (path) => {
    const key = path.join('.');
    let v = paths.get(key);
    if (v === undefined) {
      v = `_p${paths.size}`;
      paths.set(key, v);
    }
    return v;
  };
  const gen = (ns, scopeVar, bound) => {
    for (const n of ns) {
      if (n.kind === 'text') code += `out.push(${JSON.stringify(n.text)});\n`;
      else if (n.kind === 'var') code += `out.push(E(T(L(${scopeVar},${pathVar(n.path)}))));\n`;
      else if (n.kind === 'raw') code += `out.push(T(L(${scopeVar},${pathVar(n.path)})));\n`;
      else if (n.kind === 'if') {
        code += `if(U(L(${scopeVar},${pathVar(n.path)}))!==${n.not}){\n`;
        gen(n.then, scopeVar, bound);
        code += '}';
        if (n.else !== null) {
          code += 'else{\n';
          gen(n.else, scopeVar, bound);
          code += '}';
        }
        code += '\n';
      } else if (n.kind === 'for') {
        const u = ++uid;
        const sc = `s${u}`;
        const xs = `x${u}`;
        const k = `k${u}`;
        const nn = `n${u}`;
        code += `{const ${xs}=L(${scopeVar},${pathVar(n.path)});if(Array.isArray(${xs})){for(let ${k}=0,${nn}=${xs}.length;${k}<${nn};${k}++){const ${sc}={vars:{[${JSON.stringify(n.name)}]:${xs}[${k}],loop:{index:${k}+1,first:${k}===0,last:${k}===${nn}-1,length:${nn}}},parent:${scopeVar}};\n`;
        const b2 = new Set(bound);
        b2.add(n.name);
        b2.add('loop');
        gen(n.body, sc, b2);
        code += '}}}\n';
      } else if (n.kind === 'include') {
        const u = ++uid;
        const d = decide(n.name, bound);
        if (d === 'const') {
          code += `{let c${u}=ctx.mcc.get(${JSON.stringify(n.name)}+"|"+depth);if(c${u}===undefined){const o${u}=[];const t${u}=ctx.templates.get(${JSON.stringify(n.name)});if(t${u}!==undefined&&depth<${INCLUDE_DEPTH}){t${u}(${scopeVar},ctx,depth+1,o${u});c${u}=o${u}.join("");}else c${u}="";ctx.mcc.set(${JSON.stringify(n.name)}+"|"+depth,c${u});}out.push(c${u});}\n`;
        } else if (d !== null) {
          code += `{const k${u}=${JSON.stringify(n.name)}+"|"+depth;let m${u}=ctx.mce.get(k${u});if(m${u}===undefined){m${u}=new Map();ctx.mce.set(k${u},m${u});}const x${u}=L(${scopeVar},${pathVar([d])});let c${u}=m${u}.get(x${u});if(c${u}===undefined){const o${u}=[];const t${u}=ctx.templates.get(${JSON.stringify(n.name)});if(t${u}!==undefined&&depth<${INCLUDE_DEPTH}){t${u}(${scopeVar},ctx,depth+1,o${u});c${u}=o${u}.join("");}else c${u}="";m${u}.set(x${u},c${u});}out.push(c${u});}\n`;
        } else {
          code += `{const t=ctx.templates.get(${JSON.stringify(n.name)});if(t!==undefined&&depth<${INCLUDE_DEPTH})t(${scopeVar},ctx,depth+1,out);}\n`;
        }
      }
    }
  };
  gen(nodes, 'scope', new Set());
  let head = '';
  for (const [key, v] of paths) head += `const ${v}=${JSON.stringify(key.split('.'))};\n`;
  const factory = new Function('L', 'T', 'E', 'U', `"use strict";return function(scope,ctx,depth,out){\n${head}${code}};`);
  return factory(L, T, escapeHtml, U);
}

/** Parse + compile one template; a TemplateError when it does not parse. */
function compileTemplate(name, src, decide) {
  return compileNodes(parseTemplate(name, src), decide);
}

/** Render template `name` with `vars`, or null when it is missing. */
function renderTemplate(ctx, name, vars, site, allTags, recent) {
  const fn = ctx.templates.get(name);
  if (fn === undefined) return null;
  const out = [];
  fn({ vars: { site, tags: allTags, recent, ...vars }, parent: null }, ctx, 0, out);
  return out.join('');
}

// ---------------------------------------------------------------- the build

const RESERVED = Object.freeze(['posts', 'tags', 'page']);
const REPORT_FILE = 'build-report.txt';

function linkOf(s) {
  return s === null ? null : { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(s.data.date) };
}

function cardOf(s) {
  return {
    title: s.data.title,
    url: s.url,
    date: s.data.date ?? '',
    date_long: s.data.date === undefined ? '' : longDate(s.data.date),
    summary: s.data.summary ?? '',
    excerpt: s.excerpt,
    reading_minutes: Math.max(1, Math.ceil(wordsOf(s.body) / 200)),
    tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
  };
}

function pageOf(s) {
  return {
    ...s.card,
    slug: s.slug,
    content: s.html,
    toc: s.toc.map((h) => ({ level: h.level, id: h.id, html: h.html })),
    newer: linkOf(s.newer ?? null),
    older: linkOf(s.older ?? null),
    is_post: s.post,
  };
}

/** One site's output tree: path -> text. */
export function run(input) {
  const trees = new Map();
  const report = [];
  for (const name of Object.keys(input.templates).sort(byCodeUnits)) {
    try {
      trees.set(name, parseTemplate(name, input.templates[name]));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }
  const deps = computeDeps(trees);
  const shadow = collectShadow(trees);
  const decide = (target, bound) => {
    const d = deps.get(target);
    if (d === undefined) return 'const'; // a missing template renders "" always
    let nonConst = null;
    let nonConstCount = 0;
    for (const x of d) {
      if (CONST_NAMES.has(x)) {
        if (shadow.has(x)) return null;
      } else {
        nonConst = x;
        nonConstCount++;
      }
    }
    if (nonConstCount === 0) return 'const';
    if (nonConstCount === 1 && bound.has(nonConst)) return nonConst;
    return null;
  };
  const templates = new Map();
  for (const [name, nodes] of trees) templates.set(name, compileNodes(nodes, decide));

  const base = input.site.base_url.replace(/\/+$/, '');

  // 1. Sources, in code-unit order of their paths.
  const files = [...input.files].sort((x, y) => byCodeUnits(x.path, y.path));
  const sources = [];
  const statics = [];
  for (const f of files) {
    if (f.path.endsWith('.md')) {
      const c = f.content;
      sources.push({ path: f.path, text: c.indexOf('\r') === -1 ? c : c.replace(/\r\n?/g, '\n') });
    } else statics.push({ path: f.path, content: f.content });
  }

  // 2. Front matter.
  const kept = [];
  for (const s of sources) {
    const fm = parseFrontMatter(s.text);
    if ('error' in fm) {
      report.push(`refused ${s.path}: ${fm.error}`);
      continue;
    }
    s.data = fm.data;
    s.body = fm.body;
    s.post = s.path.startsWith('posts/');
    const own = RESERVED.find((d) => d !== 'posts' && s.path.startsWith(`${d}/`));
    if (own !== undefined) {
      report.push(`refused ${s.path}: ${own}/ is the generator's own`);
      continue;
    }
    if (s.post && !Object.hasOwn(s.data, 'date')) {
      report.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!templates.has(layout)) {
      report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      report.push(`draft ${s.path}`);
      continue;
    }
    kept.push(s);
  }
  sources.length = 0;
  for (const s of kept) sources.push(s);

  // 3. Permalinks.
  const bySource = new Map();
  const taken = new Map();
  for (const s of sources) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    let set = taken.get(dir);
    if (set === undefined) {
      set = new Set(dir === '' ? RESERVED : []);
      taken.set(dir, set);
    }
    const slug = uniqueSlug(s.data.slug ?? slugify(s.data.title), set);
    s.slug = slug;
    s.outDir = dir === '' ? slug : `${dir}/${slug}`;
    s.url = `${base}/${s.outDir}/`;
    bySource.set(s.path, s);
  }

  // 4. Markdown.
  const staticPaths = new Set(statics.map((f) => f.path));
  const broken = new Set();
  for (const s of sources) {
    const dir = dirOf(s.path);
    const srcPath = s.path;
    const link = (target) => {
      if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target) || target.startsWith('/') || target.startsWith('#')) return target;
      const hash = target.indexOf('#');
      const rel = hash === -1 ? target : target.slice(0, hash);
      const frag = hash === -1 ? '' : target.slice(hash);
      const path = rel === '' ? null : resolvePath(dir, rel);
      if (path !== null && bySource.has(path)) return `${bySource.get(path).url}${frag}`;
      if (path !== null && staticPaths.has(path)) return `${base}/${path}${frag}`;
      broken.add(`broken-link ${srcPath} -> ${target}`);
      return target;
    };
    const md = renderMarkdown(s.body, link);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
  }

  // 5. Collections.
  const posts = sources.filter((s) => s.post);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  posts.forEach((p, k) => {
    p.newer = k === 0 ? null : posts[k - 1];
    p.older = k === posts.length - 1 ? null : posts[k + 1];
  });

  // 6. Tags.
  const ownTags = (s) => {
    const seen = new Set();
    const out = [];
    for (const name of (s.data.tags ?? [])) {
      const slug = slugify(name);
      if (!seen.has(slug)) {
        seen.add(slug);
        out.push(name);
      }
    }
    return out;
  };
  const bySlug = new Map();
  for (const p of posts) {
    p.tagRefs = [];
    for (const name of ownTags(p)) {
      const slug = slugify(name);
      let tag = bySlug.get(slug);
      if (tag === undefined) {
        tag = { name, slug, url: `${base}/tags/${slug}/`, posts: [] };
        bySlug.set(slug, tag);
      }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (const s of sources) {
    if (!s.post) {
      s.tagRefs = ownTags(s).map((name) => {
        const slug = slugify(name);
        return bySlug.get(slug) ?? { name, slug, url: '', posts: [] };
      });
    }
  }
  const tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));

  // 7. Layouts.
  for (const s of sources) s.card = cardOf(s);
  const ctx = { templates, mcc: new Map(), mce: new Map() };
  const site = { title: input.site.title, base_url: base };
  const allTags = tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = posts.slice(0, input.site.recent).map((p) => p.card);
  const output = {};
  for (const s of sources) output[`${s.outDir}/index.html`] = renderTemplate(ctx, s.layout, { page: pageOf(s) }, site, allTags, recent);
  const per = input.site.per_page;
  const pages = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${base}/` : `${base}/page/${k}/`);
  for (let k = 1; k <= pages; k++) {
    const html = renderTemplate(ctx, 'index', {
      posts: posts.slice((k - 1) * per, k * per).map((p) => p.card),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    }, site, allTags, recent);
    if (html !== null) output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }
  for (const t of tags) {
    const html = renderTemplate(ctx, 'tag', { tag: { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => p.card) } }, site, allTags, recent);
    if (html !== null) output[`tags/${t.slug}/index.html`] = html;
  }
  const tagsHtml = renderTemplate(ctx, 'tags', {}, site, allTags, recent);
  if (tagsHtml !== null) output['tags/index.html'] = tagsHtml;
  for (const f of statics) {
    if (Object.hasOwn(output, f.path)) report.push(`shadowed ${f.path}: a built page has its path`);
    else output[f.path] = f.content;
  }

  // 8. The report.
  const lines = [...report, ...broken].sort(byCodeUnits);
  const pageCount = sources.filter((s) => !s.post).length;
  lines.push(`built ${pageCount} pages, ${posts.length} posts, ${tags.length} tags and ${statics.length} static files`);
  output[REPORT_FILE] = `${lines.join('\n')}\n`;
  return output;
}
