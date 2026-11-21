import type {Router} from 'express';
import type {Db} from 'mongodb';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
const schema=z.object({
 itemIds:z.array(z.string().uuid()).min(1),
 checkedByCustomer:z.boolean(),
 packedForCarrier:z.boolean(),
 carrier:z.string().max(120).optional(),
 tracking:z.string().max(120).optional(),
 notes:z.string().max(800).default('')
}).strict();
export function registerHandover(app:Router,getDb:()=>Db){
 const orders=()=>getDb().collection<{_id:string,items:{productId:string}[],kind:string,status:string,handoverChecked?:boolean,updatedAt:Date,carrier?:string,tracking?:string}>('rental_orders');
 const checklists=()=>getDb().collection('rental_handover_checks');
 app.post('/orders/:id/handover-check',async(req,res)=>{
  const order=await orders().findOne({_id:req.params.id});
  if(!order){res.status(404).json({error:'Không tìm thấy đơn'});return;}
  if(order.status!=='READY'){res.status(422).json({error:'Chỉ bàn giao khi đơn sẵn sàng'});return;}
  const body=schema.parse(req.body);
  const actual=new Set(body.itemIds);
  if(actual.size!==order.items.length||order.items.some(x=>!actual.has(x.productId))){
   res.status(422).json({error:'Vui lòng kiểm tra đủ tất cả váy, giày, túi và phụ kiện'});return;
  }
  if(order.kind==='LOCAL'&&!body.checkedByCustomer){res.status(422).json({error:'Phải cho khách kiểm tra trước khi giao'});return;}
  if(order.kind==='PROVINCE'&&!body.packedForCarrier){res.status(422).json({error:'Phải xác nhận đóng gói đủ trước khi giao vận chuyển'});return;}
  const time=new Date();
  await checklists().updateOne({orderId:order._id},{$set:{orderId:order._id,...body,checkedAt:time},$setOnInsert:{_id:randomUUID()}},{upsert:true});
  await orders().updateOne({_id:order._id,status:'READY'},{$set:{handoverChecked:true,carrier:body.carrier||order.carrier,tracking:body.tracking||order.tracking,updatedAt:time}});
  res.json({ok:true});
 });
}
