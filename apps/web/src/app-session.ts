import { inject, Injectable, InjectionToken, signal } from '@angular/core';
import { HttpBackend, HttpClient, HttpErrorResponse, HttpInterceptorFn, HttpRequest, HttpResponse } from '@angular/common/http';
import { Observable, catchError, finalize, firstValueFrom, map, of, shareReplay, switchMap, tap, throwError, timeout } from 'rxjs';

export const APP_SESSION_API_ORIGIN = new InjectionToken<string>('APP_SESSION_API_ORIGIN', {
  providedIn: 'root',
  factory: () => typeof location !== 'undefined' && location.port === '4200' ? 'http://localhost:5000' : ''
});

export function isInstalledApp(): boolean {
  return typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true);
}

export interface TokenResponse { accessToken: string; }
interface TokenClaims { exp?: number; sid?: string; }

function tokenClaims(token: string | null): TokenClaims | null {
  if (!token) return null;
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as TokenClaims;
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof DOMException) return null;
    throw error;
  }
}

export class SessionSupersededError extends Error {
  constructor() { super('The account changed or signed out while session renewal was in progress.'); }
}

@Injectable({ providedIn: 'root' })
export class AppSessionClient {
  readonly mobile = isInstalledApp();
  readonly state = signal<'unknown' | 'active' | 'signed-out' | 'unavailable'>('unknown');
  readonly lastError = signal<unknown>(null);
  readonly base = `${inject(APP_SESSION_API_ORIGIN)}/api/auth`;
  // Bypass this interceptor for renewal itself; no recursive retries.
  private readonly http = new HttpClient(inject(HttpBackend));
  private flight?: Observable<TokenResponse>;
  private generation = 0;
  private renewedAt = 0;
  private retryAfter = 0;
  private blocked = localStorage.getItem('app-session-signed-out') === '1';

  get token(): string | null { return localStorage.getItem('token'); }
  get hasAppToken(): boolean { return !!tokenClaims(this.token)?.sid; }
  get needsRenewal(): boolean {
    const claims = tokenClaims(this.token);
    return !claims?.exp || claims.exp * 1000 <= Date.now() + 30_000;
  }
  get canRenew(): boolean {
    return this.mobile && !this.blocked &&
      (this.hasAppToken || this.state() === 'active');
  }
  /** Auth.isLoggedIn may retain expired app JWTs while renewal/offline recovery is pending. */
  get keepSignedInWhileRenewing(): boolean {
    return this.mobile && this.hasAppToken && !this.blocked &&
      localStorage.getItem('app-session-signed-out') !== '1' && this.state() !== 'signed-out';
  }
  get canRecoverUnauthorized(): boolean {
    return this.canRenew && (!!this.flight || Date.now() - this.renewedAt >= 30_000);
  }

  /** Missing/revoked cookies are normal on first installation; outages are not sign-outs. */
  bootstrap(): Promise<boolean> {
    if (!this.mobile || this.blocked) return Promise.resolve(false);
    return firstValueFrom(this.renew().pipe(
      map(() => true),
      catchError(error => error instanceof HttpErrorResponse && error.status === 401
        ? of(false) : throwError(() => error))
    ));
  }

  login(credentials: { email: string; password: string }): Observable<TokenResponse> {
    const generation = this.beginLogin();
    return this.http.post<TokenResponse>(`${this.base}/login`, {
      ...credentials, mobileApp: this.mobile
    }, {
      withCredentials: this.mobile,
      headers: this.mobile ? { 'X-App-Session': '1' } : {}
    }).pipe(
      timeout(15_000),
      tap(response => this.acceptLogin(response, this.mobile, generation))
    );
  }

  beginLogin(): number {
    return ++this.generation;
  }

  acceptLogin(response: TokenResponse, mobile: boolean, generation: number): void {
    if (generation !== this.generation) throw new SessionSupersededError();
    localStorage.setItem('token', response.accessToken);
    localStorage.removeItem('app-session-signed-out');
    this.blocked = false;
    this.retryAfter = 0;
    this.renewedAt = Date.now();
    this.lastError.set(null);
    this.state.set(mobile ? 'active' : 'unknown');
  }

