# Планировщик демона hh-auto-otkliki

Демон **не крутится постоянно**. Внешний планировщик ОС запускает один шаг
(`node src/daemon.js --task <job>`), процесс делает работу и выходит. Так дешевле
по ресурсам на сервере, чем держать процесс открытым 24/7.

## Шаги (`--task`)

| Задача     | Что делает                       | Каденция        |
|------------|----------------------------------|-----------------|
| `messages` | читает все непрочитанные письма  | каждые 10 минут |
| `resume`   | обновляет/поднимает резюме       | каждые 30 минут |
| `apply`    | пачка откликов (`--limit 200`)   | 08:00 МСК       |

Алиасы: `poll`→`messages`, `bump`/`micro-edit`→`resume`.

С `--task` рабочие часы МСК **не проверяются** — временем управляет планировщик.

## Безопасность

- Без `--live` всё работает в **dry-run**: ничего наружу на hh.ru не уйдёт.
- `--live` включает реальные действия; `--reply-auto` — авто-отправку ответов в чате.
- `DEEPSEEK_API_KEY` берётся из `.env` репозитория (в лог не пишется).

## Linux-сервер (cron)

См. [`crontab.example`](crontab.example). Времена заданы через `CRON_TZ=Europe/Moscow`.
Поправь путь репозитория и список аккаунтов, затем `crontab -e`.

## Windows (Task Scheduler)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\scheduler\register-windows-tasks.ps1 `
  -Accounts belonogov,fedorov,startsev -Text DevOps -Area 1 -Limit 200 -Live -ReplyAuto
```

`apply` запускается в 08:00 **локального** времени машины — для 08:00 МСК
часовой пояс машины должен быть МСК. Удалить задачи:

```powershell
Get-ScheduledTask -TaskPath '\hh-auto-otkliki\' | Unregister-ScheduledTask -Confirm:$false
```

## Ручная проверка одного шага (безопасно, dry-run)

```powershell
node src\daemon.js --task messages --accounts belonogov
node src\daemon.js --task resume   --accounts belonogov
node src\daemon.js --task apply     --accounts belonogov --text DevOps --area 1 --limit 5
```
