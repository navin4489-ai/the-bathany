import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { ActivatedRoute, provideRouter, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Component, Injectable, LOCALE_ID, DEFAULT_CURRENCY_CODE, OnDestroy } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe, UpperCasePipe, registerLocaleData } from '@angular/common';
import localeIn from '@angular/common/locales/en-IN';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { timeout } from 'rxjs/operators';

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
  orders() { return this.http.get<any[]>(`${this.base}/orders`, { headers: this.authHeaders() }); }
  admin(path: string) { return this.http.get<any>(`${this.base}/admin/${path}`, { headers: this.authHeaders() }); }
  adminPost(path: string, body: unknown) { return this.http.post<any>(`${this.base}/admin/${path}`, body, { headers: this.authHeaders() }); }
  adminPut(path: string, body: unknown) { return this.http.put<any>(`${this.base}/admin/${path}`, body, { headers: this.authHeaders() }); }
  adminDelete(path: string) { return this.http.delete<any>(`${this.base}/admin/${path}`, { headers: this.authHeaders() }); }
  uploadProductImage(file: File) {
    const data = new FormData();
    data.append('file', file);
    return this.http.post<{ url: string }>(`${this.base}/admin/uploads/product-image`, data, { headers: this.authHeaders() });
  }
  login(body: unknown) { return this.http.post<{ accessToken: string }>(`${this.base}/auth/login`, body); }
  register(body: unknown) { return this.http.post<{ id: number; email: string }>(`${this.base}/auth/register`, body); }
  forgotPassword(body: unknown) { return this.http.post<any>(`${this.base}/auth/forgot-password`, body); }
  resetPassword(body: unknown) { return this.http.post<any>(`${this.base}/auth/reset-password`, body); }
  changePassword(body: unknown) { return this.http.post<any>(`${this.base}/auth/change-password`, body, { headers: this.authHeaders() }); }
  adminResetPassword(id: number, body: unknown) { return this.http.post<any>(`${this.base}/admin/users/${id}/reset-password`, body, { headers: this.authHeaders() }); }
}

