"use client";
import { useEffect, useRef, useState } from "react";
import type { RemoteRoom } from "@yugidraft/shared/remote";
import { useVideoHub } from "../ui/video-hub";
import s from "./phone.module.css";

function Preview({room,seat,name}:{room:RemoteRoom;seat:number;name:string}){
  const hub=useVideoHub();const source=hub.sourceFor(seat);const video=useRef<HTMLVideoElement>(null);
  const [note,setNote]=useState("");const [reading,setReading]=useState(false);
  const inFlight=useRef(false);
  useEffect(()=>{const element=video.current;if(element&&source)return source.attach(element);},[source]);
  async function read(clientX?:number,clientY?:number){
      if(inFlight.current)return;
      const element=video.current;if(!element?.videoWidth)return;
      const box=element.getBoundingClientRect(),scale=Math.min(box.width/element.videoWidth,box.height/element.videoHeight);
      const width=element.videoWidth*scale,height=element.videoHeight*scale;
      const x=clientX===undefined?.5:(clientX-box.left-(box.width-width)/2)/width,y=clientY===undefined?.5:(clientY-box.top-(box.height-height)/2)/height;
      if(x<0||x>1||y<0||y>1)return;
      inFlight.current=true;setReading(true);setNote("Reading on the feed owner's desktop…");
      try{const result=await hub.read(seat,x,y);setNote(result.guesses[0]?.name || result.note || "No card found. Try more light and move closer.");}
      catch(e){setNote(e instanceof Error?e.message:"Could not read this frame");}
      finally{inFlight.current=false;setReading(false);}
  }
  if(!source)return null;
  return <div className={s.lobbyPreview}><b>{name} · {hub.health(seat).label}</b>
    <button type="button" disabled={reading} aria-label={`Test card reader on ${name}'s phone`} data-testid={`lobby-phone-feed-${seat}`}
      onPointerDown={event=>{if(event.button===0&&event.isPrimary)void read(event.clientX,event.clientY);}}
      onClick={event=>{if(event.detail===0)void read();}}><video ref={video} autoPlay playsInline muted/></button>
    <small>Click a face-up card to test the reader. Start the table to announce cards.</small><p role="status" data-testid={`lobby-phone-read-${seat}`}>{note}</p>
  </div>;
}
export function PhoneLobbyPreview({room}:{room:RemoteRoom}){
  return <div className={s.lobbyPreviews}>{room.seats.map(seat=><Preview key={seat.seat} room={room} seat={seat.seat} name={seat.displayName}/>)}</div>;
}
