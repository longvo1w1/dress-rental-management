import type {Request,Response,Router} from 'express';
import express from 'express';
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {Binary, type Db} from 'mongodb';

/**
 * CCCD image data is encrypted before persistence and is NEVER returned by
 * the public product-image CDN. Environment: IDENTITY_ENCRYPTION_KEY = 64 hex
 * chars (32 random bytes). Only accessible through authenticated API routes.
 */
export function registerIdentityRoutes(router:Router,db:Db) {
 const keyHex=process.env.IDENTITY_ENCRYPTION_KEY;
 if(!keyHex || !/^[a-f\d]{64}$/i.test(keyHex))throw new Error('IDENTITY_ENCRYPTION_KEY must be 64 hex characters');
 const key=Buffer.from(keyHex,'hex');
 const ids=db.collection<{_id:string,orderId:string,side:'FRONT'|'BACK',iv:Binary,authTag:Binary,ciphertext:Binary,mime:string,updatedAt:Date}>('rental_identity_documents');
 const orders=db.collection<{_id:string,identityRequired:boolean,identityVerified:boolean}>('rental_orders');

 function sniff(buf:Buffer):string|undefined {
  if(buf.length>=3 && buf[0]===0xff&&buf[1]===0xd8&&buf[2]===0xff)return 'image/jpeg';
  if(buf.length>=8&&buf.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  if(buf.length>=12&&buf.subarray(0,4).toString()==='RIFF'&&buf.subarray(8,12).toString()==='WEBP')return 'image/webp';
 }
 const raw=express.raw({type:['image/jpeg','image/png','image/webp','application/octet-stream'],limit:'5mb'});
 router.get('/orders/:id/identity/status',async(req:Request,res:Response)=>{
  const order=await orders.findOne({_id:req.params.id});
  if(!order){res.status(404).json({error:'Không có đơn'});return;}
  if(!order.identityRequired){res.json({required:false,front:false,back:false});return;}
  const docs=await ids.find({orderId:req.params.id}).project({side:1}).toArray();
  res.json({required:true,front:docs.some(d=>d.side==='FRONT'),back:docs.some(d=>d.side==='BACK')});
 });
 router.put('/orders/:id/identity/:side',raw,async(req:Request,res:Response)=>{
  const orderId=String(req.params.id),side=String(req.params.side).toUpperCase();
  if(!/^[\da-f-]{36}$/i.test(orderId)||!['FRONT','BACK'].includes(side)){res.status(400).json({error:'Tham số không hợp lệ'});return;}
  const order=await orders.findOne({_id:orderId});
  if(!order||!order.identityRequired){res.status(404).json({error:'Đơn không yêu cầu CCCD'});return;}
  const bytes=Buffer.isBuffer(req.body)?req.body:Buffer.alloc(0);
  if(bytes.length<128||bytes.length>5*1024*1024){res.status(400).json({error:'Ảnh không hợp lệ hoặc quá 5MB'});return;}
  const mime=sniff(bytes);
  if(!mime){res.status(415).json({error:'Chỉ hỗ trợ JPEG, PNG hoặc WebP'});return;}
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  const ciphertext=Buffer.concat([cipher.update(bytes),cipher.final()]);
  const authTag=cipher.getAuthTag();
  await ids.updateOne({_id:orderId+':'+side},{$set:{orderId,side:side as 'FRONT'|'BACK',iv:new Binary(iv),authTag:new Binary(authTag),ciphertext:new Binary(ciphertext),mime,updatedAt:new Date()}},{upsert:true});
  const all=await ids.find({orderId}).project({side:1}).toArray();
  await orders.updateOne({_id:orderId},{$set:{identityVerified:all.some(x=>x.side==='FRONT')&&all.some(x=>x.side==='BACK')}});
  res.json({ok:true,side,verified:all.some(x=>x.side==='FRONT')&&all.some(x=>x.side==='BACK')});
 });
 // Authenticated preview by explicit user request. No caching, no external URLs.
 router.get('/orders/:id/identity/:side',async(req:Request,res:Response)=>{
  const side=String(req.params.side).toUpperCase();
  if(!['FRONT','BACK'].includes(side)){res.status(400).json({error:'Mặt CCCD không hợp lệ'});return;}
  const doc=await ids.findOne({_id:String(req.params.id)+':'+side});
  if(!doc){res.status(404).json({error:'Không có ảnh CCCD'});return;}
  try{
   const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(doc.iv.buffer));
   decipher.setAuthTag(Buffer.from(doc.authTag.buffer));
   const data=Buffer.concat([decipher.update(Buffer.from(doc.ciphertext.buffer)),decipher.final()]);
   res.setHeader('Content-Type',doc.mime);
   res.setHeader('Cache-Control','no-store, private');
   res.setHeader('Content-Disposition','inline; filename="identity-image"');
   res.setHeader('X-Content-Type-Options','nosniff');
   res.end(data);
  }catch{res.status(500).json({error:'Không giải mã được hồ sơ'});}
 });
}
