import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import {
  AutomationsService,
  type ErpNoticeDto,
  type ErpNoticesTab,
  type RiloNoticeSeverity,
} from '../../core/services/automations.service';
import { AuthService } from '../../core/services/auth.service';
import { AddonsService, type AddonsSnapshot } from '../../core/services/addons.service';
import {
  PAGE_CONTENT_MAX_CLASS,
  PAGE_DESC_CLASS,
  PAGE_SHELL_CLASS,
  PAGE_TITLE_CLASS,
} from '../../shared/ui.constants';

@Component({
  selector: 'app-avisos-center',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideAngularModule],
  template: `
    <div [class]="pageShellClass" data-page="avisos">
      <div [class]="pageContentClass + ' space-y-5'">
        <header class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div class="min-w-0">
            <h1 [class]="pageTitleClass">RILO te avisa</h1>
            <p [class]="pageDescClass + ' mt-1'">
              Lo que necesita tu atención, con datos reales del negocio.
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2 self-start">
            <a
              routerLink="/settings"
              [queryParams]="{ tab: 'avisos' }"
              class="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-xs font-semibold text-teal-700 dark:text-teal-400 hover:bg-teal-50/60 dark:hover:bg-teal-950/30 min-h-10"
              data-configurar-avisos>
              <i-lucide name="settings" class="w-3.5 h-3.5 shrink-0"></i-lucide>
              Configurar avisos
            </a>
            <button
              type="button"
              class="hidden sm:inline-flex shrink-0 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 min-h-10"
              [disabled]="markingAll || !unreadCount"
              (click)="markAllAsRead()">
              Marcar todos como leídos
            </button>
            <details class="sm:hidden relative">
              <summary
                class="list-none inline-flex items-center justify-center min-h-11 min-w-11 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 cursor-pointer"
                aria-label="Más acciones">
                <i-lucide name="more-vertical" class="w-5 h-5"></i-lucide>
              </summary>
              <div
                class="absolute right-0 mt-1 z-20 min-w-[12rem] rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg p-1">
                <button
                  type="button"
                  class="w-full text-left rounded-lg px-3 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                  [disabled]="markingAll || !unreadCount"
                  (click)="markAllAsRead()">
                  Marcar todos como leídos
                </button>
              </div>
            </details>
          </div>
        </header>

        <div
          class="flex w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-1 gap-0.5"
          role="tablist"
          aria-label="Filtro de avisos">
          <button
            *ngFor="let tab of tabs"
            type="button"
            role="tab"
            class="flex-1 rounded-lg px-2 py-2.5 text-sm font-semibold transition-colors min-h-11 sm:min-h-10"
            [class.bg-teal-600]="activeTab === tab.id"
            [class.text-white]="activeTab === tab.id"
            [class.text-gray-600]="activeTab !== tab.id"
            [class.dark:text-gray-300]="activeTab !== tab.id"
            [class.hover:bg-gray-100]="activeTab !== tab.id"
            [class.dark:hover:bg-gray-800]="activeTab !== tab.id"
            [attr.aria-selected]="activeTab === tab.id"
            (click)="selectTab(tab.id)">
            {{ tab.label }}
          </button>
        </div>

        <p *ngIf="loading" class="text-sm text-gray-500">Cargando avisos…</p>
        <p *ngIf="error" class="text-sm text-red-600">{{ error }}</p>

        <div
          *ngIf="!loading && !error && notices.length === 0"
          class="rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-gray-900/40 px-4 py-10 text-center">
          <p class="text-base font-semibold text-gray-800 dark:text-gray-100">✅ Todo tranquilo por acá</p>
          <p class="mt-1.5 text-sm text-gray-500 dark:text-gray-400">
            No tenés nada que requiera tu atención ahora.
          </p>
        </div>

        <ul class="space-y-3" *ngIf="!loading && !error && notices.length">
          <li *ngFor="let notice of notices; let i = index">
            <p
              *ngIf="proximityGroupLabel(notice, i) as group"
              class="px-1 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 first:pt-0">
              {{ group }}
            </p>
            <article
              class="rounded-2xl border bg-white dark:bg-gray-900 overflow-hidden transition-opacity"
              [class.opacity-70]="activeTab === 'resueltos'"
              [ngClass]="severityBorderClass(notice.severity)"
              (click)="onOpenNotice(notice)">
              <div
                class="px-4 py-3.5 sm:px-5 sm:py-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
                [ngClass]="severityBgClass(notice.severity)">
                <div class="min-w-0 flex-1 space-y-1.5">
                  <div class="flex flex-wrap items-center gap-2">
                    <span
                      class="inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                      [ngClass]="severityBadgeClass(notice.severity)">
                      {{ severityLabel(notice.severity) }}
                    </span>
                    <span
                      *ngIf="notice.unread"
                      class="inline-flex h-1.5 w-1.5 rounded-full bg-teal-500"
                      title="Sin leer"
                      aria-label="Sin leer"></span>
                  </div>
                  <h2 class="text-sm sm:text-base font-bold text-gray-900 dark:text-gray-100 leading-snug">
                    {{ noticeHeadline(notice) }}
                  </h2>
                  <p
                    *ngIf="noticeDetail(notice)"
                    class="text-xs sm:text-sm text-gray-600 dark:text-gray-400 leading-relaxed whitespace-pre-line">
                    {{ noticeDetail(notice) }}
                  </p>
                  <p *ngIf="noticeMeta(notice)" class="text-[11px] sm:text-xs text-gray-400">
                    {{ noticeMeta(notice) }}
                  </p>
                </div>

                <div
                  class="flex flex-col gap-2 sm:items-end sm:shrink-0 sm:min-w-[10.5rem]"
                  (click)="$event.stopPropagation()">
                  <ng-container *ngIf="canUseErpRoute(notice); else waAction">
                    <a
                      [routerLink]="notice.route!"
                      class="inline-flex w-full sm:w-auto items-center justify-center gap-1.5 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 min-h-11 sm:min-h-10"
                      (click)="onOpenNotice(notice)">
                      {{ primaryActionLabel(notice) }}
                    </a>
                  </ng-container>
                  <ng-template #waAction>
                    <a
                      [href]="whatsappManageHref(notice)"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="inline-flex w-full sm:w-auto items-center justify-center gap-1.5 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 min-h-11 sm:min-h-10"
                      (click)="onOpenNotice(notice)">
                      {{ primaryActionLabel(notice) }}
                    </a>
                  </ng-template>

                  <div class="flex flex-wrap items-center gap-x-3 gap-y-1 justify-center sm:justify-end text-xs">
                    <button
                      *ngIf="notice.status === 'open' && !isPaidLikeAction(notice)"
                      type="button"
                      class="font-medium text-gray-500 hover:text-teal-700 dark:hover:text-teal-300"
                      (click)="resolve(notice)">
                      Marcar resuelto
                    </button>
                    <button
                      *ngIf="notice.status === 'open'"
                      type="button"
                      class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                      (click)="hide(notice)">
                      Ocultar
                    </button>
                    <a
                      *ngIf="canUseErpRoute(notice) && notice.route && !isPrimaryDetail(notice)"
                      [routerLink]="notice.route"
                      class="text-gray-400 hover:text-teal-700 dark:hover:text-teal-300"
                      (click)="onOpenNotice(notice)">
                      Ver detalle
                    </a>
                  </div>
                </div>
              </div>
            </article>
          </li>
        </ul>

        <p class="text-center pt-1 text-[11px] text-gray-400">
          También en Configuración → RILO te avisa
        </p>
      </div>
    </div>
  `,
})
export class AvisosCenterComponent implements OnInit {
  private readonly api = inject(AutomationsService);
  private readonly addonsApi = inject(AddonsService);
  readonly auth = inject(AuthService);
  readonly pageShellClass = PAGE_SHELL_CLASS;
  readonly pageContentClass = PAGE_CONTENT_MAX_CLASS;
  readonly pageTitleClass = PAGE_TITLE_CLASS;
  readonly pageDescClass = PAGE_DESC_CLASS;

