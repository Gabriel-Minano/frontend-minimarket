import { environment } from '../../../environments/environment';

const baseUrl = environment.apiUrl.trim().replace(/\/+$/, '');

export const API_CONFIG = {
  baseUrl,
  apiUrl: `${baseUrl}/api`,
  loginUrl: `${baseUrl}/api/auth/login`,
};
