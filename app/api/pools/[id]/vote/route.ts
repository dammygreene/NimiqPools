import { apiError,json } from '@/lib/http'; import { addResolutionVote,InputError } from '@/lib/db';
export const runtime='nodejs'; export const dynamic='force-dynamic';
export async function POST(r:Request,c:{params:Promise<{id:string}>}){try{const {id}=await c.params; const b=await r.json(); if(!b.address||!b.outcome)throw new InputError('Address and outcome required.'); addResolutionVote(id,String(b.address),String(b.outcome),String(b.evidenceNote||'')); return json({ok:true},201)}catch(e){return apiError(e)}}
