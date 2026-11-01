import { z } from "zod";
import type { VideoMember } from "./video-protocol";
export const PHONE_TOPIC = "remote.phone.v1";
export const MAX_JPEG_CHARS = 1_500_000;
export const CHUNK_CHARS = 10_000;
export const PHONE_ZONES = ["M1","M2","M3","M4","M5","S1","S2","S3","S4","S5","FZ","GY","banished","hand reveal"] as const;
export const phoneZoneSchema = z.enum(PHONE_ZONES);
export type PhoneZone = z.infer<typeof phoneZoneSchema>;
const id = z.string().uuid();
const duration = z.number().finite().min(0).max(60_000);
const cropSchema = z.object({left:z.number().int().min(0).max(1920),top:z.number().int().min(0).max(1920),sourceWidth:z.number().int().min(16).max(1920),sourceHeight:z.number().int().min(16).max(1920)});
const captureTimingSchema = z.object({captureMs:duration,encodeMs:duration});
export type PhoneCrop = z.infer<typeof cropSchema>;
export type PhoneCaptureTiming = z.infer<typeof captureTimingSchema>;
export const phoneMessageSchema = z.discriminatedUnion("type",[
  z.object({type:z.literal("ready")}),
  z.object({type:z.literal("capture"),id,x:z.number().min(0).max(1),y:z.number().min(0).max(1)}),
  z.object({type:z.literal("scan"),id,zone:phoneZoneSchema}),
  z.object({type:z.literal("frame"),id,index:z.number().int().min(0).max(149),count:z.number().int().min(1).max(150),
    data:z.string().min(1).max(CHUNK_CHARS).regex(/^[A-Za-z0-9+/=]+$/),width:z.number().int().min(16).max(1920),height:z.number().int().min(16).max(1920),crop:cropSchema.optional(),timing:captureTimingSchema.optional()}),
  z.object({type:z.literal("status"),mode:z.enum(["video","scan"])}),
  z.object({type:z.literal("answer"),id,done:z.boolean().optional(),note:z.string().max(300),guesses:z.array(z.object({cardId:z.number().int().positive(),name:z.string().max(200),score:z.number().nullable()})).max(5)}),
  z.object({type:z.literal("cancel"),id}),
]);
export type PhoneMessage = z.infer<typeof phoneMessageSchema>;
export type PhoneReading = { guesses:{cardId:number;name:string;score:number|null}[];reader:"vision"|"priors"|"none";frames:number;note:string;tier?:"sure"|"not sure"|"low match";faceDown?:boolean;covered?:boolean;visionTimingsMs?:Record<string,number>;backend?:string };
export type PhoneScan = {id:string;zone:PhoneZone;reading:PhoneReading;ms:number;pairId:string};
export type PhoneMember = { id:string;seat:number;userId:number;paired:boolean;mode:string };
/** Phone identity, role and seat are immutable server-minted metadata. DB roster excludes revoked pairs. */
export function phoneSeat(identity:string, metadata:string|undefined, guildId:string, slug:string, members:VideoMember[], phones:PhoneMember[]) {
  try {
    const p=JSON.parse(metadata ?? "");
    if (p.role === "field-phone" && p.tableId === slug && p.guildId === guildId && identity === `remote-phone-${p.pairId}` &&
      members.some(m=>m.seat === p.seat && m.userId === p.userId && m.userId !== null) &&
      phones.some(m=>m.id === p.pairId && m.paired && m.seat === p.seat && m.userId === p.userId)) return p.seat as number;
  } catch { /* No unverified phone may claim a seat. */ }
}
export function scanLocation(zone:PhoneZone):{zone:string;slot?:number} {
  if (zone[0] === "M") return {zone:"monster",slot:Number(zone[1])};
  if (zone[0] === "S") return {zone:"spell-trap",slot:Number(zone[1])};
  return {zone:({FZ:"field",GY:"graveyard",banished:"banished","hand reveal":"hand-reveal"} as Record<string,string>)[zone]};
}

/** Inspect JPEG SOF before browser decode, to reject decompression bombs and mismatched dimensions. */
export function boundedJpegSize(bytes:Uint8Array):{width:number;height:number}|null {
  if(bytes[0]!==0xff || bytes[1]!==0xd8)return null;
  let offset=2;
  while(offset+4<bytes.length){
    if(bytes[offset++]!==0xff)return null;
    while(bytes[offset]===0xff)offset++;
    const marker=bytes[offset++];
    if(marker===0xd9 || marker===0xda)return null;
    if(marker===0x01 || (marker>=0xd0&&marker<=0xd7))continue;
    const length=bytes[offset]*256+bytes[offset+1];
    if(length<2 || offset+length>bytes.length)return null;
    if([0xc0,0xc1,0xc2].includes(marker)){
      if(length<8)return null;
      const height=bytes[offset+3]*256+bytes[offset+4],width=bytes[offset+5]*256+bytes[offset+6];
      return width>=16&&height>=16&&width<=1920&&height<=1920&&width*height<=2_073_600?{width,height}:null;
    }
    offset+=length;
  }
  return null;
}
