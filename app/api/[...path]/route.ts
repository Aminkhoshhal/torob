import { NextResponse } from 'next/server';
import { hash,compare } from 'bcryptjs';
import { z } from 'zod';
import { query,transaction,id,audit } from '@/lib/db';
import { authenticate,token,limit } from '@/lib/auth';
import { calculatePrice } from '@/lib/pricing';
export const runtime='nodejs';
const money=z.number().int().min(0).max(100_000_000_000);
const fail=(message:string,status=400)=>NextResponse.json({error:message},{status});
async function handler(req:Request,context:{params:Promise<{path:string[]}>}){
 try{
 const {path}=await context.params;const route=path.join('/');const method=req.method;
 if(method!=='GET'){
  const origin=req.headers.get('origin'); const expected=process.env.APP_URL||new URL(req.url).protocol+'//'+req.headers.get('host');
  if(origin&&origin!==expected)return fail('درخواست از مبدأ نامعتبر است.',403);
  if(!req.headers.get('content-type')?.includes('application/json'))return fail('JSON required',415);
  if(Number(req.headers.get('content-length')||0)>1_000_000)return fail('درخواست بیش از حد بزرگ است.',413);
 }
 if(route==='health') {await query('SELECT 1');return NextResponse.json({status:'ok',mode:'sandbox',publishing:false});}
 if(route==='auth/logout') {const r=NextResponse.json({ok:true});r.cookies.set('session','',{maxAge:0,path:'/'});return r;}
 if(route==='auth/register'||route==='auth/login'){
  if(method!=='POST')return fail('Method not allowed',405);
  const input=z.object({email:z.email().max(200).transform(v=>v.toLowerCase()),password:z.string().min(10).max(72),name:z.string().min(2).max(80).optional(),organization:z.string().min(2).max(100).optional()}).parse(await req.json());
  if(!await limit('auth:'+input.email))return fail('تعداد تلاش‌ها زیاد است؛ ۱۵ دقیقه دیگر تلاش کنید.',429);
  let user;let org;
  if(route==='auth/register'){
   if(!input.name||!input.organization)return fail('نام و نام کسب‌وکار را وارد کنید.');
   const passwordHash=await hash(input.password,12);
   const result=await transaction(async db=>{
    const uid=id(),oid=id();await db.query('INSERT INTO users(id,email,password_hash,name) VALUES($1,$2,$3,$4)',[uid,input.email,passwordHash,input.name]);
    await db.query('INSERT INTO organizations(id,name) VALUES($1,$2)',[oid,input.organization]);await db.query("INSERT INTO members VALUES($1,$2,'owner')",[uid,oid]);await db.query('INSERT INTO wallets(organization_id) VALUES($1)',[oid]);await audit(db,oid,uid,'organization.created');return {uid,oid};
   });user={id:result.uid};org=result.oid;
  }else{
   const [found]=await query('SELECT u.*,m.organization_id FROM users u JOIN members m ON m.user_id=u.id WHERE email=$1',[input.email]);
   if(!found||!await compare(input.password,found.password_hash))return fail('ایمیل یا رمز عبور صحیح نیست.',401);user=found;org=found.organization_id;
  }
  const r=NextResponse.json({ok:true});r.cookies.set('session',await token(user.id,org),{httpOnly:true,secure:process.env.NODE_ENV==='production'&&process.env.APP_ENV!=='local',sameSite:'lax',path:'/',maxAge:43200});return r;
 }
 const user=await authenticate(req);if(!user)return fail('ابتدا وارد حساب شوید.',401);const org=user.organization_id;
 if(method!=='GET'&&user.role==='viewer')return fail('دسترسی فقط خواندنی است.',403);
 if(method!=='GET'&&!await limit('mutation:'+user.id,200))return fail('درخواست‌های بیش از حد',429);
 const json=()=>req.json();
 if(route==='overview'&&method==='GET'){
  const [organization]=await query('SELECT o.*,p.product_limit,p.store_limit,p.price AS plan_price FROM organizations o JOIN plans p ON p.id=o.plan WHERE o.id=$1',[org]);
  const [wallet]=await query('SELECT balance FROM wallets WHERE organization_id=$1',[org]);
  const products=await query(`SELECT p.*,s.name AS store_name,(SELECT min(price) FROM offers o WHERE o.organization_id=p.organization_id AND o.product_id=p.id AND available=true) AS competitor_price FROM products p JOIN stores s ON s.id=p.store_id WHERE p.organization_id=$1 ORDER BY p.created_at DESC`,[org]);
  const stores=await query('SELECT * FROM stores WHERE organization_id=$1 ORDER BY created_at DESC',[org]);
  const recommendations=await query('SELECT r.*,p.title FROM recommendations r JOIN products p ON p.id=r.product_id WHERE r.organization_id=$1 ORDER BY r.created_at DESC LIMIT 100',[org]);
  const ledger=await query('SELECT * FROM ledger WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 100',[org]);
  const history=await query('SELECT h.*,p.title FROM price_history h JOIN products p ON p.id=h.product_id WHERE h.organization_id=$1 ORDER BY h.created_at DESC LIMIT 100',[org]);
  const logs=await query('SELECT action,created_at FROM audit_logs WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 20',[org]);
  return NextResponse.json({user:{name:user.name,email:user.email,role:user.role},organization,wallet,products,stores,recommendations,ledger,history,logs,plans:await query('SELECT * FROM plans ORDER BY price'),mode:'sandbox'});
 }
 if(route==='billing/recharge'&&method==='POST'){
  const v=z.object({amount:money.min(10000).max(10000000),key:z.string().uuid()}).parse(await json());
  await transaction(async db=>{const r=await db.query("INSERT INTO ledger(id,organization_id,amount,kind,description,idempotency_key) VALUES($1,$2,$3,'sandbox_credit','اعتبار آزمایشی — بدون پرداخت واقعی',$4) ON CONFLICT(organization_id,idempotency_key) DO NOTHING RETURNING id",[id(),org,v.amount,v.key]);if(r.rows.length){await db.query('UPDATE wallets SET balance=balance+$1 WHERE organization_id=$2',[v.amount,org]);await audit(db,org,user.id,'wallet.sandbox_credit',{amount:v.amount});}});return NextResponse.json({ok:true});
 }
 if(route==='billing/subscribe'&&method==='POST'){
  if(!['owner','admin'].includes(user.role))return fail('فقط مدیر می‌تواند اشتراک را تغییر دهد.',403);
  const v=z.object({plan:z.enum(['starter','professional','business']),key:z.string().uuid()}).parse(await json());
  await transaction(async db=>{await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[org]);const old=await db.query('SELECT id FROM payments WHERE organization_id=$1 AND idempotency_key=$2',[org,v.key]);if(old.rows.length)return;
   const [plan]=(await db.query('SELECT * FROM plans WHERE id=$1',[v.plan])).rows;
   const counts=(await db.query('SELECT (SELECT count(*) FROM products WHERE organization_id=$1) AS products,(SELECT count(*) FROM stores WHERE organization_id=$1) AS stores',[org])).rows[0];if(Number(counts.products)>plan.product_limit||Number(counts.stores)>plan.store_limit)throw new Error('تعداد محصول یا فروشگاه بیشتر از ظرفیت طرح است.');
   await db.query('UPDATE organizations SET plan=$1,subscription_until=now()+interval \'30 days\' WHERE id=$2',[v.plan,org]);
   await db.query("INSERT INTO payments(id,organization_id,plan_id,amount,status,idempotency_key) VALUES($1,$2,$3,$4,'sandbox_verified',$5)",[id(),org,v.plan,plan.price,v.key]);await audit(db,org,user.id,'subscription.sandbox_activated',{plan:v.plan});
  });return NextResponse.json({ok:true});
 }
 if(route==='stores'&&method==='POST'){
  const v=z.object({name:z.string().min(2).max(100),platform:z.enum(['woocommerce','sazito','custom','csv']),domain:z.string().max(200).url()}).parse(await json());
  const url=new URL(v.domain);if(url.protocol!=='https:'||url.username||url.password)return fail('آدرس HTTPS بدون اطلاعات ورود وارد کنید.');
  await transaction(async db=>{const [o]=(await db.query('SELECT o.*,p.store_limit FROM organizations o JOIN plans p ON p.id=o.plan WHERE o.id=$1 FOR UPDATE OF o',[org])).rows;if(!o.subscription_until||new Date(o.subscription_until)<new Date())throw new Error('اشتراک آزمایشی را فعال کنید.');const [count]=(await db.query('SELECT count(*) AS n FROM stores WHERE organization_id=$1',[org])).rows;if(Number(count.n)>=o.store_limit)throw new Error('ظرفیت فروشگاه طرح تکمیل است.');await db.query('INSERT INTO stores(id,organization_id,name,platform,domain) VALUES($1,$2,$3,$4,$5)',[id(),org,v.name,v.platform,url.origin]);await audit(db,org,user.id,'store.sandbox_created',{platform:v.platform});});return NextResponse.json({ok:true});
 }
 if(route==='products'&&method==='POST'){
  const v=z.object({storeId:z.string().uuid(),title:z.string().min(2).max(200),sku:z.string().min(1).max(80),cost:money,price:money.min(1),stock:z.number().int().min(0).max(1000000)}).parse(await json());
  await transaction(async db=>{const [o]=(await db.query('SELECT o.*,p.product_limit FROM organizations o JOIN plans p ON p.id=o.plan WHERE o.id=$1 FOR UPDATE OF o',[org])).rows;if(!o.subscription_until||new Date(o.subscription_until)<new Date())throw new Error('اشتراک منقضی شده است.');const s=await db.query('SELECT id FROM stores WHERE id=$1 AND organization_id=$2',[v.storeId,org]);if(!s.rows.length)throw new Error('فروشگاه یافت نشد.');const [count]=(await db.query('SELECT count(*) AS n FROM products WHERE organization_id=$1',[org])).rows;if(Number(count.n)>=o.product_limit)throw new Error('ظرفیت محصول تکمیل است.');await db.query('INSERT INTO products(id,organization_id,store_id,title,sku,cost,price,stock) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id(),org,v.storeId,v.title,v.sku,v.cost,v.price,v.stock]);await audit(db,org,user.id,'product.created',{sku:v.sku});});return NextResponse.json({ok:true});
 }
 if(route==='products/match'&&method==='POST'){
  const v=z.object({productId:z.string().uuid(),url:z.string().url(),confirmed:z.literal(true)}).parse(await json());const u=new URL(v.url);if(u.protocol!=='https:'||u.hostname!=='torob.com'||!/^\/p\/[^/]+/.test(u.pathname)||u.username||u.password)return fail('آدرس صفحه محصول ترب معتبر نیست.');
  await transaction(async db=>{const r=await db.query('UPDATE products SET torob_url=$1,match_verified=true WHERE id=$2 AND organization_id=$3 RETURNING id',[u.origin+u.pathname,v.productId,org]);if(!r.rows.length)throw new Error('محصول یافت نشد.');await audit(db,org,user.id,'match.manually_confirmed',{productId:v.productId});});return NextResponse.json({ok:true});
 }
 if(route==='products/offers'&&method==='POST'){
  const v=z.object({productId:z.string().uuid(),seller:z.string().min(2).max(100),price:money.min(1),available:z.boolean()}).parse(await json());const [p]=await query('SELECT id FROM products WHERE id=$1 AND organization_id=$2',[v.productId,org]);if(!p)return fail('محصول یافت نشد.',404);
  await query("INSERT INTO offers(id,organization_id,product_id,seller,price,available,source) VALUES($1,$2,$3,$4,$5,$6,'sandbox')",[id(),org,v.productId,v.seller,v.price,v.available]);return NextResponse.json({ok:true});
 }
 if(route==='pricing/simulate'&&method==='POST'){
  const v=z.object({productId:z.string().uuid(),margin:z.number().min(0).max(90),undercut:money,maxMovement:z.number().min(0).max(50)}).parse(await json());
  const [p]=await query('SELECT * FROM products WHERE id=$1 AND organization_id=$2',[v.productId,org]);if(!p)return fail('محصول یافت نشد.',404);
  const offers=await query("SELECT price,available FROM offers WHERE product_id=$1 AND organization_id=$2 AND observed_at>now()-interval '24 hours'",[p.id,org]);
  const result=calculatePrice({current:Number(p.price),cost:Number(p.cost),stock:p.stock,matchVerified:p.match_verified,minimum:Number(p.minimum_price),marginPercent:v.margin,undercut:v.undercut,maxMovementPercent:v.maxMovement,offers:offers.map(o=>({price:Number(o.price),available:o.available}))});
  if(result.price!==null)await query('INSERT INTO recommendations(id,organization_id,product_id,previous_price,proposed_price,status,explanation,margin) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id(),org,p.id,p.price,result.price,result.status,result.explanation,result.margin]);return NextResponse.json(result);
 }
 if(route==='pricing/approve'&&method==='POST'){
  const v=z.object({id:z.string().uuid()}).parse(await json());
  await transaction(async db=>{const [r]=(await db.query("SELECT * FROM recommendations WHERE id=$1 AND organization_id=$2 FOR UPDATE",[v.id,org])).rows;if(!r)throw new Error('پیشنهاد یافت نشد.');if(r.status==='SANDBOX_APPLIED')return;if(r.status!=='PENDING')throw new Error('وضعیت پیشنهاد معتبر نیست.');if(Date.now()-new Date(r.created_at).getTime()>3600000)throw new Error('پیشنهاد منقضی شده؛ دوباره شبیه‌سازی کنید.');const p=await db.query('UPDATE products SET price=$1 WHERE id=$2 AND organization_id=$3 AND price=$4 AND stock>0 AND match_verified=true RETURNING id',[r.proposed_price,r.product_id,org,r.previous_price]);if(!p.rows.length)throw new Error('وضعیت محصول تغییر کرده؛ دوباره شبیه‌سازی کنید.');await db.query("UPDATE recommendations SET status='SANDBOX_APPLIED' WHERE id=$1",[r.id]);await db.query("INSERT INTO price_history(id,organization_id,product_id,previous_price,new_price,source) VALUES($1,$2,$3,$4,$5,'sandbox')",[id(),org,r.product_id,r.previous_price,r.proposed_price]);await audit(db,org,user.id,'price.sandbox_applied',{recommendationId:r.id});});return NextResponse.json({ok:true,message:'قیمت فقط در کاتالوگ آزمایشی تغییر کرد.'});
 }
 if(route==='pricing/rollback'&&method==='POST'){
  const v=z.object({id:z.string().uuid()}).parse(await json());await transaction(async db=>{const [h]=(await db.query('SELECT * FROM price_history WHERE id=$1 AND organization_id=$2 FOR UPDATE',[v.id,org])).rows;if(!h||h.source!=='sandbox')throw new Error('این تغییر قابل بازگشت نیست.');const p=await db.query('UPDATE products SET price=$1 WHERE id=$2 AND organization_id=$3 AND price=$4 RETURNING id',[h.previous_price,h.product_id,org,h.new_price]);if(!p.rows.length)throw new Error('قیمت بعداً تغییر کرده است؛ بازگشت خودکار امن نیست.');await db.query("UPDATE price_history SET source='sandbox_rolled_back' WHERE id=$1",[h.id]);await audit(db,org,user.id,'price.sandbox_rolled_back',{historyId:h.id});});return NextResponse.json({ok:true});
 }
 if(route==='export'&&method==='GET'){
  const rows=await query('SELECT title,sku,price,cost,stock FROM products WHERE organization_id=$1',[org]);const escape=(v:unknown)=>'"'+String(v).replace(/^[=+@\-\t\r]/,"'$&").replace(/"/g,'""')+'"';return new Response('\uFEFF'+['title,sku,price_toman,cost_toman,stock',...rows.map(r=>[r.title,r.sku,r.price,r.cost,r.stock].map(escape).join(','))].join('\r\n'),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="products.csv"'}});
 }
 return fail('مسیر یافت نشد.',404);
 }catch(e){if(e instanceof z.ZodError)return fail('اطلاعات واردشده معتبر نیست: '+e.issues.map(i=>i.path.join('.')).join('، '));const code=(e as {code?:string}).code;if(code==='23505')return fail('این رکورد قبلاً ثبت شده است.',409);console.error('API error',e instanceof Error?e.message:'unknown');return fail(e instanceof Error&&!code?e.message:'عملیات انجام نشد؛ دوباره تلاش کنید.',400);}
}
export {handler as GET,handler as POST};
