// <script> entry: registers <md-pages-viewer> and sets window.MdPagesViewer.

import { defineElement } from './element.js';
import { MdPagesViewer } from './viewer.js';

defineElement();

window.MdPagesViewer = MdPagesViewer;
