import type { GameProfile } from './types';
import type { RGBAImage } from './pixels';

/** A layout hint, never evidence of a particular print or a confidence boost.
 * Reject conventional pale rules boxes and uniform coloured frame rails.
 * Overframe prints retaining those regions may not trigger it; both indexes are
 * still searched whenever full-art references exist.
 */
export function detectFullArtLayout(image: RGBAImage, profile: GameProfile): boolean {
  let pale=0, count=0, sum=0, squared=0, sides=0;
  const text=profile.textBoxColor ?? [226,214,186];
  for(let y=Math.floor(image.height*.74);y<image.height*.94;y+=2) for(let x=Math.floor(image.width*.12);x<image.width*.88;x+=2) {
    const p=(y*image.width+x)*4;
    if(Math.hypot(image.data[p]-text[0],image.data[p+1]-text[1],image.data[p+2]-text[2])<65) pale++;
    count++;
  }
  for(let y=Math.floor(image.height*.2);y<image.height*.7;y+=2) for(const x of [Math.floor(image.width*.045),Math.floor(image.width*.955)]) {
    const p=(y*image.width+x)*4, value=(image.data[p]+image.data[p+1]+image.data[p+2])/3;
    sum+=value; squared+=value*value; sides++;
  }
  return count>0 && sides>0 && pale/count<.35 && squared/sides-(sum/sides)**2>180;
}

/** Separate layout identity: a whole-card vector must never use art-box metadata. */
export function fullArtProfile(profile: GameProfile): GameProfile {
  return {...profile, artWindow:{x:0,y:0,w:1,h:1}, alternateArtWindows:undefined};
}
