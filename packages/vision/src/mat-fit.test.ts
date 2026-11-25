import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {warpQuad,type Quad} from './geometry';
import {fileURLToPath} from 'node:url';
import {fitMat, matFitCalibration} from './mat-fit';
import {createFieldCalibration, fieldMatPoint, fieldZoneCells, mapFieldZone,fieldQuadEnvelope,fieldQuadPoint,moveFieldQuad,resizeFieldQuad,turnFieldQuad,pinchFieldQuad} from './field-zones';

const FIXTURE_BUDGET_MS=10_000;

async function frame(name='circuit-break-base.png') {
  const {data,info}=await sharp(fileURLToPath(new URL(`../fixtures/mat-fit/${name}`,import.meta.url))).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  return {data:new Uint8ClampedArray(data),width:info.width,height:info.height} as ImageData;
}
// Independently hand-clicked on printed boxes, original cropped camera pixels (proto/gt.py).
const centers=[
  [247,472],[225,672],[433,482],[414,681],[618,491],[603,689],[802,500],
  [792,701],[989,508],[983,708],[1174,513],[1174,712],[1365,524],[1367,725],
];
const names=['DECK','GY','S5','M5','S4','M4','S3','M3','S2','M2','S1','M1','EXTRA','FIELD'];
test('camera widths and harmless edge crops preserve every named row and column',async t=>{
  // Visible printed/card centres, with the arm-covered right column continued
  // along the same independently marked rows (not derived from a fitted grid).
  const occupiedPoints=[
    [125,240],[120,355],[245,241],[238,363],[347,246],[344,366],[452,253],
    [451,369],[558,260],[557,372],[663,264],[665,374],[775,267],[773,374],
  ];
  const crops=[{name:'none',left:0,top:0,right:0,bottom:0},
    {name:'left20',left:20,top:0,right:0,bottom:0},
    {name:'top40',left:0,top:40,right:0,bottom:0},
    {name:'bottom60',left:0,top:0,right:0,bottom:60},
    {name:'right80',left:0,top:0,right:80,bottom:0}];
  for(const fixture of ['base','prod']){
    const source=await frame(`circuit-break-${fixture}.png`),points=fixture==='base'?centers:occupiedPoints;
    for(const width of [928,998,1280,1920]){
      const scaled=await sharp(source.data,{raw:{width:source.width,height:source.height,channels:4}}).resize({width}).raw().toBuffer({resolveWithObject:true});
      for(const crop of crops)await t.test(`${fixture} ${width} ${crop.name}`,async()=>{
        const w=width-crop.left-crop.right,h=scaled.info.height-crop.top-crop.bottom;
        const data=await sharp(scaled.data,{raw:{width,height:scaled.info.height,channels:4}})
          .extract({left:crop.left,top:crop.top,width:w,height:h}).raw().toBuffer();
        const start=performance.now(),cpu=process.cpuUsage(),result=fitMat({data,width:w,height:h},{playerSide:'top',budgetMs:FIXTURE_BUDGET_MS});
        const elapsed=performance.now()-start,used=process.cpuUsage(cpu),grid=matFitCalibration(result);
        assert.ok(grid,JSON.stringify(result));
        for(const [i,[x,y]] of points.entries()){
          const nx=(x*width/source.width-crop.left)/w,ny=(y*scaled.info.height/source.height-crop.top)/h;
          assert.equal(mapFieldZone({quad:[{x:nx-.005,y:ny-.005},{x:nx+.005,y:ny-.005},{x:nx+.005,y:ny+.005},{x:nx-.005,y:ny+.005}],confidence:1,partial:false,kind:'face-up'},grid).zone,names[i]);
        }
        if(width===1920)console.log(`matrix ${fixture} ${crop.name}: wall=${elapsed.toFixed(0)}ms CPU=${((used.user+used.system)/1000).toFixed(0)}ms`);
      });
    }
  }
});
function cpuOf(work:()=>unknown){const t=process.cpuUsage();work();const u=process.cpuUsage(t);return (u.user+u.system)/1000;}
// Fixed pixel workload, ~130ms CPU on a quiet dev machine; its best-of-3 time over that reference is the slowdown.
const CALIBRATION_REFERENCE_MS=130;
function cpuSlowdown(image:ImageData){
  const work=()=>{let sum=0;const {data,width,height}=image;
    for(let pass=0;pass<40;pass++)for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){const i=(y*width+x)*4;sum+=Math.abs(data[i+1]*2-data[i-4+1]-data[i+4+1])+Math.abs(data[i+1]*2-data[i-width*4+1]-data[i+width*4+1]);}
    return sum;};
  const m=Math.min(cpuOf(work),cpuOf(work),cpuOf(work));return Math.min(3,Math.max(1,m/CALIBRATION_REFERENCE_MS));
}
test('fits printed centres and assigns M to the printed monster row, including saved reload',async()=>{
  const image=await frame(),start=performance.now(),cpu=process.cpuUsage(),result=fitMat(image,{playerSide:'top'}),ms=performance.now()-start,used=process.cpuUsage(cpu);
  // Budget guard (camera board actions must stay fast): best of 3 fits, against a budget scaled by how
  // slow this machine is right now, so a loaded shared CI runner does not fail it but a real regression does.
  const scale=cpuSlowdown(image),cpuMs=Math.min((used.user+used.system)/1000,cpuOf(()=>fitMat(image,{playerSide:'top'})),cpuOf(()=>fitMat(image,{playerSide:'top'})));
  const grid=matFitCalibration(result);assert.ok(grid,JSON.stringify(result));
  const limits=fieldQuadEnvelope(grid.corners),unchanged=moveFieldQuad(grid.corners,0,0,limits);assert.ok(unchanged);
  unchanged.forEach((p,i)=>assert.ok(Math.hypot(p.x-grid.corners[i].x,p.y-grid.corners[i].y)<1e-8));
  // The new grid editor must not shift an inferred off-camera row when moving or turning by zero.
  for(const edited of [turnFieldQuad(grid.corners,0,16/9,1,limits)?.corners,pinchFieldQuad(grid.corners,1,0,16/9,limits),resizeFieldQuad(grid.corners,{x:.5,y:0},fieldQuadPoint(grid.corners,{x:.5,y:0}),false,limits)]){
    assert.ok(edited);edited.forEach((p,i)=>assert.ok(Math.hypot(p.x-grid.corners[i].x,p.y-grid.corners[i].y)<1e-8));
  }
  const inward=moveFieldQuad(grid.corners,0,-.01,limits)!,back=moveFieldQuad(inward,0,.01,limits)!;
  back.forEach((p,i)=>assert.ok(Math.hypot(p.x-grid.corners[i].x,p.y-grid.corners[i].y)<1e-8,'off-camera edits are reversible'));
  assert.ok(result.flipped);
  const opposite=fitMat(image,{playerSide:'bottom'});assert.ok(matFitCalibration(opposite));
  result.flipped.corners.forEach((p,i)=>assert.ok(Math.hypot(p.x-opposite.corners![i].x,p.y-opposite.corners![i].y)<.001,'Flip includes the alternate row window'));
  assert.equal(result.orientation.playerSide,'top');assert.equal(result.flags.colWindowAmbiguous,false);
  assert.equal(result.flags.sideByPrior,true);
  const saved=JSON.parse(JSON.stringify(grid)),reload=createFieldCalibration(saved.corners,saved.orientation);
  const cells=fieldZoneCells(),errors=centers.map(([x,y],i)=>{
    const cell=cells.find(c=>c.zone===names[i])!,p=fieldMatPoint({x:cell.x+cell.w/2,y:cell.y+cell.h/2},reload);
    const error=Math.hypot(p.x*image.width-x,p.y*image.height-y);
    const nx=x/image.width,ny=y/image.height;
    const card={quad:[{x:nx-.01,y:ny-.01},{x:nx+.01,y:ny-.01},{x:nx+.01,y:ny+.01},{x:nx-.01,y:ny+.01}],confidence:1,partial:false,kind:'face-up' as const};
    assert.equal(mapFieldZone(card,reload).zone,names[i],`${names[i]} printed row`);return error;
  });
  const mean=errors.reduce((a,b)=>a+b,0)/errors.length,max=Math.max(...errors);
  console.log(`base: mean=${mean.toFixed(2)}px max=${max.toFixed(2)}px pitch=190px CPU=${cpuMs.toFixed(0)}ms wall=${ms.toFixed(0)}ms`);
  assert.ok(mean<=19,`mean ${mean} exceeds .1 pitch`);assert.ok(max<=19,`max ${max} exceeds .1 pitch`);
  assert.ok(cpuMs<=1500*scale,`CPU ${cpuMs.toFixed(0)}ms exceeds budget ${(1500*scale).toFixed(0)}ms (machine slowdown x${scale.toFixed(2)})`);
});
test('refuses a missing Deck/GY column and unclear zones without a calibration',async()=>{
  const image=await frame();
  for(const width of [928,1280,1920]){
    const crop=await sharp(image.data,{raw:{width:image.width,height:image.height,channels:4}}).extract({left:335,top:0,width:image.width-335,height:image.height}).resize({width}).raw().toBuffer({resolveWithObject:true});
    const partial=fitMat({data:crop.data,width,height:crop.info.height});
    assert.equal(partial.flags.colWindowAmbiguous,true);assert.equal(matFitCalibration(partial),undefined,`${width}: missing Deck/GY column`);
  }
  for(const data of [new Uint8ClampedArray(640*360*4).fill(128)]) {
    const result=fitMat({width:640,height:360,data} as ImageData);assert.equal(matFitCalibration(result),undefined);assert.equal(result.confidence,'low');
  }
});
test('occupied production camera frame fits the correct printed rows',async()=>{
  const image=await frame('circuit-break-prod.png'),result=fitMat(image,{playerSide:'top'}),grid=matFitCalibration(result);
  assert.ok(grid,JSON.stringify(result));assert.equal(result.flags.sideByPrior,true);assert.ok(result.flipped);
  // Approximate visible zone centres, marked independently in this crop.
  // The owner's arm hides M1/Extra; the exposed monster row is the lower row.
  const points=[['S4',347,246],['S3',452,253],['S2',558,260],['M5',238,363],['M4',344,366],['M3',451,369],['M2',557,372],['FIELD',773,374]] as const;
  points.forEach(([name,x,y])=>{
    const nx=x/image.width,ny=y/image.height;
    assert.equal(mapFieldZone({quad:[{x:nx-.01,y:ny-.01},{x:nx+.01,y:ny-.01},{x:nx+.01,y:ny+.01},{x:nx-.01,y:ny+.01}],confidence:1,partial:false,kind:'face-up'},grid).zone,name);
  });
  console.log(`occupied: ${points.length}/${points.length} named zones correct; inliers=${result.metrics.inliers} mean=${result.metrics.meanErrorPitch.toFixed(3)} max=${result.metrics.maxErrorPitch.toFixed(3)} pitch`);
  assert.ok(result.metrics.inliers>=6);assert.ok(result.metrics.rows>=2);assert.equal(result.metrics.columnSpan,7);
  assert.ok(result.metrics.meanErrorPitch<.1);assert.ok(result.metrics.maxErrorPitch<.2);
});

