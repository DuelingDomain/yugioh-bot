import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {fitMat,matFitCalibration} from './mat-fit';
import {fieldMatPoint,fieldZoneCells} from './field-zones';

async function occupied(seventhFrame=true,printedColumns=seventhFrame?7:6,stroke='#999'){
  const centers=Array.from({length:14},(_,i)=>({x:120+(i%7)*120,y:210+Math.floor(i/7)*145}));
  const svg=`<svg width="960" height="540">${centers.map(({x,y},i)=>`${i%7<printedColumns?`<rect x="${x-45}" y="${y-65}" width="90" height="130" fill="none" stroke="${stroke}" stroke-width="3"/>`:''}${i%3!==0||!seventhFrame?`<rect x="${x-39}" y="${y-57}" width="78" height="114" fill="#111" stroke="white" stroke-width="3"/>`:''}`).join('')}</svg>`;
  const image=await sharp({create:{width:960,height:540,channels:4,background:'#333'}}).composite([{input:Buffer.from(svg)}]).raw().toBuffer();
  return {image,centers};
}
test('occupied printed frames survive stronger nested card outlines',async()=>{
  const {image,centers}=await occupied();
  const result=fitMat({width:960,height:540,data:image},{playerSide:'top'}),grid=matFitCalibration(result);
  assert.ok(grid,JSON.stringify(result));assert.equal(result.metrics.columnSpan,7);
  for(const [i,name] of ['DECK','S5','S4','S3','S2','S1','EXTRA','GY','M5','M4','M3','M2','M1','FIELD'].entries()){
    const cell=fieldZoneCells().find(c=>c.zone===name)!,p=fieldMatPoint({x:cell.x+cell.w/2,y:cell.y+cell.h/2},grid);
    assert.ok(Math.hypot(p.x*960-centers[i].x,p.y*540-centers[i].y)<12,name);
  }
});

test('card centres alone cannot prove the seventh column',async()=>{
 const {image}=await occupied(false),result=fitMat({data:image,width:960,height:540},{playerSide:'top'});
 assert.equal(matFitCalibration(result),undefined,JSON.stringify(result));assert.equal(result.flags.colWindowAmbiguous,true);
});
for(const printedColumns of [2,3,4,5,6])test(`card-only columns cannot prove width with ${printedColumns} printed columns`,async()=>{
 const {image}=await occupied(false,printedColumns),result=fitMat({data:image,width:960,height:540},{playerSide:'top'});
 assert.equal(matFitCalibration(result),undefined,JSON.stringify(result));assert.equal(result.flags.colWindowAmbiguous,true);
});
test('a fully occupied seven-column printed mat still fits',async()=>{
 const {image}=await occupied(false,7),result=fitMat({data:image,width:960,height:540},{playerSide:'top'});
 assert.ok(matFitCalibration(result),JSON.stringify(result));assert.equal(result.metrics.columnSpan,7);
});
test('faint printed frames cannot let a brighter card-size mode prove width',async()=>{
 const {image}=await occupied(false,5,'#444'),result=fitMat({data:image,width:960,height:540},{playerSide:'top'});
 assert.equal(matFitCalibration(result),undefined,JSON.stringify(result));
});
