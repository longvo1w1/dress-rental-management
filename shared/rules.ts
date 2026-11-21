export type Region = 'SOUTH'|'CENTRAL'|'NORTH';
export type RentalPaymentMethod = 'CASH'|'BANK_TRANSFER';
export type RentalKind = 'LOCAL'|'PROVINCE';

export const shippingBuffers: Record<Region, number> = {
  SOUTH: 2, CENTRAL: 3, NORTH: 4
};

export function validDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === s;
}
export function shiftDay(day:string, offset:number):string {
  if(!validDay(day)) throw new Error('INVALID_DATE');
  const d=new Date(day+'T00:00:00Z');
  d.setUTCDate(d.getUTCDate()+offset);
  return d.toISOString().slice(0,10);
}
export function dispatchDay(wearDay:string, region:Region):string {
  return shiftDay(wearDay,-shippingBuffers[region]);
}
export function depositPolicy(price:number, kind:RentalKind, replacementValue:number) {
  if(kind==='PROVINCE') return {amount:replacementValue, due:'DISPATCH' as const, identityRequired:false};
  if(price<300000) return {amount:0, due:'NONE' as const, identityRequired:true};
  if(price>300000) return {amount:500000, due:'PICKUP' as const, identityRequired:false};
  throw new Error('POLICY_UNDEFINED_EXACTLY_300000');
}
export function occupiedDays(from:string, to:string):string[] {
  if(!validDay(from)||!validDay(to)||from>to) throw new Error('INVALID_RENTAL_INTERVAL');
  const days:string[]=[];
  for(let x=from; x<=to; x=shiftDay(x,1)){
    days.push(x);
    if(days.length>90) throw new Error('RENTAL_INTERVAL_TOO_LONG');
  }
  return days;
}