test('first fit previews the pale Raging Tempest mat with the correct side and columns',async()=>{
  const image=await frame('raging-tempest.png');
  const start=performance.now(),result=fitMat(image,{playerSide:'top',budgetMs:FIXTURE_BUDGET_MS}),elapsed=performance.now()-start;
  const grid=matFitCalibration(result);
  assert.ok(grid,JSON.stringify(result));
  assert.deepEqual(result.orientation,{playerSide:'top',mirrored:false});
  assert.equal(result.flags.colWindowAmbiguous,false);
  assert.equal(result.flags.sideByPrior,false);
  assert.equal(result.metrics.columnSpan,7);
  assert.equal(result.confidence,'low');

  // Camera pixels hand-marked from the exposed printed edges, including the
  // visible portions around the piles. The older outer boxes are staggered.
  const points=[
    ['S5',249,171],['S4',345,170],['S1',628,171],['M3',439,287],
    ['DECK',170,138],['EXTRA',713,135],['FIELD',733,326],
  ] as const;
  const cells=fieldZoneCells(),errors=points.map(([name,x,y])=>{
    const cell=cells.find(c=>c.zone===name)!;
    const p=fieldMatPoint({x:cell.x+cell.w/2,y:cell.y+cell.h/2},grid);
    const nx=x/image.width,ny=y/image.height;
    assert.equal(mapFieldZone({quad:[{x:nx-.005,y:ny-.005},{x:nx+.005,y:ny-.005},{x:nx+.005,y:ny+.005},{x:nx-.005,y:ny+.005}],confidence:1,partial:false,kind:'face-up'},grid).zone,name);
    return Math.hypot(p.x*image.width-x,p.y*image.height-y);
  });
  const mean=(values:number[])=>values.reduce((sum,error)=>sum+error,0)/values.length;
  const mainMean=mean(errors.slice(0,4)),allMean=mean(errors),max=Math.max(...errors);
  console.log(`pale: zones=${result.flags.zonesFound} inliers=${result.metrics.inliers} main mean=${mainMean.toFixed(2)}px all mean=${allMean.toFixed(2)}px max=${max.toFixed(2)}px wall=${elapsed.toFixed(0)}ms`);
  assert.ok(mainMean<10,`main-row mean error ${mainMean}px`);
  assert.ok(allMean<20&&max<48,`overall error ${allMean}px mean, ${max}px max`);
});

