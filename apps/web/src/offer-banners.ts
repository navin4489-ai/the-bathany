import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';

export interface Offer {
  id: number;
  title: string;
  description: string;
  imageUrl: string;
  enabled: boolean;
  startsAt: string;
  endsAt: string;
  updatedAt: string;
}

@Component({
  selector: 'app-offer-banners', standalone: true, imports: [CommonModule, RouterLink],
  template: `
    <section class="offer-banners" *ngIf="visible.length" aria-label="Current offers">
      <h2>Current offers</h2>
      <article class="offer-banner" *ngFor="let offer of visible">
        <a routerLink="/shop" [attr.aria-label]="'Shop ' + offer.title">
          <img [src]="apiOrigin + offer.imageUrl" [alt]="offer.title" loading="lazy">
        </a>
        <div>
          <h3>{{ offer.title }}</h3>
          <p *ngIf="offer.description">{{ offer.description }}</p>
          <p class="muted">Valid until {{ offer.endsAt | date:'medium' }}</p>
          <a class="btn-primary" routerLink="/shop">Shop now</a>
        </div>
      </article>
    </section>
    <p class="muted" *ngIf="error" role="status">{{ error }}</p>`
})
export class OfferBanners implements OnInit, OnDestroy {
  @Input() apiOrigin = '';
  offers: Offer[] = [];
  error = '';
  private polling?: ReturnType<typeof setInterval>;
  private expiry?: ReturnType<typeof setTimeout>;
  private request?: Subscription;
  private onFocus = () => this.load();
  constructor(private http: HttpClient) {}
  get visible() {
    const now = Date.now();
    return this.offers.filter(o => o.enabled && Date.parse(o.startsAt) <= now && Date.parse(o.endsAt) > now);
  }
  ngOnInit() {
    this.load();
    this.polling = setInterval(() => this.load(), 30000);
    window.addEventListener('focus', this.onFocus);
  }
  private load() {
    this.request?.unsubscribe();
    this.request = this.http.get<Offer[]>(`${this.apiOrigin}/api/offers`).subscribe({
      next: offers => {
        this.offers = offers;
        this.error = '';
        this.scheduleExpiry();
      },
      error: () => { this.error = 'Offers could not be refreshed. Please check your connection.'; }
    });
  }
  private scheduleExpiry() {
    clearTimeout(this.expiry);
    const remaining = this.offers.map(o => Date.parse(o.endsAt) - Date.now()).filter(t => t > 0);
    if (remaining.length) {
      this.expiry = setTimeout(() => {
        this.offers = this.visible;
        this.scheduleExpiry();
      }, Math.min(Math.min(...remaining) + 10, 2147483647));
    }
  }
  ngOnDestroy() {
    clearInterval(this.polling);
    clearTimeout(this.expiry);
    this.request?.unsubscribe();
    window.removeEventListener('focus', this.onFocus);
  }
}
