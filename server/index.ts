import express, {type Request, type Response, type NextFunction} from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { randomUUID, createHmac, scryptSync, timingSafeEqual } from 'node:crypto';
import {MongoClient, MongoServerError, type ClientSession, type Db} from 'mongodb';
import {z, ZodError} from 'zod';
import {dispatchDay,depositPolicy,occupiedDays,shiftDay,validDay,type Region} from '../shared/rules';
import {registerIdentityRoutes} from './identity';

const required=(name:string)=>{const value=process.env[name];if(!value)throw new Error('Missing env: '+name);return value;};
const URI=required('MONGODB_URI');
const DB_NAME=required('MONGODB_DB');
if(process.env.NODE_ENV!=='production' && !/(dev|test|local)/i.test(DB_NAME))throw new Error('Development database name must contain dev/test/local');
const FRONTEND_URL=required('FRONTEND_URL');
const ADMIN_PASSWORD=required('ADMIN_PASSWORD');
const COOKIE_SECRET=required('COOKIE_SECRET');
if(ADMIN_PASSWORD.length<12 || COOKIE_SECRET.length<32) throw new Error('Weak admin credential configuration');
const ADMIN_USERNAME=process.env.ADMIN_USERNAME||'admin';
const client=new MongoClient(URI);
const app=express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({origin:FRONTEND_URL,credentials:true}));
app.use(express.json({limit:'128kb'}));
app.use(cookieParser());
app.use('/api',(_req,res,next)=>{res.set('Cache-Control','no-store');next();});
let db:Db;
type Product = { _id:string, name:string, sku:string, category:'DRESS'|'SHOES'|'BAG'|'ACCESSORY', size?:string,color?:string,rentalPrice:number,replacementValue:number,photos:{publicId:string,url:string}[],status:'ACTIVE'|'MAINTENANCE'|'RETIRED',createdAt:Date };
type Line = {productId:string,name:string,category:Product['category'],rentalPrice:number,replacementValue:number};
type Order = {_id:string, customerName:string, phone:string, channel:'ONLINE'|'WALK_IN',wearDay:string,handoverDay:string,returnDay:string,kind:'LOCAL'|'PROVINCE',region?:Region,address?:string,carrier?:string,tracking?:string,items:Line[],preparation:{alteration:string,rewash:boolean,notes:string},paymentMethod:'CASH'|'BANK_TRANSFER',rentTotal:number,finance:{rentPaid:number,depositPaid:number,depositRefunded:number},depositRequired:number,depositDue:'NONE'|'PICKUP'|'DISPATCH',identityRequired:boolean,identityVerified:boolean,status:'CONFIRMED'|'PREPARING'|'READY'|'HANDED_OVER'|'SHIPPED'|'RETURNED'|'COMPLETED'|'CANCELED',createdAt:Date, updatedAt:Date};
type Slot={_id:string,orderId:string,productId:string,day:string};
type Payment={_id:string,orderId:string,kind:'RENT'|'DEPOSIT_COLLECT'|'DEPOSIT_REFUND',amount:number,method:'CASH'|'BANK_TRANSFER',createdAt:Date};
type Audit={_id:string,action:string,orderId?:string,details?:object,at:Date};
const products=()=>db.collection<Product>('rental_products');
const orders=()=>db.collection<Order>('rental_orders');
const slots=()=>db.collection<Slot>('rental_slots');
const payments=()=>db.collection<Payment>('rental_payments');
const audits=()=>db.collection<Audit>('rental_audits');
const DAY=z.string().refine(validDay,'Ngày không hợp lệ');
const id=z.string().uuid();
const REGION=z.enum(['SOUTH','CENTRAL','NORTH']);
const productInput=z.object({
 name:z.string().trim().min(1).max(160),sku:z.string().trim().min(1).max(60),
 category:z.enum(['DRESS','SHOES','BAG','ACCESSORY']),
 size:z.string().max(50).optional(),color:z.string().max(50).optional(),
 rentalPrice:z.number().int().nonnegative(),replacementValue:z.number().int().positive()
}).strict();
const orderInput=z.object({
 customerName:z.string().trim().min(1).max(150),phone:z.string().trim().min(8).max(20),
 channel:z.enum(['ONLINE','WALK_IN']),wearDay:DAY,
 handoverDay:DAY,returnDay:DAY,kind:z.enum(['LOCAL','PROVINCE']),
 region:REGION.optional(),address:z.string().trim().max(500).optional(),
 carrier:z.string().max(100).optional(),productIds:z.array(id).min(1).max(20),
 preparation:z.object({alteration:z.string().max(300).default(''),rewash:z.boolean().default(false),notes:z.string().max(500).default('')}),
 paymentMethod:z.enum(['CASH','BANK_TRANSFER'])
}).strict();
function token():string {
 const exp=Date.now()+8*60*60*1000;
 const payload=String(exp);
 const sig=createHmac('sha256',COOKIE_SECRET).update(payload).digest('hex');
 return payload+'.'+sig;
}
function authenticated(req:Request):boolean {
 const value=req.cookies?.dress_session;
 if(typeof value!=='string')return false;
 const [expiry,signature]=value.split('.');
 if(!expiry||!signature||! /^\d{13}$/.test(expiry)||Number(expiry)<Date.now())return false;
 const expected=createHmac('sha256',COOKIE_SECRET).update(expiry).digest('hex');
 return signature.length===expected.length&&timingSafeEqual(Buffer.from(signature),Buffer.from(expected));
}
const asyncRoute=(fn:(req:Request,res:Response)=>Promise<unknown>)=>(req:Request,res:Response,next:NextFunction)=>{Promise.resolve(fn(req,res)).catch(next);};
app.post('/api/auth/login',(req,res)=>{
 const {username,password}=z.object({username:z.string(),password:z.string()}).parse(req.body);
 const a=scryptSync(password,'dress-admin-v1',64),b=scryptSync(ADMIN_PASSWORD,'dress-admin-v1',64);
 if(username!==ADMIN_USERNAME||!timingSafeEqual(a,b)){res.status(401).json({error:'Sai tài khoản hoặc mật khẩu'});return;}
 res.cookie('dress_session',token(),{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',maxAge:8*60*60*1000,path:'/api'});
 res.json({ok:true});
});
app.post('/api/auth/logout',(_req,res)=>{res.clearCookie('dress_session',{path:'/api'});res.json({ok:true});});
app.get('/api/health',(_req,res)=>res.json({ok:true,service:'dress-rental-management'}));
app.use('/api',(req,res,next)=>{if(!authenticated(req)){res.status(401).json({error:'Vui lòng đăng nhập'});return;}
 if(!['GET','HEAD','OPTIONS'].includes(req.method)&&(req.get('origin')!==FRONTEND_URL||req.get('x-requested-with')!=='dress-rental')){res.status(403).json({error:'Nguồn yêu cầu không hợp lệ'});return;}
 next();
});
registerIdentityRoutes(app,db);
app.get('/api/products',asyncRoute(async(req,res)=>{
 const q=String(req.query.q||'').toLowerCase();
 const items=await products().find({status:{$ne:'RETIRED'}}).sort({createdAt:-1}).toArray();
 res.json(items.filter(p=>!q||p.name.toLowerCase().includes(q)||p.sku.toLowerCase().includes(q)));
}));
app.post('/api/products',asyncRoute(async(req,res)=>{
 const p=productInput.parse(req.body);
 if(await products().findOne({sku:p.sku})) {res.status(409).json({error:'Mã sản phẩm đã tồn tại'});return;}
 const created:Product={...p,_id:randomUUID(),photos:[],status:'ACTIVE',createdAt:new Date()};
 await products().insertOne(created);res.status(201).json(created);
}));
app.get('/api/products/:id/availability',asyncRoute(async(req,res)=>{
 const productId=id.parse(req.params.id),from=DAY.parse(req.query.from),to=DAY.parse(req.query.to);
 const days=occupiedDays(from,to);
 const conflicts=await slots().find({productId,day:{$in:days}}).toArray();
 res.json({available:conflicts.length===0,conflictingOrderIds:[...new Set(conflicts.map(c=>c.orderId))]});
}));
const cloudEnv=()=>({cloudName:required('CLOUDINARY_CLOUD_NAME'),apiKey:required('CLOUDINARY_API_KEY'),apiSecret:required('CLOUDINARY_API_SECRET')});
app.post('/api/products/:id/photo-signature',asyncRoute(async(req,res)=>{
 const productId=id.parse(req.params.id);
 if(!(await products().findOne({_id:productId}))) {res.status(404).json({error:'Không tìm thấy sản phẩm'});return;}
 const {cloudName,apiKey,apiSecret}=cloudEnv(),timestamp=Math.floor(Date.now()/1000);
 const folder='dress-rental/products/'+productId;
 const canonical='folder='+folder+'&timestamp='+timestamp;
 const {createHash}=await import('node:crypto');
 const signed=createHash('sha1').update(canonical+apiSecret).digest('hex');
 res.json({cloudName,apiKey,timestamp,folder,signature:signed,uploadUrl:'https://api.cloudinary.com/v1_1/'+cloudName+'/image/upload'});
}));
app.post('/api/products/:id/photos',asyncRoute(async(req,res)=>{
 const productId=id.parse(req.params.id);
 const {cloudName,apiSecret}=cloudEnv();
 const photo=z.object({publicId:z.string().min(1).max(350),url:z.string().url(),version:z.number().int().positive(),signature:z.string().regex(/^[a-f0-9]{40}$/)}).parse(req.body);
 if(!photo.publicId.startsWith('dress-rental/products/'+productId+'/')){res.status(400).json({error:'Ảnh không thuộc sản phẩm'});return;}
 const {createHash}=await import('node:crypto');
 const expected=createHash('sha1').update('public_id='+photo.publicId+'&version='+photo.version+apiSecret).digest('hex');
 if(!timingSafeEqual(Buffer.from(photo.signature),Buffer.from(expected))){res.status(403).json({error:'Chữ ký ảnh không hợp lệ'});return;}
 const url=new URL(photo.url);
 if(url.hostname!=='res.cloudinary.com'||!url.pathname.startsWith('/'+cloudName+'/image/upload/')){res.status(400).json({error:'Nguồn ảnh không hợp lệ'});return;}
 const result=await products().updateOne({_id:productId,'photos.publicId':{$ne:photo.publicId}},{$push:{photos:{publicId:photo.publicId,url:photo.url}}});
 if(!result.matchedCount){res.status(409).json({error:'Sản phẩm không tồn tại hoặc ảnh đã lưu'});return;}
 res.json({ok:true});
}));
app.post('/api/orders',asyncRoute(async(req,res)=>{
 const body=orderInput.parse(req.body);
 const itemIds=[...new Set(body.productIds)];
 if(itemIds.length!==body.productIds.length){res.status(400).json({error:'Sản phẩm bị trùng trong đơn'});return;}
 if(body.kind==='PROVINCE'&&(!body.region||!body.address)){res.status(400).json({error:'Đơn tỉnh cần vùng miền và địa chỉ'});return;}
 const handoverDay=body.kind==='PROVINCE'?dispatchDay(body.wearDay,body.region!):body.handoverDay;
 if(handoverDay>body.wearDay||body.returnDay<body.wearDay){res.status(400).json({error:'Ngày giao, ngày mặc hoặc ngày trả không hợp lệ'});return;}
 const days=occupiedDays(handoverDay,body.returnDay);
 const items=await products().find({_id:{$in:itemIds},status:'ACTIVE'}).toArray();
 if(items.length!==itemIds.length){res.status(400).json({error:'Có sản phẩm không còn hoạt động'});return;}
 const lines:Line[]=items.map(p=>({productId:p._id,name:p.name,category:p.category,rentalPrice:p.rentalPrice,replacementValue:p.replacementValue}));
 const rentTotal=lines.reduce((s,p)=>s+p.rentalPrice,0);
 const dressLines=lines.filter(x=>x.category==='DRESS');
 if(dressLines.length!==1){res.status(422).json({error:'Quy định nhiều váy trong một đơn chưa được xác nhận; hiện mỗi đơn chọn đúng một váy'});return;}
 const dress=dressLines[0];
 let policy;
 try{policy=depositPolicy(dress.rentalPrice,body.kind,dress.replacementValue);}catch {res.status(422).json({error:'Cần xác nhận quy định cho mức giá đúng 300.000đ'});return;}
 const now=new Date(),orderId=randomUUID();
 const order:Order={_id:orderId,customerName:body.customerName,phone:body.phone,channel:body.channel,wearDay:body.wearDay,handoverDay,returnDay:body.returnDay,kind:body.kind,region:body.region,address:body.address,carrier:body.carrier,items:lines,preparation:body.preparation,paymentMethod:body.paymentMethod,rentTotal,finance:{rentPaid:0,depositPaid:0,depositRefunded:0},depositRequired:policy.amount,depositDue:policy.due,identityRequired:policy.identityRequired,identityVerified:false,status:'CONFIRMED',createdAt:now,updatedAt:now};
 try {
  await client.withSession(async session=>session.withTransaction(async()=>{
   await slots().insertMany(itemIds.flatMap(productId=>days.map(day=>({_id:productId+':'+day,productId,day,orderId}))),{session});
   await orders().insertOne(order,{session});
   await audits().insertOne({_id:randomUUID(),action:'ORDER_CREATED',orderId,at:now},{session});
  }));
 }catch(err){
  if(err instanceof MongoServerError&&err.code===11000){res.status(409).json({error:'Váy hoặc phụ kiện đã có lịch trong khoảng thời gian này'});return;}
  throw err;
 }
 res.status(201).json(order);
}));
app.get('/api/orders',asyncRoute(async(req,res)=>{
 const docs=await orders().find({}).sort({createdAt:-1}).limit(300).toArray();
 res.json(docs);
}));
app.get('/api/orders/:id/transactions',asyncRoute(async(req,res)=>{
 const orderId=id.parse(req.params.id);
 res.json(await payments().find({orderId}).sort({createdAt:1}).toArray());
}));
app.post('/api/orders/:id/payment',asyncRoute(async(req,res)=>{
 const orderId=id.parse(req.params.id);
 const input=z.object({kind:z.enum(['RENT','DEPOSIT_COLLECT','DEPOSIT_REFUND']),amount:z.number().int().positive(),method:z.enum(['CASH','BANK_TRANSFER'])}).parse(req.body);
 const order=await orders().findOne({_id:orderId});
 if(!order){res.status(404).json({error:'Không thấy đơn'});return;}
 const f=order.finance??{rentPaid:0,depositPaid:0,depositRefunded:0};
 if(input.kind==='RENT'&&(order.status==='CANCELED'||f.rentPaid+input.amount>order.rentTotal)){res.status(422).json({error:'Số tiền thuê không hợp lệ hoặc đơn đã hủy'});return;}
 if(input.kind==='DEPOSIT_COLLECT'&&(order.depositDue==='NONE'||f.depositPaid+input.amount>order.depositRequired||order.status!=='READY')){res.status(422).json({error:'Chưa tới lúc thu cọc hoặc số tiền cọc sai'});return;}
 if(input.kind==='DEPOSIT_REFUND'&&(!['RETURNED','COMPLETED'].includes(order.status)||f.depositRefunded+input.amount>f.depositPaid)){res.status(422).json({error:'Chỉ hoàn cọc đã thu sau khi nhận và kiểm tra váy'});return;}
 const field=input.kind==='RENT'?'rentPaid':input.kind==='DEPOSIT_COLLECT'?'depositPaid':'depositRefunded';
 try{
  await client.withSession(async session=>session.withTransaction(async()=>{
   // Compare-and-swap on the order serializes concurrent requests for the same money.
   const outcome=await orders().updateOne({_id:orderId,status:order.status,finance:f},
     {$set:{['finance.'+field]:f[field]+input.amount,updatedAt:new Date()}},{session});
   if(!outcome.modifiedCount)throw new Error('PAYMENT_STATE_CHANGED');
   await payments().insertOne({_id:randomUUID(),orderId,...input,createdAt:new Date()},{session});
   await audits().insertOne({_id:randomUUID(),action:'PAYMENT_'+input.kind,orderId,details:{amount:input.amount,method:input.method},at:new Date()},{session});
  }));
 }catch(error){
  if(error instanceof Error&&(error.message==='PAYMENT_STATE_CHANGED'||error.message.includes('Write conflict'))){
    res.status(409).json({error:'Đơn đang có giao dịch khác. Vui lòng tải lại trước khi thu hoặc hoàn tiền'});return;
  }
  throw error;
 }
 res.json({ok:true});
}));
app.post('/api/orders/:id/status',asyncRoute(async(req,res)=>{
 const orderId=id.parse(req.params.id);
 const {status,inspectionPassed}=z.object({status:z.enum(['PREPARING','READY','HANDED_OVER','SHIPPED','RETURNED','COMPLETED','CANCELED']),inspectionPassed:z.boolean().optional()}).parse(req.body);
 const order=await orders().findOne({_id:orderId});
 if(!order){res.status(404).json({error:'Không thấy đơn'});return;}
 const transitions:Record<string,string[]>={CONFIRMED:['PREPARING','READY','CANCELED'],PREPARING:['READY','CANCELED'],READY:['HANDED_OVER','SHIPPED','CANCELED'],HANDED_OVER:['RETURNED'],SHIPPED:['RETURNED'],RETURNED:['COMPLETED'],COMPLETED:[],CANCELED:[]};
 if(!transitions[order.status].includes(status)){res.status(422).json({error:'Chuyển trạng thái không hợp lệ'});return;}
 if(status==='SHIPPED'&&order.kind!=='PROVINCE'||status==='HANDED_OVER'&&order.kind!=='LOCAL'){res.status(422).json({error:'Sai hình thức giao'});return;}
 const transactions=await payments().find({orderId}).toArray();
 const sum=(kind:Payment['kind'])=>transactions.filter(p=>p.kind===kind).reduce((s,p)=>s+p.amount,0);
 if(['HANDED_OVER','SHIPPED'].includes(status)&&sum('RENT')<order.rentTotal){res.status(422).json({error:'Chưa thanh toán đủ tiền thuê'});return;}
 if(status==='HANDED_OVER'&&order.identityRequired&&!order.identityVerified){res.status(422).json({error:'Chưa xác nhận CCCD 2 mặt'});return;}
 if(['HANDED_OVER','SHIPPED'].includes(status)&&order.depositRequired>0&&sum('DEPOSIT_COLLECT')<order.depositRequired){res.status(422).json({error:'Phải thu đủ cọc trước khi bàn giao hoặc gửi vận chuyển'});return;}
 if(status==='COMPLETED'&&(inspectionPassed!==true||sum('DEPOSIT_COLLECT')!==sum('DEPOSIT_REFUND'))){res.status(422).json({error:'Chưa kiểm tra đạt hoặc chưa hoàn đủ cọc'});return;}
 const result=await orders().updateOne({_id:orderId,status:order.status},{$set:{status,updatedAt:new Date()}});
 if(!result.modifiedCount){res.status(409).json({error:'Đơn vừa được thay đổi, vui lòng tải lại'});return;}
 if(status==='CANCELED')await slots().deleteMany({orderId});
 await audits().insertOne({_id:randomUUID(),action:'ORDER_STATUS_'+status,orderId,at:new Date()});
 res.json({ok:true});
}));
app.get('/api/dashboard/tomorrow',asyncRoute(async(req,res)=>{
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const field=(type:string)=>parts.find(p=>p.type===type)?.value||'';
 const tzDate=field('year')+'-'+field('month')+'-'+field('day');
 const day=shiftDay(tzDate,1);
 const docs=await orders().find({handoverDay:day,status:{$nin:['CANCELED','COMPLETED']}}).toArray();
 res.json({day,deliveries:docs.filter(x=>x.kind==='LOCAL'),dispatches:docs.filter(x=>x.kind==='PROVINCE'),preparation:docs.filter(x=>x.preparation.rewash||x.preparation.alteration||x.preparation.notes)});
}));
app.get('/api/dashboard/financial',asyncRoute(async(req,res)=>{
 const transactions=await payments().find({}).toArray();
 const total=(kind:Payment['kind'])=>transactions.filter(p=>p.kind===kind).reduce((s,p)=>s+p.amount,0);
 res.json({rentCollected:total('RENT'),depositCollected:total('DEPOSIT_COLLECT'),depositRefunded:total('DEPOSIT_REFUND'),depositOutstanding:total('DEPOSIT_COLLECT')-total('DEPOSIT_REFUND')});
}));
app.use((err:unknown,_req:Request,res:Response,_next:NextFunction)=>{
 if(err instanceof ZodError){res.status(400).json({error:'Dữ liệu không hợp lệ',fields:err.issues.map(x=>({field:x.path.join('.'),message:x.message}))});return;}
 console.error('API error',err);
 res.status(500).json({error:'Có lỗi hệ thống'});
});
async function start(){
 await client.connect();db=client.db(DB_NAME);
 await Promise.all([
  products().createIndex({sku:1},{unique:true}),
  slots().createIndex({orderId:1}),
  payments().createIndex({orderId:1,createdAt:1}),
  orders().createIndex({handoverDay:1,status:1})
 ]);
 app.listen(Number(process.env.PORT)||4000,()=>console.log('Dress rental API listening'));
}
start().catch(e=>{console.error(e);process.exitCode=1;});
