"use client";
import type {SetDecision} from '@yugidraft/vision';
import {clipAction} from './clip-capture';
export const NOT_A_CARD_EVENT='remote-not-a-card';
/** Decisions without a board mutation ride the existing test-recording clock request. Local ring otherwise. */
let serial=0;
const pending:{n:number;slug:string;decision:SetDecision}[]=[];
export function recordSetDecision(slug:string,decision:SetDecision){
  pending.push({n:++serial,slug,decision});if(pending.length>512)pending.shift();
  clipAction('note',{setCandidate:decision});
  if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('remote-set-candidate',{detail:decision}));
}
export const pendingSetDecisions=(slug:string)=>pending.filter(p=>p.slug===slug).slice(0,8);
export function acknowledgeSetDecisions(ids:readonly number[]){for(let i=pending.length-1;i>=0;i--)if(ids.includes(pending[i].n))pending.splice(i,1);}
/** The board's existing correction popup delegates the local region memory to its owner watcher. */
export function announceNotACard(slug:string,seat:number,ref:string){window.dispatchEvent(new CustomEvent(NOT_A_CARD_EVENT,{detail:{slug,seat,ref}}));}
