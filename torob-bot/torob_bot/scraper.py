"""Adapter verified against Torob's public page data on 2026-11-12.

No guessed CSS classes or fabricated API URLs. Pagination URLs come from the site.
"""
import asyncio
import json
import os
import re
import time
from email.utils import parsedate_to_datetime
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

from playwright.async_api import Error as BrowserError, async_playwright


class Problem(Exception):
    def __init__(self, code, until=0):
        self.code, self.until = code, until
        super().__init__(code)


class Blocked(Problem):
    pass


def browser_options(cfg, headless=False):
    proxy = os.getenv('HTTPS_PROXY') or os.getenv('https_proxy')
    return dict(user_data_dir=str(cfg.data / 'browser-profile'), headless=headless,
                executable_path=cfg.chromium, viewport={'width': 1440, 'height': 1000},
                proxy={'server': proxy} if proxy else None, service_workers='block')


def restricted(status, headers):
    if status not in (401, 403, 429, 451, 490):
        return None
    retry = headers.get('retry-after', '')
    try:
        until = time.time() + float(retry)
    except ValueError:
        try:
            until = parsedate_to_datetime(retry).timestamp()
        except (ValueError, TypeError, OverflowError):
            until = time.time() + (60 if status == 429 else 0)
    return Blocked(f'ACCESS_{status}', until)


def currency(text):
    if 'تومان' in (text or ''):
        return 'تومان'
    if 'ریال' in (text or ''):
        return 'ریال'
    return None


def site_url(url):
    u = urlsplit(url)
    if u.scheme != 'https' or u.hostname not in {'torob.com', 'api.torob.com'} or u.username or u.port not in (None, 443):
        raise Problem('UNEXPECTED_SITE_URL')
    return url


def product(raw):
    if not isinstance(raw, dict) or not raw.get('random_key') or not raw.get('name1') or not raw.get('web_client_absolute_url'):
        raise Problem('SCHEMA_PRODUCT')
    specs = raw.get('structural_specs') or None
    if specs and not specs.get('headers'):
        specs = None
    flat = {}
    if specs:
        for group in specs.get('headers', []):
            flat.update(group.get('specs') or {})
    brand = flat.get('برند') or next((x.get('title') for x in raw.get('breadcrumbs', []) if x.get('brand_id')), None)
    # Never infer a model by splitting a title.
    model = flat.get('مدل') or flat.get('مدل تشک') or None
    return dict(id=raw['random_key'], url=site_url(urljoin('https://torob.com', raw['web_client_absolute_url'])),
                name=raw['name1'], brand=brand, model=model, specs=specs,
                price=raw.get('price'), price_text=raw.get('price_text') or None,
                currency=currency(raw.get('price_text')), image=raw.get('image_url') or None)


def offer(raw, kind):
    if not raw.get('prk') or not raw.get('shop_name'):
        raise Problem('SCHEMA_SELLER')
    return dict(id=raw['prk'], kind=kind, shop_id=raw.get('shop_id'), name=raw['shop_name'],
                price=raw.get('price'), price_text=raw.get('price_text') or raw.get('price_string') or None,
                currency=currency(raw.get('price_text') or raw.get('price_string')),
                torob_url=public_link(raw.get('page_url')), website=None, direct_url=None)


def public_link(url):
    """Do not export anonymous session IDs or credential-looking query values."""
    if not url:
        return None
    u = urlsplit(url)
    if u.scheme not in {'https', 'http'} or not u.hostname or u.username:
        return None
    sensitive = {'uid', 'suid', 'init_suid', 'bvid', 'session_id', 'device_id', 'search_id',
                 'token', 'access_token', 'auth', 'authorization', 'password', 'api_key', 'signature'}
    query = [(k, v) for k, v in parse_qsl(u.query, keep_blank_values=True) if k.lower() not in sensitive]
    return urlunsplit((u.scheme, u.netloc, u.path, urlencode(query), ''))


