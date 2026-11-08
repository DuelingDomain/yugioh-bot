import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFieldCalibration,fieldQuadEnvelope,shiftFieldCalibrationRows} from './field-zones';

test('refuses quads wholly outside the camera, including diagonal non-overlap',()=>{
 for(const corners of [
  [{x:1.1,y:.1},{x:1.4,y:.1},{x:1.4,y:.4},{x:1.1,y:.4}],
  [{x:.9,y:-.4},{x:1.4,y:.1},{x:1.3,y:.2},{x:.8,y:-.3}],
 ])assert.throws(()=>createFieldCalibration(corners),/calibration/);
});
test('row shifts retain the picture guard and preserve an existing fitted envelope',()=>{
 const grid=createFieldCalibration([{x:.1,y:.1},{x:.9,y:.1},{x:.9,y:.9},{x:.1,y:.9}],{playerSide:'bottom',mirrored:false});
 assert.throws(()=>shiftFieldCalibrationRows(grid,1),/picture/);
 assert.throws(()=>shiftFieldCalibrationRows(grid,-1),/picture/);
 const fit=createFieldCalibration([{x:.1,y:.35},{x:.9,y:.35},{x:.9,y:1.1},{x:.1,y:1.1}],grid.orientation);
 assert.doesNotThrow(()=>createFieldCalibration(fit.corners,fit.orientation));
 const limits=fieldQuadEnvelope(fit.corners),shifted=shiftFieldCalibrationRows(fit,-1,limits);
 const restored=shiftFieldCalibrationRows(shifted,1,limits);
 restored.corners.forEach((p,i)=>assert.ok(Math.hypot(p.x-fit.corners[i].x,p.y-fit.corners[i].y)<1e-8));
 shifted.corners.forEach(p=>assert.ok(p.y>=0&&p.y<=1.1));
 assert.throws(()=>shiftFieldCalibrationRows(fit,1),/picture/);
});