  readonly tabs: { id: ErpNoticesTab; label: string }[] = [
    { id: 'hoy', label: 'Hoy' },
    { id: 'proximos', label: 'Próximos' },
    { id: 'resueltos', label: 'Resueltos' },
  ];

  activeTab: ErpNoticesTab = 'hoy';
  notices: ErpNoticeDto[] = [];
  unreadCount = 0;
  loading = true;
  error = '';
  markingAll = false;
  private addons: AddonsSnapshot | null = null;
  private openedIds = new Set<string>();

  ngOnInit() {
    this.addonsApi.getSnapshot().subscribe({
      next: (snap) => {
        this.addons = snap;
      },
    });
    this.reload(true);
  }

  selectTab(tab: ErpNoticesTab) {
    if (this.activeTab === tab) return;
    this.activeTab = tab;
    this.reload(false);
  }

  reload(sync: boolean) {
    this.loading = true;
    this.error = '';
    this.api.listNotices({ tab: this.activeTab, sync }).subscribe({
      next: (res) => {
        const list = res.notices ?? [];
        this.notices =
          this.activeTab === 'proximos' ? this.sortByDueDate(list) : list;
        this.unreadCount = res.unreadCount ?? 0;
        this.loading = false;
      },
      error: () => {
        this.error = 'No se pudieron cargar los avisos.';
        this.loading = false;
      },
    });
  }

