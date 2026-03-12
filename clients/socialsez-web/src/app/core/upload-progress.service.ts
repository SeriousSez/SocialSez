import { Injectable } from '@angular/core';

export type ProgressKind = 'generic' | 'story' | 'reel' | 'post' | 'blog';

export interface ProgressItem {
    id: number;
    label: string;
    status: 'pending' | 'success' | 'failed';
    kind: ProgressKind;
}

export interface ProgressHandle {
    succeed(label?: string): void;
    fail(label?: string): void;
}

@Injectable({ providedIn: 'root' })
export class UploadProgressService {
    private counter = 0;
    private _items: ProgressItem[] = [];

    get items(): readonly ProgressItem[] {
        return this._items;
    }

    begin(label: string, kind: ProgressKind = 'generic'): ProgressHandle {
        const id = ++this.counter;
        this._items = [...this._items, { id, label, status: 'pending', kind }];

        const update = (newLabel: string, status: 'success' | 'failed') => {
            this._items = this._items.map(item =>
                item.id === id ? { ...item, label: newLabel, status } : item
            );
            window.setTimeout(() => {
                this._items = this._items.filter(item => item.id !== id);
            }, 5000);
        };

        return {
            succeed: (label?: string) => update(label ?? 'Done', 'success'),
            fail: (label?: string) => update(label ?? 'Failed', 'failed')
        };
    }
}
