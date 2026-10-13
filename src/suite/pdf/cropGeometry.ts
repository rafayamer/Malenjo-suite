// PDF points are 1/72 inch. Keep one conversion source for keyboard and drag crop.
export type CropUnit = 'mm' | 'cm' | 'in';
export interface CropRectangle { x:number; y:number; width:number; height:number }
export interface CropMargins { top:number; right:number; bottom:number; left:number }
export function cropPointsPerUnit(unit:CropUnit):number {
  if(unit==='in')return 72;
  return unit==='cm'?72/2.54:72/25.4;
}
export function cropPointsToUnit(points:number,unit:CropUnit):number {
  return points/cropPointsPerUnit(unit);
}
export function cropUnitToPoints(value:number,unit:CropUnit):number {
  return value*cropPointsPerUnit(unit);
}
const clamp=(value:number)=>Math.max(0,Math.min(1,value));
export function cropRectangleToMargins(rect:CropRectangle,width:number,height:number):CropMargins {
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0 ||
     ![rect.x,rect.y,rect.width,rect.height].every(Number.isFinite))throw new Error('Invalid PDF crop rectangle.');
  const x1=clamp(Math.min(rect.x,rect.x+rect.width));
  const x2=clamp(Math.max(rect.x,rect.x+rect.width));
  const y1=clamp(Math.min(rect.y,rect.y+rect.height));
  const y2=clamp(Math.max(rect.y,rect.y+rect.height));
  if((x2-x1)*width<=1 || (y2-y1)*height<=1)throw new Error('Draw a crop area larger than one point.');
  return {left:x1*width,right:(1-x2)*width,top:y1*height,bottom:(1-y2)*height};
}
export function cropMarginsToRectangle(margins:CropMargins,width:number,height:number):CropRectangle {
  if(width<=0||height<=0)return {x:0,y:0,width:1,height:1};
  return {x:clamp(margins.left/width),y:clamp(margins.top/height),
    width:clamp(1-(margins.left+margins.right)/width),
    height:clamp(1-(margins.top+margins.bottom)/height)};
}