  /** Solo presentación: ordenar Próximos por fecha si el backend ya envía dueAt. */
  private sortByDueDate(list: ErpNoticeDto[]): ErpNoticeDto[] {
    return [...list].sort((a, b) => {
      const da = String(a.dueAt ?? '').slice(0, 10);
      const db = String(b.dueAt ?? '').slice(0, 10);
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return da.localeCompare(db);
    });
  }

  proximityGroupLabel(notice: ErpNoticeDto, index: number): string | null {
    if (this.activeTab !== 'proximos') return null;
    const label = this.dueGroupLabel(notice.dueAt);
    if (!label) return null;
    const prev = index > 0 ? this.dueGroupLabel(this.notices[index - 1]?.dueAt) : null;
    return label !== prev ? label : null;
  }

  private dueGroupLabel(dueAt?: string): string | null {
    const day = String(dueAt ?? '').trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const todayKey = `${y}-${m}-${d}`;
    if (day === todayKey) return 'Hoy';
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const ty = tomorrow.getFullYear();
    const tm = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const td = String(tomorrow.getDate()).padStart(2, '0');
    if (day === `${ty}-${tm}-${td}`) return 'Mañana';
    const end = new Date(today);
    end.setDate(end.getDate() + (7 - end.getDay()));
    const endKey = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    if (day > todayKey && day <= endKey) return 'Esta semana';
    return 'Más adelante';
  }

  canUseErpRoute(notice: ErpNoticeDto): boolean {
    if (!notice.route) return false;
    if (this.auth.isSummaryWebTenant) return false;
    return this.auth.canAccessErpWeb;
  }

  /** Presentación: título corto sin cambiar el DTO. */
  noticeHeadline(notice: ErpNoticeDto): string {
    const title = String(notice.title ?? '').trim();
    if (!title) return 'Aviso';
    const parts = title.split(/\s*·\s*/);
    if (parts.length >= 2) return parts[0]!.trim();
    return title;
  }

  noticeDetail(notice: ErpNoticeDto): string {
    const title = String(notice.title ?? '').trim();
    const parts = title.split(/\s*·\s*/);
    const fromTitle = parts.length >= 2 ? parts.slice(1).join(' · ').trim() : '';
    const body = String(notice.body ?? '').trim();
    if (fromTitle && body && !body.includes(fromTitle)) return `${fromTitle}\n${body}`;
    return fromTitle || body;
  }

  noticeMeta(notice: ErpNoticeDto): string {
    const bits: string[] = [];
    if (notice.dueAt) bits.push(`vence ${this.formatDue(notice.dueAt)}`);
    return bits.join(' · ');
  }

  primaryActionLabel(notice: ErpNoticeDto): string {
    const label = String(notice.actionLabel ?? '').trim();
    if (label) return label;
    if (this.canUseErpRoute(notice)) return 'Ver detalle';
    return 'Gestionar por WhatsApp';
  }

