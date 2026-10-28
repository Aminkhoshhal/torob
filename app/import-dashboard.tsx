"use client";
import { useEffect, useState, type FormEvent } from "react";
import {
  Store,
  RefreshCw,
  Pause,
  Play,
  CheckCircle2,
  AlertTriangle,
  Package,
  Search,
  Clock,
  Link2,
  ShieldCheck,
  Loader2,
  ArrowLeft,
  PlugZap,
  Radio,
  KeyRound,
  ChevronDown,
  Plus,
} from "lucide-react";
const fa = (n: unknown) =>
  new Intl.NumberFormat("fa-IR").format(Number(n || 0));
const time = (v: string | null) =>
  v
    ? new Intl.DateTimeFormat("fa-IR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Asia/Tehran",
      }).format(new Date(v))
    : "هنوز انجام نشده";
const states: Record<string, string> = {
  queued: "در صف پردازش",
  running: "در حال دریافت محصولات",
  paused: "متوقف شده",
  retry: "تلاش مجدد زمان‌بندی شده",
  succeeded: "تکمیل شد",
  failed: "نیازمند بررسی",
};
const errors: Record<string, string> = {
  RATE_LIMITED: "محدودیت درخواست API؛ تلاش مجدد خودکار",
  PRODUCT_LIMIT_REACHED:
    "ظرفیت محصول تکمیل است؛ طرح را ارتقا دهید و دوباره تلاش کنید.",
  API_PERMISSION_DENIED: "کلید یا مجوز خواندن محصولات معتبر نیست.",
  NETWORK_OR_TIMEOUT: "پاسخ API دریافت نشد؛ تلاش مجدد خودکار",
  INVALID_API_SCHEMA: "ساختار پاسخ API معتبر نیست.",
  STORE_CURRENCY_MISMATCH: "واحد پول فروشگاه با اتصال یکسان نیست.",
};
const intervals = [15, 30, 60, 180, 360, 720, 1440];
function intervalLabel(n: number) {
  return n < 60 ? fa(n) + " دقیقه" : fa(n / 60) + " ساعت";
}
async function call(path: string, body?: unknown) {
  const r = await fetch("/api/imports" + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "ارتباط برقرار نشد");
  return d;
}
export function ConnectStore({
  onConnected,
  onSandbox,
  existing,
}: {
  onConnected: (message: string) => void;
  onSandbox: () => void;
  existing?: any;
}) {
  const [platform, setPlatform] = useState(existing?.platform || "auto"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [domain, setDomain] = useState(existing?.domain || ""),
    [step, setStep] = useState(1),
    [webhook, setWebhook] = useState<any>(null);
  const [mapping, setMapping] = useState(
    JSON.stringify(
      {
        endpoint: "/api/products",
        auth: "bearer",
        itemsPath: "items",
        pagination: "page",
        pageParam: "page",
        sizeParam: "per_page",
        pageSize: 100,
        fields: {
          id: "id",
          title: "name",
          price: "price",
          sku: "sku",
          stock: "stock",
          available: "available",
          brand: "brand",
          model: "model",
          barcode: "barcode",
          description: "description",
          categories: "categories",
          images: "images",
          attributes: "attributes",
          variants: "variants",
        },
      },
      null,
      2,
    ),
  );
  async function detect() {
    if (!domain) return;
    setBusy(true);
    setMessage("");
    try {
      const d = await call("/detect", { domain });
      setPlatform(d.platform);
      setMessage(d.message);
      if (d.platform !== "wordpress") setStep(2);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function connect(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    const f = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const result = await call("/connect", {
        existingStoreId: existing?.id,
        name: f.name,
        domain,
        platform,
        currency: f.currency,
        intervalMinutes: Number(f.intervalMinutes),
        credentials: {
          key: f.key || undefined,
          secret: f.secret || undefined,
          token: f.token || undefined,
          webhookSecret: f.webhookSecret || undefined,
        },
        ...(platform === "custom" ? { custom: JSON.parse(mapping) } : {}),
      });
      if (result.webhookSecret)
        setWebhook({
          url: window.location.origin + "/api/webhooks/" + result.storeId,
          secret: result.webhookSecret,
        });
      else onConnected(result.message);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (webhook)
    return (
      <div className="connect-form">
        <div className="modal-icon">
          <CheckCircle2 />
        </div>
        <h2>فروشگاه متصل شد</h2>
        <p>
          واردسازی خودکار آغاز شد. برای دریافت رویداد لحظه‌ای، وب‌هوک زیر را در
          فروشگاه تنظیم کنید.
        </p>
        <label>
          آدرس وب‌هوک
          <input readOnly dir="ltr" value={webhook.url} />
        </label>
        <label>
          راز امضای وب‌هوک — فقط همین‌بار نمایش داده می‌شود
          <input readOnly dir="ltr" value={webhook.secret} />
        </label>
        <p className="muted">
          WooCommerce: تنظیمات ← پیشرفته ← وب‌هوک‌ها؛ رویدادهای ایجاد، ویرایش و
          حذف محصول. برای API اختصاصی از HMAC-SHA256 و هدر
          X-PricePilot-Signature با خروجی Base64 استفاده کنید.
        </p>
        <button
          className="primary"
          onClick={() =>
            onConnected("اتصال برقرار شد؛ واردسازی خودکار در حال اجراست.")
          }
        >
          مشاهده روند واردسازی
          <ArrowLeft size={16} />
        </button>
      </div>
    );
  return (
    <div className="connect-form">
      <div className="modal-icon">
        <PlugZap />
      </div>
      <span className="eyebrow">CONNECT ONCE. STAY IN SYNC.</span>
      <h2>فروشگاهت را متصل کن</h2>
      <p className="muted">
        دسترسی فقط خواندن کافی است. محصولات و تنوع‌ها به‌صورت خودکار دریافت
        می‌شوند.
      </p>
      <div className="connection-steps">
        <span className="current">۱. آدرس فروشگاه</span>
        <span className={step === 2 ? "current" : ""}>۲. دسترسی امن</span>
        <span>۳. واردسازی خودکار</span>
      </div>
      <form onSubmit={connect}>
        <label>
          نام فروشگاه
          <input
            name="name"
            defaultValue={existing?.name}
            required
            minLength={2}
            maxLength={100}
            placeholder="فروشگاه من"
          />
        </label>
        <label>
          آدرس HTTPS فروشگاه
          <div className="detect-row">
            <input
              aria-label="آدرس HTTPS فروشگاه"
              name="domain"
              type="url"
              required
              dir="ltr"
              placeholder="https://shop.example.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
            />
            <button
              className="secondary"
              type="button"
              disabled={busy || !domain}
              onClick={detect}
            >
              {busy ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <Search size={16} />
              )}
              تشخیص
            </button>
          </div>
        </label>
        <label>
          پلتفرم فروشگاه
          <select
            name="platform"
            value={platform}
            onChange={(e) => {
              setPlatform(e.target.value);
              setStep(2);
            }}
          >
            <option value="auto">تشخیص خودکار</option>
            <option value="woocommerce">
              WooCommerce / WordPress + WooCommerce
            </option>
            <option value="shopify">Shopify</option>
            <option value="prestashop">PrestaShop</option>
            <option value="custom">API اختصاصی / REST</option>
            <option value="sazito">Sazito — نیازمند دسترسی رسمی</option>
            <option value="wordpress">WordPress بدون WooCommerce</option>
          </select>
        </label>
        {platform === "sazito" ? (
          <div className="import-warning">
            <AlertTriangle size={19} />
            <p>
              API رسمی کاتالوگ سازیتو در این نسخه تأیید نشده است. مستندات و
              دسترسی مجاز را از پشتیبانی سازیتو بگیرید؛ در صورت ارائه REST API،
              گزینه API اختصاصی را با نگاشت مستند تنظیم کنید.
            </p>
          </div>
        ) : platform === "wordpress" ? (
          <div className="import-warning">
            وردپرس به‌تنهایی API محصولات فروشگاهی ندارد. WooCommerce REST API یا
            یک API مجاز اختصاصی لازم است.
          </div>
        ) : (
          <>
            {platform === "woocommerce" && (
              <>
                <label>
                  Consumer key
                  <input
                    name="key"
                    type="password"
                    dir="ltr"
                    autoComplete="off"
                    placeholder="ck_…"
                    required
                  />
                </label>
                <label>
                  Consumer secret
                  <input
                    name="secret"
                    type="password"
                    dir="ltr"
                    autoComplete="off"
                    placeholder="cs_…"
                    required
                  />
                </label>
                <p className="credential-hint">
                  <KeyRound size={14} />
                  ووکامرس ← تنظیمات ← پیشرفته ← REST API؛ مجوز Read انتخاب کنید.
                </p>
              </>
            )}
            {platform === "shopify" && (
              <>
                <label>
                  Admin API access token
                  <input
                    name="token"
                    type="password"
                    dir="ltr"
                    autoComplete="off"
                    required
                  />
                </label>
                <p className="credential-hint">
                  دامنه اصلی myshopify.com و مجوزهای read_products و
                  read_inventory لازم است. فقط کاتالوگ با واحد IRR پشتیبانی
                  می‌شود؛ تبدیل ارز خارجی خودکار نیست.
                </p>
                <label>
                  App client secret برای وب‌هوک (اختیاری)
                  <input
                    name="webhookSecret"
                    type="password"
                    dir="ltr"
                    autoComplete="off"
                  />
                </label>
              </>
            )}
            {platform === "prestashop" && (
              <>
                <label>
                  Webservice key
                  <input
                    name="key"
                    type="password"
                    dir="ltr"
                    autoComplete="off"
                    required
                  />
                </label>
                <p className="credential-hint">
                  مجوز GET برای products، combinations و stock_availables لازم
                  است. قیمت پایه بدون قوانین مالیات و تخفیف گروه مشتری دریافت
                  می‌شود.
                </p>
              </>
            )}
            {platform === "custom" && (
              <>
                <label>
                  API token / نام کاربری
                  <input
                    name="key"
                    type="password"
                    dir="ltr"
                    autoComplete="off"
                  />
                </label>
                <label>
                  Bearer token / مقدار هدر
                  <input
                    name="token"
                    type="password"
                    dir="ltr"
                    autoComplete="off"
                  />
                </label>
                <label>
                  رمز Basic authentication
                  <input
                    name="secret"
                    type="password"
                    dir="ltr"
                    autoComplete="off"
                  />
                </label>
                <details className="mapping-details" open>
                  <summary>تنظیم مسیر، صفحه‌بندی و نگاشت JSON</summary>
                  <p className="muted">
                    تنظیم یک‌باره با مستندات API فروشگاه؛ id باید پایدار باشد.
                    endpoint باید روی همین دامنه باشد.
                  </p>
                  <textarea
                    aria-label="نگاشت JSON"
                    dir="ltr"
                    rows={12}
                    value={mapping}
                    onChange={(e) => setMapping(e.target.value)}
                  />
                </details>
              </>
            )}
            <div className="form-grid">
              <label>
                واحد قیمت API
                <select
                  name="currency"
                  defaultValue={platform === "shopify" ? "IRR" : "IRT"}
                  key={platform}
                >
                  <option value="IRT">تومان (IRT)</option>
                  <option value="IRR">ریال (IRR → تومان)</option>
                </select>
              </label>
              <label>
                فاصله همگام‌سازی
                <select name="intervalMinutes" defaultValue="60">
                  {intervals.map((i) => (
                    <option value={i} key={i}>
                      هر {intervalLabel(i)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="credential-hint">
              <ShieldCheck size={15} />
              کلیدها رمزنگاری می‌شوند؛ قیمت فروشگاه تغییر نمی‌کند.
            </div>
            <button className="primary" disabled={busy || platform === "auto"}>
              {busy ? (
                <Loader2 className="spin" size={17} />
              ) : (
                <PlugZap size={17} />
              )}
              آزمون اتصال و واردسازی خودکار
            </button>
          </>
        )}
        {message && (
          <div role="status" className="import-warning">
            {message}
          </div>
        )}
      </form>
      <button className="text-button" onClick={onSandbox}>
        فقط می‌خواهم فروشگاه آزمایشی بدون API بسازم
      </button>
    </div>
  );
}
export function ImportDashboard({
  onConnect,
  onReconnect,
}: {
  onConnect: () => void;
  onReconnect: (store: any) => void;
}) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState<string | null>(null),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all");
  useEffect(() => {
    let live = true,
      running = false;
    async function load() {
      if (running) return;
      running = true;
      try {
        const d = await call("");
        if (live) {
          setData(d);
          setError("");
        }
      } catch (e) {
        if (live) setError((e as Error).message);
      } finally {
        running = false;
      }
    }
    void load();
    const t = setInterval(load, 3000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  async function control(
    storeId: string,
    action: string,
    intervalMinutes?: number,
  ) {
    setBusy(storeId);
    try {
      await call("/control", { storeId, action, intervalMinutes });
      setData(await call(""));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  if (!data)
    return (
      <div className="panel import-loading">
        {error || (
          <>
            <Loader2 className="spin" />
            در حال دریافت وضعیت اتصال‌ها…
          </>
        )}
      </div>
    );
  const latest = (s: any) => data.runs.find((r: any) => r.store_id === s.id);
  const stores = data.stores
    .filter((s: any) => s.name.includes(search) || s.domain.includes(search))
    .filter(
      (s: any) =>
        filter === "all" ||
        (filter === "paused" && s.paused) ||
        (filter === "error" && s.last_error) ||
        (filter === "active" && !s.paused),
    );
  const sum = (key: string) =>
    data.stores.reduce((n: number, s: any) => n + Number(s[key] || 0), 0);
  const latestRuns = data.stores.map(latest).filter(Boolean);
  return (
    <div className="imports-dashboard">
      <div className="import-hero">
        <div className="import-orbit">
          <RefreshCw size={30} />
        </div>
        <div>
          <span className="eyebrow">YOUR CATALOG. ALWAYS CONNECTED.</span>
          <h2>یک اتصال؛ همیشه به‌روز.</h2>
          <p>
            دریافت خودکار محصولات، تنوع‌ها و موجودی؛ بدون ورود دستی اطلاعات.
          </p>
        </div>
        <button className="primary" onClick={onConnect}>
          <Plus size={17} />
          اتصال فروشگاه
        </button>
      </div>
      <div className="import-stats">
        {[
          {
            label: "کل محصولات واردشده",
            value: sum("product_count"),
            icon: Package,
          },
          {
            label: "همگام‌شده در آخرین اجرا",
            value: latestRuns.reduce((n: number, r: any) => n + r.processed, 0),
            icon: CheckCircle2,
          },
          {
            label: "محصول جدید در آخرین اجرا",
            value: latestRuns.reduce((n: number, r: any) => n + r.new_count, 0),
            icon: Plus,
          },
          {
            label: "منتظر تطبیق ترب",
            value: sum("awaiting_match"),
            icon: Link2,
          },
          {
            label: "اجراهای ناموفق",
            value: data.runStats?.failed || 0,
            icon: AlertTriangle,
          },
        ].map((s) => (
          <div className="panel" key={s.label}>
            <s.icon size={21} />
            <span>{s.label}</span>
            <strong>{fa(s.value)}</strong>
          </div>
        ))}
      </div>
      {!data.matchingAvailable && (
        <div className="import-warning">
          <Link2 size={18} />
          <p>
            جستجوی خودکار ترب نیازمند منبع کشف مجاز است. محصولات وارد می‌شوند و
            برای تطبیق در صف می‌مانند؛ هیچ لینک یا قیمت رقیبی ساخته نمی‌شود. API
            بارچین مخصوص فروشندگانِ یک لینک موجود است و جایگزین جستجو نیست.
          </p>
        </div>
      )}
      {data.matchingStats?.some(
        (s: any) => s.status === "awaiting_competitor_provider",
      ) && (
        <div className="import-warning">
          <ShieldCheck size={18} />
          <p>
            تطبیق‌های مطمئن ذخیره شده‌اند. دریافت قیمت رقبا از بارچین تا تأیید
            مستندات و تنظیم دسترسی واقعی غیرفعال است؛ هیچ قیمت حدسی برای موتور
            قیمت‌گذاری ارسال نمی‌شود.
          </p>
        </div>
      )}
      {error && (
        <div role="alert" className="import-warning">
          {error}
        </div>
      )}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>مرکز همگام‌سازی</h3>
            <p>
              <Radio size={11} /> وضعیت زنده · هر ۳ ثانیه به‌روزرسانی می‌شود
            </p>
          </div>
          <div className="import-filters">
            <label className="search">
              <Search size={15} />
              <input
                aria-label="جستجوی اتصال"
                placeholder="جستجوی فروشگاه…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <select
              aria-label="فیلتر وضعیت اتصال"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">همه اتصال‌ها</option>
              <option value="active">فعال</option>
              <option value="paused">متوقف</option>
              <option value="error">نیازمند بررسی</option>
            </select>
          </div>
        </div>
        {stores.map((s: any) => {
          const r = latest(s);
          const progress =
            r?.status === "succeeded"
              ? 100
              : r?.total_estimate
                ? Math.min(
                    99,
                    Math.round((r.processed / r.total_estimate) * 100),
                  )
                : null;
          return (
            <article className="sync-store" key={s.id}>
              <div className="sync-store-heading">
                <div className="store-logo">
                  <Store size={24} />
                </div>
                <div>
                  <h3>{s.name}</h3>
                  <a href={s.domain} target="_blank" rel="noreferrer" dir="ltr">
                    {s.domain}
                  </a>
                </div>
                <span
                  className={
                    "badge " +
                    (s.last_error ? "amber" : s.paused ? "" : "green")
                  }
                >
                  {s.paused
                    ? "متوقف"
                    : s.last_error
                      ? "نیازمند بررسی"
                      : "متصل · فقط خواندن"}
                </span>
              </div>
              <div className="sync-progress-top">
                <span>{r ? states[r.status] : "در انتظار اولین اجرا"}</span>
                <b>
                  {fa(r?.processed)} محصول پردازش شده{" "}
                  {progress !== null ? " · " + fa(progress) + "٪" : ""}
                </b>
              </div>
              <div
                role="progressbar"
                aria-label={"واردسازی " + s.name}
                aria-valuenow={progress ?? undefined}
                aria-valuemin={0}
                aria-valuemax={100}
                className={
                  "sync-progress " + (progress === null ? "indeterminate" : "")
                }
              >
                <span
                  style={{ width: progress === null ? "30%" : progress + "%" }}
                />
              </div>
              <div className="sync-metrics">
                <span>
                  جدید <b>{fa(r?.new_count)}</b>
                </span>
                <span>
                  ویرایش <b>{fa(r?.updated_count)}</b>
                </span>
                <span>
                  بدون تغییر <b>{fa(r?.unchanged_count)}</b>
                </span>
                <span className={r?.failed_count ? "warning-text" : ""}>
                  تلاش ناموفق <b>{fa(r?.failed_count)}</b>
                </span>
              </div>
              {s.last_error && (
                <div className="sync-error">
                  <AlertTriangle size={15} />
                  {errors[s.last_error] || s.last_error}
                </div>
              )}
              <div className="sync-schedule">
                <span>
                  <Clock size={13} />
                  آخرین موفق: {time(s.last_success_at)}
                </span>
                <span>
                  اجرای بعدی: {s.paused ? "پس از ادامه" : time(s.next_sync_at)}
                </span>
              </div>
              <div className="sync-controls">
                <label>
                  برنامه همگام‌سازی
                  <select
                    aria-label={"فاصله همگام‌سازی " + s.name}
                    value={s.interval_minutes}
                    disabled={busy === s.id}
                    onChange={(e) =>
                      control(
                        s.id,
                        s.paused ? "pause" : "resume",
                        Number(e.target.value),
                      )
                    }
                  >
                    {intervals.map((i) => (
                      <option value={i} key={i}>
                        هر {intervalLabel(i)}
                      </option>
                    ))}
                  </select>
                </label>
                <div>
                  <button className="secondary" onClick={() => onReconnect(s)}>
                    <KeyRound size={15} />
                    کلید جدید
                  </button>
                  <button
                    className="secondary"
                    disabled={busy === s.id}
                    onClick={() => control(s.id, s.paused ? "resume" : "pause")}
                  >
                    {s.paused ? <Play size={15} /> : <Pause size={15} />}{" "}
                    {s.paused ? "ادامه" : "توقف"}
                  </button>
                  <button
                    className="secondary"
                    disabled={busy === s.id || s.paused}
                    onClick={() => control(s.id, "refresh")}
                  >
                    <RefreshCw
                      size={15}
                      className={busy === s.id ? "spin" : ""}
                    />{" "}
                    تازه‌سازی
                  </button>
                </div>
              </div>
            </article>
          );
        })}
        {!stores.length && (
          <div className="empty">
            <div>
              <PlugZap size={30} />
            </div>
            <h3>فروشگاهت را به PricePilot وصل کن</h3>
            <p>آدرس و کلید خواندن API را وارد کن؛ بقیه مسیر خودکار است.</p>
            <button className="primary" onClick={onConnect}>
              <PlugZap size={16} />
              اتصال اولین فروشگاه
            </button>
          </div>
        )}
      </section>
      {data.errors.length > 0 && (
        <section className="panel import-log">
          <div className="panel-heading">
            <div>
              <h3>رویدادهای نیازمند بررسی</h3>
              <p>اطلاعات حساس و پاسخ خام API در گزارش‌ها ذخیره نمی‌شود.</p>
            </div>
          </div>
          {data.errors.map((e: any, i: number) => (
            <div className="event" key={i}>
              <AlertTriangle size={16} />
              <span>{errors[e.code] || e.code}</span>
              <small>{time(e.created_at)}</small>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
export function ImportedCatalog({
  onManage,
  stores,
}: {
  onManage: (product: any) => void;
  stores: any[];
}) {
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [store, setStore] = useState(""),
    [page, setPage] = useState(1),
    [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    async function load() {
      try {
        const d = await call(
          "/products?" +
            new URLSearchParams({ page: String(page), search, filter, store }),
        );
        if (live) {
          setData(d);
          setError("");
        }
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    }
    const t = setTimeout(load, 250),
      poll = setInterval(load, 5000);
    return () => {
      live = false;
      clearTimeout(t);
      clearInterval(poll);
    };
  }, [page, search, filter, store]);
  return (
    <section className="panel catalog-panel">
      <div className="panel-heading">
        <div>
          <h3>
            کاتالوگ فروشگاه‌ها
            <span className="count-chip">{fa(data?.total)}</span>
          </h3>
          <p>
            شناسه پایدار برای هر محصول و تنوع؛ اطلاعات از API فروشگاه به‌روز
            می‌شود.
          </p>
        </div>
        <a className="secondary" href="/api/export">
          خروجی CSV
        </a>
      </div>
      <div className="catalog-filters">
        <label className="search">
          <Search size={16} />
          <input
            aria-label="جستجوی کاتالوگ"
            value={search}
            placeholder="جستجوی محصول یا SKU…"
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <select
          aria-label="فیلتر کاتالوگ"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">همه محصولات</option>
          <option value="imported">دریافت‌شده از API</option>
          <option value="review">منتظر تطبیق</option>
          <option value="matched">تطبیق تأییدشده</option>
          <option value="unavailable">ناموجود / حذف‌شده در مبدأ</option>
        </select>
        <select
          aria-label="فیلتر فروشگاه"
          value={store}
          onChange={(e) => {
            setStore(e.target.value);
            setPage(1);
          }}
        >
          <option value="">همه فروشگاه‌ها</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <div role="alert" className="import-warning">
          {error}
        </div>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>محصول / تنوع</th>
              <th>فروشگاه</th>
              <th>قیمت فعلی</th>
              <th>موجودی</th>
              <th>تطبیق ترب</th>
              <th>آخرین دریافت</th>
              <th>عملیات</th>
            </tr>
          </thead>
          <tbody>
            {data?.products.map((p: any) => (
              <tr key={p.id}>
                <td>
                  <div className="product-cell">
                    <span className="product-image">
                      {p.images?.[0] ? (
                        <img
                          src={p.images[0]}
                          alt=""
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <Package size={22} />
                      )}
                    </span>
                    <span>
                      <b>{p.title}</b>
                      <small dir="ltr">{p.source_sku || p.sku}</small>
                      {p.parent_external_id && (
                        <span className="variant-label">تنوع مستقل</span>
                      )}
                    </span>
                  </div>
                </td>
                <td>{p.store_name}</td>
                <td className="numeric">
                  {fa(p.price)} <small>تومان</small>
                </td>
                <td>
                  <span
                    className={
                      "badge " +
                      (p.stock > 0 && p.availability === "available"
                        ? "green"
                        : "amber")
                    }
                  >
                    {p.availability === "unavailable" ? "ناموجود" : fa(p.stock)}
                  </span>
                </td>
                <td>
                  <span
                    className={
                      "badge " + (p.match_verified ? "green" : "amber")
                    }
                  >
                    {p.match_verified
                      ? "تأییدشده" +
                        (p.match_confidence
                          ? " · " + fa(p.match_confidence) + "٪"
                          : "")
                      : "نیازمند بررسی"}
                  </span>
                </td>
                <td className="muted">
                  {p.last_synced_at ? time(p.last_synced_at) : "ثبت دستی"}
                </td>
                <td>
                  <button className="row-action" onClick={() => onManage(p)}>
                    مدیریت
                    <ArrowLeft size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && !data.products.length && (
        <div className="empty">
          <div>
            <Package size={28} />
          </div>
          <h3>محصولی در این فیلتر نیست</h3>
          <p>پس از اتصال API، محصولات به‌صورت خودکار اینجا ظاهر می‌شوند.</p>
        </div>
      )}
      {!data && !error && (
        <div className="import-loading">
          <Loader2 className="spin" />
          در حال دریافت کاتالوگ…
        </div>
      )}
      <div className="table-footer">
        <span>
          {fa(data?.total)} محصول · صفحه {fa(page)}
        </span>
        <div>
          <button
            className="secondary"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            قبلی
          </button>
          <button
            className="secondary"
            disabled={!data || page * 50 >= data.total}
            onClick={() => setPage(page + 1)}
          >
            بعدی
          </button>
        </div>
      </div>
    </section>
  );
}
export function MatchCandidates({
  product,
  onApproved,
}: {
  product: any;
  onApproved: () => void;
}) {
  const [candidates, setCandidates] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void call("/candidates?productId=" + product.id)
      .then((d) => {
        if (live) setCandidates(d.candidates);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [product.id]);
  async function approve(c: any) {
    setBusy(true);
    try {
      const r = await fetch("/api/products/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: product.id,
          url: c.url,
          confirmed: true,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      onApproved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!candidates.length) return null;
  return (
    <div className="match-candidates">
      <h3>تطبیق‌های پیشنهادی منبع مجاز</h3>
      <p className="muted">
        مدل، رنگ، ظرفیت و گارانتی را پیش از تأیید بررسی کنید.
      </p>
      {candidates.map((c) => (
        <article key={c.id}>
          <a href={c.url} target="_blank" rel="noreferrer">
            {c.title}
          </a>
          <span className="badge">{fa(c.score)}٪ اطمینان</span>
          <details>
            <summary>مشخصات</summary>
            <pre dir="ltr">{JSON.stringify(c.details.attributes, null, 2)}</pre>
          </details>
          <label>
            <input type="checkbox" id={"confirm-" + c.id} />
            مشخصات مهم را بررسی کردم
          </label>
          <button
            disabled={busy}
            className="secondary"
            onClick={() => {
              if (
                !(
                  document.getElementById("confirm-" + c.id) as HTMLInputElement
                )?.checked
              ) {
                setError("ابتدا تطبیق مشخصات مهم را تأیید کنید.");
                return;
              }
              void approve(c);
            }}
          >
            تأیید این تطبیق
          </button>
        </article>
      ))}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
