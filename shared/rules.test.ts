import {expect,test} from 'vitest';
import {dispatchDay,depositPolicy,occupiedDays} from './rules';
test('province ship offsets match shop rules',()=>{
  expect(dispatchDay('2026-12-20','SOUTH')).toBe('2026-12-18');
  expect(dispatchDay('2026-12-20','CENTRAL')).toBe('2026-12-17');
  expect(dispatchDay('2026-12-20','NORTH')).toBe('2026-12-16');
});
test('deposit at pickup vs dispatch, not revenue',()=>{
  expect(depositPolicy(250000,'LOCAL',1500000)).toEqual({amount:0,due:'NONE',identityRequired:true});
  expect(depositPolicy(450000,'LOCAL',1500000)).toEqual({amount:500000,due:'PICKUP',identityRequired:false});
  expect(depositPolicy(450000,'PROVINCE',1500000)).toEqual({amount:1500000,due:'DISPATCH',identityRequired:false});
  expect(()=>depositPolicy(300000,'LOCAL',1500000)).toThrow('POLICY_UNDEFINED_EXACTLY_300000');
});
test('date slots include boundaries',()=>expect(occupiedDays('2026-11-21','2026-11-23')).toEqual(['2026-11-21','2026-11-22','2026-11-23']));
