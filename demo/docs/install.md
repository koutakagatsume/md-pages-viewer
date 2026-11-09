# 組み込み方

## スクリプトを読み込む

CDNから読み込む場合は、`<head>` などに次の1行を書きます。

```html
<script src="https://cdn.jsdelivr.net/npm/md-pages-viewer@1/dist/md-pages-viewer.js"></script>
```

外部のCDNに接続できない環境では、`md-pages-viewer.js` を自分のサーバーに置いて読み込みます。

## タグで置く

```html
<md-pages-viewer pages="/api/manual/pages" current-id="intro"></md-pages-viewer>
```

関数や配列はJSで要素のプロパティに設定します。

```js
const viewer = document.querySelector('md-pages-viewer');
viewer.imageResolver = (path) => `/api/manual/image?path=${encodeURIComponent(path)}`;
```

## new で作る

```js
const viewer = new MdPagesViewer('#manual', {
  pages: '/api/manual/pages',
  currentId: 'intro',
});
viewer.element.currentId = 'faq'; // 表示後の変更は element のプロパティで
```

## npm でインストールする

```js
import { MdPagesViewer } from 'md-pages-viewer';
```

`import` するだけで `<md-pages-viewer>` タグも使えるようになります。
