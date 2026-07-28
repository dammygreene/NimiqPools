import { getPool, listResolutionVotes, setPoolResolution } from "./db";

type Row = Record<string, unknown>;

type Resolution = { status: "RESOLVED" | "PENDING" | "REFUNDED"; outcome: string | null; observedValue?: string | number | null; proof: Record<string, unknown> };

function parse<T>(value: unknown, fallback: T): T {
  try { return typeof value === "string" ? JSON.parse(value) as T : (value as T) ?? fallback; } catch { return fallback; }
}
function compare(value:number, operator:string, target:number){
  if(operator==='>') return value>target;
  if(operator==='>=') return value>=target;
  if(operator==='<') return value<target;
  if(operator==='<=') return value<=target;
  if(operator==='==') return value===target;
  throw new Error(`Unsupported comparator ${operator}`);
}
function binaryOutcome(pool:Row, yes:boolean){
  const outcomes=parse<string[]>(pool.outcomes,[]);
  return yes ? outcomes[0] : outcomes[1];
}

async function binance(pool:Row, c:any):Promise<Resolution>{
  const time=new Date(String(pool.event_resolves_at)).getTime();
  const url=new URL('https://api.binance.com/api/v3/klines');
  url.searchParams.set('symbol',String(c.symbol)); url.searchParams.set('interval',String(c.interval||'1m'));
  url.searchParams.set('startTime',String(time-60000)); url.searchParams.set('endTime',String(time+60000)); url.searchParams.set('limit','2');
  const response=await fetch(url,{cache:'no-store'}); if(!response.ok) return {status:'PENDING',outcome:null,proof:{provider:'Binance',httpStatus:response.status}};
  const rows=await response.json() as any[]; if(!rows.length) return {status:'PENDING',outcome:null,proof:{provider:'Binance',reason:'No closed candle'}};
  const row=rows.find(r=>Number(r[6])<=time) ?? rows[0]; const value=Number(row[4]);
  return {status:'RESOLVED',outcome:binaryOutcome(pool,compare(value,String(c.operator||c.comparator||'>'),Number(c.target??c.value))),observedValue:value,proof:{provider:'Binance',symbol:c.symbol,openTime:row[0],closeTime:row[6],close:value,fetchedAt:new Date().toISOString()}};
}
async function coingecko(pool:Row,c:any):Promise<Resolution>{
  const id=encodeURIComponent(String(c.coinId)); const vs=encodeURIComponent(String(c.versusCurrency||c.vsCurrency||'usd'));
  const headers:Record<string,string>={}; if(process.env.COINGECKO_API_KEY) headers['x-cg-demo-api-key']=process.env.COINGECKO_API_KEY;
  const response=await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=${vs}&include_last_updated_at=true`,{headers,cache:'no-store'});
  if(!response.ok) return {status:'PENDING',outcome:null,proof:{provider:'CoinGecko',httpStatus:response.status}};
  const data=await response.json() as any; const value=Number(data[c.coinId]?.[c.versusCurrency||c.vsCurrency||'usd']);
  if(!Number.isFinite(value)) return {status:'PENDING',outcome:null,proof:{provider:'CoinGecko',reason:'No price'}};
  return {status:'RESOLVED',outcome:binaryOutcome(pool,compare(value,String(c.operator||c.comparator||'>'),Number(c.target??c.value))),observedValue:value,proof:{provider:'CoinGecko',coinId:c.coinId,value,providerTimestamp:data[c.coinId]?.last_updated_at,fetchedAt:new Date().toISOString()}};
}
async function football(pool:Row,c:any):Promise<Resolution>{
  const response=await fetch(`https://api.football-data.org/v4/matches/${encodeURIComponent(String(c.fixtureId||c.matchId))}`,{headers:{'X-Auth-Token':process.env.FOOTBALL_DATA_API_KEY||''},cache:'no-store'});
  if(!response.ok) return {status:'PENDING',outcome:null,proof:{provider:'football-data.org',httpStatus:response.status}};
  const match=await response.json() as any; if(match.status!=='FINISHED') return {status:'PENDING',outcome:null,proof:{provider:'football-data.org',status:match.status}};
  const h=Number(match.score?.fullTime?.home), a=Number(match.score?.fullTime?.away); const outcomes=parse<string[]>(pool.outcomes,[]);
  const outcome=h>a?outcomes[0]:h===a?outcomes[1]:outcomes[2];
  return {status:'RESOLVED',outcome,observedValue:`${h}-${a}`,proof:{provider:'football-data.org',matchId:match.id,status:match.status,score:match.score?.fullTime,fetchedAt:new Date().toISOString()}};
}
type ApiSportsResolutionResponse = {
  response?: Array<{
    fixture?: { id?: number; status?: { short?: string } };
    goals?: { home?: number; away?: number };
  }>;
};

