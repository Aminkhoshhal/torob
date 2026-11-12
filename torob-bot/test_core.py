"""Local automated tests use fixtures/mocks; they are NOT successful live tests."""
import asyncio
import csv
import io
import json
import tempfile
import time
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

from openpyxl import load_workbook

from torob_bot.bot import Controller
from torob_bot.config import Config
from torob_bot.scraper import Blocked, Problem, Scraper, offer, product, public_link, restricted, site_url
from torob_bot.storage import Store, export


def raw(pid='a'):
    return dict(random_key=pid, name1='تشک', web_client_absolute_url=f'/p/{pid}/',
                price=123, price_text='۱۲۳ تومان', image_url=None)


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'test.db'
        self.s = Store(self.path)
        self.job = self.s.new(42, 42, 'تشک', 2)

    def tearDown(self):
        self.s.close()
        self.tmp.cleanup()

    def test_order_dedup_limit_cursor_and_crash_recovery(self):
        self.s.enqueue(self.job, [product(raw(x)) for x in ['a', 'a', 'b', 'c']], 'next')
        self.assertEqual([(r['id'], r['rank']) for r in self.s.rows(self.job)], [('a', 1), ('b', 2)])
        self.s.mark(self.job, 'a')
        self.s.mark(self.job, 'b', 'NETWORK')
        self.s.close()
        self.s = Store(self.path)
        self.assertEqual(self.s.job(self.job)['state'], 'interrupted')
        self.assertEqual(self.s.job(self.job)['cursor'], 'next')
        self.s.retry(self.job)
        self.assertEqual([r['status'] for r in self.s.rows(self.job)], ['success', 'pending'])

    def test_export_null_unicode_sellers_and_formula_safety(self):
        p = product(raw())
        p['name'] = '=HYPERLINK("bad")'
        self.s.enqueue(self.job, [p], None)
        s = offer(dict(prk='s', shop_name='فروشنده', price=123, price_text='۱۲۳ تومان'), 'products_info')
        self.s.offers(self.job, 'a', [s, s])
        self.assertEqual(self.s.db.execute('SELECT count(*) FROM sellers').fetchone()[0], 1)
        xlsx, archive = export(self.path, self.job, Path(self.tmp.name) / 'exports')
        book = load_workbook(xlsx)
        data = list(book['products'].values)
        fields = dict(zip(data[0], data[1]))
        self.assertIsNone(fields['brand'])
        self.assertTrue(fields['name'].startswith("'="))
        with zipfile.ZipFile(archive) as z:
            csv_rows = list(csv.DictReader(io.StringIO(z.read('products.csv').decode('utf-8-sig'))))
            self.assertEqual(csv_rows[0]['brand'], '')
            self.assertEqual(csv_rows[0]['currency'], 'تومان')
        book.close()

    def test_real_observed_spec_keys_without_title_inference(self):
        r = raw()
        r['structural_specs'] = {'headers': [{'header': 'مشخصات کلی', 'specs': {'برند': 'خوشخواب', 'مدل تشک': 'کامفورت'}}]}
        p = product(r)
        self.assertEqual((p['brand'], p['model']), ('خوشخواب', 'کامفورت'))
        self.assertIsNone(product(raw())['model'])

    def test_restrictions_and_url_validation(self):
        for code in (401, 403, 429, 451, 490):
            self.assertIsInstance(restricted(code, {}), Blocked)
        self.assertGreater(restricted(429, {'retry-after': '120'}).until, time.time() + 119)
        self.assertIsNone(restricted(200, {}))
        for url in ('http://torob.com/', 'https://torob.com.evil/', 'https://127.0.0.1/', 'https://user@torob.com/'):
            with self.assertRaises(Problem):
                site_url(url)

    def test_exported_links_do_not_contain_session_ids(self):
        self.assertEqual(public_link('https://api.torob.com/redirect?prk=p&session_id=private&uid=42&token=secret'),
                         'https://api.torob.com/redirect?prk=p')


class AsyncTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cfg = Config('', {42}, Path(self.tmp.name), 3, True, None)
        self.s = Store(Path(self.tmp.name) / 'test.db')
        self.job = self.s.new(42, 42, 'تشک', 3)
        self.sc = Scraper(self.cfg, self.s, self.job, AsyncMock())
        self.sc.pace = AsyncMock()

    async def asyncTearDown(self):
        self.s.close()
        self.tmp.cleanup()

    async def test_429_has_no_automatic_retry(self):
        response = SimpleNamespace(status=429, headers={'retry-after': '120'}, dispose=AsyncMock())
        get = AsyncMock(return_value=response)
        self.sc.context = SimpleNamespace(request=SimpleNamespace(get=get))
        with self.assertRaises(Blocked):
            await self.sc.api('https://api.torob.com/test')
        self.assertEqual(get.await_count, 1)
        with self.assertRaises(Blocked):
            self.sc.check()

    async def test_discovery_follows_observed_next_and_keeps_exact_n(self):
        self.sc.page_data = AsyncMock(return_value={'products': [raw('a'), raw('b')], 'nextUrl': 'https://api.torob.com/next'})
        self.sc.page = SimpleNamespace(locator=lambda _: SimpleNamespace(evaluate_all=AsyncMock(return_value=['/p/a/', '/p/a/', '/p/b/'])))
        self.sc.api = AsyncMock(return_value={'results': [raw('b'), raw('c'), raw('d')], 'next': 'https://api.torob.com/third'})
        await self.sc.discover()
        self.assertEqual([r['id'] for r in self.s.rows(self.job)], ['a', 'b', 'c'])
        self.assertEqual(self.sc.api.await_count, 1)

    async def test_changed_display_order_fails_closed(self):
        self.sc.page_data = AsyncMock(return_value={'products': [raw('a'), raw('b')]})
        self.sc.page = SimpleNamespace(locator=lambda _: SimpleNamespace(evaluate_all=AsyncMock(return_value=['/p/b/', '/p/a/'])))
        with self.assertRaisesRegex(Problem, 'DISPLAY_ORDER_CHANGED'):
            await self.sc.discover()
        self.assertEqual(len(self.s.rows(self.job)), 0)

    async def test_direct_link_does_not_request_merchant(self):
        self.sc.api = AsyncMock(return_value='https://merchant.example/product/1')
        result = await self.sc.direct('https://api.torob.com/redirect')
        self.assertEqual(result, 'https://merchant.example/product/1')
        self.assertEqual(self.sc.api.await_count, 1)

    async def test_incomplete_seller_group_never_reports_success(self):
        p = raw()
        p['products_info'] = {'result': [], 'count': 2, 'sellers_url': 'https://api.torob.com/sellers'}
        self.s.enqueue(self.job, [product(p)], None)
        self.sc.page_data = AsyncMock(return_value={'baseProduct': p})
        self.sc.api = AsyncMock(return_value={'results': [dict(prk='s1', shop_name='one')], 'count': 2})
        with self.assertRaisesRegex(Problem, 'SELLERS_INCOMPLETE'):
            await self.sc.details(self.s.rows(self.job)[0])
        self.assertEqual(self.s.rows(self.job)[0]['sellers_complete'], 0)
        self.assertEqual(self.s.db.execute('SELECT count(*) FROM sellers').fetchone()[0], 1)

    async def test_unauthorized_and_group_commands_do_nothing(self):
        c = Controller(self.cfg, self.s)
        c.send = AsyncMock()
        for uid, kind in ((99, 'private'), (42, 'group')):
            update = SimpleNamespace(effective_user=SimpleNamespace(id=uid), effective_chat=SimpleNamespace(id=uid, type=kind),
                                     effective_message=SimpleNamespace(text='/scrape تشک 10'))
            await c.command(update, None)
        c.send.assert_not_awaited()
        self.assertIsNone(c.task)

    async def test_pause_cancels_task_and_persists_checkpoint(self):
        c = Controller(self.cfg, self.s)
        c.active = self.job
        c.task = asyncio.create_task(asyncio.sleep(100))
        await c.cancel('paused')
        self.assertTrue(c.task.cancelled())
        self.assertEqual(self.s.job(self.job)['state'], 'paused')

    async def test_owner_cannot_export_another_users_job(self):
        other = self.s.new(99, 99, 'other', 1)
        c = Controller(self.cfg, self.s)
        c.send, c.files = AsyncMock(), AsyncMock()
        update = SimpleNamespace(effective_user=SimpleNamespace(id=42), effective_chat=SimpleNamespace(id=42, type='private'),
                                 effective_message=SimpleNamespace(text=f'/export {other}'))
        await c.command(update, None)
        c.files.assert_not_awaited()


if __name__ == '__main__':
    unittest.main()
