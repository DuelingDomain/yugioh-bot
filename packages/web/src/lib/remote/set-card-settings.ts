"use client";
import {useCallback,useEffect,useState} from 'react';
import {z} from 'zod';
import {DEFAULT_SET_GUARDS,newSetCardMemory,type SetGuards,type SetCardMemory} from '@yugidraft/vision';

const KEY='dd-field-set-guards:v1',EVENT='dd-field-set-guards-changed';
export const SET_GUARD_SETTINGS=[
  {key:'positiveBack',label:'Require back evidence',query:'setPositiveBack'},
  {key:'prompt',label:'Ask about uncertain Sets',query:'setPrompt'},
  {key:'ignore',label:'Remember Not a card',query:'setIgnore'},
  {key:'startup',label:'Ignore setup objects',query:'setStartup'},
] as const;
const schema=z.object({positiveBack:z.boolean(),prompt:z.boolean(),ignore:z.boolean(),startup:z.boolean()}).partial();
const env=()=>({positiveBack:process.env.NEXT_PUBLIC_FIELD_SET_POSITIVE_BACK,prompt:process.env.NEXT_PUBLIC_FIELD_SET_PROMPT,ignore:process.env.NEXT_PUBLIC_FIELD_SET_IGNORE,startup:process.env.NEXT_PUBLIC_FIELD_SET_STARTUP});
export function readSetGuards():SetGuards {
  let saved:Partial<SetGuards>={};
  try{const parsed=schema.safeParse(JSON.parse(localStorage.getItem(KEY)??'{}'));if(parsed.success)saved=parsed.data;}catch{/* Defaults without storage. */}
  const result={...DEFAULT_SET_GUARDS,...saved},overrides=env();
  const query=typeof window==='undefined'?new URLSearchParams():new URLSearchParams(window.location.search);
  for(const {key,query:name} of SET_GUARD_SETTINGS){const value=query.get(name)??overrides[key];if(value==='0'||value==='1')result[key]=value==='1';}
  return result;
}
export function useSetGuards(){
  const [guards,setGuards]=useState<SetGuards>(DEFAULT_SET_GUARDS);
  useEffect(()=>{const sync=()=>setGuards(readSetGuards());sync();window.addEventListener(EVENT,sync);window.addEventListener('storage',sync);return()=>{window.removeEventListener(EVENT,sync);window.removeEventListener('storage',sync);};},[]);
  const set=useCallback((key:keyof SetGuards,on:boolean)=>{const next={...readSetGuards(),[key]:on};try{localStorage.setItem(KEY,JSON.stringify(next));}catch{/* Current sitting still works. */}setGuards(next);window.dispatchEvent(new Event(EVENT));},[]);
  return {guards,set};
}
const point=z.object({x:z.number().finite(),y:z.number().finite()});
const look=z.array(z.number().min(0).max(1)).length(576);
const memorySchema=z.object({backs:z.array(look).max(32),ignored:z.array(z.object({quad:z.array(point).length(4),look:z.union([look,z.array(z.number()).length(0)]),clear:z.boolean(),source:z.enum(['startup','player'])})).max(512)});
export function loadSetMemory(key:string):SetCardMemory {
  try{const value=memorySchema.safeParse(JSON.parse(sessionStorage.getItem(key)??'null'));if(value.success)return value.data;}catch{/* Owner-local memory fallback. */}
  return newSetCardMemory();
}
export function saveSetMemory(key:string,memory:SetCardMemory){try{sessionStorage.setItem(key,JSON.stringify(memory));}catch{/* The live watcher still remembers. */}}
