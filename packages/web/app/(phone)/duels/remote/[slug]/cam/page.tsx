import { notFound } from "next/navigation";
import { remoteDuelsEnabled } from "@/lib/remote-duels";
import { PhoneCameraPage } from "@/components/remote/phone/camera-page";
export const dynamic="force-dynamic";
export const metadata={title:"Phone field camera · Dueling Domain",robots:{index:false,follow:false},referrer:"no-referrer"};
export default async function CameraPage({params}:{params:Promise<{slug:string}>}){
  if(!remoteDuelsEnabled())notFound();const {slug}=await params;
  return <PhoneCameraPage slug={slug}/>;
}
