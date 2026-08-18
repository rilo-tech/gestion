import 'zone.js';
import './styles.css';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';
import { getGoogleRedirectResultOnce } from './app/core/utils/google-auth-redirect';

// No bloquear el arranque: si Google Auth no responde, igual mostramos la app.
void getGoogleRedirectResultOnce().catch(() => null);

bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
