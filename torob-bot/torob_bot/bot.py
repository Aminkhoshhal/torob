import asyncio
import contextlib
import time

from telegram import Update
from telegram.error import TelegramError
from telegram.ext import Application, CommandHandler, MessageHandler, filters

from .scraper import Blocked, Problem, Scraper
from .storage import export


HELP = ('/scrape تشک 10\n/status [job_id]\n/pause\n/resume [job_id]\n/stop\n/export [job_id]\n'
        'یا نام محصول و تعداد را در یک پیام بفرستید: تشک 10\n'
        'توقف و مکث مرورگر را می‌بندند؛ ادامه از SQLite است.')


class Controller:
    def __init__(self, cfg, store):
        self.cfg, self.store = cfg, store
        self.task = None
        self.active = None
        self.app = None
        self.last_notice = 0

    async def send(self, chat, text):
        try:
            await self.app.bot.send_message(chat, text)
        except TelegramError:
            # No raw exception: HTTP client errors may contain the bot token.
            print('TELEGRAM_SEND_FAILED; use /status or /export after reconnect')

    async def files(self, job):
        paths = await asyncio.to_thread(export, self.store.path, job, self.cfg.data / 'exports')
        for path in paths:
            if path.stat().st_size > 49 * 1024 * 1024:
                await self.send(self.store.job(job)['chat'], 'حجم فایل برای ارسال زیاد است؛ خروجی در پوشهٔ محلی exports ذخیره شد.')
                continue
            try:
                with path.open('rb') as file:
                    await self.app.bot.send_document(self.store.job(job)['chat'], file,
                                                     filename=path.name, write_timeout=120)
            except TelegramError:
                print('TELEGRAM_EXPORT_FAILED; local export retained')

    async def progress(self, text, force=False):
        if force or time.monotonic() - self.last_notice >= 20:
            self.last_notice = time.monotonic()
            await self.send(self.store.job(self.active)['chat'], text)

    async def heartbeat(self, job):
        while True:
            await asyncio.sleep(30)
            await self.progress(self.store.status(job))

    async def worker(self, job):
        timer = asyncio.create_task(self.heartbeat(job))
        try:
            await Scraper(self.cfg, self.store, job, self.progress).run()
        except asyncio.CancelledError:
            if self.store.job(job)['state'] == 'running':
                self.store.update(job, state='interrupted', error='SHUTDOWN')
            raise
        except Blocked as error:
            self.store.update(job, state='blocked', error=error.code, not_before=error.until)
            await self.send(self.store.job(job)['chat'],
                            'محدودیت دسترسی؛ درخواست‌ها متوقف شدند. سایت را دستی بررسی کنید؛ فقط پس از رفع محدودیت /resume بزنید. هیچ دورزدنی انجام نمی‌شود.')
        except Problem as error:
            self.store.update(job, state='interrupted', error=error.code)
        except Exception:
            self.store.update(job, state='interrupted', error='LOCAL_OR_SCHEMA_ERROR')
            print('LOCAL_OR_SCHEMA_ERROR; no private exception text logged')
        finally:
            timer.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await timer
        await self.progress(self.store.status(job), force=True)
        if self.store.job(job)['state'] in {'completed', 'incomplete'}:
            try:
                await self.files(job)
            except Exception:
                await self.send(self.store.job(job)['chat'], 'EXPORT_FAILED؛ داده‌ها در SQLite باقی مانده‌اند.')

    def start(self, job):
        self.active = job
        self.store.update(job, state='running', error=None, not_before=0)
        self.task = asyncio.create_task(self.worker(job))

    async def cancel(self, state):
        if self.task and not self.task.done():
            self.store.update(self.active, state=state)
            self.task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.task

    async def shutdown(self, app):
        await self.cancel('interrupted')

    async def command(self, update: Update, context):
        user, chat = update.effective_user, update.effective_chat
        if not user or not chat or user.id not in self.cfg.users or chat.type != 'private':
            return
        text = update.effective_message.text or ''
        parts = text.split()
        if not parts:
            return
        command = parts[0].split('@')[0] if parts[0].startswith('/') else '/scrape'
        args = parts[1:] if parts[0].startswith('/') else parts
        try:
            running = self.task and not self.task.done()
            if command == '/start':
                await self.send(chat.id, HELP)
                return
            if command == '/scrape':
                if running:
                    await self.send(chat.id, 'یک عملیات در حال اجراست؛ ابتدا /pause یا /stop.')
                    return
                if not self.cfg.permission:
                    await self.send(chat.id, 'SEARCH_PERMISSION_REQUIRED: robots.txt جستجوی خودکار را منع می‌کند؛ توضیح README را بررسی کنید.')
                    return
                if len(args) < 2 or not 1 <= int(args[-1]) <= 10000:
                    raise ValueError
                query = ' '.join(args[:-1])
                if len(query) > 300:
                    raise ValueError
                job = self.store.new(user.id, chat.id, query, int(args[-1]))
                self.start(job)
                await self.send(chat.id, f'عملیات {job} شروع شد.')
                return
            if command in {'/pause', '/stop'}:
                if not running or self.store.job(self.active)['owner'] != user.id:
                    await self.send(chat.id, 'عملیات فعال متعلق به شما وجود ندارد.')
                    return
                await self.cancel('paused' if command == '/pause' else 'stopped')
                await self.send(chat.id, self.store.status(self.active))
                return
            job = self.store.job(int(args[0])) if args else self.store.latest(user.id)
            if job is None or job['owner'] != user.id:
                await self.send(chat.id, 'عملیات متعلق به شما پیدا نشد.')
                return
            if command == '/status':
                await self.send(chat.id, self.store.status(job['id']))
            elif command == '/export':
                await self.files(job['id'])
            elif command == '/resume':
                if running:
                    await self.send(chat.id, 'یک عملیات در حال اجراست.')
                elif job['state'] == 'completed':
                    await self.send(chat.id, 'عملیات قبلاً کامل شده است؛ /export')
                elif time.time() < job['not_before']:
                    await self.send(chat.id, 'مهلت Retry-After هنوز تمام نشده است؛ بعداً بررسی و ادامه دهید.')
                elif not self.cfg.permission:
                    await self.send(chat.id, 'SEARCH_PERMISSION_REQUIRED؛ README را بخوانید.')
                else:
                    self.store.retry(job['id'])
                    self.start(job['id'])
                    await self.send(chat.id, 'ادامه از صف ذخیره‌شده. در صورت محدودیت مجدد، عملیات دوباره متوقف می‌شود.')
        except (ValueError, IndexError):
            await self.send(chat.id, 'ورودی معتبر نیست. نمونه: /scrape تشک 10')
        except Exception:
            await self.send(chat.id, 'LOCAL_COMMAND_ERROR؛ وضعیت و داده‌ها را در مک بررسی کنید.')


def run_bot(cfg, store):
    if not cfg.token or not cfg.users:
        raise ValueError('Set TELEGRAM_BOT_TOKEN and ALLOWED_USER_IDS in .env')
    control = Controller(cfg, store)
    app = Application.builder().token(cfg.token).post_stop(control.shutdown).build()
    control.app = app
    for command in ('start', 'scrape', 'status', 'pause', 'resume', 'stop', 'export'):
        app.add_handler(CommandHandler(command, control.command))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, control.command))

    async def error_handler(update, context):
        print('TELEGRAM_UPDATE_ERROR')

    app.add_error_handler(error_handler)
    app.run_polling(allowed_updates=['message'], drop_pending_updates=True)
