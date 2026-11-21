// テスト用の Mermaid の代わり（本物と同じ initialize・render を持つ）。読み込まれた回数・設定・描いた図を window.__mermaid に残す。
// 描く図は、1行目と色（theme）を書いた SVG。<style> と、サニタイズで消えるはずのもの（onerror の img・script）を含む。
// 本文に「error」とある図は描けずにエラーにする。window.__mermaidWait に Promise を入れると、描くのをそれまで待つ。

const log = (window.__mermaid ??= { loads: 0, settings: [], renders: [] });
log.loads += 1;
let settings = {};

const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export default {
  initialize(value) {
    settings = value;
    log.settings.push(value);
  },
  async render(id, text) {
    if (window.__mermaidWait) await window.__mermaidWait;
    log.renders.push({ id, text, theme: settings.theme });
    if (text.includes('error')) throw new Error('Parse error on line 2');
    const first = escape(text.split('\n')[0].trim());
    return {
      svg:
        `<svg id="${id}" xmlns="http://www.w3.org/2000/svg" width="320" height="60" data-theme="${settings.theme}" role="graphics-document document" aria-roledescription="flowchart-v2">` +
        `<style>#${id} .label { fill: rgb(1, 2, 3); }</style>` +
        `<text class="label" x="10" y="30">${first}</text>` +
        `<foreignObject x="10" y="35" width="200" height="20"><div xmlns="http://www.w3.org/1999/xhtml"><span class="node-label">${first}</span><img src="x" onerror="window.__ran = true"></div></foreignObject>` +
        `<script>window.__ran = true</script>` +
        `</svg>`,
    };
  },
};
