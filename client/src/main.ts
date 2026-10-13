import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';

import { AppModule } from './app/app.module';
import { DEFAULT_CURRENCY_CODE } from '@angular/core';


platformBrowserDynamic().bootstrapModule(AppModule, {
  providers: [
    {provide: DEFAULT_CURRENCY_CODE, useValue: 'ILS'},
  ]
})
  .catch(err => console.error(err));
