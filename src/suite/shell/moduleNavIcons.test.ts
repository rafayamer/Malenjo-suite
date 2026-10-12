import { describe, expect, it } from 'vitest';
import { modules } from '../modules/registry';
import { MODULE_NAV_ICONS } from './moduleNavIcons';

describe('MALENJO module rail icon contract', () => {
  it('has a distinct lookup entry for every registered module and no orphan key', () => {
    const required = modules.map((module) => module.id).sort();
    expect(required).toHaveLength(22);
    expect(Object.keys(MODULE_NAV_ICONS).sort()).toEqual(required);
  });

  it('exposes genuine icon renderers rather than a two-letter placeholder', () => {
    for (const module of modules) {
      const icon = MODULE_NAV_ICONS[module.id];
      expect(icon).toBeTruthy();
      expect(['function', 'object']).toContain(typeof icon);
    }
  });
});
