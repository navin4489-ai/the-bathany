import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ActivatedRoute, NavigationEnd, provideRouter, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Component, Injectable, LOCALE_ID, DEFAULT_CURRENCY_CODE, OnDestroy, NgZone, isDevMode, Input, Output, EventEmitter, inject, provideAppInitializer, ErrorHandler } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe, UpperCasePipe, registerLocaleData } from '@angular/common';
import localeIn from '@angular/common/locales/en-IN';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Observable, of, switchMap } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { timeout } from 'rxjs/operators';
import { provideServiceWorker } from '@angular/service-worker';
import { Offer, OfferBanners } from './offer-banners';
import { AppSessionClient, appSessionInterceptor, APP_SESSION_API_ORIGIN } from './app-session';
import { AdminPush, AdminPushControls } from './admin-push';
import { ActivityTracker, ShopperActivity } from './activity';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

registerLocaleData(localeIn);

export interface Product { id: number; name: string; description: string; price: number; stock: number; imageUrl: string; categoryId: number; }
export interface Line { product: Product; quantity: number; }

const fallback: Product[] = [
  { id: 1, name: 'Potion No. 04', description: 'Botanical bath ritual whipped with rose petals and moonlit florals.', price: 1299, stock: 100, imageUrl: 'assets/brand/product-1.jpeg', categoryId: 1 },
  { id: 2, name: 'Chai Spice Soul Whipped Soap', description: 'Warm cardamom, clove and vanilla in a cloud-soft whipped soap.', price: 4499, stock: 50, imageUrl: 'assets/brand/product-2.jpeg', categoryId: 2 },
  { id: 3, name: 'Raspberry Swirl Bath Cloud', description: 'Pure and whimsical whipped bath cloud, served with a wooden spoon.', price: 3299, stock: 30, imageUrl: 'assets/brand/product-3.jpeg', categoryId: 1 },
  { id: 4, name: 'Whipped Soap Boba', description: 'Rose and coconut whipped soap topped with cleansing boba pearls.', price: 2799, stock: 40, imageUrl: 'assets/brand/product-4.jpeg', categoryId: 2 }
];

/**
 * When the app is served by the API itself (production/tunnel), same-origin relative URLs are used.
 * The localhost:5000 fallback only applies to the Angular dev server on port 4200.
 */
export const API_ORIGIN = (typeof location !== 'undefined' && location.port === '4200') ? 'http://localhost:5000' : '';

/** Images stored in the database are returned as /api/... paths; resolve them against the API origin. */
export function imageSrc(url: string | null | undefined): string {
  if (!url) return 'assets/brand/logo.jpeg';
  if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return url;
  if (url.startsWith('/api/')) return API_ORIGIN + url;
  return url;
}

@Injectable({ providedIn: 'root' })
export class Api {
  private sessions = inject(AppSessionClient);
  private activity = inject(ActivityTracker);
  private readonly base = `${API_ORIGIN}/api`;
  constructor(private http: HttpClient) {}
  products(query = ''): Observable<Product[]> {
    return this.http.get<Product[]>(`${this.base}/catalog/products?search=${encodeURIComponent(query)}`)
      .pipe(timeout(4000), catchError(() => of(fallback)));
  }
  product(id: number): Observable<Product> {
    return this.http.get<Product>(`${this.base}/catalog/products/${id}`).pipe(timeout(4000), catchError(() => of(fallback.find(item => item.id === id) || fallback[0])));
  }
  private authHeaders() {
    const token = localStorage.getItem('token');
    return { Authorization: token ? `Bearer ${token}` : '' };
  }
  checkout(body: unknown) { return this.http.post(`${this.base}/checkout`, body, { headers: this.authHeaders() }); }
  paymentMethods() { return this.http.get<any>(`${this.base}/payments/methods`).pipe(timeout(4000), catchError(() => of({ methods: [], testCards: [] }))); }
  razorpayOrder(body: unknown) { return this.http.post<any>(`${this.base}/payments/razorpay/order`, body, { headers: this.authHeaders() }); }
  verifyRazorpay(body: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) {
    return this.http.post<{ success: boolean; captured: boolean }>(`${this.base}/verify-payment`, body, { headers: this.authHeaders() });
  }
  paymentHistory() { return this.http.get<any[]>(`${this.base}/payments/history`, { headers: this.authHeaders() }); }
  addresses() { return this.http.get<any[]>(`${this.base}/addresses`, { headers: this.authHeaders() }); }
  createAddress(body: unknown) { return this.http.post<any>(`${this.base}/addresses`, body, { headers: this.authHeaders() }); }
  updateAddress(id: number, body: unknown) { return this.http.put<any>(`${this.base}/addresses/${id}`, body, { headers: this.authHeaders() }); }
  setDefaultAddress(id: number) { return this.http.post<any>(`${this.base}/addresses/${id}/default`, {}, { headers: this.authHeaders() }); }
  deleteAddress(id: number) { return this.http.delete<any>(`${this.base}/addresses/${id}`, { headers: this.authHeaders() }); }
  orders() { return this.http.get<any[]>(`${this.base}/orders`, { headers: this.authHeaders() }); }
  admin(path: string) { return this.http.get<any>(`${this.base}/admin/${path}`, { headers: this.authHeaders() }); }
  adminNotifications(afterId: number | null) {
    const query = afterId === null ? '' : `?afterId=${afterId}`;
    return this.http.get<{ latestId: number; items: any[] }>(`${this.base}/admin/notifications${query}`, { headers: this.authHeaders() });
  }
  adminPost(path: string, body: unknown) { return this.http.post<any>(`${this.base}/admin/${path}`, body, { headers: this.authHeaders() }); }
  adminPut(path: string, body: unknown) { return this.http.put<any>(`${this.base}/admin/${path}`, body, { headers: this.authHeaders() }); }
  adminDelete(path: string) { return this.http.delete<any>(`${this.base}/admin/${path}`, { headers: this.authHeaders() }); }
  uploadProductImage(file: File) {
    const data = new FormData();
    data.append('file', file);
    return this.http.post<{ url: string }>(`${this.base}/admin/uploads/product-image`, data, { headers: this.authHeaders() });
  }
  uploadOfferImage(file: File) {
    const data = new FormData();
    data.append('file', file);
    return this.http.post<{ url: string }>(`${this.base}/admin/uploads/offer-image`, data, { headers: this.authHeaders() });
  }
  login(body: unknown) { return this.http.post<{ accessToken: string }>(`${this.base}/auth/login`, body); }
  logout() { return this.sessions.logout(); }
  /** Fire-and-forget: tracking must never block or break the shopper's action. */
  track(action: ShopperActivity, productId?: number, quantity?: number) {
    this.activity.record(action, productId, quantity);
  }
  register(body: unknown) { return this.http.post<{ id: number; email: string }>(`${this.base}/auth/register`, body); }
  forgotPassword(body: unknown) { return this.http.post<any>(`${this.base}/auth/forgot-password`, body); }
  resetPassword(body: unknown) { return this.http.post<any>(`${this.base}/auth/reset-password`, body); }
  changePassword(body: unknown) { return this.http.post<any>(`${this.base}/auth/change-password`, body, { headers: this.authHeaders() }); }
  adminResetPassword(id: number, body: unknown) { return this.http.post<any>(`${this.base}/admin/users/${id}/reset-password`, body, { headers: this.authHeaders() }); }
}

@Injectable({ providedIn: 'root' })
export class Auth {
  private sessions = inject(AppSessionClient);
  private decode(token: string): any {
    try { return JSON.parse(atob(token.split('.')[1])); } catch { return null; }
  }
  get token() { return localStorage.getItem('token'); }
  get claims() { const t = this.token; return t ? this.decode(t) : null; }
  get isLoggedIn() {
    const c = this.claims;
    if (!c) return false;
    if (c.exp && c.exp * 1000 < Date.now()) {
      if (this.sessions.keepSignedInWhileRenewing) return true;
      this.logout(); return false;
    }
    return true;
  }
  get displayName() {
    const c: any = this.claims;
    return c?.name || c?.unique_name || c?.email || c?.['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'] || 'Account';
  }
  get role() {
    const c: any = this.claims;
    return c?.role || c?.['http://schemas.microsoft.com/ws/2008/06/identity/claims/role'] || '';
  }
  get isAdmin() { return this.role === 'Admin'; }
  setToken(token: string) { localStorage.setItem('token', token); }
  logout() { localStorage.removeItem('token'); }
}

/**
 * Shared pager for every table. Works for server-paged data (bind total/page from the API envelope)
 * and client-side lists (bind the array length). Emits page and page-size changes; the owner fetches.
 */
@Component({
  selector: 'app-pager', standalone: true, imports: [CommonModule, FormsModule],
  template: `<div class="pager" *ngIf="total > 0">
    <span class="muted">{{ from }}–{{ to }} of {{ total }}</span>
    <div class="pager-controls">
      <button class="btn-light btn-sm" [disabled]="page <= 1" (click)="go(1)" aria-label="First page">«</button>
      <button class="btn-light btn-sm" [disabled]="page <= 1" (click)="go(page - 1)" aria-label="Previous page">‹</button>
      <ng-container *ngFor="let p of pagesToShow">
        <span *ngIf="p === 0" class="pager-gap">…</span>
        <button *ngIf="p !== 0" class="btn-light btn-sm" [class.active]="p === page" (click)="go(p)" [attr.aria-current]="p === page ? 'page' : null">{{ p }}</button>
      </ng-container>
      <button class="btn-light btn-sm" [disabled]="page >= pages" (click)="go(page + 1)" aria-label="Next page">›</button>
      <button class="btn-light btn-sm" [disabled]="page >= pages" (click)="go(pages)" aria-label="Last page">»</button>
    </div>
    <label class="muted pager-size">Rows
      <select [ngModel]="pageSize" (ngModelChange)="sizeChange.emit(+$event)">
        <option *ngFor="let s of sizes" [ngValue]="s">{{ s }}</option>
      </select>
    </label>
  </div>`
})
export class Pager {
  @Input() total = 0;
  @Input() page = 1;
  @Input() pageSize = 10;
  @Input() sizes = [10, 20, 50, 100];
  @Output() pageChange = new EventEmitter<number>();
  @Output() sizeChange = new EventEmitter<number>();
  get pages() { return Math.max(1, Math.ceil(this.total / this.pageSize)); }
  get from() { return this.total ? (this.page - 1) * this.pageSize + 1 : 0; }
  get to() { return Math.min(this.total, this.page * this.pageSize); }
  /** First, last and a window around the current page; 0 marks an ellipsis. */
  get pagesToShow() {
    const out: number[] = [];
    for (let p = 1; p <= this.pages; p++) {
      if (p === 1 || p === this.pages || Math.abs(p - this.page) <= 1) out.push(p);
      else if (out[out.length - 1] !== 0) out.push(0);
    }
    return out;
  }
  go(p: number) { if (p >= 1 && p <= this.pages && p !== this.page) this.pageChange.emit(p); }
}

/** Slices a local array for client-side paged tables. */
export function pageOf<T>(rows: T[], page: number, size: number): T[] { return rows.slice((page - 1) * size, page * size); }

@Injectable({ providedIn: 'root' })
export class Toast {
  message = '';
  private timer: ReturnType<typeof setTimeout> | undefined;
  show(message: string) {
    this.message = message;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.message = '', 2500);
  }
}

/**
 * Admin-only alert sound for new orders and customer activity.
 *
 * Browsers block audio until the user has interacted with the page, so the bell is unlocked on the
 * admin's first click/keypress and silently skipped until then. The tone is synthesised with the
 * Web Audio API rather than shipped as an asset, so it costs no download and no extra cache entry.
 * The admin can mute it; the preference is stored per device.
 */
@Injectable({ providedIn: 'root' })
export class AdminAlerts {
  enabled = localStorage.getItem('admin-alerts') !== 'off';
  private context: AudioContext | null = null;
  private unlocked = false;

  /** Must be called from a real user gesture before any sound can play. */
  unlock() {
    if (this.unlocked) return;
    const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.context = this.context || new Ctor();
      this.context!.resume();
      this.unlocked = true;
    } catch { this.unlocked = false; }
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    localStorage.setItem('admin-alerts', on ? 'on' : 'off');
    if (on) { this.unlock(); this.ring(); }
  }

  /** Two-tone bell with an exponential decay, so it reads as a notification rather than a beep. */
  ring() {
    if (!this.enabled || !this.unlocked || !this.context) return;
    const ctx = this.context;
    if (ctx.state === 'suspended') ctx.resume();
    [0, 0.18].forEach((offset, index) => {
      const at = ctx.currentTime + offset;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(index === 0 ? 988 : 1319, at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.3, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.42);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.45);
    });
  }
}

@Injectable({ providedIn: 'root' })
export class CartStore {
  lines: Line[] = JSON.parse(localStorage.getItem('cart-products') || '[]');
  constructor(private toast: Toast, private api: Api) {}
  save() { localStorage.setItem('cart-products', JSON.stringify(this.lines)); }
  add(product: Product) {
    const line = this.lines.find(item => item.product.id === product.id);
    line ? line.quantity++ : this.lines.push({ product, quantity: 1 });
    this.save();
    this.api.track('CartAdd', product.id, line ? line.quantity : 1);
    this.toast.show(`${product.name} added to your cart`);
  }
  remove(index: number) {
    const [removed] = this.lines.splice(index, 1);
    this.save();
    if (removed) { this.api.track('CartRemove', removed.product.id); this.toast.show(`${removed.product.name} removed from your cart`); }
  }
  total() { return this.lines.reduce((sum, item) => sum + item.product.price * item.quantity, 0); }
}

@Injectable({ providedIn: 'root' })
export class WishlistStore {
  items: Product[] = JSON.parse(localStorage.getItem('wishlist-products') || '[]');
  constructor(private toast: Toast, private api: Api) {}
  private save() { localStorage.setItem('wishlist-products', JSON.stringify(this.items)); }
  has(id: number) { return this.items.some(p => p.id === id); }
  /** Toggling keeps a single heart control in the UI for both add and remove. */
  toggle(product: Product) {
    const index = this.items.findIndex(p => p.id === product.id);
    if (index >= 0) {
      this.items.splice(index, 1);
      this.api.track('WishlistRemove', product.id);
      this.toast.show(`${product.name} removed from your wishlist`);
    } else {
      this.items.push(product);
      this.api.track('WishlistAdd', product.id);
      this.toast.show(`${product.name} saved to your wishlist`);
    }
    this.save();
  }
  remove(id: number) {
    const index = this.items.findIndex(p => p.id === id);
    if (index < 0) return;
    const [removed] = this.items.splice(index, 1);
    this.save();
    this.toast.show(`${removed.name} removed from your wishlist`);
  }
  clear() { this.items = []; this.save(); }
}

@Component({
  standalone: true, imports: [CommonModule, CurrencyPipe, RouterLink],
  template: `
    <div class="page">
      <div class="section-heading"><h1>Wishlist</h1><a routerLink="/shop" class="muted">Continue shopping →</a></div>
      <p *ngIf="!wishlist.items.length" class="muted">
        Your wishlist is empty. Tap the ♡ on any product to save it for later.
      </p>
      <div class="grid">
        <article class="product-card" *ngFor="let product of wishlist.items">
          <a [routerLink]="['/detail', product.id]"><img [src]="img(product.imageUrl)" [alt]="product.name"></a>
          <div class="product-info">
            <h3><a [routerLink]="['/detail', product.id]">{{ product.name }}</a></h3>
            <p>{{ product.description }}</p>
            <span class="price">{{ product.price | currency }}</span>
            <div class="wish-actions">
              <button class="btn-primary" (click)="cart.add(product)">Add to cart</button>
              <button class="btn-light" (click)="wishlist.remove(product.id)">Remove</button>
            </div>
          </div>
        </article>
      </div>
    </div>
  `
})
export class Wishlist {
  img = imageSrc;
  constructor(public wishlist: WishlistStore, public cart: CartStore) {}
}

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

