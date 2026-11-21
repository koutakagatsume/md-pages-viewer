// Code blocks coloured by their language (spec 5.4): highlight.js, with
// only its core and the languages manuals use most bundled (their aliases,
// such as js, ts, html, sh, yml, md, py, cs, rb and ps1, work too).

import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

for (const [name, language] of Object.entries({ bash, csharp, css, diff, go, ini, java, javascript, json, markdown, php, powershell, python, ruby, shell, sql, typescript, xml, yaml })) hljs.registerLanguage(name, language);

/**
 * The code coloured, as HTML: its text escaped, in spans with hljs-* classes.
 * Null for a language not bundled here (and for none).
 * @param {string} code
 * @param {string | undefined} language
 * @returns {string | null}
 */
export function highlightCode(code, language) {
  if (!language || !hljs.getLanguage(language)) return null;
  return hljs.highlight(code, { language, ignoreIllegals: true }).value;
}
