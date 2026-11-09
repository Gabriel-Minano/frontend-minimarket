import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthService } from './auth.service';
import { API_CONFIG } from '../config/api.config';
import { authInterceptor } from '../interceptors/auth.interceptor';
import { routes } from '../../app.routes';
import { Login } from '../../features/auth/login/login';

// Tokens ficticios: estas pruebas comprueban expiración local, nunca una firma real.
function token(exp = Math.floor(Date.now() / 1000) + 3600): string {
  return `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ exp })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}.signature`;
}
const credentials = { email: 'admin@minimarket.com', password: 'test-password' };
const storageKey = 'minimarket.session';
const session = () => ({ token: token(), email: credentials.email, roles: ['ROLE_ADMIN'] });

describe('Autenticación JWT', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  function signIn(): AuthService {
    const auth = TestBed.inject(AuthService);
    auth.login(credentials).subscribe();
    const request = http.expectOne(API_CONFIG.loginUrl);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(credentials);
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({ success: true, message: 'Login exitoso', data: session() });
    return auth;
  }

  it('guarda el wrapper exitoso, expone usuario y roles y elimina la sesión', () => {
    const auth = signIn();
    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.user()?.email).toBe(credentials.email);
    expect(auth.hasRole('ROLE_ADMIN')).toBe(true);
    expect(auth.hasRole('ROLE_CAJERO')).toBe(false);
    expect(JSON.parse(sessionStorage.getItem(storageKey) ?? '{}').token).toBe(auth.getToken());
    auth.logout();
    expect(auth.user()).toBeNull();
    expect(auth.getToken()).toBeNull();
    expect(sessionStorage.getItem(storageKey)).toBeNull();
  });

  it('recupera una sesión válida después de crear el servicio', () => {
    const stored = session();
    sessionStorage.setItem(storageKey, JSON.stringify(stored));
    const auth = TestBed.inject(AuthService);
    expect(auth.getToken()).toBe(stored.token);
    expect(auth.user()?.roles).toEqual(stored.roles);
  });

  it.each([
    '{invalid',
    JSON.stringify({ ...session(), token: token(1) }),
    JSON.stringify({ ...session(), roles: 'ROLE_ADMIN' }),
    JSON.stringify({ ...session(), token: 'not-a-jwt' }),
    JSON.stringify({ ...session(), token: 'header.eyJleHAiOiJmdXR1cmUifQ.signature' }),
    JSON.stringify({ ...session(), token: 'header.e30.signature' }),
  ])('descarta almacenamiento corrupto, mal formado o expirado: %#', (stored) => {
    sessionStorage.setItem(storageKey, stored);
    expect(TestBed.inject(AuthService).isAuthenticated()).toBe(false);
    expect(sessionStorage.getItem(storageKey)).toBeNull();
  });

  it('elimina el token cuando expira durante el uso', () => {
    const auth = signIn();
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 7200_000);
    expect(auth.getToken()).toBeNull();
    expect(auth.user()).toBeNull();
  });

  it.each([null, { ...session(), token: token(1) }])(
    'rechaza un login 200 con data inválida: %#',
    (data) => {
      const error = vi.fn();
      const auth = TestBed.inject(AuthService);
      auth.login(credentials).subscribe({ error });
      http.expectOne(API_CONFIG.loginUrl).flush({ success: true, message: 'Login exitoso', data });
      expect(error).toHaveBeenCalled();
      expect(auth.isAuthenticated()).toBe(false);
    },
  );

  it('adjunta el JWT únicamente a la API y excluye login, dominios y rutas parecidas', () => {
    const auth = signIn();
    const client = TestBed.inject(HttpClient);
    client.get(`${API_CONFIG.apiUrl}/test`).subscribe();
    const protectedRequest = http.expectOne(`${API_CONFIG.apiUrl}/test`);
    expect(protectedRequest.request.headers.get('Authorization')).toBe(`Bearer ${auth.getToken()}`);
    protectedRequest.flush({});
    for (const url of [
      API_CONFIG.loginUrl,
      `${API_CONFIG.loginUrl}?source=test`,
      'https://external.example/api/test',
      `${API_CONFIG.baseUrl}.evil.example/api/test`,
      `${API_CONFIG.baseUrl}/api-other/test`,
    ]) {
      client.post(url, {}).subscribe();
      const request = http.expectOne(url);
      expect(request.request.headers.has('Authorization')).toBe(false);
      request.flush({});
    }
  });

  it.each([401, 403, 500, 0])(
    'propaga %s y elimina la sesión solo ante 401 protegido',
    (status) => {
      const auth = signIn();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      const error = vi.fn();
      TestBed.inject(HttpClient).get(`${API_CONFIG.apiUrl}/test`).subscribe({ error });
      http.expectOne(`${API_CONFIG.apiUrl}/test`).flush(null, { status, statusText: 'Test error' });
      expect(error).toHaveBeenCalled();
      expect(auth.isAuthenticated()).toBe(status !== 401);
      expect(navigate).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
    },
  );

  it('no redirige por un 401 del login o de otro dominio', () => {
    signIn();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    for (const url of [API_CONFIG.loginUrl, 'https://external.example/api/test']) {
      TestBed.inject(HttpClient)
        .post(url, {})
        .subscribe({ error: () => {} });
      http.expectOne(url).flush(null, { status: 401, statusText: 'Unauthorized' });
    }
    expect(navigate).not.toHaveBeenCalled();
    expect(TestBed.inject(AuthService).isAuthenticated()).toBe(true);
  });

  it('redirige dashboard sin sesión y muestra validaciones sin enviar solicitudes', async () => {
    const harness = await RouterTestingHarness.create();
    const login = await harness.navigateByUrl('/dashboard', Login);
    expect(TestBed.inject(Router).url).toBe('/login');
    login.submit();
    harness.detectChanges();
    expect(harness.routeNativeElement?.textContent).toContain(
      'El correo electrónico es obligatorio',
    );
    expect(harness.routeNativeElement?.textContent).toContain('La contraseña es obligatoria');
    login.form.setValue({ email: 'incorrecto', password: '   ' });
    expect(login.form.invalid).toBe(true);
    http.expectNone(API_CONFIG.loginUrl);
  });

  it('evita envíos duplicados, navega al dashboard y permite cerrar sesión', async () => {
    const harness = await RouterTestingHarness.create();
    const login = await harness.navigateByUrl('/login', Login);
    login.form.setValue(credentials);
    login.submit();
    login.submit();
    http
      .expectOne(API_CONFIG.loginUrl)
      .flush({ success: true, message: 'Login exitoso', data: session() });
    await TestBed.inject(Router).navigateByUrl('/dashboard');
    harness.detectChanges();
    expect(harness.routeNativeElement?.textContent).toContain('Inicio de sesión exitoso');
    harness.routeNativeElement?.querySelector('button')?.click();
    await TestBed.inject(Router).navigateByUrl('/login');
    expect(TestBed.inject(AuthService).isAuthenticated()).toBe(false);
    expect(sessionStorage.getItem(storageKey)).toBeNull();
  });

  it.each([
    {
      status: 401,
      body: { success: false, message: 'Credenciales inválidas', data: null },
      expected: 'Credenciales inválidas',
    },
    {
      status: 400,
      body: { success: false, message: 'Error de validación', data: { email: 'Correo inválido' } },
      expected: 'Error de validación',
    },
    { status: 500, body: '<html>proxy error</html>', expected: 'El servidor no pudo procesar' },
    { status: 0, body: null, expected: 'No se pudo conectar' },
  ])('muestra errores de login de forma segura: $status', async ({ status, body, expected }) => {
    const harness = await RouterTestingHarness.create();
    const login = await harness.navigateByUrl('/login', Login);
    login.form.setValue(credentials);
    login.submit();
    http.expectOne(API_CONFIG.loginUrl).flush(body, { status, statusText: 'Test error' });
    harness.detectChanges();
    expect(login.loading()).toBe(false);
    expect(harness.routeNativeElement?.querySelector('[role="alert"]')?.textContent).toContain(
      expected,
    );
    if (status === 400) expect(login.fieldErrors()['email']).toBe('Correo inválido');
    expect(TestBed.inject(Router).url).toBe('/login');
  });
});