// These retain real printed edges and move GT with the same known camera transform.
test('rotated real-frame variants retain correct rows and sub-pitch accuracy',async()=>{
  const image=await frame();
  for(const degrees of [-6,8]){
    const t=degrees*Math.PI/180,c=Math.cos(t),s=Math.sin(t),cx=image.width/2,cy=image.height/2;
    const rotate=(x:number,y:number,sign=1)=>({x:cx+c*(x-cx)-sign*s*(y-cy),y:cy+sign*s*(x-cx)+c*(y-cy)});
    const source=[{x:0,y:0},{x:image.width,y:0},{x:image.width,y:image.height},{x:0,y:image.height}].map(p=>rotate(p.x,p.y,-1));
    const moved=warpQuad(image,source as Quad,image.width,image.height)!;
    const result=fitMat(moved,{playerSide:'top'}),grid=matFitCalibration(result);assert.ok(grid,JSON.stringify(result));
    const cells=fieldZoneCells(),errors=centers.map(([x,y],i)=>{
      const target=rotate(x,y),cell=cells.find(c=>c.zone===names[i])!,p=fieldMatPoint({x:cell.x+cell.w/2,y:cell.y+cell.h/2},grid);
      return Math.hypot(p.x*image.width-target.x,p.y*image.height-target.y);
    });
    const mean=errors.reduce((a,b)=>a+b)/errors.length,max=Math.max(...errors);
    console.log(`rot${degrees}: mean=${mean.toFixed(2)}px max=${max.toFixed(2)}px`);
    assert.ok(mean<19);assert.ok(max<19);
  }
});
test('blurred zones, art-only, noisy cloth and frames without a mat do not yield corners',async()=>{
  const image=await frame(),blurred=await sharp(image.data,{raw:{width:image.width,height:image.height,channels:4}}).blur(9).raw().toBuffer();
  const noise=new Uint8ClampedArray(640*360*4);let seed=17;
  for(let i=0;i<noise.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)|0;noise[i]=noise[i+1]=noise[i+2]=120+(seed>>>27);noise[i+3]=255;}
  const art=await sharp(image.data,{raw:{width:image.width,height:image.height,channels:4}}).extract({left:350,top:70,width:800,height:260}).raw().toBuffer();
  const width=960,height=540;
  const tabletop=Buffer.from(`<svg width="${width}" height="${height}">
    <defs><linearGradient id="wood"><stop stop-color="#b49472"/><stop offset="1" stop-color="#86664f"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#wood)"/>
    <path d="M0 150 L960 158 M0 388 L960 396" fill="none" stroke="#80614a" opacity=".4"/>
  </svg>`);
  const table=await sharp(tabletop).ensureAlpha().raw().toBuffer();
  // Three dark rectangles can interpolate a seven-column lattice exactly.
  const outlines=[[120,210],[240,210],[840,355]].map(([x,y])=>
    `<rect x="${x-43}" y="${y-63}" width="86" height="126" fill="none" stroke="#222" stroke-width="3.5"/>`).join('');
  const outlinedTable=await sharp(Buffer.from(`<svg width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#aaa"/>${outlines}</svg>`)).ensureAlpha().raw().toBuffer();
  const placements=[
    ['91152256',74,160,-4],['55144522',203,160,0],['66788016',360,310,12],
    ['14087893',480,140,-8],['44095762',630,280,3],['41420027',788,305,0],
  ] as const;
  const cards=await Promise.all(placements.map(async ([id,left,top,angle])=>({
    input:await sharp(fileURLToPath(new URL(`../../../docs/design/duel-3d-mode/concept/assets/cards/${id}.jpg`,import.meta.url)))
      .resize({width:86,height:126,fit:'fill'}).ensureAlpha().rotate(angle,{background:'#0000'}).png().toBuffer(),
    left,top,
  })));
  const cardsOnly=await sharp(tabletop).composite(cards).ensureAlpha().raw().toBuffer();
  const cases=[
    ['blurred',{...image,data:blurred}],['noise',{width:640,height:360,data:noise}],['art',{width:800,height:260,data:art}],
    ['plain table',{width,height,data:table}],['cards only',{width,height,data:cardsOnly}],
    ['three dark outlines',{width,height,data:outlinedTable}],
  ] as const;
  for(const [name,input] of cases){
    const result=fitMat(input,{budgetMs:FIXTURE_BUDGET_MS});assert.equal(result.corners,null,`${name}: ${JSON.stringify(result)}`);
  }
});

