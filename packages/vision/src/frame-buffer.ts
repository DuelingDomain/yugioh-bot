/** Native-resolution, always-on own-feed ring. The caller retains its camera track. */
export function createOwnFeedBuffer(video:HTMLVideoElement,onFrame?:(count:number)=>void) {
  const frames:{bitmap:ImageBitmap;at:number}[]=[];
  let stopped=false,timer:ReturnType<typeof setTimeout>|undefined,queue=Promise.resolve(),lastPresented=-1;
  function serial<T>(task:()=>Promise<T>):Promise<T> {
    const next=queue.then(task);queue=next.then(()=>{},()=>{});return next;
  }
  function evict(now:number) {
    while(frames.length && (frames.length>6 || now-frames[0].at>1000))frames.shift()!.bitmap.close();
  }
  async function captureFrame() {
    if(stopped || (typeof document!=='undefined'&&document.hidden) || video.readyState<2 || video.videoWidth*video.videoHeight>16_000_000)return;
    const presented=video.getVideoPlaybackQuality?.()?.totalVideoFrames;
    if(presented&&presented<=lastPresented)return;
    const bitmap=await createImageBitmap(video); // No 1280px resize or canvas downscale.
    if(stopped){bitmap.close();return;}
    if(presented)lastPresented=presented;
    const at=performance.now();frames.push({bitmap,at});evict(at);onFrame?.(frames.length);
  }
  async function capture() {
    try {await serial(captureFrame);}catch {/* A temporarily unavailable camera frame does not destroy the ring. */}
    // Manual reads keep the modest background ring; active watcher samples can
    // request fresh native frames during a bounded confirmation burst.
    if(!stopped)timer=setTimeout(()=>{void capture();},200);
  }
  void capture();
  return {
    sample:(options?:{maxAgeMs?:number})=>serial(async()=>{
      if(stopped)throw new Error('Frame buffer is stopped');
      evict(performance.now());
      const maxAge=Math.max(30,Math.min(200,options?.maxAgeMs??90));
      if(performance.now()-(frames.at(-1)?.at??-Infinity)>=maxAge)await captureFrame();
      const latest=frames.at(-1);
      if(!latest)throw new Error('Waiting for a camera frame');
      return {frame:await createImageBitmap(latest.bitmap),at:latest.at};
    }),
    snapshot:()=>serial(async()=>{
      if(stopped)throw new Error('Frame buffer is stopped');
      evict(performance.now());
      if(!frames.length)throw new Error('Waiting for a camera frame');
      const clones:ImageBitmap[]=[];
      try {for(const {bitmap} of frames)clones.push(await createImageBitmap(bitmap));return clones;}
      catch(error){clones.forEach(f=>f.close());throw error;}
    }),
    stop:()=>{stopped=true;clearTimeout(timer);void serial(async()=>{frames.splice(0).forEach(f=>f.bitmap.close());});},
  };
}
