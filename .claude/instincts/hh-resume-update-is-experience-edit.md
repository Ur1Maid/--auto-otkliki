---
name: hh-resume-update-is-experience-edit
confidence: 0.9
created: 2026-06-26
tags: [playwright, hh-ru, resume, selectors]
---

# Action
Чтобы обновить дату резюме на hh.ru, делай РЕАЛЬНУЮ микро-правку текста опыта работы, а НЕ
кнопку «Поднять в поиске» (она выпилена по требованию владельца — см. `src/lib/resumeEdit.js`).
Флоу: список резюме → hash первого резюме из `a[href*="/resume/<hash>"]` → перейти НАПРЯМУЮ на
`https://hh.ru/profile/edit/experience/0?resumeFrom=<hash>` (надёжнее клика по кнопке) → править
textarea `[data-qa="resume-editor-experience-description-input"]` → сохранить
`[data-qa="profile-layout-save-button"]`. Правка = toggle финальной точки (обратимо, минимально).

# Evidence
Проверено по живому DOM belonogov 2026-06-26: клик по `edit-experience-button-0` ведёт на
`/profile/edit/experience/0?resumeFrom=<hash>`; на странице ровно одна textarea с описанием.
Live-прогон `node src/daemon.js --task resume --account belonogov --live` успешно сохранил правку
(`removed_dot`, changed=true). ВАЖНО: всегда защищай от пустого чтения — если `inputValue()`
вернул '' на видимом поле, НЕ сохраняй (иначе затрёшь описание точкой); см. guard `empty_field`.

# Examples
`microEditDescription('…восстановления.')` → `{ next: '…восстановления', change: 'removed_dot' }`.
Старые bump-селекторы (`resume-update-button`, RESUME_BUMP_*) удалены — не возвращай их.
Связано с [[hh-selectors-text-based]], [[hh-data-qa-may-be-multivalue]].
