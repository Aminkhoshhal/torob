import assert from 'node:assert/strict';
const base=process.env.TEST_URL||'http://localhost:3000';
let checks=0;
function check(value:unknown,message:string){assert.ok(value,message);checks++;console.log('PASS',message);}
async function client(){let cookie='';return async(path:string,body?:unknown)=>{const r=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json','Origin':base}:{}),Cookie:cookie},body:body?JSON.stringify(body):undefined});const c=r.headers.get('set-cookie');if(c)cookie=c.split(';')[0];const data=await r.json();return {status:r.status,data};};}
async function run(){
 const a=await client(),b=await client(),suffix=crypto.randomUUID();
 check((await a('health')).data.status==='ok','database health');
 check((await a('overview')).status===401,'anonymous tenant access denied');
 for(const [c,label] of [[a,'a'],[b,'b']] as const){check((await c('auth/register',{email:label+suffix+'@example.com',password:'Secure-test-2026!',name:'آزمایش',organization:'فروشگاه آزمایش '+label})).status===200,'register tenant '+label);}
 let o=(await a('overview')).data;check(o.products.length===0,'new workspace starts empty');
 const key=crypto.randomUUID();await Promise.all([a('billing/recharge',{amount:2000000,key}),a('billing/recharge',{amount:2000000,key})]);
 o=(await a('overview')).data;check(Number(o.wallet.balance)===2000000,'concurrent duplicate credits applied once');check(o.ledger.length===1,'single accounting entry');
 const subkey=crypto.randomUUID();check((await a('billing/subscribe',{plan:'starter',key:subkey})).status===200,'sandbox subscription purchase');await a('billing/subscribe',{plan:'starter',key:subkey});
 check(Number((await a('overview')).data.wallet.balance)===2000000,'subscription billing separate from usage wallet');
 check((await a('stores',{name:'فروشگاه اول',platform:'woocommerce',domain:'https://shop.example.com'})).status===200,'create sandbox store');
 check((await a('stores',{name:'فروشگاه دوم',platform:'custom',domain:'https://shop2.example.com'})).status===400,'subscription store quota enforced');
 o=(await a('overview')).data;const storeId=o.stores[0].id;
 check((await b('products',{storeId,title:'محصول غیرمجاز',sku:'bad',cost:100,price:200,stock:1})).status!==200,'foreign tenant store rejected');
 check((await a('products',{storeId,title:'گوشی آزمایشی',sku:'PHONE-1',cost:7000000,price:10000000,stock:3})).status===200,'persistent product create');
 o=(await a('overview')).data;const productId=o.products[0].id;
 check((await b('overview')).data.products.length===0,'tenant catalog isolated');
 check((await a('pricing/simulate',{productId,margin:15,undercut:20000,maxMovement:20})).data.status==='REVIEW_REQUIRED','unverified match blocks pricing');
 check((await a('products/match',{productId,url:'https://evil.example/p/1',confirmed:true})).status===400,'foreign product URLs rejected');
 check((await b('products/match',{productId,url:'https://torob.com/p/test/',confirmed:true})).status!==200,'foreign tenant match update rejected');
 await a('products/match',{productId,url:'https://torob.com/p/test/',confirmed:true});
 check((await a('pricing/simulate',{productId,margin:15,undercut:20000,maxMovement:20})).data.status==='NO_VALID_COMPETITORS','missing competitors block pricing');
 await a('products/offers',{productId,seller:'فروشنده آزمایشی',price:10000000,available:true});
 const sim=await a('pricing/simulate',{productId,margin:15,undercut:20000,maxMovement:20});check(sim.data.price===9980000,'safe deterministic price recommendation');
 o=(await a('overview')).data;const rec=o.recommendations[0].id;
 check((await b('pricing/approve',{id:rec})).status!==200,'cross tenant approval rejected');
 check((await a('pricing/approve',{id:rec})).status===200,'sandbox approval');await a('pricing/approve',{id:rec});
 o=(await a('overview')).data;check(Number(o.products[0].price)===9980000,'local catalog updated');check(o.history.length===1,'duplicate approval creates no extra history');
 check((await a('pricing/rollback',{id:o.history[0].id})).status===200,'safe rollback');
 check(Number((await a('overview')).data.products[0].price)===10000000,'previous price restored');
 check((await a('pricing/rollback',{id:o.history[0].id})).status!==200,'duplicate rollback rejected');
 console.log(`Completed ${checks} HTTP workflow assertions. Test accounts retained as labelled smoke fixtures: ${suffix}`);
}
run().catch(e=>{console.error(e);process.exitCode=1;});
