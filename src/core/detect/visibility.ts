/**
 * Visibility and honeypot detection.
 *
 * Filling an invisible trap is the one failure mode that silently gets an
 * application rejected -- the user never finds out. Password managers already
 * trip these and get legitimate users flagged as bots.
 *
 * Every check runs immediately before a write rather than at scan time, so
 * CSS applied after our scan cannot fool us.
 */

/** Names that are almost always a trap when the field is also hidden. */
const TRAP_NAMES = [
  'url', 'website', 'homepage', 'fax', 'nickname', 'comment', 'comments',
  'hp', 'honey', 'honeypot', 'winnie', 'bait', 'spam', 'confirm_email_address',
];

/** A Mailchimp-style bot trap: `b_<id>_<id>`. */
const MAILCHIMP_TRAP = /^b_[0-9a-f]+_[0-9a-f]+$/i;

export interface VisibilityResult {
  visible: boolean;
  /** Set when the element looks deliberately hidden to catch bots. */
  honeypot: boolean;
  reason?: string;
}

function hiddenAncestor(el: Element): string | undefined {
  let node: Element | null = el;
  while (node && node !== document.documentElement) {
    const style = getComputedStyle(node);
    // getComputedStyle, not el.style: honeypots routinely hide via an
    // external stylesheet and a class name.
    if (style.display === 'none') return 'ancestor display:none';
    if (style.visibility === 'hidden' || style.visibility === 'collapse') {
      return 'ancestor visibility:hidden';
    }
    if (Number(style.opacity) === 0) return 'ancestor opacity:0';
    if (style.contentVisibility === 'hidden') return 'ancestor content-visibility:hidden';
    if (node.hasAttribute('hidden')) return 'ancestor [hidden]';
    if (node.hasAttribute('inert')) return 'ancestor [inert]';
    if (node.getAttribute('aria-hidden') === 'true') return 'ancestor aria-hidden';
    // The sr-only clip pattern, used by both accessibility helpers and traps.
    if (style.clipPath === 'inset(100%)' || style.clip === 'rect(1px, 1px, 1px, 1px)') {
      return 'ancestor clipped';
    }
    node = node.parentElement;
  }
  return undefined;
}

export function assessVisibility(el: HTMLElement): VisibilityResult {
  if (el instanceof HTMLInputElement && el.type === 'hidden') {
    return { visible: false, honeypot: true, reason: 'type=hidden' };
  }

  const hidden = hiddenAncestor(el);
  const rect = el.getBoundingClientRect();

  // Not `> 0`: one-pixel traps are common.
  const tooSmall = rect.width < 2 || rect.height < 2;

  // Pushed off-canvas, the classic `left: -9999px`.
  const offscreen =
    rect.left < -500 ||
    rect.top < -500 ||
    rect.left > document.documentElement.scrollWidth + 500;

  const name = (el.getAttribute('name') ?? '').toLowerCase();
  const suspiciousName =
    TRAP_NAMES.includes(name) || MAILCHIMP_TRAP.test(name);

  // A negative tabindex on an otherwise focusable input is a signal, but not
  // proof -- some genuine custom widgets use it. It only counts alongside
  // another indicator.
  const unfocusable = el.getAttribute('tabindex') === '-1';

  if (hidden || tooSmall || offscreen) {
    // Hidden *and* carrying a trap signal: treat as a honeypot we must never
    // write to. Hidden alone may just be a collapsed accordion or an
    // inactive wizard step, which can become fillable later.
    const trap =
      suspiciousName ||
      unfocusable ||
      el.getAttribute('autocomplete') === 'off' && suspiciousName;

    return {
      visible: false,
      honeypot: trap,
      reason: hidden ?? (tooSmall ? 'zero size' : 'offscreen'),
    };
  }

  // Covered by an overlay: the element occupies space but something else is
  // painted on top of it.
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  if (cx >= 0 && cy >= 0 && cx <= innerWidth && cy <= innerHeight) {
    const atPoint = document.elementFromPoint(cx, cy);
    if (atPoint && atPoint !== el && !el.contains(atPoint) && !atPoint.contains(el)) {
      return { visible: false, honeypot: false, reason: 'covered by another element' };
    }
  }

  return { visible: true, honeypot: false };
}

/** True when the element must never be written to, whatever else we decide. */
export function isHoneypot(el: HTMLElement): boolean {
  return assessVisibility(el).honeypot;
}
