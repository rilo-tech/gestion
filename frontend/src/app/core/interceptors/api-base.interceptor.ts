import { HttpInterceptorFn } from '@angular/common/http';
import { resolveApiUrl } from '../config/api';

export const apiBaseInterceptor: HttpInterceptorFn = (req, next) => {
  const resolvedUrl = resolveApiUrl(req.url);
  if (resolvedUrl === req.url) return next(req);
  return next(req.clone({ url: resolvedUrl }));
};

