import { describe,it,expect } from 'vitest';
import { socialMetadata } from '../../apps/worker/src/metadata';
import { seedDemo } from '../../packages/core/src/demo';
import { duelView } from '../../packages/core/src/views';
describe('social previews',()=>{
  it('renders a public duel with an absolute PNG preview and escaped titles',async()=>{const s=await seedDemo(),d=duelView(s,s.duels[0]);d.challengerProfile.username='<script>"bad';const html=socialMetadata(d,'https://duels.example');expect(html).toContain(`https://duels.example/og/${d.slug}.png`);expect(html).toContain('summary_large_image');expect(html).not.toContain('<script>');expect(html).toContain('&lt;script&gt;&quot;bad');});
  it('does not expose names or images for unlisted duels',async()=>{const s=await seedDemo(),d=duelView(s,s.duels[0]);d.visibility='UNLISTED';expect(socialMetadata(d,'https://duels.example')).toBe('<meta name="robots" content="noindex,nofollow"/>');});
});
