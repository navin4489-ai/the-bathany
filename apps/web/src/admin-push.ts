import { Component, Injectable, OnInit, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { SwPush } from '@angular/service-worker';
import { firstValueFrom, timeout, TimeoutError } from 'rxjs';

interface PushStatus {
  enabled: boolean;
  publicKey: string | null;
  message: string | null;
  subscribed: boolean;
  suspended: boolean;
}

@Injectable({ providedIn: 'root' })
export class AdminPush {
  private readonly base = `${typeof location !== 'undefined' && location.port === '4200' ? 'http://localhost:5000' : ''}/api/admin/push`;
  readonly busy = signal(false);
  readonly subscribed = signal(false);
  readonly browserSubscribed = signal(false);
  readonly available = signal(false);
  readonly message = signal('');
  private publicKey = '';

  constructor(private readonly http: HttpClient, private readonly swPush: SwPush) {}

  private headers() {
    const token = localStorage.getItem('token');
    if (!token) throw new Error('Sign in as an administrator to manage notifications.');
    return { Authorization: `Bearer ${token}` };
  }

  async status(): Promise<void> {
    if (this.busy()) {
      this.message.set('A notification update is in progress. Wait and retry refreshing notifications.');
      return;
    }
    this.available.set(false);
    if (!this.swPush.isEnabled || !globalThis.isSecureContext) {
      this.message.set('Push requires HTTPS and the installed production PWA service worker. On iPhone/iPad, add this app to your Home Screen first.');
      return;
    }
    this.busy.set(true);
    try {
      const subscription = await firstValueFrom(this.swPush.subscription.pipe(timeout(40000)));
      this.browserSubscribed.set(!!subscription);
      const config = await firstValueFrom(this.http.post<PushStatus>(`${this.base}/status`,
        { endpoint: subscription?.endpoint ?? null }, { headers: this.headers() }).pipe(timeout(10000)));
      this.subscribed.set(!!subscription && config.subscribed);
      if (!config.enabled || !config.publicKey || !/^[A-Za-z0-9_-]{87}$/.test(config.publicKey))
        throw new Error(config.message || 'Web Push is not configured on the server.');
      this.publicKey = config.publicKey;
      this.available.set(true);
      this.message.set(config.suspended
        ? 'Push delivery paused after repeated failures. Reconnect notifications to retry the retained activities.'
        : this.subscribed() ? 'Notifications are enabled for this administrator.'
        : 'Enable notifications to receive store activity while the app is closed.');
    } catch (error) { this.message.set(this.errorMessage(error)); }
    finally { this.busy.set(false); }
  }

  async refresh(): Promise<void> { await this.status(); }

  // Only invoke from a button click. No constructor/init code requests permission.
  async enable(): Promise<void> {
    if (this.busy() || !this.available()) return;
    this.busy.set(true);
    try {
      const headers = this.headers();
      const subscription = await this.swPush.requestSubscription({ serverPublicKey: this.publicKey });
      this.browserSubscribed.set(true);
      const body = subscription.toJSON();
      if (!body.endpoint || body.endpoint.length > 2048 || !body.endpoint.startsWith('https://') ||
          !/^[A-Za-z0-9_-]{87}$/.test(body.keys?.['p256dh'] || '') ||
          !/^[A-Za-z0-9_-]{22}$/.test(body.keys?.['auth'] || ''))
        throw new Error('The browser returned an incomplete push subscription.');
      await firstValueFrom(this.http.post(`${this.base}/subscriptions`, body, { headers }).pipe(timeout(10000)));
      this.subscribed.set(true);
      this.message.set('Notifications enabled for this administrator.');
    } catch (error) { this.message.set(this.errorMessage(error)); }
    finally { this.busy.set(false); }
  }

  async disable(): Promise<void> {
    try { await this.disableForLogout(); }
    catch (error) { this.message.set(this.errorMessage(error)); }
  }

  async disableForLogout(): Promise<void> {
    if (!this.swPush.isEnabled) return;
    if (this.busy()) {
      const message = 'A notification update is in progress. Wait and retry signing out.';
      this.message.set(message);
      throw new Error(message);
    }
    this.busy.set(true);
    try {
      await this.removeSubscription();
      this.subscribed.set(false);
      this.browserSubscribed.set(false);
      this.message.set('Notifications disabled.');
    } catch (error) {
      const message = `Could not disable notifications before signing out: ${this.errorMessage(error)}`;
      this.message.set(message);
      throw new Error(message);
    }
    finally { this.busy.set(false); }
  }

  private async removeSubscription(): Promise<void> {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration?.active) return;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    // Remove server delivery first. If it fails, retain the browser endpoint so retry is possible.
    await firstValueFrom(this.http.delete(`${this.base}/subscriptions`, {
      headers: this.headers(), body: { endpoint: subscription.endpoint }
    }).pipe(timeout(10000)));
    const removed = await subscription.unsubscribe();
    // False is harmless if another tab already removed it; inspect the actual browser state.
    if (!removed && await registration.pushManager.getSubscription())
      throw new Error('The browser could not remove its push subscription. Retry disabling notifications before signing out.');
  }

  private errorMessage(error: unknown): string {
    if (error instanceof TimeoutError)
      return 'Notifications are not ready or the server timed out. Use Refresh notifications and retry.';
    if (error instanceof HttpErrorResponse) {
      if (error.status === 401 || error.status === 403) return 'A current administrator account is required for push notifications.';
      return error.error?.detail || error.error?.message || 'Could not update server notifications. Please retry.';
    }
    return error instanceof Error ? error.message : 'Could not update notifications.';
  }
}

@Component({
  selector: 'app-admin-push',
  standalone: true,
  template: `<section aria-label="Admin push notifications">
    <p role="status">{{ push.message() }}</p>
    <button type="button" class="btn-light btn-sm" [disabled]="push.busy()" (click)="push.status()">Refresh notifications</button>
    <button type="button" class="btn-light btn-sm" [disabled]="push.busy() || !push.available()" (click)="push.enable()">
      {{ push.subscribed() ? 'Reconnect notifications' : 'Enable notifications' }}
    </button>
    @if (push.browserSubscribed()) {
      <button type="button" class="btn-light btn-sm" [disabled]="push.busy()" (click)="push.disable()">Disable notifications</button>
    }
  </section>`
})
export class AdminPushControls implements OnInit {
  constructor(readonly push: AdminPush) {}
  ngOnInit(): void { void this.push.status(); }
}
