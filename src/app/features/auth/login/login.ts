import { Component, DestroyRef, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { ApiResponse } from '../../../shared/models/api-response.model';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './login.html',
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly loading = signal(false);
  readonly errorMessage = signal('');
  readonly fieldErrors = signal<Record<string, string>>({});
  readonly form = new FormGroup({
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/\S/)],
    }),
  });

  submit(): void {
    if (this.loading()) return;
    this.errorMessage.set('');
    this.fieldErrors.set({});
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    this.auth
      .login(this.form.getRawValue())
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: () => {
          void this.router.navigate(['/dashboard']);
        },
        error: (error: unknown) => this.handleError(error),
      });
  }

  private handleError(error: unknown): void {
    let message = 'No se pudo iniciar sesión. Inténtalo nuevamente.';
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) {
        this.errorMessage.set(
          'No se pudo conectar con el servidor. Verifica tu conexión e inténtalo nuevamente.',
        );
        return;
      }
      if (error.status === 401) message = 'Correo o contraseña incorrectos.';
      if (error.status === 403) message = 'No tienes permisos para realizar esta operación.';
      if (error.status >= 500)
        message = 'El servidor no pudo procesar la solicitud. Inténtalo más tarde.';
      const body: unknown = error.error;
      if (this.isApiResponse(body)) {
        if (body.message.trim()) message = body.message;
        const data = body.data;
        if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
          const fields = Object.entries(data).filter(
            (entry): entry is [string, string] =>
              ['email', 'password'].includes(entry[0]) && typeof entry[1] === 'string',
          );
          this.fieldErrors.set(Object.fromEntries(fields));
        }
      }
    }
    this.errorMessage.set(message);
  }

  private isApiResponse(value: unknown): value is ApiResponse<unknown> {
    if (typeof value !== 'object' || value === null) return false;
    const body = value as Record<string, unknown>;
    return body['success'] === false && typeof body['message'] === 'string' && 'data' in body;
  }
}
