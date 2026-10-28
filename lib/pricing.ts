import Decimal from 'decimal.js';
export type PriceInput={current:number;cost:number;stock:number;matchVerified:boolean;minimum:number;marginPercent:number;undercut:number;maxMovementPercent:number;offers:{price:number;available:boolean}[]};
export function calculatePrice(i:PriceInput){
 const blocked=(status:string,explanation:string)=>({status,explanation,price:null,margin:null});
 if(!i.matchVerified)return blocked('REVIEW_REQUIRED','تطبیق محصول باید تأیید شود.');
 if(!Number.isSafeInteger(i.cost)||i.cost<=0)return blocked('COST_DATA_REQUIRED','قیمت خرید معتبر وارد کنید.');
 if(i.stock<=0)return blocked('OUT_OF_STOCK','محصول ناموجود است؛ قیمت‌گذاری متوقف شد.');
 if(i.marginPercent<0||i.marginPercent>=100||i.maxMovementPercent<0||i.maxMovementPercent>100||i.undercut<0)return blocked('INVALID_RULE','محدوده قانون قیمت‌گذاری معتبر نیست.');
 const eligible=i.offers.filter(o=>o.available&&Number.isSafeInteger(o.price)&&o.price>0);
 if(!eligible.length)return blocked('NO_VALID_COMPETITORS','قیمت رقیب معتبر و موجود یافت نشد.');
 const reference=Decimal.min(...eligible.map(o=>new Decimal(o.price)));
 const floor=Decimal.max(new Decimal(i.cost).div(new Decimal(1).minus(new Decimal(i.marginPercent).div(100))).ceil(),i.minimum);
 const lower=new Decimal(i.current).mul(new Decimal(1).minus(new Decimal(i.maxMovementPercent).div(100))).ceil();
 const upper=new Decimal(i.current).mul(new Decimal(1).plus(new Decimal(i.maxMovementPercent).div(100))).floor();
 if(floor.gt(upper))return blocked('LIMIT_CONFLICT','حداقل سود با سقف تغییر قیمت سازگار نیست؛ بررسی دستی لازم است.');
 const target=reference.minus(i.undercut); const proposed=Decimal.min(Decimal.max(target,floor,lower),upper).ceil();
 if(proposed.lte(0)||!Number.isSafeInteger(proposed.toNumber()))return blocked('INVALID_PRICE','قیمت خارج از محدوده مجاز است.');
 const margin=proposed.minus(i.cost).div(proposed).mul(100).toFixed(2);
 return {status:'PENDING',price:proposed.toNumber(),margin,explanation:target.lt(floor)?'حفظ حاشیه سود بر رقابت قیمتی اولویت دارد.':proposed.eq(target)?'قیمت بر اساس ارزان‌ترین رقیب موجود محاسبه شد.':'محدودیت تغییر قیمت برای ثبات بازار اعمال شد.'};
}
export function normalizePersian(s:string){return s.normalize('NFKC').replace(/ي/g,'ی').replace(/ك/g,'ک').replace(/[\u064B-\u065F\u200c]/g,' ').replace(/\s+/g,' ').trim().toLowerCase();}
export function tomanToRial(toman:number){if(!Number.isSafeInteger(toman)||toman<0||!Number.isSafeInteger(toman*10))throw new Error('Invalid Toman amount');return toman*10;}
