// User-side code of a bundled project (spec 8, npm install).
import { MdPagesViewer } from 'md-pages-viewer';

const pages = [
  { id: 'a', parentId: null, title: 'ページA', order: 1, md: '# ページA\n\n## 見出しA\n\n本文' },
  { id: 'b', parentId: 'a', title: 'ページB', order: 1, md: '# ページB\n\n## 見出しB\n\n本文' },
];

// Importing registers the tag.
window.__npm = { definedAfterImport: !!customElements.get('md-pages-viewer') };

document.getElementById('by-tag').pages = pages;
const viewer = new MdPagesViewer('#by-new', { pages, currentId: 'b', urlParam: false });
window.__npm.element = viewer.element instanceof HTMLElement;
