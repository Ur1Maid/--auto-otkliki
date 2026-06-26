---
name: hh-closed-thread-no-composer
confidence: 0.85
created: 2026-06-26
tags: [playwright, hh-ru, messages, chatik]
---

# Action
В закрытых тредах чата hh.ru (например, после ОТКАЗА работодателя) композер удалён из DOM —
ответить нельзя. `sendReply` вернёт `composer_not_editable` — это КОРРЕКТНОЕ поведение, не баг и
не устаревший селектор. Не «чини» это и не форси отправку. Селектор композера
`[data-qa="chatik-new-message-text"]` рабочий — на активных тредах он editable.

# Evidence
2026-06-26, аккаунт belonogov: тред-отказ 5395755973 → `composerCount=0, textareaTotal=0`
(композера нет вовсе). Активный тред 5433384503 (наш отклик) → `composerCount=1, editable=true`.
То есть селектор верный, а отсутствие — свойство закрытого треда. Авто-флоу всё равно отвечает
только на UNREAD треды (`messages.js` фильтрует `unread===true`), так что в норме закрытые
треды и не трогаются.

# Examples
`sendReply(frame, text, {dryRun:false, replyAuto:true, confirmed:true})` на тред-отказ →
`{ sent:false, reason:'composer_not_editable' }`. Связано с [[hh-chatik-inline-not-iframe]].
