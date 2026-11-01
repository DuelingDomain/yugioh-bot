/** Adapt the local index/cache to the ported Duel Lens trainers without duplicating images. */
import { mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import sharp from 'sharp';
import { yugioh } from '../../packages/vision/src/games/yugioh';
import type { IndexMeta } from '../../packages/vision/src/types';
const root = process.cwd(), data = resolve(process.env.VISION_DATA_DIR ?? 'data/vision');
const out = join(data, 'training');
const meta: IndexMeta = JSON.parse(await readFile(join(data, 'yugioh-index.meta.json'), 'utf8'));
const report = JSON.parse(await readFile(join(data, 'yugioh-index.build.json'), 'utf8'));
const catalog = JSON.parse(await readFile(join(data, 'cache/catalog.json'), 'utf8'));
for (const dir of ['artworks','cards-small','train/cache','train/templates','train/real']) await mkdir(join(out,dir),{recursive:true});
const link = async (target:string, dest:string) => { try { await symlink(target,dest); } catch(e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; } };
const entries = meta.entries.map(e=>({...e, cardId:e.cardId===yugioh.cardBack.cardId?-1:Number(e.cardId)}));
for (const entry of entries.filter(e=>e.cardId!==-1)) await link(join(data,'cache',report.cacheIdentity,'artwork',`${entry.imageId}.jpg`),join(out,'artworks',`${entry.imageId}.jpg`));
await sharp(join(root,'packages/web/public',yugioh.cardBack.imageUrl)).jpeg().toFile(join(out,'card-back.jpg'));
await writeFile(join(out,'index.meta.json'),JSON.stringify({...meta,entries}));
const selected = new Set(entries.map(e=>e.cardId));
const cards = catalog.cards.filter((c:{id:number})=>selected.has(c.id)).map((c:{id:number;name:string;date:string;frameType:string;images:{id:number}[]})=>
  ({id:c.id,name:c.name,frameType:c.frameType,imageIds:c.images.map(i=>i.id),misc_info:[{tcg_date:c.date}]}));
await writeFile(join(out,'cards.json'),JSON.stringify({cards}));
await writeFile(join(out,'cardinfo.json'),JSON.stringify({data:cards}));
await writeFile(join(out,'profile.json'),JSON.stringify({...yugioh,frameTypes:[...new Set(cards.map((c:{frameType:string})=>c.frameType))],pendulumWindow:{x:.062,y:.179,w:.876,h:.766},pendulumTextTop:.635},null,2));
// Optional real-photo evaluation starts empty; the synthetic-only recipe needs no videos.
await writeFile(join(out,'train/real/manifest.json'),'[]');
console.log(`Trainer inputs ready at ${out}. Next: python scripts/vision/training/train/prepare.py all`);