  isPaidLikeAction(notice: ErpNoticeDto): boolean {
    const label = this.primaryActionLabel(notice).toLowerCase();
    return /pagad|entregad|ajust|stock|cobr/.test(label);
  }

  isPrimaryDetail(notice: ErpNoticeDto): boolean {
    return /detalle|ver/i.test(this.primaryActionLabel(notice));
  }

  onOpenNotice(notice: ErpNoticeDto) {
    if (!notice.unread || this.openedIds.has(notice.id)) return;
    this.openedIds.add(notice.id);
    this.api.markRead(notice.id).subscribe({
      next: () => {
        notice.unread = false;
        notice.userReadAt = new Date().toISOString();
        this.unreadCount = Math.max(0, this.unreadCount - 1);
      },
    });
  }

  markAllAsRead() {
    this.markingAll = true;
    this.api.markAllRead().subscribe({
      next: () => {
        this.markingAll = false;
        this.unreadCount = 0;
        for (const n of this.notices) {
          n.unread = false;
        }
      },
      error: () => {
        this.markingAll = false;
      },
    });
  }

  resolve(notice: ErpNoticeDto) {
    this.api.updateNotice(notice.id, 'resolved').subscribe({
      next: () => {
        this.notices = this.notices.filter((n) => n.id !== notice.id);
      },
    });
  }

  hide(notice: ErpNoticeDto) {
    this.api.updateNotice(notice.id, 'hidden').subscribe({
      next: () => {
        this.notices = this.notices.filter((n) => n.id !== notice.id);
      },
    });
  }

  whatsappManageHref(notice: ErpNoticeDto): string {
    const title = String(notice.title ?? '').trim() || 'este aviso';
    const text = encodeURIComponent(`Quiero gestionar: ${title}`);
    const phone = this.riloWhatsappPhoneDigits();
    if (phone) return `https://wa.me/${phone}?text=${text}`;
    return `https://wa.me/?text=${text}`;
  }

  formatDue(dueAt: string): string {
    const raw = String(dueAt ?? '').trim();
    if (!raw) return '';
    const day = raw.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      const [y, m, d] = day.split('-');
      return `${d}/${m}/${y}`;
    }
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    return date.toLocaleDateString('es-AR');
  }

  severityLabel(severity?: RiloNoticeSeverity): string {
    if (severity === 'urgent') return 'Urgente';
    if (severity === 'info') return 'Info';
    return 'Atención';
  }

  severityBorderClass(severity?: RiloNoticeSeverity): string {
    if (severity === 'urgent') return 'border-l-[3px] border-l-rose-500 border-y border-r border-gray-200 dark:border-gray-800';
    if (severity === 'info') return 'border-l-[3px] border-l-teal-500 border-y border-r border-gray-200 dark:border-gray-800';
    return 'border-l-[3px] border-l-amber-500 border-y border-r border-gray-200 dark:border-gray-800';
  }

  severityBgClass(severity?: RiloNoticeSeverity): string {
    if (severity === 'urgent') return 'bg-rose-50/25 dark:bg-rose-950/15';
    if (severity === 'info') return '';
    return 'bg-amber-50/20 dark:bg-amber-950/10';
  }

  severityBadgeClass(severity?: RiloNoticeSeverity): string {
    if (severity === 'urgent') return 'bg-rose-100/90 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200';
    if (severity === 'info') return 'bg-gray-100 text-teal-800 dark:bg-gray-800 dark:text-teal-200';
    return 'bg-amber-100/90 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200';
  }

  private riloWhatsappPhoneDigits(): string {
    const lines = this.addons?.whatsapp?.lines ?? [];
    const preferred =
      lines.find((line) => line.kind === 'primary' && line.phone && line.status !== 'disconnected') ||
      lines.find((line) => line.phone && line.enabled && line.status !== 'disconnected') ||
      lines.find((line) => !!line.phone);
    return String(preferred?.phone ?? '')
      .trim()
      .replace(/\D+/g, '');
  }
}
