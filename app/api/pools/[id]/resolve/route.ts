import { apiError,json } from "@/lib/http"; import { resolvePoolOnSchedule } from "@/lib/resolution-service";
export const runtime='nodejs'; export const dynamic='force-dynamic';
export async function POST(_r:Request,c:{params:Promise<{id:string}>}){try{const {id}=await c.params; return json(await resolvePoolOnSchedule(id));}catch(e){return apiError(e)}}
