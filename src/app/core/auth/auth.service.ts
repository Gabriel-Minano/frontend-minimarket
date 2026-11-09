import { inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, Observable } from 'rxjs';
import { API_CONFIG } from '../config/api.config';
import { ApiResponse } from '../../shared/models/api-response.model';
import { AuthResponse } from './models/auth-response.model';
import { AuthUser } from './models/auth-user.model';
import { LoginRequest } from './models/login-request.model';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly storageKey = 'minimarket.session';
  private readonly currentUser = signal<AuthUser | null>(null);
  readonly user = this.currentUser.asReadonly();
  private token: string | null = null;

  constructor() {
    this.restoreSession();
  }

  login(credentials: LoginRequest): Observable<AuthResponse> {
    return this.http.post<ApiResponse<AuthResponse>>(API_CONFIG.loginUrl, credentials).pipe(
      map((response) => {
        if (response?.success !== true || !this.isSession(response.data)) {
          throw new Error('No se pudo iniciar sesión. Inténtalo nuevamente.');
        }
        const session = response.data;
        // Guardar antes de actualizar el estado: si falla el almacenamiento, no hay sesión parcial.
        try {
          sessionStorage.setItem(this.storageKey, JSON.stringify(session));
        } catch {
          this.logout();
          throw new Error('No se pudo guardar la sesión.');
        }
        this.setSession(session);
        return session;
      }),
    );
  }

  logout(): void {
    this.token = null;
    this.currentUser.set(null);
    try {
      sessionStorage.removeItem(this.storageKey);
    } catch {
      // El navegador puede bloquear el almacenamiento; el estado en memoria ya se eliminó.
    }
  }

  getToken(): string | null {
    if (!this.token || !this.isTokenCurrent(this.token)) {
      this.logout();
      return null;
    }
    return this.token;
  }

  isAuthenticated(): boolean {
    return this.getToken() !== null && this.user() !== null;
  }

  hasRole(role: string): boolean {
    return this.isAuthenticated() && (this.user()?.roles.includes(role) ?? false);
  }

  private restoreSession(): void {
    try {
      const stored = sessionStorage.getItem(this.storageKey);
      const session: unknown = stored ? JSON.parse(stored) : null;
      if (this.isSession(session)) {
        this.setSession(session);
      } else {
        this.logout();
      }
    } catch {
      this.logout();
    }
  }

  private setSession(session: AuthResponse): void {
    this.token = session.token;
    this.currentUser.set({ email: session.email, roles: [...session.roles] });
  }

  private isSession(value: unknown): value is AuthResponse {
    if (typeof value !== 'object' || value === null) return false;
    const session = value as Record<string, unknown>;
    return (
      typeof session['token'] === 'string' &&
      this.isTokenCurrent(session['token']) &&
      typeof session['email'] === 'string' &&
      session['email'].trim().length > 0 &&
      Array.isArray(session['roles']) &&
      session['roles'].every((role: unknown) => typeof role === 'string' && role.length > 0)
    );
  }

  private isTokenCurrent(token: string): boolean {
    try {
      const parts = token.split('.');
      if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return false;
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const bytes = Uint8Array.from(
        atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')),
        (char) => char.charCodeAt(0),
      );
      const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (typeof payload !== 'object' || payload === null) return false;
      const exp = (payload as Record<string, unknown>)['exp'];
      // Solo comprueba expiración local. Spring Security valida firma y permisos reales.
      return typeof exp === 'number' && Number.isFinite(exp) && exp > Date.now() / 1000;
    } catch {
      return false;
    }
  }
}
