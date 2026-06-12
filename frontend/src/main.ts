import 'zone.js';
import './styles.css';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';
import { getGoogleRedirectResultOnce } from './app/core/utils/google-auth-redirect';

getGoogleRedirectResultOnce()
  .catch(() => null)
  .finally(() => {
    bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
  });
