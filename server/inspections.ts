import {randomUUID} from 'node:crypto';
import type {Router} from 'express';
import type {Db} from 'mongodb';
import {z} from 'zod';

const inspectionInput=z.object({
 checks:z.array(z.object({
  productId:z.string().uuid(),
  present:z.boolean(),clean:z.boolean(),undamaged:z.boolean(),
  note:z.string().max(500).default('')
 })).min(1).max(30),
 notes:z.string().max(1000).default('')
}).strict();

export function registerReturnInspections(app:Router,db:()=>Db){
 const orders=()=>db().collection<{
  _id:string,status:string,items:{productId:string,name:string}[],
  inspectionPassed?:boolean,updatedAt:Date
 }>('rental_orders');
 const inspections=()=>db().collection('rental_return_inspections');
 app.get('/orders/:id/return-inspection',async(req,res)=>{
  const doc=await inspections().findOne({orderId:req.params.id});
  res.json(doc??{orderId:req.params.id,checks:[],inspected:false});
 });
 app.post('/orders/:id/return-inspection',async(req,res)=>{
  const order=await orders().findOne({_id:req.params.id});
  if(!order){res.status(404).json({error:'Đơn không tồn tại'});return;}
  if(order.status!=='RETURNED'){res.status(422).json({error:'Chỉ kiểm tra khi váy đã được nhận trả'});return;}
  const body=inspectionInput.parse(req.body);
  const ids=new Set(body.checks.map(x=>x.productId));
  if(ids.size!==body.checks.length||ids.size!==order.items.length||order.items.some(item=>!ids.has(item.productId))){
   res.status(422).json({error:'Phải kiểm tra đủ váy, giày, túi và tất cả phụ kiện trong đơn'});return;
  }
  const passed=body.checks.every(c=>c.present&&c.clean&&c.undamaged);
  const time=new Date();
  await inspections().updateOne({orderId:order._id},{$set:{
   orderId:order._id,checks:body.checks,notes:body.notes,passed,updatedAt:time
  },$setOnInsert:{_id:randomUUID()}},{upsert:true});
  await orders().updateOne({_id:order._id,status:'RETURNED'},{$set:{inspectionPassed:passed,updatedAt:time}});
  res.json({ok:true,passed,canRefund:passed});
 });
}
