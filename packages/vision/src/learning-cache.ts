import { emptyLearning, type LearningSnapshot } from './learning';

/** Refresh outside inference. Failures retain the last version for at most two minutes. */
export class LearningCache {
  private value=emptyLearning();
  private updatedAt=-Infinity;
  private pending?:Promise<void>;
  constructor(private load:()=>Promise<LearningSnapshot>,private now=()=>Date.now()) {}
  current():LearningSnapshot {return this.now()-this.updatedAt<=120_000?this.value:emptyLearning();}
  refresh():Promise<void> {
    if(this.pending)return this.pending;
    this.pending=this.load().then(value=>{this.value=value;this.updatedAt=this.now();}).catch(()=>{/* Keep last good snapshot until expiry. */}).finally(()=>{this.pending=undefined;});
    return this.pending;
  }
}
