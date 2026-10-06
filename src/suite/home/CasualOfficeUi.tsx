/*
 * Adapted from CasualOffice/desktop package casual-office-ui.
 * Upstream commit: 39fe70960462a9f16ea4f1e9aaa8b963d5da6ef1
 * License: Apache-2.0. See third_party/casualoffice/LICENSE and PROVENANCE.md.
 *
 * MALENJO changes: React/lucide icon injection, broader document kinds,
 * MALENJO class prefix, and explicit disabled/unavailable states.
 */
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { Search } from 'lucide-react';

export interface OfficeActionCardProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  tone?: 'document' | 'sheets' | 'slides' | 'pdf' | 'scan' | 'ai' | 'neutral';
  dashed?: boolean;
}

export function OfficeActionCard({
  title, subtitle, icon, tone='neutral', dashed, className, ...rest
}:OfficeActionCardProps){
  const cls=['ml-co-action-card','ml-co-action-card--'+tone,dashed&&'ml-co-action-card--dashed',className]
    .filter(Boolean).join(' ');
  return <button type="button" className={cls} {...rest}>
    {icon&&<span className="ml-co-action-icon" aria-hidden="true">{icon}</span>}
    <span className="ml-co-action-copy">
      <span className="ml-co-action-title">{title}</span>
      {subtitle&&<span className="ml-co-action-sub">{subtitle}</span>}
    </span>
  </button>;
}

export interface OfficeRecentCardProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>,'title'> {
  name:string;
  path?:string;
  time?:string;
  kindLabel:string;
  tone?:'document'|'sheets'|'slides'|'pdf'|'image'|'other';
  pinned?:boolean;
  unavailable?:boolean;
}

export function OfficeRecentCard({
  name,path,time,kindLabel,tone='other',pinned,unavailable,className,...rest
}:OfficeRecentCardProps){
  const cls=['ml-co-recent-card',pinned&&'ml-co-recent-card--pinned',unavailable&&'ml-co-recent-card--unavailable',className]
    .filter(Boolean).join(' ');
  return <button type="button" className={cls} {...rest}>
    <span className={'ml-co-file-icon ml-co-file-icon--'+tone} aria-hidden="true">{kindLabel.slice(0,4)}</span>
    <span className="ml-co-recent-meta">
      <span className="ml-co-recent-name">{pinned&&<span className="ml-co-pin-mark" aria-hidden="true">★</span>}{name}</span>
      {path&&<span className="ml-co-recent-path">{path}</span>}
      <span className="ml-co-recent-footer">
        <span className={'ml-co-type-badge ml-co-type-badge--'+tone}>{kindLabel}</span>
        {time&&<span className="ml-co-recent-time">{time}</span>}
        {unavailable&&<span className="ml-co-unavailable">Unavailable</span>}
      </span>
    </span>
  </button>;
}

export interface OfficeSearchInputProps extends InputHTMLAttributes<HTMLInputElement>{}

export function OfficeSearchInput({className,placeholder='Search recent…',...rest}:OfficeSearchInputProps){
  return <label className={className?'ml-co-search '+className:'ml-co-search'}>
    <Search size={14} aria-hidden="true"/>
    <input type="text" placeholder={placeholder} {...rest}/>
  </label>;
}

export interface OfficeSegmentOption<T extends string=string>{ value:T; label:string; }
export interface OfficeSegmentedFilterProps<T extends string=string>{
  options:OfficeSegmentOption<T>[];
  value:T;
  onChange?:(value:T)=>void;
  'aria-label'?:string;
}

export function OfficeSegmentedFilter<T extends string=string>({
  options,value,onChange,...rest
}:OfficeSegmentedFilterProps<T>){
  return <div className="ml-co-segmented" role="tablist" aria-label={rest['aria-label']}>
    {options.map((option)=><button
      key={option.value}
      type="button"
      role="tab"
      aria-selected={option.value===value}
      className={option.value===value?'ml-co-segmented-btn active':'ml-co-segmented-btn'}
      onClick={()=>onChange?.(option.value)}
    >{option.label}</button>)}
  </div>;
}

export interface OfficeContextMenuItem{
  label:ReactNode;
  onSelect?:()=>void;
  danger?:boolean;
  disabled?:boolean;
}

export function OfficeContextMenu({items,className}:{items:OfficeContextMenuItem[];className?:string}){
  return <div className={className?'ml-co-context-menu '+className:'ml-co-context-menu'} role="menu">
    {items.map((item,index)=><button
      key={index}
      type="button"
      role="menuitem"
      disabled={item.disabled}
      className={item.danger?'ml-co-context-item danger':'ml-co-context-item'}
      onClick={item.onSelect}
    >{item.label}</button>)}
  </div>;
}