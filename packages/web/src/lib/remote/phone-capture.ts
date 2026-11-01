import { LocalVideoTrack, Room, RoomEvent, Track, ConnectionState } from "livekit-client";
import { PHONE_TOPIC, MAX_JPEG_CHARS, CHUNK_CHARS, phoneMessageSchema, type PhoneMessage, type PhoneZone, type PhoneCrop } from "./phone-protocol";

type Credentials={url:string;token:string;device:string;userId:number;seat:number;guildId:string;id:string};
export type CameraCapabilities=MediaTrackCapabilities & {torch?:boolean;focusMode?:string[];exposureMode?:string[];focusDistance?:{min:number;max:number};exposureTime?:{min:number;max:number};zoom?:{min:number;max:number}};
export type PhoneCameraState={connection:string;error:string;ownerReady:boolean;mode:"video"|"scan";stream:MediaStream|null;devices:MediaDeviceInfo[];deviceId:string;caps:CameraCapabilities;note:string;busy:boolean;sharpness:number;light:number;resolution:string;wake:string;battery:string};
export const initialPhoneState:PhoneCameraState={connection:"Not paired",error:"",ownerReady:false,mode:"video",stream:null,devices:[],deviceId:"",caps:{},note:"",busy:false,sharpness:0,light:0,resolution:"",wake:"",battery:"Keep the phone cool. Scan mode uses less battery."};
/** Small sampled center-crop meter; a framing hint, never a claim that a card was detected. */
export function frameQuality(source:CanvasImageSource,width:number,height:number,point?:{x:number;y:number}) {
  const w=point?64:160,h=point?64:120;
  const canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext("2d",{willReadFrequently:true})!;
  const side=Math.min(width,height)*(point ? .55 : 1),x=Math.max(0,Math.min(width-side,(point?.x??.5)*width-side/2)),y=Math.max(0,Math.min(height-side,(point?.y??.5)*height-side/2));
  ctx.drawImage(source,x,y,side,side,0,0,w,h);
  const {data}=ctx.getImageData(0,0,w,h);const gray=new Float32Array(w*h);let light=0;
  for(let i=0;i<gray.length;i++){gray[i]=data[i*4]*.299+data[i*4+1]*.587+data[i*4+2]*.114;light+=gray[i];}
  let sum=0,squared=0,n=0;
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;const v=4*gray[i]-gray[i-1]-gray[i+1]-gray[i-w]-gray[i+w];sum+=v;squared+=v*v;n++;}
  return {sharpness:Math.round(squared/n-(sum/n)**2),light:Math.round(light/gray.length/255*100)};
}
export class PhoneCamera {
  private room=new Room({adaptiveStream:false,dynacast:false});
  private credentials?:Credentials;private camera?:LocalVideoTrack;private video?:HTMLVideoElement;
  private state=initialPhoneState;private listeners=new Set<()=>void>();private closed=false;private working=false;private renewal?:ReturnType<typeof setInterval>;private meter?:ReturnType<typeof setInterval>;private retry?:ReturnType<typeof setTimeout>;
  private wake?:WakeLockSentinel;private battery?:EventTarget;private batteryUpdate?:()=>void;private generation=0;
  private storageKey:string;
  private sessionGeneration=0;
  private exchanges=new Set<AbortController>();
  private activeScan?:string;
  private scanDeadline?:ReturnType<typeof setTimeout>;
  private ring:{bitmap:ImageBitmap;at:number}[]=[];
  private ringTimer?:ReturnType<typeof setInterval>;
  private buffering?:Promise<void>;
  private pruneRing(now=performance.now()) {
    while(this.ring.length && (this.ring.length>6 || now-this.ring[0].at>1000))this.ring.shift()!.bitmap.close();
  }
  private bufferFrame():Promise<void> {
    if(this.buffering)return this.buffering;
    const video=this.video,gen=this.generation;
    if(!video?.videoWidth || video.readyState<2)return Promise.resolve();
    this.buffering=(async()=>{
      const bitmap=await createImageBitmap(video);
      if(this.closed || gen!==this.generation){bitmap.close();return;}
      const at=performance.now();this.ring.push({bitmap,at});this.pruneRing(at);
    })().finally(()=>{this.buffering=undefined;});
    return this.buffering;
  }
  constructor(private slug:string){
    this.storageKey=`remote-phone:${slug}`;
    this.state={...initialPhoneState,mode:sessionStorage.getItem(`${this.storageKey}:mode`)==="scan"?"scan":"video"};
    this.room.on(RoomEvent.DataReceived,(bytes,participant,_kind,topic,_encryption,identity)=>{
      const isOwner=participant?this.owner(participant):!!this.credentials && identity===`remote-user-${this.credentials.userId}`;
      if(topic!==PHONE_TOPIC || bytes.byteLength>12_000 || !isOwner) return;
      try{const m=phoneMessageSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));if(!m.success)return;
        if(m.data.type === "ready")this.patch({ownerReady:true});
        if(m.data.type === "capture") void this.capture(m.data.id,{x:m.data.x,y:m.data.y}).catch(e=>this.patch({busy:false,error:e instanceof Error?e.message:"Capture failed"}));
        if(m.data.type === "answer" && m.data.id===this.activeScan) {
          if(m.data.done!==false){if(this.scanDeadline)clearTimeout(this.scanDeadline);this.activeScan=undefined;}
          this.patch({busy:m.data.done===false,note:m.data.note});
        }
      }catch{/* Malformed packets are ignored. */}
    });
    this.room.on(RoomEvent.ParticipantConnected,()=>void this.status());
    this.room.on(RoomEvent.ParticipantDisconnected,p=>{if(this.owner(p)){this.cancelScan();this.patch({ownerReady:false,note:"Desktop disconnected. Open the table there to resume scanning."});}});
    this.room.on(RoomEvent.ConnectionStateChanged,connection=>{this.patch({connection});if(connection === ConnectionState.Connected)void this.status();});
    this.room.on(RoomEvent.Disconnected,()=>{
      if(!this.closed && this.credentials){this.patch({connection:"Reconnecting…",ownerReady:false});this.retry=setTimeout(()=>void this.reconnect(),2000);}
    });
    window.addEventListener("online",this.online);document.addEventListener("visibilitychange",this.visible);
  }
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  getSnapshot=()=>this.state;
  private patch(value:Partial<PhoneCameraState>){if(this.closed)return;this.state={...this.state,...value};for(const fn of this.listeners)fn();}
  private owner(p:{identity:string;metadata?:string}){
    try{const m=JSON.parse(p.metadata??"");return this.credentials && p.identity===`remote-user-${this.credentials.userId}` && m.userId===this.credentials.userId && m.seat===this.credentials.seat && m.guildId===this.credentials.guildId && m.tableId===this.slug;}catch{return false;}
  }
  private valid(gen:number){if(this.closed||gen!==this.sessionGeneration)throw new DOMException("Camera session stopped","AbortError");}
  private async exchange(body:object,gen=this.sessionGeneration){
    const abort=new AbortController();this.exchanges.add(abort);
    try{
      const response=await fetch(`/api/remote/${encodeURIComponent(this.slug)}/phone/connect`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),cache:"no-store",signal:abort.signal});
      const value=await response.json();this.valid(gen);
      if(!response.ok){if(response.status===401){sessionStorage.removeItem(this.storageKey);await this.stop();this.patch({error:value.error??"Pairing expired. Get a new code."});}throw new Error(value.error??"Pairing failed");}
      this.credentials=value;sessionStorage.setItem(this.storageKey,value.device);return value as Credentials;
    }finally{this.exchanges.delete(abort);}
  }
  async connect(pair?:string,code?:string){
    if(this.working || this.closed)return;const gen=++this.sessionGeneration;this.working=true;this.patch({busy:true,error:"",connection:"Pairing…"});
    try{
      // A fresh QR replaces a previous device capability; reloads resume with the stored scoped capability.
      const device=sessionStorage.getItem(this.storageKey);
      const c=await this.exchange(pair?{pair}:code?{code}:{device},gen);
      history.replaceState(null,"",location.pathname);
      this.valid(gen);
      await this.room.connect(c.url,c.token,{autoSubscribe:false});
      this.valid(gen);
      if(this.state.mode==="video"){await this.startCamera();this.valid(gen);await this.publish();}
      await this.status();
      this.valid(gen);await this.acquireWake();this.valid(gen);void this.batteryHint();
      if(this.renewal)clearInterval(this.renewal);
      this.renewal=setInterval(()=>void this.exchange({device:this.credentials?.device}).then(()=>this.status()).catch(e=>{if((e as Error).name!=="AbortError")this.patch({error:e.message});}),20_000);
      this.patch({connection:this.room.state});
    }catch(e){if(gen===this.sessionGeneration&&!this.closed)this.patch({error:e instanceof Error?e.message:"Could not connect"});}
    finally{this.working=false;this.patch({busy:false});}
  }
  private async reconnect(){
    if(this.closed || this.working || !this.credentials || this.room.state===ConnectionState.Connected)return;
    this.working=true;const gen=this.sessionGeneration;
    try{const c=await this.exchange({device:this.credentials.device});this.valid(gen);await this.room.connect(c.url,c.token,{autoSubscribe:false});this.valid(gen);if(this.state.mode === "video"){await this.startCamera();this.valid(gen);await this.publish();}}
    catch(e){this.patch({error:e instanceof Error?e.message:"Reconnecting…"});if(this.credentials&&!this.closed)this.retry=setTimeout(()=>void this.reconnect(),3000);}
    finally{this.working=false;}
  }
  private online=()=>void this.reconnect();
  private visible=()=>{if(document.visibilityState === "visible"){void this.acquireWake();if(this.camera?.mediaStreamTrack.readyState === "ended")void this.setCamera(this.state.deviceId);void this.reconnect();}};
  private async acquireWake(){
    if(!this.credentials || document.visibilityState!=="visible")return;
    try{if(!this.wake || this.wake.released){this.wake=await navigator.wakeLock.request("screen");if(this.closed||!this.credentials){await this.wake.release();return;}this.wake.addEventListener("release",()=>this.patch({wake:"Keep this page open to keep the camera awake."}),{once:true});}this.patch({wake:"Screen stays awake"});}
    catch{this.patch({wake:"Keep this page open and your screen unlocked."});}
  }
  private async batteryHint(){
    const nav=navigator as Navigator & {getBattery?:()=>Promise<EventTarget & {level:number;charging:boolean}>};
    if(!nav.getBattery)return;
    const battery=await nav.getBattery();if(this.closed)return;this.battery=battery;
    this.batteryUpdate=()=>this.patch({battery:`Battery ${Math.round(battery.level*100)}%${battery.charging?" · charging":""}. ${battery.level<.2?"Low battery: switch to scan mode. ":""}If the phone feels hot, use scan mode and let it cool.`});
    battery.addEventListener("levelchange",this.batteryUpdate);battery.addEventListener("chargingchange",this.batteryUpdate);this.batteryUpdate();
  }
  private async startCamera(deviceId=this.state.deviceId){
    if(this.camera?.mediaStreamTrack.readyState === "live")return;
    if(!this.credentials||this.closed)throw new Error("Connect the camera first");
    const gen=++this.generation;
    const stream=await navigator.mediaDevices.getUserMedia({video:{...(deviceId?{deviceId:{exact:deviceId}}:{facingMode:{ideal:"environment"}}),width:{ideal:1920,max:1920},height:{ideal:1080,max:1080},frameRate:{ideal:15,max:24}},audio:false});
    if(this.closed || !this.credentials || gen!==this.generation){stream.getTracks().forEach(t=>t.stop());return;}
    const track=stream.getVideoTracks()[0];track.contentHint="detail";this.camera=new LocalVideoTrack(track,undefined,false);
    this.video=document.createElement("video");this.video.muted=true;this.video.playsInline=true;this.video.srcObject=stream;await this.video.play();
    if(this.closed || gen!==this.generation){stream.getTracks().forEach(t=>t.stop());return;}
    const settings=track.getSettings();const caps=track.getCapabilities?.()??{};
    this.patch({stream,caps,deviceId:settings.deviceId??deviceId,resolution:`${settings.width??this.video.videoWidth} × ${settings.height??this.video.videoHeight}`,devices:(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==="videoinput")});
    if(this.ringTimer)clearInterval(this.ringTimer);
    void this.bufferFrame().catch(()=>undefined);
    this.ringTimer=setInterval(()=>void this.bufferFrame().catch(()=>undefined),200);
    if(this.meter)clearInterval(this.meter);
    this.meter=setInterval(()=>{if(this.video?.videoWidth)this.patch(frameQuality(this.video,this.video.videoWidth,this.video.videoHeight));},1200);
  }
  private async publish(){if(this.camera && !this.room.localParticipant.getTrackPublication(Track.Source.Camera))await this.room.localParticipant.publishTrack(this.camera,{name:"field-cam",source:Track.Source.Camera,simulcast:false,videoCodec:"vp8",videoEncoding:{maxBitrate:3_000_000,maxFramerate:15},degradationPreference:"maintain-resolution"});}
  private async stopCamera(){
    ++this.generation;if(this.meter)clearInterval(this.meter);this.meter=undefined;
    if(this.ringTimer)clearInterval(this.ringTimer);this.ringTimer=undefined;
    this.ring.splice(0).forEach(f=>f.bitmap.close());
    const camera=this.camera;this.camera=undefined;
    if(camera){if(this.room.localParticipant.getTrackPublication(Track.Source.Camera))await this.room.localParticipant.unpublishTrack(camera).catch(()=>undefined);camera.stop();}
    if(this.video){this.video.pause();this.video.srcObject=null;this.video=undefined;}
    this.patch({stream:null});
  }
  async setCamera(deviceId:string){try{await this.stopCamera();await this.startCamera(deviceId);if(this.state.mode==="video")await this.publish();}catch(e){this.patch({error:e instanceof Error?e.message:"Camera unavailable"});}}
  async setMode(mode:"video"|"scan"){
    sessionStorage.setItem(`${this.storageKey}:mode`,mode);
    this.patch({mode,error:""});
    try{if(mode === "scan")await this.stopCamera();else{await this.startCamera();await this.publish();}await this.status();}
    catch(e){this.patch({error:e instanceof Error?e.message:"Mode unavailable"});}
  }
  async constraint(values:Record<string,unknown>){
    try{await this.startCamera();await this.camera?.mediaStreamTrack.applyConstraints({advanced:[values as MediaTrackConstraintSet]});this.patch({note:"Camera setting applied"});}
    catch{this.patch({note:"This browser could not apply that camera setting."});}
  }
  async lockCamera(locked:boolean){
    const caps=this.state.caps;const settings=this.camera?.mediaStreamTrack.getSettings() as (MediaTrackSettings & {focusDistance?:number;exposureTime?:number})|undefined;
    const values:Record<string,unknown>={};
    if(caps.focusMode?.includes(locked?"manual":"continuous")){values.focusMode=locked?"manual":"continuous";if(locked&&settings?.focusDistance!==undefined)values.focusDistance=settings.focusDistance;}
    if(caps.exposureMode?.includes(locked?"manual":"continuous")){values.exposureMode=locked?"manual":"continuous";if(locked&&settings?.exposureTime!==undefined)values.exposureTime=settings.exposureTime;}
    await this.constraint(values);
  }
  private send(message:PhoneMessage){
    if(!this.credentials)return Promise.reject(new Error("Pair first"));
    return this.room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(message)),{reliable:true,topic:PHONE_TOPIC,destinationIdentities:[`remote-user-${this.credentials.userId}`]});
  }
  private async status(){
    if(this.room.state!==ConnectionState.Connected)return;
    await this.room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({type:"status",mode:this.state.mode})),{reliable:true,topic:PHONE_TOPIC}).catch(()=>undefined);
  }
  async scan(zone:PhoneZone){
    if(this.state.busy)return;
    if(this.room.state!==ConnectionState.Connected || !this.state.ownerReady){this.patch({note:"Open this table on your desktop to read a scan."});return;}
    const id=crypto.randomUUID();this.activeScan=id;
    if(this.scanDeadline)clearTimeout(this.scanDeadline);
    this.scanDeadline=setTimeout(()=>{this.cancelScan();this.patch({note:"No answer from the desktop. Reconnect it and try again."});},65_000);
    this.patch({busy:true,error:"",note:"Reading the sharpest available frame…"});
    try{await this.send({type:"scan",id,zone});}
    catch{this.patch({busy:false,error:"Desktop disconnected. Try again."});}
  }
  cancelScan(){const id=this.activeScan;this.activeScan=undefined;if(this.scanDeadline)clearTimeout(this.scanDeadline);if(id)void this.send({type:"cancel",id}).catch(()=>undefined);this.patch({busy:false});}
  private async capture(id:string,point:{x:number;y:number}){
    if(this.working){await this.send({type:"cancel",id}).catch(()=>undefined);return;}
    const gen=this.sessionGeneration;
    this.working=true;const started=performance.now();
    try{
      await this.startCamera();this.valid(gen);await this.bufferFrame();this.valid(gen);this.pruneRing();
      const frames=this.ring;
      if(!frames.length)throw new Error("No camera frame");
      const scores=frames.map(f=>frameQuality(f.bitmap,f.bitmap.width,f.bitmap.height,point).sharpness);
      const selected=scores.lastIndexOf(Math.max(...scores)),best=frames[selected];
      const frameAgeMs=performance.now()-best.at;
      const sourceWidth=best.bitmap.width,sourceHeight=best.bitmap.height;
      // Preserve sensor pixels, with enough context for the detector around a field card.
      // Scan framing is taller; its camera can have been released between requests.
      const short=Math.min(sourceWidth,sourceHeight);
      const width=Math.max(16,Math.round(short*.85)),height=Math.max(16,Math.min(sourceHeight,Math.round(short*(this.state.mode==="scan"?1.25:.85))));
      const crop:PhoneCrop={left:Math.max(0,Math.min(sourceWidth-width,Math.round(point.x*sourceWidth-width/2))),top:Math.max(0,Math.min(sourceHeight-height,Math.round(point.y*sourceHeight-height/2))),sourceWidth,sourceHeight};
      const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;
      canvas.getContext("2d")!.drawImage(best.bitmap,crop.left,crop.top,width,height,0,0,width,height);
      const captureMs=performance.now()-started,encodeStarted=performance.now();
      // toBlob may wait for an idle task on a busy/background phone. This bounded crop
      // encodes immediately, avoiding that scheduler delay on the request's critical path.
      const encode=(quality:number)=>canvas.toDataURL("image/jpeg",quality).split(",")[1];
      let jpeg=encode(.9);if(jpeg.length>MAX_JPEG_CHARS)jpeg=encode(.72);
      if(jpeg.length>MAX_JPEG_CHARS)throw new Error("Still too large; choose a lower camera resolution");
      const timing={captureMs,encodeMs:performance.now()-encodeStarted},count=Math.ceil(jpeg.length/CHUNK_CHARS);
      for(let index=0;index<count;index++){this.valid(gen);await this.send({type:"frame",id,index,count,data:jpeg.slice(index*CHUNK_CHARS,(index+1)*CHUNK_CHARS),width,height,crop,timing});}
      this.patch({note:`Sharpest of ${scores.length} buffered frames sent · ${width} × ${height}`,sharpness:scores[selected]});
      // Diagnostics contain only timings, quality, coordinates and size; never pixels or card identity.
      window.dispatchEvent(new CustomEvent("remote-phone-capture",{detail:{id,ms:performance.now()-started,...timing,sendMs:performance.now()-encodeStarted-timing.encodeMs,scores,selected,width,height,crop,point,frameAgeMs,bytes:Math.round(jpeg.length*.75)}}));
    }catch(e){await this.send({type:"cancel",id}).catch(()=>undefined);throw e;}
    finally{if(this.state.mode === "scan")await this.stopCamera();this.working=false;}
  }
  async disconnect(){sessionStorage.removeItem(this.storageKey);await this.stop();}
  async stop(){
    ++this.sessionGeneration;this.cancelScan();for(const abort of this.exchanges)abort.abort();this.exchanges.clear();
    if(this.renewal)clearInterval(this.renewal);if(this.retry)clearTimeout(this.retry);this.credentials=undefined;
    await this.stopCamera();await this.room.disconnect();await this.wake?.release().catch(()=>undefined);this.patch({connection:"Disconnected",busy:false,ownerReady:false});
  }
  dispose(){this.closed=true;void this.stop();window.removeEventListener("online",this.online);document.removeEventListener("visibilitychange",this.visible);if(this.batteryUpdate){this.battery?.removeEventListener("levelchange",this.batteryUpdate);this.battery?.removeEventListener("chargingchange",this.batteryUpdate);}this.listeners.clear();}
}
