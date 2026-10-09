import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { timeout } from 'rxjs';
import { APP_SESSION_API_ORIGIN } from './app-session';

export type ShopperActivity = 'CartAdd' | 'CartRemove' | 'CartQuantityChanged' |
  'WishlistAdd' | 'WishlistRemove' | 'PageView' | 'ProductView' | 'Search' |
  'CheckoutStarted' | 'PaymentCancelled' | 'PaymentFailed' | 'OfferClick';

@Injectable({ providedIn: 'root' })
export class ActivityTracker {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(APP_SESSION_API_ORIGIN)}/api/activity`;

  record(action: ShopperActivity, productId?: number, quantity?: number, path?: string): void {
    const token = localStorage.getItem('token');
    this.http.post(this.base, { action, productId, quantity, path }, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    }).pipe(timeout(10000)).subscribe({
      error: error => console.warn('Activity could not be recorded', action, error.status ?? 'network')
    });
  }
}