test('quarter-turn camera priors retain named zones and flag side uncertainty',async()=>{
 const image=await frame(),base=fitMat(image,{playerSide:'bottom'});assert.ok(base.corners);
 for(const side of ['left','right'] as const){
  const rotated=await sharp(image.data,{raw:{width:image.width,height:image.height,channels:4}}).rotate(side==='left'?90:270).raw().toBuffer({resolveWithObject:true});
  const result=fitMat({width:rotated.info.width,height:rotated.info.height,data:rotated.data},{playerSide:side,budgetMs:0});
  const grid=matFitCalibration(result);assert.ok(grid,JSON.stringify(result));assert.equal(result.orientation.playerSide,side);assert.equal(result.flags.sideByPrior,true);assert.ok(result.flipped);
  const baseGrid=matFitCalibration(base)!;
  for(const cell of fieldZoneCells()){
   const at={x:cell.x+cell.w/2,y:cell.y+cell.h/2},p=fieldMatPoint(at,baseGrid),q=fieldMatPoint(at,grid),expected=side==='left'?{x:1-p.y,y:p.x}:{x:p.y,y:1-p.x};
   assert.ok(Math.hypot(q.x-expected.x,q.y-expected.y)<.01,`${side} ${cell.zone}`);
  }
 }
});

test('returns the first scale result when the fit budget has already expired',async t=>{
  const easy=await frame(),pale=await frame('raging-tempest.png');
  let clockRead=0;
  t.mock.method(performance,'now',()=>clockRead++===0?0:10_000);

  const fit=fitMat(easy,{playerSide:'top'});
  assert.ok(fit.corners,JSON.stringify(fit));
  assert.equal(fit.confidence,'high');

  clockRead=0;
  const width=128,height=128,data=new Uint8ClampedArray(width*height*4).fill(128);
  const blank=fitMat({width,height,data},{playerSide:'top'});
  assert.equal(blank.corners,null);
  assert.equal(blank.reason,'no-zones');

  clockRead=0;
  const needsPreviewPass=fitMat(pale,{playerSide:'top'});
  assert.equal(needsPreviewPass.corners,null,JSON.stringify(needsPreviewPass));
});
