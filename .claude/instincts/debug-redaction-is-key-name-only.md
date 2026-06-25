---
name: debug-redaction-is-key-name-only
confidence: 0.9
created: 2026-06-25
tags: [security, logging, deepseek]
---

# Action
`redactSecrets` (src/lib/deepseek.js), used by `appendDeepSeekDebug`, strips debug-entry keys by
NAME only (`/^(api[-_]?key|authorization|bearer|token|secret)$/i`, one level of plain-object
recursion). It does NOT scrub secrets embedded in a VALUE string, nor keys inside arrays-of-objects.
So: never put a raw request (headers/Authorization) or anything that could contain the API key into
a debug entry's *value* — the key only legitimately exists in the fetch `Authorization` header in
`callDeepSeek` and must stay there.

# Evidence
M2.3 security review: name-only redaction is a no-op on all current debug fields (none match), and
the key never reaches a debug value today (callDeepSeek returns only `{ok,status,body}`/`{ok,content}`;
DeepSeek doesn't echo the auth header in error bodies). But a future field like `headers: {...}` or
`messages: [{authorization: ...}]` would defeat redaction. Documented limitation, not a live leak.

# Examples
Safe (current): `appendDeepSeekDebug({ phase, title, userPromptPreview: user.slice(0, 3000) })`.
Unsafe (would leak past redaction): `appendDeepSeekDebug({ requestDump: JSON.stringify({ headers }) })`.
If you must log request shape, redact the value explicitly before passing it in.
