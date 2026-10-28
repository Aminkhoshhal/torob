"use client";
import {
  ConnectStore,
  ImportDashboard,
  ImportedCatalog,
  MatchCandidates,
} from "./import-dashboard";
import { useEffect, useState, type FormEvent } from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpLeft,
  ArrowLeft,
  BarChart3,
  Bell,
  Check,
  ChevronDown,
  ChevronLeft,
  CheckCircle2,
  Command,
  CreditCard,
  Download,
  ExternalLink,
  FlaskConical,
  Globe,
  HelpCircle,
  LayoutDashboard,
  Link2,
  Loader2,
  LogOut,
  Package,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Store,
  TrendingUp,
  Wallet,
  Zap,
  X,
  Undo2,
  Sun,
  Moon,
} from "lucide-react";
const money = (v: unknown) =>
  new Intl.NumberFormat("fa-IR").format(Number(v || 0));
const date = (v: string) =>
  new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Tehran",
  }).format(new Date(v));
type Data = {
  user: any;
  organization: any;
  wallet: any;
  products: any[];
  productStats?: any;
  stores: any[];
  recommendations: any[];
  ledger: any[];
  history: any[];
  logs: any[];
  plans: any[];
};
async function api(path: string, body?: unknown) {
  const r = await fetch("/api/" + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "خطا در ارتباط");
  return d;
}
const nav = [
  { id: "overview", label: "نمای کلی", icon: LayoutDashboard },
  { id: "products", label: "محصولات", icon: Package },
  { id: "stores", label: "فروشگاه‌ها", icon: Store },
  { id: "pricing", label: "قیمت‌گذاری هوشمند", icon: Sparkles },
  { id: "history", label: "گزارش تغییرات", icon: BarChart3 },
  { id: "wallet", label: "کیف پول و اشتراک", icon: Wallet },
];
export default function Page() {
  const [data, setData] = useState<Data | null>(null),
    [loading, setLoading] = useState(true),
    [page, setPage] = useState("overview"),
    [auth, setAuth] = useState("login"),
    [modal, setModal] = useState<string | null>(null),
    [selected, setSelected] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [toast, setToast] = useState(""),
    [search, setSearch] = useState(""),
    [dark, setDark] = useState(true),
    [menu, setMenu] = useState(false),
    [simulation, setSimulation] = useState<any>(null);
  async function refresh() {
    try {
      setData(await api("overview"));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
  }, []);
  useEffect(() => {
    if (!data) return;
    let live = true;
    const t = setInterval(() => {
      void api("overview")
        .then((d) => {
          if (live) setData(d);
        })
        .catch(() => {});
    }, 10000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [!!data]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 6000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  async function perform(
    path: string,
    body: unknown,
    success = "با موفقیت ذخیره شد",
  ) {
    setBusy(true);
    try {
      const r = await api(path, body);
      await refresh();
      setToast(r.message || success);
      setModal(null);
      return r;
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function open(m: string, p?: any) {
    setSelected(p || null);
    setSimulation(null);
    setModal(m);
  }
  function values(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    return Object.fromEntries(new FormData(e.currentTarget));
  }
  async function sign(e: FormEvent<HTMLFormElement>) {
    const f = values(e);
    setBusy(true);
    try {
      await api("auth/" + auth, f);
      await refresh();
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <div className="loading">
        <div className="brand-symbol">
          <Zap />
        </div>
        <Loader2 className="spin" />
        <p>در حال آماده‌سازی فضای کاری شما…</p>
      </div>
    );
  if (!data)
    return (
      <main className="auth">
        <div className="auth-art">
          <div className="brand">
            <div className="brand-symbol">
              <Zap fill="currentColor" />
            </div>
            <span>
              PricePilot<span className="ai">AI</span>
            </span>
          </div>
          <div className="orb" />
          <span className="eyebrow">آینده قیمت‌گذاری، همین امروز</span>
          <h1>
            یک قدم جلوتر
            <br />
            از <em>بازار</em> باش.
          </h1>
          <p>
            رقبا را زیر نظر بگیر، از سودت محافظت کن و با اطمینان قیمت‌گذاری کن.
          </p>
          <div className="auth-feature">
            <ShieldCheck /> سود شما، خط قرمز ماست.
          </div>
          <div className="mini-terminal">
            <span className="dot" /> موتور قیمت‌گذاری دقیق و قابل توضیح{" "}
            <span className="tag">Decimal</span>
            <div>قیمت امن = هزینه خرید ÷ (۱ − حاشیه سود)</div>
          </div>
          <small>نسخه توسعه · پرداخت و انتشار قیمت فقط آزمایشی</small>
        </div>
        <section className="auth-form">
          <span className="tag">خوش آمدید به پایلوت قیمت شما</span>
          <h2>
            {auth === "login" ? "ورود به فضای کاری" : "کسب‌وکارت را هوشمند کن"}
          </h2>
          <p className="muted">
            {auth === "login"
              ? "برای مدیریت فروشگاه وارد حساب خود شوید."
              : "یک فضای کاری مستقل برای فروشگاه خود بسازید."}
          </p>
          <form onSubmit={sign}>
            {auth === "register" && (
              <>
                <Field label="نام شما" name="name" required />
                <Field label="نام کسب‌وکار" name="organization" required />
              </>
            )}
            <Field label="ایمیل" name="email" type="email" required dir="ltr" />
            <Field
              label="رمز عبور (حداقل ۱۰ کاراکتر)"
              name="password"
              type="password"
              minLength={10}
              maxLength={72}
              required
              dir="ltr"
            />
            <button disabled={busy} className="primary">
              {busy ? (
                <Loader2 className="spin" />
              ) : auth === "login" ? (
                "ورود به حساب"
              ) : (
                "ساخت فضای کاری"
              )}
              <ArrowLeft size={17} />
            </button>
          </form>
          <button
            className="text-button"
            onClick={() => setAuth(auth === "login" ? "register" : "login")}
          >
            {auth === "login"
              ? "حساب ندارید؟ ثبت‌نام کنید"
              : "قبلاً ثبت‌نام کرده‌اید؟ وارد شوید"}
          </button>
          <div className="sandbox-note">
            <FlaskConical size={18} />
            محیط آزمایشی؛ هیچ پرداخت یا تغییر قیمت واقعی انجام نمی‌شود.
          </div>
        </section>
        {toast && (
          <div role="status" className="toast">
            {toast}
          </div>
        )}
      </main>
    );
  const { products, stores, recommendations, organization, wallet } = data;
  const totalProducts = Number(data.productStats?.total ?? products.length);
  const matched = Number(
    data.productStats?.matched ??
      products.filter((p) => p.match_verified).length,
  );
  const pending = recommendations.filter((r) => r.status === "PENDING");
  const active =
    organization.subscription_until &&
    new Date(organization.subscription_until) > new Date();
  const filtered = products.filter((p) =>
    (p.title + " " + p.sku).toLowerCase().includes(search.toLowerCase()),
  );
  const titles: Record<string, string> = {
    overview: "نمای کلی",
    products: "مدیریت محصولات",
    stores: "فروشگاه‌های متصل",
    pricing: "استودیوی قیمت‌گذاری",
    history: "گزارش تغییرات",
    wallet: "کیف پول و اشتراک",
  };
  return (
    <div className={"app " + (menu ? "menu-open" : "")}>
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="PricePilot">
          <div className="brand-symbol">
            <Zap fill="currentColor" size={22} />
          </div>
          <span>
            PricePilot<span className="ai">AI</span>
          </span>
        </a>
        <button
          className="workspace"
          onClick={() => {
            setPage("stores");
            setMenu(false);
          }}
        >
          <div className="workspace-icon">{organization.name.slice(0, 1)}</div>
          <div>
            <b>{organization.name}</b>
            <small>فضای کاری شما</small>
          </div>
          <ChevronDown size={16} />
        </button>
        <div className="nav-caption">فضای مدیریت</div>
        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              className={page === n.id ? "active" : ""}
              onClick={() => {
                setPage(n.id);
                setMenu(false);
              }}
            >
              <n.icon size={19} />
              {n.label}
              {n.id === "products" && (
                <span className="nav-count">{money(totalProducts)}</span>
              )}
              {n.id === "pricing" && <span className="new">AI</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="upgrade">
            <div className="upgrade-icon">
              <Sparkles size={20} />
            </div>
            <b>هوشمندانه‌تر رقابت کن</b>
            <p>ظرفیت بیشتر، تصمیم‌های بهتر.</p>
            <button onClick={() => setPage("wallet")}>
              مشاهده طرح‌ها <ArrowUpLeft size={16} />
            </button>
          </div>
          <button className="help" onClick={() => open("help")}>
            <HelpCircle size={18} />
            راهنمای شروع
            <ExternalLink size={14} />
          </button>
          <button
            className="profile"
            onClick={() => perform("auth/logout", {}, "از حساب خارج شدید")}
          >
            <span className="avatar">{data.user.name.slice(0, 1)}</span>
            <span>
              <b>{data.user.name}</b>
              <small>
                {data.user.role === "owner" ? "مالک کسب‌وکار" : data.user.role}
              </small>
            </span>
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="main">
        <header>
          <div className="breadcrumb">
            <button className="mobile-menu" onClick={() => setMenu(!menu)}>
              <Command size={20} />
            </button>
            <span>فضای کاری</span>
            <ChevronLeft size={14} />
            <b>{titles[page]}</b>
          </div>
          <div className="header-actions">
            <span className="system-state">
              <span className="dot" />
              محیط آزمایشی
            </span>
            <button aria-label="تغییر ظاهر" onClick={() => setDark(!dark)}>
              {dark ? <Sun size={19} /> : <Moon size={19} />}
            </button>
            <button aria-label="رویدادها" onClick={() => open("events")}>
              <Bell size={19} />
              {pending.length > 0 && <i />}
            </button>
            <span className="header-avatar">{data.user.name.slice(0, 1)}</span>
          </div>
        </header>
        <main className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">PRICE INTELLIGENCE, ON AUTOPILOT</div>
              <h1>
                {page === "overview"
                  ? `سلام ${data.user.name.split(" ")[0]}، به پنل خودت خوش آمدی`
                  : titles[page]}
                <span className="heading-dot">.</span>
              </h1>
              <p>
                {page === "overview"
                  ? "نبض بازار در دستان توست. امروز با اطمینان تصمیم بگیر."
                  : "همه چیز برای کنترل دقیق قیمت و محافظت از سود شما."}
              </p>
            </div>
            <div className="heading-actions">
              <span className="today">
                {new Intl.DateTimeFormat("fa-IR", {
                  dateStyle: "long",
                  timeZone: "Asia/Tehran",
                }).format(new Date())}
              </span>
              <button
                className="primary"
                onClick={() =>
                  open(
                    page === "stores"
                      ? "store"
                      : page === "wallet"
                        ? "recharge"
                        : "product",
                  )
                }
              >
                <Plus size={17} />
                {page === "stores"
                  ? "افزودن فروشگاه"
                  : page === "wallet"
                    ? "شارژ آزمایشی"
                    : "افزودن محصول"}
              </button>
            </div>
          </div>
          <div className="sandbox-banner">
            <FlaskConical size={18} />
            <span>
              <b>فضای آزمایش امن</b> · پرداخت و انتشار قیمت آزمایشی است. اتصال
              API می‌تواند کاتالوگ واقعی را فقط بخواند؛ قیمت فروشگاه تغییر
              نمی‌کند.
            </span>
            <ShieldCheck size={18} />
          </div>
          {page === "overview" && (
            <>
              <section className="stats">
                <Stat
                  label="محصولات شما"
                  value={money(totalProducts)}
                  icon={Package}
                  detail={`${money(organization.product_limit)} محصول ظرفیت طرح`}
                  color="blue"
                />
                <Stat
                  label="تطبیق تأییدشده"
                  value={money(matched)}
                  icon={Link2}
                  detail={
                    products.length
                      ? `${money(Math.round((matched / totalProducts) * 100))}٪ کاتالوگ تأیید شده`
                      : "منتظر اولین محصول شما"
                  }
                  color="purple"
                />
                <Stat
                  label="پیشنهادهای در انتظار"
                  value={money(pending.length)}
                  icon={TrendingUp}
                  detail="بررسی شما، قبل از هر تغییر"
                  color="green"
                />
                <Stat
                  label="اعتبار آزمایشی"
                  value={money(wallet.balance)}
                  unit="تومان"
                  icon={Wallet}
                  detail="جدا از پرداخت واقعی"
                  color="orange"
                />
              </section>
              <section className="overview-grid">
                <div className="panel chart-panel">
                  <div className="panel-heading">
                    <div>
                      <h3>مسیر تغییرات قیمت</h3>
                      <p>قیمت‌های ثبت‌شده در کاتالوگ آزمایشی</p>
                    </div>
                    <span className="tag">
                      <span className="dot" /> تاریخچه واقعی این حساب
                    </span>
                  </div>
                  {data.history.length ? (
                    <HistoryChart history={data.history} />
                  ) : (
                    <div className="chart-empty">
                      <div className="grid-lines" />
                      <div className="empty-chart-icon">
                        <Activity size={30} />
                      </div>
                      <b>هر تصمیم، یک نقطه روی مسیر</b>
                      <p>
                        پس از تأیید اولین پیشنهاد قیمت، نمودار شما اینجا شکل
                        می‌گیرد.
                      </p>
                      <button
                        className="text-button"
                        onClick={() => setPage("pricing")}
                      >
                        شروع شبیه‌سازی <ArrowLeft size={15} />
                      </button>
                    </div>
                  )}
                  <div className="chart-footer">
                    <span>
                      <i className="legend blue-bg" />
                      قیمت پیشین
                    </span>
                    <span>
                      <i className="legend purple-bg" />
                      قیمت پیشنهادی
                    </span>
                    <span className="muted">همه مبالغ به تومان</span>
                  </div>
                </div>
                <div className="panel journey">
                  <div className="panel-heading">
                    <div>
                      <h3>آماده برای اولین پرواز؟</h3>
                      <p>فقط چند قدم تا تصمیم هوشمند</p>
                    </div>
                    <span className="progress-ring">
                      {money(
                        [
                          active,
                          stores.length > 0,
                          products.length > 0,
                          matched > 0,
                        ].filter(Boolean).length,
                      )}
                      /۴
                    </span>
                  </div>
                  {[
                    {
                      done: active,
                      title: "فعال‌سازی اشتراک آزمایشی",
                      sub: "طرح مناسب کسب‌وکارت را انتخاب کن",
                      action: () => setPage("wallet"),
                    },
                    {
                      done: stores.length > 0,
                      title: "ساخت فروشگاه آزمایشی",
                      sub: "کاتالوگ خود را سازماندهی کن",
                      action: () => open("store"),
                    },
                    {
                      done: products.length > 0,
                      title: "افزودن اولین محصول",
                      sub: "هزینه خرید و موجودی را وارد کن",
                      action: () => open("product"),
                    },
                    {
                      done: matched > 0,
                      title: "تأیید تطبیق محصول",
                      sub: "لینک دقیق محصول ترب را بررسی کن",
                      action: () => setPage("products"),
                    },
                  ].map((s, i) => (
                    <button
                      className={"journey-step " + (s.done ? "done" : "")}
                      key={i}
                      onClick={s.action}
                    >
                      <span>{s.done ? <Check size={15} /> : money(i + 1)}</span>
                      <div>
                        <b>{s.title}</b>
                        <small>{s.sub}</small>
                      </div>
                      <ChevronLeft size={16} />
                    </button>
                  ))}
                  <div className="security-note">
                    <ShieldCheck size={16} />
                    انتشار خودکار همواره به تأیید صریح نیاز دارد.
                  </div>
                </div>
              </section>
            </>
          )}
          {page === "products" && (
            <ImportedCatalog
              stores={stores}
              onManage={(p) => open("detail", p)}
            />
          )}
          {page === "overview" && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h3>
                    محصولات زیر ذره‌بین
                    <span className="count-chip">{money(totalProducts)}</span>
                  </h3>
                  <p>نمایی شفاف از قیمت، رقابت و وضعیت هر محصول</p>
                </div>
                <div className="table-actions">
                  <label className="search">
                    <Search size={16} />
                    <input
                      aria-label="جستجوی محصول"
                      placeholder="جستجوی محصول یا SKU…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  <a
                    className="secondary icon-btn"
                    href="/api/export"
                    aria-label="دانلود CSV"
                  >
                    <Download size={17} />
                  </a>
                </div>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>محصول / شناسه</th>
                      <th>فروشگاه</th>
                      <th>قیمت فعلی</th>
                      <th>کمترین قیمت آزمایشی رقیب</th>
                      <th>وضعیت تطبیق</th>
                      <th>عملیات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <div className="product-cell">
                            <span className="product-image">
                              <Package size={24} />
                            </span>
                            <span>
                              <b>{p.title}</b>
                              <small dir="ltr">{p.sku}</small>
                            </span>
                          </div>
                        </td>
                        <td>{p.store_name}</td>
                        <td className="numeric">
                          {money(p.price)} <small>تومان</small>
                        </td>
                        <td className="numeric">
                          {p.competitor_price ? money(p.competitor_price) : "—"}
                        </td>
                        <td>
                          <span
                            className={
                              "badge " + (p.match_verified ? "green" : "amber")
                            }
                          >
                            {p.match_verified ? "تأیید دستی" : "نیازمند بررسی"}
                          </span>
                        </td>
                        <td>
                          <button
                            className="row-action"
                            onClick={() => open("detail", p)}
                          >
                            مدیریت
                            <ChevronLeft size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!filtered.length && (
                <Empty
                  icon={Package}
                  title={
                    search
                      ? "محصولی پیدا نشد"
                      : "اولین محصولت را به پرواز درآور"
                  }
                  text="کاتالوگ شما هنوز خالی است. برای شروع، فروشگاه و محصول خود را اضافه کنید."
                  action={() => open(stores.length ? "product" : "store")}
                  label={stores.length ? "افزودن محصول" : "افزودن فروشگاه"}
                />
              )}
              <div className="table-footer">
                <span>نمایش {money(filtered.length)} محصول</span>
                <span>قیمت‌ها به تومان · بدون داده ساختگی</span>
              </div>
            </section>
          )}
          {page === "stores" && (
            <>
              <ImportDashboard
                onConnect={() => open("store")}
                onReconnect={(store) => open("store", store)}
              />
              {stores.some((s) => s.status === "sandbox") && (
                <section className="panel sandbox-stores">
                  <div className="panel-heading">
                    <div>
                      <h3>فروشگاه‌های آزمایشی بدون API</h3>
                      <p>فقط برای تست دستی؛ این‌ها اتصال خودکار ندارند.</p>
                    </div>
                  </div>
                  {stores
                    .filter((s) => s.status === "sandbox")
                    .map((s) => (
                      <div className="sandbox-store-row" key={s.id}>
                        <Store size={22} />
                        <div>
                          <h3>{s.name}</h3>
                          <small dir="ltr">{s.domain}</small>
                        </div>
                        <span className="badge amber">
                          آزمایشی · بدون اتصال
                        </span>
                        <button
                          className="secondary"
                          onClick={() => open("product", s)}
                        >
                          <Plus size={15} />
                          افزودن محصول
                        </button>
                      </div>
                    ))}
                </section>
              )}
            </>
          )}
          {page === "pricing" && (
            <>
              <div className="feature-banner">
                <div className="feature-icon">
                  <Sparkles size={28} />
                </div>
                <div>
                  <span className="eyebrow">SAFE BY DESIGN</span>
                  <h2>رقابت کن؛ سودت را حفظ کن.</h2>
                  <p>
                    پیشنهادها با هزینه خرید، حاشیه سود و سقف تغییر قیمت محاسبه
                    می‌شوند.
                  </p>
                </div>
                <span className="badge green">
                  <ShieldCheck size={14} /> حالت تأیید دستی
                </span>
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h3>پیشنهادهای قیمت</h3>
                    <p>تأیید فقط کاتالوگ آزمایشی را تغییر می‌دهد.</p>
                  </div>
                  <button
                    className="primary"
                    onClick={() => open("simulate", products[0])}
                  >
                    <FlaskConical size={17} />
                    شبیه‌سازی جدید
                  </button>
                </div>
                {recommendations.map((r) => (
                  <div className="recommendation" key={r.id}>
                    <span className="rec-icon">
                      <TrendingUp size={23} />
                    </span>
                    <div className="rec-title">
                      <b>{r.title}</b>
                      <small>{r.explanation}</small>
                    </div>
                    <div className="rec-prices">
                      <del>{money(r.previous_price)}</del>
                      <ArrowLeft size={16} />
                      <strong>
                        {money(r.proposed_price)} <small>تومان</small>
                      </strong>
                    </div>
                    <span className="badge green">
                      {money(r.margin)}٪ سود ناخالص
                    </span>
                    {r.status === "PENDING" ? (
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => perform("pricing/approve", { id: r.id })}
                      >
                        تأیید آزمایشی
                        <Check size={16} />
                      </button>
                    ) : (
                      <span className="badge blue">اعمال آزمایشی</span>
                    )}
                  </div>
                ))}
                {!recommendations.length && (
                  <Empty
                    icon={Sparkles}
                    title="اولین تصمیم هوشمند منتظر توست"
                    text="محصول را تطبیق دهید، قیمت رقیب آزمایشی وارد کنید و نتیجه را شبیه‌سازی کنید."
                    action={() => open("simulate", products[0])}
                    label="باز کردن شبیه‌ساز"
                  />
                )}
              </section>
            </>
          )}
          {page === "wallet" && (
            <>
              <div className="billing-grid">
                <div className="wallet-card">
                  <Wallet size={28} />
                  <p>اعتبار آزمایشی فضای کاری</p>
                  <h2>
                    {money(wallet.balance)} <small>تومان</small>
                  </h2>
                  <button onClick={() => open("recharge")}>
                    <Plus size={17} />
                    افزودن اعتبار آزمایشی
                  </button>
                  <small>
                    این موجودی ارزش پولی ندارد؛ درگاه پرداخت فعال نیست.
                  </small>
                </div>
                <div className="panel subscription-card">
                  <span className={"badge " + (active ? "green" : "amber")}>
                    {active ? "اشتراک آزمایشی فعال" : "بدون اشتراک فعال"}
                  </span>
                  <h2>
                    {data.plans.find((p) => p.id === organization.plan)?.name}
                  </h2>
                  <p>
                    {money(organization.product_limit)} محصول ·{" "}
                    {money(organization.store_limit)} فروشگاه
                  </p>
                  <p className="muted">
                    {active
                      ? "اعتبار تا " + date(organization.subscription_until)
                      : "ابتدا اعتبار آزمایشی اضافه و طرح را انتخاب کنید."}
                  </p>
                  <ShieldCheck size={32} />
                </div>
              </div>
              <div className="plans">
                {data.plans.map((p, i) => (
                  <div
                    key={p.id}
                    className={"panel plan " + (i === 1 ? "featured" : "")}
                  >
                    <span className="eyebrow">{p.id.toUpperCase()}</span>
                    <h2>{p.name}</h2>
                    <div className="plan-price">
                      {money(p.price)} <small>تومان / ماه</small>
                    </div>
                    <ul>
                      <li>
                        <Check />
                        {money(p.product_limit)} محصول تحت نظارت
                      </li>
                      <li>
                        <Check />
                        {money(p.store_limit)} فروشگاه
                      </li>
                      <li>
                        <Check />
                        بررسی هر {money(p.interval_hours)} ساعت در طرح نهایی
                      </li>
                      <li>
                        <Check />
                        حفاظت از سود و تاریخچه قیمت
                      </li>
                    </ul>
                    <button
                      disabled={busy}
                      className={i === 1 ? "primary" : "secondary"}
                      onClick={() =>
                        perform(
                          "billing/subscribe",
                          { plan: p.id, key: crypto.randomUUID() },
                          "اشتراک آزمایشی فعال شد",
                        )
                      }
                    >
                      فعال‌سازی آزمایشی
                    </button>
                  </div>
                ))}
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h3>گردش اعتبار</h3>
                    <p>تمام تراکنش‌ها آزمایشی و قابل ردیابی هستند.</p>
                  </div>
                </div>
                {data.ledger.map((t) => (
                  <div className="ledger-row" key={t.id}>
                    <span
                      className={Number(t.amount) > 0 ? "green-text" : "muted"}
                    >
                      {Number(t.amount) > 0 ? (
                        <ArrowDownLeft />
                      ) : (
                        <ArrowUpLeft />
                      )}
                    </span>
                    <div>
                      <b>{t.description}</b>
                      <small>{date(t.created_at)}</small>
                    </div>
                    <strong dir="ltr">
                      {Number(t.amount) > 0 ? "+" : ""}
                      {money(t.amount)} <small>تومان</small>
                    </strong>
                  </div>
                ))}
                {!data.ledger.length && (
                  <Empty
                    icon={CreditCard}
                    title="تراکنشی ثبت نشده است"
                    text="اولین شارژ آزمایشی شما اینجا ثبت خواهد شد."
                  />
                )}
              </section>
            </>
          )}
          {page === "history" && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h3>تاریخچه قابل بازگشت</h3>
                  <p>هر تغییر با قیمت قبلی و جدید ثبت می‌شود.</p>
                </div>
              </div>
              {data.history.map((h) => (
                <div className="recommendation" key={h.id}>
                  <div className="rec-title">
                    <b>{h.title}</b>
                    <small>{date(h.created_at)}</small>
                  </div>
                  <div className="rec-prices">
                    <del>{money(h.previous_price)}</del>
                    <ArrowLeft size={16} />
                    <strong>{money(h.new_price)}</strong>
                  </div>
                  {h.source === "sandbox" ? (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        perform(
                          "pricing/rollback",
                          { id: h.id },
                          "قیمت آزمایشی بازگردانده شد",
                        )
                      }
                    >
                      <Undo2 size={16} />
                      بازگردانی
                    </button>
                  ) : (
                    <span className="badge">بازگردانده شد</span>
                  )}
                </div>
              ))}
              {!data.history.length && (
                <Empty
                  icon={BarChart3}
                  title="هنوز تغییری ثبت نشده"
                  text="پس از تأیید یک پیشنهاد، سابقه آن اینجا نمایش داده می‌شود."
                />
              )}
            </section>
          )}
          <footer>
            <span>
              PricePilot AI{" "}
              <span className="muted">· تصمیم‌های دقیق، تجارت مطمئن</span>
            </span>
            <span>
              <ShieldCheck size={13} />
              انتشار واقعی قیمت غیرفعال
            </span>
          </footer>
        </main>
      </div>
      {modal && (
        <div className="modal-overlay" onClick={() => !busy && setModal(null)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-label="عملیات"
            className="modal"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close"
              aria-label="بستن"
              onClick={() => setModal(null)}
            >
              <X size={20} />
            </button>
            {modal === "store" && (
              <ConnectStore
                existing={selected}
                onConnected={(message) => {
                  setModal(null);
                  setToast(message);
                  void refresh();
                }}
                onSandbox={() => setModal("sandbox-store")}
              />
            )}
            {modal === "sandbox-store" && (
              <>
                <div className="modal-icon">
                  <Store />
                </div>
                <h2>افزودن فروشگاه آزمایشی</h2>
                <p className="muted">
                  این مسیر فقط برای آزمایش بدون API است. برای دریافت خودکار،
                  اتصال API فروشگاه را انتخاب کنید.
                </p>
                <form
                  onSubmit={(e) => {
                    const f = values(e);
                    perform("stores", f);
                  }}
                >
                  <Field label="نام فروشگاه" name="name" required />
                  <label>
                    پلتفرم
                    <select name="platform">
                      <option value="woocommerce">ووکامرس</option>
                      <option value="sazito">سازیتو (ورود دستی)</option>
                      <option value="custom">وب‌سایت اختصاصی</option>
                      <option value="csv">فایل / CSV</option>
                    </select>
                  </label>
                  <Field
                    label="آدرس HTTPS فروشگاه"
                    name="domain"
                    type="url"
                    placeholder="https://shop.example.com"
                    dir="ltr"
                    required
                  />
                  <Submit busy={busy} label="ساخت فروشگاه آزمایشی" />
                </form>
              </>
            )}
            {modal === "product" && (
              <>
                <div className="modal-icon">
                  <Package />
                </div>
                <h2>افزودن محصول</h2>
                {!stores.length ? (
                  <Empty
                    icon={Store}
                    title="ابتدا یک فروشگاه اضافه کنید"
                    text="هر محصول به یک فروشگاه تعلق دارد."
                    action={() => open("store")}
                    label="افزودن فروشگاه"
                  />
                ) : (
                  <form
                    onSubmit={(e) => {
                      const f = values(e);
                      perform("products", {
                        ...f,
                        cost: Number(f.cost),
                        price: Number(f.price),
                        stock: Number(f.stock),
                      });
                    }}
                  >
                    <label>
                      فروشگاه
                      <select name="storeId" defaultValue={selected?.id}>
                        {stores.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Field label="نام محصول" name="title" required />
                    <Field label="شناسه کالا (SKU)" name="sku" required />
                    <div className="form-grid">
                      <Field
                        label="هزینه خرید (تومان)"
                        name="cost"
                        type="number"
                        min="0"
                        required
                      />
                      <Field
                        label="قیمت فروش (تومان)"
                        name="price"
                        type="number"
                        min="1"
                        required
                      />
                    </div>
                    <Field
                      label="موجودی"
                      name="stock"
                      type="number"
                      min="0"
                      defaultValue="1"
                      required
                    />
                    <Submit busy={busy} label="ذخیره محصول" />
                  </form>
                )}
              </>
            )}
            {modal === "recharge" && (
              <>
                <div className="modal-icon">
                  <Wallet />
                </div>
                <h2>افزودن اعتبار آزمایشی</h2>
                <p className="muted">
                  هیچ وجهی دریافت نمی‌شود. این اعتبار برای آزمایش مسیر اشتراک
                  است.
                </p>
                <form
                  onSubmit={(e) => {
                    const f = values(e);
                    perform("billing/recharge", {
                      amount: Number(f.amount),
                      key: crypto.randomUUID(),
                    });
                  }}
                >
                  <Field
                    label="مبلغ آزمایشی (تومان)"
                    name="amount"
                    type="number"
                    min="10000"
                    max="10000000"
                    defaultValue="2000000"
                    required
                  />
                  <Submit busy={busy} label="افزودن اعتبار آزمایشی" />
                </form>
              </>
            )}
            {modal === "detail" && selected && (
              <>
                <span className="tag">{selected.sku}</span>
                <h2>{selected.title}</h2>
                <div className="detail-stats">
                  <span>
                    قیمت فروش<b>{money(selected.price)} تومان</b>
                  </span>
                  <span>
                    هزینه خرید<b>{money(selected.cost)} تومان</b>
                  </span>
                </div>
                <div className="product-source-note">
                  {selected.external_id ? (
                    <>
                      شناسه مبدأ: <span dir="ltr">{selected.external_id}</span>
                      <br />
                      اطلاعات این محصول از API فروشگاه همگام می‌شود. هزینه خرید
                      واردشده از API در دسترس نیست؛ قیمت‌گذاری بدون هزینه معتبر
                      متوقف می‌ماند.
                    </>
                  ) : null}
                </div>
                <MatchCandidates
                  product={selected}
                  onApproved={() => {
                    void refresh();
                    setModal(null);
                  }}
                />
                <div className="detail-links">
                  <button
                    className="secondary"
                    onClick={() => open("match", selected)}
                  >
                    <Link2 size={17} />
                    تأیید لینک ترب
                  </button>
                  <button
                    className="secondary"
                    onClick={() => open("offer", selected)}
                  >
                    <Plus size={17} />
                    قیمت آزمایشی رقیب
                  </button>
                  <button
                    className="primary"
                    onClick={() => open("simulate", selected)}
                  >
                    <Sparkles size={17} />
                    شبیه‌سازی قیمت
                  </button>
                </div>
                {selected.torob_url && (
                  <p className="muted" dir="ltr">
                    {selected.torob_url}
                  </p>
                )}
              </>
            )}
            {modal === "match" && (
              <>
                <div className="modal-icon">
                  <Link2 />
                </div>
                <h2>تأیید دستی تطبیق ترب</h2>
                <p className="muted">
                  مدل، ظرفیت، رنگ و شرایط گارانتی باید دقیقاً با محصول شما یکسان
                  باشد.
                </p>
                <form
                  onSubmit={(e) => {
                    const f = values(e);
                    perform("products/match", {
                      productId: selected.id,
                      url: f.url,
                      confirmed: true,
                    });
                  }}
                >
                  <Field
                    label="لینک محصول ترب"
                    name="url"
                    type="url"
                    defaultValue={selected.torob_url || ""}
                    placeholder="https://torob.com/p/…/"
                    dir="ltr"
                    required
                  />
                  <label className="checkbox">
                    <input type="checkbox" required />
                    تطبیق مشخصات مهم را شخصاً بررسی و تأیید می‌کنم.
                  </label>
                  <Submit busy={busy} label="تأیید تطبیق" />
                </form>
              </>
            )}
            {modal === "offer" && (
              <>
                <div className="modal-icon">
                  <FlaskConical />
                </div>
                <h2>قیمت آزمایشی رقیب</h2>
                <p className="muted">
                  این داده دستی صرفاً برای شبیه‌سازی است و از ترب دریافت نشده
                  است.
                </p>
                <form
                  onSubmit={(e) => {
                    const f = values(e);
                    perform("products/offers", {
                      productId: selected.id,
                      seller: f.seller,
                      price: Number(f.price),
                      available: true,
                    });
                  }}
                >
                  <Field label="نام فروشنده آزمایشی" name="seller" required />
                  <Field
                    label="قیمت (تومان)"
                    name="price"
                    type="number"
                    min="1"
                    required
                  />
                  <Submit busy={busy} label="ثبت داده آزمایشی" />
                </form>
              </>
            )}
            {modal === "simulate" && (
              <>
                <div className="modal-icon">
                  <Sparkles />
                </div>
                <h2>شبیه‌ساز قیمت امن</h2>
                <p className="muted">
                  قیمت‌گذاری با حداقل حاشیه سود ناخالص، نه درصد افزایش روی خرید.
                </p>
                {products.length ? (
                  <form
                    onSubmit={async (e) => {
                      const f = values(e);
                      setBusy(true);
                      try {
                        const r = await api("pricing/simulate", {
                          productId: f.productId,
                          margin: Number(f.margin),
                          undercut: Number(f.undercut),
                          maxMovement: Number(f.maxMovement),
                        });
                        setSimulation(r);
                        await refresh();
                      } catch (e) {
                        setToast((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <label>
                      محصول
                      <select name="productId" defaultValue={selected?.id}>
                        {[
                          ...(selected &&
                          !products.some((p) => p.id === selected.id)
                            ? [selected]
                            : []),
                          ...products,
                        ].map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="form-grid">
                      <Field
                        label="حداقل سود ناخالص (%)"
                        name="margin"
                        type="number"
                        min="0"
                        max="90"
                        defaultValue="15"
                        required
                      />
                      <Field
                        label="اختلاف با رقیب (تومان)"
                        name="undercut"
                        type="number"
                        min="0"
                        defaultValue="10000"
                        required
                      />
                    </div>
                    <Field
                      label="حداکثر تغییر نسبت به قیمت فعلی (%)"
                      name="maxMovement"
                      type="number"
                      min="0"
                      max="50"
                      defaultValue="10"
                      required
                    />
                    <Submit busy={busy} label="محاسبه پیشنهاد" />
                  </form>
                ) : (
                  <p>ابتدا یک محصول اضافه کنید.</p>
                )}
                {simulation && (
                  <div className="simulation-result">
                    <ShieldCheck />
                    <b>
                      {simulation.price
                        ? money(simulation.price) + " تومان"
                        : simulation.status}
                    </b>
                    <p>{simulation.explanation}</p>
                    {simulation.margin && (
                      <span>حاشیه سود ناخالص: {money(simulation.margin)}٪</span>
                    )}
                  </div>
                )}
              </>
            )}
            {modal === "help" && (
              <>
                <div className="modal-icon">
                  <HelpCircle />
                </div>
                <h2>مسیر اولین قیمت‌گذاری</h2>
                <ol className="help-list">
                  <li>اعتبار آزمایشی اضافه و اشتراک را فعال کنید.</li>
                  <li>فروشگاه و محصول را با هزینه خرید ثبت کنید.</li>
                  <li>در مدیریت محصول، لینک دقیق ترب را تأیید کنید.</li>
                  <li>یک قیمت رقیب آزمایشی وارد کنید.</li>
                  <li>شبیه‌سازی را اجرا و پیشنهاد را بررسی کنید.</li>
                  <li>تأیید پیشنهاد فقط کاتالوگ محلی را تغییر می‌دهد.</li>
                </ol>
              </>
            )}
            {modal === "events" && (
              <>
                <h2>رویدادهای فضای کاری</h2>
                {data.logs.map((l, i) => (
                  <div className="event" key={i}>
                    <CheckCircle2 size={17} />
                    <span dir="ltr">{l.action}</span>
                    <small>{date(l.created_at)}</small>
                  </div>
                ))}
              </>
            )}
          </section>
        </div>
      )}
      {toast && (
        <div role="status" className="toast">
          <CheckCircle2 size={18} />
          {toast}
          <button aria-label="بستن پیام" onClick={() => setToast("")}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
function Field({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label>
      {label}
      <input {...props} />
    </label>
  );
}
function Submit({ busy, label }: { busy: boolean; label: string }) {
  return (
    <button disabled={busy} className="primary">
      {busy ? <Loader2 className="spin" /> : <Check size={17} />} {label}
    </button>
  );
}
function Stat({ label, value, unit, icon: Icon, detail, color }: any) {
  return (
    <div className={"panel stat " + color}>
      <div className="stat-top">
        <span>{label}</span>
        <span className="stat-icon">
          <Icon size={20} />
        </span>
      </div>
      <div className="stat-value">
        {value}
        <small>{unit}</small>
      </div>
      <div className="stat-detail">
        <span className="dot" />
        {detail}
      </div>
    </div>
  );
}
function Empty({ icon: Icon, title, text, action, label }: any) {
  return (
    <div className="empty">
      <div>
        <Icon size={28} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action && (
        <button className="secondary" onClick={action}>
          <Plus size={15} />
          {label}
        </button>
      )}
    </div>
  );
}
function HistoryChart({ history }: { history: any[] }) {
  const h = [...history].reverse().slice(-15),
    vals = h.flatMap((x) => [Number(x.previous_price), Number(x.new_price)]),
    max = Math.max(...vals) * 1.05,
    min = Math.min(...vals) * 0.95;
  const points = (key: string) =>
    h
      .map(
        (v, i) =>
          `${40 + i * (620 / Math.max(1, h.length - 1))},${190 - ((Number(v[key]) - min) / (max - min || 1)) * 150}`,
      )
      .join(" ");
  return (
    <div className="history-chart">
      <svg
        viewBox="0 0 700 230"
        role="img"
        aria-label="نمودار تغییر قیمت آزمایشی"
      >
        {[40, 90, 140, 190].map((y) => (
          <line
            key={y}
            x1="30"
            x2="680"
            y1={y}
            y2={y}
            stroke="currentColor"
            opacity=".08"
          />
        ))}
        <polyline
          points={points("previous_price")}
          fill="none"
          stroke="#528cff"
          strokeWidth="3"
        />
        <polyline
          points={points("new_price")}
          fill="none"
          stroke="#aa7aff"
          strokeWidth="3"
        />
        {h.map((v, i) => (
          <circle
            key={i}
            cx={40 + i * (620 / Math.max(1, h.length - 1))}
            cy={190 - ((Number(v.new_price) - min) / (max - min || 1)) * 150}
            r="5"
            fill="#aa7aff"
          >
            <title>{v.title + ": " + money(v.new_price) + " تومان"}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}
