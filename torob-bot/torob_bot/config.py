import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


@dataclass
class Config:
    token: str
    users: set[int]
    data: Path
    delay: float
    permission: bool
    chromium: str | None
    resolve_links: bool = True

    @classmethod
    def load(cls):
        load_dotenv()
        c = cls(os.getenv('TELEGRAM_BOT_TOKEN', ''),
                {int(x.strip()) for x in os.getenv('ALLOWED_USER_IDS', '').split(',') if x.strip()},
                Path(os.getenv('DATA_DIR', 'data')).resolve(),
                float(os.getenv('REQUEST_DELAY', '5')),
                os.getenv('SEARCH_PERMISSION_CONFIRMED', 'false').lower() == 'true',
                os.getenv('CHROMIUM_PATH') or None,
                os.getenv('RESOLVE_BUY_LINKS', 'true').lower() == 'true')
        if not 3 <= c.delay <= 3600:
            raise ValueError('REQUEST_DELAY must be between 3 and 3600 seconds')
        c.data.mkdir(parents=True, exist_ok=True, mode=0o700)
        return c
