import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Plus, Trash2 } from 'lucide-react';
import { generateId } from '../lib/formatters';
import type { MaterialNeedItem } from '../types';

export type MaterialSortMode = 'manual' | 'item-asc' | 'item-desc' | 'qty-desc' | 'needed-first';

interface MaterialsListPanelProps {
  materialsNeeded: boolean;
  items: MaterialNeedItem[];
  onChange: (materialsNeeded: boolean, nextItems: MaterialNeedItem[]) => void;
  compact?: boolean;
  readOnly?: boolean;
}

function parseLeadingNumber(qty: string): number {
  const m = /^[\d.]+/.exec(qty.trim());
  return m ? Number(m[0]) || 0 : 0;
}

export const MaterialsListPanel: React.FC<MaterialsListPanelProps> = ({
  materialsNeeded,
  items,
  onChange,
  compact = false,
  readOnly = false,
}) => {
  const [sortMode, setSortMode] = useState<MaterialSortMode>('manual');
  const [newQty, setNewQty] = useState('');
  const [newItem, setNewItem] = useState('');

  const sortedItems = useMemo(() => {
    const copy = [...items];
    switch (sortMode) {
      case 'item-asc':
        return copy.sort((a, b) => a.item.localeCompare(b.item));
      case 'item-desc':
        return copy.sort((a, b) => b.item.localeCompare(a.item));
      case 'qty-desc':
        return copy.sort((a, b) => parseLeadingNumber(b.quantity) - parseLeadingNumber(a.quantity));
      case 'needed-first':
        return copy.sort((a, b) => Number(Boolean(a.obtained)) - Number(Boolean(b.obtained)));
      default:
        return copy;
    }
  }, [items, sortMode]);

  const handleAdd = () => {
    if (readOnly) return;
    const trimmedItem = newItem.trim();
    if (!trimmedItem) return;
    const entry: MaterialNeedItem = {
      id: generateId('mat'),
      quantity: newQty.trim() || '1',
      item: trimmedItem,
      obtained: false,
    };
    onChange(true, [...items, entry]);
    setNewQty('');
    setNewItem('');
  };

  const handleMove = (id: string, dir: -1 | 1) => {
    if (readOnly) return;
    const idx = items.findIndex((m) => m.id === id);
    if (idx < 0) return;
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(idx, 1);
    next.splice(targetIdx, 0, moved);
    setSortMode('manual');
    onChange(materialsNeeded, next);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-700">Materials:</span>
          {readOnly ? (
            <span className="text-xs font-medium text-slate-800">
              {materialsNeeded ? 'Materials Needed' : 'No Materials Needed'}
            </span>
          ) : (
            <select
              value={materialsNeeded ? 'needed' : 'none'}
              onChange={(e) => onChange(e.target.value === 'needed', items)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 focus:border-amber-600 focus:outline-none"
            >
              <option value="needed">Materials Needed</option>
              <option value="none">No Materials Needed</option>
            </select>
          )}
        </div>

        {items.length > 1 && (
          <div className="flex items-center gap-1.5">
            <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as MaterialSortMode)}
              aria-label="Sort materials list"
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:border-amber-600 focus:outline-none"
            >
              <option value="manual">Sort: Custom Order</option>
              <option value="needed-first">Sort: Unpurchased First</option>
              <option value="item-asc">Sort: Item (A–Z)</option>
              <option value="item-desc">Sort: Item (Z–A)</option>
              <option value="qty-desc">Sort: Quantity (High–Low)</option>
            </select>
          </div>
        )}
      </div>

      {materialsNeeded && (
        <div className="space-y-2">
          {sortedItems.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
              {readOnly ? 'No materials listed yet.' : 'No materials added yet. Enter quantity and item below.'}
            </p>
          ) : (
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
              <div className="grid grid-cols-12 gap-2 bg-slate-50 px-2.5 py-1.5 text-[11px] font-semibold text-slate-500">
                <div className="col-span-1 text-center">Got</div>
                <div className="col-span-3">Quantity</div>
                <div className={readOnly ? 'col-span-8' : 'col-span-6'}>Item</div>
                {!readOnly && <div className="col-span-2 text-right">Order</div>}
              </div>
              {sortedItems.map((mat, idx) => (
                <div key={mat.id} className="grid grid-cols-12 items-center gap-2 px-2.5 py-1.5 text-xs">
                  <div className="col-span-1 flex justify-center">
                    <input
                      type="checkbox"
                      checked={Boolean(mat.obtained)}
                      disabled={readOnly}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        onChange(
                          materialsNeeded,
                          items.map((m) => (m.id === mat.id ? { ...m, obtained: checked } : m))
                        );
                      }}
                      aria-label={`Mark ${mat.item} obtained`}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-amber-600 focus:ring-amber-600 disabled:opacity-70"
                    />
                  </div>
                  <div className="col-span-3">
                    {readOnly ? (
                      <span
                        className={`block font-mono text-xs ${
                          mat.obtained ? 'text-slate-400 line-through' : 'text-slate-900'
                        }`}
                      >
                        {mat.quantity}
                      </span>
                    ) : (
                      <input
                        type="text"
                        value={mat.quantity}
                        onChange={(e) =>
                          onChange(
                            materialsNeeded,
                            items.map((m) => (m.id === mat.id ? { ...m, quantity: e.target.value } : m))
                          )
                        }
                        placeholder="Qty"
                        className={`w-full rounded border border-slate-200 px-2 py-1 font-mono text-xs focus:border-amber-600 focus:outline-none ${
                          mat.obtained ? 'text-slate-400 line-through bg-slate-50' : 'text-slate-900 bg-white'
                        }`}
                      />
                    )}
                  </div>
                  <div className={readOnly ? 'col-span-8' : 'col-span-6'}>
                    {readOnly ? (
                      <span
                        className={`block text-xs ${
                          mat.obtained ? 'text-slate-400 line-through' : 'text-slate-900'
                        }`}
                      >
                        {mat.item}
                      </span>
                    ) : (
                      <input
                        type="text"
                        value={mat.item}
                        onChange={(e) =>
                          onChange(
                            materialsNeeded,
                            items.map((m) => (m.id === mat.id ? { ...m, item: e.target.value } : m))
                          )
                        }
                        placeholder="Material item"
                        className={`w-full rounded border border-slate-200 px-2 py-1 text-xs focus:border-amber-600 focus:outline-none ${
                          mat.obtained ? 'text-slate-400 line-through bg-slate-50' : 'text-slate-900 bg-white'
                        }`}
                      />
                    )}
                  </div>
                  {!readOnly && (
                    <div className="col-span-2 flex items-center justify-end gap-0.5">
                      {sortMode === 'manual' && (
                        <>
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => handleMove(mat.id, -1)}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                            aria-label={`Move ${mat.item} up`}
                          >
                            <ArrowUp className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === sortedItems.length - 1}
                            onClick={() => handleMove(mat.id, 1)}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                            aria-label={`Move ${mat.item} down`}
                          >
                            <ArrowDown className="h-3 w-3" />
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          onChange(
                            materialsNeeded,
                            items.filter((m) => m.id !== mat.id)
                          )
                        }
                        className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        aria-label={`Remove ${mat.item}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {!readOnly && (
            <div className={`grid grid-cols-12 gap-2 ${compact ? 'pt-0.5' : 'pt-1'}`}>
              <input
                type="text"
                value={newQty}
                onChange={(e) => setNewQty(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAdd();
                  }
                }}
                placeholder="Qty (e.g. 4)"
                className="col-span-3 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-amber-600 focus:outline-none"
              />
              <input
                type="text"
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAdd();
                  }
                }}
                placeholder="Material / item needed..."
                className="col-span-7 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-amber-600 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleAdd}
                className="col-span-2 inline-flex items-center justify-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" />
                Add
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
