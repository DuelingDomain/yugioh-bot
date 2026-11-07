import {searchSimdBytes} from './search-simd-bytes';
import type {LoadedIndex} from './types';
let compiled:WebAssembly.Module|undefined,unavailable=false;
/** Optional exact SIMD acceleration; CSP/unsupported engines retain the scalar path. */
export function createSimdSearch(index:LoadedIndex):((query:Float32Array)=>Float64Array)|undefined {
  const {dim,count}=index.meta;
  if(unavailable || !count || dim%4)return;
  try {
    compiled??=new WebAssembly.Module(searchSimdBytes);
    const instance=new WebAssembly.Instance(compiled),memory=instance.exports.memory as WebAssembly.Memory;
    const queryOffset=0,rowsOffset=dim*4,outOffset=Math.ceil((rowsOffset+count*dim*4)/8)*8;
    const bytes=outOffset+count*8,pages=Math.ceil(bytes/65536);
    if(pages>1)memory.grow(pages-1);
    new Float32Array(memory.buffer,rowsOffset,count*dim).set(index.vectors);
    const input=new Float32Array(memory.buffer,queryOffset,dim),output=new Float64Array(memory.buffer,outOffset,count);
    const dots=instance.exports.dots as (q:number,r:number,o:number,n:number,d:number)=>void;
    let valid=false;
    return query=>{
      // Ranking priors/border hints do not change raw dot products. Check values
      // as callers may mutate a Float32Array between reads; identity alone is unsafe.
      if(!valid || query.some((v,i)=>v!==input[i])) {
        input.set(query);dots(queryOffset,rowsOffset,outOffset,count,dim);valid=true;
      }
      return output;
    };
  }catch {unavailable=true;return;}
}