class Scraper:
    def __init__(self, config, store, job, notify, headless=False):
        self.cfg, self.store, self.job, self.notify = config, store, job, notify
        self.headless = headless
        self.blocked = None
        self.last_request = 0
        self.pace_lock = asyncio.Lock()

    def check(self):
        if self.blocked:
            raise self.blocked

    async def pace(self):
        self.check()
        async with self.pace_lock:
            await asyncio.sleep(max(0, self.cfg.delay - (time.monotonic() - self.last_request)))
            self.check()
            self.last_request = time.monotonic()

    async def route(self, route):
        if self.blocked:
            await route.abort()
            return
        if route.request.resource_type in {'document', 'xhr', 'fetch'} and urlsplit(route.request.url).hostname in {'torob.com', 'api.torob.com'}:
            try:
                await self.pace()
            except Blocked:
                await route.abort()
                return
        await route.continue_()

    def response(self, response):
        if urlsplit(response.url).hostname in {'torob.com', 'api.torob.com'}:
            problem = restricted(response.status, response.headers)
            if problem:
                self.blocked = problem

    async def guard_page(self):
        self.check()
        text = (await self.page.locator('body').inner_text(timeout=10000))[:16000]
        if re.search(r'captcha|verify you are human|access denied|too many requests|کد امنیتی|من ربات نیستم|تأیید کنید که انسان', text, re.I):
            self.blocked = Blocked('CAPTCHA_OR_ACCESS')
            raise self.blocked

    async def page_data(self, url):
        for attempt in range(3):
            self.check()
            try:
                r = await self.page.goto(site_url(url), wait_until='domcontentloaded', timeout=45000)
                self.check()
                if r is None or r.status >= 500:
                    raise Problem('SITE_5XX')
                await self.guard_page()
                if r.status >= 400:
                    raise Problem(f'HTTP_{r.status}')
                text = await self.page.locator('script#__NEXT_DATA__').text_content(timeout=15000)
                self.check()
                return json.loads(text)['props']['pageProps']
            except Blocked:
                raise
            except (json.JSONDecodeError, KeyError, TypeError):
                raise Problem('SCHEMA_PAGE') from None
            except (BrowserError, Problem) as error:
                self.check()
                if isinstance(error, Problem) and error.code != 'SITE_5XX':
                    raise
                if attempt == 2:
                    raise Problem('NETWORK_OR_PAGE_STRUCTURE') from None
                await asyncio.sleep(self.cfg.delay * (2 ** attempt))

    async def api(self, url, redirect=False):
        for attempt in range(3):
            await self.pace()
            try:
                response = await self.context.request.get(site_url(url), timeout=45000, max_redirects=0)
                problem = restricted(response.status, response.headers)
                if problem:
                    self.blocked = problem
                    raise problem
                if response.status >= 500:
                    raise Problem('SITE_5XX')
                if redirect and response.status in (301, 302, 303, 307, 308):
                    return urljoin(url, response.headers.get('location', ''))
                if response.status >= 400:
                    raise Problem(f'HTTP_{response.status}')
                body = await response.text()
                if 'json' not in response.headers.get('content-type', ''):
                    if re.search(r'captcha|access denied|verify you are human|کد امنیتی', body, re.I):
                        self.blocked = Blocked('CAPTCHA_OR_ACCESS')
                        raise self.blocked
                    if redirect:
                        return None
                    raise Problem('SCHEMA_API')
                if redirect:
                    return None
                return json.loads(body)
            except Blocked:
                raise
            except json.JSONDecodeError:
                raise Problem('SCHEMA_API') from None
            except (BrowserError, Problem) as error:
                self.check()
                if isinstance(error, Problem) and error.code != 'SITE_5XX':
                    raise
                if attempt == 2:
                    raise Problem('NETWORK') from None
                await asyncio.sleep(self.cfg.delay * (2 ** attempt))
            finally:
                if 'response' in locals():
                    await response.dispose()

    async def direct(self, url):
        """Only resolve Torob redirects, never navigate/request the merchant."""
        if not url:
            return None
        for _ in range(5):
            u = urlsplit(url)
            if u.scheme not in ('http', 'https') or not u.hostname or u.username:
                return None
            if u.hostname not in {'torob.com', 'api.torob.com'}:
                return url
            url = await self.api(url, redirect=True)
            if not url:
                return None
        return None

    async def discover(self):
        j = self.store.job(self.job)
        existing = self.store.rows(self.job)
        cursor = j['cursor']
        if not existing:
            d = await self.page_data('https://torob.com/search/?' + urlencode({'query': j['query']}))
            if not isinstance(d.get('products'), list):
                raise Problem('SCHEMA_SEARCH')
            products = [product(p) for p in d['products']]
            # Compare the initial ordered payload with actual rendered product links.
            hrefs = await self.page.locator('a[href^="/p/"]').evaluate_all('(xs)=>xs.map(x=>x.getAttribute("href"))')
            displayed = list(dict.fromkeys(urlsplit(h).path.split('/')[2] for h in hrefs))
            expected = list(dict.fromkeys(p['id'] for p in products))
            if expected != displayed:
                raise Problem('DISPLAY_ORDER_CHANGED')
            cursor = d.get('nextUrl')
            self.store.enqueue(self.job, products, cursor)
        seen = set()
        while len(self.store.rows(self.job)) < j['target'] and cursor:
            if cursor in seen:
                raise Problem('PAGINATION_LOOP')
            seen.add(cursor)
            d = await self.api(cursor)
            if not isinstance(d.get('results'), list) or 'next' not in d:
                raise Problem('SCHEMA_PAGINATION')
            before = len(self.store.rows(self.job))
            cursor = d['next']
            self.store.enqueue(self.job, [product(p) for p in d['results']], cursor)
            if len(self.store.rows(self.job)) == before and cursor:
                raise Problem('PAGINATION_NO_PROGRESS')
            await self.notify(self.store.status(self.job))
        self.store.update(self.job, phase='details')

    async def details(self, row):
        d = await self.page_data(row['url'])
        raw = d.get('baseProduct')
        if not isinstance(raw, dict):
            raise Problem('SCHEMA_DETAIL')
        p = product(raw)
        if p['id'] != row['id']:
            raise Problem('PRODUCT_ID_CHANGED')
        # A retried product is a new snapshot; do not keep vanished/stale offers.
        self.store.clear_offers(self.job, row['id'])
        self.store.detail(self.job, row['id'], p)
        groups = [(k, v) for k, v in raw.items() if isinstance(v, dict) and 'result' in v and k.startswith('products_')]
        if not groups:
            raise Problem('SCHEMA_SELLER_GROUPS')
        for kind, group in groups:
            initial = group['result']
            if not isinstance(initial, list):
                raise Problem('SCHEMA_SELLERS')
            self.store.offers(self.job, row['id'], [offer(s, kind) for s in initial])
            all_offers = initial
            # This URL returns the whole expanded group on the inspected site.
            # Follow an explicit next link if a future response paginates it.
            url = group.get('sellers_url')
            count = group.get('count')
            if url:
                all_offers, seen = [], set()
                while url:
                    if url in seen:
                        raise Problem('SELLER_PAGINATION_LOOP')
                    seen.add(url)
                    data = await self.api(url)
                    if not isinstance(data.get('results'), list):
                        raise Problem('SCHEMA_SELLERS')
                    all_offers.extend(data['results'])
                    self.store.offers(self.job, row['id'], [offer(s, kind) for s in data['results']])
                    count = data.get('count', count)
                    url = data.get('next')
            if count is not None and len(all_offers) < count:
                raise Problem('SELLERS_INCOMPLETE')
            if kind == 'products_info' and self.cfg.resolve_links:
                unique = {s['prk']: s for s in all_offers}
                for raw_offer in unique.values():
                    s = offer(raw_offer, kind)
                    direct = await self.direct(raw_offer.get('page_url'))
                    if direct:
                        u = urlsplit(direct)
                        # A signed/login-only destination is not a public direct-buy URL.
                        clean = public_link(direct)
                        has_secret = any(k.lower() in {'token', 'access_token', 'auth', 'authorization', 'password', 'api_key', 'signature', 'session_id'}
                                         for k, v in parse_qsl(u.query))
                        s.update(direct_url=None if has_secret else clean, website=f'{u.scheme}://{u.netloc}')
                    self.store.offers(self.job, row['id'], [s])
        self.store.mark(self.job, row['id'])

    async def run(self):
        if not self.cfg.permission:
            raise Blocked('SEARCH_PERMISSION_REQUIRED')
        async with async_playwright() as p:
            self.context = await p.chromium.launch_persistent_context(**browser_options(self.cfg, self.headless))
            try:
                await self.context.route('**/*', self.route)
                self.context.on('response', self.response)
                self.page = self.context.pages[0] if self.context.pages else await self.context.new_page()
                if self.store.job(self.job)['phase'] == 'discover':
                    await self.discover()
                for row in self.store.rows(self.job):
                    if row['status'] == 'success':
                        continue
                    try:
                        await self.details(row)
                    except Blocked:
                        raise
                    except Problem as error:
                        self.store.mark(self.job, row['id'], error.code)
                        if error.code.startswith(('SCHEMA', 'NETWORK', 'SELLERS_', 'PRODUCT_ID')):
                            raise
                    await self.notify(self.store.status(self.job))
                rows = self.store.rows(self.job)
                complete = len(rows) == self.store.job(self.job)['target'] and all(r['status'] == 'success' for r in rows)
                self.store.update(self.job, state='completed' if complete else 'incomplete',
                                  error=None if complete else 'FEWER_RESULTS_OR_FAILED_PRODUCTS')
            finally:
                await self.context.close()
