import {mkdtemp,rm,writeFile,utimes,access} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {expect,it,vi} from "vitest";
import * as fs from "node:fs/promises";
import {createImageCacheCleanup} from "../../src/services/image-cache-cleanup.js";
// Copy the native ESM namespace so spies can replace filesystem calls. All
// unmodified calls still use the real temporary directory.
vi.mock("node:fs/promises", async importOriginal => ({
  ...await importOriginal<typeof import("node:fs/promises")>(),
}));
it("evicts oldest first and tolerates another writer deleting a file",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"image-evict-"));
  try{
    const old=join(directory,"old.png"),fresh=join(directory,"new.png");
    await writeFile(old,"1234");await writeFile(fresh,"5678");
    await utimes(old,new Date(0),new Date(0));
    const unlink=fs.unlink;
    const spy=vi.spyOn(fs,"unlink").mockImplementation(async path=>{
      if(path===old){await unlink(path);throw Object.assign(new Error("gone"),{code:"ENOENT"});}
      await unlink(path);
    });
    const cache=createImageCacheCleanup({imageCacheDir:directory});
    expect(await cache.removeOldestImages(4)).toBe(0);
    expect(await cache.imageCacheBytes()).toBe(4);await access(fresh);spy.mockRestore();
  }finally{vi.restoreAllMocks();await rm(directory,{recursive:true,force:true});}
});
it("accepts a cache that has not been created",async()=>{
  expect(await createImageCacheCleanup({imageCacheDir:join(tmpdir(),`absent-${crypto.randomUUID()}`)}).removeOldestImages(1)).toBe(0);
});

it("evicts every image form by age while leaving directories intact", async () => {
  const directory=await mkdtemp(join(tmpdir(),"image-cap-"));
  try {
    const {mkdir}=await import("node:fs/promises");
    await mkdir(join(directory,"subdirectory"));
    for (const [index,name] of ["1.jpg","1-small.jpg","1-cropped.jpg","2.png"].entries()) {
      const path=join(directory,name);
      await writeFile(path,"1234");
      await utimes(path,new Date(index*1000),new Date(index*1000));
    }
    const cache=createImageCacheCleanup({imageCacheDir:directory});
    expect(await cache.imageCacheBytes()).toBe(16);
    expect(await cache.removeOldestImages(4)).toBe(3);
    expect(await cache.imageCacheBytes()).toBe(4);
    await access(join(directory,"2.png"));await access(join(directory,"subdirectory"));
  } finally {await rm(directory,{recursive:true,force:true});}
});

it("tolerates disappearance between directory listing and stat", async () => {
  const directory=await mkdtemp(join(tmpdir(),"image-stat-"));
  try {
    const path=join(directory,"old.png");
    await writeFile(path,"1234");
    vi.spyOn(fs,"stat").mockImplementationOnce(async()=>{
      await fs.unlink(path);
      throw Object.assign(new Error("gone"),{code:"ENOENT"});
    });
    expect(await createImageCacheCleanup({imageCacheDir:directory}).imageCacheBytes()).toBe(0);
  } finally {vi.restoreAllMocks();await rm(directory,{recursive:true,force:true});}
});

it.each([-1,1.5,NaN,Infinity])("rejects an invalid byte cap (%s) before evicting",async maxBytes=>{
  const directory=await mkdtemp(join(tmpdir(),"image-limit-"));
  try {
    await writeFile(join(directory,"keep.png"),"1234");
    const cache=createImageCacheCleanup({imageCacheDir:directory});
    await expect(cache.removeOldestImages(maxBytes)).rejects.toThrow("Invalid cache byte limit");
    expect(await cache.imageCacheBytes()).toBe(4);
  } finally {await rm(directory,{recursive:true,force:true});}
});
