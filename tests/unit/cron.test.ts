import { it,expect } from 'vitest';
import { createApp } from '../../apps/worker/src/app';
import { MemoryRepository } from '../../apps/worker/src/repository';
it('protects scheduled work with a separate server bearer secret',async()=>{
  const repo=new MemoryRepository(),secret='test-scheduler-secret-'.repeat(3),{app}=createApp({DEMO_MODE:'true',CRON_SECRET:secret},repo);
  expect((await app.request('/api/cron')).status).toBe(401);
  expect((await app.request('/api/cron',{headers:{Authorization:'Bearer wrong'}})).status).toBe(401);
  expect((await repo.read()).controls).toHaveLength(0);
  const response=await app.request('/api/cron',{headers:{Authorization:`Bearer ${secret}`}});
  expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');
  expect((await repo.read()).controls.some(c=>c.id==='last-cron')).toBe(true);
});
