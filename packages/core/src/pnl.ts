import Decimal from 'decimal.js';
import { RULES } from './config.js';
import type { CashFlow, Duel, Position, Price, Snapshot, Status } from './types.js';
import { PORTFOLIO_RULES_VERSION } from './portfolio.js';
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });
export class IntegrityError extends Error { constructor(message: string) { super(message); this.name = 'IntegrityError'; } }
const amount = (value: string) => { const n = new Decimal(value); if (!n.isFinite() || n.isNegative()) throw new IntegrityError('Invalid portfolio valuation'); return n; };
export function timeWeightedReturn(start: string, end: string, flows: Pick<CashFlow, 'timestamp' | 'beforeValueUsd' | 'afterValueUsd' | 'amountUsd' | 'classification'>[] = []): number {
  let base = amount(start); let growth = new Decimal(1);
  if (base.lte(0)) throw new IntegrityError('Starting equity must be positive');
  const ordered = [...flows].sort((a, b) => a.timestamp - b.timestamp);
  for (const flow of ordered) {
    if (flow.classification === 'CLASSIFICATION_PENDING') throw new IntegrityError('Unresolved external cash flow');
    const before = amount(flow.beforeValueUsd); const after = amount(flow.afterValueUsd); const delta = new Decimal(flow.amountUsd);
    if (!delta.isFinite() || after.minus(before).minus(delta).abs().gt('0.000001')) throw new IntegrityError('Cash-flow evidence does not reconcile');
    if (base.lte(0)) throw new IntegrityError('Cannot value a period after complete portfolio withdrawal');
    growth = growth.mul(before.div(base)); base = after;
  }
  if (base.lte(0)) throw new IntegrityError('Cannot value a period after complete portfolio withdrawal');
  return growth.mul(amount(end).div(base)).minus(1).mul(100).toNumber();
}
export function valuePosition(input: Omit<Position, 'valueUsd' | 'excludedUsd' | 'reason'>, timestamp: number): Position {
  const balance = amount(input.balance); const p = input.price;
  const reject = (reason: string, gross = '0'): Position => ({ ...input, valueUsd: '0', excludedUsd: gross, reason });
  if (balance.isZero()) return reject('Zero balance');
  if (!p) return reject('Missing price; valuation incomplete');
  const gross = balance.mul(amount(p.usd));
  if (p.timestamp > timestamp || timestamp - p.timestamp > RULES.maxPriceAgeSeconds * 1000) return reject('Price outside the valuation window', gross.toString());
  if (gross.lt(RULES.minimumPositionUsd)) return reject('Dust below $1', gross.toString());
  if (new Decimal(p.liquidity).lt(RULES.minimumLiquidityUsd)) return reject('Insufficient pool liquidity', gross.toString());
  if (p.divergence > RULES.maxCrossPoolDivergence) return reject('Cross-pool price disagreement', gross.toString());
  if (p.poolCreatedAt && timestamp - p.poolCreatedAt < RULES.minimumPoolAgeSeconds * 1000) return reject('Pool is too new', gross.toString());
  const ratio = gross.div(p.liquidity);
  if (ratio.gt(RULES.maxPositionToLiquidity)) return reject('Position exceeds 25% of pool liquidity', gross.toString());
  const haircut = ratio.lte(RULES.fullValueRatio) ? 1 : ratio.lte(RULES.mediumRatio) ? 0.9 : 0.5;
  return { ...input, valueUsd: gross.mul(haircut).toString(), excludedUsd: gross.mul(new Decimal(1).minus(haircut)).toString(), ...(haircut < 1 ? { reason: `${Math.round((1 - haircut) * 100)}% liquidity haircut` } : {}) };
}
export function selectPool(prices: Price[]): Price | null {
  const valid = prices.filter(p => new Decimal(p.usd).gt(0) && new Decimal(p.liquidity).gte(RULES.minimumLiquidityUsd)).sort((a,b) => new Decimal(b.liquidity).cmp(a.liquidity));
  if (!valid.length) return null;
  const best = { ...valid[0] }; const peers = valid.slice(1, 3).filter(p => new Decimal(p.liquidity).gte(new Decimal(best.liquidity).mul(0.1)));
  best.divergence = peers.reduce((max, p) => Math.max(max, new Decimal(p.usd).minus(best.usd).abs().div(best.usd).toNumber()), 0);
  if (best.divergence > RULES.maxCrossPoolDivergence) best.confidence = 'LOW';
  return best;
}
export const TRANSITIONS: Record<Status, Status[]> = { OPEN: ['AWAITING_DEPOSIT','CANCELLED'], AWAITING_DEPOSIT: ['ACTIVE','CANCELLED','DISPUTED'], ACTIVE: ['CALCULATING','DISPUTED'], CALCULATING: ['FINALIZING','DISPUTED'], FINALIZING: ['COMPLETED','DISPUTED'], COMPLETED: [], CANCELLED: [], DISPUTED: ['CALCULATING','CANCELLED'] };
export function transition(duel: Duel, status: Status): void { if (!TRANSITIONS[duel.status].includes(status)) throw new IntegrityError(`Illegal transition ${duel.status} → ${status}`); duel.status = status; }
export function stableStringify(value: unknown): string { if (value === null || typeof value !== 'object') return JSON.stringify(value)??'null'; if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`; return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`; }
export async function hashResult(value: unknown): Promise<string> { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableStringify(value))); return Array.from(new Uint8Array(digest), n=>n.toString(16).padStart(2,'0')).join(''); }
export async function calculateDuelResult(duel: Duel, snapshots: Snapshot[], flows: CashFlow[]) {
  if (![RULES.version,PORTFOLIO_RULES_VERSION].includes(duel.rulesVersion)) throw new IntegrityError('Unsupported rules version');
  if (!!duel.chains !== (duel.rulesVersion === PORTFOLIO_RULES_VERSION)) throw new IntegrityError('Rules do not match portfolio scope');
  if (!duel.startsAt || !duel.endsAt) throw new IntegrityError('Missing duel boundaries');
  const evidence = [duel.challenger, duel.opponent].map(wallet => {
    const list = snapshots.filter(s=>s.duelId===duel.id && s.wallet===wallet).sort((a,b)=>a.timestamp-b.timestamp);
    const first = list[0]; const last = list.at(-1);
    if (!first || !last || first.id === last.id) throw new IntegrityError('Missing start or end snapshot');
    if (Math.abs(first.timestamp - duel.startsAt!) > RULES.endToleranceSeconds * 1000 || Math.abs(last.timestamp - duel.endsAt!) > RULES.endToleranceSeconds * 1000) throw new IntegrityError('Snapshot missed the duel boundary');
    if (list.some(s=>s.quality==='INCOMPLETE' || !s.transactionCoverage)) throw new IntegrityError('Incomplete valuation or transaction coverage');
    if (!duel.demo && list.flatMap(s=>s.components??[s]).some(s=>s.chain!=='solana'&&(!s.blockHash||!duel.finalityProofs?.some(p=>p.chain===s.chain&&p.block===s.block&&p.blockHash===s.blockHash)))) throw new IntegrityError('Canonical finality is not confirmed');
    if (duel.chains) {
      if (!duel.demo && !duel.portfolioWallets?.[wallet]) throw new IntegrityError('Missing locked portfolio wallets');
      for (const snapshot of list) {
        const parts=snapshot.components??[];
        if(parts.length!==duel.chains.length||duel.chains.some(chain=>parts.filter(p=>p.chain===chain).length!==1))throw new IntegrityError('Missing or duplicate chain evidence');
        if(parts.some(p=>p.duelId!==duel.id||p.wallet!==wallet||p.rulesVersion!==duel.rulesVersion||p.quality==='INCOMPLETE'||!p.transactionCoverage||p.components||Math.abs(p.timestamp-snapshot.timestamp)>RULES.endToleranceSeconds*1000))throw new IntegrityError('Incomplete combined portfolio evidence');
        if(!parts.reduce((sum,p)=>sum.add(amount(p.totalUsd)),new Decimal(0)).eq(snapshot.totalUsd))throw new IntegrityError('Combined portfolio equity does not reconcile');
      }
    }
    if ([first,last].some((snapshot,index)=>(snapshot.components??[snapshot]).some(part=>Math.abs(part.timestamp-(index===0?duel.startsAt!:duel.endsAt!))>RULES.endToleranceSeconds*1000)))throw new IntegrityError('Chain snapshot missed the duel boundary');
    if (new Decimal(first.totalUsd).lt(RULES.minimumStartUsd)) throw new IntegrityError('Starting equity below $10');
    const cashflows = flows.filter(f=>f.duelId===duel.id && f.wallet===wallet && f.timestamp>=first.timestamp && f.timestamp<=last.timestamp);
    return { wallet, start: first, end: last, flows: cashflows, returnPct: timeWeightedReturn(first.totalUsd, last.totalUsd, cashflows) };
  });
  const [a,b] = evidence; const winner = new Decimal(a.returnPct).minus(b.returnPct).abs().lte(RULES.tiePercentagePoints) ? null : a.returnPct > b.returnPct ? a.wallet : b.wallet;
  const result = { duelId: duel.id, rulesVersion: duel.rulesVersion, ...(!duel.demo?{finalityProofs:duel.finalityProofs}:{}), ...(duel.chains?{chains:duel.chains,portfolioWallets:duel.portfolioWallets}:{}), evidence, winner };
  return { challengerReturn: a.returnPct, opponentReturn: b.returnPct, winner, resultHash: await hashResult(result), evidence };
}
