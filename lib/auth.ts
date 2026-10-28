import { SignJWT,jwtVerify } from 'jose';
import { randomBytes } from 'node:crypto';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { query } from './db';
let key:Uint8Array|undefined;
async function secret(){
 if(key)return key;
 let s=process.env.SESSION_SECRET;
 if(!s){if(process.env.NODE_ENV==='production'&&process.env.APP_ENV!=='local')throw new Error('SESSION_SECRET required');await mkdir('.data',{recursive:true});try{s=await readFile('.data/session-secret','utf8');}catch{s=randomBytes(48).toString('hex');await writeFile('.data/session-secret',s,{mode:0o600});}}
 if(s.length<32)throw new Error('SESSION_SECRET must be at least 32 characters');return key=new TextEncoder().encode(s);
}
export async function token(user:string,org:string){return new SignJWT({org}).setProtectedHeader({alg:'HS256'}).setSubject(user).setIssuer('pricepilot').setAudience('merchant').setIssuedAt().setExpirationTime('12h').sign(await secret());}
export async function authenticate(req:Request){
 const raw=req.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('session='))?.slice(8);if(!raw)return null;
 try{const {payload}=await jwtVerify(raw,await secret(),{issuer:'pricepilot',audience:'merchant',algorithms:['HS256']});const [member]=await query('SELECT m.role,u.id,u.name,u.email,m.organization_id FROM members m JOIN users u ON u.id=m.user_id WHERE m.user_id=$1 AND m.organization_id=$2',[payload.sub,payload.org]);return member??null;}catch{return null;}
}
export async function limit(key:string,max=15){const [r]=await query(`INSERT INTO rate_limits(key,count,reset_at) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.reset_at<now() THEN 1 ELSE rate_limits.count+1 END,reset_at=CASE WHEN rate_limits.reset_at<now() THEN now()+interval '15 minutes' ELSE rate_limits.reset_at END RETURNING count`,[key]);return r.count<=max;}
