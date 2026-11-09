import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { API_CONFIG } from '../config/api.config';

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  let url: URL;
  try {
    url = new URL(request.url, document.baseURI);
  } catch {
    return next(request);
  }
  const api = new URL(API_CONFIG.apiUrl);
  const login = new URL(API_CONFIG.loginUrl);
  const path = url.pathname.replace(/\/+$/, '');
  const isApi =
    url.origin === api.origin && (path === api.pathname || path.startsWith(`${api.pathname}/`));
  const isLogin = path === login.pathname;
  if (!isApi || isLogin) return next(request);

  const token = auth.getToken();
  const authenticatedRequest = token
    ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : request;

  return next(authenticatedRequest).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        auth.logout();
        void router.navigate(['/login']);
      }
      return throwError(() => error);
    }),
  );
};
