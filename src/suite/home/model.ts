import type { ModuleId } from '../core/types';
import type { LibraryDocument } from '../files/types';

export const HOME_STATE_SCHEMA_VERSION = 1 as const;
export const HOME_STORAGE_KEY = 'malenjo.home.state.v1';

export type HomeView = 'recent' | 'starred' | 'locations';

export interface HomePinnedLocation {
  id: string;
  label: string;
  path: string;
  addedAt: number;
}

export interface HomeStateV1 {
  schemaVersion: typeof HOME_STATE_SCHEMA_VERSION;
  activeView: HomeView;
  starredDocumentIds: string[];
  pinnedLocations: HomePinnedLocation[];
}

export interface HomePrimaryAction {
  id: string;
  label: string;
  detail: string;
  target?: ModuleId;
  opensFiles?: boolean;
}

export const HOME_PRIMARY_ACTIONS: HomePrimaryAction[] = [
  { id:'open', label:'Open', detail:'Open local documents', opensFiles:true },
  { id:'document', label:'Document', detail:'Word-like workspace', target:'word' },
  { id:'spreadsheet', label:'Spreadsheet', detail:'Workbook workspace', target:'spreadsheet' },
  { id:'presentation', label:'Presentation', detail:'Slide workspace', target:'presentation' },
  { id:'pdf', label:'PDF', detail:'Open PDF workspace', target:'pdf' },
  { id:'scan', label:'Scan', detail:'Camera and page capture', target:'scanner' },
  { id:'ocr', label:'OCR', detail:'Recognize document text', target:'ocr' },
  { id:'ai', label:'Malenjo AI', detail:'Private local document AI', target:'ai' },
];

export const HOME_VISUAL_BASELINE = {
  source: 'satnaing/shadcn-admin',
  sourceCommit: 'e16c87f213a5ba5e45964e9b67c792105ec74d26',
  license: 'MIT',
  primaryActionCount: 8,
  views: ['recent','starred','locations'] as const,
  rightRailCards: ['system','updates','student-hub'] as const,
  desktopColumns: 2,
  compactBreakpointPx: 1120,
} as const;

export function defaultHomeState(): HomeStateV1 {
  return {
    schemaVersion: HOME_STATE_SCHEMA_VERSION,
    activeView: 'recent',
    starredDocumentIds: [],
    pinnedLocations: [],
  };
}

function cleanString(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function isHomeView(value: unknown): value is HomeView {
  return value === 'recent' || value === 'starred' || value === 'locations';
}

function normalizedPath(value: string): string {
  return value.trim().replace(/[\\/]+$/,'').toLocaleLowerCase();
}

export function sanitizeHomeState(value: unknown): HomeStateV1 {
  if (!value || typeof value !== 'object') return defaultHomeState();
  const candidate=value as Partial<HomeStateV1>;

  const starred=Array.isArray(candidate.starredDocumentIds)
    ? Array.from(new Set(candidate.starredDocumentIds
        .map((id)=>cleanString(id,180))
        .filter(Boolean)))
        .slice(0,200)
    : [];

  const pins: HomePinnedLocation[]=[];
  const seenPaths=new Set<string>();
  if (Array.isArray(candidate.pinnedLocations)) {
    for (const raw of candidate.pinnedLocations.slice(0,40)) {
      if (!raw || typeof raw !== 'object') continue;
      const item=raw as Partial<HomePinnedLocation>;
      const path=cleanString(item.path,2048);
      const key=normalizedPath(path);
      if (!path || seenPaths.has(key)) continue;
      seenPaths.add(key);
      pins.push({
        id:cleanString(item.id,180) || `pin-${pins.length + 1}`,
        label:cleanString(item.label,160) || locationLabelFromPath(path),
        path,
        addedAt:Number.isFinite(item.addedAt) ? Math.max(0,Number(item.addedAt)) : 0,
      });
    }
  }

  return {
    schemaVersion:HOME_STATE_SCHEMA_VERSION,
    activeView:isHomeView(candidate.activeView) ? candidate.activeView : 'recent',
    starredDocumentIds:starred,
    pinnedLocations:pins,
  };
}

export function locationLabelFromPath(path: string): string {
  const trimmed=path.trim().replace(/[\\/]+$/,'');
  if (!trimmed) return 'Pinned folder';
  const segments=trimmed.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) || trimmed;
}

export function addPinnedLocation(
  state: HomeStateV1,
  location: HomePinnedLocation,
): HomeStateV1 {
  const key=normalizedPath(location.path);
  const withoutDuplicate=state.pinnedLocations.filter((item)=>normalizedPath(item.path)!==key);
  return {
    ...state,
    pinnedLocations:[location,...withoutDuplicate].slice(0,40),
  };
}

export function removePinnedLocation(state: HomeStateV1, id: string): HomeStateV1 {
  return { ...state, pinnedLocations:state.pinnedLocations.filter((item)=>item.id!==id) };
}

export function toggleStarredDocument(state: HomeStateV1, documentId: string): HomeStateV1 {
  const exists=state.starredDocumentIds.includes(documentId);
  return {
    ...state,
    starredDocumentIds:exists
      ? state.starredDocumentIds.filter((id)=>id!==documentId)
      : [documentId,...state.starredDocumentIds].slice(0,200),
  };
}

export function sortRecentDocuments(documents: LibraryDocument[]): LibraryDocument[] {
  return [...documents].sort((left,right) => {
    const l=left.lastOpenedMs ?? left.addedMs ?? left.modifiedMs;
    const r=right.lastOpenedMs ?? right.addedMs ?? right.modifiedMs;
    if (r!==l) return r-l;
    return left.name.localeCompare(right.name);
  });
}

export function homeDocumentsForView(
  documents: LibraryDocument[],
  state: HomeStateV1,
  view: Exclude<HomeView,'locations'>,
  query: string,
): LibraryDocument[] {
  const normalized=query.trim().toLocaleLowerCase();
  const source=view==='starred'
    ? state.starredDocumentIds
        .map((id)=>documents.find((document)=>document.id===id))
        .filter((document): document is LibraryDocument=>Boolean(document))
    : sortRecentDocuments(documents);

  if (!normalized) return source.slice(0,20);
  const terms=normalized.split(/\s+/).filter(Boolean);
  return source.filter((document)=>{
    const haystack=[document.name,document.extension,document.kind,document.locationLabel].join(' ').toLocaleLowerCase();
    return terms.every((term)=>haystack.includes(term));
  }).slice(0,50);
}

export function pruneMissingStarredDocuments(
  state: HomeStateV1,
  documents: LibraryDocument[],
): HomeStateV1 {
  const ids=new Set(documents.map((document)=>document.id));
  const next=state.starredDocumentIds.filter((id)=>ids.has(id));
  return next.length===state.starredDocumentIds.length ? state : { ...state, starredDocumentIds:next };
}