  renew(): Observable<TokenResponse> {
    if (this.flight) return this.flight;
    if (this.blocked) return throwError(() => new HttpErrorResponse({
      status: 401, error: { code: 'app_session_invalid' }
    }));
    if (Date.now() < this.retryAfter) return throwError(() => this.lastError());
    const generation = this.generation;
    const tokenAtStart = this.token;
    const superseded = () => generation !== this.generation ||
      localStorage.getItem('app-session-signed-out') === '1' || this.token !== tokenAtStart;
    this.flight = this.http.post<TokenResponse>(`${this.base}/renew`, {}, {
      withCredentials: true, headers: { 'X-App-Session': '1' }
    }).pipe(
      timeout(15_000),
      tap(response => {
        if (superseded()) throw new SessionSupersededError();
        localStorage.setItem('token', response.accessToken);
        this.retryAfter = 0;
        this.lastError.set(null);
        this.state.set('active');
      }),
      catchError(error => {
        if (superseded()) return throwError(() => new SessionSupersededError());
        this.lastError.set(error);
        if (error instanceof HttpErrorResponse && error.status === 401) {
          this.blocked = true;
          this.state.set('signed-out');
          // An ordinary web login in shared storage is not a revoked app session.
          if (this.hasAppToken) localStorage.removeItem('token');
        } else {
          // Keep credentials on network/timeout/server errors, but avoid retry storms.
          this.retryAfter = Date.now() + 30_000;
          this.state.set('unavailable');
        }
        return throwError(() => error);
      }),
      finalize(() => { this.flight = undefined; }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    return this.flight;
  }

  logout(): Observable<unknown> {
    const token = this.token;
    this.generation++;
    this.blocked = true;
    this.state.set('signed-out');
    localStorage.setItem('app-session-signed-out', '1');
    localStorage.removeItem('token');
    // Still send the cookie when the JWT is expired, missing, or already revoked.
    return this.http.post(`${this.base}/logout`, {}, {
      withCredentials: true,
      headers: { 'X-App-Session': '1', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    }).pipe(
      timeout(15_000),
      tap(() => this.lastError.set(null)),
      catchError(error => {
        this.lastError.set(error);
        return throwError(() => error);
      })
    );
  }

  isApiRequest(request: HttpRequest<unknown>): boolean {
    const target = new URL(request.url, location.origin);
    const api = new URL(this.base, location.origin);
    return target.origin === api.origin && target.pathname.startsWith('/api/');
  }
}

export const appSessionInterceptor: HttpInterceptorFn = (request, next) => {
  const session = inject(AppSessionClient);
  if (!session.isApiRequest(request)) return next(request);
  const path = new URL(request.url, location.origin).pathname;
  if (path === '/api/auth/login' && request.method === 'POST') {
    const generation = session.beginLogin();
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const login = request.clone({
      body: { ...body, mobileApp: session.mobile },
      withCredentials: session.mobile,
      ...(session.mobile ? { setHeaders: { 'X-App-Session': '1' } } : {})
    });
    return next(login).pipe(tap(event => {
      if (event instanceof HttpResponse) session.acceptLogin(event.body as TokenResponse, session.mobile, generation);
    }));
  }
  if (path === '/api/auth/logout') {
    // Api.logout should use AppSessionClient.logout(), which also updates local state.
    return next(request.clone({ withCredentials: true, setHeaders: { 'X-App-Session': '1' } }));
  }
  if (path === '/api/auth/renew' || !request.headers.has('Authorization')) return next(request);

  const attachToken = () => request.clone({
    setHeaders: { Authorization: session.token ? `Bearer ${session.token}` : '' }
  });
  const execute = (renewed: boolean) => {
    const sent = attachToken();
    return next(sent).pipe(catchError(error => {
      if (renewed || !(error instanceof HttpErrorResponse) || error.status !== 401 ||
          !session.canRenew) return throwError(() => error);
      // A concurrent request may already have renewed: use its token instead of renewing again.
      if (sent.headers.get('Authorization') !== `Bearer ${session.token}` && !session.needsRenewal) {
        return next(attachToken());
      }
      if (!session.canRecoverUnauthorized) return throwError(() => error);
      return session.renew().pipe(switchMap(() => next(attachToken())));
    }));
  };
  return session.canRenew && session.needsRenewal
    ? session.renew().pipe(switchMap(() => execute(true)))
    : execute(false);
};
