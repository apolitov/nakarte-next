// Checkpoints: named points of interest on a route or a track (water, food,
// camp...). Shown as markers; a click opens an editor popup.
import * as maplibregl from 'maplibre-gl';

export const CHECKPOINT_KINDS = [
  { id: 'water', title: 'Вода', icon: '💧', gpx: 'Drinking Water' },
  { id: 'food', title: 'Еда, кафе', icon: '🍴', gpx: 'Restaurant' },
  { id: 'shop', title: 'Магазин', icon: '🛒', gpx: 'Shopping Center' },
  { id: 'camp', title: 'Ночёвка', icon: '⛺', gpx: 'Campground' },
  { id: 'view', title: 'Вид', icon: '📷', gpx: 'Scenic Area' },
  { id: 'danger', title: 'Опасно', icon: '⚠️', gpx: 'Danger Area' },
  { id: 'summit', title: 'Вершина, перевал', icon: '⛰️', gpx: 'Summit' },
  { id: 'generic', title: 'Точка', icon: '📍', gpx: 'Flag, Blue' },
] as const;

export const kindOf = (k: string) => CHECKPOINT_KINDS.find((x) => x.id === k) ?? CHECKPOINT_KINDS.at(-1)!;

export interface CheckpointItem {
  id: string;
  lng: number;
  lat: number;
  kind: string;
  name: string;
  note?: string;
  /** 'route' or a track id */
  owner: string;
  editable: boolean;
}

export interface CheckpointCallbacks {
  update(item: CheckpointItem, patch: Partial<CheckpointItem>): void;
  remove(item: CheckpointItem): void;
}

export class CheckpointLayer {
  private markers = new Map<string, { m: maplibregl.Marker; item: CheckpointItem }>();
  private popup: maplibregl.Popup | null = null;

  constructor(
    private map: maplibregl.Map,
    private cb: CheckpointCallbacks,
  ) {}

  set(items: CheckpointItem[]) {
    const seen = new Set<string>();
    for (const it of items) {
      seen.add(it.id);
      const cur = this.markers.get(it.id);
      if (cur) {
        cur.item = it;
        cur.m.setLngLat([it.lng, it.lat]);
        cur.m.setDraggable(it.editable);
        this.decorate(cur.m.getElement(), it);
        continue;
      }
      const el = document.createElement('div');
      this.decorate(el, it);
      const m = new maplibregl.Marker({ element: el, draggable: it.editable, anchor: 'bottom' }).setLngLat([it.lng, it.lat]).addTo(this.map);
      const entry = { m, item: it };
      m.on('dragend', () => {
        const p = m.getLngLat();
        this.cb.update(entry.item, { lng: p.lng, lat: p.lat });
      });
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.open(entry.item);
      });
      this.markers.set(it.id, entry);
    }
    for (const [id, { m }] of this.markers) {
      if (!seen.has(id)) {
        m.remove();
        this.markers.delete(id);
      }
    }
  }

  private decorate(el: HTMLElement, it: CheckpointItem) {
    const k = kindOf(it.kind);
    el.classList.add('cp'); // keep MapLibre's own marker classes
    el.textContent = k.icon;
    el.title = it.name || k.title;
  }

  /** Popup with kind, name, note and delete. */
  open(it: CheckpointItem) {
    this.popup?.remove();
    const el = document.createElement('div');
    el.className = 'cp-edit';
    const k = kindOf(it.kind);
    if (!it.editable) {
      el.innerHTML = `<b></b><div class="muted"></div><p></p>`;
      el.querySelector('b')!.textContent = `${k.icon} ${it.name || k.title}`;
      el.querySelector('.muted')!.textContent = k.title;
      el.querySelector('p')!.textContent = it.note ?? '';
    } else {
      const sel = document.createElement('select');
      for (const kk of CHECKPOINT_KINDS) sel.add(new Option(`${kk.icon} ${kk.title}`, kk.id, false, kk.id === it.kind));
      const name = Object.assign(document.createElement('input'), { value: it.name, placeholder: 'Название' });
      const note = Object.assign(document.createElement('textarea'), { value: it.note ?? '', placeholder: 'Заметка', rows: 2 });
      const del = Object.assign(document.createElement('button'), { textContent: 'Удалить', className: 'danger' });
      const save = () => this.cb.update(it, { kind: sel.value, name: name.value.trim(), note: note.value.trim() || undefined });
      sel.onchange = save;
      name.onchange = save;
      note.onchange = save;
      name.onkeydown = (e) => e.key === 'Enter' && (save(), this.popup?.remove());
      del.onclick = () => {
        this.popup?.remove();
        this.cb.remove(it);
      };
      el.append(sel, name, note, del);
      setTimeout(() => name.focus(), 0);
    }
    this.popup = new maplibregl.Popup({ offset: 28, className: 'cp-popup', maxWidth: '260px' })
      .setLngLat([it.lng, it.lat])
      .setDOMContent(el)
      .addTo(this.map);
  }
}