async function apiSports(pool:Row,c:Record<string,unknown>):Promise<Resolution>{
  const url=new URL('https://v3.football.api-sports.io/fixtures');
  url.searchParams.set('id',String(c.fixtureId||c.matchId));
  const response=await fetch(url,{headers:{'x-apisports-key':process.env.API_SPORTS_KEY||''},cache:'no-store'});
  if(!response.ok) return {status:'PENDING',outcome:null,proof:{provider:'API-Sports',httpStatus:response.status}};
  const data=await response.json() as ApiSportsResolutionResponse; const fixture=data.response?.[0];
  if(!fixture) return {status:'PENDING',outcome:null,proof:{provider:'API-Sports',reason:'Fixture not found'}};
  const status=String(fixture.fixture?.status?.short||'');
  if(!['FT','AET','PEN'].includes(status)) return {status:'PENDING',outcome:null,proof:{provider:'API-Sports',status}};
  const h=Number(fixture.goals?.home), a=Number(fixture.goals?.away); const outcomes=parse<string[]>(pool.outcomes,[]);
  const outcome=h>a?outcomes[0]:h===a?outcomes[1]:outcomes[2];
  return {status:'RESOLVED',outcome,observedValue:`${h}-${a}`,proof:{provider:'API-Sports',fixtureId:fixture.fixture?.id,status,score:{home:h,away:a},fetchedAt:new Date().toISOString()}};
}
async function weather(pool:Row,c:any):Promise<Resolution>{
  const metric=String(c.metric||'temperature_2m'); const date=new Date(String(pool.event_resolves_at));
  const day=date.toISOString().slice(0,10); const url=new URL('https://archive-api.open-meteo.com/v1/archive');
  url.searchParams.set('latitude',String(c.latitude)); url.searchParams.set('longitude',String(c.longitude)); url.searchParams.set('start_date',day); url.searchParams.set('end_date',day); url.searchParams.set('hourly',metric); url.searchParams.set('timezone',String(c.timezone||'UTC'));
  const response=await fetch(url,{cache:'no-store'}); if(!response.ok) return {status:'PENDING',outcome:null,proof:{provider:'Open-Meteo',httpStatus:response.status}};
  const data=await response.json() as any; const times:string[]=data.hourly?.time||[]; const values:number[]=data.hourly?.[metric]||[];
  const targetHour=date.toISOString().slice(0,13); let i=times.findIndex(t=>t.startsWith(targetHour)); if(i<0)i=0; const value=Number(values[i]);
  if(!Number.isFinite(value)) return {status:'PENDING',outcome:null,proof:{provider:'Open-Meteo',reason:'No observation'}};
  return {status:'RESOLVED',outcome:binaryOutcome(pool,compare(value,String(c.operator||c.comparator||'>'),Number(c.target??c.value))),observedValue:value,proof:{provider:'Open-Meteo',metric,value,providerTime:times[i],coordinates:[c.latitude,c.longitude],fetchedAt:new Date().toISOString()}};
}
function manual(pool:Row):Resolution{
  const votes=listResolutionVotes(String(pool.id)); const outcomes=parse<string[]>(pool.outcomes,[]);
  if(!votes.length) return Date.now()>new Date(String(pool.resolution_deadline)).getTime()?{status:'REFUNDED',outcome:null,proof:{provider:'Manual',reason:'No votes by deadline'}}:{status:'PENDING',outcome:null,proof:{provider:'Manual',reason:'Awaiting votes'}};
  const tally=new Map<string,number>(); for(const v of votes){const o=String(v.outcome); if(outcomes.includes(o))tally.set(o,(tally.get(o)||0)+1)}
  const sorted=[...tally].sort((a,b)=>b[1]-a[1]); const top=sorted[0];
  if(!top || top[1]*2<=votes.length) return Date.now()>new Date(String(pool.resolution_deadline)).getTime()?{status:'REFUNDED',outcome:null,proof:{provider:'Manual',reason:'No majority',tally:Object.fromEntries(tally)}}:{status:'PENDING',outcome:null,proof:{provider:'Manual',tally:Object.fromEntries(tally)}};
  return {status:'RESOLVED',outcome:top[0],proof:{provider:'Manual',tally:Object.fromEntries(tally),voteCount:votes.length,fetchedAt:new Date().toISOString()}};
}

export async function resolvePoolOnSchedule(poolId:string){
  const pool=getPool(poolId); if(!pool) throw new Error('Pool not found');
  if(Date.now()<new Date(String(pool.event_resolves_at)).getTime()) return {status:'PENDING',outcome:null,proof:{reason:'Event has not reached resolution time'}};
  const config=parse<any>(pool.resolver_config,{}); const type=String(pool.resolver_type).toUpperCase();
  let result:Resolution;
  if(type==='BINANCE') result=await binance(pool,config); else if(type==='COINGECKO') result=await coingecko(pool,config); else if(type==='FOOTBALL_DATA') result=await football(pool,config); else if(type==='API_SPORTS') result=await apiSports(pool,config); else if(type==='OPEN_METEO') result=await weather(pool,config); else result=manual(pool);
  if(result.status==='RESOLVED') setPoolResolution(poolId,result.outcome,result.proof,'RESOLVED',result.observedValue);
  else if(result.status==='REFUNDED') setPoolResolution(poolId,null,result.proof,'REFUNDED',result.observedValue);
  else setPoolResolution(poolId,null,result.proof,'AWAITING_RESOLUTION',result.observedValue);
  return result;
}
