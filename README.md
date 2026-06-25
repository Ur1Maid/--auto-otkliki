# HH Auto Otkliki

CLI-помощник для hh.ru на Playwright. Скрипт открывает вакансии, оценивает релевантность через DeepSeek, автоматически нажимает отклик, заполняет обязательные вопросы и при необходимости генерирует короткое сопроводительное письмо.

Проект рассчитан на работу с одним или несколькими hh.ru аккаунтами. У каждого аккаунта своя сохраненная браузерная сессия, свой лог, свое резюме и свои зарплатные ожидания.

## Что умеет

- Ручной вход в hh.ru и сохранение session storage/cookies.
- Поиск вакансий по запросу hh.ru или обработка списка ссылок.
- Автоматический сбор до `--limit 200` вакансий из нескольких страниц поиска.
- Оценка релевантности вакансии через DeepSeek по шкале `0-100`.
- Пропуск вакансий ниже порога релевантности.
- Автоматический отклик на подходящие вакансии.
- Заполнение всей формы отклика одним JSON-запросом к DeepSeek.
- Ответы на текстовые вопросы, `radio` и `checkbox`.
- Генерация сопроводительного письма на `1-2` предложения, только если оно нужно.
- Отдельные настройки для каждого аккаунта.
- Режим `--upgrade-resume`: после прогона показывает, что точечно добавить в резюме и ключевые навыки.

## Безопасность Данных

В git не отправляются:

- `.env`
- `.hh-session/`
- `logs/*.jsonl`
- `node_modules/`
- реальные `config/accounts/*/resume.md`
- реальные `config/accounts/*/salary.md`

В репозитории есть только примеры:

- `.env.example`
- `config/accounts/example/resume.example.md`
- `config/accounts/example/salary.example.md`

## Установка

```powershell
npm.cmd install
npx.cmd playwright install chromium
```

Требуется Node.js `>=20`.

Версии зависимостей:

- Node.js: `>=20`
- Playwright: `^1.52.0` в `package.json`, сейчас зафиксирован `1.60.0` в `package-lock.json`
- Playwright Core: `1.60.0` в `package-lock.json`
- fsevents: `2.3.2`, optional-зависимость для macOS

## Настройка DeepSeek

Скопируйте пример env-файла:

```powershell
Copy-Item .env.example .env
```

Откройте `.env` и вставьте ключ:

```dotenv
DEEPSEEK_API_KEY=put_your_deepseek_key_here
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_API_URL=https://api.deepseek.com/chat/completions
DEBUG_DEEPSEEK=0
RELEVANCE_MIN_SCORE=65
```

`RELEVANCE_MIN_SCORE` задает минимальную релевантность вакансии. Например, при `65` вакансии со score ниже 65 будут пропущены.

## Настройка Аккаунта

Для каждого hh.ru аккаунта создайте отдельную папку:

```powershell
New-Item -ItemType Directory -Force config\accounts\acc1
Copy-Item config\accounts\example\resume.example.md config\accounts\acc1\resume.md
Copy-Item config\accounts\example\salary.example.md config\accounts\acc1\salary.md
```

Заполните:

- `config/accounts/acc1/resume.md` - резюме, стек, опыт, формат работы, ограничения.
- `config/accounts/acc1/salary.md` - зарплатные ожидания и правила ответа на вопросы о деньгах.

Telegram для разных резюме указывайте в соответствующем `resume.md`: например, для аккаунта `acc1` в `config/accounts/acc1/resume.md`, для `acc2` в `config/accounts/acc2/resume.md`. Лучше добавить отдельный блок `## Contacts` / `## Контакты` и написать нужный `Telegram: @username`; DeepSeek увидит этот текст вместе с резюме и сможет использовать его в ответах, когда это уместно.

Для аккаунта без имени используется папка:

```text
config/accounts/default/
```

Если `resume.md` или `salary.md` для аккаунта не существует, `review` создаст шаблон автоматически. Но перед массовым запуском его нужно заполнить реальными данными.

