import { callDuelHost, requireDuelActor } from "./duel-host";
import type { CardInsightRequest } from "./card-insights-api";
import type { CardEffectSearchResult } from "@yugidraft/shared/services";
import { emptyCardQuery, type CardQueryResult } from "@yugidraft/shared/duels";
/** Format words use the host's authoritative banlist/admission/point path in every web search surface. */
export async function loadFormatEffectSearch(input: Extract<CardInsightRequest,{op:"effectSearch"}>): Promise<
  {ok:true;result:CardEffectSearchResult}|{ok:false;response:Response}> {
  const actor=await requireDuelActor(); if(!actor.ok)return actor;
  const cards:CardEffectSearchResult["cards"]=[],limit=input.limit??30;
  let first:CardQueryResult|undefined;
  for(let offset=0;offset<limit;offset+=30){
    const response=await callDuelHost({op:"card-query",guildId:actor.guildId,playerId:actor.playerId,
      mode:input.format?.endsWith("domain")?"domain":"normal",cardQuery:{...emptyCardQuery(),text:input.text,format:input.format,banlist:input.banlist??"none",
        deckMaster:input.deckMaster??input.deck?.deckMaster,passcodes:input.pool,effectOmit:input.omittedChips?[...input.omittedChips]:undefined,released:input.released,sort:input.sort??"match",
        ...(input.genesysRemaining===undefined?{}:{genesysPoints:{min:0,max:input.genesysRemaining}}),limit:Math.min(limit-offset,30),effectOffset:offset}});
    if(!response.ok)return response;
    const data=response.data as unknown as CardQueryResult;first??=data;
    cards.push(...(data.effectHits??[]).map(card=>({passcode:card.canonicalPasscode??card.code,name:card.name,score:card.score,reason:card.reason,linkedCards:0,release:card.release})));
    if(cards.length>=(data.effectTotal??0)||!data.effectHits?.length)break;
  }
  const groups=first?.effectGroups?.map(group=>({...group,cards:group.cards.slice(0,limit).map(card=>({passcode:card.canonicalPasscode??card.code,name:card.name,score:card.score,reason:card.reason,linkedCards:0,release:card.release}))}));
  return {ok:true,result:{reading:first?.reading??null,cards,total:first?.effectTotal??0,...(groups?{groups}:{}),...(first?.profile?{guide:first.profile}:{})}};
}
