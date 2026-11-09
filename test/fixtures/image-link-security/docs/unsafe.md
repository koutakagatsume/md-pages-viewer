# 危険な本文

<script>window.__xssScript = 1</script>

<img id="evil-img" src="/test/fixtures/image-link-security/img/pic.svg" onload="window.__xssOnload = 1" onerror="window.__xssOnerror = 1" alt="画像">

<img id="broken-img" src="/test/fixtures/image-link-security/img/none.png" onerror="window.__xssOnerror2 = 1" alt="壊れた画像">

<div id="click-div" onclick="window.__xssOnclick = 1" onmouseover="window.__xssOnmouseover = 1">クリックする場所</div>

[mdのjavascriptリンク](javascript:window.__xssMdLink=1)

<a id="html-js" href="javascript:window.__xssHtmlLink=1">HTMLのjavascriptリンク</a>

<a id="mixed-js" href="JaVaScRiPt:window.__xssMixed=1">大文字小文字混在のjavascriptリンク</a>

<style>.mpv-sidebar { display: none !important; } .mpv-content h1 { color: rgb(255, 0, 0) !important; }</style>

<p id="rest-of-body">残りの本文</p>
