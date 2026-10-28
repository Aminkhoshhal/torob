import {test,expect} from '@playwright/test';
test('Persian RTL merchant can register and complete the safe sandbox journey',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.locator('html')).toHaveAttribute('dir','rtl');
 await page.getByRole('button',{name:'حساب ندارید؟ ثبت‌نام کنید'}).click();
 await page.getByLabel('نام شما',{exact:true}).fill('سارا احمدی');await page.getByLabel('نام کسب‌وکار').fill('دیجی استور آزمایشی');await page.getByLabel('ایمیل',{exact:true}).fill('browser-'+crypto.randomUUID()+'@example.com');await page.getByLabel('رمز عبور (حداقل ۱۰ کاراکتر)').fill('Browser-Test-2026!');
 await page.getByRole('button',{name:'ساخت فضای کاری'}).click();await expect(page.getByRole('heading',{name:/سلام سارا/})).toBeVisible();
 await page.getByRole('navigation').getByRole('button',{name:'کیف پول و اشتراک'}).click();
 await page.getByRole('button',{name:'فعال‌سازی آزمایشی'}).first().click();await expect(page.getByText('اشتراک آزمایشی فعال',{exact:true})).toBeVisible();
 await page.getByRole('navigation').getByRole('button',{name:'فروشگاه‌ها'}).click();await page.getByRole('button',{name:'افزودن فروشگاه',exact:true}).click();await page.getByLabel('نام فروشگاه').fill('فروشگاه سارا');await page.getByLabel('آدرس HTTPS فروشگاه').fill('https://sara.example.com');await page.getByRole('button',{name:'ساخت فروشگاه آزمایشی'}).click();await expect(page.getByRole('heading',{name:'فروشگاه سارا'})).toBeVisible();
 await page.getByRole('button',{name:'افزودن محصول',exact:true}).click();await page.getByLabel('نام محصول').fill('گوشی سامسونگ مدل آزمایشی');await page.getByLabel('شناسه کالا (SKU)').fill('SAMSUNG-TEST');await page.getByLabel('هزینه خرید (تومان)').fill('7000000');await page.getByLabel('قیمت فروش (تومان)').fill('10000000');await page.getByRole('button',{name:'ذخیره محصول'}).click();
 await page.getByRole('navigation').getByRole('button',{name:/محصولات/}).click();await page.getByRole('button',{name:'مدیریت',exact:true}).click();await page.getByRole('button',{name:'تأیید لینک ترب'}).click();await page.getByLabel('لینک محصول ترب').fill('https://torob.com/p/samsung-test/');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'تأیید تطبیق',exact:true}).click();
 await page.getByRole('button',{name:'مدیریت',exact:true}).click();await page.getByRole('button',{name:'قیمت آزمایشی رقیب',exact:true}).click();await page.getByLabel('نام فروشنده آزمایشی').fill('رقیب آزمایشی');await page.getByLabel('قیمت (تومان)',{exact:true}).fill('9900000');await page.getByRole('button',{name:'ثبت داده آزمایشی'}).click();
 await page.getByRole('navigation').getByRole('button',{name:'قیمت‌گذاری هوشمند'}).click();await page.getByRole('button',{name:'شبیه‌سازی جدید'}).click();await page.getByRole('button',{name:'محاسبه پیشنهاد'}).click();await expect(page.locator('.simulation-result')).toContainText('۹٬۸۹۰٬۰۰۰');await page.getByRole('button',{name:'بستن',exact:true}).click();await page.getByRole('button',{name:'تأیید آزمایشی',exact:true}).click();await expect(page.getByText('اعمال آزمایشی',{exact:true})).toBeVisible();
 await page.getByRole('navigation').getByRole('button',{name:'نمای کلی'}).click();await page.screenshot({path:'.data/dashboard-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.data/dashboard-mobile.png',fullPage:true});checkNoOverflow();
 async function checkNoOverflow(){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();}
 expect(errors).toEqual([]);
});