@Injectable({ providedIn: 'root' })
export class Auth {
  private decode(token: string): any {
    try { return JSON.parse(atob(token.split('.')[1])); } catch { return null; }
  }
  get token() { return localStorage.getItem('token'); }
  get claims() { const t = this.token; return t ? this.decode(t) : null; }
  get isLoggedIn() {
    const c = this.claims;
    if (!c) return false;
    if (c.exp && c.exp * 1000 < Date.now()) { this.logout(); return false; }
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

@Injectable({ providedIn: 'root' })
export class CartStore {
  lines: Line[] = JSON.parse(localStorage.getItem('cart-products') || '[]');
  constructor(private toast: Toast) {}
  save() { localStorage.setItem('cart-products', JSON.stringify(this.lines)); }
  add(product: Product) {
    const line = this.lines.find(item => item.product.id === product.id);
    line ? line.quantity++ : this.lines.push({ product, quantity: 1 });
    this.save();
    this.toast.show(`${product.name} added to your cart`);
  }
  remove(index: number) {
    const [removed] = this.lines.splice(index, 1);
    this.save();
    if (removed) this.toast.show(`${removed.product.name} removed from your cart`);
  }
  total() { return this.lines.reduce((sum, item) => sum + item.product.price * item.quantity, 0); }
}

@Injectable({ providedIn: 'root' })
export class WishlistStore {
  items: Product[] = JSON.parse(localStorage.getItem('wishlist-products') || '[]');
  constructor(private toast: Toast) {}
  private save() { localStorage.setItem('wishlist-products', JSON.stringify(this.items)); }
  has(id: number) { return this.items.some(p => p.id === id); }
  /** Toggling keeps a single heart control in the UI for both add and remove. */
  toggle(product: Product) {
    const index = this.items.findIndex(p => p.id === product.id);
    if (index >= 0) {
      this.items.splice(index, 1);
      this.toast.show(`${product.name} removed from your wishlist`);
    } else {
      this.items.push(product);
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

@Component({
  selector: 'app-root', standalone: true, imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="topbar">
      <span>Handcrafted in India · Free shipping over ₹999</span>
      <span class="topbar-links">
        <a routerLink="/rituals">Our Rituals</a><a routerLink="/ingredients">Ingredients</a><a routerLink="/care">Care</a>
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
      <div class="search"><input placeholder="Search whipped soaps, potions, bath clouds…"><button aria-label="Search">⌕</button></div>
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
      <a routerLink="/orders" routerLinkActive="active">My Orders</a>
      <a *ngIf="!auth.isLoggedIn" routerLink="/login" routerLinkActive="active">Login</a>
      <a *ngIf="!auth.isLoggedIn" routerLink="/register" routerLinkActive="active">Sign up</a>
      <a *ngIf="auth.isAdmin" routerLink="/admin" routerLinkActive="active">Admin</a>
    </nav>
    <main><router-outlet></router-outlet></main>
    <div class="toast" role="status" aria-live="polite" *ngIf="toast.message">✓ {{ toast.message }}</div>
    <footer class="site-footer">
      <div class="footer-brand">
        <img class="footer-logo" src="assets/brand/logo.jpeg" alt="The Bathany">
        <div><strong>The Bathany</strong><span>Small-batch bath rituals, handcrafted in India.</span></div>
      </div>
      <div class="footer-note"><span class="footer-links"><a routerLink="/rituals">Our Rituals</a><a routerLink="/ingredients">Ingredients</a><a routerLink="/care">Care</a></span><span>All natural · Cruelty free · Sulfate free · Paraben free</span><span>© {{ year }} The Bathany. Secure test checkout.</span></div>
    </footer>
  `
})
export class App {
  year = new Date().getFullYear();
  menuOpen = false;
  constructor(public cart: CartStore, public toast: Toast, public auth: Auth, public wishlist: WishlistStore, private router: Router) {}
  logout(event?: Event) { event?.preventDefault(); this.auth.logout(); this.toast.show('You have been signed out'); this.router.navigateByUrl('/'); }
}

@Component({
  standalone: true, imports: [CommonModule, FormsModule, CurrencyPipe, RouterLink],
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
      <div class="section-heading" id="collection"><h2>The collection</h2><span class="muted">Four rituals, endlessly whimsical</span></div>
      <div class="toolbar"><input [(ngModel)]="query" (ngModelChange)="load()" placeholder="Search the collection"></div>
      <section class="grid"><article class="product-card" *ngFor="let p of products"><a [routerLink]="['/detail', p.id]"><img [src]="img(p.imageUrl)" [alt]="p.name"></a><button class="wish-btn" [class.on]="wishlist.has(p.id)" (click)="wishlist.toggle(p)" [attr.aria-pressed]="wishlist.has(p.id)" [attr.aria-label]="(wishlist.has(p.id) ? 'Remove ' + p.name + ' from wishlist' : 'Save ' + p.name + ' to wishlist')">{{ wishlist.has(p.id) ? '♥' : '♡' }}</button><div class="product-info"><h3><a [routerLink]="['/detail', p.id]">{{ p.name }}</a></h3><p>{{ p.description }}</p><span class="price">{{ p.price | currency }}</span><button class="btn-primary" (click)="cart.add(p)">Add to cart</button></div></article></section>
    </div>
  `
})
export class Shop implements OnDestroy {
  products: Product[] = []; query = '';
  slides = ['assets/brand/product-4.jpeg', 'assets/brand/product-1.jpeg', 'assets/brand/product-3.jpeg', 'assets/brand/product-2.jpeg'];
  activeSlide = 0;
  private timer?: ReturnType<typeof setInterval>;
  constructor(private api: Api, public cart: CartStore, public wishlist: WishlistStore) { this.load(); this.startCarousel(); }
  load() { this.api.products(this.query).subscribe(products => this.products = products); }
  img = imageSrc;
  scrollToCollection() { document.getElementById('collection')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  private startCarousel() { this.timer = setInterval(() => this.activeSlide = (this.activeSlide + 1) % this.slides.length, 4000); }
  goToSlide(index: number) {
    this.activeSlide = index;
    if (this.timer) clearInterval(this.timer);
    this.startCarousel();
  }
  ngOnDestroy() { if (this.timer) clearInterval(this.timer); }
}

@Component({
  standalone: true, imports: [CommonModule, CurrencyPipe, RouterLink],
  template: `<div class="page" *ngIf="product"><div class="hero"><img [src]="img(product.imageUrl)" [alt]="product.name"><div><div class="eyebrow">The Bathany</div><h1>{{ product.name }}</h1><p>{{ product.description }}</p><span class="price">{{ product.price | currency }}</span><ul class="detail-points"><li>All natural botanical blend</li><li>Cruelty free · Sulfate free · Paraben free</li><li>Handcrafted in small batches in India</li></ul><div class="detail-actions"><button class="btn-primary" (click)="cart.add(product)">Add to cart</button><button class="btn-light wish-inline" [class.on]="wishlist.has(product.id)" (click)="wishlist.toggle(product)" [attr.aria-pressed]="wishlist.has(product.id)">{{ wishlist.has(product.id) ? '♥ Saved' : '♡ Add to wishlist' }}</button></div></div></div><a routerLink="/shop">← Back to the collection</a></div>`
})
export class Detail {
  product!: Product;
  img = imageSrc;
  constructor(private api: Api, private route: ActivatedRoute, public cart: CartStore, public wishlist: WishlistStore) {
    const id = Number(this.route.snapshot.paramMap.get('id')) || 1;
    this.api.product(id).subscribe(product => this.product = product);
  }
}

@Component({
  standalone: true, imports: [CommonModule, FormsModule, CurrencyPipe, UpperCasePipe, RouterLink],
  template: `
    <div class="page"><div class="section-heading"><h1>Shopping cart</h1><a routerLink="/" class="muted">Continue shopping →</a></div>
      <p *ngIf="!cart.lines.length" class="muted">Your cart is empty. Add something you love.</p>
      <div *ngFor="let line of cart.lines; let i=index" class="cart-row"><strong>{{ line.product.name }}</strong><input type="number" min="1" [(ngModel)]="line.quantity" (ngModelChange)="cart.save()"><span>{{ line.product.price * line.quantity | currency }}</span><button class="btn-light" (click)="cart.remove(i)">Remove</button></div>
      <div class="summary"><div class="summary-line"><span>Subtotal</span><strong>{{ cart.total() | currency }}</strong></div><div class="summary-line"><span>Shipping</span><span>Free</span></div><hr><div class="summary-line"><strong>Total</strong><strong class="price">{{ cart.total() | currency }}</strong></div>
        <div class="ship-panel">
          <div class="pay-brand"><span class="ship-badge">Delivery</span><strong>Shipping address</strong></div>
          <p class="muted pay-note">Where should we deliver this order?</p>
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
          <label class="ship-save"><input type="checkbox" [(ngModel)]="saveAddress"> Save this address for next time</label>
        </div>
        <div class="pay-panel">
          <div class="pay-brand"><span class="pay-badge">Sandbox</span><strong>The Bathany Secure Pay</strong></div>
          <p class="muted pay-note">No real money moves. Use a test card below to simulate results.</p>

          <div class="pay-methods">
            <button type="button" class="pay-method" *ngFor="let m of methods" [class.selected]="method === m.code" (click)="method = m.code">
              <strong>{{ m.label }}</strong><span class="muted">{{ m.description }}</span>
            </button>
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

          <button class="btn-primary pay-submit" [disabled]="!cart.lines.length || placing" (click)="checkout()">{{ placing ? 'Processing payment…' : 'Pay ' + (cart.total() | currency) }}</button>
          <p class="pay-error" *ngIf="message">{{ message }}</p>
        </div>
      </div>
    </div>
    <div class="modal-backdrop" *ngIf="confirmed" (click)="close()">
      <div class="order-modal" (click)="$event.stopPropagation()">
        <img class="modal-crest" src="assets/brand/logo.jpeg" alt="The Bathany">
        <div class="order-modal-check">✓</div>
        <h2>Thank you for your order!</h2>
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
        <div class="order-modal-actions"><a class="btn-primary" routerLink="/orders" (click)="close()">View my orders</a><button class="btn-light" (click)="close()">Continue shopping</button></div>
      </div>
    </div>
  `
})
export class Cart {
  paymentToken = 'test_approved'; message = ''; placing = false; confirmed: any = null;
  method = 'card';
  card = { number: '', holderName: '', expiry: '', cvv: '' };
  address = { fullName: '', phone: '', line1: '', line2: '', landmark: '', city: '', state: '', postalCode: '', country: 'India' };
  saveAddress = true;
  states = ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Delhi','Goa','Gujarat','Haryana','Himachal Pradesh','Jammu & Kashmir','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Puducherry','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal'];
  methods: any[] = [];
  testCards: any[] = [];
  constructor(public cart: CartStore, private api: Api, private auth: Auth, private router: Router) {
    const saved = localStorage.getItem('shipping-address');
    if (saved) { try { this.address = { ...this.address, ...JSON.parse(saved) }; } catch { /* ignore malformed cache */ } }
    this.api.paymentMethods().subscribe(res => {
      this.methods = res?.methods?.length ? res.methods : [{ code: 'card', label: 'Credit / Debit Card', description: 'Pay securely with a test card.', requiresCard: true }];
      this.testCards = res?.testCards || [];
    });
  }
  requiresCard() { return this.methods.find(m => m.code === this.method)?.requiresCard ?? this.method === 'card'; }
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
  close() { this.confirmed = null; }
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
    if (!this.auth.isLoggedIn) { this.router.navigate(['/login'], { queryParams: { returnUrl: '/cart' } }); return; }
    const addressError = this.validateAddress();
    if (addressError) { this.message = addressError; return; }
    const idempotencyKey = crypto.randomUUID();
    this.placing = true; this.message = '';
    const body: any = {
      items: this.cart.lines.map(line => ({ productId: line.product.id, quantity: line.quantity })),
      paymentMethod: this.method,
      shippingAddress: { ...this.address },
      idempotencyKey
    };
    if (this.requiresCard()) body.card = { ...this.card, number: this.card.number.replace(/\s/g, '') };
    this.api.checkout(body)
      .subscribe({
        next: (order: any) => {
          this.placing = false;
          if (order?.status === 'PaymentFailed') { this.message = order?.payment?.failureReason || 'Payment was declined. Please try another card.'; return; }
          this.confirmed = order; this.cart.lines = []; this.cart.save();
          if (this.saveAddress) localStorage.setItem('shipping-address', JSON.stringify(this.address));
          else localStorage.removeItem('shipping-address');
          this.card = { number: '', holderName: '', expiry: '', cvv: '' };
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
  standalone: true, imports: [CommonModule, CurrencyPipe, DatePipe, RouterLink],
  template: `<div class="page"><div class="section-heading"><h1>My orders</h1><a routerLink="/shop" class="muted">Continue shopping →</a></div>
    <p *ngIf="error">{{ error }}</p>
    <p *ngIf="!error && !orders.length" class="muted">You have not placed any orders yet.</p>
    <article class="order-card" *ngFor="let order of orders">
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
    </article></div>`
})
export class Orders { orders: any[] = []; error = ''; constructor(api: Api) { api.orders().subscribe({ next: orders => this.orders = orders, error: () => this.error = 'Please sign in to view orders.' }); } }

@Component({
  standalone: true, imports: [CommonModule, FormsModule, DatePipe, CurrencyPipe],
  template: `<div class="page admin">
    <div class="section-heading">
      <div class="admin-title"><img class="admin-crest" src="assets/brand/logo.jpeg" alt="The Bathany"><div><div class="eyebrow">The Bathany</div><h1>Admin console</h1></div></div>
      <div class="admin-toolbar">
        <span class="muted" *ngIf="lastLoaded">Updated {{ lastLoaded | date:'shortTime' }}</span>
        <button class="btn-light" (click)="load()">Refresh</button>
      </div>
    </div>
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
          <tr *ngFor="let o of orders.slice(0, 5)"><td>#{{ o.id }}</td><td>{{ o.customer }}</td><td>{{ o.total | currency }}</td><td><span class="pill" [attr.data-status]="o.status">{{ o.status }}</span></td><td>{{ o.createdAt | date:'medium' }}</td></tr>
          <tr *ngIf="!orders.length"><td colspan="5" class="muted">No orders yet.</td></tr>
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
          <label>Image URL<input [(ngModel)]="editing.imageUrl" name="imageUrl" placeholder="/img/product-1.jpg"></label>
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
          <button class="btn-primary" type="submit" [disabled]="saving">{{ saving ? 'Saving…' : 'Save product' }}</button>
          <button class="link-btn" type="button" (click)="editing = null">Cancel</button>
        </div>
      </form>

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
          <tr *ngIf="!products.length"><td colspan="8" class="muted">No products yet.</td></tr>
        </tbody></table>
    </section>

    <!-- Orders -->
    <section *ngIf="section === 'orders'">
      <h2>Orders</h2>
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
          <tr *ngIf="!orders.length"><td colspan="8" class="muted">No orders yet.</td></tr>
        </tbody></table>
    </section>

    <!-- Users -->
    <section *ngIf="section === 'users'">
      <h2>Users</h2>
      <table class="data-table"><thead><tr><th>#</th><th>Email</th><th>Name</th><th>Role</th><th>Joined</th><th>Password</th></tr></thead>
        <tbody>
          <tr *ngFor="let u of users">
            <td>{{ u.id }}</td><td>{{ u.email }}</td><td>{{ u.displayName }}</td>
            <td>
              <select class="status-select" [ngModel]="u.role" (ngModelChange)="changeRole(u, $event)">
                <option *ngFor="let r of config.roles" [value]="r">{{ r }}</option>
              </select>
            </td>
            <td>{{ u.createdAt | date:'mediumDate' }}</td>
            <td>
              <button class="link-btn" *ngIf="resetFor !== u.id" (click)="startReset(u.id)">Reset password</button>
              <span class="admin-reset" *ngIf="resetFor === u.id">
                <input type="password" [(ngModel)]="newPassword" placeholder="New password">
                <button class="btn-primary" [disabled]="saving" (click)="confirmReset(u)">{{ saving ? 'Saving…' : 'Save' }}</button>
                <button class="link-btn" (click)="cancelReset()">Cancel</button>
              </span>
            </td>
          </tr>
          <tr *ngIf="!users.length"><td colspan="6" class="muted">No users yet.</td></tr>
        </tbody></table>
    </section>

    <!-- Activity -->
    <section *ngIf="section === 'activity'">
      <h2>Activity log</h2>
      <table class="data-table"><thead><tr><th>#</th><th>Action</th><th>Details</th><th>User</th><th>When</th></tr></thead>
        <tbody>
          <tr *ngFor="let a of activity"><td>{{ a.id }}</td><td><span class="pill" data-status="Active">{{ a.action }}</span></td><td>{{ a.details }}</td><td>{{ a.userId || '—' }}</td><td>{{ a.createdAt | date:'medium' }}</td></tr>
          <tr *ngIf="!activity.length"><td colspan="5" class="muted">No activity recorded.</td></tr>
        </tbody></table>
    </section>
  </div>`
})
export class Admin {
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
      { key: 'orders', label: 'Orders', icon: '\ud83e\uddfe' },
      { key: 'users', label: 'Users', icon: '\ud83d\udc65' },
      { key: 'activity', label: 'Activity', icon: '\ud83d\udd52' }
    ]
  };
  section = 'dashboard';
  stats: any = {};
  products: any[] = []; orders: any[] = []; users: any[] = []; activity: any[] = [];
  editing: any = null;
  resetFor: number | null = null; newPassword = '';
  saving = false; uploading = false; message = ''; error = ''; lastLoaded: Date | null = null;

  constructor(private api: Api) {
    this.load();
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
    this.api.admin('stats').subscribe({ next: s => this.stats = s, error: () => this.error = 'Sign in as an admin to load data.' });
    this.api.admin('products').subscribe({ next: d => this.products = d, error: () => this.products = [] });
    this.api.admin('orders').subscribe({ next: d => this.orders = d, error: () => this.orders = [] });
    this.api.admin('users').subscribe({ next: d => this.users = d, error: () => this.users = [] });
    this.api.admin('activity').subscribe({ next: d => this.activity = d, error: () => this.activity = [] });
    this.lastLoaded = new Date();
  }

  private flash(text: string) { this.message = text; this.error = ''; setTimeout(() => this.message = '', 4000); }
  private fail(err: any, fallbackText: string) { this.saving = false; this.error = err?.error?.detail || err?.error?.title || fallbackText; }

  newProduct() { this.editing = { name: '', description: '', price: 0, stock: 0, imageUrl: '', categoryId: this.config.categories[0]?.id || 1, isActive: true }; }
  editProduct(p: any) { this.editing = { ...p }; }

  uploadImage(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.uploading = true; this.error = '';
    this.api.uploadProductImage(file).subscribe({
      next: res => { this.uploading = false; this.editing.imageUrl = res.url; this.flash('Image uploaded.'); input.value = ''; },
      error: e => { this.uploading = false; input.value = ''; this.error = e?.error?.detail || 'Could not upload that image.'; }
    });
  }

  saveProduct() {
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

bootstrapApplication(App, { providers: [provideHttpClient(), { provide: LOCALE_ID, useValue: 'en-IN' }, { provide: DEFAULT_CURRENCY_CODE, useValue: 'INR' }, provideRouter([{ path: '', component: Shop }, { path: 'shop', component: Shop }, { path: 'detail/:id', component: Detail }, { path: 'rituals', component: Rituals }, { path: 'ingredients', component: Ingredients }, { path: 'care', component: Care }, { path: 'cart', component: Cart }, { path: 'wishlist', component: Wishlist }, { path: 'login', component: Login }, { path: 'register', component: Register }, { path: 'forgot-password', component: ForgotPassword }, { path: 'reset-password', component: ResetPassword }, { path: 'orders', component: Orders }, { path: 'admin', component: Admin }])] }).catch(console.error);

