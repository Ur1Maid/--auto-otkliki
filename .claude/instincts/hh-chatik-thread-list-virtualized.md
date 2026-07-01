---
name: hh-chatik-thread-list-virtualized
confidence: 0.9
created: 2026-07-01
tags: [playwright, hh-ru, chat, messages, virtualization]
---

# Action
The chatik thread list on `https://hh.ru/chat` is **virtualized** — only ~14 rows exist
in the DOM at once, regardless of how many chats there are. Reading
`[data-qa="chatik-layout"]` innerHTML **once** sees only those ~14 top rows, and the
top rows are often recently-*read* (no `chatik-info-badges` badge) → you wrongly conclude
"0 unread" even with 100+ unread. To enumerate ALL unread:
1. Click the filter checkbox `[data-qa="chatik-checkbox-only-unread"]` — when on, EVERY
   rendered cell is unread (don't rely on the per-cell badge, it can lag render).
2. **Scroll-collect**: repeatedly read+parse the layout, merge snapshots by `chatId`
   (`mergeThreadsById` in `chatParse.js`), scroll the nearest scrollable ancestor of a
   `[data-qa^="chatik-open-chat-"]` cell to the bottom, wait, repeat until the accumulated
   set stops growing (2 stagnant rounds) or the container won't scroll. See
   `collectThreadsScrolling` / `enableOnlyUnreadFilter` in `src/messages.js`.

# Evidence
Read-only live probe (account belonogov, 2026-07-01) on /chat:
- initial load: **14 cells, 0 `chatik-info-badges`** → old `listThreads` → "нет новых
  сообщений" while 100+ were actually unread.
- after scrolling the list: 14→20 cells, 0→6 badges (virtualization confirmed; the
  `chatik-info-badges` selector is still valid, badges just aren't rendered yet up top).
- after clicking `chatik-checkbox-only-unread`: 14 rendered cells, **14/14 unread**.
- after the fix (filter + scroll-collect), collection-only verify run: **153 unread
  threads collected** (was 0). No threads opened (opening a thread marks it read
  server-side), nothing sent.

# Examples
```js
const filterEnabled = await enableOnlyUnreadFilter(frame); // clicks only-unread checkbox
const threads = await collectThreadsScrolling(frame, page); // scroll + mergeThreadsById
const targets = filterEnabled ? threads : threads.filter(t => t.unread === true);
```
Selectors were NOT stale here — the bug was the single-read + virtualization assumption,
same lesson as [[hh-chatik-inline-not-iframe]]: verify the *access pattern* against live
DOM, a passing mock unit test does not prove the live flow. See [[hh-selectors-text-based]].
