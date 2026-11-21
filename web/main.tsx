import React, {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CalendarDays,ClipboardList,Package,Wallet,Shirt,LogOut,Plus,UploadCloud} from 'lucide-react';
import './style.css';

type Photo={publicId:string,url:string};
type Product={_id:string,sku:string,name:string,category:'DRESS'|'SHOES'|'BAG'|'ACCESSORY',rentalPrice:number,replacementValue:number,photos:Photo[],size?:string,status:string};
type Order={_id:string,customerName:string,phone:string,channel:'ONLINE'|'WALK_IN',wearDay:string,handoverDay:string,returnDay:string,kind:'LOCAL'|'PROVINCE',region?:string,address?:string,items:{productId:string,name:string,rentalPrice:number,category:string}[],rentTotal:number,depositRequired:number,depositDue:string,identityRequired:boolean,identityVerified:boolean,inspectionPassed?:boolean,preparation:{alteration:string,rewash:boolean,notes:string},paymentMethod:string,status:string};
type Workboard={day:string,deliveries:Order[],dispatches:Order[],preparation:Order[]};
type Financial={rentCollected:number,depositCollected:number,depositRefunded:number,depositOutstanding:number};
const money=(value:number)=>value.toLocaleString('vi-VN')+'đ';
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const send=async <T,>(path:string,method='GET',body?:unknown):Promise<T>=>{
 const r=await fetch('/api'+path,{method,credentials:'include',headers:{...(body?{'Content-Type':'application/json'}:{}),...(method!=='GET'?{'x-requested-with':'dress-rental'}:{})},body:body?JSON.stringify(body):undefined});
 const json=await r.json().catch(()=>({error:'Phản hồi máy chủ không hợp lệ'}));
 if(!r.ok)throw Error(json.error||'Yêu cầu thất bại');return json as T;
};
const CAT:Record<string,string>={DRESS:'Váy',SHOES:'Giày',BAG:'Túi',ACCESSORY:'Phụ kiện'};
const STATUS:Record<string,string>={CONFIRMED:'Đã chốt',PREPARING:'Đang chuẩn bị',READY:'Sẵn sàng giao',HANDED_OVER:'Đã giao',SHIPPED:'Đã gửi tỉnh',RETURNED:'Đã nhận trả',COMPLETED:'Hoàn tất',CANCELED:'Đã hủy'};
type Page='dashboard'|'products'|'orders'|'finance';
function App(){
 const [authenticated,setAuthenticated]=useState<boolean|null>(null);
 const [login,setLogin]=useState({username:'admin',password:''});
 const [page,setPage]=useState<Page>('dashboard');
 const [products,setProducts]=useState<Product[]>([]);
 const [orders,setOrders]=useState<Order[]>([]);
 const [work,setWork]=useState<Workboard|null>(null);
 const [financial,setFinancial]=useState<Financial|null>(null);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [loading,setLoading]=useState(false);
 const [newProduct,setNewProduct]=useState({sku:'',name:'',category:'DRESS',size:'',color:'',rentalPrice:0,replacementValue:0});
 const [draft,setDraft]=useState({customerName:'',phone:'',channel:'WALK_IN',wearDay:today(),handoverDay:today(),returnDay:today(),kind:'LOCAL',region:'SOUTH',address:'',carrier:'',productIds:[] as string[],alteration:'',rewash:false,notes:'',paymentMethod:'CASH'});
 const [selectedPhotoProduct,setSelectedPhotoProduct]=useState<string>('');
 const [photoUploading,setPhotoUploading]=useState(false);
 const refresh=async()=>{
  try{
   const [p,o,w,f]=await Promise.all([send<Product[]>('/products'),send<Order[]>('/orders'),send<Workboard>('/dashboard/tomorrow'),send<Financial>('/dashboard/financial')]);
   setProducts(p);setOrders(o);setWork(w);setFinancial(f);setAuthenticated(true);
  }catch(e){if(String(e).includes('đăng nhập'))setAuthenticated(false);else setError((e as Error).message);}
 };
 useEffect(()=>{refresh()},[]);
 const run=async(fn:()=>Promise<unknown>)=>{
  setError('');setNotice('');setLoading(true);
  try{await fn();setNotice('Đã lưu thành công');await refresh()}catch(e){setError((e as Error).message)}finally{setLoading(false)}
 };
 if(authenticated===null)return <main className="center">Đang tải...</main>;
 if(!authenticated)return <main className="login"><form onSubmit={e=>{e.preventDefault();run(async()=>{await send('/auth/login','POST',login);setAuthenticated(true)})}}><h1>Quản lý thuê váy</h1><p>Đăng nhập để làm việc</p><label>Tài khoản<input value={login.username} onChange={e=>setLogin({...login,username:e.target.value})}/></label><label>Mật khẩu<input type="password" value={login.password} onChange={e=>setLogin({...login,password:e.target.value})}/></label><button disabled={loading}>Đăng nhập</button>{error&&<p className="error">{error}</p>}</form></main>;
 const selected=products.filter(p=>draft.productIds.includes(p._id));
 const rent=selected.reduce((n,p)=>n+p.rentalPrice,0);
 const photoUpload=async(file:File)=>{
  if(!selectedPhotoProduct)throw Error('Chọn sản phẩm trước');
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Chỉ nhận JPG, PNG, WebP');
  if(file.size>8*1024*1024)throw Error('Mỗi ảnh tối đa 8MB');
  setPhotoUploading(true);
  try{
   const sign=await send<{cloudName:string,apiKey:string,timestamp:number,folder:string,signature:string,uploadUrl:string}>('/products/'+selectedPhotoProduct+'/photo-signature','POST',{});
   const form=new FormData();
   form.set('file',file);form.set('api_key',sign.apiKey);form.set('timestamp',String(sign.timestamp));form.set('folder',sign.folder);form.set('signature',sign.signature);
   const r=await fetch(sign.uploadUrl,{method:'POST',body:form});
   const uploaded=await r.json();
   if(!r.ok)throw Error(uploaded.error?.message||'Không tải ảnh được');
   await send('/products/'+selectedPhotoProduct+'/photos','POST',{publicId:uploaded.public_id,url:uploaded.secure_url,version:uploaded.version,signature:uploaded.signature});
   await refresh();setNotice('Đã tải ảnh váy');
  }finally{setPhotoUploading(false)}
 };
 return <div className="shell">
  <aside className="sidebar"><h2>Dress Rental</h2><span>Quản lý shop thuê váy</span>
   {([['dashboard','Công việc ngày mai',ClipboardList],['products','Váy & phụ kiện',Shirt],['orders','Đơn thuê & lịch',CalendarDays],['finance','Thanh toán & cọc',Wallet]] as const).map(([key,title,Icon])=><button key={key} className={page===key?'active':''} onClick={()=>setPage(key)}><Icon size={18}/>{title}</button>)}
   <button className="logout" onClick={()=>run(async()=>{await send('/auth/logout','POST',{});setAuthenticated(false)})}><LogOut size={18}/>Đăng xuất</button>
  </aside>
  <main className="main">
   <header><h1>{page==='dashboard'?'Công việc ngày mai':page==='products'?'Danh mục váy & phụ kiện':page==='orders'?'Đặt lịch và đơn thuê':'Thanh toán & tiền cọc'}</h1><span>{today()}</span></header>
   {error&&<div role="alert" className="alert error">{error}</div>}
   {notice&&<div role="status" className="alert success">{notice}</div>}
   {page==='dashboard'&&<section className="content">
     <div className="stats">
      <article><small>Ngày cần chuẩn bị</small><strong>{work?.day||'...'}</strong></article>
      <article><small>Đơn giao tại shop</small><strong>{work?.deliveries.length||0}</strong></article>
      <article><small>Đơn tỉnh cần gửi</small><strong>{work?.dispatches.length||0}</strong></article>
      <article><small>Đơn có yêu cầu chuẩn bị</small><strong>{work?.preparation.length||0}</strong></article>
     </div>
     <h2>Giao / khách lấy tại shop</h2><OrderList items={work?.deliveries||[]} empty="Không có đơn phải giao ngày mai" />
     <h2>Đóng gói và gửi tỉnh</h2><OrderList items={work?.dispatches||[]} empty="Không có đơn tỉnh cần gửi ngày mai" />
     <h2>Bóp váy, giặt lại và ghi chú chuẩn bị</h2><OrderList items={work?.preparation||[]} empty="Không có ghi chú chuẩn bị cho đơn giao ngày mai" />
    </section>}
   {page==='products'&&<section className="content">
    <details className="panel"><summary><Plus size={16}/> Thêm sản phẩm</summary>
     <form className="formgrid" onSubmit={e=>{e.preventDefault();run(async()=>{await send('/products','POST',newProduct);setNewProduct({sku:'',name:'',category:'DRESS',size:'',color:'',rentalPrice:0,replacementValue:0})})}}>
      <label>Mã sản phẩm<input required value={newProduct.sku} onChange={e=>setNewProduct({...newProduct,sku:e.target.value})}/></label>
      <label>Tên sản phẩm<input required value={newProduct.name} onChange={e=>setNewProduct({...newProduct,name:e.target.value})}/></label>
      <label>Loại<select value={newProduct.category} onChange={e=>setNewProduct({...newProduct,category:e.target.value})}>{Object.entries(CAT).map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>
      <label>Size<input value={newProduct.size} onChange={e=>setNewProduct({...newProduct,size:e.target.value})}/></label>
      <label>Màu<input value={newProduct.color} onChange={e=>setNewProduct({...newProduct,color:e.target.value})}/></label>
      <label>Giá thuê niêm yết<input type="number" min="0" value={newProduct.rentalPrice} onChange={e=>setNewProduct({...newProduct,rentalPrice:Number(e.target.value)})}/></label>
      <label>Giá trị váy (cọc đơn tỉnh)<input type="number" min="1" value={newProduct.replacementValue} onChange={e=>setNewProduct({...newProduct,replacementValue:Number(e.target.value)})}/></label>
      <button disabled={loading}>Lưu sản phẩm</button>
     </form>
    </details>
    <div className="product-grid">{products.map(p=><article key={p._id} className="product">
      {p.photos[0]?<img src={p.photos[0].url} alt={p.name}/>:<div className="placeholder"><Shirt size={40}/><span>Chưa có hình</span></div>}
      <div className="product-body"><span className="tag">{CAT[p.category]}</span><h3>{p.name}</h3><small>{p.sku} · Size {p.size||'—'}</small><b>{money(p.rentalPrice)}</b><small>Giá trị: {money(p.replacementValue)}</small>
      <button className="secondary" onClick={()=>setSelectedPhotoProduct(p._id)}><UploadCloud size={16}/> Tải ảnh ({p.photos.length})</button>
      </div></article>)}</div>
    {selectedPhotoProduct&&<div className="modal-backdrop"><div className="modal"><h3>Hình ảnh sản phẩm</h3><p>Chọn ảnh thực tế JPG, PNG hoặc WebP, tối đa 8MB.</p><input type="file" accept="image/jpeg,image/png,image/webp" disabled={photoUploading} onChange={e=>{const f=e.target.files?.[0];if(f)run(()=>photoUpload(f))}}/><div className="mini-photos">{products.find(p=>p._id===selectedPhotoProduct)?.photos.map((photo,index)=><div key={photo.publicId} className="photo-entry"><img src={photo.url} alt="Ảnh sản phẩm"/>{index===0?<small>Ảnh bìa</small>:<button className="secondary" disabled={loading} onClick={()=>{const all=products.find(p=>p._id===selectedPhotoProduct)?.photos||[];run(()=>send('/products/'+selectedPhotoProduct+'/photos/reorder','POST',{publicIds:[photo.publicId,...all.filter(x=>x.publicId!==photo.publicId).map(x=>x.publicId)]}))}}>Đặt bìa</button>}<button className="secondary" disabled={loading} onClick={()=>{if(confirm('Xóa ảnh này khỏi sản phẩm và bộ nhớ lưu trữ?'))run(()=>send('/products/'+selectedPhotoProduct+'/photos/remove','POST',{publicId:photo.publicId}))}}>Xóa</button></div>)}</div><button className="secondary" onClick={()=>setSelectedPhotoProduct('')}>Đóng</button></div></div>}
   </section>}
   {page==='orders'&&<section className="content">
    <details className="panel" open><summary><Plus size={16}/> Tạo đơn thuê mới</summary>
      <form onSubmit={e=>{e.preventDefault();run(async()=>{
       await send('/orders','POST',{customerName:draft.customerName,phone:draft.phone,channel:draft.channel,wearDay:draft.wearDay,handoverDay:draft.handoverDay,returnDay:draft.returnDay,kind:draft.kind,region:draft.kind==='PROVINCE'?draft.region:undefined,address:draft.kind==='PROVINCE'?draft.address:undefined,carrier:draft.carrier||undefined,productIds:draft.productIds,preparation:{alteration:draft.alteration,rewash:draft.rewash,notes:draft.notes},paymentMethod:draft.paymentMethod});
       setDraft({...draft,customerName:'',phone:'',productIds:[],alteration:'',rewash:false,notes:''});
      })}} className="formgrid">
       <label>Khách liên hệ qua<select value={draft.channel} onChange={e=>setDraft({...draft,channel:e.target.value})}><option value="WALK_IN">Đến shop</option><option value="ONLINE">Online</option></select></label>
       <label>Ngày khách cần mặc<input type="date" required value={draft.wearDay} onChange={e=>setDraft({...draft,wearDay:e.target.value})}/></label>
       <label>Ngày giao / khách lấy<input type="date" value={draft.handoverDay} onChange={e=>setDraft({...draft,handoverDay:e.target.value})} disabled={draft.kind==='PROVINCE'}/></label>
       <label>Ngày khách trả dự kiến<input type="date" required value={draft.returnDay} onChange={e=>setDraft({...draft,returnDay:e.target.value})}/></label>
       <label>Hình thức thuê<select value={draft.kind} onChange={e=>setDraft({...draft,kind:e.target.value})}><option value="LOCAL">Tại shop</option><option value="PROVINCE">Gửi tỉnh</option></select></label>
       {draft.kind==='PROVINCE'&&<><label>Khu vực<select value={draft.region} onChange={e=>setDraft({...draft,region:e.target.value})}><option value="SOUTH">Miền Nam — gửi trước 2 ngày</option><option value="CENTRAL">Miền Trung — gửi trước 3 ngày</option><option value="NORTH">Miền Bắc — gửi trước 4 ngày</option></select></label><label className="wide">Địa chỉ nhận hàng<input required value={draft.address} onChange={e=>setDraft({...draft,address:e.target.value})}/></label><label>Đơn vị vận chuyển<input value={draft.carrier} onChange={e=>setDraft({...draft,carrier:e.target.value})}/></label></>}
       <div className="wide product-picker"><h3>Chọn váy, giày, túi, phụ kiện</h3>{products.map(p=><label key={p._id} className="option"><input type="checkbox" checked={draft.productIds.includes(p._id)} onChange={e=>setDraft({...draft,productIds:e.target.checked?[...draft.productIds,p._id]:draft.productIds.filter(x=>x!==p._id)})}/>{p.photos[0]&&<img src={p.photos[0].url} alt=""/>}<span>{CAT[p.category]} · {p.name} ({p.sku})</span><b>{money(p.rentalPrice)}</b></label>)}</div>
       <label className="wide">Khách hàng<input required value={draft.customerName} onChange={e=>setDraft({...draft,customerName:e.target.value})}/></label>
       <label>Số điện thoại<input required value={draft.phone} onChange={e=>setDraft({...draft,phone:e.target.value})}/></label>
       <label>Thanh toán<select value={draft.paymentMethod} onChange={e=>setDraft({...draft,paymentMethod:e.target.value})}><option value="CASH">Tiền mặt</option><option value="BANK_TRANSFER">Chuyển khoản</option></select></label>
       <label>Yêu cầu bóp/chỉnh váy<input value={draft.alteration} onChange={e=>setDraft({...draft,alteration:e.target.value})}/></label>
       <label className="checklabel"><input type="checkbox" checked={draft.rewash} onChange={e=>setDraft({...draft,rewash:e.target.checked})}/> Cần giặt lại trước khi giao</label>
       <label className="wide">Ghi chú chuẩn bị<input value={draft.notes} onChange={e=>setDraft({...draft,notes:e.target.value})}/></label>
       <div className="wide total"><span>Tổng giá thuê niêm yết</span><strong>{money(rent)}</strong></div>
       {rent===300000&&<p className="wide error">Chưa có quy định với đơn đúng 300.000đ; không thể chốt trước khi shop xác nhận.</p>}
       <button className="wide" disabled={loading||!draft.productIds.length||rent===300000}>Kiểm tra lịch và chốt đơn</button>
      </form>
    </details>
    <h2>Danh sách đơn thuê</h2><div className="order-grid">{orders.map(o=><OrderPanel key={o._id} order={o} loading={loading} onAct={run}/>)}</div>
   </section>}
   {page==='finance'&&<section className="content">
    <div className="stats">
     <article><small>Tiền thuê đã thu</small><strong>{money(financial?.rentCollected||0)}</strong></article>
     <article><small>Đã thu cọc</small><strong>{money(financial?.depositCollected||0)}</strong></article>
     <article><small>Đã hoàn cọc</small><strong>{money(financial?.depositRefunded||0)}</strong></article>
     <article><small>Tiền cọc đang giữ</small><strong>{money(financial?.depositOutstanding||0)}</strong></article>
    </div>
    <p className="hint">Tiền cọc là khoản phải hoàn cho khách, không tính vào doanh thu tiền thuê.</p>
    <div className="order-grid">{orders.filter(o=>o.status!=='CANCELED').map(o=><OrderPanel key={o._id} order={o} loading={loading} onAct={run}/>)}</div>
   </section>}
  </main></div>;
}
function OrderList({items,empty}:{items:Order[],empty:string}){
 return <div className="list">{items.length===0?<p className="hint">{empty}</p>:items.map(o=><article key={o._id}><div><strong>{o.customerName}</strong> · {o.phone}<span className="tag">{o.kind==='PROVINCE'?'Đơn tỉnh':'Tại shop'}</span></div><p>{o.items.map(p=>CAT[p.category]+' '+p.name).join(' · ')}</p><small>Mặc {o.wearDay} · Giao/gửi {o.handoverDay} · {o.preparation.alteration&&'Bóp: '+o.preparation.alteration} {o.preparation.rewash&&'· Giặt lại'} {o.preparation.notes&&'· '+o.preparation.notes}</small></article>)}</div>;
}
function OrderPanel({order:o,loading,onAct}:{order:Order,loading:boolean,onAct:(f:()=>Promise<unknown>)=>Promise<void>}){
 const [amount,setAmount]=useState('');const [kind,setKind]=useState<'RENT'|'DEPOSIT_COLLECT'|'DEPOSIT_REFUND'>('RENT');const [method,setMethod]=useState<'CASH'|'BANK_TRANSFER'>(o.paymentMethod==='BANK_TRANSFER'?'BANK_TRANSFER':'CASH');const [checks,setChecks]=useState<Record<string,{present:boolean,clean:boolean,undamaged:boolean}>>({});
 const [inspectionNotes,setInspectionNotes]=useState('');
 const statusChoices:Record<string,string[]>={CONFIRMED:['PREPARING','READY','CANCELED'],PREPARING:['READY','CANCELED'],READY:[o.kind==='PROVINCE'?'SHIPPED':'HANDED_OVER','CANCELED'],HANDED_OVER:['RETURNED'],SHIPPED:['RETURNED'],RETURNED:['COMPLETED']};
 return <article className="order"><div className="order-head"><strong>{o.customerName}</strong><span className="tag">{STATUS[o.status]||o.status}</span></div><small>{o.phone} · {o.channel==='ONLINE'?'Online':'Tại shop'}</small><p>{o.items.map(p=>CAT[p.category]+' '+p.name).join(' · ')}</p><p className="order-dates">Mặc {o.wearDay} · {o.kind==='PROVINCE'?'Gửi':'Giao'} {o.handoverDay} · Trả {o.returnDay}</p>
 <div className="amounts"><span>Thuê <b>{money(o.rentTotal)}</b></span><span>Cọc <b>{money(o.depositRequired)}</b></span></div>
 {o.identityRequired&&<div className="id-documents"><strong>Ảnh CCCD khách (bắt buộc đủ 2 mặt)</strong>{(['FRONT','BACK'] as const).map(side=><label key={side}>{side==='FRONT'?'Mặt trước':'Mặt sau'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={loading} onChange={e=>{const file=e.target.files?.[0];if(!file)return;onAct(async()=>{const response=await fetch('/api/orders/'+o._id+'/identity/'+side,{method:'PUT',credentials:'include',headers:{'Content-Type':file.type,'x-requested-with':'dress-rental'},body:file});const data=await response.json();if(!response.ok)throw Error(data.error||'Lỗi tải CCCD')})}}/></label>)}<small>{o.identityVerified?'Đã xác thực đủ 2 mặt':'Chưa có đủ 2 mặt CCCD'}</small></div>}
 <div className="pay"><select aria-label="Loại giao dịch" value={kind} onChange={e=>setKind(e.target.value as typeof kind)}><option value="RENT">Thu tiền thuê</option><option value="DEPOSIT_COLLECT">Thu cọc</option><option value="DEPOSIT_REFUND">Hoàn cọc</option></select><input type="number" min="1" aria-label="Số tiền" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="Số tiền"/><select aria-label="Phương thức" value={method} onChange={e=>setMethod(e.target.value as typeof method)}><option value="CASH">Tiền mặt</option><option value="BANK_TRANSFER">Chuyển khoản</option></select><button disabled={loading||!Number(amount)} onClick={()=>onAct(async()=>{await send('/orders/'+o._id+'/payment','POST',{kind,amount:Number(amount),method});setAmount('')})}>Ghi nhận</button></div>
 {o.status==='RETURNED'&&<div className="inspection"><h3>Kiểm tra từng món khi khách trả</h3>{o.items.map(item=><div key={item.productId} className="inspection-item"><strong>{CAT[item.category]} · {item.name}</strong>{(['present','clean','undamaged'] as const).map(field=><label className="checklabel" key={field}><input type="checkbox" checked={checks[item.productId]?.[field]||false} onChange={e=>setChecks(prev=>({...prev,[item.productId]:{present:prev[item.productId]?.present||false,clean:prev[item.productId]?.clean||false,undamaged:prev[item.productId]?.undamaged||false,[field]:e.target.checked}}))}/>{field==='present'?'Đủ món':field==='clean'?'Không dơ':'Không hư/lỗi'}</label>)}</div>)}<label>Ghi chú nhận trả<input value={inspectionNotes} onChange={e=>setInspectionNotes(e.target.value)}/></label><button className="secondary" disabled={loading||!o.items.every(item=>checks[item.productId]&&Object.values(checks[item.productId]).every(Boolean))} onClick={()=>onAct(()=>send('/orders/'+o._id+'/return-inspection','POST',{checks:o.items.map(item=>({productId:item.productId,...checks[item.productId],note:''})),notes:inspectionNotes}))}>Xác nhận kiểm tra đạt — cho phép hoàn cọc</button>{o.inspectionPassed&&<small>✓ Đã hoàn thành kiểm tra đầy đủ</small>}</div>}
 <div className="actions">{(statusChoices[o.status]||[]).map(s=><button className="secondary" key={s} disabled={loading} onClick={()=>onAct(()=>send('/orders/'+o._id+'/status','POST',{status:s}))}>{STATUS[s]}</button>)}</div>
 </article>;
}
createRoot(document.getElementById('root')!).render(<App/>);
