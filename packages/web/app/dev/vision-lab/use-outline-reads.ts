"use client";

// Hover/peek and board workflow adapted from Duel Lens preview.tsx, board.ts (Apache-2.0).
// Same-frame local cache and React cancellation replace extension session/history services.
// See packages/vision/src/licenses/duel-lens.LICENSE.
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { BoardCard, BoardResult, BoardSide, DetectedQuad, PeekResult, Recognizer } from "@yugidraft/vision";

export function useOutlineReads(frame: RefObject<ImageBitmap | null>, reader: () => Recognizer,
  busy: RefObject<boolean>, setBusy: (busy: boolean) => void, onError: (error: string) => void) {
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hiding = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const active = useRef<AbortController | null>(null);
  const pending = useRef<Promise<void> | null>(null);
  const boardActive = useRef<AbortController | null>(null);
  const cache = useRef(new Map<number, PeekResult>());
  const [peek, setPeek] = useState<{index:number;left:number;top:number;value?:PeekResult;error?:string} | null>(null);
  const [board, setBoard] = useState<BoardResult | null>(null);
  const [reading, setReading] = useState(false);
  const [side, setSide] = useState<BoardSide>("near");
  const [seat, setSeat] = useState("0");
  const [twins, setTwins] = useState<Record<string, BoardCard[]>>({});

  const cancelPeek = useCallback(async () => {
    generation.current++;
    clearTimeout(timer.current); clearTimeout(hiding.current);
    active.current?.abort(); active.current=null; setPeek(null);
    await pending.current;
  }, []);
  const reset = useCallback(() => {
    void cancelPeek(); boardActive.current?.abort(); boardActive.current=null; cache.current.clear();
    setBoard(null); setTwins({}); setReading(false);
  }, [cancelPeek]);
  useEffect(() => () => {generation.current++;clearTimeout(timer.current);clearTimeout(hiding.current);active.current?.abort();boardActive.current?.abort();}, []);

  const showPeek = (index: number, cards: DetectedQuad[], anchor: DOMRect) => {
    if(busy.current || !frame.current) return;
    const previous=cancelPeek();
    const run=generation.current;
    const position={index,left:Math.max(8,Math.min(anchor.right+8,window.innerWidth-268)),top:Math.max(8,Math.min(anchor.top,window.innerHeight-100))};
    timer.current=setTimeout(()=>{
      const task=(async()=>{
        await previous;
        if(run!==generation.current || busy.current || !frame.current) return;
        const cached=cache.current.get(index);
        if(cached) {setPeek({...position,value:cached});return;}
        const controller=new AbortController();active.current=controller;
        let clone:ImageBitmap|undefined;
        setPeek(position);
        try {
          clone=await createImageBitmap(frame.current);
          if(run!==generation.current || controller.signal.aborted) return;
          const value=await reader().peek(clone,{card:cards[index],cards,signal:controller.signal});
          if(run===generation.current && !controller.signal.aborted) {cache.current.set(index,value);setPeek({...position,value});}
        } catch(error) {
          if(run===generation.current && !controller.signal.aborted) setPeek({...position,error:error instanceof Error?error.message:'Peek unavailable'});
        } finally {clone?.close();if(active.current===controller)active.current=null;}
      })();
      pending.current=task;
    },250);
  };
  const leavePeek = () => {clearTimeout(hiding.current);hiding.current=setTimeout(()=>{void cancelPeek();},150);};
  const keepPeek = () => {clearTimeout(hiding.current);};
  const readAll = async (cards: DetectedQuad[]) => {
    if(busy.current || !frame.current) return;
    busy.current=true;setBusy(true);setReading(true);setBoard(null);
    const controller=new AbortController();boardActive.current=controller;
    await cancelPeek();
    let clone:ImageBitmap|undefined;
    try {
      if(!frame.current || controller.signal.aborted) return;
      clone=await createImageBitmap(frame.current);
      if(controller.signal.aborted) return;
      const result=await reader().readAll(clone,{cards,signal:controller.signal});
      if(controller.signal.aborted) return;
      setBoard(result);setTwins(previous=>({...previous,[seat]:result[side]}));
      for(const entry of [...result.near,...result.far]) if(!entry.error) cache.current.set(entry.index,entry);
    } catch(error) {
      if(!controller.signal.aborted) onError(error instanceof Error?error.message:'Board read failed');
    } finally {
      clone?.close();
      if(boardActive.current===controller) {boardActive.current=null;busy.current=false;setBusy(false);setReading(false);}
    }
  };
  return {peek,board,reading,side,setSide,seat,setSeat,twins,showPeek,leavePeek,keepPeek,cancelPeek,reset,readAll,
    cancelBoard:()=>boardActive.current?.abort()};
}
