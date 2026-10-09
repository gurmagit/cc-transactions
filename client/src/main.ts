import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';

import { AppModule } from './app/app.module';
import { DEFAULT_CURRENCY_CODE } from '@angular/core';
import { MAT_DATE_LOCALE } from '@angular/material/core';


platformBrowserDynamic().bootstrapModule(AppModule, {
  providers: [
    {provide: DEFAULT_CURRENCY_CODE, useValue: 'ILS'},
    {provide: MAT_DATE_LOCALE, useValue: 'he-IL'}
  ]
})
  .catch(err => console.error(err));