## Вход В hh.ru

Для аккаунта `default`:

```powershell
npm.cmd run login
```

Для именованного аккаунта:

```powershell
npm.cmd run login -- --account acc1
```

Сессии сохраняются так:

```text
.hh-session/storage-state.json
.hh-session/accounts/acc1/storage-state.json
```

## Запуск Из Поиска

Один аккаунт:

```powershell
npm.cmd run review -- --account acc1 --text DevOps --area 1 --limit 200
```

Несколько аккаунтов:

```powershell
npm.cmd run review -- --accounts acc1,acc2,acc3 --text DevOps --area 1 --limit 200
```

`--text` безопаснее полного URL с `&`, потому что Windows shell может отрезать аргументы после `&`.

## Запуск По Списку Ссылок

Добавьте ссылки в `input/vacancies.txt`:

```text
https://hh.ru/vacancy/123456789
https://hh.ru/vacancy/987654321
```

Запуск:

```powershell
npm.cmd run review -- --account acc1 --file input/vacancies.txt --limit 200
```

## Ручной Режим

В ручном режиме скрипт спрашивает перед откликом:

```powershell
npm.cmd run review:manual -- --account acc1 --text DevOps --area 1 --limit 50
```

Команды:

- `y` - откликнуться.
- `n` - пропустить.
- `m` - отметить как ручной шаг.
- `q` - выйти.

## Полезные Флаги

- `--account acc1` - один аккаунт.
- `--accounts acc1,acc2` - несколько аккаунтов.
- `--text DevOps` - текст поиска hh.ru.
- `--area 1` - регион hh.ru.
- `--limit 200` - максимум вакансий.
- `--min-score 70` - порог релевантности на запуск.
- `--debug-ai` - писать DeepSeek debug в `logs/deepseek-debug.jsonl`.
- `--manual` - ручное подтверждение перед откликом.
- `--upgrade-resume` - собрать рекомендации по улучшению резюме после прогона.
- `--resume-skills-limit 30` - максимум навыков в рекомендациях, не больше 30.

## Рекомендации Для Резюме

Чтобы после прогона получить предложения для улучшения резюме:

```powershell
npm.cmd run review -- --account acc1 --text DevOps --area 1 --limit 200 --upgrade-resume
```

Скрипт собирает:

- частые технологии и ключевые слова из вакансий;
- зеленые hh-плашки совпадения, если они появились на странице;
- релевантность вакансий;
- примеры вакансий, где эти сигналы встретились.

После завершения аккаунта скрипт выводит отчет в консоль и сохраняет его:

```text
logs/resume-upgrade-acc1.md
```

В отчете:

- максимум 30 рекомендуемых ключевых навыков;
- короткие формулировки для опыта без раздутых обязанностей;
- список того, что не стоит добавлять без реального опыта;
- вопросы, которые нужно проверить вручную перед правкой резюме.

## Логи

Логи откликов:

```text
logs/responses-log.jsonl
logs/responses-acc1.jsonl
logs/responses-acc2.jsonl
```

Debug DeepSeek:

```text
logs/deepseek-debug.jsonl
```

Ключ API в debug-лог не пишется.

## База Знаний

`data/` используется только как база знаний для DeepSeek. Markdown и txt-файлы из этой папки нарезаются на фрагменты и прикладываются к вопросам формы, когда это нужно.

Личную базу знаний нужно составлять самостоятельно: добавьте в `data/` свои markdown/txt-файлы с реальным опытом, фактами о проектах, типовыми ответами и ограничениями. Не храните в репозитории приватные данные, контакты, чувствительные детали проектов и готовые interview-pack файлы.

База знаний не прикладывается к сопроводительному письму, чтобы снизить расход токенов.

## Проверка Окружения

```powershell
npm.cmd run check
```

Проверяет Node.js, доступность Playwright Chromium и наличие сохраненной сессии `default`.
