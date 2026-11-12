import csv
import json
import sqlite3
import uuid
import zipfile
from pathlib import Path

from openpyxl import Workbook
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE


def dumps(value):
    return json.dumps(value, ensure_ascii=False) if value is not None else None


def cell(value):
    """Keep untrusted website strings from becoming spreadsheet formulas."""
    if not isinstance(value, str):
        return value
    value = ILLEGAL_CHARACTERS_RE.sub('', value)
    return "'" + value if value.lstrip().startswith(('=', '+', '-', '@')) else value


class Store:
    def __init__(self, path):
        self.path = Path(path)
        self.db = sqlite3.connect(path)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.executescript('''
        CREATE TABLE IF NOT EXISTS jobs(
          id INTEGER PRIMARY KEY, owner INTEGER NOT NULL, chat INTEGER NOT NULL,
          query TEXT NOT NULL, target INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'running',
          phase TEXT NOT NULL DEFAULT 'discover', cursor TEXT, error TEXT, not_before REAL DEFAULT 0,
          created TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS products(
          job INTEGER REFERENCES jobs(id), rank INTEGER, id TEXT, url TEXT NOT NULL,
          name TEXT, brand TEXT, model TEXT, specs TEXT, price REAL, price_text TEXT,
          currency TEXT, image TEXT, status TEXT DEFAULT 'pending', error TEXT,
          sellers_complete INTEGER DEFAULT 0, fetched_at TEXT,
          PRIMARY KEY(job,id), UNIQUE(job,rank));
        CREATE TABLE IF NOT EXISTS sellers(
          job INTEGER, product_id TEXT, kind TEXT, offer_id TEXT, shop_id TEXT,
          name TEXT, price REAL, price_text TEXT, currency TEXT,
          website TEXT, direct_url TEXT, torob_url TEXT,
          PRIMARY KEY(job,product_id,kind,offer_id),
          FOREIGN KEY(job,product_id) REFERENCES products(job,id));
        ''')
        self.db.execute("UPDATE jobs SET state='interrupted',error='RESTART' WHERE state='running'")
        self.db.commit()

    def job(self, job_id):
        return self.db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()

    def latest(self, owner):
        return self.db.execute('SELECT * FROM jobs WHERE owner=? ORDER BY id DESC LIMIT 1', (owner,)).fetchone()

    def new(self, owner, chat, query, target):
        with self.db:
            return self.db.execute('INSERT INTO jobs(owner,chat,query,target) VALUES(?,?,?,?)',
                                   (owner, chat, query, target)).lastrowid

    def update(self, job, **fields):
        assert set(fields) <= {'state', 'phase', 'cursor', 'error', 'not_before'}
        with self.db:
            self.db.execute('UPDATE jobs SET ' + ','.join(k + '=?' for k in fields) + ' WHERE id=?',
                            (*fields.values(), job))

    def rows(self, job):
        return self.db.execute('SELECT * FROM products WHERE job=? ORDER BY rank', (job,)).fetchall()

    def enqueue(self, job, products, cursor):
        """Queue and pagination cursor commit together, including across crashes."""
        target = self.job(job)['target']
        with self.db:
            rank = len(self.rows(job))
            for p in products:
                if rank >= target:
                    break
                result = self.db.execute('''INSERT OR IGNORE INTO products
                    (job,rank,id,url,name,price,price_text,currency,image) VALUES(?,?,?,?,?,?,?,?,?)''',
                    (job, rank + 1, p['id'], p['url'], p.get('name'), p.get('price'),
                     p.get('price_text'), p.get('currency'), p.get('image')))
                rank += result.rowcount
            self.db.execute('UPDATE jobs SET cursor=? WHERE id=?', (cursor, job))

    def detail(self, job, pid, p):
        with self.db:
            self.db.execute('''UPDATE products SET name=?,brand=?,model=?,specs=?,price=?,
                price_text=?,currency=?,image=?,fetched_at=CURRENT_TIMESTAMP WHERE job=? AND id=?''',
                (p.get('name'), p.get('brand'), p.get('model'), dumps(p.get('specs')),
                 p.get('price'), p.get('price_text'), p.get('currency'), p.get('image'), job, pid))

    def offers(self, job, pid, offers):
        with self.db:
            for s in offers:
                self.db.execute('''INSERT INTO sellers VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(job,product_id,kind,offer_id) DO UPDATE SET
                    name=excluded.name,price=excluded.price,price_text=excluded.price_text,
                    currency=excluded.currency,website=excluded.website,
                    direct_url=excluded.direct_url,torob_url=excluded.torob_url''',
                    (job, pid, s['kind'], s['id'], s.get('shop_id'), s.get('name'), s.get('price'),
                     s.get('price_text'), s.get('currency'), s.get('website'),
                     s.get('direct_url'), s.get('torob_url')))

    def clear_offers(self, job, pid):
        with self.db:
            self.db.execute('DELETE FROM sellers WHERE job=? AND product_id=?', (job, pid))

    def mark(self, job, pid, error=None):
        with self.db:
            self.db.execute('UPDATE products SET status=?,error=?,sellers_complete=? WHERE job=? AND id=?',
                            ('failed' if error else 'success', error, int(not error), job, pid))

    def retry(self, job):
        with self.db:
            self.db.execute("UPDATE products SET status='pending',error=NULL WHERE job=? AND status='failed'", (job,))

    def status(self, job):
        j = self.job(job)
        rows = self.rows(job)
        ok = sum(r['status'] == 'success' for r in rows)
        bad = sum(r['status'] == 'failed' for r in rows)
        return (f"عملیات {job}: {j['state']} / {j['phase']}\n"
                f"کشف‌شده {len(rows)}/{j['target']} | موفق {ok} | ناموفق {bad}\n"
                f"خطا: {j['error'] or '—'}")

    def close(self):
        self.db.close()


def export(path, job, folder):
    """Separate connection and a read transaction: consistent export while scraping."""
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    stem = f'job-{job}-{uuid.uuid4().hex[:8]}'
    book = Workbook(write_only=True)
    archive = folder / (stem + '-csv.zip')
    with sqlite3.connect(path) as db, zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
        db.execute('BEGIN')
        for table, query in (
            ('job', 'SELECT * FROM jobs WHERE id=?'),
            ('products', 'SELECT * FROM products WHERE job=? ORDER BY rank'),
            ('sellers', '''SELECT p.rank,s.* FROM sellers s JOIN products p
                ON p.job=s.job AND p.id=s.product_id WHERE s.job=? ORDER BY p.rank,s.kind,s.offer_id''')):
            cursor = db.execute(query, (job,))
            headers = [c[0] for c in cursor.description]
            sheet = book.create_sheet(table)
            sheet.append(headers)
            csv_path = folder / (stem + '-' + table + '.csv')
            with csv_path.open('w', encoding='utf-8-sig', newline='') as f:
                writer = csv.writer(f)
                writer.writerow(headers)
                for row in cursor:
                    values = [cell(v) for v in row]
                    sheet.append(values)
                    writer.writerow(values)
            z.write(csv_path, table + '.csv')
            csv_path.unlink()
    xlsx = folder / (stem + '.xlsx')
    book.save(xlsx)
    return [xlsx, archive]
