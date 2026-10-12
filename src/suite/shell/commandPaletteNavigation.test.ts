import { describe, expect, it } from 'vitest';
import { firstAvailableCommand, moveAvailableCommand } from './commandPaletteNavigation';

describe('keyboard-accessible MALENJO command palette', () => {
  const actions = [{disabled:true},{disabled:false},{disabled:true},{disabled:false}];

  it('begins at an executable result and never chooses a disabled one', () => {
    expect(firstAvailableCommand(actions)).toBe(1);
    expect(moveAvailableCommand(actions,1,1)).toBe(3);
    expect(moveAvailableCommand(actions,3,1)).toBe(1);
    expect(moveAvailableCommand(actions,1,-1)).toBe(3);
    expect(moveAvailableCommand(actions,3,-1)).toBe(1);
  });
  it('handles empty and all-disabled results without inventing commands', () => {
    expect(firstAvailableCommand([])).toBe(-1);
    expect(moveAvailableCommand([],0,1)).toBe(-1);
    expect(firstAvailableCommand([{disabled:true},{disabled:true}])).toBe(-1);
    expect(moveAvailableCommand([{disabled:true},{disabled:true}],0,-1)).toBe(-1);
  });
  it('works from a previously unselected state and wraps in either direction', () => {
    expect(moveAvailableCommand(actions,-1,1)).toBe(1);
    expect(moveAvailableCommand(actions,0,-1)).toBe(3);
  });
});
