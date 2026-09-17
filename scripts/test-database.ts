import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { seedDemo } from '../packages/core/src/demo';
import { TABLE_NAMES } from '../packages/core/src/types';
const container=`pnl-duels-postgres-test-${process.pid}`;
const docker=(args:string[],input?:string)=>{const r=spawnSync('docker',args,{encoding:'utf8',input,maxBuffer:16*1024*1024});if(r.status!==0)throw new Error(r.stderr||r.stdout);return r.stdout;};
const sql=(statement:string)=>docker(['exec','-i',container,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-At'],statement);
try{
  docker(['run','--rm','-d','--name',container,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-alpine']);
  for(let n=0;n<30;n++){try{sql('select 1;');break;}catch{await new Promise(r=>setTimeout(r,300));}}
  sql('create role anon; create role authenticated; create role service_role;');
  for(const file of ['001_schema.sql','002_atomic_functions.sql','003_evidence_guards.sql'])sql(readFileSync(`supabase/migrations/${file}`,'utf8'));
  const state=await seedDemo();const changes=TABLE_NAMES.flatMap(table=>state[table].map(row=>({table,id:row.id,data:row})));
  const escaped=JSON.stringify(changes).replaceAll("'","''");assert.equal(sql(`select duels_commit(0,'${escaped}'::jsonb);`).trim(),'t');
  const result=JSON.parse(sql('select duels_read_state();'));assert.equal(result.state.duels.length,state.duels.length);assert.equal(result.state.snapshots.length,state.snapshots.length);
  assert.equal(sql("select duels_commit(0,'[]'::jsonb);").trim(),'f','optimistic lock must reject stale commits');
  assert.throws(()=>sql('set role anon; select * from wallet_profiles;'),'RLS blocks anonymous access');
  assert.throws(()=>sql(`update portfolio_snapshots set data=data || '{"totalUsd":"99"}'::jsonb where id='${state.snapshots[0].id}';`),'direct updates cannot rewrite evidence');
  assert.throws(()=>sql(`delete from portfolio_snapshots where id='${state.snapshots[0].id}';`),'direct deletion cannot erase evidence');
  const snapshotChange=JSON.stringify([{table:'snapshots',id:state.snapshots[0].id,data:{...state.snapshots[0],totalUsd:'100'}}]).replaceAll("'","''");assert.throws(()=>sql(`select duels_commit(1,'${snapshotChange}'::jsonb);`));
  assert.equal(sql("select duels_rate_limit('test',1,9999999999999); select duels_rate_limit('test',1,9999999999999);").trim(),'t\nf');
  console.log('PASS PostgreSQL migrations, complete seed, consistent read, optimistic lock, anonymous access denial, append-only commit and rate limits.');
}finally{try{docker(['stop',container]);}catch{/* Only this test container is targeted. */}}
