import {describe,expect,it} from 'vitest';
import {cropMarginsToRectangle,cropPointsToUnit,cropRectangleToMargins,cropUnitToPoints} from './cropGeometry';

describe('visual PDF crop geometry',()=>{
  it('converts points, mm, cm and inches round trip',()=>{
    for(const unit of ['mm','cm','in'] as const){
      expect(cropUnitToPoints(cropPointsToUnit(72,unit),unit)).toBeCloseTo(72,8);
    }
    expect(cropPointsToUnit(72,'in')).toBe(1);
    expect(cropPointsToUnit(72,'cm')).toBeCloseTo(2.54);
    expect(cropPointsToUnit(72,'mm')).toBeCloseTo(25.4);
  });
  it('maps a dragged top-left rectangle to PDF MediaBox margins',()=>{
    const result=cropRectangleToMargins({x:.1,y:.2,width:.7,height:.6},600,800);
    expect(result.left).toBeCloseTo(60);
    expect(result.top).toBeCloseTo(160);
    expect(result.right).toBeCloseTo(120);
    expect(result.bottom).toBeCloseTo(160);
    const reverse=cropMarginsToRectangle(result,600,800);
    expect(reverse.x).toBeCloseTo(.1);
    expect(reverse.y).toBeCloseTo(.2);
    expect(reverse.width).toBeCloseTo(.7);
    expect(reverse.height).toBeCloseTo(.6);
  });
  it('normalizes reverse-direction drags and rejects an empty crop',()=>{
    expect(cropRectangleToMargins({x:.8,y:.8,width:-.6,height:-.5},400,600).left).toBeCloseTo(80);
    expect(()=>cropRectangleToMargins({x:.2,y:.2,width:0,height:.5},400,600)).toThrow('larger than one point');
  });
});
