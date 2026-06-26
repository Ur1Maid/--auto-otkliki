---
name: hh-chatik-inline-not-iframe
confidence: 0.9
created: 2026-06-26
tags: [playwright, hh-ru, chat, messages, selectors]
---

# Action
hh.ru chat (chatik) renders **inline on https://hh.ru/chat**, NOT in a cross-origin
iframe. To reach it: `page.goto('https://hh.ru/chat')`, wait for hydration, then check
`page.locator('[data-qa="chatik-layout"]')` directly — if visible, operate on `page`
itself (no frame). `getChatFrame` in `src/messages.js` does this inline-first, with the
old `iframe.chatik-integration-iframe` path kept only as legacy fallback.

# Evidence
Live DOM (account belonogov, 2026-06-26) on /chat: `data-qa="chatik-layout"`,
`data-qa^="chatik-open-chat-<id>"` (one per thread), `chat-cell-meta`,
`chatik-info-badges` are all in the **page DOM directly**; there is **no**
`iframe.chatik-integration-iframe` and no `chatik.hh.ru` frame (chatik.hh.ru 301s to
/chat). The old code assumed an iframe → `getChatFrame` returned null → the daemon's
POLL_MESSAGES pass found 0 threads even though 11 were unread. The CHAT_SELECTORS were
correct; only the frame-access assumption + missing navigation were stale.

# Examples
```js
await page.goto('https://hh.ru/chat', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
const inline = await page.locator('[data-qa="chatik-layout"]').first().isVisible().catch(() => false);
const frame = inline ? page : /* legacy iframe fallback */ null;
```
A `Page` supports `.locator`/`.click`/`.innerHTML`/`.frames`, so returning `page`
in place of a `Frame` is drop-in for the chat code. See [[hh-selectors-text-based]] and
[[hh-data-qa-may-be-multivalue]] — same theme: verify the access path against live DOM,
a passing mock-based unit test does not prove the live flow works.
