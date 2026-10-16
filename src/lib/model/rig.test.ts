import { describe, expect, it } from 'vitest';
import { layers, mouthAmount, springStep, earActionOffset } from './rig';
import { packRcneko, readRcneko } from './rcneko';
describe('Character rig',()=>{
  it('clamps mouth opening',()=>{expect(mouthAmount(2)).toBe(1);expect(mouthAmount(-1)).toBe(0)});
  it('draws fur below the fur-free face base',()=>{const ids=layers.map(l=>l.id);const face=ids.indexOf('face');for(const l of layers.filter(l=>l.kind==='fur'))expect(ids.indexOf(l.id)).toBeLessThan(face)});
  it('keeps both ears separately controllable',()=>{expect(layers.filter(l=>l.kind==='ear').map(l=>l.side)).toEqual([-1,1])});
  it('ear presets settle back to rest',()=>{expect(earActionOffset('shake',2,1)).toBe(0)});
  it('returns displaced hair toward rest',()=>{let p=0.3,v=0;for(let i=0;i<240;i++){const n=springStep(p,v,0,1/60);p=n.position;v=n.velocity}expect(Math.abs(p)).toBeLessThan(0.001)});
  it('exports a .rcneko zip container',()=>{const {bytes,filename}=packRcneko({'a.txt':new Uint8Array([1])});expect(filename).toBe('neko.rcneko');expect(Object.keys(readRcneko(bytes))).toContain('manifest.json')});
});
import { eyeOpenness, mouthIsOpen } from './rig';
describe('Expression rules',()=>{
  it('fully closes the eye on a strong blink',()=>{expect(eyeOpenness(0.9,0.5)).toBe(0)});
  it('keeps the eye open with no blink',()=>{expect(eyeOpenness(0,0.5)).toBe(1)});
  it('mouth is binary open/closed',()=>{expect(mouthIsOpen(0.5,0.5)).toBe(true);expect(mouthIsOpen(0.02,0.5)).toBe(false)});
  it('mouth stays open through small dips',()=>{expect(mouthIsOpen(0.15,0.5,true)).toBe(true);expect(mouthIsOpen(0.15,0.5,false)).toBe(false)});
});
