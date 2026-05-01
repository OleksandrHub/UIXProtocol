import { Component, inject } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-dashboard',
  imports: [],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  private readonly sanitizer = inject(DomSanitizer);

  readonly proxyUrl: SafeResourceUrl = this.sanitizer.bypassSecurityTrustResourceUrl(
    `http://localhost:${environment.port}/`
  );
}