@Injectable({ providedIn: 'root' })
export class AppInstall {
  promptEvent: InstallPromptEvent | null = null;
  installed = window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && navigator.standalone === true);

  constructor() {
    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault();
      this.promptEvent = event as InstallPromptEvent;
    });
    window.addEventListener('appinstalled', () => {
      this.promptEvent = null;
      this.installed = true;
    });
  }

  async install(): Promise<string> {
    if (!this.promptEvent) return 'Open Chrome’s menu and choose Install app or Add to Home screen.';
    const prompt = this.promptEvent;
    this.promptEvent = null;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    return choice.outcome === 'accepted' ? 'The Bathany is being added to your phone.' : 'Installation cancelled. You can try again from your browser menu.';
  }
}

@Component({
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="page install-page">
      <span class="eyebrow">The Bathany on your phone</span>
      <h1>Take your bath rituals with you.</h1>
      <p>Install our mobile web app directly from bathany.com. It opens from your home screen; no app store or download file is needed.</p>
      <div class="install-tabs">
        <a routerLink="/install/android" [class.active]="!ios">Android</a>
        <a routerLink="/install/ios" [class.active]="ios">iPhone &amp; iPad</a>
      </div>
      <div class="install-card">
        <img src="icons/icon-192x192.png" alt="The Bathany app icon" width="80" height="80">
        <div *ngIf="installService.installed">
          <h2>Already installed</h2>
          <p>The Bathany is ready on this device. <a routerLink="/shop">Browse the collection</a>.</p>
        </div>
        <ng-container *ngIf="!installService.installed && !ios">
          <h2>Install on Android</h2>
          <button *ngIf="installService.promptEvent" class="btn-primary" type="button" (click)="installAndroid()">Install The Bathany</button>
          <p *ngIf="message" role="status">{{ message }}</p>
          <ol>
            <li>Open <strong>bathany.com</strong> in Chrome on your Android phone.</li>
            <li>Tap <strong>Install The Bathany</strong> above if available, or open Chrome's menu (⋮) and select <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
            <li>Confirm the installation, then open The Bathany from your home screen.</li>
          </ol>
        </ng-container>
        <ng-container *ngIf="!installService.installed && ios">
          <h2>Install on iPhone or iPad</h2>
          <ol>
            <li>Open <strong>bathany.com</strong> in Safari on your iPhone or iPad.</li>
            <li>Tap Safari's <strong>Share</strong> button, then select <strong>Add to Home Screen</strong>. If it is not visible, scroll the Share menu.</li>
            <li>Tap <strong>Add</strong>. The Bathany icon appears on your home screen.</li>
          </ol>
          <p>Apple does not offer an automatic install prompt in Safari. Use the steps above rather than an App Store link.</p>
        </ng-container>
      </div>
      <p class="muted">An internet connection is required for product availability, sign-in and checkout. Payments are currently for testing only.</p>
    </div>
  `
})
export class InstallGuide {
  ios = false;
  message = '';
  constructor(route: ActivatedRoute, public installService: AppInstall) {
    route.paramMap.pipe(takeUntilDestroyed()).subscribe(params => {
      this.ios = params.get('platform') === 'ios';
      this.message = '';
    });
  }
  async installAndroid() {
    try {
      this.message = await this.installService.install();
    } catch {
      this.message = 'Installation could not start. Open Chrome’s menu and select Install app or Add to Home screen.';
    }
  }
}

@Component({
  selector: 'app-root', standalone: true, imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="topbar">
      <span>Handcrafted in India · Free shipping over ₹999</span>
      <span class="topbar-links">
        <a routerLink="/rituals">Our Rituals</a><a routerLink="/ingredients">Ingredients</a><a routerLink="/care">Care</a><a routerLink="/about">About Us</a>
      </span>
      <span class="topbar-account">
        <ng-container *ngIf="!auth.isLoggedIn"><a routerLink="/login">Login</a><a routerLink="/register">Sign up</a></ng-container>
        <ng-container *ngIf="auth.isLoggedIn"><a routerLink="/orders">My account</a><a href="#" (click)="logout($event)">Sign out</a></ng-container>
      </span>
    </div>
    <header class="site-header">
      <button class="nav-toggle" (click)="menuOpen = !menuOpen" [attr.aria-expanded]="menuOpen" aria-label="Toggle menu">
        <span></span><span></span><span></span>
      </button>
      <a class="brand" routerLink="/">
        <img class="brand-logo" src="assets/brand/logo.jpeg" alt="The Bathany">
        <span class="brand-text"><span class="brand-name">The Bathany</span><span class="brand-tagline">Botanical Bath Rituals</span></span>
      </a>
      <div class="search"><input #headerSearch (keyup.enter)="searchCollection(headerSearch.value)" placeholder="Search whipped soaps, potions, bath clouds…"><button aria-label="Search" (click)="searchCollection(headerSearch.value)">⌕</button></div>
      <div class="header-actions">
        <a class="wishlist" routerLink="/wishlist">♡ Wishlist ({{ wishlist.items.length }})</a>
        <a routerLink="/cart">🛒 Cart ({{ cart.lines.length }})</a>
        <span class="account" *ngIf="!auth.isLoggedIn"><a class="btn-light btn-sm" routerLink="/login">Login</a><a class="btn-primary btn-sm" routerLink="/register">Sign up</a></span>
        <span class="account" *ngIf="auth.isLoggedIn"><span class="account-name">👤 {{ auth.displayName }}</span><button class="btn-light btn-sm" (click)="logout()">Sign out</button></span>
      </div>
    </header>
    <nav class="nav" [class.open]="menuOpen" (click)="menuOpen = false">
      <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{exact:true}">Home</a>
      <a routerLink="/shop" routerLinkActive="active">Shop</a>
      <a routerLink="/rituals" routerLinkActive="active">Our Rituals</a>
      <a routerLink="/ingredients" routerLinkActive="active">Ingredients</a>
      <a routerLink="/care" routerLinkActive="active">Care</a>
      <a routerLink="/about" routerLinkActive="active">About Us</a>
      <a *ngIf="auth.isLoggedIn" routerLink="/orders" routerLinkActive="active">My Orders</a>
      <a *ngIf="!auth.isLoggedIn" routerLink="/login" routerLinkActive="active">Login</a>
      <a *ngIf="!auth.isLoggedIn" routerLink="/register" routerLinkActive="active">Sign up</a>
      <a *ngIf="auth.isAdmin" routerLink="/admin" routerLinkActive="active">Admin</a>
    </nav>
    <main><router-outlet></router-outlet></main>
    <p class="pay-error page" *ngIf="sessions.state() === 'unavailable'" role="alert">Your app session could not be renewed. Check your connection and try again. You have not been signed out.</p>
    <p class="pay-error page" *ngIf="logoutError" role="alert">{{ logoutError }} <button class="link-btn" [disabled]="signingOut" (click)="logout()">Retry sign out</button></p>
    <div class="toast" role="status" aria-live="polite" *ngIf="toast.message">✓ {{ toast.message }}</div>
    <footer class="site-footer">
      <div class="footer-brand">
        <img class="footer-logo" src="assets/brand/logo.jpeg" alt="The Bathany">
        <div><strong>The Bathany</strong><span>Small-batch bath rituals, handcrafted in India.</span></div>
      </div>
      <div class="footer-install">
        <strong>Take The Bathany with you</strong>
        <span>Install our mobile web app on your home screen.</span>
        <div class="footer-install-actions">
          <a routerLink="/install/android" aria-label="Install on Android" title="Install on Android">
            <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m9 4 2 3m12-3-2 3M6 15a10 10 0 0 1 20 0v8H6zM6 16H3v8m23-8h3v8M11 23v5m10-5v5"/>
              <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="20" cy="12" r="1" fill="currentColor" stroke="none"/>
            </svg>
          </a>
          <a routerLink="/install/ios" aria-label="Install on iPhone" title="Install on iPhone">
            <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="8" y="2" width="16" height="28" rx="3"/>
              <path d="M14 6h4m-3 20h2"/>
            </svg>
          </a>
        </div>
      </div>
      <div class="footer-note"><span class="footer-links"><a routerLink="/rituals">Our Rituals</a><a routerLink="/ingredients">Ingredients</a><a routerLink="/care">Care</a><a routerLink="/about">About Us</a><a routerLink="/contact">Contact Us</a></span><span>All natural · Cruelty free · Sulfate free · Paraben free</span><span>© {{ year }} The Bathany. Secure checkout.</span></div>
    </footer>
  `
})
export class App {
  year = new Date().getFullYear();
  menuOpen = false;
  signingOut = false;
  logoutError = '';
  sessions = inject(AppSessionClient);
  private adminPush = inject(AdminPush);
  constructor(public cart: CartStore, public toast: Toast, public auth: Auth, public wishlist: WishlistStore, public installService: AppInstall, private router: Router, private api: Api, activity: ActivityTracker) {
    this.router.events.pipe(takeUntilDestroyed()).subscribe(event => {
      if (event instanceof NavigationEnd) {
        const path = event.urlAfterRedirects.split(/[?#]/)[0];
        if (/^\/detail\/\d+$/.test(path)) activity.record('ProductView', Number(path.split('/')[2]));
        else activity.record('PageView', undefined, undefined, path);
      }
    });
  }
  async logout(event?: Event) {
    event?.preventDefault();
    if (this.signingOut) return;
    this.signingOut = true;
    this.logoutError = '';
    try {
      if (this.auth.isAdmin) await this.adminPush.disableForLogout();
    } catch (error) {
      console.error('Unable to remove this device notification subscription', error);
      this.logoutError = 'Could not disable this device notifications. Sign out was not completed; please retry.';
      this.signingOut = false;
      return;
    }
    this.api.logout().subscribe({
      next: () => { this.signingOut = false; this.toast.show('You have been signed out'); this.router.navigateByUrl('/'); },
      error: () => {
        this.signingOut = false;
        this.logoutError = 'Signed out on this device, but the server could not revoke the session. Reconnect and retry sign out.';
        this.router.navigateByUrl('/');
      }
    });
  }
  searchCollection(query: string) {
    this.router.navigate(['/shop'], { queryParams: { search: query.trim() } });
  }
}

@Component({
  standalone: true, imports: [CommonModule, FormsModule, CurrencyPipe, RouterLink, OfferBanners],
  template: `
    <div class="page">
      <section class="hero">
        <div>
          <div class="eyebrow">Botanical Bath Rituals</div>
          <h1>Whipped soaps,<br>made to be savoured.</h1>
          <p>Small-batch bath cloud, potions and whipped soap — blended by hand in India with rose, coconut and warm chai spice. All natural, cruelty free and endlessly whimsical.</p>
          <button class="btn-primary" (click)="scrollToCollection()">Shop the collection</button>
        </div>
        <div class="hero-carousel">
          <img *ngFor="let slide of slides; let i = index" [src]="slide" [class.active]="i === activeSlide" alt="The Bathany collection">
          <div class="carousel-dots">
            <button *ngFor="let slide of slides; let i = index" [class.active]="i === activeSlide"
              (click)="goToSlide(i)" [attr.aria-label]="'Show image ' + (i + 1)"></button>
          </div>
        </div>
      </section>
      <section class="promise">
        <div><strong>All Natural</strong><span>Botanical oils &amp; butters</span></div>
        <div><strong>Cruelty Free</strong><span>Never tested on animals</span></div>
        <div><strong>Sulfate Free</strong><span>Gentle on every skin type</span></div>
        <div><strong>Handcrafted</strong><span>Whipped in small batches</span></div>
      </section>
      <app-offer-banners [apiOrigin]="apiOrigin"></app-offer-banners>
      <div class="section-heading" id="collection"><h2>The collection</h2><span class="muted">Four rituals, endlessly whimsical</span></div>
      <div class="toolbar"><input [(ngModel)]="query" (ngModelChange)="search()" placeholder="Search the collection"></div>
      <section class="grid"><article class="product-card" *ngFor="let p of products"><a [routerLink]="['/detail', p.id]"><img [src]="img(p.imageUrl)" [alt]="p.name"></a><button class="wish-btn" [class.on]="wishlist.has(p.id)" (click)="wishlist.toggle(p)" [attr.aria-pressed]="wishlist.has(p.id)" [attr.aria-label]="(wishlist.has(p.id) ? 'Remove ' + p.name + ' from wishlist' : 'Save ' + p.name + ' to wishlist')">{{ wishlist.has(p.id) ? '♥' : '♡' }}</button><div class="product-info"><h3><a [routerLink]="['/detail', p.id]">{{ p.name }}</a></h3><p>{{ p.description }}</p><span class="price">{{ p.price | currency }}</span><button class="btn-primary" (click)="cart.add(p)">Add to cart</button></div></article></section>
    </div>
  `
})
export class Shop implements OnDestroy {
  apiOrigin = API_ORIGIN;
  products: Product[] = []; query = '';
  slides = ['assets/brand/product-4.jpeg', 'assets/brand/product-1.jpeg', 'assets/brand/product-3.jpeg', 'assets/brand/product-2.jpeg'];
  activeSlide = 0;
  private timer?: ReturnType<typeof setInterval>;
  private searchTimer?: ReturnType<typeof setTimeout>;
  constructor(private api: Api, public cart: CartStore, public wishlist: WishlistStore, route: ActivatedRoute) {
    route.queryParamMap.pipe(takeUntilDestroyed()).subscribe(params => {
      this.query = params.get('search') || '';
      this.search();
    });
    this.startCarousel();
  }
  load() { this.api.products(this.query).subscribe(products => this.products = products); }
  search() {
    this.load();
    clearTimeout(this.searchTimer);
    if (this.query.trim()) this.searchTimer = setTimeout(() => this.api.track('Search'), 600);
  }
  img = imageSrc;
  scrollToCollection() { document.getElementById('collection')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  private startCarousel() { this.timer = setInterval(() => this.activeSlide = (this.activeSlide + 1) % this.slides.length, 4000); }
  goToSlide(index: number) {
    this.activeSlide = index;
    if (this.timer) clearInterval(this.timer);
    this.startCarousel();
  }
  ngOnDestroy() { if (this.timer) clearInterval(this.timer); clearTimeout(this.searchTimer); }
}

@Component({
  standalone: true, imports: [CommonModule, CurrencyPipe, RouterLink],
  template: `<div class="page" *ngIf="product"><div class="hero"><img [src]="img(product.imageUrl)" [alt]="product.name"><div><div class="eyebrow">The Bathany</div><h1>{{ product.name }}</h1><p>{{ product.description }}</p><span class="price">{{ product.price | currency }}</span><ul class="detail-points"><li>All natural botanical blend</li><li>Cruelty free · Sulfate free · Paraben free</li><li>Handcrafted in small batches in India</li></ul><div class="detail-actions"><button class="btn-primary" (click)="cart.add(product)">Add to cart</button><button class="btn-light wish-inline" [class.on]="wishlist.has(product.id)" (click)="wishlist.toggle(product)" [attr.aria-pressed]="wishlist.has(product.id)">{{ wishlist.has(product.id) ? '♥ Saved' : '♡ Add to wishlist' }}</button></div></div></div><a routerLink="/shop">← Back to the collection</a></div>`
})
export class Detail {
  product!: Product;
  img = imageSrc;
  constructor(private api: Api, private route: ActivatedRoute, public cart: CartStore, public wishlist: WishlistStore) {
    this.route.paramMap.pipe(
      switchMap(params => this.api.product(Number(params.get('id')) || 1)),
      takeUntilDestroyed()
    ).subscribe(product => this.product = product);
  }
}

@Component({
  standalone: true, imports: [CommonModule, FormsModule, CurrencyPipe, UpperCasePipe, RouterLink],
  template: `
    <div class="page"><div class="section-heading"><h1>Shopping cart</h1><a routerLink="/" class="muted">Continue shopping →</a></div>
      <p *ngIf="!cart.lines.length" class="muted">Your cart is empty. Add something you love.</p>
      <div *ngFor="let line of cart.lines; let i=index" class="cart-row"><strong>{{ line.product.name }}</strong><input type="number" min="1" [(ngModel)]="line.quantity" (ngModelChange)="cart.save()" (change)="trackQuantity(line)"><span>{{ line.product.price * line.quantity | currency }}</span><button class="btn-light" (click)="cart.remove(i)">Remove</button></div>
      <div class="summary"><div class="summary-line"><span>Subtotal</span><strong>{{ cart.total() | currency }}</strong></div><div class="summary-line"><span>Shipping</span><span>Free</span></div><hr><div class="summary-line"><strong>Total</strong><strong class="price">{{ cart.total() | currency }}</strong></div>
        <div class="ship-panel">
          <div class="pay-brand"><span class="ship-badge">Delivery</span><strong>Shipping address</strong></div>

          <div *ngIf="savedAddresses.length && !showAddressForm">
            <p class="muted pay-note">Choose where we should deliver this order.</p>
            <div class="address-list">
              <button type="button" class="address-card" *ngFor="let a of savedAddresses"
                      [class.selected]="selectedAddressId === a.id" (click)="selectAddress(a)">
                <span class="address-card-head">
                  <strong>{{ a.fullName }}</strong>
                  <span class="address-default" *ngIf="a.isDefault">Default</span>
                </span>
                <span class="muted">{{ a.phone }}<br>
                  {{ a.line1 }}<span *ngIf="a.line2">, {{ a.line2 }}</span><br>
                  <span *ngIf="a.landmark">{{ a.landmark }}<br></span>
                  {{ a.city }}, {{ a.state }} {{ a.postalCode }}</span>
                <span class="address-card-actions">
                  <span class="link-btn" *ngIf="!a.isDefault" (click)="makeDefault(a, $event)">Set as default</span>
                  <span class="link-btn" (click)="editAddress(a, $event)">Edit</span>
                  <span class="link-btn" (click)="removeAddress(a, $event)">Remove</span>
                </span>
              </button>
            </div>
            <button type="button" class="btn-light add-address" (click)="newAddress()">+ Add new address</button>
          </div>

          <div *ngIf="!savedAddresses.length || showAddressForm">
            <p class="muted pay-note">{{ editingAddressId ? 'Update this address.' : 'Where should we deliver this order?' }}</p>
            <div class="checkout-field"><label>Full name *</label><input [(ngModel)]="address.fullName" placeholder="Riya Sharma"></div>
            <div class="checkout-field"><label>Phone *</label><input [(ngModel)]="address.phone" (ngModelChange)="formatPhone($event)" placeholder="9876543210" maxlength="10" inputmode="numeric"></div>
            <div class="checkout-field"><label>Address line 1 *</label><input [(ngModel)]="address.line1" placeholder="Flat / House no., Building, Street"></div>
            <div class="checkout-field"><label>Address line 2</label><input [(ngModel)]="address.line2" placeholder="Area, Colony (optional)"></div>
            <div class="checkout-field"><label>Landmark</label><input [(ngModel)]="address.landmark" placeholder="Near… (optional)"></div>
            <div class="pay-row">
              <div class="checkout-field"><label>City *</label><input [(ngModel)]="address.city" placeholder="Pune"></div>
              <div class="checkout-field"><label>State *</label>
                <select [(ngModel)]="address.state">
                  <option value="">Select state</option>
                  <option *ngFor="let s of states" [value]="s">{{ s }}</option>
                </select>
              </div>
            </div>
            <div class="pay-row">
              <div class="checkout-field"><label>PIN code *</label><input [(ngModel)]="address.postalCode" (ngModelChange)="formatPin($event)" placeholder="411001" maxlength="6" inputmode="numeric"></div>
              <div class="checkout-field"><label>Country</label><input [(ngModel)]="address.country" readonly></div>
            </div>
            <label class="ship-save"><input type="checkbox" [(ngModel)]="makeAddressDefault"> Use this as my default address</label>
            <div class="address-form-actions">
              <button type="button" class="btn-primary" [disabled]="savingAddress" (click)="saveAddress()">{{ savingAddress ? 'Saving…' : (editingAddressId ? 'Update address' : 'Save address') }}</button>
              <button type="button" class="btn-light" *ngIf="savedAddresses.length" (click)="cancelAddressForm()">Cancel</button>
            </div>
            <p class="pay-error" *ngIf="addressMessage">{{ addressMessage }}</p>
          </div>
        </div>
        <div class="pay-panel">
          <div class="pay-brand"><span class="pay-badge">{{ !methods.length ? 'Unavailable' : razorpayEnabled ? (sandbox ? 'Test mode' : 'Secure') : 'Sandbox' }}</span><strong>{{ !methods.length ? 'Payments unavailable' : razorpayEnabled ? 'Razorpay Secure Checkout' : 'The Bathany Secure Pay' }}</strong></div>
          <p class="muted pay-note" *ngIf="methods.length && !razorpayEnabled">No real money moves. Use a test card below to simulate results.</p>

          <div class="pay-methods" *ngIf="methods.length > 1">
            <button type="button" class="pay-method" *ngFor="let m of methods" [class.selected]="method === m.code" (click)="method = m.code">
              <strong>{{ m.label }}</strong><span class="muted">{{ m.description }}</span>
            </button>
          </div>

          <div *ngIf="isRazorpay()" class="pay-online">
            <p class="muted pay-note">You'll be taken to Razorpay's secure window to pay by UPI, card, netbanking or wallet.</p>
            <details class="pay-testcards" *ngIf="sandbox">
              <summary>Test payment details</summary>
              <p class="muted">Razorpay test mode — no real money moves. Use UPI id <strong>success&#64;razorpay</strong>, or card <strong>4111 1111 1111 1111</strong> with any future expiry and any CVV.</p>
            </details>
          </div>

          <div *ngIf="requiresCard()">
            <div class="checkout-field"><label>Card number</label><input [(ngModel)]="card.number" (ngModelChange)="formatCard($event)" placeholder="4242 4242 4242 4242" maxlength="23" inputmode="numeric"></div>
            <div class="checkout-field"><label>Cardholder name</label><input [(ngModel)]="card.holderName" placeholder="Jane Doe"></div>
            <div class="pay-row">
              <div class="checkout-field"><label>Expiry (MM/YYYY)</label><input [(ngModel)]="card.expiry" placeholder="12/2030" maxlength="7"></div>
              <div class="checkout-field"><label>CVV</label><input [(ngModel)]="card.cvv" placeholder="123" maxlength="4" inputmode="numeric"></div>
            </div>
            <details class="pay-testcards">
              <summary>Test cards</summary>
              <table class="order-items"><tbody>
                <tr *ngFor="let c of testCards"><td><button type="button" class="link-btn" (click)="useTestCard(c.number)">{{ c.number }}</button></td><td>{{ c.description }}</td></tr>
              </tbody></table>
            </details>
          </div>

          <p class="pay-error" *ngIf="!methods.length">{{ paymentUnavailable }}</p>
          <button class="btn-primary pay-submit" [disabled]="!cart.lines.length || placing || !methods.length" (click)="checkout()">{{ placing ? 'Processing payment…' : 'Pay ' + (cart.total() | currency) }}</button>
          <p class="pay-error" *ngIf="message">{{ message }}</p>
        </div>
      </div>
    </div>
    <div class="modal-backdrop" *ngIf="confirmed" (click)="close()">
      <div class="order-modal" (click)="$event.stopPropagation()">
        <img class="modal-crest" src="assets/brand/logo.jpeg" alt="The Bathany">
        <div class="order-modal-check success-pop">✓</div>
        <h2>Congratulations — your payment was successful!</h2>
        <p class="muted">Order <strong>#{{ confirmed.id }}</strong> is confirmed and payment was {{ confirmed.payment?.status || confirmed.status }}.</p>
        <p class="muted pay-receipt" *ngIf="confirmed.payment">
          {{ confirmed.payment.cardLast4 ? confirmed.payment.cardBrand + ' •••• ' + confirmed.payment.cardLast4 : (confirmed.payment.method | uppercase) }}
          · Ref {{ confirmed.payment.transactionId }}
        </p>
        <table class="order-items">
          <tbody>
            <tr *ngFor="let item of confirmed.items"><td>{{ item.productName }} × {{ item.quantity }}</td><td>{{ item.unitPrice * item.quantity | currency }}</td></tr>
          </tbody>
        </table>
        <div class="order-modal-total"><span>Total paid</span><strong class="price">{{ confirmed.total | currency }}</strong></div>
        <div class="modal-ship" *ngIf="confirmed.shippingAddress">
          <strong>Delivering to</strong>
          <p class="muted">{{ confirmed.shippingAddress.fullName }} · {{ confirmed.shippingAddress.phone }}<br>
            {{ confirmed.shippingAddress.line1 }}<span *ngIf="confirmed.shippingAddress.line2">, {{ confirmed.shippingAddress.line2 }}</span><br>
            <span *ngIf="confirmed.shippingAddress.landmark">{{ confirmed.shippingAddress.landmark }}<br></span>
            {{ confirmed.shippingAddress.city }}, {{ confirmed.shippingAddress.state }} {{ confirmed.shippingAddress.postalCode }}<br>
            {{ confirmed.shippingAddress.country }}</p>
        </div>
        <p class="redirect-note" *ngIf="redirectIn > 0" role="status">Taking you to your orders in {{ redirectIn }}s… <button type="button" class="link-btn" (click)="stayHere()">Stay here</button></p>
        <div class="order-modal-actions"><button class="btn-primary" (click)="goToOrders()">View my orders</button><button class="btn-light" (click)="close()">Continue shopping</button></div>
      </div>
    </div>
  `
})
export class Cart implements OnDestroy {
  paymentToken = 'test_approved'; message = ''; placing = false; confirmed: any = null;
  redirectIn = 0;
  private redirectTimer: any = null;
  method = 'card';
  card = { number: '', holderName: '', expiry: '', cvv: '' };
  address = { fullName: '', phone: '', line1: '', line2: '', landmark: '', city: '', state: '', postalCode: '', country: 'India' };
  savedAddresses: any[] = [];
  selectedAddressId: number | null = null;
  editingAddressId: number | null = null;
  showAddressForm = false;
  makeAddressDefault = false;
  savingAddress = false;
  addressMessage = '';
  states = ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Delhi','Goa','Gujarat','Haryana','Himachal Pradesh','Jammu & Kashmir','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Puducherry','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal'];
  methods: any[] = [];
  paymentUnavailable = 'Payment options are unavailable. Please refresh and try again.';
  testCards: any[] = [];
  razorpayEnabled = false;
  sandbox = false;
  private razorpayKeyId = '';
  private static sdk: Promise<boolean> | null = null;
  constructor(public cart: CartStore, private api: Api, private auth: Auth, private router: Router, private zone: NgZone) {
    this.loadAddresses();
    this.api.paymentMethods().subscribe(res => {
      this.methods = res?.methods || [];
      this.paymentUnavailable = res?.unavailableMessage || 'Payment options are unavailable. Please refresh and try again.';
      this.testCards = res?.testCards || [];
      this.razorpayEnabled = !!res?.razorpayEnabled;
      this.sandbox = res?.sandbox === true;
      this.razorpayKeyId = res?.razorpayKeyId || '';
      // Default to online payment when it is available, since that is the real gateway.
      this.method = this.methods.find(m => m.code === 'razorpay')?.code || this.methods[0]?.code || '';
      if (this.razorpayEnabled) Cart.loadRazorpay();
    });
  }
  isRazorpay() { return this.method === 'razorpay'; }
  requiresCard() { return this.methods.find(m => m.code === this.method)?.requiresCard ?? this.method === 'card'; }

  /** Pulls the shopper's address book and preselects their default. */
  private loadAddresses(selectId: number | null = null) {
    if (!this.auth.isLoggedIn) return;
    this.api.addresses().subscribe({
      next: rows => {
        this.savedAddresses = rows || [];
        const pick = this.savedAddresses.find(a => a.id === selectId)
          ?? this.savedAddresses.find(a => a.id === this.selectedAddressId)
          ?? this.savedAddresses.find(a => a.isDefault)
          ?? this.savedAddresses[0];
        if (pick) { this.selectAddress(pick); this.showAddressForm = false; }
        else { this.showAddressForm = true; this.selectedAddressId = null; }
      },
      // An unreachable address book should still allow a one-off address to be typed in.
      error: () => { this.savedAddresses = []; this.showAddressForm = true; }
    });
  }

  selectAddress(a: any) {
    this.selectedAddressId = a.id;
    this.address = {
      fullName: a.fullName, phone: a.phone, line1: a.line1, line2: a.line2 || '',
      landmark: a.landmark || '', city: a.city, state: a.state, postalCode: a.postalCode, country: a.country || 'India'
    };
    this.message = '';
  }

  newAddress() {
    this.editingAddressId = null;
    this.showAddressForm = true;
    this.addressMessage = '';
    this.makeAddressDefault = this.savedAddresses.length === 0;
    this.address = { fullName: '', phone: '', line1: '', line2: '', landmark: '', city: '', state: '', postalCode: '', country: 'India' };
  }

  editAddress(a: any, event: Event) {
    event.stopPropagation();
    this.selectAddress(a);
    this.editingAddressId = a.id;
    this.makeAddressDefault = !!a.isDefault;
    this.addressMessage = '';
    this.showAddressForm = true;
  }

  cancelAddressForm() {
    this.showAddressForm = false;
    this.editingAddressId = null;
    this.addressMessage = '';
    const current = this.savedAddresses.find(a => a.id === this.selectedAddressId) ?? this.savedAddresses[0];
    if (current) this.selectAddress(current);
  }

  saveAddress() {
    const error = this.validateAddress();
    if (error) { this.addressMessage = error; return; }
    this.savingAddress = true; this.addressMessage = '';
    const body = { ...this.address, isDefault: this.makeAddressDefault };
    const request = this.editingAddressId
      ? this.api.updateAddress(this.editingAddressId, body)
      : this.api.createAddress(body);
    request.subscribe({
      next: saved => {
        this.savingAddress = false;
        this.editingAddressId = null;
        this.showAddressForm = false;
        this.loadAddresses(saved?.id ?? null);
      },
      error: err => {
        this.savingAddress = false;
        this.addressMessage = err.error?.detail || 'Could not save this address. Please try again.';
      }
    });
  }

  makeDefault(a: any, event: Event) {
    event.stopPropagation();
    this.api.setDefaultAddress(a.id).subscribe({
      next: () => this.loadAddresses(a.id),
      error: () => this.addressMessage = 'Could not update your default address.'
    });
  }

  removeAddress(a: any, event: Event) {
    event.stopPropagation();
    if (!confirm(`Remove the address for ${a.fullName}?`)) return;
    this.api.deleteAddress(a.id).subscribe({
      next: () => {
        if (this.selectedAddressId === a.id) this.selectedAddressId = null;
        this.loadAddresses();
      },
      error: () => this.addressMessage = 'Could not remove this address.'
    });
  }

  /** Loads Razorpay's widget once and reuses the same promise for later attempts. */
  private static loadRazorpay(): Promise<boolean> {
    if (Cart.sdk) return Cart.sdk;
    Cart.sdk = new Promise<boolean>(resolve => {
      if ((window as any).Razorpay) { resolve(true); return; }
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      script.onload = () => resolve(true);
      script.onerror = () => { Cart.sdk = null; resolve(false); };
      document.head.appendChild(script);
    });
    return Cart.sdk;
  }
  formatCard(value: string) {
    const digits = (value || '').replace(/\D/g, '').slice(0, 19);
    this.card.number = digits.replace(/(.{4})/g, '$1 ').trim();
  }
  useTestCard(number: string) {
    this.formatCard(number);
    this.card.holderName ||= 'Test Customer';
    this.card.expiry = '12/2030';
    this.card.cvv = '123';
  }
  close() { this.clearRedirect(); this.confirmed = null; }

  /** Holds the confirmation on screen briefly, then takes the shopper to their orders. */
  private startRedirect() {
    this.clearRedirect();
    this.redirectIn = 3;
    this.redirectTimer = setInterval(() => {
      this.redirectIn -= 1;
      if (this.redirectIn <= 0) { this.clearRedirect(); this.confirmed = null; this.router.navigate(['/orders']); }
    }, 1000);
  }
  private clearRedirect() { if (this.redirectTimer) { clearInterval(this.redirectTimer); this.redirectTimer = null; } }
  /** Lets the shopper stay on the confirmation instead of being moved on. */
  stayHere() { this.clearRedirect(); this.redirectIn = 0; }
  goToOrders() { this.clearRedirect(); this.confirmed = null; this.router.navigate(['/orders']); }
  ngOnDestroy() { this.clearRedirect(); }
  formatPhone(value: string) { this.address.phone = (value || '').replace(/\D/g, '').slice(0, 10); }
  formatPin(value: string) { this.address.postalCode = (value || '').replace(/\D/g, '').slice(0, 6); }

  /** Mirrors the server rules so shoppers see problems before a payment is attempted. */
  private validateAddress(): string | null {
    const a = this.address;
    if (!a.fullName.trim()) return 'Please enter the recipient name.';
    if (a.phone.length !== 10) return 'Please enter a valid 10-digit phone number.';
    if (!a.line1.trim()) return 'Please enter address line 1.';
    if (!a.city.trim()) return 'Please enter your city.';
    if (!a.state.trim()) return 'Please select your state.';
    if (a.postalCode.length !== 6 || a.postalCode.startsWith('0')) return 'Please enter a valid 6-digit PIN code.';
    return null;
  }

  checkout() {
    if (this.placing) return;
    if (!this.methods.length) { this.message = this.paymentUnavailable; return; }
    if (!this.auth.isLoggedIn) { this.router.navigate(['/login'], { queryParams: { returnUrl: '/cart' } }); return; }
    if (this.showAddressForm && this.savedAddresses.length) { this.message = 'Please save or cancel the address you are editing first.'; return; }
    const addressError = this.validateAddress();
    if (addressError) { this.message = addressError; return; }
    // A first-time shopper typed straight into the form; keep the address for next time.
    if (this.showAddressForm && !this.savedAddresses.length) {
      this.api.createAddress({ ...this.address, isDefault: true }).subscribe({ next: () => this.loadAddresses(), error: () => { /* checkout continues regardless */ } });
    }
    this.api.track('CheckoutStarted');
    if (this.isRazorpay()) { this.payWithRazorpay(); return; }
    this.placeOrder({});
  }

  /** Opens a Razorpay order on the server, shows the widget, then has the server verify the result. */
  private async payWithRazorpay() {
    this.placing = true; this.message = '';
    const loaded = await Cart.loadRazorpay();
    if (!loaded) { this.placing = false; this.message = 'Could not load the payment window. Check your connection and try again.'; return; }

    const items = this.cart.lines.map(line => ({ productId: line.product.id, quantity: line.quantity }));
    this.api.razorpayOrder({ items }).subscribe({
      next: (session: any) => {
        let finalizing = false;
        const options: any = {
          key: session.keyId || this.razorpayKeyId,
          amount: session.amount,
          currency: session.currency,
          name: 'The Bathany',
          description: 'Botanical bath rituals',
          image: 'assets/brand/logo.jpeg',
          order_id: session.orderId,
          prefill: { name: this.address.fullName || session.customer?.name || '', email: session.customer?.email || '', contact: this.address.phone || '' },
          notes: { address: `${this.address.city}, ${this.address.state}` },
          theme: { color: '#7a5c48' },
          // The browser only relays these values; the server re-verifies every one of them.
          // Razorpay calls these from outside Angular, so re-enter the zone or the UI never updates.
          handler: (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => this.zone.run(() => {
            if (finalizing) return;
            finalizing = true;
            if (response.razorpay_order_id !== session.orderId) {
              this.placing = false;
              this.message = 'The payment confirmation does not match this checkout. Please contact support.';
              return;
            }
            this.api.verifyRazorpay(response).subscribe({
              next: () => this.placeOrder({
                razorpay: {
                  orderId: session.orderId,
                  paymentId: response.razorpay_payment_id,
                  signature: response.razorpay_signature
                }
              }),
              error: error => {
                this.placing = false;
                this.message = error.error?.detail || 'Could not verify payment. Please contact support before retrying.';
              }
            });
          }),
          modal: {
            ondismiss: () => this.zone.run(() => { if (finalizing || this.confirmed) return; this.api.track('PaymentCancelled'); this.placing = false; this.message = 'Payment was cancelled. Your cart is unchanged.'; })
          }
        };
        try {
          const rzp = new (window as any).Razorpay(options);
          rzp.on('payment.failed', (event: any) => this.zone.run(() => {
            this.api.track('PaymentFailed');
            this.placing = false;
            this.message = event?.error?.description || 'The payment failed. Please try another method.';
          }));
          rzp.open();
        } catch {
          this.placing = false;
          this.message = 'Could not open the payment window. Please try again.';
        }
      },
      error: error => {
        this.placing = false;
        if (error.status === 401 && error.error?.code !== 'payment_provider_error') { this.auth.logout(); this.router.navigate(['/login'], { queryParams: { returnUrl: '/cart' } }); return; }
        this.message = error.error?.detail || 'Could not start the payment. Please try again.';
      }
    });
  }

  trackQuantity(line: Line) {
    if (Number.isInteger(line.quantity) && line.quantity >= 1 && line.quantity <= 999)
      this.api.track('CartQuantityChanged', line.product.id, line.quantity);
  }

  /** Sends the order to the server; `extra` carries the Razorpay confirmation when there is one. */
  private placeOrder(extra: Record<string, unknown>) {
    const idempotencyKey = crypto.randomUUID();
    this.placing = true; this.message = '';
    const body: any = {
      items: this.cart.lines.map(line => ({ productId: line.product.id, quantity: line.quantity })),
      paymentMethod: this.method,
      shippingAddress: { ...this.address },
      idempotencyKey,
      ...extra
    };
    if (this.requiresCard()) body.card = { ...this.card, number: this.card.number.replace(/\s/g, '') };
    this.api.checkout(body)
      .subscribe({
        next: (order: any) => {
          this.placing = false;
          if (order?.status === 'PaymentFailed') { this.message = order?.payment?.failureReason || 'Payment was declined. Please try another card.'; return; }
          this.confirmed = order; this.cart.lines = []; this.cart.save();
          this.card = { number: '', holderName: '', expiry: '', cvv: '' };
          this.startRedirect();
        },
        error: error => { this.placing = false; this.message = error.status === 401 ? 'Your session expired. Please sign in again.' : error.error?.detail || 'Payment could not be completed. Please try again.'; if (error.status === 401) { this.auth.logout(); this.router.navigate(['/login'], { queryParams: { returnUrl: '/cart' } }); } }
      });
  }
}

@Component({
  standalone: true, imports: [CommonModule, FormsModule, RouterLink],
  template: `<div class="page"><div class="checkout-panel"><img class="panel-crest" src="assets/brand/logo.jpeg" alt="The Bathany"><div class="eyebrow">Welcome back</div><h1>Sign in to The Bathany</h1><p class="muted">Use your customer or admin account to continue.</p><div class="checkout-field"><label>Email</label><input type="email" [(ngModel)]="email" (keyup.enter)="login()"></div><div class="checkout-field"><label>Password</label><input type="password" [(ngModel)]="password" (keyup.enter)="login()"></div><button class="btn-primary" [disabled]="submitting" (click)="login()">{{ submitting ? 'Signing in…' : 'Sign in' }}</button><p class="pay-error" *ngIf="message">{{ message }}</p><p class="muted"><a routerLink="/forgot-password">Forgot your password?</a></p><p class="muted">New to The Bathany? <a routerLink="/register">Create an account</a></p></div></div>`
})
export class Login {
  email = ''; password = ''; message = ''; submitting = false;
  constructor(private api: Api, private auth: Auth, private toast: Toast, private router: Router, private route: ActivatedRoute) {}
  login() {
    if (!this.email.trim() || !this.password) { this.message = 'Please enter your email and password.'; return; }
    this.submitting = true; this.message = '';
    this.api.login({ email: this.email.trim(), password: this.password }).subscribe({
      next: result => {
        this.submitting = false;
        this.auth.setToken(result.accessToken);
        this.toast.show(`Welcome back, ${this.auth.displayName}`);
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
        this.router.navigateByUrl(returnUrl || (this.auth.isAdmin ? '/admin' : '/shop'));
      },
      error: error => {
        this.submitting = false;
        this.message = error.status === 0 ? 'Cannot reach the server. Please try again.' : 'Sign in failed. Check your email and password.';
      }
    });
  }
}

@Component({
  standalone: true, imports: [CommonModule, FormsModule, RouterLink],
  template: `<div class="page"><div class="checkout-panel"><img class="panel-crest" src="assets/brand/logo.jpeg" alt="The Bathany"><div class="eyebrow">Account recovery</div><h1>Forgot your password?</h1>
    <p class="muted">Enter your email and we'll send you a link to reset your password.</p>
    <div class="checkout-field"><label>Email</label><input type="email" [(ngModel)]="email" (keyup.enter)="submit()" placeholder="you@example.com"></div>
    <button class="btn-primary" [disabled]="submitting" (click)="submit()">{{ submitting ? 'Sending…' : 'Send reset link' }}</button>
    <p class="muted" *ngIf="message">{{ message }}</p>
    <div class="sandbox-note" *ngIf="resetToken">
      <strong>Sandbox mode</strong>
      <p class="muted">Email delivery is not configured, so the reset link is shown here for testing.</p>
      <a class="btn-primary" [routerLink]="['/reset-password']" [queryParams]="{ token: resetToken }">Continue to reset password</a>
    </div>
    <p class="muted">Remembered it? <a routerLink="/login">Back to sign in</a></p></div></div>`
})
export class ForgotPassword {
  email = ''; message = ''; submitting = false; resetToken = '';
  constructor(private api: Api) {}
  submit() {
    if (!this.email.trim()) { this.message = 'Please enter your email address.'; return; }
    this.submitting = true; this.message = ''; this.resetToken = '';
    this.api.forgotPassword({ email: this.email.trim() }).subscribe({
      next: res => { this.submitting = false; this.message = res?.message || 'Check your inbox for the reset link.'; this.resetToken = res?.resetToken || ''; },
      error: () => { this.submitting = false; this.message = 'Could not start the reset. Please try again.'; }
    });
  }
}

@Component({
  standalone: true, imports: [CommonModule, FormsModule, RouterLink],
  template: `<div class="page"><div class="checkout-panel"><img class="panel-crest" src="assets/brand/logo.jpeg" alt="The Bathany"><div class="eyebrow">Account recovery</div><h1>Choose a new password</h1>
    <p class="muted">Reset links expire after 30 minutes and can only be used once.</p>
    <div class="checkout-field"><label>Reset token</label><input [(ngModel)]="token" placeholder="Paste your reset token"></div>
    <div class="checkout-field"><label>New password</label><input type="password" [(ngModel)]="newPassword" placeholder="At least 10 characters"></div>
    <div class="checkout-field"><label>Confirm new password</label><input type="password" [(ngModel)]="confirmPassword" (keyup.enter)="submit()"></div>
    <button class="btn-primary" [disabled]="submitting" (click)="submit()">{{ submitting ? 'Updating…' : 'Update password' }}</button>
    <p class="pay-error" *ngIf="error">{{ error }}</p>
    <p class="muted" *ngIf="success">{{ success }} <a routerLink="/login">Sign in</a></p></div></div>`
})
export class ResetPassword {
  token = ''; newPassword = ''; confirmPassword = ''; error = ''; success = ''; submitting = false;
  constructor(private api: Api, private toast: Toast, private router: Router, route: ActivatedRoute) {
    this.token = route.snapshot.queryParamMap.get('token') || '';
  }
  submit() {
    this.error = ''; this.success = '';
    if (!this.token.trim()) { this.error = 'A reset token is required.'; return; }
    if (this.newPassword.length < 10) { this.error = 'Password must be at least 10 characters.'; return; }
    if (this.newPassword !== this.confirmPassword) { this.error = 'Passwords do not match.'; return; }
    this.submitting = true;
    this.api.resetPassword({ token: this.token.trim(), newPassword: this.newPassword }).subscribe({
      next: res => {
        this.submitting = false;
        this.success = res?.message || 'Your password has been updated.';
        this.toast.show('Password updated. Please sign in.');
        setTimeout(() => this.router.navigate(['/login']), 1500);
      },
      error: err => { this.submitting = false; this.error = err.error?.detail || 'Could not reset your password. Please request a new link.'; }
    });
  }
}

@Component({
  standalone: true, imports: [CommonModule, FormsModule, RouterLink],
  template: `<div class="page"><div class="checkout-panel"><img class="panel-crest" src="assets/brand/logo.jpeg" alt="The Bathany"><div class="eyebrow">Join The Bathany</div><h1>Create your account</h1><p class="muted">Sign up to check out faster and track your orders.</p>
    <div class="checkout-field"><label>Full name</label><input [(ngModel)]="displayName" placeholder="Jane Doe"></div>
    <div class="checkout-field"><label>Email</label><input type="email" [(ngModel)]="email" placeholder="you@example.com"></div>
    <div class="checkout-field"><label>Password</label><input type="password" [(ngModel)]="password" placeholder="At least 10 characters"></div>
    <div class="checkout-field"><label>Confirm password</label><input type="password" [(ngModel)]="confirmPassword"></div>
    <button class="btn-primary" [disabled]="submitting" (click)="register()">{{ submitting ? 'Creating account…' : 'Create account' }}</button>
    <p>{{ message }}</p><p class="muted">Already have an account? <a routerLink="/login">Sign in</a></p></div></div>`
})
export class Register {
  displayName = ''; email = ''; password = ''; confirmPassword = ''; message = ''; submitting = false;
  constructor(private api: Api, private auth: Auth, private toast: Toast, private router: Router) {}
  register() {
    if (!this.displayName.trim() || !this.email.trim()) { this.message = 'Please enter your name and email.'; return; }
    if (this.password.length < 10) { this.message = 'Password must be at least 10 characters.'; return; }
    if (this.password !== this.confirmPassword) { this.message = 'Passwords do not match.'; return; }
    this.submitting = true;
    this.api.register({ email: this.email.trim(), displayName: this.displayName.trim(), password: this.password }).subscribe({
      next: () => this.api.login({ email: this.email.trim(), password: this.password }).subscribe({
        next: result => { this.auth.setToken(result.accessToken); this.submitting = false; this.toast.show(`Welcome to The Bathany, ${this.auth.displayName}`); this.router.navigate(['/shop']); },
        error: () => { this.submitting = false; this.message = 'Account created. Please sign in.'; }
      }),
      error: error => { this.submitting = false; this.message = error.status === 409 ? 'That email is already registered.' : error.error?.detail || 'Sign up failed. Please try again.'; }
    });
  }
}

@Component({
  standalone: true, imports: [CommonModule, CurrencyPipe, DatePipe, RouterLink, Pager],
  template: `<div class="page"><div class="section-heading"><h1>My orders</h1><span class="order-head-links"><a routerLink="/payments" class="muted">Payment history</a><a routerLink="/shop" class="muted">Continue shopping →</a></span></div>
    <p *ngIf="error">{{ error }}</p>
    <p *ngIf="!error && !orders.length" class="muted">You have not placed any orders yet.</p>
    <article class="order-card" *ngFor="let order of pageOf(orders, page, size)">
      <div class="order-head">
        <div><strong>Order #{{ order.id }}</strong><span class="muted"> · {{ order.createdAt | date:'medium' }}</span></div>
        <span class="order-status">{{ order.status }}</span>
      </div>
      <table class="order-items">
        <thead><tr><th>Item</th><th>Unit price</th><th>Qty</th><th>Line total</th></tr></thead>
        <tbody>
          <tr *ngFor="let item of order.items">
            <td>{{ item.productName }}</td>
            <td>{{ item.unitPrice | currency }}</td>
            <td>{{ item.quantity }}</td>
            <td>{{ item.unitPrice * item.quantity | currency }}</td>
          </tr>
        </tbody>
      </table>
      <div class="order-ship" *ngIf="order.shippingAddress">
        <strong>Delivery address</strong>
        <p class="muted">{{ order.shippingAddress.fullName }} · {{ order.shippingAddress.phone }}<br>
          {{ order.shippingAddress.line1 }}<span *ngIf="order.shippingAddress.line2">, {{ order.shippingAddress.line2 }}</span><br>
          <span *ngIf="order.shippingAddress.landmark">{{ order.shippingAddress.landmark }}<br></span>
          {{ order.shippingAddress.city }}, {{ order.shippingAddress.state }} {{ order.shippingAddress.postalCode }}<br>
          {{ order.shippingAddress.country }}</p>
      </div>
      <div class="order-foot">
        <span class="muted" *ngIf="order.payment">Payment: {{ order.payment.status }}<span *ngIf="order.payment.cardLast4"> · {{ order.payment.cardBrand }} •••• {{ order.payment.cardLast4 }}</span> · {{ order.payment.transactionId }}</span>
        <strong class="price">Total: {{ order.total | currency }}</strong>
      </div>
    </article>
    <app-pager [total]="orders.length" [page]="page" [pageSize]="size" [sizes]="[5, 10, 20]" (pageChange)="page = $event" (sizeChange)="size = $event; page = 1"></app-pager></div>`
})
export class Orders { orders: any[] = []; error = ''; page = 1; size = 5; pageOf = pageOf; constructor(api: Api) { api.orders().subscribe({ next: orders => this.orders = orders, error: () => this.error = 'Please sign in to view orders.' }); } }

@Component({
  standalone: true, imports: [CommonModule, CurrencyPipe, DatePipe, RouterLink, Pager],
  template: `<div class="page"><div class="section-heading"><h1>Payment history</h1><a routerLink="/orders" class="muted">My orders →</a></div>
    <p *ngIf="error">{{ error }}</p>
    <p *ngIf="!error && loaded && !payments.length" class="muted">You have not made any payments yet.</p>
    <div class="pay-summary" *ngIf="payments.length">
      <div class="pay-stat"><span class="muted">Payments</span><strong>{{ payments.length }}</strong></div>
      <div class="pay-stat"><span class="muted">Total paid</span><strong class="price">{{ totalPaid() | currency }}</strong></div>
    </div>
    <div class="table-scroll" *ngIf="payments.length">
      <table class="data-table">
        <thead><tr><th>Date</th><th>Order</th><th>Method</th><th>Reference</th><th>Status</th><th>Amount</th></tr></thead>
        <tbody>
          <tr *ngFor="let p of pageOf(payments, page, size)">
            <td>{{ p.processedAt | date:'medium' }}</td>
            <td><a routerLink="/orders">#{{ p.orderId }}</a></td>
            <td>{{ label(p) }}<br><span class="muted" *ngIf="p.cardLast4">{{ p.cardBrand }} •••• {{ p.cardLast4 }}</span></td>
            <td><span class="muted pay-ref">{{ p.providerPaymentId || p.transactionId }}</span></td>
            <td><span class="pill" [class.pill-ok]="isPaid(p)" [class.pill-bad]="isFailed(p)">{{ p.status }}</span>
              <br><span class="muted" *ngIf="p.failureReason">{{ p.failureReason }}</span></td>
            <td><strong>{{ p.amount | currency }}</strong>
              <br><span class="muted" *ngIf="p.refundedAmount > 0">Refunded {{ p.refundedAmount | currency }}</span></td>
          </tr>
        </tbody>
      </table>
    </div>
    <app-pager [total]="payments.length" [page]="page" [pageSize]="size" (pageChange)="page = $event" (sizeChange)="size = $event; page = 1"></app-pager>
  </div>`
})
export class Payments {
  payments: any[] = []; error = ''; loaded = false; page = 1; size = 10; pageOf = pageOf;
  constructor(api: Api) {
    api.paymentHistory().subscribe({
      next: rows => { this.payments = rows || []; this.loaded = true; },
      error: () => { this.error = 'Please sign in to view your payment history.'; this.loaded = true; }
    });
  }
  isPaid(p: any) { return p.status === 'Approved' || p.status === 'Captured'; }
  isFailed(p: any) { return p.status === 'Declined' || p.status === 'Failed'; }
  label(p: any) { return p.provider === 'razorpay' ? 'Razorpay · ' + (p.method || 'online') : (p.method === 'cod' ? 'Cash on delivery' : p.method); }
  totalPaid() { return this.payments.filter(p => this.isPaid(p)).reduce((sum, p) => sum + p.amount - (p.refundedAmount || 0), 0); }
}



@Component({
  standalone: true, imports: [CommonModule, FormsModule, DatePipe, CurrencyPipe, Pager, AdminPushControls],
  template: `<div class="page admin">
    <div class="section-heading">
      <div class="admin-title"><img class="admin-crest" src="assets/brand/logo.jpeg" alt="The Bathany"><div><div class="eyebrow">The Bathany</div><h1>Admin console</h1></div></div>
      <div class="admin-toolbar">
        <span class="muted" *ngIf="lastLoaded">Updated {{ lastLoaded | date:'shortTime' }}</span>
        <button class="btn-light bell-toggle" [class.muted-bell]="!alerts.enabled"
                (click)="alerts.setEnabled(!alerts.enabled)"
                [attr.aria-pressed]="alerts.enabled"
                [title]="alerts.enabled ? 'Notification sound is on — click to mute' : 'Notification sound is muted — click to unmute'">
          {{ alerts.enabled ? '🔔' : '🔕' }} <span class="bell-label">{{ alerts.enabled ? 'Alerts on' : 'Alerts muted' }}</span>
        </button>
        <button class="btn-light" (click)="load()">Refresh</button>
      </div>
    </div>
    <p class="admin-alert" *ngIf="latestAlert" role="status" aria-live="polite">🔔 {{ latestAlert }}</p>
    <app-admin-push></app-admin-push>
    <p class="pay-error" *ngIf="error">{{ error }}</p>
    <p class="admin-flash" *ngIf="message">{{ message }}</p>

    <nav class="admin-tabs">
      <button *ngFor="let s of config.sections" [class.active]="section === s.key" (click)="section = s.key">{{ s.icon }} {{ s.label }}</button>
    </nav>

    <!-- Dashboard -->
    <section *ngIf="section === 'dashboard'">
      <div class="admin-grid">
        <div class="admin-card"><strong>{{ stats.products || 0 }}</strong>Products</div>
        <div class="admin-card"><strong>{{ stats.orders || 0 }}</strong>Orders</div>
        <div class="admin-card"><strong>{{ stats.users || 0 }}</strong>Users</div>
        <div class="admin-card"><strong>{{ stats.revenue || 0 | currency }}</strong>Revenue</div>
        <div class="admin-card"><strong>{{ stats.pendingOrders || 0 }}</strong>Pending orders</div>
        <div class="admin-card"><strong>{{ stats.lowStock || 0 }}</strong>Low stock</div>
      </div>
      <h2>Latest orders</h2>
      <table class="data-table"><thead><tr><th>#</th><th>Customer</th><th>Total</th><th>Status</th><th>Placed</th></tr></thead>
        <tbody>
          <tr *ngFor="let o of latestOrders"><td>#{{ o.id }}</td><td>{{ o.customer }}</td><td>{{ o.total | currency }}</td><td><span class="pill" [attr.data-status]="o.status">{{ o.status }}</span></td><td>{{ o.createdAt | date:'medium' }}</td></tr>
          <tr *ngIf="!latestOrders.length"><td colspan="5" class="muted">No orders yet.</td></tr>
        </tbody></table>
    </section>

    <!-- Products -->
    <section *ngIf="section === 'products'">
      <div class="admin-subhead">
        <h2>Products</h2>
        <button class="btn-primary" (click)="newProduct()">+ Add product</button>
      </div>

      <form class="admin-form" *ngIf="editing" (ngSubmit)="saveProduct()">
        <h3>{{ editing.id ? 'Edit product #' + editing.id : 'New product' }}</h3>
        <div class="form-row">
          <label>Name<input [(ngModel)]="editing.name" name="name" required></label>
          <label>Price ({{ config.currency.symbol }})<input type="number" min="1" step="0.01" [(ngModel)]="editing.price" name="price" required></label>
          <label>Stock<input type="number" min="0" [(ngModel)]="editing.stock" name="stock" required></label>
        </div>
        <div class="form-row">
          <label>Category<select [(ngModel)]="editing.categoryId" name="categoryId">
            <option *ngFor="let c of config.categories" [ngValue]="c.id">{{ c.name }}</option>
          </select></label>
          <label>Image URL<input [(ngModel)]="editing.imageUrl" name="imageUrl" placeholder="Upload an image with Browse…"></label>
          <label class="check">Active<input type="checkbox" [(ngModel)]="editing.isActive" name="isActive"></label>
        </div>
        <div class="upload-row">
          <div class="upload-controls">
            <input type="file" #picker accept="image/png,image/jpeg,image/gif,image/webp" hidden (change)="uploadImage($event)">
            <button type="button" class="btn-light" [disabled]="uploading" (click)="picker.click()">{{ uploading ? 'Uploading…' : 'Browse…' }}</button>
            <span class="muted">JPG, PNG, GIF or WEBP · up to 4 MB</span>
          </div>
          <img class="upload-preview" *ngIf="editing.imageUrl" [src]="img(editing.imageUrl)" alt="Product preview">
        </div>
        <label>Description<textarea [(ngModel)]="editing.description" name="description" rows="2"></textarea></label>
        <div class="form-actions">
          <button class="btn-primary" type="submit" [disabled]="saving || uploading">{{ uploading ? 'Uploading image…' : saving ? 'Saving…' : 'Save product' }}</button>
          <button class="link-btn" type="button" [disabled]="uploading" (click)="editing = null">Cancel</button>
        </div>
      </form>

      <div class="pay-filters table-filters">
        <input [(ngModel)]="q.products.search" (keyup.enter)="reload('products', 1)" placeholder="Search name, description or #">
        <button class="btn-light" (click)="reload('products', 1)">Search</button>
      </div>
      <table class="data-table"><thead><tr><th>#</th><th>Name</th><th>Image</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          <tr *ngFor="let p of products">
            <td>{{ p.id }}</td>
            <td><strong>{{ p.name }}</strong><br><span class="muted">{{ p.description }}</span></td>
            <td><img class="row-thumb" *ngIf="p.imageUrl" [src]="img(p.imageUrl)" [alt]="p.name"></td>
            <td>{{ categoryName(p.categoryId) }}</td>
            <td>{{ p.price | currency }}</td>
            <td [class.low]="p.stock <= 5">{{ p.stock }}</td>
            <td><span class="pill" [attr.data-status]="p.isActive ? 'Active' : 'Inactive'">{{ p.isActive ? 'Active' : 'Inactive' }}</span></td>
            <td class="row-actions">
              <button class="link-btn" (click)="editProduct(p)">Edit</button>
              <button class="link-btn danger" (click)="removeProduct(p)">Delete</button>
            </td>
          </tr>
          <tr *ngIf="!products.length"><td colspan="8" class="muted">No products found.</td></tr>
        </tbody></table>
      <app-pager [total]="q.products.total" [page]="q.products.page" [pageSize]="q.products.size" (pageChange)="reload('products', $event)" (sizeChange)="resize('products', $event)"></app-pager>
    </section>

    <section *ngIf="section === 'offers'">
      <div class="admin-subhead"><h2>Offer banners</h2><button class="btn-primary" (click)="editOffer()">+ Add offer</button></div>
      <p class="muted">Promotional banners link to the shop. They do not change checkout prices. Dates below use your device's local time.</p>
      <form class="admin-form" *ngIf="offerForm" (ngSubmit)="saveOffer()">
        <h3>{{ offerForm.id ? 'Edit offer' : 'New offer' }}</h3>
        <label>Title<input [(ngModel)]="offerForm.title" name="offerTitle" maxlength="120" required></label>
        <label>Description<textarea [(ngModel)]="offerForm.description" name="offerDescription" maxlength="1000"></textarea></label>
        <div class="form-row">
          <label>Valid from<input type="datetime-local" [(ngModel)]="offerForm.startsAt" name="offerStartsAt" required></label>
          <label>Valid until<input type="datetime-local" [(ngModel)]="offerForm.endsAt" name="offerEndsAt" required></label>
          <label class="check">Enabled<input type="checkbox" [(ngModel)]="offerForm.enabled" name="offerEnabled"></label>
        </div>
        <div class="upload-row">
          <label>Offer image<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" [disabled]="uploadingOffer || savingOffer" (change)="uploadOffer($event)"></label>
          <img class="upload-preview" *ngIf="offerForm.imageUrl" [src]="img(offerForm.imageUrl)" alt="Offer preview">
        </div>
        <p class="muted">JPG, PNG, GIF or WEBP, up to 4 MB.</p>
        <div class="form-actions">
          <button class="btn-primary" type="submit" [disabled]="savingOffer || uploadingOffer">{{ uploadingOffer ? 'Uploading...' : savingOffer ? 'Saving...' : 'Save offer' }}</button>
          <button class="link-btn" type="button" [disabled]="savingOffer || uploadingOffer" (click)="offerForm = null">Cancel</button>
        </div>
      </form>
      <div class="pay-filters"><input [(ngModel)]="q.offers.search" (keyup.enter)="reload('offers', 1)" placeholder="Search offers"><button class="btn-light" (click)="reload('offers', 1)">Search</button></div>
      <table class="data-table">
        <thead><tr><th>Image</th><th>Offer</th><th>Valid from</th><th>Valid until</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          <tr *ngFor="let offer of offers">
            <td><img class="row-thumb" [src]="img(offer.imageUrl)" [alt]="offer.title"></td>
            <td><strong>{{ offer.title }}</strong><br>{{ offer.description }}</td>
            <td>{{ offer.startsAt | date:'medium' }}</td><td>{{ offer.endsAt | date:'medium' }}</td>
            <td>{{ offerStatus(offer) }}</td>
            <td class="row-actions"><button class="link-btn" [disabled]="savingOffer" (click)="editOffer(offer)">Edit</button><button class="link-btn" [disabled]="savingOffer" (click)="toggleOffer(offer)">{{ offer.enabled ? 'Disable' : 'Enable' }}</button><button class="link-btn danger" [disabled]="savingOffer" (click)="deleteOffer(offer)">Delete</button></td>
          </tr>
          <tr *ngIf="!offers.length"><td colspan="6" class="muted">No offers found.</td></tr>
        </tbody>
      </table>
      <app-pager [total]="q.offers.total" [page]="q.offers.page" [pageSize]="q.offers.size" (pageChange)="reload('offers', $event)" (sizeChange)="resize('offers', $event)"></app-pager>
    </section>

    <!-- Orders -->
    <section *ngIf="section === 'orders'">
      <div class="admin-subhead">
        <h2>Orders</h2>
        <div class="pay-filters">
          <input [(ngModel)]="q.orders.search" (keyup.enter)="reload('orders', 1)" placeholder="Order #, email, name or phone">
          <select [(ngModel)]="q.orders.status" (ngModelChange)="reload('orders', 1)">
            <option value="">All statuses</option>
            <option *ngFor="let s of config.orderStatuses" [value]="s">{{ s }}</option>
          </select>
          <button class="btn-light" (click)="reload('orders', 1)">Search</button>
        </div>
      </div>
      <table class="data-table"><thead><tr><th>#</th><th>Customer</th><th>Deliver to</th><th>Items</th><th>Payment</th><th>Total</th><th>Status</th><th>Placed</th></tr></thead>
        <tbody>
          <tr *ngFor="let o of orders">
            <td>#{{ o.id }}</td>
            <td>{{ o.customer }}</td>
            <td>
              <span *ngIf="o.shippingAddress; else noAddress" class="muted">
                <strong>{{ o.shippingAddress.fullName }}</strong><br>{{ o.shippingAddress.phone }}<br>
                {{ o.shippingAddress.line1 }}<span *ngIf="o.shippingAddress.line2">, {{ o.shippingAddress.line2 }}</span><br>
                {{ o.shippingAddress.city }}, {{ o.shippingAddress.state }} {{ o.shippingAddress.postalCode }}
              </span>
              <ng-template #noAddress><span class="muted">—</span></ng-template>
            </td>
            <td><div *ngFor="let i of o.items" class="muted">{{ i.productName }} × {{ i.quantity }} — {{ i.unitPrice * i.quantity | currency }}</div></td>
            <td><span *ngIf="o.payment" class="muted">{{ o.payment.method }} · {{ o.payment.status }}<br *ngIf="o.payment.cardLast4"><span *ngIf="o.payment.cardLast4">{{ o.payment.cardBrand }} •••• {{ o.payment.cardLast4 }}</span></span></td>
            <td>{{ o.total | currency }}</td>
            <td>
              <select class="status-select" [ngModel]="o.status" (ngModelChange)="changeStatus(o, $event)">
                <option *ngFor="let s of config.orderStatuses" [value]="s">{{ s }}</option>
              </select>
            </td>
            <td>{{ o.createdAt | date:'medium' }}</td>
          </tr>
          <tr *ngIf="!orders.length"><td colspan="8" class="muted">No orders found.</td></tr>
        </tbody></table>
      <app-pager [total]="q.orders.total" [page]="q.orders.page" [pageSize]="q.orders.size" (pageChange)="reload('orders', $event)" (sizeChange)="resize('orders', $event)"></app-pager>
    </section>

    <!-- Payments -->
    <section *ngIf="section === 'payments'">
      <div class="checkout-panel">
        <h2>Payment options</h2>
        <p class="pay-error" *ngIf="paymentOptionError">{{ paymentOptionError }}</p>
        <div *ngIf="paymentOption">
          <strong>Razorpay</strong>
          <span class="pill" [attr.data-status]="paymentOption.enabled ? 'Active' : 'Inactive'">{{ paymentOption.enabled ? 'Enabled' : 'Disabled' }}</span>
          <p class="muted">Disabling blocks new payment sessions. Existing payments can still be verified and completed. Other payment methods remain hidden.</p>
          <p class="pay-error" *ngIf="!paymentOption.configured">Razorpay credentials are not configured. Enabling this option does not configure API keys.</p>
          <button class="btn-light" [disabled]="savingPaymentOption" (click)="togglePaymentOption()">
            {{ savingPaymentOption ? 'Saving…' : paymentOption.enabled ? 'Disable Razorpay' : 'Enable Razorpay' }}
          </button>
        </div>
      </div>
      <div class="admin-subhead">
        <h2>Payments</h2>
        <div class="pay-filters">
          <input [(ngModel)]="paymentSearch" (keyup.enter)="reload('payments', 1)" placeholder="Reference, customer or order #">
          <select [(ngModel)]="paymentStatus" (ngModelChange)="reload('payments', 1)">
            <option value="">All statuses</option>
            <option *ngFor="let s of paymentData.statuses" [value]="s">{{ s }}</option>
          </select>
          <select [(ngModel)]="paymentProvider" (ngModelChange)="reload('payments', 1)">
            <option value="">All providers</option>
            <option *ngFor="let p of paymentData.providers" [value]="p">{{ p }}</option>
          </select>
          <button class="btn-light" (click)="reload('payments', 1)">Search</button>
        </div>
      </div>
      <div class="admin-cards">
        <div class="admin-card"><strong>{{ paymentData.summary.capturedAmount || 0 | currency }}</strong>Captured</div>
        <div class="admin-card"><strong>{{ paymentData.summary.captured || 0 }}</strong>Successful</div>
        <div class="admin-card"><strong>{{ paymentData.summary.failed || 0 }}</strong>Failed</div>
        <div class="admin-card"><strong>{{ paymentData.summary.pending || 0 }}</strong>Pending</div>
        <div class="admin-card"><strong>{{ paymentData.summary.online || 0 }}</strong>Razorpay</div>
      </div>
      <table class="data-table"><thead><tr><th>#</th><th>Order</th><th>Customer</th><th>Method</th><th>Reference</th><th>Status</th><th>Amount</th><th>When</th></tr></thead>
        <tbody>
          <tr *ngFor="let p of paymentData.items">
            <td>{{ p.id }}</td>
            <td>#{{ p.orderId }}<br><span class="muted">{{ p.orderStatus }}</span></td>
            <td>{{ p.customer }}<br><span class="muted">{{ p.customerName }}</span></td>
            <td>{{ p.provider === 'razorpay' ? 'Razorpay' : 'Simulated' }}<br><span class="muted">{{ p.method }}<span *ngIf="p.cardLast4"> · {{ p.cardBrand }} •••• {{ p.cardLast4 }}</span></span></td>
            <td><span class="muted pay-ref">{{ p.providerPaymentId || p.transactionId }}</span></td>
            <td><span class="pill" [attr.data-status]="p.status">{{ p.status }}</span><br><span class="muted" *ngIf="p.failureReason">{{ p.failureReason }}</span></td>
            <td>{{ p.amount | currency }}<br><span class="muted" *ngIf="p.refundedAmount > 0">−{{ p.refundedAmount | currency }}</span></td>
            <td>{{ p.processedAt | date:'medium' }}</td>
          </tr>
          <tr *ngIf="!paymentData.items.length"><td colspan="8" class="muted">No payments match this filter.</td></tr>
        </tbody></table>
      <app-pager [total]="q.payments.total" [page]="q.payments.page" [pageSize]="q.payments.size" (pageChange)="reload('payments', $event)" (sizeChange)="resize('payments', $event)"></app-pager>
    </section>

    <!-- Users -->
    <section *ngIf="section === 'users'">
      <div class="admin-subhead">
        <h2>Users</h2>
        <div class="pay-filters">
          <input [(ngModel)]="q.users.search" (keyup.enter)="reload('users', 1)" placeholder="Email or name">
          <select [(ngModel)]="q.users.role" (ngModelChange)="reload('users', 1)">
            <option value="">All roles</option>
            <option *ngFor="let r of config.roles" [value]="r">{{ r }}</option>
          </select>
          <button class="btn-light" (click)="reload('users', 1)">Search</button>
        </div>
      </div>
      <table class="data-table"><thead><tr><th>#</th><th>Email</th><th>Name</th><th>Role</th><th>Orders</th><th>Last login</th><th>Joined</th><th>Actions</th></tr></thead>
        <tbody>
          <tr *ngFor="let u of users">
            <td>{{ u.id }}</td><td>{{ u.email }}</td><td>{{ u.displayName }}</td>
            <td>
              <select class="status-select" [ngModel]="u.role" (ngModelChange)="changeRole(u, $event)">
                <option *ngFor="let r of config.roles" [value]="r">{{ r }}</option>
              </select>
            </td>
            <td>{{ u.orders }}</td>
            <td><span *ngIf="u.lastLogin; else never">{{ u.lastLogin.createdAt | date:'medium' }}<br><span class="muted ip">IP {{ u.lastLogin.ipAddress || '—' }}</span></span><ng-template #never><span class="muted">Never</span></ng-template></td>
            <td>{{ u.createdAt | date:'mediumDate' }}</td>
            <td>
              <button class="link-btn" (click)="viewUserActivity(u)">Activity</button>
              <button class="link-btn" *ngIf="resetFor !== u.id" (click)="startReset(u.id)">Reset password</button>
              <span class="admin-reset" *ngIf="resetFor === u.id">
                <input type="password" [(ngModel)]="newPassword" placeholder="New password">
                <button class="btn-primary" [disabled]="saving" (click)="confirmReset(u)">{{ saving ? 'Saving…' : 'Save' }}</button>
                <button class="link-btn" (click)="cancelReset()">Cancel</button>
              </span>
            </td>
          </tr>
          <tr *ngIf="!users.length"><td colspan="8" class="muted">No users found.</td></tr>
        </tbody></table>
      <app-pager [total]="q.users.total" [page]="q.users.page" [pageSize]="q.users.size" (pageChange)="reload('users', $event)" (sizeChange)="resize('users', $event)"></app-pager>
    </section>

    <!-- Activity -->
    <section *ngIf="section === 'activity'">
      <div class="admin-subhead">
        <h2>User activity</h2>
        <div class="pay-filters">
          <input [(ngModel)]="q.activity.search" (keyup.enter)="reload('activity', 1)" placeholder="Email, IP or details">
          <select [(ngModel)]="q.activity.action" (ngModelChange)="reload('activity', 1)">
            <option value="">All activity</option>
            <option *ngFor="let a of activityActions" [value]="a">{{ a }}</option>
          </select>
          <button class="btn-light" (click)="reload('activity', 1)">Search</button>
        </div>
      </div>
      <p class="admin-flash" *ngIf="q.activity.userId">Showing activity for {{ q.activity.userLabel }} · <button class="link-btn" (click)="clearUserFilter()">Show everyone</button></p>
      <table class="data-table"><thead><tr><th>#</th><th>Action</th><th>Details</th><th>User</th><th>IP address</th><th>Device</th><th>When</th></tr></thead>
        <tbody>
          <tr *ngFor="let a of activity">
            <td>{{ a.id }}</td>
            <td><span class="pill" [attr.data-status]="actionTone(a.action)">{{ a.action }}</span></td>
            <td>{{ a.details }}</td>
            <td><span *ngIf="a.userEmail; else guest">{{ a.userEmail }}<br><span class="muted">#{{ a.userId }}</span></span><ng-template #guest><span class="muted">Guest</span></ng-template></td>
            <td><span class="ip">{{ a.ipAddress || '—' }}</span></td>
            <td><span class="muted" [title]="a.userAgent">{{ device(a.userAgent) }}</span></td>
            <td>{{ a.createdAt | date:'medium' }}</td>
          </tr>
          <tr *ngIf="!activity.length"><td colspan="7" class="muted">No activity recorded.</td></tr>
        </tbody></table>
      <app-pager [total]="q.activity.total" [page]="q.activity.page" [pageSize]="q.activity.size" (pageChange)="reload('activity', $event)" (sizeChange)="resize('activity', $event)"></app-pager>
    </section>
  </div>`
})
export class Admin implements OnDestroy {
  img = imageSrc;
  /** Defaults are replaced by GET /api/admin/config so sections, statuses and roles stay server-driven. */
  config: any = {
    currency: { code: 'INR', symbol: '\u20b9', locale: 'en-IN' },
    orderStatuses: ['Pending', 'Paid', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'Refunded', 'PaymentFailed'],
    roles: ['Customer', 'Admin'],
    categories: [],
    sections: [
      { key: 'dashboard', label: 'Dashboard', icon: '\u25a4' },
      { key: 'products', label: 'Products', icon: '\u25a6' },
      { key: 'offers', label: 'Offers', icon: '\u2605' },
      { key: 'orders', label: 'Orders', icon: '\ud83e\uddfe' },
      { key: 'payments', label: 'Payments', icon: '\ud83d\udcb3' },
      { key: 'users', label: 'Users', icon: '\ud83d\udc65' },
      { key: 'activity', label: 'Activity', icon: '\ud83d\udd52' }
    ]
  };
  section = 'dashboard';
  stats: any = {};
  products: any[] = []; orders: any[] = []; users: any[] = []; activity: any[] = []; latestOrders: any[] = [];
  activityActions: string[] = [];
  offers: Offer[] = [];
  offerForm: { id?: number; title: string; description: string; imageUrl: string; enabled: boolean; startsAt: string; endsAt: string } | null = null;
  savingOffer = false;
  uploadingOffer = false;
  /** Per-table paging and filter state. Every admin table is paged on the server. */
  q: any = {
    products: { page: 1, size: 10, total: 0, search: '' },
    offers: { page: 1, size: 10, total: 0, search: '' },
    orders: { page: 1, size: 10, total: 0, search: '', status: '' },
    payments: { page: 1, size: 10, total: 0 },
    users: { page: 1, size: 10, total: 0, search: '', role: '' },
    activity: { page: 1, size: 20, total: 0, search: '', action: '', userId: null, userLabel: '' }
  };
  paymentData: any = { summary: {}, items: [], providers: [], statuses: [] };
  paymentOption: { code: string; label: string; enabled: boolean; configured: boolean } | null = null;
  paymentOptionError = '';
  savingPaymentOption = false;
  paymentSearch = ''; paymentStatus = ''; paymentProvider = '';
  editing: any = null;
  resetFor: number | null = null; newPassword = '';
  saving = false; uploading = false; message = ''; error = ''; lastLoaded: Date | null = null;
  latestAlert = '';
  /** null means "no baseline yet" — the first poll only records the cursor so old rows never ring. */
  private lastSeenActivityId: number | null = null;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private alertTimer: ReturnType<typeof setTimeout> | undefined;
  private unlockAlerts = () => this.alerts.unlock();

  constructor(private api: Api, public alerts: AdminAlerts) {
    this.load();
    // Audio needs a user gesture; the admin's first interaction anywhere on the console unlocks it.
    window.addEventListener('pointerdown', this.unlockAlerts);
    window.addEventListener('keydown', this.unlockAlerts);
    this.api.adminNotifications(null).subscribe({
      next: res => {
        this.lastSeenActivityId = res.latestId;
        this.pollTimer = setInterval(() => this.pollNotifications(), 20000);
      },
      error: () => {}
    });
  }

  ngOnDestroy() {
    clearInterval(this.pollTimer);
    clearTimeout(this.alertTimer);
    window.removeEventListener('pointerdown', this.unlockAlerts);
    window.removeEventListener('keydown', this.unlockAlerts);
  }

  /** Rings once per batch, not once per row, so a burst of activity is not a burst of chimes. */
  private pollNotifications() {
    if (this.lastSeenActivityId === null) return;
    this.api.adminNotifications(this.lastSeenActivityId).subscribe({
      next: res => {
        this.lastSeenActivityId = res.latestId;
        if (!res.items?.length) return;
        const order = res.items.find(a => a.action === 'Checkout');
        const headline = order
          ? `New order placed — ${order.details}`
          : `${res.items.length} new customer ${res.items.length === 1 ? 'activity' : 'activities'} — ${res.items[res.items.length - 1].action}`;
        this.latestAlert = headline;
        clearTimeout(this.alertTimer);
        this.alertTimer = setTimeout(() => this.latestAlert = '', 15000);
        this.alerts.ring();
        this.load();
      },
      error: () => {}
    });
  }

  /** Config carries categories/statuses/roles, so it must be retried on every load — not once in the constructor. */
  private loadConfig() {
    this.api.admin('config').subscribe({
      next: cfg => this.config = { ...this.config, ...cfg },
      error: () => this.api.admin('categories').subscribe({ next: (cats: any) => this.config = { ...this.config, categories: cats }, error: () => {} })
    });
  }

  categoryName(id: number) { return this.config.categories.find((c: any) => c.id === id)?.name || '—'; }

  load() {
    this.error = '';
    this.loadConfig();
    this.loadPaymentOption();
    this.api.admin('stats').subscribe({ next: s => this.stats = s, error: () => this.error = 'Sign in as an admin to load data.' });
    this.api.admin('orders?page=1&pageSize=5').subscribe({ next: d => this.latestOrders = d.items || [], error: () => this.latestOrders = [] });
    (['products', 'orders', 'users', 'activity', 'payments', 'offers'] as const).forEach(t => this.reload(t));
    this.lastLoaded = new Date();
  }

  private queryFor(table: string): string {
    const s = this.q[table];
    const params = new URLSearchParams({ page: String(s.page), pageSize: String(s.size) });
    const set = (k: string, v: any) => { if (v !== null && v !== undefined && String(v).trim()) params.set(k, String(v).trim()); };
    if (table === 'payments') { set('status', this.paymentStatus); set('provider', this.paymentProvider); set('search', this.paymentSearch); }
    else { set('search', s.search); set('status', s.status); set('role', s.role); set('action', s.action); set('userId', s.userId); }
    return `${table}?${params}`;
  }

  /** Fetch one table's page. Passing a page number jumps there (filters reset to page 1). */
  reload(table: string, page?: number) {
    const s = this.q[table];
    if (page) s.page = page;
    this.api.admin(this.queryFor(table)).subscribe({
      next: d => {
        s.total = d.total ?? 0; s.page = d.page ?? s.page;
        const items = d.items || [];
        if (table === 'payments') this.paymentData = { summary: d.summary || {}, items, providers: d.providers || [], statuses: d.statuses || [] };
        else if (table === 'activity') { this.activity = items; this.activityActions = d.actions || []; }
        else (this as any)[table] = items;
      },
      error: () => { s.total = 0; if (table === 'payments') this.paymentData = { summary: {}, items: [], providers: [], statuses: [] }; else (this as any)[table] = []; }
    });
  }

  resize(table: string, size: number) { this.q[table].size = size; this.reload(table, 1); }

  private loadPaymentOption() {
    if (this.savingPaymentOption) return;
    this.api.admin('payment-options').subscribe({
      next: option => { this.paymentOption = option; this.paymentOptionError = ''; },
      error: () => { this.paymentOption = null; this.paymentOptionError = 'Could not load payment settings. Use Refresh to retry.'; }
    });
  }

  togglePaymentOption() {
    if (!this.paymentOption || this.savingPaymentOption) return;
    const enabled = !this.paymentOption.enabled;
    this.savingPaymentOption = true;
    this.paymentOptionError = '';
    this.api.adminPut('payment-options/razorpay', { enabled }).subscribe({
      next: option => {
        this.paymentOption = option;
        this.savingPaymentOption = false;
        this.flash(`Razorpay payments ${enabled ? 'enabled' : 'disabled'}.`);
        this.reload('activity');
      },
      error: err => {
        this.savingPaymentOption = false;
        this.paymentOptionError = err.error?.detail || 'Could not update payment settings. Please refresh and try again.';
      }
    });
  }

  viewUserActivity(u: any) {
    Object.assign(this.q.activity, { userId: u.id, userLabel: u.email, action: '', search: '' });
    this.section = 'activity';
    this.reload('activity', 1);
  }
  clearUserFilter() { Object.assign(this.q.activity, { userId: null, userLabel: '' }); this.reload('activity', 1); }

  actionTone(action: string) {
    if (/Failed|Deleted|Deactivated|Remove/i.test(action)) return 'Cancelled';
    if (/Login|Register|Checkout/i.test(action)) return 'Paid';
    if (/Logout/i.test(action)) return 'Pending';
    return 'Active';
  }

  /** A short readable device label from the user agent; the full string is in the tooltip. */
  device(ua: string) {
    if (!ua) return '—';
    const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : '';
    const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : /curl/i.test(ua) ? 'curl' : 'Other';
    return os ? `${browser} · ${os}` : browser;
  }

  loadPayments() { this.reload('payments', 1); }

  private flash(text: string) { this.message = text; this.error = ''; setTimeout(() => this.message = '', 4000); }
  private fail(err: any, fallbackText: string) { this.saving = false; this.error = err?.error?.detail || err?.error?.title || fallbackText; }

  newProduct() { this.editing = { name: '', description: '', price: 0, stock: 0, imageUrl: '', categoryId: this.config.categories[0]?.id || 1, isActive: true }; }
  private localDate(value: string | Date) {
    const date = new Date(value);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
  editOffer(offer?: Offer) {
    if (this.savingOffer || this.uploadingOffer) { this.error = 'Wait for the current offer operation to finish.'; return; }
    this.offerForm = offer
      ? { ...offer, startsAt: this.localDate(offer.startsAt), endsAt: this.localDate(offer.endsAt) }
      : { title: '', description: '', imageUrl: '', enabled: true, startsAt: this.localDate(new Date()), endsAt: this.localDate(new Date(Date.now() + 7 * 86400000)) };
  }
  offerStatus(offer: Offer) {
    if (!offer.enabled) return 'Disabled';
    if (Date.parse(offer.endsAt) <= Date.now()) return 'Expired';
    return Date.parse(offer.startsAt) > Date.now() ? 'Scheduled' : 'Active';
  }
  uploadOffer(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const form = this.offerForm;
    if (!file || !form) return;
    this.uploadingOffer = true;
    this.error = '';
    this.api.uploadOfferImage(file).subscribe({
      next: result => { form.imageUrl = result.url; this.uploadingOffer = false; input.value = ''; },
      error: err => { this.uploadingOffer = false; input.value = ''; this.error = err.error?.detail || 'Could not upload the offer image.'; }
    });
  }
  saveOffer() {
    const form = this.offerForm;
    if (!form || this.savingOffer || this.uploadingOffer) return;
    const starts = new Date(form.startsAt), ends = new Date(form.endsAt);
    if (!form.title.trim() || !form.imageUrl || !Number.isFinite(starts.getTime()) || !Number.isFinite(ends.getTime()) || ends <= starts) {
      this.error = 'Enter a title, upload an image, and set an end time after the start time.';
      return;
    }
    const body = { ...form, startsAt: starts.toISOString(), endsAt: ends.toISOString() };
    this.savingOffer = true;
    (form.id ? this.api.adminPut(`offers/${form.id}`, body) : this.api.adminPost('offers', body)).subscribe({
      next: () => { this.savingOffer = false; this.offerForm = null; this.flash('Offer saved. Active banners will appear in the shop.'); this.reload('offers'); },
      error: err => { this.savingOffer = false; this.error = err.error?.detail || 'Could not save the offer.'; }
    });
  }
  toggleOffer(offer: Offer) {
    if (this.savingOffer) return;
    this.savingOffer = true;
    this.api.adminPut(`offers/${offer.id}`, { ...offer, enabled: !offer.enabled }).subscribe({
      next: () => { this.savingOffer = false; this.flash(`Offer ${offer.enabled ? 'disabled' : 'enabled'}.`); this.reload('offers'); },
      error: err => { this.savingOffer = false; this.error = err.error?.detail || 'Could not change offer availability.'; }
    });
  }
  deleteOffer(offer: Offer) {
    if (this.savingOffer || !confirm(`Delete offer "${offer.title}"?`)) return;
    this.savingOffer = true;
    this.api.adminDelete(`offers/${offer.id}`).subscribe({
      next: () => { this.savingOffer = false; this.flash('Offer deleted.'); this.reload('offers'); },
      error: err => { this.savingOffer = false; this.error = err.error?.detail || 'Could not delete the offer.'; }
    });
  }
  editProduct(p: any) { this.editing = { ...p }; }

  uploadImage(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!this.editing || this.uploading) { this.error = 'Wait for the current upload to finish.'; input.value = ''; return; }
    const editing = this.editing;
    this.uploading = true; this.error = '';
    this.api.uploadProductImage(file).subscribe({
      next: res => {
        this.uploading = false;
        if (this.editing === editing) { editing.imageUrl = res.url; this.flash('Image uploaded. Save the product to use it.'); }
        else this.error = 'Image uploaded, but the product form changed. Reopen the product and select the image again.';
        input.value = '';
      },
      error: e => { this.uploading = false; input.value = ''; this.error = e?.error?.detail || 'Could not upload that image.'; }
    });
  }

  saveProduct() {
    if (this.saving) return;
    if (this.uploading) { this.error = 'Wait for the image upload to finish before saving.'; return; }
    if (!this.editing.imageUrl?.trim()) { this.error = 'Upload an image before saving this product.'; return; }
    this.error = '';
    const body = { name: this.editing.name, description: this.editing.description, price: Number(this.editing.price), stock: Number(this.editing.stock), imageUrl: this.editing.imageUrl, categoryId: Number(this.editing.categoryId), isActive: !!this.editing.isActive };
    this.saving = true;
    const done = (text: string) => { this.saving = false; this.editing = null; this.flash(text); this.load(); };
    if (this.editing.id) {
      this.api.adminPut(`products/${this.editing.id}`, body).subscribe({ next: () => done('Product updated.'), error: e => this.fail(e, 'Could not update that product.') });
    } else {
      this.api.adminPost('products', body).subscribe({ next: () => done('Product created.'), error: e => this.fail(e, 'Could not create that product.') });
    }
  }

  removeProduct(p: any) {
    if (!confirm(`Delete ${p.name}?`)) return;
    this.api.adminDelete(`products/${p.id}`).subscribe({ next: res => { this.flash(res?.message || 'Product deleted.'); this.load(); }, error: e => this.fail(e, 'Could not delete that product.') });
  }

  changeStatus(order: any, status: string) {
    const previous = order.status;
    order.status = status;
    this.api.adminPut(`orders/${order.id}/status`, { status }).subscribe({
      next: () => { this.flash(`Order #${order.id} is now ${status}.`); this.load(); },
      error: e => { order.status = previous; this.fail(e, 'Could not update that order.'); }
    });
  }

  changeRole(user: any, role: string) {
    const previous = user.role;
    user.role = role;
    this.api.adminPut(`users/${user.id}/role`, { role }).subscribe({
      next: () => { this.flash(`${user.email} is now ${role}.`); this.load(); },
      error: e => { user.role = previous; this.fail(e, 'Could not update that role.'); }
    });
  }

  startReset(id: number) { this.resetFor = id; this.newPassword = ''; this.message = ''; this.error = ''; }
  cancelReset() { this.resetFor = null; this.newPassword = ''; }
  confirmReset(user: any) {
    this.error = '';
    if (this.newPassword.length < 10) { this.error = 'Password must be at least 10 characters.'; return; }
    this.saving = true;
    this.api.adminResetPassword(user.id, { newPassword: this.newPassword }).subscribe({
      next: res => { this.saving = false; this.resetFor = null; this.newPassword = ''; this.flash(res?.message || `Password updated for ${user.email}.`); this.load(); },
      error: e => this.fail(e, 'Could not reset that password.')
    });
  }
}

@Component({
  standalone: true, imports: [CommonModule, RouterLink],
  template: `
    <div class="page">
      <section class="content-hero">
        <div>
          <div class="eyebrow">The Bathany</div>
          <h1>Our Rituals</h1>
          <p>Bathing was never meant to be rushed. Every jar we whip is an invitation to slow down — to turn ten ordinary minutes into something restorative and a little bit magical.</p>
        </div>
        <img src="assets/brand/product-3.jpeg" alt="Raspberry Swirl Bath Cloud">
      </section>

      <div class="section-heading"><h2>Four ways to soak</h2><span class="muted">Choose your mood</span></div>
      <section class="ritual-list">
        <article class="ritual" *ngFor="let r of rituals; let i = index" [class.reverse]="i % 2 === 1">
          <img [src]="r.image" [alt]="r.title">
          <div>
            <div class="eyebrow">{{ r.step }}</div>
            <h3>{{ r.title }}</h3>
            <p>{{ r.body }}</p>
            <ul class="detail-points"><li *ngFor="let point of r.points">{{ point }}</li></ul>
          </div>
        </article>
      </section>

      <section class="cta-band">
        <div><h2>Ready to begin?</h2><p>Every ritual starts with a single jar.</p></div>
        <a class="btn-primary" routerLink="/shop">Shop the collection</a>
      </section>
    </div>
  `
})
export class Rituals {
  rituals = [
    { step: 'Ritual one', title: 'The Evening Unwind', image: 'assets/brand/product-1.jpeg',
      body: 'Potion No. 04 is our moonlit blend — rose petals and soft florals folded into a whipped botanical base. Scoop a spoonful under warm running water and let the tub fill slowly.',
      points: ['Best after sunset, lights low', 'Pairs with a warm towel and no phone', 'Rinse with cool water to seal the skin'] },
    { step: 'Ritual two', title: 'The Morning Spice', image: 'assets/brand/product-2.jpeg',
      body: 'Chai Spice Soul wakes the senses with cardamom, clove and vanilla. Massage into damp skin, breathe in, and let the warmth do the rest before you start your day.',
      points: ['A grounding start to cold mornings', 'Work into a lather with damp hands', 'Follow with a light body oil'] },
    { step: 'Ritual three', title: 'The Slow Sunday', image: 'assets/brand/product-3.jpeg',
      body: 'Raspberry Swirl Bath Cloud is pure whimsy — served with a little wooden spoon so you can scoop, swirl and watch the water turn soft and cloudy.',
      points: ['One heaped spoon per bath', 'Swirl beneath the tap for maximum cloud', 'Safe for a long, unhurried soak'] },
    { step: 'Ritual four', title: 'The Little Treat', image: 'assets/brand/product-4.jpeg',
      body: 'Whipped Soap Boba tops rose and coconut whipped soap with gently exfoliating pearls. Use it as a body polish whenever you want a small, deliberate moment of care.',
      points: ['Doubles as a gentle body polish', 'Massage pearls in slow circles', 'Two or three times a week is plenty'] }
  ];
}

@Component({
  standalone: true, imports: [CommonModule, RouterLink],
  template: `
    <div class="page">
      <section class="content-hero">
        <div>
          <div class="eyebrow">Full transparency</div>
          <h1>Ingredients</h1>
          <p>Nothing hidden, nothing harsh. Every jar is built from botanical oils, butters and clays — and we will always tell you exactly what goes in and why.</p>
        </div>
        <img src="assets/brand/product-4.jpeg" alt="Whipped Soap Boba">
      </section>

      <section class="promise">
        <div><strong>All Natural</strong><span>Botanical oils &amp; butters</span></div>
        <div><strong>Cruelty Free</strong><span>Never tested on animals</span></div>
        <div><strong>Sulfate Free</strong><span>No SLS or SLES</span></div>
        <div><strong>Paraben Free</strong><span>Gently preserved</span></div>
      </section>

      <div class="section-heading"><h2>What goes in</h2><span class="muted">And what it does</span></div>
      <section class="ingredient-grid">
        <article class="ingredient-card" *ngFor="let ing of ingredients">
          <h3>{{ ing.name }}</h3>
          <span class="ingredient-role">{{ ing.role }}</span>
          <p>{{ ing.body }}</p>
        </article>
      </section>

      <div class="section-heading"><h2>What never goes in</h2><span class="muted">Our no-list</span></div>
      <section class="no-list">
        <span *ngFor="let item of neverList">✕ {{ item }}</span>
      </section>

      <section class="cta-band">
        <div><h2>Questions about a blend?</h2><p>Every jar lists its full blend on the label.</p></div>
        <a class="btn-primary" routerLink="/care">Read care guide</a>
      </section>
    </div>
  `
})
export class Ingredients {
  ingredients = [
    { name: 'Shea Butter', role: 'Base · Nourishing', body: 'Cold-pressed and unrefined. It gives our whipped soaps their cloud-like body and leaves skin soft rather than tight.' },
    { name: 'Virgin Coconut Oil', role: 'Base · Cleansing', body: 'A gentle natural cleanser that lathers beautifully without stripping the skin of its own moisture.' },
    { name: 'Rose Petal Extract', role: 'Botanical · Soothing', body: 'Steeped from whole dried petals. Calming for sensitive skin and the reason Potion No. 04 smells like a garden at dusk.' },
    { name: 'Cardamom & Clove', role: 'Botanical · Warming', body: 'Hand-ground whole spices give Chai Spice Soul its warmth. Naturally antibacterial and deeply grounding.' },
    { name: 'Kaolin Clay', role: 'Mineral · Purifying', body: 'The mildest of the clays. It draws out impurities while keeping the whipped texture light and spoonable.' },
    { name: 'Vitamin E', role: 'Preservative · Protective', body: 'A natural antioxidant that keeps our oils fresh — so we never need parabens to do the job.' }
  ];
  neverList = ['Sulfates (SLS/SLES)', 'Parabens', 'Synthetic dyes', 'Mineral oil', 'Animal testing', 'Microplastics'];
}

@Component({
  standalone: true, imports: [CommonModule, RouterLink],
  template: `
    <div class="page">
      <section class="content-hero">
        <div>
          <div class="eyebrow">Make it last</div>
          <h1>Care</h1>
          <p>Whipped soap is a fresh product, not a shelf-stable bar. A little care keeps every jar as soft and fragrant as the day it was made.</p>
        </div>
        <img src="assets/brand/product-1.jpeg" alt="Potion No. 04">
      </section>

      <div class="section-heading"><h2>Caring for your jar</h2><span class="muted">Four simple habits</span></div>
      <section class="care-grid">
        <article class="care-card" *ngFor="let tip of tips">
          <span class="care-num">{{ tip.n }}</span>
          <h3>{{ tip.title }}</h3>
          <p>{{ tip.body }}</p>
        </article>
      </section>

      <div class="section-heading"><h2>Good to know</h2><span class="muted">Common questions</span></div>
      <section class="faq-list">
        <details class="faq" *ngFor="let f of faqs">
          <summary>{{ f.q }}</summary>
          <p>{{ f.a }}</p>
        </details>
      </section>

      <section class="cta-band">
        <div><h2>Still need a hand?</h2><p>Our delivery and returns details sit with every order.</p></div>
        <a class="btn-primary" routerLink="/orders">View my orders</a>
      </section>
    </div>
  `
})
export class Care {
  tips = [
    { n: '01', title: 'Use a dry spoon', body: 'Always scoop with the wooden spoon provided, and keep it dry. Water introduced into the jar shortens the life of the whip.' },
    { n: '02', title: 'Seal it after every use', body: 'Close the lid firmly and store away from direct steam. An open jar in a hot bathroom will lose its texture within weeks.' },
    { n: '03', title: 'Keep it cool and shaded', body: 'A cupboard or shelf away from sunlight is ideal. Our butters soften above 30°C — if that happens, simply stir and re-chill.' },
    { n: '04', title: 'Patch test first', body: 'Natural botanicals are still active. Try a small amount on your inner arm before a full-body soak, especially on sensitive skin.' }
  ];
  faqs = [
    { q: 'How long does a jar last?', a: 'Twelve months unopened, and about six months once opened if you keep it dry and sealed. Each jar is stamped with its batch date.' },
    { q: 'Has it separated or gone grainy?', a: 'That is the shea butter reacting to warmth, not spoilage. Stir it firmly with the spoon and leave it somewhere cool for an hour.' },
    { q: 'Is it safe for sensitive skin?', a: 'Our blends are sulfate and paraben free and mild by design, but we always recommend a patch test. Avoid broken or irritated skin.' },
    { q: 'Can I use it on my face?', a: 'The whipped soaps are formulated for the body. Kaolin clay is gentle, but facial skin is thinner — we would not suggest it.' },
    { q: 'Is the packaging recyclable?', a: 'Yes. The glass jars and aluminium tins are endlessly reusable, and our block-printed cotton pouches are made to be kept.' }
  ];
}

@Component({
  standalone: true, imports: [CommonModule, RouterLink],
  template: `
    <div class="page">
      <section class="content-hero">
        <div>
          <div class="eyebrow">Our story</div>
          <h1>About Us</h1>
          <p>The Bathany began in a home kitchen with one stubborn idea: that a bath should feel like a ritual, not a chore. We still whip every batch by hand, in small quantities, in India.</p>
        </div>
        <img src="assets/brand/product-2.jpeg" alt="Chai Spice Soul Whipped Soap">
      </section>

      <section class="ritual-list">
        <article class="ritual" *ngFor="let chapter of story; let i = index" [class.reverse]="i % 2 === 1">
          <img [src]="chapter.image" [alt]="chapter.title">
          <div>
            <div class="eyebrow">{{ chapter.step }}</div>
            <h3>{{ chapter.title }}</h3>
            <p>{{ chapter.body }}</p>
            <ul class="detail-points"><li *ngFor="let point of chapter.points">{{ point }}</li></ul>
          </div>
        </article>
      </section>

      <section class="promise">
        <div><strong>All Natural</strong><span>Botanical oils &amp; butters</span></div>
        <div><strong>Cruelty Free</strong><span>Never tested on animals</span></div>
        <div><strong>Small Batch</strong><span>Whipped by hand, never mass produced</span></div>
        <div><strong>Made in India</strong><span>Locally sourced, locally made</span></div>
      </section>

      <div class="section-heading"><h2>What we stand for</h2><span class="muted">The rules we don't bend</span></div>
      <section class="care-grid">
        <article class="care-card" *ngFor="let value of values">
          <span class="care-num">{{ value.n }}</span>
          <h3>{{ value.title }}</h3>
          <p>{{ value.body }}</p>
        </article>
      </section>

      <div class="section-heading"><h2>Questions about us</h2><span class="muted">The things people ask</span></div>
      <section class="faq-list">
        <details class="faq" *ngFor="let f of faqs">
          <summary>{{ f.q }}</summary>
          <p>{{ f.a }}</p>
        </details>
      </section>

      <section class="cta-band">
        <div><h2>Come soak with us</h2><p>Four rituals, whipped by hand and waiting.</p></div>
        <a class="btn-primary" routerLink="/shop">Shop the collection</a>
      </section>
    </div>
  `
})
export class About {
  story = [
    { step: 'The beginning', title: 'One jar, one kitchen', image: 'assets/brand/product-1.jpeg',
      body: 'We started because we could not find a bath product we actually trusted. Everything on the shelf was either harsh, over-fragranced, or vague about what was inside. So we began whipping our own — one jar at a time, on a kitchen counter, until the texture was right.',
      points: ['First batch made for friends and family', 'Reformulated more times than we care to admit', 'The rose blend became Potion No. 04'] },
    { step: 'How we make it', title: 'Slow, small and by hand', image: 'assets/brand/product-3.jpeg',
      body: 'Every batch is still whipped by hand in small quantities. It takes longer and it does not scale neatly, but it is the only way we can check the texture of every jar and keep our blends genuinely fresh rather than shelf-stable for years.',
      points: ['Cold-pressed butters, never heat-stripped', 'Whole spices and petals, ground in-house', 'Each jar stamped with its batch date'] },
    { step: 'Where we are going', title: 'Better, not bigger', image: 'assets/brand/product-4.jpeg',
      body: 'We would rather deepen the collection than flood it. New blends only launch once they earn their place, and we will keep publishing our full ingredient list so you never have to take our word for it.',
      points: ['Reusable glass jars and aluminium tins', 'Block-printed cotton pouches made to be kept', 'Botanicals sourced from Indian growers'] }
  ];
  values = [
    { n: '01', title: 'Say what is inside', body: 'Every jar lists its full blend on the label, and our Ingredients page explains what each element does and why it is there. No proprietary mystery blends.' },
    { n: '02', title: 'Gentle by default', body: 'Sulfate free, paraben free, and mild by design. If an ingredient only exists to make lather look more dramatic, it does not go in.' },
    { n: '03', title: 'Never on animals', body: 'Nothing we make is tested on animals, at any stage, by us or anyone we work with. This is not negotiable.' },
    { n: '04', title: 'Small batch, always', body: 'We cap our batch sizes so we can check texture and scent by hand. Selling out for a week is a fair price for getting it right.' }
  ];
  faqs = [
    { q: 'Where is The Bathany made?', a: 'Everything is blended and whipped by hand in India, using botanicals sourced from Indian growers wherever the ingredient allows it.' },
    { q: 'Are you really cruelty free?', a: 'Yes. No product or ingredient we use is tested on animals, at any stage, by us or by our suppliers.' },
    { q: 'Why is the collection so small?', a: 'Because every blend has to earn its place. We would rather make four things properly than forty things adequately — and small batches let us keep quality consistent.' },
    { q: 'Do you ship across India?', a: 'Yes, we ship nationwide, and shipping is free on orders over ₹999. Delivery and returns details are included with every order.' },
    { q: 'How do I reach you?', a: 'Order-specific questions are best raised from your order in the My Orders page, so we can see exactly which batch and shipment you mean.' }
  ];
}

@Component({
  standalone: true, imports: [CommonModule, RouterLink],
  template: `
    <div class="page">
      <section class="content-hero">
        <div>
          <div class="eyebrow">We're listening</div>
          <h1>Contact Us</h1>
          <p>Questions about a blend, an order, or which ritual to start with? Write to us and a real person will read it — usually within one working day.</p>
        </div>
        <img src="assets/brand/product-1.jpeg" alt="Potion No. 04">
      </section>

      <div class="section-heading"><h2>How to reach us</h2><span class="muted">Pick whichever suits</span></div>
      <section class="care-grid">
        <article class="care-card" *ngFor="let channel of channels">
          <span class="care-num">{{ channel.n }}</span>
          <h3>{{ channel.title }}</h3>
          <p>{{ channel.body }}</p>
          <p *ngIf="channel.email">
            <a class="contact-link" [href]="'mailto:' + channel.email">{{ channel.email }}</a>
          </p>
          <p *ngIf="channel.link">
            <a class="contact-link" [routerLink]="channel.link">{{ channel.linkLabel }}</a>
          </p>
        </article>
      </section>

      <div class="section-heading"><h2>Before you write</h2><span class="muted">These may answer it faster</span></div>
      <section class="faq-list">
        <details class="faq" *ngFor="let f of faqs">
          <summary>{{ f.q }}</summary>
          <p>{{ f.a }}</p>
        </details>
      </section>

      <section class="cta-band">
        <div><h2>Still have a question?</h2><p>Email us at {{ supportEmail }} and we'll take it from there.</p></div>
        <a class="btn-primary" [href]="'mailto:' + supportEmail">Email us</a>
      </section>
    </div>
  `
})
export class Contact {
  supportEmail = 'support@bathany.com';
  channels = [
    { n: '01', title: 'Email us', body: 'The best way to reach us for anything — product questions, ingredient queries, wholesale or press. We aim to reply within one working day.', email: 'support@bathany.com', link: '', linkLabel: '' },
    { n: '02', title: 'About an order', body: 'Open the order in your account first. Quoting the order number lets us check the exact batch and shipment straight away.', email: '', link: '/orders', linkLabel: 'View my orders' },
    { n: '03', title: 'Ingredients and sensitivities', body: 'Every blend is listed in full on our Ingredients page. If you are checking against a known allergy, email us and we will confirm before you buy.', email: '', link: '/ingredients', linkLabel: 'See all ingredients' },
    { n: '04', title: 'Caring for your jar', body: 'Texture changed, or not sure how long a jar lasts? Our care guide covers storage, shelf life and the most common surprises.', email: '', link: '/care', linkLabel: 'Read care guide' }
  ];
  faqs = [
    { q: 'How quickly will I hear back?', a: 'We aim to reply to every email within one working day. Weekends and public holidays may add a little to that.' },
    { q: 'Where do I find my order number?', a: 'It is shown against each order in the My Orders page, and repeated in your order confirmation. Quoting it helps us answer in one reply rather than three.' },
    { q: 'Can I change or cancel an order?', a: 'Write to us as soon as you can. If the order has not yet been packed we can usually amend it; once it has shipped we will help you with a return instead.' },
    { q: 'Do you take wholesale or stockist enquiries?', a: 'Yes. Email us with a little about your shop and we will send you our wholesale terms.' },
    { q: 'My order arrived damaged — what now?', a: 'Email us a photo along with your order number. We will arrange a replacement or refund without asking you to post anything back.' }
  ];
}

/** Minimum time the loader stays on screen once it is actually visible to the user. */
const SPLASH_MIN_VISIBLE_MS = 1400;

/**
 * Removes the pre-Angular splash once the app has rendered, with a short fade.
 *
 * The hold is measured from when the splash first painted while the document was visible, not
 * from navigation start. In an installed PWA the OS covers the page with its own icon screen
 * during startup, so a navigation-start hold can elapse entirely behind that screen and the
 * loader would never be seen.
 */
function dismissSplash() {
  const splash = document.getElementById('app-splash');
  if (!splash) return;

  const hide = () => {
    splash.classList.add('is-hidden');
    setTimeout(() => splash.remove(), 600);
  };

  const waitForVisibleThenHide = () => {
    const shownAt: number | undefined = (window as any).__splashShownAt;
    if (shownAt === undefined) {
      // The first visible frame hasn't been recorded yet; re-check on the next one.
      requestAnimationFrame(waitForVisibleThenHide);
      return;
    }
    setTimeout(hide, Math.max(0, SPLASH_MIN_VISIBLE_MS - (performance.now() - shownAt)));
  };

  if (document.visibilityState === 'visible') waitForVisibleThenHide();
  else document.addEventListener('visibilitychange', function once() {
    if (document.visibilityState !== 'visible') return;
    document.removeEventListener('visibilitychange', once);
    waitForVisibleThenHide();
  });
}

bootstrapApplication(App, { providers: [
  provideHttpClient(withInterceptors([appSessionInterceptor])),
  { provide: APP_SESSION_API_ORIGIN, useValue: API_ORIGIN },
  provideAppInitializer(() => {
    const sessions = inject(AppSessionClient);
    const errors = inject(ErrorHandler);
    return sessions.bootstrap().catch(error => {
      // Render the offline-session warning rather than leaving the app stuck at bootstrap.
      errors.handleError(error);
    });
  }),
  { provide: LOCALE_ID, useValue: 'en-IN' }, { provide: DEFAULT_CURRENCY_CODE, useValue: 'INR' }, provideRouter([{ path: '', component: Shop }, { path: 'shop', component: Shop }, { path: 'detail/:id', component: Detail }, { path: 'rituals', component: Rituals }, { path: 'ingredients', component: Ingredients }, { path: 'care', component: Care }, { path: 'about', component: About }, { path: 'contact', component: Contact }, { path: 'cart', component: Cart }, { path: 'wishlist', component: Wishlist }, { path: 'install/:platform', component: InstallGuide }, { path: 'login', component: Login }, { path: 'register', component: Register }, { path: 'forgot-password', component: ForgotPassword }, { path: 'reset-password', component: ResetPassword }, { path: 'orders', component: Orders }, { path: 'payments', component: Payments }, { path: 'admin', component: Admin }]), provideServiceWorker('ngsw-worker.js', {
            enabled: !isDevMode(),
            registrationStrategy: 'registerWhenStable:30000'
          })] }).then(dismissSplash).catch(err => { dismissSplash(); console.error(err); });
