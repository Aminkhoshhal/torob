import argparse
import asyncio
import fcntl
import logging
import os
import signal
import sys
import time

from .config import Config
from .scraper import Blocked, Problem, Scraper, browser_options
from .storage import Store, export


async def identify(cfg):
    from telegram import Bot
    if not cfg.token:
        raise ValueError('Set TELEGRAM_BOT_TOKEN first')
    print('Send /start to your bot now. Only your numeric User ID is printed locally. Ctrl+C exits.')
    async with Bot(cfg.token) as bot:
        offset = 0
        while True:
            updates = await bot.get_updates(offset=offset, timeout=25, allowed_updates=['message'])
            for u in updates:
                offset = u.update_id + 1
                if u.effective_user and u.effective_chat and u.effective_chat.type == 'private':
                    print('Telegram User ID:', u.effective_user.id)


async def review(cfg):
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        context = await p.chromium.launch_persistent_context(**browser_options(cfg))
        print('Manual review only. Navigate yourself; no scraping runs. Close the browser when done.')
        try:
            await context.wait_for_event('close', timeout=0)
        finally:
            await context.close()


async def cli(cfg, store, args):
    task = asyncio.current_task()
    asyncio.get_running_loop().add_signal_handler(signal.SIGTERM, task.cancel)
    if args.resume:
        job = store.job(args.resume)
        if not job or time.time() < job['not_before']:
            raise ValueError('Missing job or Retry-After has not elapsed')
        job_id = job['id']
        store.retry(job_id)
        store.update(job_id, state='running', error=None)
    else:
        if not args.query or not 1 <= args.limit <= 10000:
            raise ValueError('Provide --query and --limit between 1 and 10000')
        job_id = store.new(0, 0, args.query, args.limit)
    async def notify(text):
        print(text, flush=True)
    try:
        await Scraper(cfg, store, job_id, notify, headless=args.headless).run()
    except asyncio.CancelledError:
        store.update(job_id, state='interrupted', error='SHUTDOWN')
        raise
    except Blocked as e:
        store.update(job_id, state='blocked', error=e.code, not_before=e.until)
    except Problem as e:
        store.update(job_id, state='interrupted', error=e.code)
    except Exception:
        store.update(job_id, state='interrupted', error='LOCAL_OR_SCHEMA_ERROR')
    print(store.status(job_id))
    for path in export(store.path, job_id, cfg.data / 'exports'):
        print(path)
    return 0 if store.job(job_id)['state'] == 'completed' else 2


def main():
    if sys.version_info < (3, 12):
        raise SystemExit('Python 3.12+ required')
    os.umask(0o077)
    # HTTP and framework loggers can include token-bearing URLs.
    logging.disable(logging.CRITICAL)
    parser = argparse.ArgumentParser(description='Local Torob bot; default: Telegram long polling')
    parser.add_argument('--whoami', action='store_true', help='Print incoming Telegram user IDs locally; no replies')
    parser.add_argument('--review', action='store_true', help='Open the same headed profile for manual review only')
    parser.add_argument('--query')
    parser.add_argument('--limit', type=int, default=10)
    parser.add_argument('--resume', type=int)
    parser.add_argument('--headless', action='store_true', help='CLI diagnostics only; bot always headed')
    args = parser.parse_args()
    cfg = Config.load()
    with (cfg.data / 'process.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit('Another bot/scraper process is using this DATA_DIR') from None
        if args.whoami:
            asyncio.run(identify(cfg))
            return 0
        if args.review:
            asyncio.run(review(cfg))
            return 0
        store = Store(cfg.data / 'torob.sqlite3')
        try:
            if args.query or args.resume:
                return asyncio.run(cli(cfg, store, args))
            from .bot import run_bot
            run_bot(cfg, store)
            return 0
        finally:
            store.close()


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (KeyboardInterrupt, asyncio.CancelledError):
        print('Stopped safely; resume from SQLite.')
    except Exception as error:
        # Never stringify SDK exceptions; they may embed secrets.
        print('STARTUP_FAILED:', type(error).__name__, 'Check .env, network and installed dependencies.')
        sys.exit(1)
