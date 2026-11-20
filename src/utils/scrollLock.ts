let lockCount = 0;
let savedBodyOverflow = '';
let savedHtmlOverflow = '';

/**
 * Ref-counted body scroll lock so stacked modals/drawers never leak scroll
 * events to the background page on desktop or mobile browsers.
 */
export function lockBodyScroll(): () => void {
  if (typeof document === 'undefined') return () => {};

  if (lockCount === 0) {
    savedBodyOverflow = document.body.style.overflow;
    savedHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
  }
  lockCount += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) {
      document.body.style.overflow = savedBodyOverflow;
      document.documentElement.style.overflow = savedHtmlOverflow;
    }
  };
}
