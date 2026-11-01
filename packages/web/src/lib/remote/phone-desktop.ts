import { ConnectionState, Room, RoomEvent, type RemoteParticipant } from "livekit-client";
import { boundedJpegSize, PHONE_TOPIC, CHUNK_CHARS, MAX_JPEG_CHARS, phoneMessageSchema, phoneSeat, type PhoneMember, type PhoneMessage, type PhoneReading, type PhoneScan, type PhoneZone } from "./phone-protocol";
import type { VideoMember } from "./video-protocol";

type Capture = {identity:string;start:number;x:number;y:number;chunks:string[];count?:number;width?:number;height?:number;decoding?:boolean;timer:ReturnType<typeof setTimeout>;resolve:(frame:HTMLCanvasElement)=>void;reject:(e:Error)=>void};
export class DesktopPhoneLink {
  private pending=new Map<string,Capture>();
  private scanIds=new Set<string>();
  private modes=new Map<string,"video"|"scan">();
  private scanning=false;
  private reading=false;
  private activeScan?:{id:string;identity:string;abort:AbortController};
  private readyScanId?:string;
  private readyScanIdentity?:string;
  private closed=false;
  phones:PhoneMember[]=[];
  constructor(private room:Room,private options:{slug:string;guildId:string;seat:number;members:VideoMember[];
    read?:(canvas:HTMLCanvasElement,point:{x:number;y:number},signal:AbortSignal)=>Promise<PhoneReading>;
    onScan?:(scan:PhoneScan|null)=>void;changed:()=>void}) {
    room.on(RoomEvent.DataReceived,this.receive);
    room.on(RoomEvent.ParticipantDisconnected,this.disconnected);
    room.on(RoomEvent.ParticipantConnected,this.ready);
    room.on(RoomEvent.Connected,this.ready);
  }
  setRoster(phones:PhoneMember[],members:VideoMember[]) {
    this.phones=phones;this.options.members=members;
    for(const identity of this.modes.keys())if(!this.phone(identity))this.modes.delete(identity);
    for(const [id,p] of this.pending) if(!this.phone(p.identity)) this.cancel(id,"Phone pairing changed");
    if(this.activeScan&&!this.phone(this.activeScan.identity))this.activeScan.abort.abort();
    if(this.readyScanIdentity&&!this.phone(this.readyScanIdentity))this.clearReady();
    this.options.changed();this.ready();
  }
  seat(participant:{identity:string;metadata?:string}) {return phoneSeat(participant.identity,participant.metadata,this.options.guildId,this.options.slug,this.options.members,this.phones);}
  private rosterPhone(identity:string) {return this.phones.find(p=>p.paired && identity===`remote-phone-${p.id}` && this.options.members.some(m=>m.userId===p.userId && m.seat===p.seat));}
  phone(identity:string) {
    const p=this.room.remoteParticipants.get(identity);
    if(p)return this.seat(p)!==undefined?p:undefined;
    return this.rosterPhone(identity)?{identity}:undefined;
  }
  forSeat(seat:number) {const p=this.phones.find(p=>p.seat===seat && p.paired);return p?this.phone(`remote-phone-${p.id}`):undefined;}
  mode(participant:{identity:string}) {return this.modes.get(participant.identity) ?? this.phones.find(p=>`remote-phone-${p.id}` === participant.identity)?.mode ?? "video";}
  dataOnlyFeeds() {return this.phones.filter(p=>p.paired && this.rosterPhone(`remote-phone-${p.id}`) && this.modes.has(`remote-phone-${p.id}`) && !this.room.remoteParticipants.has(`remote-phone-${p.id}`)).map(p=>({seat:p.seat,mode:this.modes.get(`remote-phone-${p.id}`)!}));}
  private ready=()=>{if(this.room.state!==ConnectionState.Connected)return;const phone=this.forSeat(this.options.seat);if(phone)void this.send({type:"ready"},phone.identity).catch(()=>undefined);};
  private send(message:PhoneMessage,identity:string) {
    return this.room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(message)),{reliable:true,topic:PHONE_TOPIC,destinationIdentities:[identity]});
  }
  private cancel(id:string,reason:string) {const p=this.pending.get(id);if(p){clearTimeout(p.timer);this.pending.delete(id);p.reject(new Error(reason));}}
  capture(x:number,y:number,id=crypto.randomUUID()):Promise<HTMLCanvasElement> {
    const phone=this.forSeat(this.options.seat);
    if(!phone) return Promise.reject(new Error("Phone disconnected. Reconnect it or use manual play."));
    if(this.pending.size) return Promise.reject(new Error("Wait for the current phone scan"));
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>this.cancel(id,"Phone did not send a still in time"),20_000);
      this.pending.set(id,{identity:phone.identity,start:Date.now(),x,y,chunks:[],timer,resolve,reject});
      void this.send({type:"capture",id,x,y},phone.identity).catch(()=>this.cancel(id,"Phone disconnected"));
    });
  }
  async read(x:number,y:number,signal:AbortSignal):Promise<PhoneReading> {
    if(!this.options.read) throw new Error("The desktop card reader is unavailable");
    signal.throwIfAborted();
    if(this.reading||this.scanning||this.readyScanId)throw new Error("Finish the current phone read first");
    this.reading=true;
    const id=crypto.randomUUID();const abort=()=>this.cancel(id,"Scan cancelled");signal.addEventListener("abort",abort,{once:true});
    try {const frame=await this.capture(x,y,id);signal.throwIfAborted();return await this.options.read(frame,{x,y},signal);}
    finally {this.reading=false;signal.removeEventListener("abort",abort);}
  }
  private clearReady(){this.readyScanId=undefined;this.readyScanIdentity=undefined;this.options.onScan?.(null);}
  private disconnected=(p:RemoteParticipant)=>{
    this.modes.delete(p.identity);this.options.changed();
    for(const [id,capture] of this.pending)if(capture.identity===p.identity)this.cancel(id,"Phone disconnected");
    if(this.activeScan?.identity===p.identity)this.activeScan.abort.abort();
    if(this.readyScanIdentity===p.identity)this.clearReady();
  };
  reset(){this.modes.clear();this.activeScan?.abort.abort();for(const id of this.pending.keys())this.cancel(id,"Table video stopped");this.clearReady();}
  answer(id:string,note:string) {if(this.readyScanId===id)this.clearReady();const phone=this.forSeat(this.options.seat);if(phone) void this.send({type:"answer",id,note,guesses:[]},phone.identity).catch(()=>undefined);}
  private receive=(bytes:Uint8Array,participant?:RemoteParticipant,_kind?:unknown,topic?:string,_encryption?:unknown,identity?:string)=>{
    if(this.closed || topic!==PHONE_TOPIC || bytes.byteLength>12_000) return;
    // Data-only phones can be missing from the SFU participant cache. Its authenticated
    // sender identity must still match the active pair and current member roster.
    const sender=participant ?? (identity?this.phone(identity):undefined);
    const seat=participant?this.seat(participant):identity?this.rosterPhone(identity)?.seat:undefined;
    if(!sender || seat===undefined)return;
    let input:unknown;try {input=JSON.parse(new TextDecoder().decode(bytes));}catch{return;}
    const parsed=phoneMessageSchema.safeParse(input);if(!parsed.success)return;const m=parsed.data;
    if(m.type === "status") {this.modes.set(sender.identity,m.mode);this.options.changed();this.ready();return;}
    if(seat!==this.options.seat) return;
    if(m.type === "scan") {void this.scan(sender,m.id,m.zone);return;}
    if(m.type === "cancel") {
      this.cancel(m.id,"Scan cancelled on phone");
      if(this.activeScan?.id===m.id)this.activeScan.abort.abort();
      if(this.readyScanId===m.id){this.clearReady();}return;
    }
    if(m.type !== "frame") return;
    const p=this.pending.get(m.id);
    if(!p || p.decoding || p.identity!==sender.identity || Date.now()-p.start>20_000 || m.width*m.height>2_073_600) return;
    if(p.count!==undefined && (p.count!==m.count || p.width!==m.width || p.height!==m.height)) {this.cancel(m.id,"Invalid phone frame");return;}
    if(m.index>=m.count || (m.index<m.count-1 && m.data.length!==CHUNK_CHARS)) {this.cancel(m.id,"Invalid phone chunk");return;}
    p.count=m.count;p.width=m.width;p.height=m.height;p.chunks[m.index]=m.data;
    if(p.chunks.filter(Boolean).length!==m.count) return;
    p.decoding=true;
    const encoded=p.chunks.join("");if(encoded.length>MAX_JPEG_CHARS){this.cancel(m.id,"Phone still too large");return;}
    void (async()=>{
      const raw=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
      const size=boundedJpegSize(raw);
      if(!size || size.width!==m.width || size.height!==m.height)throw new Error("Invalid phone JPEG dimensions");
      const bitmap=await createImageBitmap(new Blob([raw],{type:"image/jpeg"}));
      try {
        if(this.closed || this.pending.get(m.id)!==p || !this.phone(p.identity))return;
        if(bitmap.width!==m.width || bitmap.height!==m.height) throw new Error("Unexpected phone still dimensions");
        const canvas=document.createElement("canvas");canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext("2d")!.drawImage(bitmap,0,0);this.pending.delete(m.id);clearTimeout(p.timer);p.resolve(canvas);
      } finally {bitmap.close();}
    })().catch(e=>this.cancel(m.id,e instanceof Error?e.message:"Invalid phone frame"));
  };
  private async scan(participant:{identity:string},id:string,zone:PhoneZone) {
    if(this.reading || this.scanning || this.readyScanId || this.scanIds.has(id) || !this.options.read) {this.answer(id,"A scan is already being read. Try again in a moment.");return;}
    this.scanIds.add(id);if(this.scanIds.size>128)this.scanIds.delete(this.scanIds.values().next().value!);
    this.scanning=true;const started=performance.now();
    const abort=new AbortController();this.activeScan={id,identity:participant.identity,abort};
    const cancel=()=>this.cancel(id,"Scan cancelled");abort.signal.addEventListener("abort",cancel,{once:true});
    const timer=setTimeout(()=>abort.abort(),60_000);
    try {
      const frame=await this.capture(.5,.5,id);
      const reading=await this.options.read(frame,{x:.5,y:.5},abort.signal);
      if(this.closed || abort.signal.aborted || !this.phone(participant.identity)) return;
      this.readyScanId=id;this.readyScanIdentity=participant.identity;
      this.options.onScan?.({id,zone,reading,ms:Math.round(performance.now()-started),pairId:participant.identity.slice("remote-phone-".length)});
      await this.send({type:"answer",id,done:false,guesses:reading.guesses,note:reading.reader === "vision" ? "Choose the card on your desktop to announce it." : reading.note},participant.identity);
    }catch(e){await this.send({type:"answer",id,guesses:[],note:e instanceof Error?e.message:"Scan failed"},participant.identity).catch(()=>undefined);}
    finally{clearTimeout(timer);abort.signal.removeEventListener("abort",cancel);this.activeScan=undefined;this.scanning=false;}
  }
  dispose(){this.closed=true;this.reset();this.room.off(RoomEvent.ParticipantConnected,this.ready);this.room.off(RoomEvent.Connected,this.ready);this.room.off(RoomEvent.ParticipantDisconnected,this.disconnected);this.room.off(RoomEvent.DataReceived,this.receive);for(const id of this.pending.keys())this.cancel(id,"Table video stopped");this.modes.clear();}
}
