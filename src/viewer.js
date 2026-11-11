// `new MdPagesViewer(target, options)` (spec 5.6): creates the element,
// sets every option, then puts it into the target.

import { TAG, defineElement } from './element.js';

const OPTION_KEYS = ['pages', 'currentId', 'baseUrl', 'imageResolver', 'fetch', 'urlParam', 'styles', 'locale', 'texts'];

export class MdPagesViewer {
  /**
   * @param {Element|string} target element or selector; its content is replaced
   * @param {{pages?: object[]|string, currentId?: string|number, baseUrl?: string,
   *   imageResolver?: (path: string, page: object) => string,
   *   fetch?: typeof fetch, urlParam?: string|false, styles?: string,
   *   locale?: string, texts?: object}} [options]
   */
  constructor(target, options = {}) {
    defineElement();
    const container = typeof target === 'string' ? document.querySelector(target) : target;
    if (!(container instanceof Element)) {
      throw new Error(`${TAG}: no element matches ${typeof target === 'string' ? `"${target}"` : 'the given target'}.`);
    }
    const element = document.createElement(TAG);
    element.style.display = 'block';
    // The element takes the target's height; with no height on the target,
    // height:100% computes to auto and it grows with the body. Quirks mode
    // resolves that 100% against the viewport instead, so there the target
    // is measured (see fitHeightInQuirksMode).
    const quirks = document.compatMode === 'BackCompat';
    if (!quirks) element.style.height = '100%';
    for (const key of OPTION_KEYS) {
      if (key in options) element[key] = options[key];
    }
    container.replaceChildren(element);
    if (quirks) fitHeightInQuirksMode(container, element);
    /** The created <md-pages-viewer>. Change options through its properties. */
    this.element = element;
  }
}

/** Gives the element height:100% only while the target has a height of its own. */
function fitHeightInQuirksMode(container, element) {
  const update = () => {
    element.style.display = 'none';
    const style = getComputedStyle(container);
    const inner = container.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    element.style.display = 'block';
    element.style.height = inner > 0 ? '100%' : '';
  };
  update();
  new ResizeObserver(update).observe(container);
}
