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
  frontendRoute:string|null;
  frontendCoreToolId:string|null;
  sourcePinned:boolean;
  controllerOnly:boolean;
  configurationOnly:boolean;
  state:PdfParityRouteState;
  operation:PdfProviderOperation|null;
  // A responsive API provider is not enough to claim functional parity.
  functionallyVerified:boolean;
  locallySourceAuditedPartial:boolean;
}

export interface PdfParityCoverage{
  total:number;
  upstreamFixtureMatched:number;
  pinnedControllerOnlyRouteMatches:number;
  frontendOnlyRouteMatches:number;
  configurationOnlyMatches:number;
  sourceClassificationPending:number;
  liveRoutes:number;
  providerEnabled:number;
  functionallyVerified:number;
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
function fullyAccepted(entry:(typeof matrix.operations)[number]):boolean{
  const evidence=entry.evidence as typeof entry.evidence & {
    manualWindowsAcceptance?:boolean;
    acceptedBuildSha?:string;
  };
  // A successful CI job or a live OpenAPI endpoint cannot promote parity.
  // Require exact artifact, source, Windows and manual acceptance provenance.
  return evidence.functionalStatus==='implemented'&&
    entry.malenjo.implementationPaths.length>0&&
    Boolean(entry.malenjo.frontendCommand)&&
    Boolean(entry.source.license)&&entry.source.attributionVerified===true&&
    evidence.positiveTestIds.length>0&&evidence.negativeTestIds.length>0&&
    evidence.fixtures.length>0&&Boolean(evidence.limits)&&
    evidence.windowsOffline==='verified'&&evidence.runtimeResultVerified===true&&
    evidence.exportReopenVerified===true&&
    evidence.manualWindowsAcceptance===true&&
    /^[a-f0-9]{40}$/.test(evidence.acceptedBuildSha??'');
}

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
  let pinnedControllerOnlyRouteMatches=0;
  let frontendOnlyRouteMatches=0;
  let configurationOnlyMatches=0;
  let sourceClassificationPending=0;
  let liveRoutes=0;
  let providerEnabled=0;
  let locallySourceAuditedPartial=0;
  let functionallyVerified=0;
  const rows:PdfParityCoverageRow[]=matrix.operations.map((entry)=>{
    const expectedEndpoint=entry.source.upstreamEndpoint??entry.source.pinnedControllerEndpoint??null;
    if(entry.source.upstreamEndpoint)upstreamFixtureMatched++;
    else if(entry.source.pinnedControllerEndpoint)pinnedControllerOnlyRouteMatches++;
    else if(entry.source.pinnedFrontendCoreToolId)frontendOnlyRouteMatches++;
    else if(entry.source.pinnedConfigurationOnly)configurationOnlyMatches++;
    else sourceClassificationPending++;
    if(entry.evidence.functionalStatus==='partial')locallySourceAuditedPartial++;
    const accepted=fullyAccepted(entry);
    if(accepted)functionallyVerified++;
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
      expectedEndpoint,
      frontendRoute:entry.source.pinnedFrontendRoute,
      frontendCoreToolId:entry.source.pinnedFrontendCoreToolId,
      sourcePinned:Boolean(entry.source.endpointInPinnedFixture),
      controllerOnly:!entry.source.upstreamEndpoint&&Boolean(entry.source.pinnedControllerEndpoint),
      configurationOnly:Boolean(entry.source.pinnedConfigurationOnly),
      state,operation,functionallyVerified:accepted,
      locallySourceAuditedPartial:entry.evidence.functionalStatus==='partial',
    };
  });
  return {
    total:rows.length,upstreamFixtureMatched,pinnedControllerOnlyRouteMatches,
    frontendOnlyRouteMatches,configurationOnlyMatches,sourceClassificationPending,liveRoutes,providerEnabled,
    functionallyVerified,locallySourceAuditedPartial,rows,
  };
}
