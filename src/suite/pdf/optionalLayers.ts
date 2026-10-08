import type { PDFDocumentProxy } from 'pdfjs-dist';

export type PdfOptionalContentConfig =
  Awaited<ReturnType<PDFDocumentProxy['getOptionalContentConfig']>>;

export interface PdfOptionalLayer {
  id: string;
  name: string;
  visible: boolean;
}

export const MAX_PDF_OPTIONAL_LAYERS = 500;

/**
 * Inventory optional-content groups from the PDF.js 6.4 display order and group API.
 * A flat, bounded list is intentional: the PDF's nested display /Order and
 * usage intent requirements are not rewritten or simplified on export.
 */
export function listPdfOptionalLayers(config: PdfOptionalContentConfig): PdfOptionalLayer[] {
  // PDF.js 6.4 removed getGroups(): use the supported getOrder/getGroup pair.
  // /Order can nest groups under heading objects; walk the tree conservatively.
  const order:unknown=config.getOrder();
  if(order===null)return [];
  if(!Array.isArray(order))throw new Error('Invalid PDF optional-content order.');
  const ids:string[]=[];
  const seen=new Set<string>();
  const visited=new Set<object>();
  let nodes=0;
  function visit(item:unknown,depth:number):void{
    if(++nodes>2000||depth>24){
      throw new Error('PDF layer tree is too deeply nested or large to display safely.');
    }
    if(typeof item==='string'){
      if(!seen.has(item)){
        seen.add(item);
        if(ids.length>=MAX_PDF_OPTIONAL_LAYERS) {
          throw new Error('The PDF has over 500 layers. No incomplete list or visibility controls were returned.');
        }
        ids.push(item);
      }
      return;
    }
    if(typeof item==='object'&&item!==null){
      if(visited.has(item))throw new Error('PDF layer order contains a cyclic object.');
      visited.add(item);
      if(Array.isArray(item)){
        for(const child of item)visit(child,depth+1);
      }else if('order' in item){
        const children=(item as {order:unknown}).order;
        if(!Array.isArray(children))throw new Error('Invalid nested PDF layer order.');
        for(const child of children)visit(child,depth+1);
      }
      visited.delete(item);
    }
  }
  for(const entry of order)visit(entry,0);
  return ids.map(id=>{
    const group=config.getGroup(id) as {name?:unknown}|null;
    if(!group)throw new Error('PDF layer order contains a missing group.');
    const name=typeof group.name==='string'&&group.name.trim()
      ? group.name.slice(0,250):'Unnamed layer';
    return {id,name,visible:Boolean(config.isVisible({type:'OCG',id}))};
  });
}

/** Mutate only the PDF.js *viewer* configuration; never modify PDF file bytes. */
export function setPdfOptionalLayerVisibility(
  config: PdfOptionalContentConfig,
  id: string,
  visible: boolean,
): PdfOptionalLayer[] {
  const list = listPdfOptionalLayers(config);
  if (!list.some(layer=>layer.id===id)) {
    throw new Error('Layer no longer exists in the active PDF.');
  }
  if (typeof visible!=='boolean') throw new Error('Layer visibility must be a boolean.');
  config.setVisibility(id,visible,true);
  return listPdfOptionalLayers(config);
}

/** Restore original per-document visibility choices without replacing the PDF. */
export function restorePdfOptionalLayerVisibility(
  config: PdfOptionalContentConfig,
  original: readonly PdfOptionalLayer[],
): PdfOptionalLayer[] {
  const current = listPdfOptionalLayers(config);
  if (current.length!==original.length ||
      current.some(item=>!original.some(initial=>initial.id===item.id))) {
    throw new Error('Layer identities changed; reopen the PDF to reset visibility.');
  }
  for (const item of original) config.setVisibility(item.id,item.visible,true);
  return listPdfOptionalLayers(config);
}
