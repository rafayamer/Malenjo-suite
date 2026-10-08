import matrix from '../../../docs/pdf-stirling-parity-matrix.json';
import type { PdfProviderOperation } from './backend';

export type PdfParityRouteState =
  |'not-in-pinned-endpoint-fixture'
  |'provider-not-loaded'
  |'not-in-live-openapi'
  |'provider-disabled'
  |'provider-reports-available';

export interface PdfParityCoverageRow{
  order:number;
  id:string;
  group:string;
  expectedEndpoint:string|null;
  sourcePinned:boolean;
  state:PdfParityRouteState;
  operation:PdfProviderOperation|null;
  // A responsive API provider is not enough to claim functional parity.
  functionallyVerified:false;
  locallySourceAuditedPartial:boolean;
}

export interface PdfParityCoverage{
  total:number;
  upstreamFixtureMatched:number;
  liveRoutes:number;
  providerEnabled:number;
  functionallyVerified:0;
  locallySourceAuditedPartial:number;
  rows:PdfParityCoverageRow[];
}

/**
 * 90-tool MALENJO handoff evidence vs. the actual runtime OpenAPI catalog.
 *
 * "provider-reports-available" is intentionally distinct from working,
 * tested, redistributable, or Windows-offline verified. This function does
 * not run any operations; those separate release gates remain mandatory.
 */
export function computePdfParityCoverage(
  operations:ReadonlyArray<PdfProviderOperation>,
  providerCatalogLoaded:boolean,
):PdfParityCoverage{
  const byPath=new Map<string,PdfProviderOperation>();
  for(const operation of operations){
    const canonical=operation.path.replace(/\/+$/,'');
    if(!byPath.has(canonical))byPath.set(canonical,operation);
  }
  let upstreamFixtureMatched=0;
  let liveRoutes=0;
  let providerEnabled=0;
  let locallySourceAuditedPartial=0;
  const rows:PdfParityCoverageRow[]=matrix.operations.map((entry)=>{
    const expectedEndpoint=entry.source.upstreamEndpoint;
    if(expectedEndpoint)upstreamFixtureMatched++;
    if(entry.evidence.functionalStatus==='partial')locallySourceAuditedPartial++;
    const operation=expectedEndpoint?byPath.get(expectedEndpoint)??null:null;
    if(operation)liveRoutes++;
    if(operation?.capability.available)providerEnabled++;
    const state:PdfParityRouteState=!expectedEndpoint
      ?'not-in-pinned-endpoint-fixture'
      :!providerCatalogLoaded
        ?'provider-not-loaded'
        :!operation
          ?'not-in-live-openapi'
          :operation.capability.available
            ?'provider-reports-available'
            :'provider-disabled';
    return {
      order:entry.order,id:entry.upstreamToolId,group:entry.group,
      expectedEndpoint,sourcePinned:Boolean(entry.source.endpointInPinnedFixture),
      state,operation,functionallyVerified:false,
      locallySourceAuditedPartial:entry.evidence.functionalStatus==='partial',
    };
  });
  return {
    total:rows.length,upstreamFixtureMatched,liveRoutes,providerEnabled,
    functionallyVerified:0,locallySourceAuditedPartial,rows,
  };
}
